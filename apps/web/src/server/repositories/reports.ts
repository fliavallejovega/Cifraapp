import 'server-only';

import { accounts, categories, debts, goals, transactions, transfers } from '@app/database/schema';
import {
  Money,
  addMonths,
  endOfMonth,
  startOfMonth,
  todayIn,
  type CurrencyCode,
  type PlainDate,
} from '@app/domain';
import {
  cashFlow,
  healthScore,
  incomeStatement,
  netWorth,
  operatingStatement,
  type AccountRow,
  type CashFlowStatement,
  type HealthScore,
  type IncomeStatement,
  type NetWorthStatement,
  type OperatingStatement,
  type ReportPeriod,
  type TransactionRow,
} from '@app/reporting';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * Statements, from the household's own rows.
 *
 * Everything here is a query and an arithmetic function. Nothing is cached,
 * nothing is stored, and no model is consulted: a statement recomputed from the
 * same rows a year later must come out identical, and the only way to guarantee
 * that is for the rows to be the sole input.
 *
 * The one piece of real work is deciding what a transfer is. Transfers live in
 * their own table, linking the two sides of a movement, and a transaction can
 * also sit under a transfer category. Both are checked, because either alone
 * lets a credit card payment through as spending — and that single mistake
 * double-counts every purchase already on the card.
 */

/** Accounts that represent money owed rather than money held. */
const LIABILITY_TYPES = new Set(['credit_card', 'loan', 'mortgage', 'other_liability']);

export interface ReportView {
  readonly currency: CurrencyCode;
  readonly period: ReportPeriod;
  readonly netWorth: NetWorthStatement;
  readonly income: IncomeStatement;
  readonly cashFlow: CashFlowStatement;
  readonly operating: OperatingStatement;
  readonly health: HealthScore;
  readonly transactions: readonly TransactionRow[];
  /** True when the household has nothing to report on yet. */
  readonly isEmpty: boolean;
}

/** The calendar month containing a date. Reporting periods are months here. */
export function monthPeriod(on: PlainDate): ReportPeriod {
  return { start: startOfMonth(on), end: endOfMonth(on) };
}

export async function loadReport(
  session: Session,
  householdId: string,
  period?: ReportPeriod,
): Promise<ReportView> {
  return queryAsUser(session, async (tx) => {
    const [household] = await tx
      .select({ currency: accounts.currency })
      .from(accounts)
      .where(eq(accounts.householdId, householdId))
      .limit(1);

    const currency = (household?.currency.trim() ?? 'USD') as CurrencyCode;
    const today = todayIn('America/Panama');
    const window = period ?? monthPeriod(today);

    const [accountRows, transactionRows, transferRows, debtRows, goalRows] = await Promise.all([
      tx
        .select({
          id: accounts.id,
          name: accounts.name,
          type: accounts.accountType,
          balance: accounts.currentBalance,
        })
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
          id: transactions.id,
          date: transactions.transactionDate,
          amount: transactions.amount,
          accountId: transactions.accountId,
          description: transactions.descriptionOriginal,
          // The household's category rows carry the template slug they came
          // from; that is what the tax and reporting policies are keyed on.
          categorySlug: categories.templateSlug,
          categoryLabel: categories.name,
          categoryKind: categories.kind,
          taxClassification: transactions.taxClassification,
          businessPercentage: transactions.businessPercentage,
        })
        .from(transactions)
        .leftJoin(categories, eq(categories.id, transactions.categoryId))
        .where(
          and(
            eq(transactions.householdId, householdId),
            isNull(transactions.deletedAt),
            // The opening balance needs the months before this one, so the query
            // reaches back rather than filtering to the window here.
            gte(transactions.transactionDate, startOfMonth(addMonths(window.start, -12))),
            lte(transactions.transactionDate, window.end),
          ),
        )
        .orderBy(transactions.transactionDate),

      tx
        .select({
          from: transfers.fromTransactionId,
          to: transfers.toTransactionId,
        })
        .from(transfers)
        .where(eq(transfers.householdId, householdId)),

      tx
        .select({
          balance: debts.currentBalance,
          limit: debts.creditLimit,
        })
        .from(debts)
        .where(and(eq(debts.householdId, householdId), isNull(debts.deletedAt))),

      tx
        .select({ current: goals.currentAmount, target: goals.targetAmount })
        .from(goals)
        .where(and(eq(goals.householdId, householdId), eq(goals.status, 'active'))),
    ]);

    const transferIds = new Set<string>();
    for (const link of transferRows) {
      transferIds.add(link.from);
      transferIds.add(link.to);
    }

    const rows: TransactionRow[] = transactionRows.map((row) => ({
      id: row.id,
      date: row.date as PlainDate,
      amount: Money.fromDecimalString(row.amount, currency),
      accountId: row.accountId,
      categorySlug: row.categorySlug,
      categoryLabel: row.categoryLabel,
      // Either signal is enough. Neither alone is.
      isTransfer: transferIds.has(row.id) || row.categoryKind === 'transfer',
      merchant: row.description,
      deductibleAmount: confirmedDeduction(row, currency),
    }));

    const accountViews: AccountRow[] = accountRows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      balance: Money.fromDecimalString(row.balance, currency),
      isLiability: LIABILITY_TYPES.has(row.type),
    }));

    const opening = openingBalance(rows, window, currency);
    const income = incomeStatement(rows, window, currency);

    return {
      currency,
      period: window,
      netWorth: netWorth(accountViews, window.end, currency),
      income,
      cashFlow: cashFlow(rows, window, opening, currency),
      operating: operatingStatement(rows, window, currency),
      health: healthScore({
        liquid: liquidBalance(accountViews, currency),
        monthlyExpenses: income.expenses.isPositive() ? income.expenses : null,
        creditUtilization: utilization(debtRows, currency),
        // Not measurable until obligations record whether they were paid on time.
        punctuality: null,
        savingsRate: ratio(income.net, income.income),
        cashFlowRatio: ratio(income.net, income.income),
        goalProgress: goalProgress(goalRows, currency),
        // Null until a published tax rule set exists. See docs/context.md.
        taxReadiness: null,
      }),
      transactions: rows.filter((row) => row.date >= window.start && row.date <= window.end),
      isEmpty: transactionRows.length === 0 && accountRows.length === 0,
    };
  });
}

