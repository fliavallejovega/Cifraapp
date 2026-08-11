import { Money, type PlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { buildCloseChecklist, isWithinClosedPeriod } from './close.js';
import { incomeStatementToCsv, toCsv, transactionsToCsv } from './export.js';
import { emergencyMonths, healthScore } from './health.js';
import { reconcile } from './reconciliation.js';
import { cashFlow, incomeStatement, netWorth, operatingStatement } from './statements.js';
import type { AccountRow, ReportPeriod, TransactionRow } from './types.js';

const usd = (value: string) => Money.fromDecimalString(value, 'USD');

const PERIOD: ReportPeriod = {
  start: '2026-07-01' as PlainDate,
  end: '2026-07-31' as PlainDate,
};

function row(
  overrides: Partial<TransactionRow> & Pick<TransactionRow, 'id' | 'amount'>,
): TransactionRow {
  return {
    date: '2026-07-15' as PlainDate,
    accountId: 'checking',
    categorySlug: 'groceries',
    categoryLabel: 'Groceries',
    isTransfer: false,
    merchant: null,
    deductibleAmount: null,
    ...overrides,
  };
}

const SALARY = row({
  id: 't1',
  amount: usd('3200.00'),
  categorySlug: 'income-salary',
  categoryLabel: 'Salary',
});
const GROCERIES = row({ id: 't2', amount: usd('-420.50') });
const RENT = row({
  id: 't3',
  amount: usd('-1200.00'),
  categorySlug: 'housing-rent',
  categoryLabel: 'Rent',
});
const CARD_PAYMENT = row({
  id: 't4',
  amount: usd('-800.00'),
  categorySlug: 'transfers-card-payment',
  categoryLabel: 'Card payment',
  isTransfer: true,
});

describe('income statement', () => {
  const statement = incomeStatement([SALARY, GROCERIES, RENT, CARD_PAYMENT], PERIOD, 'USD');

  it('leaves a credit card payment out of spending', () => {
    // The failure this guards: counting the payment double-counts every purchase
    // already on the card and makes a disciplined month look catastrophic.
    expect(statement.expenses.toDecimalString()).toBe('1620.5000');
    expect(statement.transfersExcluded).toBe(1);
  });

  it('reports expenses positive so nobody subtracts them twice', () => {
    expect(statement.expenses.isPositive()).toBe(true);
    expect(statement.net.toDecimalString()).toBe('1579.5000');
  });

  it('orders lines with the largest first', () => {
    expect(statement.expenseLines.map((line) => line.key)).toEqual(['housing-rent', 'groceries']);
  });

  it('counts the rows behind every line', () => {
    const groceries = statement.expenseLines.find((line) => line.key === 'groceries');
    expect(groceries?.count).toBe(1);
  });

  it('ignores rows outside the period', () => {
    const earlier = row({ id: 't5', amount: usd('-99.00'), date: '2026-06-30' as PlainDate });
    const statementWith = incomeStatement([GROCERIES, earlier], PERIOD, 'USD');

    expect(statementWith.expenses.toDecimalString()).toBe('420.5000');
  });

  it('groups anything uncategorized rather than dropping it', () => {
    const orphan = row({
      id: 't6',
      amount: usd('-30.00'),
      categorySlug: null,
      categoryLabel: null,
    });
    const statementWith = incomeStatement([orphan], PERIOD, 'USD');

    expect(statementWith.expenseLines[0]?.key).toBe('uncategorized');
  });
});

describe('net worth', () => {
  const accounts: AccountRow[] = [
    { id: 'a1', name: 'Checking', type: 'checking', balance: usd('4180.00'), isLiability: false },
    { id: 'a2', name: 'Savings', type: 'savings', balance: usd('9000.00'), isLiability: false },
    { id: 'a3', name: 'Visa', type: 'credit_card', balance: usd('2350.00'), isLiability: true },
  ];

  it('subtracts what is owed exactly once', () => {
    const statement = netWorth(accounts, '2026-07-31' as PlainDate, 'USD');

    expect(statement.assets.toDecimalString()).toBe('13180.0000');
    expect(statement.liabilities.toDecimalString()).toBe('2350.0000');
    expect(statement.netWorth.toDecimalString()).toBe('10830.0000');
  });

  it('handles a liability stored with either sign', () => {
    const negative = accounts.map((account) =>
      account.isLiability ? { ...account, balance: usd('-2350.00') } : account,
    );

    expect(netWorth(negative, '2026-07-31' as PlainDate, 'USD').netWorth.toDecimalString()).toBe(
      '10830.0000',
    );
  });
});

describe('cash flow', () => {
  it('reports internal movement without netting it into spending', () => {
    const inbound = row({ id: 't7', amount: usd('800.00'), isTransfer: true });
    const statement = cashFlow(
      [SALARY, GROCERIES, CARD_PAYMENT, inbound],
      PERIOD,
      usd('1000.00'),
      'USD',
    );

    expect(statement.inflows.toDecimalString()).toBe('3200.0000');
    expect(statement.outflows.toDecimalString()).toBe('420.5000');
    expect(statement.internalMovement.toDecimalString()).toBe('800.0000');
    expect(statement.closing.toDecimalString()).toBe('3779.5000');
  });
});

describe('operating statement', () => {
  it('counts only what a person confirmed as deductible', () => {
    const software = row({
      id: 't8',
      amount: usd('-60.00'),
      categorySlug: 'business-software',
      categoryLabel: 'Software',
      deductibleAmount: usd('60.00'),
    });
    const unconfirmed = row({
      id: 't9',
      amount: usd('-45.00'),
      categorySlug: 'business-services',
      categoryLabel: 'Services',
      deductibleAmount: null,
    });

    const statement = operatingStatement([SALARY, software, unconfirmed], PERIOD, 'USD');

    expect(statement.revenue.toDecimalString()).toBe('3200.0000');
    expect(statement.operatingExpenses.toDecimalString()).toBe('105.0000');
    expect(statement.deductibleExpenses.toDecimalString()).toBe('60.0000');
    expect(statement.basis).toBe('cash');
  });

  it('separates cost of sales from operating expenses', () => {
    const supplies = row({
      id: 't10',
      amount: usd('-300.00'),
      categorySlug: 'business-supplies',
      categoryLabel: 'Supplies',
    });

    const statement = operatingStatement([SALARY, supplies, GROCERIES], PERIOD, 'USD');

    expect(statement.costOfSales.toDecimalString()).toBe('300.0000');
    expect(statement.grossProfit.toDecimalString()).toBe('2900.0000');
    expect(statement.operatingIncome.toDecimalString()).toBe('2479.5000');
  });
});

describe('reconciliation', () => {
  it('agrees when the two figures match', () => {
    const result = reconcile({
      accountId: 'a1',
      statementBalance: usd('4180.00'),
      systemBalance: usd('4180.00'),
      unmatched: [],
      currency: 'USD',
    });

    expect(result.isReconciled).toBe(true);
    expect(result.candidates).toEqual([]);
  });

  it('names the single transaction that explains a gap', () => {
    const result = reconcile({
      accountId: 'a1',
      statementBalance: usd('3759.50'),
      systemBalance: usd('4180.00'),
      unmatched: [GROCERIES, RENT],
      currency: 'USD',
    });

    expect(result.difference.toDecimalString()).toBe('-420.5000');
    expect(result.candidates[0]?.key).toBe('reconcile.singleTransaction');
    expect(result.candidates[0]?.transactionIds).toEqual(['t2']);
  });

  it('finds a pair when no single row fits', () => {
    const result = reconcile({
      accountId: 'a1',
      statementBalance: usd('2559.50'),
      systemBalance: usd('4180.00'),
      unmatched: [GROCERIES, RENT],
      currency: 'USD',
    });

    expect(result.candidates[0]?.key).toBe('reconcile.transactionPair');
    expect(result.candidates[0]?.transactionIds).toEqual(['t2', 't3']);
  });

  it('says so rather than inventing an explanation', () => {
    const result = reconcile({
      accountId: 'a1',
      statementBalance: usd('4000.00'),
      systemBalance: usd('4180.00'),
      unmatched: [GROCERIES],
      currency: 'USD',
    });

    expect(result.candidates[0]?.key).toBe('reconcile.unexplained');
    // And never adjusts the balance to make the difference disappear.
    expect(result.systemBalance.toDecimalString()).toBe('4180.0000');
  });
});

describe('monthly close', () => {
  it('blocks on uncategorized rows and unresolved duplicates', () => {
    const checklist = buildCloseChecklist(PERIOD, {
      uncategorized: 4,
      duplicates: 0,
      transfers: 2,
      reconciliation: 1,
      recurring_changes: 3,
      tax_classification: 7,
    });

    expect(checklist.mayClose).toBe(false);
    expect(checklist.blocking).toBe(1);
  });

  it('lets a household close over the advisory steps', () => {
    const checklist = buildCloseChecklist(PERIOD, {
      uncategorized: 0,
      duplicates: 0,
      transfers: 2,
      reconciliation: 1,
      recurring_changes: 3,
      tax_classification: 7,
    });

    expect(checklist.mayClose).toBe(true);
  });

  it('knows when a date belongs to a closed month', () => {
    expect(isWithinClosedPeriod('2026-07-15', [PERIOD])).toBe(true);
    expect(isWithinClosedPeriod('2026-08-01', [PERIOD])).toBe(false);
  });
});

describe('health score', () => {
  const full = {
    liquid: usd('12000.00'),
    monthlyExpenses: usd('2000.00'),
    creditUtilization: 0.2,
    punctuality: 1,
    savingsRate: 0.2,
    cashFlowRatio: 0.1,
    goalProgress: 1,
    taxReadiness: 1,
  };

  it('reaches 100 when every component is at its best', () => {
    expect(healthScore(full).score).toBe(100);
    expect(healthScore(full).isPartial).toBe(false);
  });

  it('shows the figure behind every component', () => {
    const emergency = healthScore(full).components.find((c) => c.key === 'emergencyFund');
    expect(emergency?.detail).toBe('6.0');
  });

  it('leaves out a component it has no data for, rather than scoring it zero', () => {
    const partial = healthScore({ ...full, creditUtilization: null, taxReadiness: null });

    expect(partial.components.map((c) => c.key)).not.toContain('debtUtilization');
    expect(partial.isPartial).toBe(true);
    // A household with no debts recorded is not one with the worst debt score.
    expect(partial.score).toBe(100);
  });

  it('falls with utilization rather than off a cliff', () => {
    const at30 = healthScore({ ...full, creditUtilization: 0.3 }).score;
    const at50 = healthScore({ ...full, creditUtilization: 0.5 }).score;
    const at90 = healthScore({ ...full, creditUtilization: 0.9 }).score;

    expect(at30).toBe(100);
    expect(at50).toBeLessThan(at30);
    expect(at90).toBeLessThan(at50);
  });

  it('scores an overspending household at zero on savings, not below', () => {
    const negative = healthScore({ ...full, savingsRate: -0.4 });
    const savings = negative.components.find((c) => c.key === 'savingsRate');

    expect(savings?.score).toBe(0);
    expect(negative.score).toBeGreaterThan(0);
  });

  it('has no opinion when it has nothing at all', () => {
    const empty = healthScore({
      liquid: null,
      monthlyExpenses: null,
      creditUtilization: null,
      punctuality: null,
      savingsRate: null,
      cashFlowRatio: null,
      goalProgress: null,
      taxReadiness: null,
    });

    expect(empty.score).toBe(0);
    expect(empty.components).toEqual([]);
  });

  it('measures the emergency fund in months of real expenses', () => {
    expect(emergencyMonths(usd('6000.00'), usd('2000.00'))).toBe(3);
    expect(emergencyMonths(usd('6000.00'), usd('0'))).toBeNull();
  });
});

describe('export', () => {
  it('quotes a field containing a comma', () => {
    const csv = toCsv([{ name: 'SUPER 99, CDE' }], [{ header: 'name', value: (r) => r.name }]);
    expect(csv).toBe('name\r\n"SUPER 99, CDE"\r\n');
  });

  it('doubles an embedded quote', () => {
    const csv = toCsv([{ name: 'The "Big" One' }], [{ header: 'name', value: (r) => r.name }]);
    expect(csv).toContain('"The ""Big"" One"');
  });

  it('writes amounts as exact decimals, never formatted', () => {
    const csv = transactionsToCsv([GROCERIES]);

    // A spreadsheet reading `$1,234.56` in a numeric column sums it to zero.
    expect(csv).toContain('-420.5000');
    expect(csv).not.toContain('$');
  });

  it('exports a statement by section', () => {
    const csv = incomeStatementToCsv(incomeStatement([SALARY, RENT], PERIOD, 'USD'));

    expect(csv).toContain('income,Salary,3200.0000,1');
    expect(csv).toContain('expense,Rent,1200.0000,1');
  });
});
