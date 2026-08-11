import { Money } from '@app/domain';

import type { TaxEstimate } from './types.js';

/**
 * The tax reserve: money that arrived but was never the household's to spend.
 *
 * For an independent professional this is the single most useful thing the
 * product does. Income arrives in full, feels available, gets spent, and the
 * bill lands months later against money that is gone. Reserving as income
 * arrives is the whole mechanism.
 *
 * The language is fixed and the spec is explicit about it: **"estimated tax
 * reserve", never "your tax bill"**, unless it was computed from a finalized
 * return. Nothing in this file produces the second thing.
 */

export interface ReserveInput {
  /** An estimate over the household's projected income for the whole year. */
  readonly annual: TaxEstimate;
  /** What has actually arrived so far this fiscal year. */
  readonly incomeToDate: Money;
  /** What is already set aside. */
  readonly reservedToDate: Money;
}

export interface ReserveResult {
  /** What should be set aside by now, given the income that has arrived. */
  readonly target: Money;
  /** Target less what is already reserved. Zero when the household is ahead. */
  readonly additional: Money;
  /** Positive when more is reserved than the estimate calls for. */
  readonly surplus: Money;
  /** The rate the reserve is being taken at, 0–1. */
  readonly effectiveRate: number | null;
  /**
   * False when the rule set behind the estimate has not been reviewed and
   * published. The amount is still computed — that is how a draft gets checked
   * — but nothing may show it to a household as a tax figure.
   */
  readonly presentable: boolean;
}

/**
 * The reserve, in proportion to income actually received.
 *
 * Not the whole annual estimate up front. A household that has earned a third of
 * its projected year owes roughly a third of the estimate, and demanding the
 * full amount in January would make the number useless and the feature ignored.
 *
 * Proportional against *projected* income, so the progressive rate that applies
 * at the year's total is the rate reserved at — reserving each payment at the
 * rate its own size would attract would under-reserve every time.
 */
export function computeReserve(input: ReserveInput): ReserveResult {
  const { annual, incomeToDate, reservedToDate } = input;
  const zero = Money.zero(annual.currency);

  const target = annual.grossIncome.isPositive()
    ? proportional(annual.estimatedTax, incomeToDate, annual.grossIncome)
    : zero;

  const difference = target.subtract(reservedToDate);

  return {
    target,
    additional: Money.max(difference, zero),
    surplus: Money.max(difference.negate(), zero),
    effectiveRate: annual.effectiveRate,
    presentable: annual.presentable,
  };
}

/**
 * `tax × received ÷ projected`, as one exact fraction.
 *
 * Multiplying before dividing, in integer units, so nothing rounds in the
 * middle. Dividing first would round a rate to four decimals and then multiply
 * the error by a year of income.
 */
function proportional(tax: Money, received: Money, projected: Money): Money {
  if (!projected.isPositive() || !received.isPositive()) return Money.zero(tax.currency);

  const ratioNumerator = tax.scaledUnits * received.scaledUnits;
  const units = divideHalfUp(ratioNumerator, projected.scaledUnits);

  // A household that has already earned more than projected reserves against the
  // whole estimate and no more; the excess is next year's problem, not a reserve
  // this year's rules can price.
  return Money.min(Money.fromScaledUnits(units, tax.currency), tax);
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return (numerator % denominator) * 2n >= denominator ? quotient + 1n : quotient;
}
