import 'server-only';

import { getPlatformDb } from '@app/database';
import { getServerEnv } from '@app/validation/env';

import {
  accounts,
  categories,
  debts,
  goals,
  householdMembers,
  householdPeople,
  householdSettings,
  institutions,
  obligations,
  profiles,
  recurringSeries,
  rules,
  transactions,
} from '@app/database/schema';
import { Money, type CurrencyCode, type PlainDate } from '@app/domain';
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * Everything the household administers about itself.
 *
 * These readers exist because the engines were built to read rows the interface
 * could never show. A debt with a rate, a goal with a target, a commitment with
 * a due date — all of them created once inside the setup questionnaire and then
 * invisible, uneditable and unremovable. A financial system where a wrong
 * figure cannot be corrected is a system that is abandoned in its first month.
 *
 * Every loader here returns figures already parsed into `Money`, and dates as
 * `PlainDate` strings. Nothing downstream is ever handed a number it has to
 * decide how to interpret.
 */

export interface IncomeView {
  readonly id: string;
  readonly name: string;
  readonly amount: Money;
  readonly frequency: string;
  readonly nextExpectedDate: PlainDate;
  /** True when the household said «about», rather than «exactly». */
  readonly isApproximate: boolean;
  /** Si el monto declarado ya trae descontado lo que sale de la planilla. */
  readonly statedBasis: 'net' | 'gross';
  readonly isActive: boolean;
  readonly declared: boolean;
}

/** Anything above zero means the amount was stated as an approximation. */
const APPROXIMATE_THRESHOLD = 0;

export async function loadIncomes(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<readonly IncomeView[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: recurringSeries.id,
        name: recurringSeries.name,
        amount: recurringSeries.expectedAmount,
        frequency: recurringSeries.frequency,
        nextExpectedDate: recurringSeries.nextExpectedDate,
        amountVariation: recurringSeries.amountVariation,
        statedBasis: recurringSeries.statedBasis,
        isActive: recurringSeries.isActive,
        detectedBy: recurringSeries.detectedBy,
      })
      .from(recurringSeries)
      .where(
        and(
          eq(recurringSeries.householdId, householdId),
          eq(recurringSeries.direction, 'inflow'),
          isNull(recurringSeries.deletedAt),
        ),
      )
      .orderBy(desc(recurringSeries.isActive), recurringSeries.nextExpectedDate),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    amount: Money.fromDecimalString(row.amount, currency),
    frequency: row.frequency,
    nextExpectedDate: row.nextExpectedDate as PlainDate,
    isApproximate: Number(row.amountVariation) > APPROXIMATE_THRESHOLD,
    statedBasis: row.statedBasis,
    isActive: row.isActive,
    declared: row.detectedBy === 'user',
  }));
}

export interface DebtView {
  readonly id: string;
  readonly name: string;
  readonly currentBalance: Money;
  readonly principal: Money;
  readonly apr: string;
  readonly minimumPayment: Money;
  readonly dueDay: number | null;
  readonly statementDay: number | null;
  readonly creditLimit: Money | null;
  readonly accountId: string | null;
  /** Los últimos cuatro de la tarjeta, en la cuenta que la lleva. */
  readonly maskedNumber: string | null;
  readonly instalmentDay: number | null;
  readonly termMonths: number | null;
  readonly paidMonths: number | null;
  /** Which class of debt, which is what decides the account type it converts to. */
  readonly kind: string;
  /** Whose it is, within the household. Null means the household's. */
  readonly personId: string | null;
  readonly personName: string | null;
}

