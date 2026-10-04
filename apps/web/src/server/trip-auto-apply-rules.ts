import { addDays, type PlainDate } from '@app/domain';
import type { Proposal } from '@app/trip-engine';

import { catalogPlaceFor } from './rumbo-documents';
import type { ConfirmTripDocumentInput } from './trip-document-apply';

/**
 * Whether a travel document can be applied to its trip without asking.
 *
 * The household decided: a hotel or a flight that lands cleanly on the trip is
 * applied as soon as it is read, and they are told, with a way back. Anything
 * else waits for a person — and «cleanly» is decided here, by code, from what
 * the reader transcribed. The reader never decides it.
 *
 * Applied only when every one of these holds:
 *
 *   - It is a hotel confirmation, an itinerary or a boarding pass.
 *   - The reader was sure of it, and of the fields that move the trip: the
 *     total, the dates, the city, the flight segments.
 *   - The amount converts: in the trip's currency, or one the trip already
 *     has a planning rate for.
 *   - It falls inside the trip's dates.
 *   - No other city is planned, and no other hotel is booked, on any of a
 *     hotel's nights. A clash is never resolved here: it goes to review with
 *     the before and the after.
 */

export interface TripFacts {
  readonly tripId: string;
  readonly start: PlainDate;
  readonly end: PlainDate;
  readonly base: string;
  /** Planning rates the trip already fixed, local units per base unit. */
  readonly rates: Readonly<Record<string, string>>;
  /**
   * Nights already spoken for: confirmed hotels (`anchor`) and the cities the
   * trip plans to be in (`leg`). A hotel in the city a leg already plans for
   * those nights is the plan coming true, not a clash.
   */
  readonly stays: readonly {
    readonly source: 'anchor' | 'leg';
    readonly catalogId: string | null;
    readonly city: string;
    readonly from: PlainDate;
    /** Last night, inclusive. */
    readonly to: PlainDate;
    readonly label: string | null;
  }[];
}

export interface StayConflict {
  readonly from: PlainDate;
  readonly to: PlainDate;
  readonly plannedCity: string;
  readonly plannedLabel: string | null;
  readonly incomingCity: string;
}

export type ReviewReason =
  'not_eligible' | 'unsure' | 'no_rate' | 'outside_trip' | 'conflict' | 'already_planned';

export type AutoDecision =
  | { readonly kind: 'apply'; readonly input: ConfirmTripDocumentInput }
  | { readonly kind: 'review'; readonly reason: ReviewReason; readonly conflict?: StayConflict };

/** Fields that, read wrong, would put the family in the wrong place or day. */
const KEY_FIELDS = [
  'total_amount',
  'currency_text',
  'check_in',
  'check_out',
  'city',
  'segments',
  'amount',
  'currency',
  'checkIn',
  'checkOut',
];

const MIN_CONFIDENCE = 0.75;
const AMOUNT = /^\d{1,13}(\.\d{1,4})?$/;

export function decideAutoApply(p: Proposal, trip: TripFacts): AutoDecision {
  const review = (reason: ReviewReason, conflict?: StayConflict): AutoDecision =>
    conflict ? { kind: 'review', reason, conflict } : { kind: 'review', reason };

  const lodging = p.kind === 'lodging_confirmation';
  const flight = p.kind === 'flight_itinerary' || p.kind === 'boarding_pass';
  if (!lodging && !flight) return review('not_eligible');

  if (
    p.confidence < MIN_CONFIDENCE ||
    p.currencyAmbiguous ||
    !p.amount ||
    !AMOUNT.test(p.amount) ||
    p.lowConfidence.some((field) => KEY_FIELDS.includes(field))
  ) {
    return review('unsure');
  }

  const currency = p.currency.trim().toUpperCase();
  const base = trip.base.trim().toUpperCase();
  const fxRate = currency === base ? null : (trip.rates[currency] ?? null);
  if (currency !== base && !fxRate) return review('no_rate');

  const paymentStatus = p.payAtProperty
    ? ('pay_on_site' as const)
    : p.amountDue && p.amountDue !== '0'
      ? ('deposit_paid' as const)
      : ('paid' as const);

  const booking = {
    bookingType: lodging ? ('lodging' as const) : ('flight' as const),
    provider: blankToNull(p.provider),
    referenceCode: blankToNull(p.referenceCode),
    amount: p.amount,
    currency,
    fxRate,
    paymentStatus,
    paidAmount:
      paymentStatus === 'deposit_paid' && p.amountPaid && AMOUNT.test(p.amountPaid)
        ? p.amountPaid
        : '0',
    dueDate: paymentStatus !== 'paid' ? p.dueDate : null,
    details: {
      segments: p.segments.map((s) => ({
        from: s.fromIata,
        to: s.toIata,
        flight: s.flightNumber,
        date: s.departure?.date ?? null,
      })),
      breakfastIncluded: p.breakfastIncluded,
      cityTaxPending: p.cityTaxPending,
      cancellationDeadline: p.cancellationDeadline,
      appliedAutomatically: true,
    },
    // Paying it is a movement in someone's account: that one a person records.
    payment: null,
  };

  if (lodging) {
    const city = p.city?.trim();
    if (!city || !p.checkIn || !p.checkOut || p.checkOut <= p.checkIn) return review('unsure');
    if (p.checkIn < trip.start || p.checkOut > addDays(trip.end, 1)) return review('outside_trip');

    // A city the map does not know yet still lands: the booking and the leg are
    // saved, and Rumbo asks the family to place it, as a manual confirmation does.
    const catalogId = catalogPlaceFor(city);

    const lastNight = addDays(p.checkOut, -1);
    const sameCity = (s: TripFacts['stays'][number]) =>
      (s.catalogId !== null && s.catalogId === catalogId) ||
      s.city.trim().toLowerCase() === city.toLowerCase();
    const clash = trip.stays.find(
      (s) =>
        s.from <= lastNight &&
        s.to >= (p.checkIn ?? lastNight) &&
        !(s.source === 'leg' && sameCity(s)),
    );
    if (clash) {
      const conflict: StayConflict = {
        from: clash.from > p.checkIn ? clash.from : p.checkIn,
        to: clash.to < lastNight ? clash.to : lastNight,
        plannedCity: clash.city,
        plannedLabel: clash.label,
        incomingCity: city,
      };
      return review(sameCity(clash) ? 'already_planned' : 'conflict', conflict);
    }

    return {
      kind: 'apply',
      input: {
        tripId: trip.tripId,
        createTrip: null,
        lodging: {
          city,
          checkIn: p.checkIn,
          checkOut: p.checkOut,
          lodgingMode: paymentStatus === 'pay_on_site' ? 'pay_on_site' : 'prepaid',
        },
        booking: {
          ...booking,
          startsAt: `${p.checkIn}T12:00:00Z`,
          endsAt: `${p.checkOut}T12:00:00Z`,
        },
        expense: null,
      },
    };
  }

  // A flight.
  if (p.segments.length === 0 || !p.outbound) return review('unsure');
  const earliest = addDays(trip.start, -1);
  const latest = addDays(trip.end, 1);
  const outside = p.segments.some((s) => {
    const day = s.departure?.date;
    return !day || day < earliest || day > latest;
  });
  if (outside) return review('outside_trip');

  return {
    kind: 'apply',
    input: {
      tripId: trip.tripId,
      createTrip: null,
      lodging: null,
      booking: {
        ...booking,
        startsAt: `${p.outbound}T12:00:00Z`,
        endsAt: p.inbound ? `${p.inbound}T12:00:00Z` : null,
      },
      expense: null,
    },
  };
}

function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}
