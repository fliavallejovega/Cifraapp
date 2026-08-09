import { createDateRange, Money, toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import {
  expectedInMonth,
  expectedOccurrences,
  MIN_MONTHS_FOR_FORECAST,
  projectMonths,
  summarizeByMonth,
  type MonthlyTotal,
} from './forecast.js';
import { detectRecurrence } from './recurring.js';
import type { Occurrence } from './types.js';

const usd = (value: string): Money => Money.fromDecimalString(value, 'USD');

function month(key: string, value: string): MonthlyTotal {
  return { month: key, net: usd(value) };
}

function at(date: string, value: string): Occurrence {
  return { id: date, date: toPlainDate(date), amount: usd(value) };
}

describe('monthly summaries', () => {
  it('groups dated amounts into calendar months', () => {
    const totals = summarizeByMonth(
      [at('2026-06-03', '40.00'), at('2026-06-28', '60.00'), at('2026-07-02', '25.00')],
      'USD',
    );

    expect(totals).toHaveLength(2);
    expect(totals[0]?.month).toBe('2026-06');
    expect(totals[0]?.net.toCurrencyString()).toBe('100.00');
  });
});

describe('forecasting', () => {
  it('refuses to forecast from too little history', () => {
    // A line through two points is not a forecast, and attaching a confidence to
    // it would be exactly the false precision this system exists to avoid.
    expect(
      projectMonths(
        [month('2026-05', '2000.00'), month('2026-06', '2100.00')],
        'USD',
        toPlainDate('2026-07-01'),
        3,
      ),
    ).toEqual([]);
    expect(MIN_MONTHS_FOR_FORECAST).toBe(3);
  });

  it('projects the middle of recent months, not the mean', () => {
    const projections = projectMonths(
      [
        month('2026-02', '2000.00'),
        month('2026-03', '2050.00'),
        month('2026-04', '1950.00'),
        month('2026-05', '9000.00'),
      ],
      'USD',
      toPlainDate('2026-06-01'),
      2,
    );

    // A mean would be dragged to $3,750 by one bonus month.
    expect(projections[0]?.expected.toCurrencyString()).toBe('2025.00');
    expect(projections[0]?.month).toBe('2026-06');
    expect(projections[1]?.month).toBe('2026-07');
  });

  it('loses confidence the further out it reaches', () => {
    const projections = projectMonths(
      [month('2026-04', '2000.00'), month('2026-05', '2000.00'), month('2026-06', '2000.00')],
      'USD',
      toPlainDate('2026-07-01'),
      4,
    );

    expect(projections).toHaveLength(4);
    expect(projections[0]!.confidence).toBeGreaterThan(projections[3]!.confidence);
    expect(projections[0]!.confidence).toBeLessThanOrEqual(0.9);
  });

  it('widens the band when the months disagree', () => {
    const steady = projectMonths(
      [month('2026-04', '2000.00'), month('2026-05', '2000.00'), month('2026-06', '2000.00')],
      'USD',
      toPlainDate('2026-07-01'),
      1,
    );
    const erratic = projectMonths(
      [month('2026-04', '400.00'), month('2026-05', '2000.00'), month('2026-06', '5200.00')],
      'USD',
      toPlainDate('2026-07-01'),
      1,
    );

    const steadyBand = steady[0]!.high.subtract(steady[0]!.low);
    const erraticBand = erratic[0]!.high.subtract(erratic[0]!.low);

    expect(erraticBand.greaterThan(steadyBand)).toBe(true);
    expect(erratic[0]!.confidence).toBeLessThan(steady[0]!.confidence);
  });
});

describe('expected occurrences of a recurring series', () => {
  const rent = detectRecurrence([
    at('2026-04-01', '900.00'),
    at('2026-05-01', '900.00'),
    at('2026-06-01', '900.00'),
  ])!;

  it('lands one rent charge in a month', () => {
    const occurrences = expectedOccurrences(
      rent,
      createDateRange(toPlainDate('2026-08-01'), toPlainDate('2026-08-31')),
    );

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.date).toBe('2026-08-01');
  });

  it('totals a month of recurring claims', () => {
    const salary = detectRecurrence([
      at('2026-04-15', '1200.00'),
      at('2026-04-30', '1200.00'),
      at('2026-05-15', '1200.00'),
      at('2026-05-31', '1200.00'),
      at('2026-06-15', '1200.00'),
      at('2026-06-30', '1200.00'),
    ])!;

    expect(
      expectedInMonth([rent, salary], toPlainDate('2026-08-14'), 'USD').toCurrencyString(),
    ).toBe('3300.00');
  });

  it('stays bounded over a long range', () => {
    const weekly = detectRecurrence([
      at('2026-01-05', '45.00'),
      at('2026-01-12', '45.00'),
      at('2026-01-19', '45.00'),
    ])!;

    const occurrences = expectedOccurrences(
      weekly,
      createDateRange(toPlainDate('2026-01-01'), toPlainDate('2030-01-01')),
    );

    expect(occurrences.length).toBeLessThanOrEqual(64);
  });
});