export async function loadDebts(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<readonly DebtView[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: debts.id,
        name: debts.name,
        currentBalance: debts.currentBalance,
        principal: debts.principal,
        apr: debts.apr,
        minimumPayment: debts.minimumPayment,
        dueDay: debts.dueDay,
        statementDay: debts.statementDay,
        creditLimit: debts.creditLimit,
        accountId: debts.accountId,
        instalmentDay: debts.instalmentDay,
        termMonths: debts.termMonths,
        paidMonths: debts.paidMonths,
        kind: debts.kind,
        personId: debts.personId,
        personName: householdPeople.displayName,
        // Los últimos cuatro viven en la cuenta que lleva la tarjeta, que es
        // donde se concilia. Nulo en lo que no es tarjeta.
        maskedNumber: accounts.maskedNumber,
      })
      .from(debts)
      .leftJoin(householdPeople, eq(householdPeople.id, debts.personId))
      .leftJoin(accounts, eq(accounts.id, debts.accountId))
      .where(and(eq(debts.householdId, householdId), isNull(debts.deletedAt)))
      // The most expensive debt first: the ordering the product argues for on
      // every other screen, so the list does not contradict the plan.
      .orderBy(desc(debts.apr)),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    currentBalance: Money.fromDecimalString(row.currentBalance, currency),
    principal: Money.fromDecimalString(row.principal, currency),
    apr: row.apr,
    minimumPayment: Money.fromDecimalString(row.minimumPayment, currency),
    dueDay: row.dueDay,
    statementDay: row.statementDay,
    creditLimit: row.creditLimit ? Money.fromDecimalString(row.creditLimit, currency) : null,
    accountId: row.accountId,
    maskedNumber: row.maskedNumber,
    instalmentDay: row.instalmentDay,
    termMonths: row.termMonths,
    paidMonths: row.paidMonths,
    kind: row.kind,
    personId: row.personId,
    personName: row.personName,
  }));
}

export async function loadDebt(
  session: Session,
  householdId: string,
  debtId: string,
  currency: CurrencyCode,
): Promise<DebtView | null> {
  const all = await loadDebts(session, householdId, currency);
  return all.find((debt) => debt.id === debtId) ?? null;
}

export interface GoalView {
  readonly id: string;
  readonly name: string;
  readonly targetAmount: Money;
  readonly currentAmount: Money;
  readonly targetDate: PlainDate | null;
  readonly priority: number;
  readonly status: 'active' | 'reached' | 'paused' | 'abandoned';
  readonly accountId: string | null;
}

export async function loadGoals(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<readonly GoalView[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: goals.id,
        name: goals.name,
        targetAmount: goals.targetAmount,
        currentAmount: goals.currentAmount,
        targetDate: goals.targetDate,
        priority: goals.priority,
        status: goals.status,
        accountId: goals.accountId,
      })
      .from(goals)
      .where(eq(goals.householdId, householdId))
      .orderBy(goals.priority, goals.createdAt),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    targetAmount: Money.fromDecimalString(row.targetAmount, currency),
    currentAmount: Money.fromDecimalString(row.currentAmount, currency),
    targetDate: (row.targetDate as PlainDate | null) ?? null,
    priority: row.priority,
    status: row.status,
    accountId: row.accountId,
  }));
}

export async function loadGoal(
  session: Session,
  householdId: string,
  goalId: string,
  currency: CurrencyCode,
): Promise<GoalView | null> {
  const all = await loadGoals(session, householdId, currency);
  return all.find((goal) => goal.id === goalId) ?? null;
}

export interface CommitmentView {
  readonly id: string;
  readonly name: string;
  readonly expectedAmount: Money;
  readonly dueDate: PlainDate;
  readonly frequency: string | null;
  readonly isEssential: boolean;
  readonly isSettled: boolean;
  readonly categoryId: string | null;
  /**
   * Taken out of a salary before it arrives, rather than paid from an account.
   *
   * Carried on the view instead of filtered out of it, because the two readers
   * want opposite things: a list of what the household owes should show it,
   * and any sum of what claims their *cash* must leave it out.
   */
  readonly isDeductedAtSource: boolean;
  /**
   * Which income this comes out of, whether or not it is taken at source.
   *
   * Separate from `isDeductedAtSource` on purpose: «sale del sueldo de Blei»
   * and «se lo descuentan de la planilla» are different facts, and only the
   * second one changes what claims a balance.
   */
  readonly paidFromSeriesId: string | null;
  /**
   * What paying it late costs, in whichever shape the contract states it.
   *
   * Both shapes are carried rather than reduced to one figure here, because
   * «$25» and «5%» read differently on a screen and the household stated one
   * of them: showing «$45» to somebody whose contract says five percent hides
   * the term they actually agreed to.
   */
  readonly lateFee: Money | null;
  readonly lateFeeRate: string | null;
  readonly lateFeeAfterDays: number | null;
  /**
   * The most recent occurrence the household has recorded as paid.
   *
   * Not the same as `isSettled`, and the difference is the whole point. A
   * recurring commitment that is paid gets rolled on to its next occurrence, so
   * asking «is this one settled» about the row's *current* date will always say
   * no — the payment lives one occurrence back. This is what lets the screen
   * say «pagado, el 11 de septiembre» about a commitment that is now showing an
   * October date, instead of showing nothing and looking like the payment was
   * lost.
   */
  readonly lastPaidDueOn: PlainDate | null;
  /** When the household recorded it, which is not always when it fell due. */
  readonly lastPaidOn: PlainDate | null;
}

