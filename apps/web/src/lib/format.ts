import type { Money } from '@app/domain';

/**
 * Formatting that more than one screen needs, agreed once.
 *
 * Small, and worth having. A date rendered two different ways on two screens is
 * the sort of detail that makes a product feel assembled rather than designed —
 * and a percentage rounded differently in two places is worse than that, because
 * one of the two will be the figure somebody quotes.
 */

/** A `PlainDate` read the way the household writes dates, never shifted. */
export function formatPlainDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    // UTC, always. A financial date is a calendar day, and rendering it in the
    // reader's zone is how a transaction moves to the previous month at 7pm.
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

/** A timestamp — an audit entry, a sign-in — where the moment does matter. */
export function formatMoment(value: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(value);
}

/**
 * One figure as a percentage of another, rounded to a whole number.
 *
 * Deliberately not `Money`: this is a ratio for a person to read, not an amount
 * anything is computed from. Nothing derived from this ever reaches a column.
 */
export function percentOf(part: Money, whole: Money): number {
  const divisor = Number(whole.toDecimalString());
  if (divisor === 0) return 0;
  return Math.round((Number(part.toDecimalString()) / divisor) * 100);
}

/** Bounded to the width of a progress bar, which cannot exceed itself. */
export function clampedPercent(part: Money, whole: Money): number {
  return Math.max(0, Math.min(100, percentOf(part, whole)));
}

/** `24.500` as the column stores it; `24.5` as a person wrote it. */
export function trimRate(rate: string): string {
  return rate.includes('.') ? rate.replace(/0+$/, '').replace(/\.$/, '') : rate;
}

/**
 * `1000.0000` as `numeric(19,4)` stores it; `1000` as a person typed it.
 *
 * For putting a stored amount back into the field it came from. Trailing
 * zeroes past the cents are the column's business, not the form's, and a
 * person who typed «1000» should not be shown «1000.0000» and asked whether
 * that is still right.
 */
export function trimAmount(amount: string): string {
  if (!amount.includes('.')) return amount;
  const trimmed = amount.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}
