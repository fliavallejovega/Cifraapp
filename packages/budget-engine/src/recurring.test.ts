import { Money, toPlainDate } from '@app/domain';
import { describe, expect, it } from 'vitest';

import { advanceToOrAfter, detectRecurrence, MIN_OCCURRENCES } from './recurring.js';
import type { Occurrence } from './types.js';

const usd = (value: string): Money => Money.fromDecimalString(value, 'USD');

function at(date: string, value = '900.00'): Occurrence {
  return { id: date, date: toPlainDate(date), amount: usd(value) };
}

describe('recurring detection', () => {
  it('refuses to call two occurrences a cadence', () => {
    // One gap says two events were 30 days apart. It does not say they will be.
    expect(detectRecurrence([at('2026-05-01'), at('2026-06-01')])).toBeNull();
    expect(MIN_OCCURRENCES).toBe(3);
  });

  it('finds monthly rent', () => {
    const series = detectRecurrence([
      at('2026-04-01'),
      at('2026-05-01'),
      at('2026-06-01'),
      at('2026-07-01'),
    ]);

    expect(series?.frequency).toBe('monthly');
    expect(series?.expectedAmount.toCurrencyString()).toBe('900.00');
    expect(series?.nextExpectedDate).toBe('2026-08-01');
    expect(series?.confidence).toBeGreaterThan(0.8);
  });

  it('tolerates a bill that lands a couple of days either side', () => {
    const series = detectRecurrence([
      at('2026-04-03', '82.40'),
      at('2026-05-01', '91.10'),
      at('2026-06-04', '77.90'),
      at('2026-07-02', '88.20'),
    ]);

    expect(series?.frequency).toBe('monthly');
    // A utility swings month to month and is still plainly recurring.
    expect(series?.amountVariation).toBeGreaterThan(0);
    expect(series?.confidence).toBeGreaterThan(0.6);
  });

  it('finds a weekly pattern', () => {
    const series = detectRecurrence([
      at('2026-07-01', '45.00'),
      at('2026-07-08', '45.00'),
      at('2026-07-15', '45.00'),
      at('2026-07-22', '45.00'),
    ]);

    expect(series?.frequency).toBe('weekly');
    expect(series?.nextExpectedDate).toBe('2026-07-29');
  });

  it('finds an annual premium', () => {
    const series = detectRecurrence([
      at('2024-03-15', '640.00'),
      at('2025-03-16', '640.00'),
      at('2026-03-14', '660.00'),
    ]);

    expect(series?.frequency).toBe('annual');
    expect(series?.nextExpectedDate.slice(0, 7)).toBe('2027-03');
  });

  it('reports nothing when the dates are scattered', () => {
    const series = detectRecurrence([
      at('2026-01-04'),
      at('2026-02-19'),
      at('2026-02-27'),
      at('2026-06-11'),
    ]);

    expect(series).toBeNull();
  });
});

describe('semimonthly is not biweekly', () => {
  it('recognizes a salary paid on the 15th and the end of the month', () => {
    // 24 payments a year on two fixed calendar days. Calling it biweekly makes
    // the engine predict a 27th paycheck that never arrives.
    const series = detectRecurrence([
      at('2026-04-15', '1200.00'),
      at('2026-04-30', '1200.00'),
      at('2026-05-15', '1200.00'),
      at('2026-05-31', '1200.00'),
      at('2026-06-15', '1200.00'),
      at('2026-06-30', '1200.00'),
    ]);

    expect(series?.frequency).toBe('semimonthly');
    expect(series?.nextExpectedDate).toBe('2026-07-15');
  });

  it('keeps a genuinely biweekly series biweekly', () => {
    const series = detectRecurrence([
      at('2026-04-03', '800.00'),
      at('2026-04-17', '800.00'),
      at('2026-05-01', '800.00'),
      at('2026-05-15', '800.00'),
      at('2026-05-29', '800.00'),
    ]);

    expect(series?.frequency).toBe('biweekly');
  });

  it('clamps a month-end anchor to a short month', () => {
    const series = detectRecurrence([
      at('2026-12-15', '1200.00'),
      at('2026-12-31', '1200.00'),
      at('2027-01-15', '1200.00'),
      at('2027-01-31', '1200.00'),
    ]);

    expect(series?.frequency).toBe('semimonthly');
    expect(series?.anchorDays).toEqual([15, 31]);
    expect(advanceToOrAfter(series!, toPlainDate('2027-02-16'))).toBe('2027-02-28');
  });
});

describe('the next expected date', () => {
  it('stays where it fell, so a missed payment is visible', () => {
    const series = detectRecurrence([at('2026-01-01'), at('2026-02-01'), at('2026-03-01')]);

    expect(series?.nextExpectedDate).toBe('2026-04-01');
  });

  it('advances to the next one that has not happened yet when asked', () => {
    const series = detectRecurrence([at('2026-01-01'), at('2026-02-01'), at('2026-03-01')]);

    expect(advanceToOrAfter(series!, toPlainDate('2026-07-15'))).toBe('2026-08-01');
  });
});
