import 'server-only';

import {
  buildAllocationPlan,
  applyRuleActions,
  goalWeight,
  receiptsByGoal,
  type AllocationPlan,
  type Claim,
  type RuleNote,
} from '@app/allocation-engine';
import {
  buildPayPeriods,
  computeSafeToSpend,
  nextOccurrence,
  PAY_PERIOD_HORIZON_DAYS,
  type Frequency,
  type PayPeriod,
  type PeriodClaim,
  type SafeToSpendResult,
} from '@app/budget-engine';
import {
  accounts,
  debts,
  goals,
  householdSettings,
  households,
  obligations,
  receivables,
  recurringSeries,
  rules as ruleRows,
} from '@app/database/schema';
import { orderDebts, totalMinimums, type Debt } from '@app/debt-engine';
import { addDays, Money, todayIn, type CurrencyCode, type PlainDate } from '@app/domain';
import {
  evaluateRules,
  type Action,
  type Condition,
  type FactSet,
  type FactValue,
  type Rule,
} from '@app/rule-engine';
import { and, eq, isNull } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';
import { penaltyStillAtStake } from './late-fee';
import { currentOccurrenceUnpaid } from './commitment-settlement';

/**
 * The allocation plan, on real rows.
 *
 * This is where Phases 6 through 10 meet the product. The order matters and is
 * not arbitrary:
 *
 *   1. Safe-to-spend, so the plan knows what is already claimed.
 *   2. Debt ordering, so the strategy decides which balance the extra attacks.
 *   3. Rules, evaluated against facts assembled from the two above.
 *   4. Allocation, over the claims the rules may have reshaped.
 *
 * A rule that reads `debt.apr.mastercard` can only see it because step 2 put it
 * in the fact set. Nothing here lets a rule reach anything the caller did not
 * deliberately hand it.
 *
 * Every figure comes from a row. Where the household has no data, the plan is
 * short rather than padded — a demonstration plan on a household's own screen
 * would imply money that is not there.
 */

const LIQUID_ACCOUNT_TYPES = ['checking', 'savings', 'cash', 'digital_wallet'] as const;

const OBLIGATION_HORIZON_DAYS = 30;

export interface PlanView {
  readonly currency: CurrencyCode;
  readonly today: PlainDate;
  readonly safeToSpend: SafeToSpendResult;
  readonly plan: AllocationPlan;
  /** Rule notes and skips, so the screen can say why a rule did nothing. */
  readonly ruleNotes: readonly RuleNote[];
  readonly skippedRules: readonly { name: string; reason: string }[];
  readonly debtOrder: readonly { id: string; name: string; reason: string }[];
  /**
   * The household's own pay periods, and the one they are living in now.
   *
   * Empty when no income is on record: without a payday there is no period, and
   * the plan falls back to dividing what is held over the next thirty days. The
   * screen has to be able to tell those two situations apart, because the
   * second one is answering a slightly different question.
   */
  readonly periods: readonly PayPeriod[];
  /**
   * Lo que el hogar espera cobrar, al lado del plan y nunca dentro de él.
   *
   * El plan reparte dinero que entró. Un cobro tratado como cierto es la cifra
   * optimista que arruina un presupuesto —el cliente paga tarde, el hermano no
   * paga, y la casa ya gastó contra eso—, así que no suma a `safeToSpend` ni a
   * ningún período. Viaja aquí para que la pantalla pueda enseñarlo aparte y el
   * hogar pueda perseguirlo, que es la única gestión que un cobro admite.
   */
  /**
   * Qué cobro le sirve a qué meta, para poder enseñarlo al lado de ella.
   *
   * Nunca sumado a su saldo: esto dice «viene esto para esta fecha», no «ya lo
   * tienes». El plan se hace con el dinero que entró.
   */
  readonly expectedByGoal: readonly {
    readonly goalId: string;
    readonly name: string;
    readonly total: Money;
    readonly receipts: readonly {
      readonly id: string;
      readonly name: string;
      readonly amount: Money;
      readonly expectedOn: PlainDate;
    }[];
  }[];
  readonly expected: readonly {
    readonly id: string;
    readonly name: string;
    readonly source: string | null;
    readonly amount: Money;
    readonly expectedOn: PlainDate | null;
    readonly isConfirmed: boolean;
  }[];
  readonly isEmpty: boolean;
}

