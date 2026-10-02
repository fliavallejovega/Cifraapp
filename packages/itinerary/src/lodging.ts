import { Money, type CurrencyCode, type PlainDate } from '@app/domain';

import type { Certainty, Notice } from './types.js';

/**
 * Lodging: the options per stop, the person's own price, and totals that
 * follow every edit. All amounts arrive in the trip's lodging currency as
 * Money; converting a listing's own currency is the caller's job, with a rate
 * it can show.
 *
 * «Mi plan» uses the person's price where there is one and the recommended
 * option where there is not. Hosted nights cost nothing. The totals do not
 * include tourist taxes, parking, or breakfast when it is not included — the
 * screen says so next to them.
 */

export type LodgingProvider = 'airbnb' | 'booking' | 'other';

export interface LodgingOption {
  readonly id: string;
  readonly provider: LodgingProvider;
  readonly name: string;
  readonly kind: string | null;
  readonly rating: string | null;
  readonly reviews: number | null;
  /** Whole stay, or null when the listing has no price yet. */
  readonly total: Money | null;
  readonly recommended: boolean;
  readonly certainty: Certainty;
}

export interface LodgingStop {
  readonly legId: string;
  readonly placeId: string;
  readonly placeName: string;
  readonly firstNight: PlainDate;
  readonly nights: number;
  readonly hosted: boolean;
  readonly paid: boolean;
  readonly options: readonly LodgingOption[];
  readonly myPrice: Money | null;
}

export interface StopSummary {
  readonly stop: LodgingStop;
  /** Airbnb listings, cheapest first. */
  readonly airbnb: readonly LodgingOption[];
  /** Hotels and others; their prices are «desde», never confirmed. */
  readonly hotels: readonly LodgingOption[];
  readonly recommended: LodgingOption | null;
  readonly cheapest: LodgingOption | null;
  /** What «Mi plan» counts for this stop. */
  readonly planned: Money | null;
  readonly plannedFrom: 'mine' | 'recommended' | 'hosted' | 'none';
}

export interface LodgingTotals {
  readonly myPlan: Money;
  readonly recommended: Money;
  readonly cheapest: Money;
  readonly nightsWithLodging: number;
  readonly averagePerNight: Money | null;
  readonly stopsWithMyPrice: number;
  readonly stopsToPrice: number;
}

export interface NearbyTown {
  readonly name: string;
  readonly detourMinutes: number;
}

/**
 * Towns near expensive places, with the extra minutes they add to the day.
 * Estimates from the router; the screen marks them «~».
 */
export const NEARBY_CHEAPER: Readonly<Record<string, readonly NearbyTown[]>> = {
  cortina: [
    { name: 'San Vito di Cadore', detourMinutes: 15 },
    { name: 'Borca di Cadore', detourMinutes: 20 },
  ],
  canazei: [
    { name: 'Vigo di Fassa', detourMinutes: 15 },
    { name: 'Moena', detourMinutes: 25 },
  ],
  arosa: [
    { name: 'Langwies', detourMinutes: 15 },
    { name: 'Chur', detourMinutes: 45 },
  ],
};

function cheapestOf(options: readonly LodgingOption[]): LodgingOption | null {
  let best: LodgingOption | null = null;
  for (const o of options) {
    if (!o.total) continue;
    if (!best?.total || o.total.lessThan(best.total)) best = o;
  }
  return best;
}

export function summarizeStop(stop: LodgingStop): StopSummary {
  const priced = (o: LodgingOption) => o.total !== null;
  const byPrice = (a: LodgingOption, b: LodgingOption) => {
    if (!a.total) return 1;
    if (!b.total) return -1;
    return a.total.compare(b.total);
  };
  const airbnb = stop.options.filter((o) => o.provider === 'airbnb').sort(byPrice);
  const hotels = stop.options.filter((o) => o.provider !== 'airbnb').sort(byPrice);
  const cheapest = cheapestOf(stop.options.filter(priced));
  const recommended = stop.options.find((o) => o.recommended && o.total) ?? cheapest;

  if (stop.hosted) {
    return { stop, airbnb, hotels, recommended, cheapest, planned: null, plannedFrom: 'hosted' };
  }
  if (stop.myPrice) {
    return {
      stop,
      airbnb,
      hotels,
      recommended,
      cheapest,
      planned: stop.myPrice,
      plannedFrom: 'mine',
    };
  }
  if (recommended?.total) {
    return {
      stop,
      airbnb,
      hotels,
      recommended,
      cheapest,
      planned: recommended.total,
      plannedFrom: 'recommended',
    };
  }
  return { stop, airbnb, hotels, recommended, cheapest, planned: null, plannedFrom: 'none' };
}

export function lodgingTotals(
  summaries: readonly StopSummary[],
  currency: CurrencyCode,
): LodgingTotals {
  const zero = Money.zero(currency);
  let myPlan = zero;
  let recommended = zero;
  let cheapest = zero;
  let nights = 0;
  let withMine = 0;
  let toPrice = 0;
  for (const s of summaries) {
    if (s.stop.hosted) continue;
    nights += s.stop.nights;
    toPrice += 1;
    if (s.stop.myPrice) withMine += 1;
    if (s.planned) myPlan = myPlan.add(s.planned);
    if (s.recommended?.total) recommended = recommended.add(s.recommended.total);
    if (s.cheapest?.total) cheapest = cheapest.add(s.cheapest.total);
  }
  return {
    myPlan,
    recommended,
    cheapest,
    nightsWithLodging: nights,
    averagePerNight: nights > 0 ? myPlan.divide(nights) : null,
    stopsWithMyPrice: withMine,
    stopsToPrice: toPrice,
  };
}

/**
 * Stops where nothing listed fits the nightly cap, with the nearby towns that
 * might — the lesson from the Dolomites and Arosa, where almost nothing is
 * under $100 a night.
 */
export function lodgingNotices(
  summaries: readonly StopSummary[],
  capPerNight: Money | null,
): Notice[] {
  if (!capPerNight) return [];
  const notices: Notice[] = [];
  for (const s of summaries) {
    if (s.stop.hosted || s.stop.paid) continue;
    const cap = capPerNight.multiply(s.stop.nights);
    const fits = s.stop.options.some((o) => o.total?.lessThanOrEqual(cap));
    if (s.stop.options.length > 0 && !fits) {
      const nearby = NEARBY_CHEAPER[s.stop.placeId] ?? [];
      notices.push({
        code: 'lodging_over_cap',
        severity: 'warning',
        params: {
          place: s.stop.placeName,
          cap: capPerNight.toDecimalString(),
          nearby: nearby.map((n) => `${n.name} (+${n.detourMinutes} min)`).join(', '),
        },
      });
    }
  }
  return notices;
}
