import type { Debt } from '@app/debt-engine';
import { Money, toPlainDate, type PlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { compare, project } from './project.js';
import { financedPurchase, incomeChange, oneTime, recurringCost, scenario } from './scenarios.js';
import type { Baseline } from './types.js';

const usd = (value: string) => Money.fromDecimalString(value, 'USD');
const JANUARY = toPlainDate('2026-01-01');

function debt(overrides: Partial<Debt> & Pick<Debt, 'id' | 'name'>): Debt {
  return {
    currentBalance: usd('0'),
    apr: '0.000',
    minimumPayment: usd('0'),
    creditLimit: null,
    promotionalApr: null,
    promotionalExpiresOn: null,
    strategyPriority: null,
    ...overrides,
  };
}

const BASELINE: Baseline = {
  currency: 'USD',
  startMonth: JANUARY,
  liquid: usd('5000.00'),
  monthlyIncome: usd('4000.00'),
  monthlyExpenses: usd('3000.00'),
  debts: [],
  goals: [],
};

describe('project', () => {
  it('carries a surplus forward month by month', () => {
    const projection = project(BASELINE, scenario('s', 'Do nothing', 'bonus', [], 3));

    expect(projection.months).toHaveLength(3);
    expect(projection.months[0]?.liquid.toDecimalString()).toBe('6000.0000');
    expect(projection.endingLiquid.toDecimalString()).toBe('8000.0000');
    expect(projection.runwayMonths).toBeNull();
  });

  it('finds the month a household runs out', () => {
    const projection = project(
      BASELINE,
      scenario('s', 'Lost income', 'income_loss', [incomeChange('No salary', usd('-4000.00'))], 6),
    );

    // $5,000 against $3,000 a month: the second month ends short.
    expect(projection.runwayMonths).toBe(1);
    expect(projection.firstShortfallMonth).toBe('2026-02-01' as PlainDate);
    expect(projection.months[1]?.isCashPressure).toBe(true);
  });

  it('ends a temporary change when its duration is up', () => {
    const projection = project(
      BASELINE,
      scenario(
        's',
        'Four months out of work',
        'income_loss',
        [incomeChange('No salary', usd('-4000.00'), { durationMonths: 4 })],
        6,
      ),
    );

    expect(projection.months[3]?.income.toDecimalString()).toBe('0.0000');
    expect(projection.months[4]?.income.toDecimalString()).toBe('4000.0000');
  });

  it('charges interest before the payment, the way a card issuer does', () => {
    const card = debt({
      id: 'visa',
      name: 'Visa',
      currentBalance: usd('1000.00'),
      apr: '24.500',
      minimumPayment: usd('100.00'),
    });

    const projection = project(
      { ...BASELINE, debts: [card] },
      scenario('s', 'Do nothing', 'debt_payoff', [], 1),
    );

    const first = projection.months[0];
    expect(first?.interestAccrued.isPositive()).toBe(true);
    // Opening balance plus a month of interest, less the $100 minimum.
    expect(first?.debtBalance.greaterThan(usd('900.00'))).toBe(true);
    expect(first?.debtPayments.toDecimalString()).toBe('100.0000');
  });

  it('takes on the loan in the month the purchase happens, not before', () => {
    const loan = debt({
      id: 'car-loan',
      name: 'Car loan',
      currentBalance: usd('18000.00'),
      apr: '9.000',
      minimumPayment: usd('380.00'),
    });

    const projection = project(
      BASELINE,
      scenario(
        's',
        'Buy a car',
        'vehicle_purchase',
        [financedPurchase('Car', { downPayment: usd('4000.00'), debt: loan, startsInMonths: 2 })],
        4,
      ),
    );

    expect(projection.months[1]?.debtBalance.isZero()).toBe(true);
    expect(projection.months[2]?.debtBalance.isPositive()).toBe(true);
    // The deposit leaves once, in month three.
    expect(projection.months[2]?.expenses.toDecimalString()).toBe('7000.0000');
    expect(projection.months[3]?.expenses.toDecimalString()).toBe('3000.0000');
  });

  it('moves goal contributions out of liquid without touching net worth', () => {
    const projection = project(
      {
        ...BASELINE,
        goals: [
          {
            id: 'travel',
            name: 'Travel',
            current: usd('0'),
            target: usd('2000.00'),
            monthlyContribution: usd('500.00'),
          },
        ],
      },
      scenario('s', 'Do nothing', 'vacation', [], 2),
    );

    expect(projection.months[0]?.liquid.toDecimalString()).toBe('5500.0000');
    expect(projection.months[0]?.netWorth.toDecimalString()).toBe('6000.0000');
  });

  it('stops contributing once a goal is met', () => {
    const projection = project(
      {
        ...BASELINE,
        goals: [
          {
            id: 'buffer',
            name: 'Buffer',
            current: usd('900.00'),
            target: usd('1000.00'),
            monthlyContribution: usd('500.00'),
          },
        ],
      },
      scenario('s', 'Do nothing', 'bonus', [], 2),
    );

    expect(projection.months[0]?.goalContributions.toDecimalString()).toBe('100.0000');
    expect(projection.months[1]?.goalContributions.toDecimalString()).toBe('0.0000');
  });

  it('refuses a horizon longer than it can defend', () => {
    const projection = project(BASELINE, scenario('s', 'Forever', 'child', [], 10_000));
    expect(projection.months).toHaveLength(600);
  });
});

describe('compare', () => {
  it('prices a decision against doing nothing', () => {
    const comparison = compare(
      BASELINE,
      scenario(
        's',
        'Rent goes up',
        'rent_increase',
        [recurringCost('Rent increase', usd('150.00'), { startsInMonths: 1 })],
        12,
      ),
    );

    // Eleven months of $150.
    expect(comparison.liquidDelta.toDecimalString()).toBe('-1650.0000');
    expect(comparison.debtDelta.isZero()).toBe(true);
    expect(comparison.runwayDeltaMonths).toBeNull();
  });

  it('reports the interest a financed purchase adds', () => {
    const loan = debt({
      id: 'car-loan',
      name: 'Car loan',
      currentBalance: usd('18000.00'),
      apr: '9.000',
      minimumPayment: usd('380.00'),
    });

    const comparison = compare(
      BASELINE,
      scenario(
        's',
        'Buy a car',
        'vehicle_purchase',
        [
          financedPurchase('Car', { downPayment: usd('4000.00'), debt: loan }),
          recurringCost('Insurance', usd('85.00')),
        ],
        24,
      ),
    );

    expect(comparison.interestDelta.isPositive()).toBe(true);
    expect(comparison.netWorthDelta.isNegative()).toBe(true);
  });

  it('leaves a one-off cost out of the following months', () => {
    const comparison = compare(
      BASELINE,
      scenario('s', 'Vacation', 'vacation', [oneTime('Flights', usd('1200.00'), 3)], 6),
    );

    expect(comparison.liquidDelta.toDecimalString()).toBe('-1200.0000');
  });
});
