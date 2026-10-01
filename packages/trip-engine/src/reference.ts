import type { Profile } from './categories.js';
import { divide, fromMinor, toScaled } from './units.js';

/**
 * Reference costs, marked as estimates wherever they are shown.
 *
 * Version 1 has no outside source for the cost of living: the family states
 * how expensive a place is (low, medium, high, very high) and these figures
 * turn that into a range. They exist to say «this looks short» or «try about
 * this much», never to replace the family's own number. A real source plugs in
 * behind `CostIndexProvider` without changing the engine.
 *
 * Amounts are in US dollars per adult-equivalent per day, at the medium level
 * and the balanced profile. The cost index scales them.
 */

export type CostLevel = 'low' | 'medium' | 'high' | 'very_high';

export const COST_INDEX_BY_LEVEL: Readonly<Record<CostLevel, string>> = {
  low: '0.70',
  medium: '1.00',
  high: '1.30',
  very_high: '1.60',
};

/** Food, local transport, activities, shopping and other, without a bed. */
export const REFERENCE_DAILY_SPEND = '55.00';
/** One room for the night. */
export const REFERENCE_LODGING_NIGHT = '90.00';

/** Profile multipliers in basis points. */
export const PROFILE_FACTOR: Readonly<Record<Profile, bigint>> = {
  economy: 7500n,
  balanced: 10_000n,
  comfort: 13_500n,
  custom: 10_000n,
};

export const DEFAULT_TRAVELER_WEIGHT = { adult: '1', child: '0.6', infant: '0.2' } as const;

/** The level whose index is nearest to `costIndex`. */
export function levelForIndex(costIndex: string): CostLevel {
  const value = toScaled(costIndex, 2);
  let best: CostLevel = 'medium';
  let distance = -1n;
  for (const [level, index] of Object.entries(COST_INDEX_BY_LEVEL) as [CostLevel, string][]) {
    const gap = value - toScaled(index, 2);
    const abs = gap < 0n ? -gap : gap;
    if (distance < 0n || abs < distance) {
      best = level;
      distance = abs;
    }
  }
  return best;
}

/** A future source of cost of living. The default knows nothing and the family's level stands. */
export interface CostIndexProvider {
  lookup(place: {
    countryCode: string | null;
    city: string;
  }): { costIndex: string; level: CostLevel } | null;
}
export const noCostIndexProvider: CostIndexProvider = { lookup: () => null };

/**
 * Reference daily spend in minor units for `personWeight` adult-equivalents
 * (scale 3) at `costIndex` (scale 2) under `profile`.
 */
export function referenceDailyUnits(
  minorUnits: number,
  personWeight: bigint,
  costIndex: bigint,
  profile: Profile,
): bigint {
  const base = toScaled(REFERENCE_DAILY_SPEND, minorUnits);
  return divide(base * personWeight * costIndex * PROFILE_FACTOR[profile], 1000n * 100n * 10_000n);
}

export function referenceNightUnits(
  minorUnits: number,
  costIndex: bigint,
  profile: Profile,
): bigint {
  const base = toScaled(REFERENCE_LODGING_NIGHT, minorUnits);
  return divide(base * costIndex * PROFILE_FACTOR[profile], 100n * 10_000n);
}

export interface RangeLeg {
  readonly days: number;
  readonly nights: number;
  readonly costIndex: string;
  readonly needsLodging: boolean;
}

/**
 * The «we suggest about this much» range of the trip wizard, for the days on
 * the ground. Commitments such as flights are added by the caller, who knows
 * them. Low is 80 % of the estimate and high is 125 %.
 */
export function suggestBudgetRange(input: {
  readonly minorUnits: number;
  readonly legs: readonly RangeLeg[];
  readonly travelerWeights: readonly string[];
  readonly profile: Profile;
}): { readonly low: string; readonly estimate: string; readonly high: string } {
  const people = input.travelerWeights.reduce((sum, w) => sum + toScaled(w, 3), 0n);
  const rooms = BigInt(Math.max(1, Math.ceil(Number(people) / 2000)));
  let estimate = 0n;
  for (const leg of input.legs) {
    const index = toScaled(leg.costIndex, 2);
    estimate +=
      referenceDailyUnits(input.minorUnits, people, index, input.profile) * BigInt(leg.days);
    if (leg.needsLodging) {
      estimate +=
        referenceNightUnits(input.minorUnits, index, input.profile) * rooms * BigInt(leg.nights);
    }
  }
  return {
    low: fromMinor(divide(estimate * 80n, 100n), input.minorUnits),
    estimate: fromMinor(estimate, input.minorUnits),
    high: fromMinor(divide(estimate * 125n, 100n), input.minorUnits),
  };
}