export async function loadPlan(session: Session, householdId: string): Promise<PlanView> {
  return queryAsUser(session, async (tx) => {
    const [household] = await tx
      .select({ currency: households.baseCurrency, timeZone: households.timeZone })
      .from(households)
      .where(eq(households.id, householdId))
      .limit(1);

    const currency = (household?.currency.trim() ?? 'USD') as CurrencyCode;
    const today = todayIn(household?.timeZone ?? 'America/Panama');
    const horizon = addDays(today, OBLIGATION_HORIZON_DAYS);
    const zero = Money.zero(currency);

    const [accountRows, obligationRows, debtRows, goalRows, settingsRows, storedRules, incomeRows] =
      await Promise.all([
        tx
          .select({ balance: accounts.currentBalance, type: accounts.accountType })
          .from(accounts)
          .where(
            and(
              eq(accounts.householdId, householdId),
              eq(accounts.status, 'active'),
              isNull(accounts.deletedAt),
            ),
          ),
        tx
          .select({
            id: obligations.id,
            name: obligations.name,
            due: obligations.dueDate,
            amount: obligations.expectedAmount,
            isEssential: obligations.isEssential,
            lateFeeAmount: obligations.lateFeeAmount,
            lateFeeRate: obligations.lateFeeRate,
            lateFeeAfterDays: obligations.lateFeeAfterDays,
            frequency: obligations.frequency,
            anchorDays: obligations.anchorDays,
            anchorAmounts: obligations.anchorAmounts,
          })
          .from(obligations)
          .where(
            and(
              eq(obligations.householdId, householdId),
              isNull(obligations.deletedAt),
              isNull(obligations.settledTransactionId),
              // And not already paid for this occurrence — declared by the household or
              // matched to a real movement. See `currentOccurrenceUnpaid`.
              currentOccurrenceUnpaid,
              // Not a claim on money the household holds: it is taken out of a
              // salary before that salary arrives. See the column's own note.
              eq(obligations.isDeductedAtSource, false),
            ),
          )
          .orderBy(obligations.dueDate),
        tx
          .select({
            id: debts.id,
            name: debts.name,
            currentBalance: debts.currentBalance,
            apr: debts.apr,
            minimumPayment: debts.minimumPayment,
            creditLimit: debts.creditLimit,
            promotionalApr: debts.promotionalApr,
            promotionalExpiresOn: debts.promotionalExpiresOn,
            strategyPriority: debts.strategyPriority,
          })
          .from(debts)
          .where(and(eq(debts.householdId, householdId), isNull(debts.deletedAt))),
        tx
          .select({
            id: goals.id,
            name: goals.name,
            target: goals.targetAmount,
            current: goals.currentAmount,
            priority: goals.priority,
            targetDate: goals.targetDate,
            isCommitted: goals.isCommitted,
          })
          .from(goals)
          .where(and(eq(goals.householdId, householdId), eq(goals.status, 'active')))
          .orderBy(goals.priority),
        tx
          .select({
            bufferMinimum: householdSettings.bufferMinimum,
            debtStrategy: householdSettings.debtStrategy,
            taxReserveRate: householdSettings.taxReserveRate,
          })
          .from(householdSettings)
          .where(eq(householdSettings.householdId, householdId))
          .limit(1),
        tx
          .select({
            id: ruleRows.id,
            name: ruleRows.name,
            explanation: ruleRows.explanation,
            conditions: ruleRows.conditions,
            actions: ruleRows.actions,
            priority: ruleRows.priority,
            isActive: ruleRows.isActive,
            effectiveFrom: ruleRows.effectiveFrom,
            effectiveTo: ruleRows.effectiveTo,
          })
          .from(ruleRows)
          .where(and(eq(ruleRows.householdId, householdId), isNull(ruleRows.deletedAt)))
          .orderBy(ruleRows.priority),
        // What comes in, and when. The days matter more than the amounts here:
        // they are what divides the horizon into the periods the household
        // actually lives in.
        tx
          .select({
            id: recurringSeries.id,
            name: recurringSeries.name,
            amount: recurringSeries.expectedAmount,
            frequency: recurringSeries.frequency,
            anchorDays: recurringSeries.anchorDays,
            anchorAmounts: recurringSeries.anchorAmounts,
            nextExpectedDate: recurringSeries.nextExpectedDate,
          })
          .from(recurringSeries)
          .where(
            and(
              eq(recurringSeries.householdId, householdId),
              eq(recurringSeries.direction, 'inflow'),
              eq(recurringSeries.isActive, true),
              isNull(recurringSeries.deletedAt),
            ),
          ),
      ]);

    const settings = settingsRows[0];
    const bufferMinimum = Money.fromDecimalString(settings?.bufferMinimum ?? '0', currency);

    const periodHorizon = addDays(today, PAY_PERIOD_HORIZON_DAYS);

    const liquid = Money.sum(
      accountRows
        .filter((row) => (LIQUID_ACCOUNT_TYPES as readonly string[]).includes(row.type))
        .map((row) => Money.fromDecimalString(row.balance, currency)),
      currency,
    );

    /**
     * Every date each commitment falls on between now and the horizon.
     *
     * A monthly obligation is one row with one due date, and the plan used to
     * read it as one payment. Over a horizon long enough to hold two paydays
     * that is wrong in the way that matters: the rent due on the 1st exists in
     * *every* fortnight of the 1st, and a household deciding what to spend on
     * the 16th needs to see the one that is coming, not the one that has
     * already gone.
     *
     * The same stepper the recurrence pass uses, so a commitment projected here
     * and the same commitment on the forecast screen land on the same days.
     */
    const occurrencesOf = (row: (typeof obligationRows)[number]): readonly PlainDate[] => {
      const first = row.due as PlainDate;
      const cadence = row.frequency as Frequency | null;
      if (!cadence) return first <= periodHorizon ? [first] : [];

      const dates: PlainDate[] = [];
      let date = first;
      // Bounded for the same reason the engine's own walk is: a cadence that
      // fails to advance must not spin. A daily commitment over the horizon is
      // sixty-two dates; this is far past it.
      for (let step = 0; step < 400 && date <= periodHorizon; step += 1) {
        // Anything already overdue is carried in as it stands: it is owed now,
        // not on the day it was originally due.
        if (date >= today || dates.length === 0) dates.push(date);
        const next = nextOccurrence(cadence, date, row.anchorDays ?? undefined);
        if (next <= date) break;
        date = next;
      }
      return dates;
    };

    const periodClaims: PeriodClaim[] = obligationRows.flatMap((row) => {
      const flat = Money.fromDecimalString(row.amount, currency);

      /**
       * What this occurrence costs, which is not always the same figure.
       *
       * A payment of $700 on the 15th and $560 on the 30th is two different
       * claims, and averaging them to $630 would be right about the month and
       * wrong about both fortnights — which is the only thing the fortnight
       * view exists to get right. The amount is matched to the anchor day it
       * falls on, so the heavy one lands where it actually lands.
       */
      const amountOn = (due: PlainDate): Money => {
        const perAnchor = row.anchorAmounts;
        const days = row.anchorDays;
        if (!perAnchor || !days) return flat;
        const at = days.indexOf(Number(due.slice(8, 10)));
        const stated = at >= 0 ? perAnchor[at] : undefined;
        return stated === undefined ? flat : Money.fromDecimalString(stated, currency);
      };

      return occurrencesOf(row).map((due, at) => ({
        // The row's own id for the first occurrence, so anything keyed on it
        // still matches; later ones are distinct claims on distinct days.
        id: at === 0 ? row.id : `${row.id}@${due}`,
        label: row.name,
        amount: amountOn(due),
        due,
        isEssential: row.isEssential,
      }));
    });

    const expectedRowsEarly = await tx
      .select({
        id: receivables.id,
        name: receivables.name,
        source: receivables.source,
        amount: receivables.amount,
        expectedOn: receivables.expectedOn,
        confidence: receivables.confidence,
      })
      .from(receivables)
      .where(
        and(
          eq(receivables.householdId, householdId),
          isNull(receivables.deletedAt),
          isNull(receivables.receivedOn),
        ),
      );

    const expectedForPlan = expectedRowsEarly
      .filter((row) => row.confidence === 'confirmed' && row.expectedOn !== null)
      .map((row) => ({
        id: row.id,
        label: row.name,
        amount: Money.fromDecimalString(row.amount, currency),
        on: row.expectedOn as PlainDate,
      }));

    const periods = buildPayPeriods({
      currency,
      today,
      opening: liquid,
      incomes: incomeRows.map((row) => ({
        id: row.id,
        label: row.name,
        amount: Money.fromDecimalString(row.amount, currency),
        frequency: row.frequency,
        anchorDays: row.anchorDays ?? undefined,
        // Lo que trae cada quincena cuando no traen lo mismo. La base ya
        // garantiza que la lista tenga tantos montos como días.
        ...(row.anchorAmounts
          ? {
              anchorAmounts: row.anchorAmounts.map((one) => Money.fromDecimalString(one, currency)),
            }
          : {}),
        nextPayday: row.nextExpectedDate as PlainDate,
      })),
      /**
       * Lo confirmado entra; lo estimado no.
       *
       * Un cobro que el hogar dio por seguro, con día, es dinero con el que se
       * puede contar y el plan lo reparte cuando llega. Uno estimado se queda
       * fuera: tratarlo como cierto es la cifra optimista que deja a una casa
       * gastando contra un pago que llegó tarde —o no llegó—, y esa distinción
       * la hace la persona, no el producto.
       */
      oneOffIncome: expectedForPlan,
      claims: periodClaims,
      keepAtLeast: bufferMinimum,
    });

    /**
     * What the plan divides, and over which claims.
     *
     * With a payday on record it is the period the household is living in: what
     * this fortnight can spare, against what this fortnight owes. Without one
     * there are no periods, and it falls back to what the plan always did —
     * everything held, over the next thirty days. The fallback is not a worse
     * answer to the same question, it is the answer to a different one, and
     * `periods` being empty is how the screen can say which it is looking at.
     */
    const current = periods[0];

    const upcoming = (
      current
        ? current.claims
        : obligationRows
            .filter((row) => row.due <= horizon)
            .map((row) => ({
              id: row.id,
              label: row.name,
              amount: Money.fromDecimalString(row.amount, currency),
              due: row.due as PlainDate,
              isEssential: row.isEssential,
            }))
    ).map((claim) => {
      const source = obligationRows.find((row) => claim.id.startsWith(row.id));
      return {
        id: claim.id,
        name: claim.label,
        due: claim.due,
        amount: claim.amount,
        isEssential: claim.isEssential,
        missPenalty: source ? penaltyStillAtStake(source, claim.amount, claim.due, today) : null,
      };
    });

    const modelDebts: Debt[] = debtRows.map((row) => ({
      id: row.id,
      name: row.name,
      currentBalance: Money.fromDecimalString(row.currentBalance, currency),
      apr: row.apr,
      minimumPayment: Money.fromDecimalString(row.minimumPayment, currency),
      creditLimit: row.creditLimit ? Money.fromDecimalString(row.creditLimit, currency) : null,
      promotionalApr: row.promotionalApr,
      promotionalExpiresOn: (row.promotionalExpiresOn as PlainDate | null) ?? null,
      strategyPriority: row.strategyPriority,
    }));

    const minimums = totalMinimums(modelDebts, currency);

    // Estimated, never "your tax bill" — the rate is the household's own setting
    // until the tax engine arrives in Phase 12.
    const taxReserve = settings?.taxReserveRate ? liquid.percentage(settings.taxReserveRate) : zero;

    const safeToSpend = computeSafeToSpend({
      currency,
      today,
      liquid,
      obligations: upcoming,
      minimumDebtPayments: minimums,
      taxReserve,
      bufferMinimum,
      horizonDays: OBLIGATION_HORIZON_DAYS,
    });

    const ordered = orderDebts(modelDebts, settings?.debtStrategy ?? 'avalanche', today, {
      extraPayment: safeToSpend.safeToSpend.isPositive() ? safeToSpend.safeToSpend : zero,
    });

    const facts = buildFacts({
      currency,
      liquid,
      safeToSpend: safeToSpend.safeToSpend,
      bufferMinimum,
      taxReserve,
      debts: modelDebts,
      goals: goalRows.map((row) => ({
        id: row.id,
        current: Money.fromDecimalString(row.current, currency),
        target: Money.fromDecimalString(row.target, currency),
      })),
    });

    const evaluation = evaluateRules(storedRules.map(toRule), facts, { on: today });

    const baseClaims = buildClaims({
      currency,
      today,
      obligations: upcoming,
      debts: modelDebts,
      ordered,
      taxReserve,
      bufferMinimum,
      goals: goalRows.map((row) => ({
        id: row.id,
        name: row.name,
        // El peso que de verdad manda: una meta confirmada con fecha va por
        // delante de todo lo que nadie confirmó, y entre confirmadas manda el
        // día. Lo no confirmado conserva el orden que la casa le dio.
        priority: goalWeight({
          priority: row.priority,
          targetDate: (row.targetDate as PlainDate | null) ?? null,
          isCommitted: row.isCommitted,
          today,
        }),
        targetDate: (row.targetDate as PlainDate | null) ?? null,
        remaining: Money.fromDecimalString(row.target, currency).subtract(
          Money.fromDecimalString(row.current, currency),
        ),
      })),
    });

    const applied = applyRuleActions(baseClaims, evaluation.actions, liquid);

    const plan = buildAllocationPlan({
      // What this period can spare, not everything the household holds. The
      // difference is the point: a plan that hands out the whole balance on the
      // 15th is the reason the 30th arrives short.
      incoming: current ? current.available : liquid,
      claims: applied.claims,
      order: applied.order,
      today,
      appliedRuleIds: evaluation.matched.map((entry) => entry.ruleId),
    });

    // Lo que está por cobrar, leído aparte y sumado a nada. Ordenado por fecha,
    // con lo que no tiene fecha al final: «no sé cuándo» es lo último que se
    // persigue, no lo primero.
    const expectedRows = expectedRowsEarly;

    return {
      currency,
      today,
      safeToSpend,
      plan,
      // Y qué cobro le sirve a qué meta: el préstamo que devuelven en diciembre
      // le sirve al viaje del 20 y no al carro de marzo. Se enseña al lado, no
      // sumado — el plan se hace con el dinero que entró.
      expectedByGoal: [
        ...receiptsByGoal({
          goals: goalRows.map((row) => ({
            id: row.id,
            targetDate: (row.targetDate as PlainDate | null) ?? null,
          })),
          receipts: expectedRows
            .filter((row) => row.expectedOn !== null)
            .map((row) => ({
              id: row.id,
              name: row.name,
              amount: Money.fromDecimalString(row.amount, currency),
              expectedOn: row.expectedOn as PlainDate,
            })),
        }).entries(),
      ].map(([goalId, receipts]) => ({
        goalId,
        name: goalRows.find((one) => one.id === goalId)?.name ?? goalId,
        receipts: receipts.map((one) => ({
          id: one.id,
          name: one.name,
          amount: one.amount,
          expectedOn: one.expectedOn,
        })),
        total: Money.sum(
          receipts.map((one) => one.amount),
          currency,
        ),
      })),
      expected: expectedRows
        .map((row) => ({
          id: row.id,
          name: row.name,
          source: row.source,
          amount: Money.fromDecimalString(row.amount, currency),
          expectedOn: (row.expectedOn as PlainDate | null) ?? null,
          isConfirmed: row.confidence === 'confirmed',
        }))
        .sort((a, b) => (a.expectedOn ?? '9999-12-31').localeCompare(b.expectedOn ?? '9999-12-31')),
      ruleNotes: applied.notes,
      skippedRules: evaluation.skipped.map((entry) => ({
        name: entry.name,
        reason: entry.missingFact ?? entry.reason,
      })),
      periods,
      debtOrder: ordered.map((entry) => ({
        id: entry.debt.id,
        name: entry.debt.name,
        reason: entry.reason,
      })),
      isEmpty: accountRows.length === 0 && obligationRows.length === 0 && debtRows.length === 0,
    };
  });
}

