import {
  addDays,
  addMonths,
  createDateRange,
  endOfMonth,
  Money,
  monthKey,
  rangeContains,
  startOfMonth,
  type CurrencyCode,
  type DateRange,
  type PlainDate,
} from '@app/domain';

import { advanceToOrAfter } from './recurring.js';
import { median } from './statistics.js';
import type { Occurrence, RecurringSeries } from './types.js';

/**
 * Forecasting.
 *
 * Deterministic statistical methods, and nothing else. A language model is not a
 * forecasting engine: it cannot be audited, it does not produce the same answer
 * twice, and a household planning around a number it invented has no way to find
 * out that it did. AI's job here is to explain a forecast this file produced
 * (spec §33).
 *
 * The method is deliberately plain enough to explain in one sentence to the
 * person it affects: the middle of what you have actually done, with a band
 * around it as wide as your months usually differ, and less confidence the
 * further out it reaches. Anything more elaborate would be harder to justify and
 * no more honest.
 */

export interface MonthlyTotal {
  /** `'2026-07'`. */
  readonly month: string;
  readonly net: Money;
}

export interface Projection {
  readonly month: string;
  readonly expected: Money;
  readonly low: Money;
  readonly high: Money;
  readonly confidence: number;
  /** How many observed months the projection rests on. */
  readonly basis: number;
  readonly explanation: string;
}

/** Fewer than this and there is no distribution to take a middle of. */
export const MIN_MONTHS_FOR_FORECAST = 3;

/** How many months back the forecast looks. Older months describe a different life. */
export const FORECAST_LOOKBACK_MONTHS = 6;

/** Groups dated amounts into calendar-month totals. */
export function summarizeByMonth(
  occurrences: readonly Occurrence[],
  currency: CurrencyCode,
): MonthlyTotal[] {
  const buckets = new Map<string, Money[]>();

  for (const occurrence of occurrences) {
    const key = monthKey(occurrence.date);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(occurrence.amount);
    } else {
      buckets.set(key, [occurrence.amount]);
    }
  }

  return [...buckets.entries()]
    .map(([month, amounts]) => ({ month, net: Money.sum(amounts, currency) }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

/**
 * Projects the next `count` months from observed history.
 *
 * Returns an empty list rather than a guess when there is not enough history.
 * A forecast from two months is a straight line through two points, and
 * presenting it with a confidence attached would be the kind of false precision
 * this system is built to avoid.
 */
export function projectMonths(
  history: readonly MonthlyTotal[],
  currency: CurrencyCode,
  from: PlainDate,
  count: number,
): Projection[] {
  if (history.length < MIN_MONTHS_FOR_FORECAST || count < 1) return [];

  const recent = [...history]
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .slice(-FORECAST_LOOKBACK_MONTHS);

  const values = recent.map((entry) => entry.net);
  const centre = median(values);
  if (!centre) return [];

  const deviations = values.map((value) => value.subtract(centre).abs());
  const spread = median(deviations) ?? Money.zero(currency);

  // Steadier months and more of them earn more confidence; distance costs it.
  const steadiness = centre.isZero()
    ? 0.5
    : clamp(1 - ratio(spread.scaledUnits, centre.scaledUnits), 0, 1);
  const depth = clamp((recent.length - MIN_MONTHS_FOR_FORECAST) / 3, 0, 1);
  const base = clamp(0.4 + 0.35 * steadiness + 0.15 * depth, 0, 0.9);

  const projections: Projection[] = [];
  let month = startOfMonth(from);

  for (let step = 0; step < count; step += 1) {
    const confidence = clamp(base * Math.pow(0.9, step), 0.1, 0.9);

    projections.push({
      month: monthKey(month),
      expected: centre,
      low: centre.subtract(spread),
      high: centre.add(spread),
      confidence,
      basis: recent.length,
      explanation: `The middle of your last ${String(recent.length)} months.`,
    });

    month = addMonths(month, 1);
  }

  return projections;
}

export interface ExpectedOccurrence {
  readonly date: PlainDate;
  readonly amount: Money;
  readonly confidence: number;
}

/**
 * The dates a recurring series is expected to land on inside a range.
 *
 * This is what the financial calendar marks and what the allocation engine
 * treats as an upcoming claim. Bounded by the range rather than by a step count,
 * and capped, so a corrupt series cannot produce an unbounded list.
 */
export function expectedOccurrences(
  series: RecurringSeries,
  range: DateRange,
  limit = 64,
): ExpectedOccurrence[] {
  const results: ExpectedOccurrence[] = [];
  let date = advanceToOrAfter(series, range.start);

  while (rangeContains(range, date) && results.length < limit) {
    results.push({ date, amount: series.expectedAmount, confidence: series.confidence });

    const next = advanceToOrAfter({ ...series, nextExpectedDate: date }, addDays(date, 1));
    if (next <= date) break;
    date = next;
  }

  return results;
}

/** A calendar month's worth of expected recurring claims, for the cash-flow view. */
export function expectedInMonth(
  seriesList: readonly RecurringSeries[],
  anyDayInMonth: PlainDate,
  currency: CurrencyCode,
): Money {
  const range = createDateRange(startOfMonth(anyDayInMonth), endOfMonth(anyDayInMonth));

  const amounts = seriesList.flatMap((series) =>
    expectedOccurrences(series, range).map((occurrence) => occurrence.amount),
  );

  return Money.sum(amounts, currency);
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  const top = numerator < 0n ? -numerator : numerator;
  const bottom = denominator < 0n ? -denominator : denominator;
  return Number((top * 1_000_000n) / bottom) / 1_000_000;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
