import {
  addDays,
  addMonths,
  daysBetween,
  endOfMonth,
  plainDateFromParts,
  type PlainDate,
} from '@app/domain';

import { median, medianNumber, relativeVariation } from './statistics.js';
import type { Frequency, Occurrence, RecurringSeries } from './types.js';

/**
 * Recurring detection.
 *
 * Rent, salary, subscriptions, utilities and insurance are the skeleton of a
 * household's month. Finding them is what turns a pile of transactions into a
 * forecast — and what lets safe-to-spend subtract the rent that has not been
 * charged yet instead of pretending the money is available.
 *
 * Two occurrences are refused on purpose. One gap tells you two events were 30
 * days apart; it does not tell you they will be 30 days apart again. Three
 * occurrences give two intervals, which is the minimum evidence for a cadence.
 */

/** Two occurrences give one gap. A gap is not a cadence. */
export const MIN_OCCURRENCES = 3;

/** Below this, the pattern is reported as nothing rather than as a maybe. */
export const RECURRING_CONFIDENCE_FLOOR = 0.6;

interface Cadence {
  readonly frequency: Frequency;
  readonly days: number;
  /** How far an interval may drift and still count as this cadence. */
  readonly tolerance: number;
}

/**
 * Ordered narrowest-first. `semimonthly` is checked separately, by calendar day
 * rather than by interval, because its gaps alternate between 13 and 16 days and
 * no single interval describes it.
 */
const CADENCES: readonly Cadence[] = [
  { frequency: 'weekly', days: 7, tolerance: 2 },
  { frequency: 'biweekly', days: 14, tolerance: 3 },
  { frequency: 'monthly', days: 30, tolerance: 4 },
  { frequency: 'quarterly', days: 91, tolerance: 12 },
  { frequency: 'annual', days: 365, tolerance: 25 },
];

/**
 * Finds the cadence in a set of occurrences that already belong together.
 *
 * The caller groups — by merchant, or by a description family. Grouping here
 * would mean loading a household's entire history to answer a question about one
 * subscription.
 */
export function detectRecurrence(occurrences: readonly Occurrence[]): RecurringSeries | null {
  if (occurrences.length < MIN_OCCURRENCES) return null;

  const sorted = [...occurrences].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const intervals: number[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (!previous || !current) continue;
    intervals.push(daysBetween(previous.date, current.date));
  }

  if (intervals.length === 0) return null;

  const anchors = semimonthlyAnchors(sorted);
  const cadence = anchors
    ? { frequency: 'semimonthly' as const, days: 15, tolerance: 3 }
    : matchCadence(medianNumber(intervals));

  if (!cadence) return null;

  const amounts = sorted.map((occurrence) => occurrence.amount);
  const expectedAmount = median(amounts);
  if (!expectedAmount) return null;

  const timingScore = scoreTiming(intervals, cadence);
  const amountVariation = relativeVariation(amounts);
  // Utilities genuinely swing month to month and are still plainly recurring, so
  // an unstable amount reduces confidence gently rather than disqualifying.
  const amountScore = clamp(1 - amountVariation / 0.5, 0, 1);
  const countScore = clamp((sorted.length - MIN_OCCURRENCES) / 3, 0, 1);

  const confidence = clamp(
    0.35 + 0.35 * timingScore + 0.15 * amountScore + 0.15 * countScore,
    0,
    0.98,
  );

  if (confidence < RECURRING_CONFIDENCE_FLOOR) return null;

  const last = sorted[sorted.length - 1];
  if (!last) return null;

  return {
    frequency: cadence.frequency,
    expectedAmount,
    lastSeen: last.date,
    nextExpectedDate: nextOccurrence(cadence.frequency, last.date, anchors ?? undefined),
    confidence,
    occurrenceCount: sorted.length,
    amountVariation,
    ...(anchors ? { anchorDays: anchors } : {}),
    explanation: describe(cadence.frequency, sorted.length, amountVariation),
  };
}

/**
 * The first expected date on or after a given day.
 *
 * `nextExpectedDate` on the series is the next one after the last sighting,
 * which is what makes a missed payment visible. Cash-flow planning needs the
 * next one that has not happened yet, which is this.
 */
export function advanceToOrAfter(series: RecurringSeries, from: PlainDate): PlainDate {
  let date = series.nextExpectedDate;
  // Bounded so a series that somehow fails to advance can never spin. Twelve
  // years of weekly steps is far past any horizon this system plans over.
  for (let step = 0; step < 700 && date < from; step += 1) {
    const next = nextOccurrence(series.frequency, date, series.anchorDays);
    if (next <= date) break;
    date = next;
  }
  return date;
}