/**
 * Assembles the facts a rule is allowed to see.
 *
 * Everything a rule can read is put here deliberately. There is no path from a
 * stored rule to a row this function did not load.
 */
function buildFacts(input: {
  currency: CurrencyCode;
  liquid: Money;
  safeToSpend: Money;
  bufferMinimum: Money;
  taxReserve: Money;
  debts: readonly Debt[];
  goals: readonly { id: string; current: Money; target: Money }[];
}): FactSet {
  const facts = new Map<string, FactValue>();

  facts.set('position.liquid', { kind: 'money', value: input.liquid });
  facts.set('position.safe_to_spend', { kind: 'money', value: input.safeToSpend });
  facts.set('position.buffer_minimum', { kind: 'money', value: input.bufferMinimum });
  facts.set('tax.reserve_balance', { kind: 'money', value: input.taxReserve });

  facts.set('debt.total_balance', {
    kind: 'money',
    value: Money.sum(
      input.debts.map((debt) => debt.currentBalance),
      input.currency,
    ),
  });

  for (const debt of input.debts) {
    facts.set(`debt.balance.${debt.id}`, { kind: 'money', value: debt.currentBalance });
    facts.set(`debt.apr.${debt.id}`, { kind: 'number', value: Number(debt.apr) });
    facts.set(`debt.minimum_payment.${debt.id}`, { kind: 'money', value: debt.minimumPayment });
  }

  for (const goal of input.goals) {
    facts.set(`goal.balance.${goal.id}`, { kind: 'money', value: goal.current });
    facts.set(`goal.target.${goal.id}`, { kind: 'money', value: goal.target });
  }

  return facts;
}

