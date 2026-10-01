/**
 * Trip categories and distribution profiles.
 *
 * Daily categories are spent day by day at the destination and are what the
 * per diem is made of. Commitment categories are paid once for the whole trip
 * — flights, insurance, visas, the train between cities — and never enter the
 * daily split.
 *
 * Each key maps to a household category through the `travel-*` templates
 * (`20261001210000_trips.sql`), so a trip expense also lands in the household's
 * general accounts.
 */

export const DAILY_CATEGORIES = [
  'lodging',
  'food',
  'local_transport',
  'activities',
  'shopping',
  'other',
] as const;
export type DailyCategory = (typeof DAILY_CATEGORIES)[number];

export const COMMITMENT_CATEGORIES = ['flights', 'insurance', 'visas', 'long_transport'] as const;
export type CommitmentCategory = (typeof COMMITMENT_CATEGORIES)[number];

export const TRIP_CATEGORIES = [...DAILY_CATEGORIES, ...COMMITMENT_CATEGORIES] as const;
export type TripCategory = DailyCategory | CommitmentCategory;

export const isTripCategory = (value: string): value is TripCategory =>
  (TRIP_CATEGORIES as readonly string[]).includes(value);
export const isDailyCategory = (value: string): value is DailyCategory =>
  (DAILY_CATEGORIES as readonly string[]).includes(value);

/** The household category template each trip category files under. */
export const CATEGORY_TEMPLATE: Readonly<Record<TripCategory, string>> = {
  lodging: 'travel-lodging',
  food: 'travel-food',
  local_transport: 'travel-local-transport',
  activities: 'travel-activities',
  shopping: 'travel-shopping',
  other: 'travel-other',
  flights: 'travel-flights',
  insurance: 'travel-insurance',
  visas: 'travel-visas',
  long_transport: 'travel-long-transport',
};

export type ProfileKey = 'economy' | 'balanced' | 'comfort';
export type Profile = ProfileKey | 'custom';

/** Shares in basis points (10 000 = 100 %). Integers, so no renormalization ever touches a float. */
export type Shares = Readonly<Record<DailyCategory, number>>;

export const PROFILES: Readonly<Record<ProfileKey, Shares>> = {
  economy: {
    lodging: 3500,
    food: 3000,
    local_transport: 1500,
    activities: 1000,
    shopping: 500,
    other: 500,
  },
  balanced: {
    lodging: 4000,
    food: 2500,
    local_transport: 1200,
    activities: 1300,
    shopping: 600,
    other: 400,
  },
  comfort: {
    lodging: 4500,
    food: 2200,
    local_transport: 1000,
    activities: 1300,
    shopping: 600,
    other: 400,
  },
};

/** Checks a custom profile: every daily category present, non-negative integers, summing to 10 000. */
export function validateShares(shares: Partial<Record<string, number>>): shares is Shares {
  let sum = 0;
  for (const category of DAILY_CATEGORIES) {
    const value = shares[category];
    if (value === undefined || !Number.isInteger(value) || value < 0) return false;
    sum += value;
  }
  return sum === 10_000;
}

/**
 * Moves one category to `value` basis points and rescales the others so the
 * total stays 10 000, keeping their relative proportions. Locked categories
 * do not move. Used by the custom-profile sliders.
 */
export function rebalanceShares(
  shares: Shares,
  category: DailyCategory,
  value: number,
  locked: readonly DailyCategory[] = [],
): Shares {
  const target = Math.max(0, Math.min(10_000, Math.trunc(value)));
  const fixed = DAILY_CATEGORIES.filter((c) => c === category || locked.includes(c));
  const fixedSum = fixed.reduce((sum, c) => sum + (c === category ? target : shares[c]), 0);
  const free = DAILY_CATEGORIES.filter((c) => !fixed.includes(c));
  const room = Math.max(0, 10_000 - fixedSum);
  const freeSum = free.reduce((sum, c) => sum + shares[c], 0);

  const next: Record<DailyCategory, number> = { ...shares, [category]: target };
  if (free.length === 0) return next;
  // Largest remainder over integers, so the result sums to exactly 10 000.
  const base = free.map((c) =>
    freeSum === 0 ? Math.floor(room / free.length) : Math.floor((room * shares[c]) / freeSum),
  );
  let left = room - base.reduce((a, b) => a + b, 0);
  const order = free
    .map((c, i) => ({ i, rest: freeSum === 0 ? 0 : (room * shares[c]) % freeSum }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    base[i] = (base[i] ?? 0) + 1;
    left -= 1;
  }
  free.forEach((c, i) => {
    next[c] = base[i] ?? 0;
  });
  // If the moved and locked categories exceed 10 000 on their own, give back from the moved one.
  const shareSum = DAILY_CATEGORIES.reduce((sum, c) => sum + next[c], 0);
  if (shareSum !== 10_000) next[category] = Math.max(0, next[category] - (shareSum - 10_000));
  return next;
}

export const sharesFor = (
  profile: Profile,
  custom?: Partial<Record<string, number>> | null,
): Shares => {
  if (profile === 'custom') {
    if (custom && validateShares(custom)) return custom;
    return PROFILES.balanced;
  }
  return PROFILES[profile];
};