export async function loadCommitments(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<readonly CommitmentView[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: obligations.id,
        name: obligations.name,
        expectedAmount: obligations.expectedAmount,
        dueDate: obligations.dueDate,
        frequency: obligations.frequency,
        isEssential: obligations.isEssential,
        settledTransactionId: obligations.settledTransactionId,
        categoryId: obligations.categoryId,
        isDeductedAtSource: obligations.isDeductedAtSource,
        paidFromSeriesId: obligations.paidFromSeriesId,
        lateFeeAmount: obligations.lateFeeAmount,
        lateFeeRate: obligations.lateFeeRate,
        lateFeeAfterDays: obligations.lateFeeAfterDays,
        // The latest recorded payment, by correlated subquery rather than a
        // join: a join would multiply the commitment by its whole payment
        // history and every total on the screen would count it that many times.
        lastPaidDueOn: sql<string | null>`(
          select max(s.due_on)
            from app.commitment_settlements s
           where s.obligation_id = ${obligations.id}
        )`,
        lastPaidOn: sql<string | null>`(
          select s.settled_on
            from app.commitment_settlements s
           where s.obligation_id = ${obligations.id}
           order by s.due_on desc
           limit 1
        )`,
      })
      .from(obligations)
      .where(and(eq(obligations.householdId, householdId), isNull(obligations.deletedAt)))
      .orderBy(obligations.dueDate),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    expectedAmount: Money.fromDecimalString(row.expectedAmount, currency),
    dueDate: row.dueDate as PlainDate,
    frequency: row.frequency,
    isEssential: row.isEssential,
    isSettled: row.settledTransactionId !== null,
    categoryId: row.categoryId,
    isDeductedAtSource: row.isDeductedAtSource,
    paidFromSeriesId: row.paidFromSeriesId,
    lateFee:
      row.lateFeeAmount === null ? null : Money.fromDecimalString(row.lateFeeAmount, currency),
    lateFeeRate: row.lateFeeRate,
    lateFeeAfterDays: row.lateFeeAfterDays,
    lastPaidDueOn: (row.lastPaidDueOn as PlainDate | null) ?? null,
    lastPaidOn: (row.lastPaidOn as PlainDate | null) ?? null,
  }));
}

export interface CategoryView {
  readonly id: string;
  readonly name: string;
  readonly kind: 'income' | 'expense' | 'transfer' | 'investment';
  readonly parentId: string | null;
  readonly isSystem: boolean;
  readonly isArchived: boolean;
  readonly sortOrder: number;
  /** How many movements are filed here. A category in use cannot be removed. */
  readonly transactionCount: number;
  /** Depth in the tree, so the list can indent instead of nesting markup. */
  readonly depth: number;
}

/**
 * The category tree, flattened into the order a person reads it.
 *
 * Parents first, each followed by its own children. The database has no opinion
 * about display order beyond `sort_order` within a level, so the ordering is
 * done here rather than in SQL — a recursive query would return the same rows
 * and be harder to change the day a third level appears.
 */
export async function loadCategories(
  session: Session,
  householdId: string,
): Promise<readonly CategoryView[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: categories.id,
        name: categories.name,
        kind: categories.kind,
        parentId: categories.parentId,
        isSystem: categories.isSystem,
        archivedAt: categories.archivedAt,
        sortOrder: categories.sortOrder,
        transactionCount: sql<number>`(
          select count(*)::int from app.transactions t
          where t.category_id = ${categories.id} and t.deleted_at is null
        )`,
      })
      .from(categories)
      .where(eq(categories.householdId, householdId))
      .orderBy(categories.sortOrder, categories.name),
  );

  const byParent = new Map<string | null, typeof rows>();
  for (const row of rows) {
    const key = row.parentId;
    const bucket = byParent.get(key) ?? [];
    bucket.push(row);
    byParent.set(key, bucket);
  }

  const ordered: CategoryView[] = [];

  const walk = (parentId: string | null, depth: number): void => {
    for (const row of byParent.get(parentId) ?? []) {
      ordered.push({
        id: row.id,
        name: row.name,
        kind: row.kind,
        parentId: row.parentId,
        isSystem: row.isSystem,
        isArchived: row.archivedAt !== null,
        sortOrder: row.sortOrder,
        transactionCount: row.transactionCount,
        depth,
      });
      // Two levels is what the template ships and what the forms offer. A
      // deeper tree would still render; it simply indents further.
      walk(row.id, depth + 1);
    }
  };

  walk(null, 0);

  // A row whose parent was archived out from under it would vanish from the
  // walk entirely. Anything unvisited is appended rather than lost.
  if (ordered.length < rows.length) {
    const seen = new Set(ordered.map((entry) => entry.id));
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      ordered.push({
        id: row.id,
        name: row.name,
        kind: row.kind,
        parentId: row.parentId,
        isSystem: row.isSystem,
        isArchived: row.archivedAt !== null,
        sortOrder: row.sortOrder,
        transactionCount: row.transactionCount,
        depth: 0,
      });
    }
  }

  return ordered;
}

