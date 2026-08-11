import { Money } from '@app/domain';

/**
 * What changing plan mid-period costs.
 *
 * A household that upgrades on day 20 of a 30-day month has already paid for ten
 * days of the plan they are leaving. Charging the new plan in full and keeping
 * the remainder is a small theft repeated monthly; refunding the whole old plan
 * is the same in reverse.
 *
 * The split uses `Money.allocate`, which distributes without losing a cent to
 * rounding — the guarantee this whole system's money type exists for. Dividing
 * by days and multiplying back would lose fractions of a cent on most inputs,
 * and a billing system that does not reconcile to the cent is a support queue.
 */

export interface ProrationInput {
  readonly from: Money;
  readonly to: Money;
  readonly daysElapsed: number;
  readonly daysInPeriod: number;
}

export interface Proration {
  /** The unused portion of the plan being left. */
  readonly credit: Money;
  /** The remaining portion of the plan being joined. */
  readonly charge: Money;
  /** Charge less credit. Negative means the household is owed the difference. */
  readonly net: Money;
}

export function prorate(input: ProrationInput): Proration {
  const { from, to, daysInPeriod } = input;

  const elapsed = Math.max(0, Math.min(input.daysElapsed, daysInPeriod));
  const remaining = daysInPeriod - elapsed;

  if (daysInPeriod <= 0 || remaining <= 0) {
    const zero = Money.zero(to.currency);
    return { credit: zero, charge: zero, net: zero };
  }

  // `allocate` splits the whole amount across the two shares exactly; the second
  // share is the unused part. Nothing is computed as a rate and multiplied back.
  const credit = from.allocate([elapsed, remaining])[1] ?? Money.zero(from.currency);
  const charge = to.allocate([elapsed, remaining])[1] ?? Money.zero(to.currency);

  return { credit, charge, net: charge.subtract(credit) };
}

/**
 * Days between two calendar dates, inclusive of the first and exclusive of the
 * second — the way a billing period is counted.
 */
export function daysInPeriod(start: string, end: string): number {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 0;

  return Math.max(0, Math.round((endMs - startMs) / 86_400_000));
}
