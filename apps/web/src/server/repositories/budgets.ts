import 'server-only';

import {
  computeBudgetState,
  suggestBudget,
  type BudgetState,
  type BudgetSuggestion,
} from '@app/budget-engine';
import { budgetLines, budgets, categories, obligations, transactions } from '@app/database/schema';
import { endOfMonth, Money, startOfMonth, type CurrencyCode, type PlainDate } from '@app/domain';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * Budgets, on real spending.
 *
 * The engine has been able to compute a budget's state since Phase 7 and had no
 * screen to compute it for. Everything here is the wiring: the planned lines,
 * what was actually spent against each category in the period, and what is due
 * inside it and still unpaid.
 *
 * Committed-but-unpaid is the figure that makes the difference between a budget
 * that helps and one that lies. A household that has spent $300 of a $500
 * grocery line but has the school fee still to come is not $200 clear, and a
 * budget screen that says so is worse than no budget screen.
 */

export interface BudgetSummary {
  readonly id: string;
  readonly name: string;
  readonly period: 'weekly' | 'monthly' | 'annual' | 'sinking';
  readonly startsOn: PlainDate;
  readonly endsOn: PlainDate | null;
  readonly state: BudgetState;
  readonly lineCount: number;
}

export interface BudgetLineView {
  readonly id: string;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly planned: Money;
  readonly rolloverIn: Money;
  readonly spent: Money;
  readonly committed: Money;
  readonly remaining: Money;
  readonly projected: Money;
  readonly isOverspent: boolean;
  readonly isProjectedOver: boolean;
}

export interface BudgetDetail {
  readonly id: string;
  readonly name: string;
  readonly period: 'weekly' | 'monthly' | 'annual' | 'sinking';
  readonly startsOn: PlainDate;
  readonly endsOn: PlainDate | null;
  readonly rollsOver: boolean;
  readonly state: BudgetState;
  readonly lines: readonly BudgetLineView[];
  /** Spending by day, for the shape of the month rather than only its total. */
  readonly dailySpend: readonly { readonly date: PlainDate; readonly amount: Money }[];
}

/** The window a budget covers, from its period and its start. */
function windowOf(
  startsOn: PlainDate,
  endsOn: PlainDate | null,
  period: string,
  today: PlainDate,
): { start: PlainDate; end: PlainDate } {
  if (endsOn) return { start: startsOn, end: endsOn };

  // A monthly budget with no end date is the *current* month, recomputed each
  // time it is read. Anchoring it to the month it was created in would leave a
  // household in November staring at September's spending.
  if (period === 'monthly') {
    return { start: startOfMonth(today), end: endOfMonth(today) };
  }

  return { start: startsOn, end: today };
}

async function spendingFor(
  tx: Parameters<Parameters<typeof queryAsUser<unknown>>[1]>[0],
  householdId: string,
  window: { start: PlainDate; end: PlainDate },
  currency: CurrencyCode,
): Promise<{
  spentByCategory: Map<string, Money>;
  committedByCategory: Map<string, Money>;
  daily: { date: PlainDate; amount: Money }[];
}> {
  const [spendRows, committedRows, dailyRows] = await Promise.all([
    tx
      .select({
        categoryId: transactions.categoryId,
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.direction, 'outflow'),
          // Excluded, duplicate and transfer movements are not spending. This
          // is the one question every report asks, and getting it wrong here
          // makes every budget line wrong at once.
          sql`${transactions.status} in ('posted', 'pending', 'reconciled')`,
          isNull(transactions.deletedAt),
          gte(transactions.transactionDate, window.start),
          lte(transactions.transactionDate, window.end),
        ),
      )
      .groupBy(transactions.categoryId),

    tx
      .select({
        categoryId: obligations.categoryId,
        total: sql<string>`coalesce(sum(${obligations.expectedAmount}), 0)::text`,
      })
      .from(obligations)
      .where(
        and(
          eq(obligations.householdId, householdId),
          isNull(obligations.deletedAt),
          isNull(obligations.settledTransactionId),
          gte(obligations.dueDate, window.start),
          lte(obligations.dueDate, window.end),
        ),
      )
      .groupBy(obligations.categoryId),

    tx
      .select({
        date: transactions.transactionDate,
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.direction, 'outflow'),
          sql`${transactions.status} in ('posted', 'pending', 'reconciled')`,
          isNull(transactions.deletedAt),
          gte(transactions.transactionDate, window.start),
          lte(transactions.transactionDate, window.end),
        ),
      )
      .groupBy(transactions.transactionDate)
      .orderBy(transactions.transactionDate),
  ]);

  const spentByCategory = new Map<string, Money>();
  for (const row of spendRows) {
    if (!row.categoryId) continue;
    spentByCategory.set(row.categoryId, Money.fromDecimalString(row.total, currency).abs());
  }

  const committedByCategory = new Map<string, Money>();
  for (const row of committedRows) {
    if (!row.categoryId) continue;
    committedByCategory.set(row.categoryId, Money.fromDecimalString(row.total, currency).abs());
  }

  return {
    spentByCategory,
    committedByCategory,
    daily: dailyRows.map((row) => ({
      date: row.date as PlainDate,
      amount: Money.fromDecimalString(row.total, currency).abs(),
    })),
  };
}

