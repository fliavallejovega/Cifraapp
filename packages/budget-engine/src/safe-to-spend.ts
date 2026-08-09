import { addDays, Money, type CurrencyCode, type PlainDate } from '@app/domain';

import type { UpcomingObligation } from './types.js';

/**
 * Safe-to-spend.
 *
 * This is the number the product exists to produce, and the one every other
 * personal finance tool gets wrong by reporting the account balance. A balance
 * says what cleared. It says nothing about the rent due on the first, the card
 * minimum due on the ninth, or the tax the household will owe on income it has
 * already received.
 *
 *   liquid cash
 *   − committed expenses
 *   − upcoming mandatory obligations
 *   − minimum debt payments
 *   − tax reserves
 *   − goal allocations
 *   − minimum cash buffer
 *   = safe to spend
 *
 * The deductions are applied in that order and each one records how much of it
 * the household can actually cover. That ordering is not presentational: when
 * the money runs out partway down, the household needs to know *which* claim is
 * unfunded, and "your rent is short $180" is a different message from "you are
 * $180 short".
 *
 * The result is never clamped at zero. A negative safe-to-spend is the single
 * most important thing this system can tell someone, and hiding it behind a
 * floor of zero would be a lie of exactly the kind the product exists to stop.
 */

export const DEFAULT_HORIZON_DAYS = 30;

export type DeductionKind =
  'committed' | 'obligations' | 'debt_minimums' | 'tax_reserve' | 'goals' | 'buffer';

export interface Deduction {
  readonly kind: DeductionKind;
  /** What the claim asks for. */
  readonly claimed: Money;
  /** What the household's liquid cash actually covers. */
  readonly covered: Money;
  /** claimed − covered. Non-zero means this claim has no money behind it. */
  readonly uncovered: Money;
}

export interface SafeToSpendInput {
  readonly currency: CurrencyCode;
  readonly today: PlainDate;
  readonly liquid: Money;
  /** Budgeted spending already spoken for inside the current period. */
  readonly committedSpending?: Money;
  readonly obligations?: readonly UpcomingObligation[];
  readonly minimumDebtPayments?: Money;
  /** Estimated, never "your tax bill" — see the copy register. */
  readonly taxReserve?: Money;
  readonly goalAllocations?: Money;
  /** The floor the household refuses to go below. */
  readonly bufferMinimum?: Money;
  readonly horizonDays?: number;
}

export interface SafeToSpendResult {
  readonly currency: CurrencyCode;
  readonly liquid: Money;
  readonly deductions: readonly Deduction[];
  readonly totalClaimed: Money;
  readonly safeToSpend: Money;
  /** True when some claim in the ladder has no money behind it. */
  readonly isShortfall: boolean;
  readonly shortfall: Money;
  /** The obligations counted, in the order they were funded. */
  readonly countedObligations: readonly UpcomingObligation[];
  readonly horizon: PlainDate;
}

export function computeSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const { currency } = input;
  const zero = Money.zero(currency);
  const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const horizon = addDays(input.today, horizonDays);

  // Essential first, then by due date. When cash runs out partway down the
  // ladder, what goes unfunded should be the discretionary claim, not the rent.
  const countedObligations = (input.obligations ?? [])
    .filter((obligation) => obligation.due <= horizon)
    .sort((a, b) => {
      if (a.isEssential !== b.isEssential) return a.isEssential ? -1 : 1;
      return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
    });

  const obligationTotal = Money.sum(
    countedObligations.map((obligation) => obligation.amount),
    currency,
  );

  const claims: { kind: DeductionKind; claimed: Money }[] = [
    { kind: 'committed', claimed: input.committedSpending ?? zero },
    { kind: 'obligations', claimed: obligationTotal },
    { kind: 'debt_minimums', claimed: input.minimumDebtPayments ?? zero },
    { kind: 'tax_reserve', claimed: input.taxReserve ?? zero },
    { kind: 'goals', claimed: input.goalAllocations ?? zero },
    { kind: 'buffer', claimed: input.bufferMinimum ?? zero },
  ];

  let remaining = input.liquid;
  const deductions: Deduction[] = [];

  for (const claim of claims) {
    // A negative claim would hand money back, which no claim may do.
    const claimed = claim.claimed.isNegative() ? zero : claim.claimed;
    const coverable = remaining.isPositive() ? Money.min(remaining, claimed) : zero;

    deductions.push({
      kind: claim.kind,
      claimed,
      covered: coverable,
      uncovered: claimed.subtract(coverable),
    });

    remaining = remaining.subtract(coverable);
  }

  const totalClaimed = Money.sum(
    deductions.map((deduction) => deduction.claimed),
    currency,
  );
  const shortfall = Money.sum(
    deductions.map((deduction) => deduction.uncovered),
    currency,
  );

  return {
    currency,
    liquid: input.liquid,
    deductions,
    totalClaimed,
    // Deliberately liquid − everything claimed, not the running remainder. The
    // running remainder stops at zero by construction; the household needs to
    // see how far past zero the claims reach.
    safeToSpend: input.liquid.subtract(totalClaimed),
    isShortfall: shortfall.isPositive(),
    shortfall,
    countedObligations,
    horizon,
  };
}

/**
 * Liquid cash, less what is committed, divided by the household's typical
 * monthly burn — how long the money lasts if nothing changes.
 *
 * Independent professionals live on this number between invoices. It is reported
 * in months to one decimal and returns null rather than infinity when there is
 * no burn to divide by; "your runway is forever" is not a useful answer.
 */
export function estimateRunwayMonths(available: Money, monthlyBurn: Money): number | null {
  if (!monthlyBurn.isPositive()) return null;
  if (!available.isPositive()) return 0;

  const tenths = (available.scaledUnits * 10n) / monthlyBurn.scaledUnits;
  return Number(tenths) / 10;
}
