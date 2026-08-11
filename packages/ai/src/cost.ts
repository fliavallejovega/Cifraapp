import { Money, type CurrencyCode } from '@app/domain';

import type { ProviderId, TokenUsage } from './types.js';

/**
 * What a call cost, without lying about it in either direction.
 *
 * Model pricing is quoted per million tokens, so a single short classification
 * costs a fraction of a hundredth of a cent. `Money` carries four decimals — the
 * right precision for a household's ledger and far too coarse for this — and
 * rounding each call to it would report a month of real spending as zero.
 *
 * So the unit of account here is the **micro-dollar**: an integer millionth of a
 * currency unit, exact under `bigint`, accumulated across calls and converted to
 * `Money` once, at the point a person reads it. Token counts remain the
 * authoritative record in the database; cost is derived from them and always
 * labelled as an estimate, because the provider's invoice is the only figure
 * that is not.
 */

export const MICROS_PER_UNIT = 1_000_000n;
const TOKENS_PER_PRICE_UNIT = 1_000_000n;

export interface ModelPricing {
  readonly provider: ProviderId;
  readonly model: string;
  /** Micro-dollars per million input tokens. Held as an integer, never a float. */
  readonly inputMicrosPerMillion: bigint;
  readonly outputMicrosPerMillion: bigint;
  readonly currency: CurrencyCode;
}

export type PricingLookup = (provider: ProviderId, model: string) => ModelPricing | undefined;

/**
 * Exact micro-dollars for a usage record.
 *
 * Integer arithmetic throughout: `tokens × price ÷ 1e6` with the division last,
 * so nothing rounds until it has to, and what does round rounds half-up once.
 */
export function usageMicros(pricing: ModelPricing, usage: TokenUsage): bigint {
  const input = BigInt(Math.max(0, Math.trunc(usage.inputTokens)));
  const output = BigInt(Math.max(0, Math.trunc(usage.outputTokens)));

  const scaled = input * pricing.inputMicrosPerMillion + output * pricing.outputMicrosPerMillion;
  return divideHalfUp(scaled, TOKENS_PER_PRICE_UNIT);
}

/**
 * Micro-dollars as `Money`, for display and for comparison against a budget.
 *
 * `Money` holds four decimals, so this divides by 100 and rounds half-up. A
 * single call usually lands on zero; a month of them does not, which is the
 * whole reason the accumulation happens in micros first.
 */
export function microsToMoney(micros: bigint, currency: CurrencyCode): Money {
  return Money.fromScaledUnits(divideHalfUp(micros, 100n), currency);
}

/** The reverse, for reading a stored `numeric(19,4)` budget cap back into micros. */
export function moneyToMicros(value: Money): bigint {
  return value.scaledUnits * 100n;
}

/** Parses `'3.00'` dollars per million tokens into micro-dollars per million. */
export function pricePerMillionFromDecimal(value: string): bigint {
  const match = /^(-)?(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) {
    throw new TypeError(`"${value}" is not a usable price per million tokens.`);
  }

  const [, sign, whole = '0', fraction = ''] = match;
  const micros = BigInt(whole) * MICROS_PER_UNIT + BigInt(fraction.padEnd(6, '0') || '0');
  return sign === '-' ? -micros : micros;
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const top = numerator < 0n ? -numerator : numerator;
  const bottom = denominator < 0n ? -denominator : denominator;

  const quotient = top / bottom;
  const rounded = (top % bottom) * 2n >= bottom ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}