function matchCadence(medianInterval: number): Cadence | null {
  for (const cadence of CADENCES) {
    if (Math.abs(medianInterval - cadence.days) <= cadence.tolerance) return cadence;
  }
  return null;
}

/**
 * Recognizes the two-fixed-days pattern that most Panamanian salaries follow.
 *
 * Requires occurrences to land on exactly two calendar days across at least two
 * months. A biweekly series drifts through the calendar and will not satisfy it,
 * which is the point: the two cadences produce a different number of payments
 * per year and confusing them invents a paycheck.
 */
function semimonthlyAnchors(sorted: readonly Occurrence[]): number[] | null {
  if (sorted.length < 4) return null;

  const days = sorted.map((occurrence) => dayOfMonth(occurrence.date));
  const distinct = [...new Set(days)].sort((a, b) => a - b);

  // Month-end lands on 28, 29, 30 or 31 depending on the month; treat the tail
  // of the month as one anchor.
  const collapsed = collapseMonthEnd(distinct);
  if (collapsed.length !== 2) return null;

  const months = new Set(sorted.map((occurrence) => occurrence.date.slice(0, 7)));
  if (months.size < 2) return null;

  return collapsed;
}

function collapseMonthEnd(days: readonly number[]): number[] {
  const early = days.filter((day) => day < 28);
  const late = days.filter((day) => day >= 28);
  return late.length > 0 ? [...early, 31] : [...early];
}

function scoreTiming(intervals: readonly number[], cadence: Cadence): number {
  const drift = medianNumber(intervals.map((interval) => Math.abs(interval - cadence.days)));
  return clamp(1 - drift / cadence.tolerance, 0, 1);
}

function nextOccurrence(
  frequency: Frequency,
  from: PlainDate,
  anchors?: readonly number[],
): PlainDate {
  switch (frequency) {
    case 'weekly':
      return addDays(from, 7);
    case 'biweekly':
      return addDays(from, 14);
    case 'monthly':
      return addMonths(from, 1);
    case 'quarterly':
      return addMonths(from, 3);
    case 'annual':
      return addMonths(from, 12);
    case 'semimonthly':
      return nextAnchor(from, anchors ?? [15, 31]);
  }
}

/**
 * The next of the month's anchor days after `from`, rolling into next month.
 *
 * Anchors are compared *after* clamping to the month's real length. The month-end
 * anchor is stored as 31, and in a 30-day month the raw comparison `31 > 30`
 * looks like a future date while the clamped result is the day we are already
 * on — which stalls the series on June 30 forever.
 */
function nextAnchor(from: PlainDate, anchors: readonly number[]): PlainDate {
  const currentDay = dayOfMonth(from);
  const lastDay = dayOfMonth(endOfMonth(from));
  const sorted = [...anchors].sort((a, b) => a - b);

  for (const anchor of sorted) {
    const day = Math.min(anchor, lastDay);
    if (day > currentDay) return onDay(from, day);
  }

  const nextMonth = addMonths(startOfMonthDate(from), 1);
  return onDay(nextMonth, sorted[0] ?? 1);
}

/** The given day of `date`'s month, clamped to the month's real length. */
function onDay(date: PlainDate, day: number): PlainDate {
  const lastDay = dayOfMonth(endOfMonth(date));
  const [year = '0', month = '1'] = date.split('-');
  return plainDateFromParts(Number(year), Number(month), Math.min(day, lastDay));
}

function startOfMonthDate(date: PlainDate): PlainDate {
  const [year = '0', month = '1'] = date.split('-');
  return plainDateFromParts(Number(year), Number(month), 1);
}

function dayOfMonth(date: PlainDate): number {
  return Number(date.slice(8, 10));
}

function describe(frequency: Frequency, count: number, variation: number): string {
  const cadence: Record<Frequency, string> = {
    weekly: 'every week',
    biweekly: 'every two weeks',
    semimonthly: 'twice a month',
    monthly: 'every month',
    quarterly: 'every quarter',
    annual: 'once a year',
  };

  const steadiness = variation < 0.05 ? 'for the same amount' : 'for a varying amount';
  return `We saw this ${cadence[frequency]}, ${String(count)} times, ${steadiness}.`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