export async function loadBudgets(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
  today: PlainDate,
): Promise<readonly BudgetSummary[]> {
  return queryAsUser(session, async (tx) => {
    const rows = await tx
      .select()
      .from(budgets)
      .where(and(eq(budgets.householdId, householdId), isNull(budgets.deletedAt)))
      .orderBy(desc(budgets.startsOn));

    if (rows.length === 0) return [];

    // Every line for every budget in one query, and the spending window once.
    // The first version of this asked for the lines of each budget in a loop
    // and then ran three spending queries per budget — four round trips per
    // row, against a database a continent away, on a screen that shows four
    // budgets.
    const allLines = await tx
      .select({
        id: budgetLines.id,
        budgetId: budgetLines.budgetId,
        categoryId: budgetLines.categoryId,
        planned: budgetLines.plannedAmount,
        rolloverIn: budgetLines.rolloverIn,
      })
      .from(budgetLines)
      .where(
        inArray(
          budgetLines.budgetId,
          rows.map((budget) => budget.id),
        ),
      );

    const linesByBudget = new Map<string, typeof allLines>();
    for (const line of allLines) {
      const bucket = linesByBudget.get(line.budgetId) ?? [];
      bucket.push(line);
      linesByBudget.set(line.budgetId, bucket);
    }

    // Budgets almost always share a window — they are nearly all the current
    // month — so spending is fetched once per distinct window rather than once
    // per budget.
    const windows = new Map<string, { start: PlainDate; end: PlainDate }>();
    const windowOfBudget = new Map<string, string>();

    for (const budget of rows) {
      const window = windowOf(
        budget.startsOn as PlainDate,
        (budget.endsOn as PlainDate | null) ?? null,
        budget.period,
        today,
      );
      const key = `${window.start}:${window.end}`;
      windows.set(key, window);
      windowOfBudget.set(budget.id, key);
    }

    const spendingByWindow = new Map<string, Awaited<ReturnType<typeof spendingFor>>>();
    await Promise.all(
      [...windows].map(async ([key, window]) => {
        spendingByWindow.set(key, await spendingFor(tx, householdId, window, currency));
      }),
    );

    return rows.map((budget): BudgetSummary => {
      const key = windowOfBudget.get(budget.id) ?? '';
      const window = windows.get(key) ?? { start: today, end: today };
      const spending = spendingByWindow.get(key);
      const lines = linesByBudget.get(budget.id) ?? [];

      return {
        id: budget.id,
        name: budget.name,
        period: budget.period,
        startsOn: budget.startsOn as PlainDate,
        endsOn: (budget.endsOn as PlainDate | null) ?? null,
        lineCount: lines.length,
        state: computeBudgetState({
          currency,
          period: window,
          today,
          lines: lines.map((line) => ({
            id: line.id,
            categoryId: line.categoryId,
            planned: Money.fromDecimalString(line.planned, currency),
            rolloverIn: Money.fromDecimalString(line.rolloverIn, currency),
          })),
          spentByCategory: spending?.spentByCategory ?? new Map(),
          committedByCategory: spending?.committedByCategory ?? new Map(),
        }),
      };
    });
  });
}

