import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  createDateRange,
  daysBetween,
  endOfMonth,
  isPlainDate,
  monthKey,
  rangeContains,
  rangesOverlap,
  startOfMonth,
  toPlainDate,
} from './plain-date.js';

describe('PlainDate validation', () => {
  it('accepts real calendar dates', () => {
    expect(isPlainDate('2026-07-31')).toBe(true);
    expect(isPlainDate('2024-02-29')).toBe(true); // leap year
  });

  it('rejects dates that do not exist', () => {
    expect(isPlainDate('2026-02-30')).toBe(false);
    expect(isPlainDate('2025-02-29')).toBe(false); // not a leap year
    expect(isPlainDate('2026-13-01')).toBe(false);
  });

  it('rejects anything that is not a bare calendar date', () => {
    expect(isPlainDate('2026-07-31T00:00:00Z')).toBe(false);
    expect(isPlainDate('31/07/2026')).toBe(false);
    expect(isPlainDate(new Date())).toBe(false);
    expect(() => toPlainDate('nope')).toThrow(TypeError);
  });
});

describe('PlainDate arithmetic', () => {
  it('does not drift across a month boundary', () => {
    expect(addDays(toPlainDate('2026-07-31'), 1)).toBe('2026-08-01');
    expect(addDays(toPlainDate('2026-01-01'), -1)).toBe('2025-12-31');
  });

  it('crosses a DST boundary without losing a day', () => {
    // Zones that observe DST shift on these dates; a UTC-anchored calculation
    // must still count exactly one day.
    expect(addDays(toPlainDate('2026-03-08'), 1)).toBe('2026-03-09');
    expect(addDays(toPlainDate('2026-11-01'), 1)).toBe('2026-11-02');
    expect(daysBetween(toPlainDate('2026-03-07'), toPlainDate('2026-03-09'))).toBe(2);
  });

  it('clamps a month rollover to the last real day', () => {
    // A card statement due on the 31st still has to land in February.
    expect(addMonths(toPlainDate('2026-01-31'), 1)).toBe('2026-02-28');
    expect(addMonths(toPlainDate('2024-01-31'), 1)).toBe('2024-02-29');
    expect(addMonths(toPlainDate('2026-12-15'), 1)).toBe('2027-01-15');
    expect(addMonths(toPlainDate('2026-01-15'), -1)).toBe('2025-12-15');
  });

  it('derives month boundaries and keys', () => {
    expect(startOfMonth(toPlainDate('2026-07-17'))).toBe('2026-07-01');
    expect(endOfMonth(toPlainDate('2026-07-17'))).toBe('2026-07-31');
    expect(endOfMonth(toPlainDate('2026-02-10'))).toBe('2026-02-28');
    expect(monthKey(toPlainDate('2026-07-17'))).toBe('2026-07');
  });

  it('sorts chronologically as plain strings', () => {
    const dates = ['2026-10-01', '2026-02-15', '2026-02-03'].map(toPlainDate);
    expect([...dates].sort()).toEqual(['2026-02-03', '2026-02-15', '2026-10-01']);
  });
});

describe('DateRange', () => {
  it('rejects an inverted range', () => {
    expect(() => createDateRange(toPlainDate('2026-07-31'), toPlainDate('2026-07-01'))).toThrow(
      RangeError,
    );
  });

  it('contains its own bounds', () => {
    const july = createDateRange(toPlainDate('2026-07-01'), toPlainDate('2026-07-31'));
    expect(rangeContains(july, toPlainDate('2026-07-01'))).toBe(true);
    expect(rangeContains(july, toPlainDate('2026-07-31'))).toBe(true);
    expect(rangeContains(july, toPlainDate('2026-08-01'))).toBe(false);
  });

  it('detects overlap for statement-period matching', () => {
    const july = createDateRange(toPlainDate('2026-07-01'), toPlainDate('2026-07-31'));
    const midMonth = createDateRange(toPlainDate('2026-07-15'), toPlainDate('2026-08-14'));
    const august = createDateRange(toPlainDate('2026-08-01'), toPlainDate('2026-08-31'));

    expect(rangesOverlap(july, midMonth)).toBe(true);
    expect(rangesOverlap(july, august)).toBe(false);
  });
});
