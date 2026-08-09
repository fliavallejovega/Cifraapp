import { isErr, isOk, Money, toPlainDate, unwrap } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { accrueInterest, effectiveApr, utilization } from './interest.js';
import { comparePlans, simulatePayoff } from './simulate.js';
import { orderDebts, totalMinimums } from './strategy.js';
import type { Debt } from './types.js';

const usd = (value: string): Money => Money.fromDecimalString(value, 'USD');
const START = toPlainDate('2026-08-01');

function debt(overrides: Partial<Debt> & Pick<Debt, 'id' | 'name'>): Debt {
  return {
    currentBalance: usd('1000.00'),
    apr: '24.500',
    minimumPayment: usd('50.00'),
    ...overrides,
  };
}

/** The fixture household from the specification: Visa 18.9%, Mastercard 24.5%. */
const VISA = debt({
  id: 'visa',
  name: 'Visa',
  currentBalance: usd('3200.00'),
  apr: '18.900',
  minimumPayment: usd('96.00'),
  creditLimit: usd('5000.00'),
});

const MASTERCARD = debt({
  id: 'mastercard',
  name: 'Mastercard',
  currentBalance: usd('1800.00'),
  apr: '24.500',
  minimumPayment: usd('54.00'),
  creditLimit: usd('3000.00'),
});

describe('daily interest', () => {
  it('compounds daily rather than dividing the year by twelve', () => {
    // $1,000 at 24.5% for 31 days. Simple monthly division gives $20.42; daily
    // compounding gives more, and a plan built on the smaller figure promises a
    // payoff date the household will not reach.
    const interest = accrueInterest(usd('1000.00'), '24.500', 31);

    expect(interest.greaterThan(usd('20.42'))).toBe(true);
    expect(interest.lessThan(usd('21.50'))).toBe(true);
  });

  it('rounds once at the end, not once per day', () => {
    // Thirty-one roundings to the cent, each biased the same way, is a
    // systematic error — and it lands on the side that flatters the plan.
    let compounded = usd('1000.00');
    for (let day = 0; day < 31; day += 1) {
      compounded = compounded
        .add(accrueInterest(compounded, '24.500', 1).roundToCurrencyPrecision())
        .roundToCurrencyPrecision();
    }

    const once = usd('1000.00').add(accrueInterest(usd('1000.00'), '24.500', 31));

    expect(once.equals(compounded)).toBe(false);
  });

  it('accrues nothing on a zero balance or a zero rate', () => {
    expect(accrueInterest(usd('0'), '24.500', 31).isZero()).toBe(true);
    expect(accrueInterest(usd('1000.00'), '0', 31).isZero()).toBe(true);
    expect(accrueInterest(usd('1000.00'), '24.500', 0).isZero()).toBe(true);
  });

  it('honours a promotional rate until it expires', () => {
    const transferred = debt({
      id: 'balance-transfer',
      name: 'Balance transfer',
      promotionalApr: '0',
      promotionalExpiresOn: toPlainDate('2026-12-31'),
    });

    expect(effectiveApr(transferred, toPlainDate('2026-08-01'))).toBe('0');
    expect(effectiveApr(transferred, toPlainDate('2027-01-01'))).toBe('24.500');
  });
});

describe('utilization', () => {
  it('is the balance against the limit', () => {
    expect(utilization(usd('3200.00'), usd('5000.00'))).toBeCloseTo(0.64, 4);
  });

  it('is nothing at all when there is no limit', () => {
    // A mortgage has no utilization. Reporting it as 0% would make a household's
    // overall figure look better than it is.
    expect(utilization(usd('120000.00'), null)).toBeNull();
  });
});

describe('strategy ordering', () => {
  it('avalanche attacks the highest rate', () => {
    const ordered = orderDebts([VISA, MASTERCARD], 'avalanche', START);

    expect(ordered[0]?.debt.id).toBe('mastercard');
    expect(ordered[0]?.reason).toContain('24.500%');
  });

  it('snowball attacks the smallest balance', () => {
    const ordered = orderDebts([VISA, MASTERCARD], 'snowball', START);

    expect(ordered[0]?.debt.id).toBe('mastercard');
  });

  it('avalanche respects a promotional rate instead of the sticker rate', () => {
    // A 0% transfer treated as 24.5% sends the extra payment at the wrong card
    // for the whole promotional window.
    const transferred = debt({
      id: 'transfer',
      name: 'Transfer',
      currentBalance: usd('4000.00'),
      apr: '26.000',
      promotionalApr: '0',
      promotionalExpiresOn: toPlainDate('2026-12-31'),
    });

    expect(orderDebts([transferred, MASTERCARD], 'avalanche', START)[0]?.debt.id).toBe(
      'mastercard',
    );
    expect(
      orderDebts([transferred, MASTERCARD], 'avalanche', toPlainDate('2027-02-01'))[0]?.debt.id,
    ).toBe('transfer');
  });

  it('custom follows the household order and puts the unranked last', () => {
    const ordered = orderDebts(
      [debt({ id: 'a', name: 'A' }), debt({ id: 'b', name: 'B', strategyPriority: 1 })],
      'custom',
      START,
    );

    expect(ordered.map((entry) => entry.debt.id)).toEqual(['b', 'a']);
  });

  it('hybrid takes a quick win first, then reverts to rate', () => {
    const small = debt({
      id: 'small',
      name: 'Store card',
      currentBalance: usd('300.00'),
      apr: '12.000',
    });
    const ordered = orderDebts([VISA, MASTERCARD, small], 'hybrid', START, {
      extraPayment: usd('200.00'),
    });

    expect(ordered[0]?.debt.id).toBe('small');
    expect(ordered[1]?.debt.id).toBe('mastercard');
  });

  it('is deterministic when two debts are identical', () => {
    const a = debt({ id: 'aaa', name: 'A' });
    const b = debt({ id: 'bbb', name: 'B' });

    expect(orderDebts([a, b], 'avalanche', START).map((entry) => entry.debt.id)).toEqual([
      'aaa',
      'bbb',
    ]);
    expect(orderDebts([b, a], 'avalanche', START).map((entry) => entry.debt.id)).toEqual([
      'aaa',
      'bbb',
    ]);
  });
});

