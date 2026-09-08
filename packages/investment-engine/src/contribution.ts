import { Money } from '@app/domain';

/**
 * How much has to go in every month to reach a target.
 *
 * The future value of an ordinary annuity plus the growth of what is already
 * held, solved for the payment. Written out rather than pulled from a library
 * because the rounding matters: every intermediate step stays in `Money`, and
 * the answer is rounded up to the cent, because rounding a required
 * contribution *down* produces a plan that misses its target by construction.
 *
 * The rate is a monthly rate derived from an annual assumption, and the
 * derivation is the plain division rather than the twelfth root. A household
 * checking this on paper will divide by twelve, and a figure they cannot
 * reproduce is a figure they will not trust — the difference across these
 * horizons is smaller than the width of the assumption band.
 */

export interface ContributionInput {
  readonly target: Money;
  readonly current: Money;
  readonly months: number;
  /** Whole percent a year, as a decimal string: `'6'`, `'4.5'`. */
  readonly annualRatePercent: string;
}

export interface ContributionResult {
  /** What has to go in each month. Zero when the target is already met. */
  readonly monthly: Money;
  /** What the household puts in, in total. */
  readonly contributed: Money;
  /** target − contributed − current. What the assumption is doing for them. */
  readonly growth: Money;
  /** True when no contribution reaches the target, at any amount. */
  readonly unreachable: boolean;
}

/** Scaled integer arithmetic, so nothing rounds until the answer. */
const SCALE = 1_000_000n;

function monthlyRateScaled(annualRatePercent: string): bigint {
  // `'6'` and `'6.25'` both arrive as decimal strings; the scale carries them.
  const [whole = '0', fraction = ''] = annualRatePercent.replace('-', '').split('.');
  const padded = `${fraction}000000`.slice(0, 6);
  const magnitude = BigInt(whole) * SCALE + BigInt(padded);
  const signed = annualRatePercent.startsWith('-') ? -magnitude : magnitude;

  // percent → rate, then per month.
  return signed / 100n / 12n;
}

export function requiredContribution(input: ContributionInput): ContributionResult {
  const currency = input.target.currency;
  const zero = Money.zero(currency);
  const months = Math.max(0, Math.trunc(input.months));

  const missing = input.target.subtract(input.current);

  if (!missing.isPositive()) {
    return { monthly: zero, contributed: zero, growth: zero, unreachable: false };
  }

  if (months === 0) {
    // The date is today and the money is not there. No monthly amount fixes
    // that, and saying «$0 a month» would be worse than saying so.
    return { monthly: zero, contributed: zero, growth: zero, unreachable: true };
  }

  const rate = monthlyRateScaled(input.annualRatePercent);

  // With no growth assumption the answer is the plain division, and taking the
  // annuity path would divide by zero.
  if (rate === 0n) {
    const monthly = divideUp(missing, months);
    const contributed = monthly.multiply(months);
    return {
      monthly,
      contributed,
      growth: input.target.subtract(contributed).subtract(input.current),
      unreachable: false,
    };
  }

  // (1 + r)^n, in scaled integers.
  const factor = power(SCALE + rate, months);

  // What today's balance becomes on its own.
  const grown = input.current.multiply(scaledToDecimal(factor));
  const stillMissing = input.target.subtract(grown);

  if (!stillMissing.isPositive()) {
    // The existing balance gets there without another cent going in.
    return {
      monthly: zero,
      contributed: zero,
      growth: input.target.subtract(input.current),
      unreachable: false,
    };
  }

  // payment = missing × r ÷ ((1 + r)^n − 1)
  const denominator = factor - SCALE;
  if (denominator <= 0n) {
    return { monthly: zero, contributed: zero, growth: zero, unreachable: true };
  }

  const monthly = ceilToCurrency(
    stillMissing.multiply(scaledToDecimal(rate)).divide(scaledToDecimal(denominator)),
  );

  const contributed = monthly.multiply(months);

  return {
    monthly,
    contributed,
    growth: input.target.subtract(contributed).subtract(input.current),
    unreachable: false,
  };
}

/**
 * Where a monthly contribution lands after so many months.
 *
 * The other direction, and the one a household usually asks first: «I can put
 * in $200 — where does that get me?»
 */
export function projectContribution(input: {
  readonly monthly: Money;
  readonly current: Money;
  readonly months: number;
  readonly annualRatePercent: string;
}): Money {
  const months = Math.max(0, Math.trunc(input.months));
  if (months === 0) return input.current;

  const rate = monthlyRateScaled(input.annualRatePercent);

  if (rate === 0n) {
    return input.current.add(input.monthly.multiply(months));
  }

  const factor = power(SCALE + rate, months);
  const grown = input.current.multiply(scaledToDecimal(factor));

  // The annuity: payment × ((1 + r)^n − 1) ÷ r
  const contributions = input.monthly
    .multiply(scaledToDecimal(factor - SCALE))
    .divide(scaledToDecimal(rate));

  return grown.add(contributions).roundToCurrencyPrecision();
}

/** Exponentiation by squaring, so a sixty-year horizon is not sixty multiplies. */
function power(base: bigint, exponent: number): bigint {
  let result = SCALE;
  let factor = base;
  let remaining = exponent;

  while (remaining > 0) {
    if (remaining % 2 === 1) result = (result * factor) / SCALE;
    factor = (factor * factor) / SCALE;
    remaining = Math.floor(remaining / 2);
  }

  return result;
}

/** A scaled integer as the decimal string `Money` multiplies by. */
function scaledToDecimal(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / SCALE;
  const fraction = (magnitude % SCALE).toString().padStart(6, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

/** Division that never leaves the household a cent short of the target. */
function divideUp(amount: Money, divisor: number): Money {
  return ceilToCurrency(amount.divide(divisor));
}

/**
 * Up to the next cent, always.
 *
 * `Money` offers half-up, half-even and down, and none of them is right for a
 * required contribution: rounding $412.4999 down to $412.49 produces a plan
 * that misses its target by construction. A cent a month is nothing; a plan
 * that cannot reach the number printed above it is not a plan.
 */
function ceilToCurrency(amount: Money): Money {
  const floored = amount.roundToCurrencyPrecision('down');
  if (floored.equals(amount)) return floored;
  return floored.add(Money.fromMinorUnits(1n, amount.currency));
}
