import { createDateRange, Money, toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { computeBudgetState, suggestBudget } from './budget.js';
import { computeSafeToSpend, estimateRunwayMonths } from './safe-to-spend.js';
import type { BudgetLineInput, UpcomingObligation } from './types.js';

const usd = (value: string): Money => Money.fromDecimalString(value, 'USD');
const TODAY = toPlainDate('2026-07-10');

function obligation(
  name: string,
  due: string,
  value: string,
  isEssential = true,
): UpcomingObligation {
  return { id: name, name, due: toPlainDate(due), amount: usd(value), isEssential };
}

describe('safe to spend', () => {
  it('is never the account balance', () => {
    // The single most common way personal finance software misleads people.
    const result = computeSafeToSpend({
      currency: 'USD',
      today: TODAY,
      liquid: usd('4180.00'),
      obligations: [obligation('Rent', '2026-08-01', '900.00')],
      minimumDebtPayments: usd('185.00'),
      taxReserve: usd('420.00'),
      bufferMinimum: usd('500.00'),
    });

    expect(result.safeToSpend.toCurrencyString()).toBe('2175.00');
    expect(result.safeToSpend.lessThan(result.liquid)).toBe(true);
  });

  it('subtracts the whole ladder in order', () => {
    const result = computeSafeToSpend({
      currency: 'USD',
      today: TODAY,
      liquid: usd('3000.00'),
      committedSpending: usd('200.00'),
      obligations: [obligation('Rent', '2026-07-25', '900.00')],
      minimumDebtPayments: usd('185.00'),
      taxReserve: usd('300.00'),
      goalAllocations: usd('150.00'),
      bufferMinimum: usd('500.00'),
    });

    expect(result.deductions.map((deduction) => deduction.kind)).toEqual([
      'committed',
      'obligations',
      'debt_minimums',
      'tax_reserve',
      'goals',
      'buffer',
    ]);
    expect(result.totalClaimed.toCurrencyString()).toBe('2235.00');
    expect(result.safeToSpend.toCurrencyString()).toBe('765.00');
    expect(result.isShortfall).toBe(false);
  });

  it('reports a negative figure rather than a floor of zero', () => {
    // A negative safe-to-spend is the most important thing the system can say.
    const result = computeSafeToSpend({
      currency: 'USD',
      today: TODAY,
      liquid: usd('600.00'),
      obligations: [obligation('Rent', '2026-07-25', '900.00')],
      minimumDebtPayments: usd('185.00'),
    });

    expect(result.safeToSpend.isNegative()).toBe(true);
    expect(result.safeToSpend.toCurrencyString()).toBe('-485.00');
  });

  it('says which claim is unfunded, not just that money is short', () => {
    const result = computeSafeToSpend({
      currency: 'USD',
      today: TODAY,
      liquid: usd('1000.00'),
      obligations: [obligation('Rent', '2026-07-25', '900.00')],
      minimumDebtPayments: usd('185.00'),
      taxReserve: usd('300.00'),
    });

    const debt = result.deductions.find((deduction) => deduction.kind === 'debt_minimums');
    const tax = result.deductions.find((deduction) => deduction.kind === 'tax_reserve');

    expect(debt?.covered.toCurrencyString()).toBe('100.00');
    expect(debt?.uncovered.toCurrencyString()).toBe('85.00');
    expect(tax?.covered.toCurrencyString()).toBe('0.00');
    expect(result.isShortfall).toBe(true);
    expect(result.shortfall.toCurrencyString()).toBe('385.00');
  });

  it('funds the essentials before the discretionary claims', () => {
    const result = computeSafeToSpend({
      currency: 'USD',
      today: TODAY,
      liquid: usd('1000.00'),
      obligations: [
        obligation('Streaming', '2026-07-12', '15.00', false),
        obligation('Rent', '2026-07-25', '900.00', true),
      ],
    });

    expect(result.countedObligations[0]?.name).toBe('Rent');
  });

  it('ignores an obligation beyond the horizon', () => {
    const result = computeSafeToSpend({
      currency: 'USD',
      today: TODAY,
      liquid: usd('1000.00'),
      obligations: [obligation('Insurance', '2026-11-01', '640.00')],
    });

    expect(result.countedObligations).toHaveLength(0);
    expect(result.safeToSpend.toCurrencyString()).toBe('1000.00');
  });
});

describe('runway', () => {
  it('reports months to one decimal', () => {
    expect(estimateRunwayMonths(usd('9400.00'), usd('2000.00'))).toBe(4.7);
  });

  it('declines to answer when there is no burn', () => {
    // "Your runway is forever" is not a useful answer.
    expect(estimateRunwayMonths(usd('9400.00'), usd('0'))).toBeNull();
  });

  it('is zero when there is nothing left', () => {
    expect(estimateRunwayMonths(usd('-40.00'), usd('2000.00'))).toBe(0);
  });
});

describe('budget state', () => {
  const period = createDateRange(toPlainDate('2026-07-01'), toPlainDate('2026-07-31'));

  function line(id: string, categoryId: string, planned: string): BudgetLineInput {
    return { id, categoryId, planned: usd(planned) };
  }

  it('keeps committed money out of remaining', () => {
    // $200 left with a $180 bill due on the 28th is $20 left, not $200.
    const state = computeBudgetState({
      currency: 'USD',
      period,
      today: TODAY,
      lines: [line('l1', 'groceries', '600.00')],
      spentByCategory: new Map([['groceries', usd('400.00')]]),
      committedByCategory: new Map([['groceries', usd('180.00')]]),
    });

    expect(state.lines[0]?.remaining.toCurrencyString()).toBe('20.00');
    expect(state.lines[0]?.isOverspent).toBe(false);
  });

  it('warns on the pace before the line actually breaks', () => {
    const state = computeBudgetState({
      currency: 'USD',
      period,
      today: TODAY,
      lines: [line('l1', 'groceries', '600.00')],
      spentByCategory: new Map([['groceries', usd('400.00')]]),
    });

    // Ten days in, $400 spent: the month lands well past $600.
    expect(state.lines[0]?.isOverspent).toBe(false);
    expect(state.lines[0]?.isProjectedOver).toBe(true);
    expect(state.lines[0]?.projected.greaterThan(usd('1000.00'))).toBe(true);
  });

  it('does not extrapolate an absurd projection from one early charge', () => {
    // Two days into the month with rent posted, naive pacing predicts $13,950.
    // An alert that absurd teaches people to dismiss the ones that are real.
    const state = computeBudgetState({
      currency: 'USD',
      period,
      today: toPlainDate('2026-07-02'),
      lines: [line('l1', 'housing', '900.00')],
      spentByCategory: new Map([['housing', usd('900.00')]]),
    });

    expect(state.lines[0]?.projected.toCurrencyString()).toBe('900.00');
    expect(state.lines[0]?.isProjectedOver).toBe(false);
  });

  it('stops extrapolating once the period has closed', () => {
    const state = computeBudgetState({
      currency: 'USD',
      period,
      today: toPlainDate('2026-08-05'),
      lines: [line('l1', 'groceries', '600.00')],
      spentByCategory: new Map([['groceries', usd('540.00')]]),
    });

    expect(state.lines[0]?.projected.toCurrencyString()).toBe('540.00');
    expect(state.lines[0]?.isProjectedOver).toBe(false);
  });

  it('carries a rollover into the line it belongs to', () => {
    const state = computeBudgetState({
      currency: 'USD',
      period,
      today: TODAY,
      lines: [
        { id: 'l1', categoryId: 'groceries', planned: usd('600.00'), rolloverIn: usd('75.00') },
      ],
      spentByCategory: new Map([['groceries', usd('650.00')]]),
    });

    expect(state.lines[0]?.remaining.toCurrencyString()).toBe('25.00');
    expect(state.planned.toCurrencyString()).toBe('675.00');
  });
});

describe('a budget built from what the household actually spends', () => {
  it('uses the median so one unusual month does not set the year', () => {
    const suggestions = suggestBudget(
      new Map([['groceries', [usd('420.00'), usd('435.00'), usd('410.00'), usd('1180.00')]]]),
    );

    expect(suggestions[0]?.suggested.toCurrencyString()).toBe('427.50');
    expect(suggestions[0]?.monthsObserved).toBe(4);
  });

  it('suggests nothing from too little history', () => {
    const suggestions = suggestBudget(new Map([['groceries', [usd('420.00'), usd('435.00')]]]));

    expect(suggestions).toHaveLength(0);
  });
});
