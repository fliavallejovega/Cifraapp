import { Money, toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import {
  buildPayPeriods,
  periodContaining,
  type IncomeStream,
  type PeriodClaim,
} from './pay-period.js';

/**
 * The fortnight, which is the period this household actually lives in.
 *
 * Every figure here is arithmetic over stated amounts and dates. Nothing is
 * forecast, so nothing in this file asserts what a market or a habit will do —
 * only that money arriving on the 15th and money owed on the 28th land in the
 * same fortnight, and that saying so changes what the household can spend.
 */

const usd = (value: string) => Money.fromDecimalString(value, 'USD');
const on = (date: string) => toPlainDate(date);

const salary = (over: Partial<IncomeStream> = {}): IncomeStream => ({
  id: 'salary',
  label: 'Sueldo',
  amount: usd('1000.00'),
  frequency: 'semimonthly',
  anchorDays: [15, 31],
  nextPayday: on('2026-09-15'),
  ...over,
});

const owed = (over: Partial<PeriodClaim> = {}): PeriodClaim => ({
  id: 'claim',
  label: 'Algo',
  amount: usd('100.00'),
  due: on('2026-09-20'),
  isEssential: true,
  ...over,
});

describe('deriving the periods a household is paid in', () => {
  it('splits a twice-monthly salary on the days it is actually paid', () => {
    const periods = buildPayPeriods({
      currency: 'USD',
      today: on('2026-09-10'),
      opening: usd('0'),
      incomes: [salary()],
      claims: [],
      horizonDays: 45,
    });

    // The stretch before the first payday counts: it is the days being lived
    // through right now, and leaving it out answers «what can I spend» with a
    // figure that only applies from the 15th.
    expect(periods[0]?.start).toBe('2026-09-10');
    expect(periods[0]?.end).toBe('2026-09-14');
    expect(periods[1]?.start).toBe('2026-09-15');
    expect(periods[1]?.end).toBe('2026-09-29');
    expect(periods[2]?.start).toBe('2026-09-30');
  });

  it('uses the days the household stated, not the days we would have guessed', () => {
    // Paid on the 5th and the 20th. A product that assumes «twice a month means
    // the 15th and the 30th» puts the rent in the wrong fortnight, which is the
    // one detail that decides which one is tight.
    const periods = buildPayPeriods({
      currency: 'USD',
      today: on('2026-09-01'),
      opening: usd('0'),
      incomes: [salary({ anchorDays: [5, 20], nextPayday: on('2026-09-05') })],
      claims: [],
      horizonDays: 40,
    });

    expect(periods.map((period) => period.start)).toEqual([
      '2026-09-01',
      '2026-09-05',
      '2026-09-20',
      '2026-10-05',
    ]);
  });

  it('handles a wage paid every day and one paid every week', () => {
    const daily = buildPayPeriods({
      currency: 'USD',
      today: on('2026-09-01'),
      opening: usd('0'),
      incomes: [salary({ frequency: 'daily', amount: usd('40.00'), nextPayday: on('2026-09-01') })],
      claims: [],
      horizonDays: 6,
    });
    expect(daily).toHaveLength(7);
    expect(daily[0]?.income.toDecimalString()).toBe('40.0000');

    const weekly = buildPayPeriods({
      currency: 'USD',
      today: on('2026-09-01'),
      opening: usd('0'),
      incomes: [
        salary({ frequency: 'weekly', amount: usd('300.00'), nextPayday: on('2026-09-04') }),
      ],
      claims: [],
      horizonDays: 20,
    });
    expect(weekly.map((period) => period.start)).toEqual([
      '2026-09-01',
      '2026-09-04',
      '2026-09-11',
      '2026-09-18',
    ]);
  });

  it('merges two salaries paid on the same day and separates them when they are not', () => {
    const periods = buildPayPeriods({
      currency: 'USD',
      today: on('2026-09-15'),
      opening: usd('0'),
      incomes: [
        salary({ id: 'a', label: 'Sueldo Davo', amount: usd('1000.00'), anchorDays: [15, 31] }),
        salary({
          id: 'b',
          label: 'Sueldo Blei',
          amount: usd('600.00'),
          anchorDays: [15, 31],
          nextPayday: on('2026-09-15'),
        }),
      ],
      claims: [],
      horizonDays: 20,
    });

    expect(periods[0]?.income.toDecimalString()).toBe('1600.0000');
    expect(periods[0]?.paidBy).toEqual(['Sueldo Davo', 'Sueldo Blei']);
  });

  it('reports nothing rather than inventing a calendar when no income is known', () => {
    // A month would be the obvious thing to fall back on, and it is exactly the
    // averaging this module exists to stop.
    const periods = buildPayPeriods({
      currency: 'USD',
      today: on('2026-09-10'),
      opening: usd('500.00'),
      incomes: [],
      claims: [owed()],
    });
    expect(periods).toEqual([]);
  });
});

describe('what each fortnight can actually spare', () => {
  /** The same salary twice, and every deduction landing in the second half. */
  const heavySecondHalf = () =>
    buildPayPeriods({
      currency: 'USD',
      today: on('2026-09-15'),
      opening: usd('0'),
      incomes: [salary()],
      claims: [
        owed({ id: 'rent', label: 'Alquiler', amount: usd('700.00'), due: on('2026-10-01') }),
        owed({ id: 'school', label: 'Colegio', amount: usd('200.00'), due: on('2026-10-03') }),
      ],
      horizonDays: 32,
    });

  it('holds back, in the loose fortnight, what the tight one cannot cover', () => {
    const [first, second] = heavySecondHalf();

    // Both fortnights earn the same $1,000. The second owes $900 — it covers
    // itself, so nothing has to be held back.
    expect(first?.income.toDecimalString()).toBe('1000.0000');
    expect(second?.income.toDecimalString()).toBe('1000.0000');
    expect(second?.committed.toDecimalString()).toBe('900.0000');
    expect(first?.reservedForLater.toDecimalString()).toBe('0.0000');
    expect(first?.available.toDecimalString()).toBe('1000.0000');
  });

  it('reduces the loose fortnight when the tight one really is short', () => {
    const periods = buildPayPeriods({
      currency: 'USD',
      today: on('2026-09-15'),
      opening: usd('0'),
      incomes: [salary()],
      claims: [
        owed({ id: 'rent', label: 'Alquiler', amount: usd('900.00'), due: on('2026-10-01') }),
        owed({ id: 'school', label: 'Colegio', amount: usd('400.00'), due: on('2026-10-03') }),
      ],
      horizonDays: 32,
    });

    const [first, second] = periods;
    // The second fortnight earns 1,000 and owes 1,300. That gap propagates
    // backwards: spending the whole first paycheck is what guarantees the
    // surprise, so the first fortnight can only spare $700.
    expect(first?.reservedForLater.toDecimalString()).toBe('300.0000');
    expect(first?.available.toDecimalString()).toBe('700.0000');

    // And the $300 held back is exactly what opens the second fortnight — not
    // the $1,000 that would reach it if the household ignored the advice it was
    // just given. Two «available» figures that cannot both be acted on are
    // worse than either alone.
    expect(second?.opening.toDecimalString()).toBe('300.0000');
    expect(second?.shortfall.toDecimalString()).toBe('0.0000');
    // Which leaves the tight fortnight with nothing to spare, and that is the
    // whole point: it is tight, and the product should say so.
    expect(second?.available.toDecimalString()).toBe('0.0000');
  });

  it('raises a shortfall when no amount of holding back would have covered it', () => {
    const periods = buildPayPeriods({
      currency: 'USD',
      today: on('2026-09-15'),
      opening: usd('0'),
      incomes: [salary()],
      claims: [
        owed({ id: 'rent', label: 'Alquiler', amount: usd('900.00'), due: on('2026-10-01') }),
        owed({ id: 'surgery', label: 'Operación', amount: usd('2500.00'), due: on('2026-10-03') }),
      ],
      horizonDays: 32,
    });

    const [first, second] = periods;
    // The first fortnight holds back everything it has and it is still not
    // enough. Saying «disponible: 0» here is the truth; saying the household is
    // $1,400 short is the part they can act on.
    expect(first?.available.toDecimalString()).toBe('0.0000');
    expect(second?.shortfall.toDecimalString()).toBe('1400.0000');
  });

  it('carries forward what it held back, not what it never spent', () => {
    const periods = buildPayPeriods({
      currency: 'USD',
      today: on('2026-09-15'),
      opening: usd('250.00'),
      incomes: [salary()],
      claims: [
        owed({ id: 'rent', amount: usd('400.00'), due: on('2026-09-20') }),
        // Something in the next fortnight it cannot cover alone, so there is a
        // reason to hold anything back at all.
        owed({ id: 'tuition', amount: usd('1500.00'), due: on('2026-10-02') }),
      ],
      horizonDays: 32,
    });

    const [first, second] = periods;
    expect(first?.opening.toDecimalString()).toBe('250.0000');
    // 250 in hand + 1,000 paid − 400 owed = 850 after obligations…
    expect(first?.closing.toDecimalString()).toBe('850.0000');
    // …of which 500 has to survive to cover the second fortnight's $1,500
    // against its $1,000, leaving 350 to spend now.
    expect(first?.reservedForLater.toDecimalString()).toBe('500.0000');
    expect(first?.available.toDecimalString()).toBe('350.0000');
    // And it is the 500 that opens the next fortnight, not the 850.
    expect(second?.opening.toDecimalString()).toBe('500.0000');
    expect(second?.shortfall.toDecimalString()).toBe('0.0000');
  });

  it('never offers the household its own floor to spend', () => {
    const periods = buildPayPeriods({
      currency: 'USD',
      today: on('2026-09-15'),
      opening: usd('0'),
      incomes: [salary()],
      claims: [],
      keepAtLeast: usd('300.00'),
      horizonDays: 20,
    });
    expect(periods[0]?.available.toDecimalString()).toBe('700.0000');
    // And the buffer is subtracted from what may be spent, never from what is
    // reported as held: a household below its floor must see that it is.
    expect(periods[0]?.closing.toDecimalString()).toBe('1000.0000');
  });

  it('puts an already overdue bill in the period being lived through', () => {
    const periods = buildPayPeriods({
      currency: 'USD',
      today: on('2026-09-16'),
      opening: usd('500.00'),
      incomes: [salary({ nextPayday: on('2026-09-30') })],
      claims: [owed({ id: 'late', amount: usd('120.00'), due: on('2026-09-02') })],
      horizonDays: 30,
    });
    // It is owed today, not on a past date nobody can act on any more.
    expect(periods[0]?.claims.map((claim) => claim.id)).toEqual(['late']);
    expect(periods[0]?.available.toDecimalString()).toBe('380.0000');
  });

  it('reports a hole as a shortfall and nothing as available, not a negative', () => {
    const periods = buildPayPeriods({
      currency: 'USD',
      today: on('2026-09-15'),
      opening: usd('0'),
      incomes: [salary()],
      claims: [owed({ id: 'rent', amount: usd('1400.00'), due: on('2026-09-20') })],
      horizonDays: 14,
    });
    // «Available: −$400» reads as a spending figure. It is not one: there is
    // nothing to spend, and the hole is a separate statement.
    expect(periods[0]?.available.toDecimalString()).toBe('0.0000');
    expect(periods[0]?.shortfall.toDecimalString()).toBe('400.0000');
  });

  it('finds the period a date belongs to', () => {
    const periods = heavySecondHalf();
    expect(periodContaining(periods, on('2026-09-20'))?.start).toBe('2026-09-15');
    expect(periodContaining(periods, on('2026-10-02'))?.start).toBe('2026-09-30');
    expect(periodContaining(periods, on('2027-01-01'))).toBeNull();
  });
});