/**
 * The balance the period opened with.
 *
 * Derived from the rows before it rather than stored, so a correction to an old
 * transaction moves every later opening balance with it. A stored opening
 * balance is the number that silently stops matching its own history.
 */
function openingBalance(
  rows: readonly TransactionRow[],
  period: ReportPeriod,
  currency: CurrencyCode,
): Money {
  return Money.sum(
    rows.filter((row) => row.date < period.start && !row.isTransfer).map((row) => row.amount),
    currency,
  );
}

/**
 * The deductible portion, but only where a person confirmed it.
 *
 * `POTENTIALLY_DEDUCTIBLE` contributes nothing. An inferred deduction on a
 * statement somebody files is the failure this whole area is arranged to avoid.
 */
function confirmedDeduction(
  row: { amount: string; taxClassification: string | null; businessPercentage: string | null },
  currency: CurrencyCode,
): Money | null {
  const amount = Money.fromDecimalString(row.amount, currency).abs();

  if (row.taxClassification === 'BUSINESS') return amount;
  if (row.taxClassification === 'MIXED' && row.businessPercentage) {
    return amount.percentage(row.businessPercentage);
  }

  return null;
}

function liquidBalance(accountViews: readonly AccountRow[], currency: CurrencyCode): Money | null {
  const liquid = accountViews.filter((account) =>
    ['checking', 'savings', 'cash', 'digital_wallet'].includes(account.type),
  );

  return liquid.length === 0
    ? null
    : Money.sum(
        liquid.map((account) => account.balance),
        currency,
      );
}

/** Revolving balance over limit. Null when no limits are recorded — a mortgage has none. */
function utilization(
  rows: readonly { balance: string; limit: string | null }[],
  currency: CurrencyCode,
): number | null {
  const withLimits = rows.filter((row) => row.limit !== null);
  if (withLimits.length === 0) return null;

  const balance = Money.sum(
    withLimits.map((row) => Money.fromDecimalString(row.balance, currency)),
    currency,
  );
  const limit = Money.sum(
    withLimits.map((row) => Money.fromDecimalString(row.limit ?? '0', currency)),
    currency,
  );

  if (!limit.isPositive()) return null;
  return Number((balance.scaledUnits * 10_000n) / limit.scaledUnits) / 10_000;
}

function goalProgress(
  rows: readonly { current: string; target: string }[],
  currency: CurrencyCode,
): number | null {
  if (rows.length === 0) return null;

  const current = Money.sum(
    rows.map((row) => Money.fromDecimalString(row.current, currency)),
    currency,
  );
  const target = Money.sum(
    rows.map((row) => Money.fromDecimalString(row.target, currency)),
    currency,
  );

  if (!target.isPositive()) return null;
  return Number((current.scaledUnits * 10_000n) / target.scaledUnits) / 10_000;
}

function ratio(numerator: Money, denominator: Money): number | null {
  if (!denominator.isPositive()) return null;
  return Number((numerator.scaledUnits * 10_000n) / denominator.scaledUnits) / 10_000;
}
