import 'server-only';

import {
  buildAllocationPlan,
  applyRuleActions,
  type AllocationPlan,
  type Claim,
  type RuleNote,
} from '@app/allocation-engine';
import { computeSafeToSpend, type SafeToSpendResult } from '@app/budget-engine';
import {
  accounts,
  debts,
  goals,
  householdSettings,
  households,
  obligations,
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

    const [accountRows, obligationRows, debtRows, goalRows, settingsRows, storedRules] =
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
          })
          .from(obligations)
          .where(
            and(
              eq(obligations.householdId, householdId),
              isNull(obligations.deletedAt),
              isNull(obligations.settledTransactionId),
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
      ]);

    const settings = settingsRows[0];
    const bufferMinimum = Money.fromDecimalString(settings?.bufferMinimum ?? '0', currency);

    const liquid = Money.sum(
      accountRows
        .filter((row) => (LIQUID_ACCOUNT_TYPES as readonly string[]).includes(row.type))
        .map((row) => Money.fromDecimalString(row.balance, currency)),
      currency,
    );

    const upcoming = obligationRows
      .filter((row) => row.due <= horizon)
      .map((row) => ({
        id: row.id,
        name: row.name,
        due: row.due as PlainDate,
        amount: Money.fromDecimalString(row.amount, currency),
        isEssential: row.isEssential,
      }));

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
        priority: row.priority,
        targetDate: (row.targetDate as PlainDate | null) ?? null,
        remaining: Money.fromDecimalString(row.target, currency).subtract(
          Money.fromDecimalString(row.current, currency),
        ),
      })),
    });

    const applied = applyRuleActions(baseClaims, evaluation.actions, liquid);

    const plan = buildAllocationPlan({
      incoming: liquid,
      claims: applied.claims,
      order: applied.order,
      today,
      appliedRuleIds: evaluation.matched.map((entry) => entry.ruleId),
    });

    return {
      currency,
      today,
      safeToSpend,
      plan,
      ruleNotes: applied.notes,
      skippedRules: evaluation.skipped.map((entry) => ({
        name: entry.name,
        reason: entry.missingFact ?? entry.reason,
      })),
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
  obligations: readonly { id: string; name: string; due: PlainDate; amount: Money }[];
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
