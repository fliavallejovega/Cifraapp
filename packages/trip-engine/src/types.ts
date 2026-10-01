import type { PlainDate } from '@app/domain';

import type { DailyCategory, Profile, TripCategory } from './categories.js';

/** A currency the engine can count in: its code and how many decimals it has. */
export interface CurrencyUnit {
  readonly code: string;
  readonly minorUnits: number;
}

export type LodgingMode = 'undecided' | 'prepaid' | 'pay_on_site' | 'none';
export type BookingType =
  'flight' | 'lodging' | 'insurance' | 'tour' | 'transport' | 'visa' | 'other';
export type PaymentStatus = 'paid' | 'deposit_paid' | 'pay_later' | 'pay_on_site';
export type RollingPolicy = 'rolling' | 'fixed';
export type DayKind = 'full' | 'arrival' | 'departure' | 'single';
export type DayTiming = 'past' | 'today' | 'future';
export type TripPhase = 'before' | 'during' | 'after';

export interface LegInput {
  readonly id: string;
  readonly arrivalDate: PlainDate;
  readonly departureDate: PlainDate;
  /** Decimal string, 1.00 is the reference. */
  readonly costIndex: string;
  readonly lodgingMode: LodgingMode;
  readonly localCurrency?: CurrencyUnit | null;
  /** Local units per one unit of the base currency, as a decimal string. */
  readonly fxRate?: string | null;
}

export interface TravelerInput {
  readonly id: string;
  /** Decimal string: adult 1, child 0.6, infant 0.2 by default. */
  readonly weight: string;
}

export interface BookingInput {
  readonly id: string;
  readonly type: BookingType;
  readonly paymentStatus: PaymentStatus;
  /** Full price in the base currency, decimal string. */
  readonly amountBase: string;
  /** Already paid, in the base currency. Ignored when `paymentStatus` is `paid`. */
  readonly paidBase?: string | null;
  readonly legId?: string | null;
  readonly startsOn?: PlainDate | null;
  readonly endsOn?: PlainDate | null;
}

export interface OverrideInput {
  /** A day, a leg, or neither (the whole trip). */
  readonly day?: PlainDate | null;
  readonly legId?: string | null;
  readonly category: DailyCategory;
  /** Base currency, decimal string. */
  readonly amount: string;
}

export interface SpentInput {
  readonly day: PlainDate;
  readonly category: TripCategory;
  /** Base currency, positive, decimal string. */
  readonly amount: string;
}

export interface TripBudgetInput {
  readonly currency: CurrencyUnit;
  readonly totalBudget: string;
  /** Injected. The engine never reads a clock. */
  readonly today: PlainDate;
  readonly startDate: PlainDate;
  readonly endDate: PlainDate;
  readonly legs: readonly LegInput[];
  readonly travelers: readonly TravelerInput[];
  readonly bookings: readonly BookingInput[];
  readonly contingency: { readonly type: 'percent' | 'fixed'; readonly value: string };
  readonly profile: Profile;
  readonly customShares?: Partial<Record<string, number>> | null;
  readonly partialDays: {
    readonly includeArrival: boolean;
    readonly includeDeparture: boolean;
    /** Decimal string between 0 and 1. */
    readonly weight: string;
  };
  readonly overrides?: readonly OverrideInput[];
  readonly spent?: readonly SpentInput[];
  readonly reserveReleased?: string | null;
  readonly rollingPolicy?: RollingPolicy;
  /** What the household can set aside each month, for the «N more months» suggestion. */
  readonly monthlySavingCapacity?: string | null;
}

export type CategoryAmounts = Readonly<Record<DailyCategory, string>>;

