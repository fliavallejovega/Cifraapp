import { toPlainDate, type PlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { computeTripBudget } from './budget.js';
import { DAILY_CATEGORIES, TRIP_CATEGORIES, type DailyCategory } from './categories.js';
import type { BookingInput, LegInput, TripBudgetInput } from './types.js';
import { fromMinor, sumUnits, toMinor } from './units.js';

const d = (value: string): PlainDate => toPlainDate(value);
const USD = { code: 'USD', minorUnits: 2 } as const;
const EUR = { code: 'EUR', minorUnits: 2 } as const;
const cents = (value: string): bigint => toMinor(value, 2);

/** The family of §6.13: two adults and a child, seven days in Madrid. */
function madrid(overrides: Partial<TripBudgetInput> = {}): TripBudgetInput {
  return {
    currency: USD,
    totalBudget: '3000.00',
    today: d('2027-01-15'),
    startDate: d('2027-07-01'),
    endDate: d('2027-07-07'),
    legs: [
      {
        id: 'madrid',
        arrivalDate: d('2027-07-01'),
        departureDate: d('2027-07-07'),
        costIndex: '1.00',
        lodgingMode: 'prepaid',
        localCurrency: USD,
      },
    ],
    travelers: [
      { id: 'a1', weight: '1' },
      { id: 'a2', weight: '1' },
      { id: 'kid', weight: '0.6' },
    ],
    bookings: [
      { id: 'flights', type: 'flight', paymentStatus: 'paid', amountBase: '1200.00' },
      {
        id: 'hotel',
        type: 'lodging',
        paymentStatus: 'paid',
        amountBase: '700.00',
        legId: 'madrid',
      },
    ],
    contingency: { type: 'percent', value: '10' },
    profile: 'balanced',
    partialDays: { includeArrival: true, includeDeparture: true, weight: '0.5' },
    ...overrides,
  };
}

const plannedSum = (budget: ReturnType<typeof computeTripBudget>): bigint =>
  sumUnits(budget.days.map((day) => cents(day.plannedTotal)));

/** prepaid + pending + reserve + every day's allocation = the fund, to the cent. */
function expectExactPlan(budget: ReturnType<typeof computeTripBudget>): void {
  const parts =
    cents(budget.commitments.prepaid) +
    cents(budget.commitments.pending) +
    cents(budget.reserve.available) +
    plannedSum(budget);
  expect(fromMinor(parts, 2)).toBe(budget.totalBudget);
}

describe('computeTripBudget — the §6.13 example', () => {
  const budget = computeTripBudget(madrid());

  it('takes the prepaid flights and hotel off the top', () => {
    expect(budget.commitments.prepaid).toBe('1900.00');
    expect(budget.commitments.pending).toBe('0.00');
  });

  it('sets aside 10 % of what is left as the reserve', () => {
    expect(budget.reserve.planned).toBe('110.00');
    expect(budget.fundForDays).toBe('990.00');
  });

  it('counts five full days and two half days as six', () => {
    expect(budget.effectiveDays).toBe('6.000');
  });

  it('gives a full day 165.00 and a partial day 82.50', () => {
    expect(budget.legs[0]?.perDiemFull).toBe('165.00');
    expect(budget.legs[0]?.perDiemPartial).toBe('82.50');
    expect(budget.days.map((day) => day.plannedTotal)).toEqual([
      '82.50',
      '165.00',
      '165.00',
      '165.00',
      '165.00',
      '165.00',
      '82.50',
    ]);
  });

  it('renormalizes Balanced without lodging, because the hotel is paid', () => {
    expect(budget.legs[0]?.fullDay).toEqual({
      lodging: '0.00',
      food: '68.75',
      local_transport: '33.00',
      activities: '35.75',
      shopping: '16.50',
      other: '11.00',
    });
  });

  it('adds back to exactly 3,000.00', () => {
    expectExactPlan(budget);
  });

  it('splits a day across travellers by weight, to the cent', () => {
    expect(sumUnits(budget.perTraveler.map((t) => cents(t.amount)))).toBe(cents('165.00'));
    expect(budget.perTraveler.map((t) => t.travelerId)).toEqual(['a1', 'a2', 'kid']);
    expect(cents(budget.perTraveler[2]?.amount ?? '0')).toBeLessThan(
      cents(budget.perTraveler[0]?.amount ?? '0'),
    );
  });

  it('is healthy and stamped with its version', () => {
    expect(budget.diagnostics.status).toBe('healthy');
    expect(budget.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(budget.phase).toBe('before');
  });
});

describe('computeTripBudget — the cases around it', () => {
  it('reports a deficit with the exact shortfall and the months it takes', () => {
    const budget = computeTripBudget(
      madrid({ totalBudget: '1500.00', monthlySavingCapacity: '250.00' }),
    );
    expect(budget.diagnostics.status).toBe('deficit');
    expect(budget.diagnostics.shortfall).toBe('400.00');
    expect(budget.fundForDays).toBe('-400.00');
    expect(budget.days.every((day) => day.plannedTotal === '0.00')).toBe(true);
    expect(budget.diagnostics.suggestions).toContainEqual({
      kind: 'add_money',
      amount: '400.00',
      months: 2,
    });
  });

  it('offers a lower reserve when that alone closes the gap', () => {
    const budget = computeTripBudget(
      madrid({
        contingency: { type: 'fixed', value: '300.00' },
        overrides: [{ category: 'food', amount: '1000.00' }],
      }),
    );
    // Fund 1,100 − reserve 300 = 800 for days, overrides ask 1,000: 200 short.
    expect(budget.diagnostics.status).toBe('deficit');
    expect(budget.diagnostics.shortfall).toBe('200.00');
    const lower = budget.diagnostics.suggestions.find((s) => s.kind === 'lower_reserve');
    expect(lower).toMatchObject({ kind: 'lower_reserve', frees: '200.00', fixes: true });
  });

  it('gives an expensive leg more per day than a cheap one', () => {
    const legs: LegInput[] = [
      {
        id: 'paris',
        arrivalDate: d('2027-07-01'),
        departureDate: d('2027-07-04'),
        costIndex: '1.30',
        lodgingMode: 'prepaid',
      },
      {
        id: 'lisboa',
        arrivalDate: d('2027-07-04'),
        departureDate: d('2027-07-07'),
        costIndex: '0.70',
        lodgingMode: 'prepaid',
      },
    ];
    const budget = computeTripBudget(madrid({ legs }));
    const paris = budget.legs.find((l) => l.legId === 'paris');
    const lisboa = budget.legs.find((l) => l.legId === 'lisboa');
    // The transition day belongs to the leg that arrives.
    expect(budget.days[3]?.legId).toBe('lisboa');
    expect(paris?.days).toBe(3);
    expect(lisboa?.days).toBe(4);
    // 1.30 / 0.70 of each other, within a cent of rounding.
    const ratio =
      (cents(paris?.perDiemFull ?? '0') * 70n) / 130n - cents(lisboa?.perDiemFull ?? '0');
    expect(ratio >= -1n && ratio <= 1n).toBe(true);
    expectExactPlan(budget);
  });

  it('shows the per diem in local currency at the planning rate', () => {
    const budget = computeTripBudget(
      madrid({
        legs: [
          {
            id: 'madrid',
            arrivalDate: d('2027-07-01'),
            departureDate: d('2027-07-07'),
            costIndex: '1.00',
            lodgingMode: 'prepaid',
            localCurrency: EUR,
            fxRate: '0.92',
          },
        ],
      }),
    );
    expect(budget.legs[0]?.perDiemFull).toBe('165.00');
    expect(budget.legs[0]?.perDiemFullLocal).toBe('151.80');
    expect(budget.legs[0]?.localCurrency).toBe('EUR');
  });

  it('warns when a foreign leg has no rate', () => {
    const budget = computeTripBudget(
      madrid({
        legs: [
          {
            id: 'madrid',
            arrivalDate: d('2027-07-01'),
            departureDate: d('2027-07-07'),
            costIndex: '1.00',
            lodgingMode: 'prepaid',
            localCurrency: EUR,
          },
        ],
      }),
    );
    expect(budget.diagnostics.warnings).toContainEqual({
      kind: 'missing_fx',
      legId: 'madrid',
      currency: 'EUR',
    });
    expect(budget.legs[0]?.perDiemFullLocal).toBeNull();
  });

  it('respects a manual override and spreads the rest around it', () => {
    const budget = computeTripBudget(
      madrid({ overrides: [{ day: d('2027-07-03'), category: 'food', amount: '100.00' }] }),
    );
    expect(budget.days[2]?.planned.food).toBe('100.00');
    // Other days lose a little so the override is paid for.
    expect(cents(budget.days[1]?.plannedTotal ?? '0')).toBeLessThan(cents('165.00'));
    expectExactPlan(budget);
  });

  it('reserves lodging per night when the bed is not booked yet', () => {
    const budget = computeTripBudget(
      madrid({
        bookings: [{ id: 'flights', type: 'flight', paymentStatus: 'paid', amountBase: '1200.00' }],
        legs: [
          {
            id: 'madrid',
            arrivalDate: d('2027-07-01'),
            departureDate: d('2027-07-07'),
            costIndex: '1.00',
            lodgingMode: 'undecided',
          },
        ],
      }),
    );
    expect(budget.fundForDays).toBe('1620.00');
    const lodging = budget.days.map((day) => cents(day.planned.lodging));
    expect(lodging[6]).toBe(0n); // no night after the last day
    expect(lodging.slice(0, 6).every((value) => value > 0n)).toBe(true);
    expect(budget.legs[0]?.lodgingToBook?.nights).toBe(6);
    expect(cents(budget.legs[0]?.lodgingToBook?.perNight ?? '0')).toBeGreaterThan(0n);
    expect(budget.diagnostics.warnings).toContainEqual({
      kind: 'lodging_undecided',
      legId: 'madrid',
      nights: 6,
    });
    expectExactPlan(budget);
  });

  it('handles a one-day trip as a single full day', () => {
    const budget = computeTripBudget(
      madrid({
        startDate: d('2027-07-01'),
        endDate: d('2027-07-01'),
        legs: [
          {
            id: 'madrid',
            arrivalDate: d('2027-07-01'),
            departureDate: d('2027-07-01'),
            costIndex: '1.00',
            lodgingMode: 'none',
          },
        ],
      }),
    );
    expect(budget.days).toHaveLength(1);
    expect(budget.days[0]?.kind).toBe('single');
    expect(budget.days[0]?.plannedTotal).toBe('990.00');
    expectExactPlan(budget);
  });

  it('crosses the end of a month and of a year', () => {
    const budget = computeTripBudget(
      madrid({
        startDate: d('2027-12-29'),
        endDate: d('2028-01-03'),
        legs: [
          {
            id: 'nyc',
            arrivalDate: d('2027-12-29'),
            departureDate: d('2028-01-03'),
            costIndex: '1.60',
            lodgingMode: 'prepaid',
          },
        ],
      }),
    );
    expect(budget.days.map((day) => day.date)).toEqual([
      '2027-12-29',
      '2027-12-30',
      '2027-12-31',
      '2028-01-01',
      '2028-01-02',
      '2028-01-03',
    ]);
    expectExactPlan(budget);
  });

  it('counts arrival and departure as full days when partial days are off', () => {
    const budget = computeTripBudget(
      madrid({ partialDays: { includeArrival: true, includeDeparture: true, weight: '1' } }),
    );
    expect(budget.effectiveDays).toBe('7.000');
    const totals = budget.days.map((day) => cents(day.plannedTotal));
    expect(Math.max(...totals.map(Number)) - Math.min(...totals.map(Number))).toBeLessThanOrEqual(
      1,
    );
    expectExactPlan(budget);
  });

  it('gives nothing to a day left out of the budget', () => {
    const budget = computeTripBudget(
      madrid({ partialDays: { includeArrival: false, includeDeparture: true, weight: '0.5' } }),
    );
    expect(budget.days[0]?.plannedTotal).toBe('0.00');
    expect(budget.effectiveDays).toBe('5.500');
    expectExactPlan(budget);
  });
});

describe('computeTripBudget — rolling while the trip runs', () => {
  it('lowers the days ahead after overspending on day 2', () => {
    const budget = computeTripBudget(
      madrid({
        today: d('2027-07-03'),
        spent: [
          { day: d('2027-07-01'), category: 'food', amount: '82.50' },
          { day: d('2027-07-02'), category: 'food', amount: '200.00' },
        ],
      }),
    );
    expect(budget.phase).toBe('during');
    expect(budget.days[1]?.state).toBe('over');
    expect(budget.spent.beforeToday).toBe('282.50');
    // 990.00 − 282.50 = 707.50 over four full days and a half day.
    const ahead = budget.days
      .filter((day) => day.timing !== 'past')
      .map((day) => cents(day.plannedTotal));
    expect(fromMinor(sumUnits(ahead), 2)).toBe('707.50');
    expect(cents(budget.today?.allowed ?? '0')).toBeLessThan(cents('165.00'));
    expect(budget.diagnostics.status).not.toBe('deficit');
  });

  it('raises the days ahead after saving on day 3', () => {
    const budget = computeTripBudget(
      madrid({
        today: d('2027-07-04'),
        spent: [
          { day: d('2027-07-01'), category: 'food', amount: '82.50' },
          { day: d('2027-07-02'), category: 'food', amount: '165.00' },
          { day: d('2027-07-03'), category: 'activities', amount: '140.00' },
        ],
      }),
    );
    expect(cents(budget.today?.allowed ?? '0')).toBeGreaterThan(cents('165.00'));
    expect(budget.days[2]?.state).toBe('near');
  });

  it('tells what is left for today and never shows a negative', () => {
    const budget = computeTripBudget(
      madrid({
        today: d('2027-07-02'),
        spent: [{ day: d('2027-07-02'), category: 'food', amount: '300.00' }],
      }),
    );
    expect(budget.today?.remaining).toBe('0.00');
    expect(cents(budget.today?.overspent ?? '0')).toBeGreaterThan(0n);
    expect(budget.today?.byCategory.food.remaining).toBe('0.00');
  });

  it('keeps the plan and reports drift under the fixed policy', () => {
    const budget = computeTripBudget(
      madrid({
        today: d('2027-07-03'),
        rollingPolicy: 'fixed',
        spent: [
          { day: d('2027-07-01'), category: 'food', amount: '50.00' },
          { day: d('2027-07-02'), category: 'food', amount: '100.00' },
        ],
      }),
    );
    expect(budget.today?.allowed).toBe('165.00');
    expect(budget.drift).toBe('97.50');
  });

  it('suggests the reserve once the days run dry', () => {
    const budget = computeTripBudget(
      madrid({
        today: d('2027-07-04'),
        spent: [{ day: d('2027-07-02'), category: 'shopping', amount: '1050.00' }],
      }),
    );
    expect(budget.diagnostics.status).toBe('deficit');
    expect(budget.diagnostics.shortfall).toBe('60.00');
    expect(budget.diagnostics.suggestions).toContainEqual({
      kind: 'use_reserve',
      amount: '60.00',
      fixes: true,
    });
  });

  it('adds released reserve to the days and keeps the sum exact', () => {
    const budget = computeTripBudget(madrid({ reserveReleased: '50.00' }));
    expect(budget.reserve.available).toBe('60.00');
    expect(budget.fundForDays).toBe('1040.00');
    expectExactPlan(budget);
  });
});

describe('computeTripBudget — properties', () => {
  /** A small deterministic generator, so a failure always reproduces. */
  function rng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 2 ** 32;
    };
  }

  function randomTrip(seed: number): TripBudgetInput {
    const r = rng(seed);
    const int = (min: number, max: number): number => min + Math.floor(r() * (max - min + 1));
    const money = (max: number): string =>
      `${String(int(0, max))}.${String(int(0, 99)).padStart(2, '0')}`;
    const start = d('2027-03-01');
    const length = int(1, 60);
    const end = toPlainDate(new Date(Date.UTC(2027, 2, length)).toISOString().slice(0, 10));
    const legCount = Math.min(int(1, 5), length);
    const legs: LegInput[] = [];
    let cursor = 1;
    for (let i = 0; i < legCount; i += 1) {
      const last = i === legCount - 1;
      const stop = last
        ? length
        : Math.min(length, cursor + int(0, Math.max(0, Math.floor(length / legCount))));
      legs.push({
        id: `leg${String(i)}`,
        arrivalDate: toPlainDate(new Date(Date.UTC(2027, 2, cursor)).toISOString().slice(0, 10)),
        departureDate: toPlainDate(new Date(Date.UTC(2027, 2, stop)).toISOString().slice(0, 10)),
        costIndex: (['0.70', '1.00', '1.30', '1.60', '0.85'] as const)[int(0, 4)] ?? '1.00',
        lodgingMode:
          (['undecided', 'prepaid', 'pay_on_site', 'none'] as const)[int(0, 3)] ?? 'none',
      });
      cursor = stop;
    }
    const bookings: BookingInput[] = Array.from({ length: int(0, 4) }, (_, i) => ({
      id: `b${String(i)}`,
      type: 'other' as const,
      paymentStatus:
        (['paid', 'deposit_paid', 'pay_later', 'pay_on_site'] as const)[int(0, 3)] ?? 'paid',
      amountBase: money(900),
      paidBase: money(300),
    }));
    const categories: readonly DailyCategory[] = DAILY_CATEGORIES;
    const offset = int(-5, length + 5);
    return {
      currency: USD,
      totalBudget: money(9000),
      today: toPlainDate(new Date(Date.UTC(2027, 2, 1 + offset)).toISOString().slice(0, 10)),
      startDate: start,
      endDate: end,
      legs,
      travelers: Array.from({ length: int(0, 5) }, (_, i) => ({
        id: `t${String(i)}`,
        weight: (['1', '0.6', '0.2'] as const)[int(0, 2)] ?? '1',
      })),
      bookings,
      contingency:
        r() < 0.5
          ? { type: 'percent', value: String(int(0, 30)) }
          : { type: 'fixed', value: money(500) },
      profile: (['economy', 'balanced', 'comfort'] as const)[int(0, 2)] ?? 'balanced',
      partialDays: {
        includeArrival: r() < 0.7,
        includeDeparture: r() < 0.7,
        weight: (['0.5', '0.25', '1', '0'] as const)[int(0, 3)] ?? '0.5',
      },
      overrides: Array.from({ length: int(0, 3) }, () => ({
        category: categories[int(0, 5)] ?? 'food',
        amount: money(150),
        ...(r() < 0.5
          ? {
              day: toPlainDate(
                new Date(Date.UTC(2027, 2, int(1, length))).toISOString().slice(0, 10),
              ),
            }
          : {}),
      })),
      spent: Array.from({ length: int(0, 30) }, () => ({
        day: toPlainDate(new Date(Date.UTC(2027, 2, int(1, length))).toISOString().slice(0, 10)),
        category: TRIP_CATEGORIES[int(0, TRIP_CATEGORIES.length - 1)] ?? 'food',
        amount: money(120),
      })),
      reserveReleased: r() < 0.3 ? money(100) : null,
      rollingPolicy: r() < 0.8 ? 'rolling' : 'fixed',
    };
  }

  it('always adds back to the fund exactly, across 2,000 random trips', () => {
    for (let seed = 1; seed <= 2000; seed += 1) {
      const input = randomTrip(seed);
      // The engine asserts its own invariant and throws if a cent goes missing.
      const budget = computeTripBudget(input);
      if (budget.phase !== 'during' && budget.diagnostics.status !== 'deficit') {
        expectExactPlan(budget);
      }
      for (const day of budget.days) {
        for (const category of DAILY_CATEGORIES)
          expect(cents(day.planned[category])).toBeGreaterThanOrEqual(0n);
      }
      if (budget.today) expect(cents(budget.today.remaining)).toBeGreaterThanOrEqual(0n);
    }
  });

  it('computes 60 days, 5 legs and 500 expenses in under 50 ms', () => {
    const legs: LegInput[] = Array.from({ length: 5 }, (_, i) => ({
      id: `leg${String(i)}`,
      arrivalDate: toPlainDate(new Date(Date.UTC(2027, 2, 1 + i * 12)).toISOString().slice(0, 10)),
      departureDate: toPlainDate(
        new Date(Date.UTC(2027, 2, 13 + i * 12)).toISOString().slice(0, 10),
      ),
      costIndex: '1.00',
      lodgingMode: 'undecided',
    }));
    const input = madrid({
      startDate: d('2027-03-01'),
      endDate: d('2027-04-29'),
      today: d('2027-03-30'),
      totalBudget: '25000.00',
      legs,
      spent: Array.from({ length: 500 }, (_, i) => ({
        day: toPlainDate(new Date(Date.UTC(2027, 2, 1 + (i % 29))).toISOString().slice(0, 10)),
        category: 'food' as const,
        amount: '12.34',
      })),
    });
    computeTripBudget(input); // warm up
    const started = performance.now();
    computeTripBudget(input);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