export interface PersonView {
  readonly id: string;
  readonly displayName: string;
  readonly relationship: string;
  readonly isDependent: boolean;
  readonly birthYear: number | null;
  readonly notes: string | null;
  /** The email they sign in with, when this person also has an account. */
  readonly memberEmail: string | null;
}

export async function loadPeople(
  session: Session,
  householdId: string,
): Promise<readonly PersonView[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: householdPeople.id,
        displayName: householdPeople.displayName,
        relationship: householdPeople.relationship,
        isDependent: householdPeople.isDependent,
        birthYear: householdPeople.birthYear,
        notes: householdPeople.notes,
        memberEmail: profiles.email,
      })
      .from(householdPeople)
      .leftJoin(householdMembers, eq(householdMembers.id, householdPeople.memberId))
      .leftJoin(profiles, eq(profiles.id, householdMembers.userId))
      .where(and(eq(householdPeople.householdId, householdId), isNull(householdPeople.deletedAt)))
      // Earners before dependents, then alphabetical: the order a person would
      // write the list in themselves.
      .orderBy(asc(householdPeople.isDependent), householdPeople.displayName),
  );

  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    relationship: row.relationship,
    isDependent: row.isDependent,
    birthYear: row.birthYear,
    notes: row.notes,
    memberEmail: row.memberEmail,
  }));
}

export interface SettingsView {
  readonly householdName: string;
  readonly bufferMinimum: Money;
  readonly debtStrategy: 'avalanche' | 'snowball' | 'custom' | 'hybrid';
  readonly taxReserveRate: string | null;
  readonly memberCount: number | null;
  readonly dependentCount: number | null;
  readonly baseCurrency: string;
  readonly timeZone: string;
  readonly onboardingCompletedAt: Date | null;
  /** How many people are actually recorded, against the stated count. */
  readonly recordedPeople: number;
}

export async function loadSettings(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<SettingsView> {
  return queryAsUser(session, async (tx) => {
    const [settings] = await tx
      .select()
      .from(householdSettings)
      .where(eq(householdSettings.householdId, householdId))
      .limit(1);

    const [people] = await tx
      .select({ total: count() })
      .from(householdPeople)
      .where(and(eq(householdPeople.householdId, householdId), isNull(householdPeople.deletedAt)));

    const household = session.households.find((entry) => entry.id === householdId);

    return {
      householdName: household?.name ?? '',
      bufferMinimum: Money.fromDecimalString(settings?.bufferMinimum ?? '0', currency),
      debtStrategy: settings?.debtStrategy ?? 'avalanche',
      taxReserveRate: settings?.taxReserveRate ?? null,
      memberCount: settings?.memberCount ?? null,
      dependentCount: settings?.dependentCount ?? null,
      baseCurrency: household?.baseCurrency.trim() ?? currency,
      timeZone: 'America/Panama',
      onboardingCompletedAt: settings?.onboardingCompletedAt ?? null,
      recordedPeople: people?.total ?? 0,
    };
  });
}

/** Accounts an expense or a commitment can be filed against. */
/**
 * The accounts a statement can be filed against — with whose they are.
 *
 * The name alone was not enough the moment a household held more than one
 * card. «Visa» and «Visa» are two rows in a select and one wrong import, and
 * filing a statement against the wrong account is worse than not filing it: it
 * puts somebody else's spending into your ledger and both accounts are then
 * wrong. The type and the person's name travel so the choice can be made
 * without guessing.
 */
export async function loadAccountOptions(
  session: Session,
  householdId: string,
): Promise<
  readonly { id: string; name: string; type: string; personName: string | null }[]
> {
  return queryAsUser(session, (tx) =>
    tx
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.accountType,
        personName: householdPeople.displayName,
      })
      .from(accounts)
      .leftJoin(householdPeople, eq(householdPeople.id, accounts.personId))
      .where(
        and(
          eq(accounts.householdId, householdId),
          eq(accounts.status, 'active'),
          isNull(accounts.deletedAt),
        ),
      )
      .orderBy(accounts.name),
  );
}

