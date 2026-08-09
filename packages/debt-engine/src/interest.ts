import { addDays, daysBetween, Money, type PlainDate } from '@app/domain';

import type { Debt } from './types.js';

/**
 * Daily interest accrual.
 *
 * Credit card interest is charged daily and compounds daily. Approximating it as
 * `balance × apr ÷ 12` understates a 24.5% card by real money over a year, and a
 * payoff plan built on an understated cost tells the household it will be free
 * of the card months before it is.
 *
 * The whole accrual is computed as one exact rational and rounded once, at the
 * end — never once per day. That is the specific reason `Money` carries four
 * decimal places rather than two (ADR-005): thirty roundings to the cent, each
 * biased the same direction, is a systematic error, and it lands on the side
 * that flatters the plan.
 *
 * An APR is written as a percentage with up to three decimals, so `'24.500'` is
 * 24 500 thousandths of a percent. A day's growth is therefore exactly
 * `(36 500 000 + thousandths) / 36 500 000`, which is a ratio of two integers
 * and stays a ratio of two integers all the way through.
 */

/** Thousandths of a percent, over a 365-day year. */
const DAILY_DENOMINATOR = 36_500_000n;

const APR_PATTERN = /^(-)?(\d+)(?:\.(\d{1,3}))?$/;

/** Parses `'24.500'` into 24 500 thousandths of a percent. */
export function aprToThousandths(apr: string): bigint {
  const match = APR_PATTERN.exec(apr.trim());
  if (!match) {
    throw new TypeError(`"${apr}" is not a usable annual rate.`);
  }

  const [, sign, whole = '0', fraction = ''] = match;
  const thousandths = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0') || '0');
  return sign === '-' ? -thousandths : thousandths;
}

/**
 * The interest a balance accrues over a number of days, compounding daily.
 *
 * Returns the interest alone, not the new balance, because the two are recorded
 * separately: a payment splits into interest and principal, and a household that
 * cannot see the split cannot see why a $185 payment moved the balance by $60.
 */
export function accrueInterest(balance: Money, apr: string, days: number): Money {
  if (days <= 0 || balance.isZero()) return Money.zero(balance.currency);

  const thousandths = aprToThousandths(apr);
  if (thousandths <= 0n) return Money.zero(balance.currency);

  const numerator = (DAILY_DENOMINATOR + thousandths) ** BigInt(days);
  const denominator = DAILY_DENOMINATOR ** BigInt(days);

  // balance × (growth^days − 1), as one exact fraction. Rounded here and only
  // here.
  const grownUnits = divideHalfUp(balance.scaledUnits * numerator, denominator);
  return Money.fromScaledUnits(grownUnits - balance.scaledUnits, balance.currency);
}

/**
 * The rate in force on a given day.
 *
 * A promotional rate is a real rate until it expires, and treating a 0% balance
 * transfer as if it cost 24.5% would send the avalanche strategy after the wrong
 * card for the entire promotional window.
 */
export function effectiveApr(debt: Debt, on: PlainDate): string {
  if (debt.promotionalApr && debt.promotionalExpiresOn && on <= debt.promotionalExpiresOn) {
    return debt.promotionalApr;
  }
  return debt.apr;
}

/**
 * Accrues across a window that a promotional rate expires inside.
 *
 * Splitting the window matters at exactly the moment it is most expensive to get
 * wrong: the month a 0% teaser ends, when the balance starts costing money
 * partway through.
 */
export function accrueAcrossWindow(
  debt: Debt,
  balance: Money,
  windowStart: PlainDate,
  days: number,
): Money {
  const expiry = debt.promotionalExpiresOn;

  if (!debt.promotionalApr || !expiry) {
    return accrueInterest(balance, debt.apr, days);
  }

  const windowEnd = addDays(windowStart, days - 1);
  if (windowEnd <= expiry) return accrueInterest(balance, debt.promotionalApr, days);
  if (windowStart > expiry) return accrueInterest(balance, debt.apr, days);

  // The promotional rate covers up to and including the expiry date; the
  // ordinary rate compounds on top of what the promotional window left.
  const promotionalDays = daysBetween(windowStart, expiry) + 1;
  const promotional = accrueInterest(balance, debt.promotionalApr, promotionalDays);
  const ordinary = accrueInterest(balance.add(promotional), debt.apr, days - promotionalDays);

  return promotional.add(ordinary);
}

/**
 * Credit utilization, 0–1, or null when the debt has no limit.
 *
 * Null rather than zero: a mortgage has no utilization, and reporting it as 0%
 * would make a household's overall utilization look better than it is.
 */
export function utilization(balance: Money, creditLimit: Money | null | undefined): number | null {
  if (!creditLimit?.isPositive()) return null;
  const ratio = (balance.scaledUnits * 1_000_000n) / creditLimit.scaledUnits;
  return Number(ratio) / 1_000_000;
}

/** Integer division rounding halves away from zero. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const top = numerator < 0n ? -numerator : numerator;
  const bottom = denominator < 0n ? -denominator : denominator;

  const quotient = top / bottom;
  const remainder = top % bottom;
  const rounded = remainder * 2n >= bottom ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}
