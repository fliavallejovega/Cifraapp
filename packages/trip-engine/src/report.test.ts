import { toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { computeTripBudget } from './budget.js';
import { validateShares } from './categories.js';
import { buildTripReport, type SpentLine } from './report.js';
import type { TripBudgetInput } from './types.js';

const d = (v: string) => toPlainDate(v);

const trip: TripBudgetInput = {
  currency: { code: 'USD', minorUnits: 2 },
  totalBudget: '3000.00',
  today: d('2027-07-20'),
  startDate: d('2027-07-01'),
  endDate: d('2027-07-07'),
  legs: [
    {
      id: 'mad',
      arrivalDate: d('2027-07-01'),
      departureDate: d('2027-07-07'),
      costIndex: '1.00',
      lodgingMode: 'prepaid',
    },
  ],
  travelers: [
    { id: 'a', weight: '1' },
    { id: 'b', weight: '1' },
  ],
  bookings: [
    { id: 'f', type: 'flight', paymentStatus: 'paid', amountBase: '1200.00' },
    { id: 'h', type: 'lodging', paymentStatus: 'paid', amountBase: '700.00' },
  ],
  contingency: { type: 'percent', value: '10' },
  profile: 'balanced',
  partialDays: { includeArrival: true, includeDeparture: true, weight: '0.5' },
};

const lines: SpentLine[] = [
  { day: '2027-07-01', category: 'food', legId: 'mad', travelerId: 'a', amount: '60.00' },
  { day: '2027-07-02', category: 'food', legId: 'mad', travelerId: 'a', amount: '150.00' },
  { day: '2027-07-03', category: 'food', legId: 'mad', travelerId: 'b', amount: '160.00' },
  { day: '2027-07-04', category: 'food', legId: 'mad', travelerId: 'b', amount: '170.00' },
  {
    day: '2027-07-04',
    category: 'local_transport',
    legId: 'mad',
    travelerId: 'a',
    amount: '20.00',
  },
  { day: '2027-07-05', category: 'activities', legId: 'mad', travelerId: 'a', amount: '90.00' },
];

describe('buildTripReport', () => {
  const budget = computeTripBudget({
    ...trip,
    spent: lines.map((l) => ({ day: d(l.day), category: l.category ?? 'other', amount: l.amount })),
  });
  const report = buildTripReport({ budget, spent: lines, exchangeEffect: '0.00' });

  it('compares the days’ plan with what was spent', () => {
    expect(report.planned).toBe('990.00');
    expect(report.actual).toBe('650.00');
    expect(report.difference).toBe('340.00');
  });

  it('returns the unused reserve with the days’ leftover as surplus', () => {
    expect(report.surplus).toBe('450.00');
    expect(report.overrun).toBe('0.00');
    expect(report.reserve.usedPercent).toBe(0);
  });

  it('flags categories far from plan, by rule', () => {
    const food = report.byCategory.find((r) => r.key === 'food');
    expect(food?.planned).toBe('412.51');
    expect(food?.actual).toBe('540.00');
    expect(report.insights).toContainEqual({
      kind: 'category_over',
      category: 'food',
      percent: 31,
    });
    expect(report.insights).toContainEqual(
      expect.objectContaining({ kind: 'category_under', category: 'local_transport' }),
    );
    expect(report.insights).toContainEqual({ kind: 'reserve_untouched' });
  });

  it('accumulates day by day for the planned-against-actual line', () => {
    expect(report.byDay[report.byDay.length - 1]?.cumulativeActual).toBe('650.00');
    expect(report.byDay[report.byDay.length - 1]?.cumulativePlanned).toBe('990.00');
  });

  it('learns the real split as a valid custom profile', () => {
    expect(report.learnedShares).not.toBeNull();
    expect(validateShares(report.learnedShares ?? {})).toBe(true);
    expect(report.learnedShares?.food).toBe(8308);
  });

  it('splits spending by who paid', () => {
    expect(report.byTraveler).toEqual(
      expect.arrayContaining([
        { travelerId: 'a', actual: '320.00' },
        { travelerId: 'b', actual: '330.00' },
      ]),
    );
  });

  it('counts spending past the days’ fund against the reserve', () => {
    const heavy: SpentLine[] = [
      ...lines,
      { day: '2027-07-06', category: 'shopping', legId: 'mad', travelerId: 'a', amount: '400.00' },
    ];
    const b2 = computeTripBudget({
      ...trip,
      spent: heavy.map((l) => ({
        day: d(l.day),
        category: l.category ?? 'other',
        amount: l.amount,
      })),
    });
    const r2 = buildTripReport({ budget: b2, spent: heavy });
    expect(r2.actual).toBe('1050.00');
    expect(r2.reserve.used).toBe('60.00');
    expect(r2.surplus).toBe('50.00');
    expect(r2.insights).toContainEqual({ kind: 'overall_over', amount: '60.00' });
  });

  it('names at most the three categories furthest from their plan', () => {
    const quiet = buildTripReport({
      budget: computeTripBudget({ ...trip, spent: [] }),
      spent: [
        { day: '2027-07-02', category: 'food', legId: 'mad', travelerId: 'a', amount: '5.00' },
      ],
    });
    const categories = quiet.insights.filter(
      (i) => i.kind === 'category_over' || i.kind === 'category_under',
    );
    expect(categories.length).toBeLessThanOrEqual(3);
    expect(categories.length).toBeGreaterThan(0);
  });
});