export async function loadBudget(
  session: Session,
  householdId: string,
  budgetId: string,
  currency: CurrencyCode,
  today: PlainDate,
): Promise<BudgetDetail | null> {
  return queryAsUser(session, async (tx) => {
    const [budget] = await tx
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.id, budgetId),
          eq(budgets.householdId, householdId),
          isNull(budgets.deletedAt),
        ),
      )
      .limit(1);

    if (!budget) return null;

    const window = windowOf(
      budget.startsOn as PlainDate,
      (budget.endsOn as PlainDate | null) ?? null,
      budget.period,
      today,
    );

    const lines = await tx
      .select({
        id: budgetLines.id,
        categoryId: budgetLines.categoryId,
        categoryName: categories.name,
        planned: budgetLines.plannedAmount,
        rolloverIn: budgetLines.rolloverIn,
      })
      .from(budgetLines)
      .leftJoin(categories, eq(categories.id, budgetLines.categoryId))
      .where(eq(budgetLines.budgetId, budget.id));

    const spending = await spendingFor(tx, householdId, window, currency);

    const state = computeBudgetState({
      currency,
      period: window,
      today,
      lines: lines.map((line) => ({
        id: line.id,
        categoryId: line.categoryId,
        planned: Money.fromDecimalString(line.planned, currency),
        rolloverIn: Money.fromDecimalString(line.rolloverIn, currency),
      })),
      spentByCategory: spending.spentByCategory,
      committedByCategory: spending.committedByCategory,
    });

    const names = new Map(lines.map((line) => [line.id, line.categoryName]));

    return {
      id: budget.id,
      name: budget.name,
      period: budget.period,
      startsOn: budget.startsOn as PlainDate,
      endsOn: (budget.endsOn as PlainDate | null) ?? null,
      rollsOver: budget.rollsOver,
      state,
      dailySpend: spending.daily,
      lines: state.lines.map((line) => ({
        id: line.id,
        categoryId: line.categoryId,
        categoryName: names.get(line.id) ?? null,
        planned: line.planned,
        rolloverIn: line.rolloverIn,
        spent: line.spent,
        committed: line.committed,
        remaining: line.remaining,
        projected: line.projected,
        isOverspent: line.isOverspent,
        isProjectedOver: line.isProjectedOver,
      })),
    };
  });
}

/**
 * What the household actually spent, month by month, per category.
 *
 * Feeds `suggestBudget`, which is the only honest way to propose a first budget:
 * a figure taken from three months of a household's own spending is a fact
 * about them, and a figure taken from a national average is a fact about
 * somebody else.
 */
export async function loadBudgetSuggestions(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
  today: PlainDate,
): Promise<readonly (BudgetSuggestion & { categoryName: string })[]> {
  return queryAsUser(session, async (tx) => {
    const since = startOfMonth(today);
    const lookback = new Date(`${since}T00:00:00Z`);
    lookback.setUTCMonth(lookback.getUTCMonth() - 6);

    const rows = await tx
      .select({
        categoryId: transactions.categoryId,
        categoryName: categories.name,
        month: sql<string>`to_char(${transactions.transactionDate}, 'YYYY-MM')`,
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,
      })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.direction, 'outflow'),
          sql`${transactions.status} in ('posted', 'pending', 'reconciled')`,
          isNull(transactions.deletedAt),
          gte(transactions.transactionDate, lookback.toISOString().slice(0, 10)),
        ),
      )
      .groupBy(
        transactions.categoryId,
        categories.name,
        sql`to_char(${transactions.transactionDate}, 'YYYY-MM')`,
      );

    const byCategory = new Map<string, { name: string; amounts: Money[] }>();
    for (const row of rows) {
      if (!row.categoryId) continue;
      const bucket = byCategory.get(row.categoryId) ?? {
        name: row.categoryName ?? '',
        amounts: [],
      };
      bucket.amounts.push(Money.fromDecimalString(row.total, currency).abs());
      byCategory.set(row.categoryId, bucket);
    }

    // The engine takes the whole map at once and returns them ordered, so the
    // only thing left to do here is put the category's name back on each one.
    const suggestions = suggestBudget(
      new Map([...byCategory].map(([categoryId, bucket]) => [categoryId, bucket.amounts])),
    );

    return suggestions.map((suggestion) => ({
      ...suggestion,
      categoryName: byCategory.get(suggestion.categoryId)?.name ?? '',
    }));
  });
}
