import { Money, type CurrencyCode, type PlainDate } from '@app/domain';

import type {
  AccountRow,
  CashFlowStatement,
  IncomeStatement,
  NetWorthStatement,
  OperatingStatement,
  ReportPeriod,
  StatementLine,
  TransactionRow,
} from './types.js';

/**
 * The statements themselves.
 *
 * Every one of them starts by throwing away transfers. That single rule is the
 * difference between a report a household believes and one they stop opening: a
 * credit card payment is not spending, moving savings into checking is not
 * income, and a system that counts either produces numbers a person can prove
 * wrong from memory.
 */

/** Rows inside the period that represent real income or spending. */
export function operational(
  rows: readonly TransactionRow[],
  period: ReportPeriod,
): readonly TransactionRow[] {
  return rows.filter(
    (row) => !row.isTransfer && row.date >= period.start && row.date <= period.end,
  );
}

export function incomeStatement(
  rows: readonly TransactionRow[],
  period: ReportPeriod,
  currency: CurrencyCode,
): IncomeStatement {
  const inPeriod = rows.filter((row) => row.date >= period.start && row.date <= period.end);
  const real = inPeriod.filter((row) => !row.isTransfer);

  const incomeRows = real.filter((row) => row.amount.isPositive());
  const expenseRows = real.filter((row) => row.amount.isNegative());

  const income = Money.sum(
    incomeRows.map((row) => row.amount),
    currency,
  );
  // Reported positive. An expense total shown as a negative number invites the
  // reader to subtract it a second time.
  const expenses = Money.sum(
    expenseRows.map((row) => row.amount.abs()),
    currency,
  );

  return {
    currency,
    period,
    income,
    expenses,
    net: income.subtract(expenses),
    incomeLines: groupByCategory(incomeRows, currency, false),
    expenseLines: groupByCategory(expenseRows, currency, true),
    transfersExcluded: inPeriod.length - real.length,
  };
}

export function netWorth(
  accounts: readonly AccountRow[],
  on: PlainDate,
  currency: CurrencyCode,
): NetWorthStatement {
  const assetAccounts = accounts.filter((account) => !account.isLiability);
  const liabilityAccounts = accounts.filter((account) => account.isLiability);

  const assets = Money.sum(
    assetAccounts.map((account) => account.balance),
    currency,
  );
  // A liability's balance is what is owed, held positive. Net worth subtracts it
  // once, here, rather than relying on every caller to remember the sign.
  const liabilities = Money.sum(
    liabilityAccounts.map((account) => account.balance.abs()),
    currency,
  );

  return {
    currency,
    on,
    assets,
    liabilities,
    netWorth: assets.subtract(liabilities),
    assetLines: accountLines(assetAccounts),
    liabilityLines: accountLines(liabilityAccounts),
  };
}

export function cashFlow(
  rows: readonly TransactionRow[],
  period: ReportPeriod,
  opening: Money,
  currency: CurrencyCode,
): CashFlowStatement {
  const inPeriod = rows.filter((row) => row.date >= period.start && row.date <= period.end);
  const real = inPeriod.filter((row) => !row.isTransfer);

  const inflows = Money.sum(
    real.filter((row) => row.amount.isPositive()).map((row) => row.amount),
    currency,
  );
  const outflows = Money.sum(
    real.filter((row) => row.amount.isNegative()).map((row) => row.amount.abs()),
    currency,
  );

  // Movement between the household's own accounts nets to zero across the
  // household but is reported, because a month with $8,000 moving around inside
  // it is a fact worth seeing rather than an absence.
  const internalMovement = Money.sum(
    inPeriod.filter((row) => row.isTransfer && row.amount.isPositive()).map((row) => row.amount),
    currency,
  );

  const net = inflows.subtract(outflows);

  return {
    currency,
    period,
    opening,
    inflows,
    outflows,
    internalMovement,
    closing: opening.add(net),
    net,
  };
}

/**
 * The independent professional's operating statement, on a cash basis.
 *
 * Cost of sales is separated from operating expenses by category, and both count
 * only what a person confirmed as deductible — an inferred deduction on a
 * statement someone files is the failure mode this whole area is arranged to
 * avoid.
 */
export function operatingStatement(
  rows: readonly TransactionRow[],
  period: ReportPeriod,
  currency: CurrencyCode,
  options: { costOfSalesCategories?: readonly string[] } = {},
): OperatingStatement {
  const costCategories = new Set(options.costOfSalesCategories ?? ['business-supplies']);
  const real = operational(rows, period);

  const revenue = Money.sum(
    real.filter((row) => row.amount.isPositive()).map((row) => row.amount),
    currency,
  );

  const spend = real.filter((row) => row.amount.isNegative());

  const costOfSales = Money.sum(
    spend
      .filter((row) => row.categorySlug && costCategories.has(row.categorySlug))
      .map((row) => row.amount.abs()),
    currency,
  );

  const operatingExpenses = Money.sum(
    spend
      .filter((row) => !row.categorySlug || !costCategories.has(row.categorySlug))
      .map((row) => row.amount.abs()),
    currency,
  );

  const deductibleExpenses = Money.sum(
    spend.map((row) => row.deductibleAmount ?? Money.zero(currency)),
    currency,
  );

  const grossProfit = revenue.subtract(costOfSales);

  return {
    currency,
    period,
    basis: 'cash',
    revenue,
    costOfSales,
    grossProfit,
    operatingExpenses,
    operatingIncome: grossProfit.subtract(operatingExpenses),
    deductibleExpenses,
  };
}

function groupByCategory(
  rows: readonly TransactionRow[],
  currency: CurrencyCode,
  absolute: boolean,
): StatementLine[] {
  const buckets = new Map<string, { label: string; amounts: Money[] }>();

  for (const row of rows) {
    const key = row.categorySlug ?? 'uncategorized';
    const bucket = buckets.get(key) ?? { label: row.categoryLabel ?? key, amounts: [] };
    bucket.amounts.push(absolute ? row.amount.abs() : row.amount);
    buckets.set(key, bucket);
  }

  return (
    [...buckets.entries()]
      .map(([key, bucket]) => ({
        key,
        label: bucket.label,
        amount: Money.sum(bucket.amounts, currency),
        count: bucket.amounts.length,
      }))
      // Largest first: a statement is read from the top, and the line a household
      // needs to see is almost always the biggest one.
      .sort((a, b) => b.amount.compare(a.amount) || a.key.localeCompare(b.key))
  );
}

function accountLines(accounts: readonly AccountRow[]): StatementLine[] {
  return accounts
    .map((account) => ({
      key: account.id,
      label: account.name,
      amount: account.balance.abs(),
      count: 1,
    }))
    .sort((a, b) => b.amount.compare(a.amount) || a.label.localeCompare(b.label));
}