export interface TripDay {
  readonly date: PlainDate;
  readonly legId: string | null;
  readonly kind: DayKind;
  /** Decimal string: 1, the partial weight, or 0 when the day is left out. */
  readonly weight: string;
  readonly timing: DayTiming;
  /** What the day may spend now: re-spread for today and the future in rolling mode. */
  readonly planned: CategoryAmounts;
  readonly plannedTotal: string;
  /** What the original plan gave this day, before any rolling. */
  readonly originalTotal: string;
  readonly spent: Readonly<Partial<Record<TripCategory, string>>>;
  readonly spentTotal: string;
  /** `none` for the future; `ok`, `near` (80 % or more) or `over` once spending starts. */
  readonly state: 'none' | 'ok' | 'near' | 'over';
}

export interface LegSummary {
  readonly legId: string;
  readonly days: number;
  readonly nights: number;
  readonly plannedTotal: string;
  /** A full day's per diem in the base currency, and in local currency when there is a rate. */
  readonly perDiemFull: string | null;
  readonly perDiemFullLocal: string | null;
  readonly perDiemPartial: string | null;
  readonly perDiemPartialLocal: string | null;
  readonly fullDay: CategoryAmounts | null;
  readonly lodgingToBook: { readonly perNight: string; readonly nights: number } | null;
  readonly localCurrency: string | null;
}

export type Suggestion =
  | { readonly kind: 'add_money'; readonly amount: string; readonly months: number | null }
  | {
      readonly kind: 'lower_reserve';
      readonly percent: string;
      readonly frees: string;
      readonly fixes: boolean;
    }
  | { readonly kind: 'fewer_days'; readonly days: number }
  | { readonly kind: 'economy_profile'; readonly saves: string }
  | { readonly kind: 'use_reserve'; readonly amount: string; readonly fixes: boolean };

export type Warning =
  | { readonly kind: 'booking_outside_trip'; readonly bookingId: string }
  | { readonly kind: 'lodging_undecided'; readonly legId: string; readonly nights: number }
  | { readonly kind: 'missing_fx'; readonly legId: string; readonly currency: string }
  | { readonly kind: 'days_without_leg'; readonly days: number }
  | { readonly kind: 'no_legs' }
  | { readonly kind: 'overrides_exceed_fund'; readonly excess: string }
  | { readonly kind: 'no_travelers' };

export interface TripBudget {
  readonly engineVersion: string;
  readonly currency: CurrencyUnit;
  readonly phase: TripPhase;
  readonly totalBudget: string;
  readonly commitments: {
    readonly prepaid: string;
    readonly pending: string;
    readonly byType: Readonly<Partial<Record<BookingType, string>>>;
  };
  readonly reserve: {
    readonly planned: string;
    readonly released: string;
    readonly available: string;
  };
  /** What the days get, reserve releases included. Negative means a deficit. */
  readonly fundForDays: string;
  /** Days with weight; partial days count as their weight. Decimal string. */
  readonly effectiveDays: string;
  readonly days: readonly TripDay[];
  readonly legs: readonly LegSummary[];
  readonly byCategory: CategoryAmounts;
  readonly spent: { readonly total: string; readonly beforeToday: string; readonly today: string };
  /** Present while the trip runs: what today may still spend. */
  readonly today: {
    readonly date: PlainDate;
    readonly allowed: string;
    readonly spent: string;
    /** Never negative; `overspent` carries the excess. */
    readonly remaining: string;
    readonly overspent: string;
    readonly byCategory: Readonly<
      Record<DailyCategory, { allowed: string; spent: string; remaining: string }>
    >;
  } | null;
  /** The representative day split across travellers by weight. */
  readonly perTraveler: readonly { readonly travelerId: string; readonly amount: string }[];
  /** In fixed policy: how far spending has drifted from plan (positive = under plan). */
  readonly drift: string;
  readonly diagnostics: {
    readonly status: 'healthy' | 'tight' | 'deficit';
    readonly shortfall: string;
    readonly suggestions: readonly Suggestion[];
    readonly warnings: readonly Warning[];
    readonly belowReference: readonly {
      readonly legId: string;
      readonly perPerson: string;
      readonly reference: string;
    }[];
  };
}
