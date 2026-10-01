import { divide, fromMinor, toMinor, toScaled } from './units.js';

/**
 * Currency conversion for the trip.
 *
 * A rate is always «local units per one unit of the base currency» (1 USD =
 * 0.92 EUR is `0.92`), held at ten decimals as the database does. Conversion
 * multiplies integers and rounds once, half-up, into the target currency's
 * minor units. The model never converts anything.
 */

const RATE_SCALE = 10;
const RATE_FACTOR = 10n ** BigInt(RATE_SCALE);

export const rateUnits = (rate: string): bigint => toScaled(rate, RATE_SCALE);

/** Base minor units to local minor units. */
export function baseToLocalUnits(
  units: bigint,
  rate: string,
  baseMinor: number,
  localMinor: number,
): bigint {
  return divide(
    units * rateUnits(rate) * 10n ** BigInt(localMinor),
    RATE_FACTOR * 10n ** BigInt(baseMinor),
  );
}

/** Local minor units to base minor units. */
export function localToBaseUnits(
  units: bigint,
  rate: string,
  localMinor: number,
  baseMinor: number,
): bigint {
  const r = rateUnits(rate);
  if (r <= 0n) throw new RangeError('An exchange rate must be positive.');
  return divide(units * RATE_FACTOR * 10n ** BigInt(baseMinor), r * 10n ** BigInt(localMinor));
}

/** Decimal-string convenience over `localToBaseUnits`. */
export function convertToBase(
  localValue: string,
  rate: string,
  local: { minorUnits: number },
  base: { minorUnits: number },
): string {
  const units = localToBaseUnits(
    toMinor(localValue, local.minorUnits),
    rate,
    local.minorUnits,
    base.minorUnits,
  );
  return fromMinor(units, base.minorUnits);
}

export function convertToLocal(
  baseValue: string,
  rate: string,
  base: { minorUnits: number },
  local: { minorUnits: number },
): string {
  const units = baseToLocalUnits(
    toMinor(baseValue, base.minorUnits),
    rate,
    base.minorUnits,
    local.minorUnits,
  );
  return fromMinor(units, local.minorUnits);
}

/**
 * The exchange effect on a trip: what the expenses cost in base currency at
 * the rates actually paid, minus what they would have cost at the planning
 * rate. Positive means the exchange rate made the trip more expensive.
 */
export function exchangeEffect(
  expenses: readonly {
    localAmount: string;
    localMinor: number;
    currency: string;
    baseAmount: string;
  }[],
  planningRates: Readonly<Record<string, { rate: string } | undefined>>,
  baseMinor: number,
): string {
  let effect = 0n;
  for (const expense of expenses) {
    const planned = planningRates[expense.currency];
    if (!planned) continue;
    const atPlan = localToBaseUnits(
      toMinor(expense.localAmount, expense.localMinor),
      planned.rate,
      expense.localMinor,
      baseMinor,
    );
    effect += toMinor(expense.baseAmount, baseMinor) - atPlan;
  }
  return fromMinor(effect, baseMinor);
}

/** A planning rate moved by `percent` (positive: the local currency gets more expensive). */
export function shiftedRate(rate: string, percent: string): string {
  // Local per base falls when the local currency strengthens.
  const r = rateUnits(rate);
  const p = toScaled(percent, 4);
  const shifted = divide(r * 1_000_000n, 1_000_000n + p);
  return fromMinor(shifted, RATE_SCALE);
}
