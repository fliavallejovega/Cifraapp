import type { Money } from '@app/domain';

/**
 * The statistical primitives the budget and forecast passes are built on.
 *
 * Everything here is a median or a deviation around one, never a mean. A
 * household's spending history is full of one-off shocks — a flight, a car
 * repair, a deposit — and a mean lets a single January move every month of the
 * forecast. The median ignores it, which is the honest behaviour: an unusual
 * month was unusual.
 *
 * Ratios are computed from exact scaled units and only then converted to a
 * number, because the result is a dimensionless measure of dispersion, not an
 * amount. No monetary value is ever a float.
 */

const RATIO_PRECISION = 1_000_000n;

/** A dimensionless ratio between two exact unit counts. Never money. */
export function unitRatio(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  const top = numerator < 0n ? -numerator : numerator;
  const bottom = denominator < 0n ? -denominator : denominator;
  return Number((top * RATIO_PRECISION) / bottom) / Number(RATIO_PRECISION);
}

/**
 * The middle value. With an even count, the midpoint of the two middle ones —
 * rounded once, at the end, like every other monetary division in this system.
 */
export function median(values: readonly Money[]): Money | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => (a.scaledUnits < b.scaledUnits ? -1 : 1));
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }

  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (!lower || !upper) return null;
  return lower.add(upper).divide(2);
}

/** The middle value of a list of plain numbers — used for day and interval counts. */
export function medianNumber(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * How much a set of amounts varies around its own median, as a fraction of that
 * median. Zero means identical every time; 0.2 means a typical amount sits 20%
 * away from the usual one.
 *
 * Median absolute deviation rather than standard deviation, for the same reason
 * the centre is a median: one outlier should not decide how confident the system
 * claims to be.
 */
export function relativeVariation(values: readonly Money[]): number {
  const centre = median(values);
  if (!centre || centre.isZero()) return values.length > 1 ? 1 : 0;

  const deviations = values.map((value) => value.subtract(centre).abs());
  const typical = median(deviations);
  if (!typical) return 0;

  return unitRatio(typical.scaledUnits, centre.scaledUnits);
}
