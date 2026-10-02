import type { PlainDate } from '@app/domain';

/**
 * How sure the platform is of a fact. The screen shows the difference:
 * «En su boleto» for what a ticket or reservation says, «~» for what was
 * calculated, and «por verificar» for what nobody has confirmed yet.
 */
export type Certainty = 'confirmed' | 'estimated' | 'unverified';

/** Where a fact with an expiry date came from, and when it was looked up. */
export interface SourceRef {
  readonly name: string;
  readonly url: string;
  /** Calendar day of the lookup. */
  readonly checkedOn: PlainDate;
  /** True when the exact page could not be confirmed and this is the service's main page. */
  readonly mainPageOnly?: boolean;
}

/** ISO 3166-1 alpha-2, upper case. */
export type CountryCode = string;

export type PlaceKind = 'city' | 'town' | 'pass' | 'poi' | 'airport' | 'port' | 'market';

export interface Place {
  readonly id: string;
  readonly name: string;
  readonly country: CountryCode;
  /** WGS84, decimal degrees. */
  readonly lat: number;
  readonly lon: number;
  /** IANA zone, e.g. `Europe/Rome`. */
  readonly timeZone: string;
  readonly kind: PlaceKind;
  readonly altitudeM?: number;
}

export type GroundMode = 'car' | 'ferry' | 'train' | 'transfer';

/**
 * One routed stretch of a driving day: a start, an end and the stops in
 * between, as the routing service returned it. Meters and seconds are
 * integers; nothing here is money.
 */
export interface RouteLeg {
  readonly from: string;
  readonly to: string;
  readonly mode: GroundMode;
  readonly distanceM: number;
  readonly durationS: number;
  readonly ascentM?: number;
  readonly maxElevationM?: number;
  readonly source: SourceRef;
  readonly certainty: Certainty;
}

/** A local wall-clock time in a named zone. */
export interface ZonedTime {
  readonly date: PlainDate;
  /** `HH:MM`, 24 h. */
  readonly time: string;
  readonly timeZone: string;
}

export interface FlightSegment {
  readonly id: string;
  readonly carrier?: string;
  readonly number?: string;
  /** IATA codes. */
  readonly from: string;
  readonly to: string;
  readonly departs: ZonedTime;
  readonly departsCertainty: Certainty;
  readonly arrives: ZonedTime;
  readonly arrivesCertainty: Certainty;
  readonly recordLocator?: string;
  readonly baggage?: string;
}

export interface Traveler {
  readonly id: string;
  readonly name: string;
  /** Every passport the person can present. */
  readonly nationalities: readonly CountryCode[];
  /** Country of residence: entering it needs no check. */
  readonly residence?: CountryCode;
}

/**
 * Something that does not move: a paid stay, a timed event, friends who
 * expect you between two dates, the car pick-up and return.
 */
export interface Anchor {
  readonly id: string;
  readonly kind: 'stay' | 'event' | 'friends' | 'car_pickup' | 'car_return';
  readonly placeId: string;
  /** First and last night (stay, friends) or the day itself (event, car). */
  readonly from: PlainDate;
  readonly to: PlainDate;
  /** Nights that must be spent there; friends may host more if the plan has room. */
  readonly minNights?: number;
  readonly maxNights?: number;
  readonly paid?: boolean;
  /** No lodging cost: friends or family host. */
  readonly hosted?: boolean;
  readonly certainty: Certainty;
  readonly label?: string;
}

/** A wish in the person's own words, matched to catalog tags. */
export interface Wish {
  readonly id: string;
  readonly text: string;
  readonly tags: readonly string[];
}

/** One night-stop of the ground part, in order. */
export interface Stay {
  readonly placeId: string;
  readonly firstNight: PlainDate;
  readonly nights: number;
  readonly origin: 'anchor' | 'wish' | 'catalog' | 'flight' | 'manual';
  readonly hosted: boolean;
  readonly paid: boolean;
}

/** A warning the screen renders from a message key; the engine never writes prose. */
export interface Notice {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly params?: Readonly<Record<string, string | number>>;
}