/** Turns the household's rows into the claims the ladder ranks. */
function buildClaims(input: {
  currency: CurrencyCode;
  today: PlainDate;
  obligations: readonly {
    id: string;
    name: string;
    due: PlainDate;
    amount: Money;
    missPenalty: Money | null;
  }[];
  debts: readonly Debt[];
  ordered: readonly { debt: Debt; effectiveApr: string; position: number }[];
  taxReserve: Money;
  bufferMinimum: Money;
  goals: readonly {
    id: string;
    name: string;
    priority: number;
    targetDate: PlainDate | null;
    remaining: Money;
  }[];
}): Claim[] {
  const claims: Claim[] = [];

  for (const obligation of input.obligations) {
    claims.push({
      id: `obligation-${obligation.id}`,
      kind: obligation.due < input.today ? 'overdue_essential' : 'upcoming_essential',
      label: obligation.name,
      target: `obligation:${obligation.id}`,
      requested: obligation.amount,
      dueDate: obligation.due,
      missPenalty: obligation.missPenalty,
    });
  }

  for (const debt of input.debts) {
    if (!debt.minimumPayment.isPositive()) continue;
    claims.push({
      id: `debt-min-${debt.id}`,
      kind: 'debt_minimum',
      label: debt.name,
      target: `debt:${debt.id}`,
      requested: Money.min(debt.minimumPayment, debt.currentBalance),
      apr: debt.apr,
    });
  }

  if (input.taxReserve.isPositive()) {
    claims.push({
      id: 'tax-reserve',
      kind: 'tax_reserve',
      label: 'Tax reserve',
      target: 'tax:reserve',
      requested: input.taxReserve,
    });
  }

  if (input.bufferMinimum.isPositive()) {
    claims.push({
      id: 'buffer',
      kind: 'emergency_fund',
      label: 'Buffer',
      target: 'goal:buffer',
      requested: input.bufferMinimum,
    });
  }

  // Only the debt the strategy names gets an extra-payment claim. Every other
  // balance is already represented by its minimum.
  const target = input.ordered[0];
  if (target?.debt.currentBalance.greaterThan(target.debt.minimumPayment)) {
    claims.push({
      id: `debt-extra-${target.debt.id}`,
      kind: 'high_interest_debt',
      label: target.debt.name,
      target: `debt:${target.debt.id}:extra`,
      requested: target.debt.currentBalance.subtract(target.debt.minimumPayment),
      apr: target.effectiveApr,
    });
  }

  for (const goal of input.goals) {
    if (!goal.remaining.isPositive()) continue;
    claims.push({
      id: `goal-${goal.id}`,
      kind: 'goal',
      label: goal.name,
      target: `goal:${goal.id}`,
      requested: goal.remaining,
      dueDate: goal.targetDate,
      weight: goal.priority,
    });
  }

  return claims;
}

/** Reads a stored rule back into the engine's shape, JSON columns included. */
function toRule(row: {
  id: string;
  name: string;
  explanation: string;
  conditions: unknown;
  actions: unknown;
  priority: number;
  isActive: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}): Rule {
  return {
    id: row.id,
    name: row.name,
    explanation: row.explanation,
    // Shape is enforced by `validateRule`, which `evaluateRules` runs on every
    // rule before it is evaluated — a row edited in the database is caught there
    // and reported as invalid rather than trusted.
    when: row.conditions as Condition,
    then: (Array.isArray(row.actions) ? row.actions : []) as Action[],
    priority: row.priority,
    isActive: row.isActive,
    effectiveFrom: (row.effectiveFrom as PlainDate | null) ?? null,
    effectiveTo: (row.effectiveTo as PlainDate | null) ?? null,
  };
}