/** How much has actually been spent against a goal's account, if it has one. */
export async function loadGoalContributions(
  session: Session,
  householdId: string,
  accountId: string,
  currency: CurrencyCode,
): Promise<Money> {
  const [row] = await queryAsUser(session, (tx) =>
    tx
      .select({
        // The column already carries the sign — an outflow is stored
        // negative — so the net movement is the plain sum. Re-signing it here
        // would count every withdrawal as a contribution.
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.accountId, accountId),
          isNull(transactions.deletedAt),
        ),
      ),
  );

  return Money.fromDecimalString(row?.total ?? '0', currency);
}

export interface RuleView {
  readonly id: string;
  readonly name: string;
  readonly explanation: string;
  readonly priority: number;
  readonly isActive: boolean;
  readonly effectiveFrom: PlainDate | null;
  readonly effectiveTo: PlainDate | null;
  /** The stored condition, as the builder wrote it. */
  readonly fact: string;
  readonly operator: string;
  readonly value: string;
  readonly actionType: string;
  readonly target: string;
  readonly actionValue: string;
}

/**
 * The household's rules, flattened back into the shape the builder edits.
 *
 * A stored rule is a condition tree and a list of actions, because the engine's
 * language allows both. The builder writes one comparison and one action, which
 * is what a household actually needs, and this reads a rule back only as far as
 * that shape goes. A rule written by hand with a nested condition still runs —
 * it simply cannot be round-tripped through the form, and the screen says so
 * rather than silently flattening it.
 */
export async function loadRules(
  session: Session,
  householdId: string,
): Promise<readonly RuleView[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select()
      .from(rules)
      .where(and(eq(rules.householdId, householdId), isNull(rules.deletedAt)))
      .orderBy(rules.priority, rules.createdAt),
  );

  return rows.map((row) => {
    const condition = row.conditions as {
      type?: string;
      fact?: string;
      operator?: string;
      value?: { kind?: string; amount?: string; value?: unknown; values?: unknown[] };
    };

    const actions = Array.isArray(row.actions) ? row.actions : [];
    const action = (actions[0] ?? {}) as {
      type?: string;
      target?: string;
      percent?: string;
      amount?: string;
      priority?: string;
    };

    return {
      id: row.id,
      name: row.name,
      explanation: row.explanation,
      priority: row.priority,
      isActive: row.isActive,
      effectiveFrom: (row.effectiveFrom as PlainDate | null) ?? null,
      effectiveTo: (row.effectiveTo as PlainDate | null) ?? null,
      fact: condition.fact ?? '',
      operator: condition.operator ?? 'gte',
      value: literalText(condition.value),
      actionType: action.type ?? 'allocate_percentage',
      target: action.target ?? '',
      actionValue: action.percent ?? action.amount ?? action.priority ?? '',
    };
  });
}

/** A stored literal, back as the single line the form collects it on. */
function literalText(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '';

  const literal = value as { amount?: unknown; value?: unknown; values?: unknown[] };

  if (typeof literal.amount === 'string') return literal.amount;
  if (Array.isArray(literal.values)) return literal.values.map(scalarText).join(', ');

  return scalarText(literal.value);
}

/** A stored scalar as a person typed it. Anything else is not a literal. */
function scalarText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * Los bancos de la lista, para poder decir cuál emite una tarjeta.
 *
 * Dato de referencia, compartido por todos los hogares: leerlo no necesita la
 * sesión de nadie. Es lo que permite casar una tarjeta con lo que su emisor
 * publicó, sin depender de cómo esté escrito el nombre en el campo libre.
 */
export async function loadInstitutions(): Promise<
  readonly { readonly id: string; readonly name: string }[]
> {
  return getPlatformDb(getServerEnv().DATABASE_URL)
    .select({ id: institutions.id, name: institutions.name })
    .from(institutions)
    .orderBy(asc(institutions.name));
}
