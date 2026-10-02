/**
 * What Rumbo's screens receive: plain data, every sentence already in the
 * person's language. Nothing here is a function or a class instance, so it
 * crosses from a server page into a client component as it is.
 */

export type Certainty = 'confirmed' | 'estimated' | 'unverified';
export type Severity = 'info' | 'warning' | 'critical';

export interface ClientNotice {
  readonly severity: Severity;
  readonly text: string;
}

export interface ClientPlace {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly lat: number;
  readonly lon: number;
  readonly kind: string;
}

export interface ClientLeg {
  readonly from: string;
  readonly to: string;
  readonly fromName: string;
  readonly toName: string;
  readonly mode: 'car' | 'ferry' | 'train' | 'transfer';
  readonly km: string;
  readonly minutes: number;
  readonly duration: string;
  readonly routerDuration: string;
  readonly mountain: boolean;
  readonly maxElevation: number | null;
  readonly wazeUrl: string;
  readonly mapsUrl: string;
  /** Geometry key in `ClientRumbo.geometry`. */
  readonly geometryKey: string;
}

export interface ClientDrive {
  readonly purpose: 'move' | 'day_trip';
  readonly points: readonly string[];
  readonly legs: readonly ClientLeg[];
  readonly incomplete: boolean;
  /** The stored request still without a route, for typing it by hand. */
  readonly pendingDriveId: string | null;
  readonly dayMapsUrl: string | null;
}

export interface ClientTimelineEntry {
  readonly step: string;
  readonly label: string;
  readonly time: string;
  readonly place: string;
  readonly certainty: Certainty;
  readonly certaintyLabel: string;
  readonly detail: string | null;
}

export interface ClientFlight {
  readonly segmentId: string;
  readonly title: string;
  readonly entries: readonly ClientTimelineEntry[];
}

export interface ClientActivity {
  readonly name: string;
  readonly place: string;
  readonly mapUrl: string;
  readonly url: string | null;
  readonly needsBooking: boolean;
  readonly closed: boolean;
}

export interface ClientDay {
  readonly date: string;
  readonly index: number;
  readonly label: string;
  readonly shortLabel: string;
  readonly kind: 'flight' | 'drive' | 'rest';
  readonly title: string;
  readonly sleep: {
    readonly name: string;
    readonly status: 'hosted' | 'paid' | 'open';
    readonly statusLabel: string;
  } | null;
  readonly sleepNote: string | null;
  readonly flights: readonly ClientFlight[];
  readonly drives: readonly ClientDrive[];
  readonly drivingMinutes: number;
  readonly driving: string;
  readonly km: string;
  readonly departure: string | null;
  readonly arrival: string | null;
  readonly sunset: string | null;
  readonly routerNote: string | null;
  readonly notices: readonly ClientNotice[];
  readonly activities: readonly ClientActivity[];
  /** Days spent where the map does not reach. */
  readonly offMap: string | null;
  /** Places the map labels on this day. */
  readonly focus: readonly string[];
}

export interface ClientRumbo {
  readonly tripId: string;
  readonly name: string;
  readonly summary: string | null;
  readonly composed: boolean;
  readonly days: readonly ClientDay[];
  readonly places: Readonly<Record<string, ClientPlace>>;
  readonly geometry: Readonly<Record<string, readonly (readonly [number, number, number])[]>>;
  readonly sacrifices: string | null;
  readonly tripNotices: readonly ClientNotice[];
  readonly routing: {
    readonly configured: boolean;
    readonly pending: number;
    readonly failed: number;
  };
}

export interface ClientLodgingOption {
  readonly id: string;
  readonly provider: 'airbnb' | 'booking' | 'other';
  readonly name: string;
  readonly kind: string | null;
  readonly rating: string | null;
  readonly reviews: number | null;
  /** Decimal string in the trip's currency, whole stay. */
  readonly total: string | null;
  readonly certainty: Certainty;
  readonly recommended: boolean;
  readonly cheapest: boolean;
  readonly bookUrl: string | null;
  readonly photosUrl: string | null;
}

export interface ClientLodgingStop {
  readonly legId: string;
  readonly placeName: string;
  readonly dates: string;
  readonly nights: number;
  readonly hosted: boolean;
  readonly paid: boolean;
  readonly options: readonly ClientLodgingOption[];
  readonly recommendedTotal: string | null;
  readonly cheapestTotal: string | null;
  readonly myPrice: string | null;
  readonly airbnbSearchUrl: string;
  readonly bookingSearchUrl: string;
  readonly unconvertedOptions: number;
}

export interface ClientLodging {
  readonly currency: string;
  readonly stops: readonly ClientLodgingStop[];
  readonly notices: readonly ClientNotice[];
  readonly capPerNight: string | null;
}

export interface ClientTodo {
  readonly key: string;
  readonly title: string;
  readonly reason: string;
  readonly country: string | null;
  readonly countryName: string;
  readonly url: string | null;
  readonly due: string | null;
  readonly dueDate: string | null;
  readonly saleOpens: string | null;
  readonly overdue: boolean;
  readonly status: 'pending' | 'bought' | 'dismissed';
  readonly confirmationCode: string | null;
  readonly certaintyLabel: string;
  readonly source: { readonly name: string; readonly url: string; readonly checked: string } | null;
  readonly orphaned: boolean;
}