describe('payoff simulation', () => {
  it('refuses a payment below the minimums, without throwing', () => {
    const result = simulatePayoff({
      debts: [VISA, MASTERCARD],
      strategy: 'avalanche',
      monthlyPayment: usd('120.00'),
      from: START,
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe('below_minimums');
      if (result.error.kind === 'below_minimums') {
        expect(result.error.required.toCurrencyString()).toBe('150.00');
      }
    }
  });

  it('clears both cards and reports when', () => {
    const plan = unwrap(
      simulatePayoff({
        debts: [VISA, MASTERCARD],
        strategy: 'avalanche',
        monthlyPayment: usd('600.00'),
        from: START,
      }),
    );

    expect(plan.unresolvedDebtIds).toEqual([]);
    expect(plan.monthsToDebtFree).toBeGreaterThan(0);
    expect(plan.monthsToDebtFree).toBeLessThan(15);
    expect(plan.debtFreeOn).not.toBeNull();
    expect(plan.outcomes.every((outcome) => outcome.payoffDate !== null)).toBe(true);
  });

  it('leaves every balance at zero when it says the household is debt free', () => {
    const plan = unwrap(
      simulatePayoff({
        debts: [VISA, MASTERCARD],
        strategy: 'snowball',
        monthlyPayment: usd('600.00'),
        from: START,
      }),
    );

    const last = plan.months[plan.months.length - 1];
    expect(last?.closingBalance.isPositive()).toBe(false);
  });

  it('costs less under avalanche than under snowball', () => {
    // The arithmetic the product must never fudge: avalanche is cheaper. What it
    // does not claim is that avalanche is therefore right for this household.
    const avalanche = unwrap(
      simulatePayoff({
        debts: [VISA, MASTERCARD],
        strategy: 'avalanche',
        monthlyPayment: usd('400.00'),
        from: START,
      }),
    );
    const snowball = unwrap(
      simulatePayoff({
        debts: [VISA, MASTERCARD],
        strategy: 'snowball',
        monthlyPayment: usd('400.00'),
        from: START,
      }),
    );

    expect(avalanche.totalInterest.lessThanOrEqual(snowball.totalInterest)).toBe(true);

    const comparison = comparePlans(avalanche, snowball);
    expect(comparison.interestSaved.isNegative()).toBe(false);
    expect(comparison.explanation).toContain('interest');
  });

  it('says a debt never clears rather than inventing a payoff date', () => {
    // A minimum that does not cover the interest is a balance that grows
    // forever. Reporting a date for it would be a fabrication.
    const trap = debt({
      id: 'trap',
      name: 'Trap',
      currentBalance: usd('5000.00'),
      apr: '36.000',
      minimumPayment: usd('10.00'),
    });

    const plan = unwrap(
      simulatePayoff({
        debts: [trap],
        strategy: 'avalanche',
        monthlyPayment: usd('10.00'),
        from: START,
        maxMonths: 24,
      }),
    );

    expect(plan.unresolvedDebtIds).toEqual(['trap']);
    expect(plan.debtFreeOn).toBeNull();
    expect(plan.monthsToDebtFree).toBeNull();
  });

  it('pays every minimum before sending anything extra anywhere', () => {
    const plan = unwrap(
      simulatePayoff({
        debts: [VISA, MASTERCARD],
        strategy: 'avalanche',
        monthlyPayment: usd('200.00'),
        from: START,
      }),
    );

    const first = plan.months[0];
    expect(first?.targetDebtId).toBe('mastercard');
    expect(first?.paid.toCurrencyString()).toBe('200.00');
  });

  it('reports no debts as a problem, not an empty plan', () => {
    const result = simulatePayoff({
      debts: [],
      strategy: 'avalanche',
      monthlyPayment: usd('600.00'),
      from: START,
    });

    expect(isOk(result)).toBe(false);
  });

  it('refuses to mix currencies', () => {
    const result = simulatePayoff({
      debts: [{ ...MASTERCARD, currentBalance: Money.fromDecimalString('1800.00', 'PAB') }],
      strategy: 'avalanche',
      monthlyPayment: usd('600.00'),
      from: START,
    });

    expect(isErr(result)).toBe(true);
  });
});

describe('minimums', () => {
  it('never asks for more than the balance', () => {
    const nearlyClear = debt({
      id: 'nearly',
      name: 'Nearly clear',
      currentBalance: usd('12.00'),
      minimumPayment: usd('50.00'),
    });

    expect(totalMinimums([nearlyClear], 'USD').toCurrencyString()).toBe('12.00');
  });

  it('ignores a debt that is already cleared', () => {
    const cleared = debt({ id: 'cleared', name: 'Cleared', currentBalance: usd('0') });

    expect(totalMinimums([cleared, MASTERCARD], 'USD').toCurrencyString()).toBe('54.00');
  });
});
