import { addDays, toPlainDate, type PlainDate } from '@app/domain';

import { ACTIVITIES } from './catalog/activities.js';
import { AIRPORTS } from './catalog/airports.js';
import { eventAt } from './catalog/events.js';
import type { Itinerary } from './days.js';
import { chargesFor, winterRuleOn, type RoadChargeKind } from './roads.js';
import type { Anchor, Certainty, CountryCode, FlightSegment, Place, SourceRef } from './types.js';
import { minuteOfDay } from './zoned.js';

/**
 * Everything to buy or book online, generated from the itinerary — never
 * typed by hand. Each item has a stable key, so what the person marked as
 * bought survives when the plan changes; a deadline; the official link; and,
 * for what sells out, the day the sale opens.
 *
 * The platform never buys or pays. It opens the right page.
 */

export type TodoKind =
  | 'flight_manage'
  | 'flight_checkin'
  | 'flight_seats'
  | 'car_rental_one_way'
  | 'car_winter_kit'
  | RoadChargeKind
  | 'event_tickets'
  | 'timed_entry'
  | 'local_transport'
  | 'private_transfer'
  | 'holiday_dinner';

export interface TodoDraft {
  readonly key: string;
  readonly kind: TodoKind;
  readonly params: Readonly<Record<string, string>>;
  readonly country: CountryCode | null;
  readonly url: string | null;
  readonly dueOn: PlainDate | null;
  readonly saleOpensOn: PlainDate | null;
  readonly certainty: Certainty;
  readonly source: SourceRef | null;
}

export interface TodoInput {
  readonly itinerary: Itinerary;
  readonly flights: readonly FlightSegment[];
  readonly anchors: readonly Anchor[];
  readonly place: (id: string) => Place;
}

/** A dawn or late-night ride to or from the airport is booked ahead. */
const CHECKED_ON = toPlainDate('2026-10-02');

const QUIET_HOURS: readonly [number, number] = [0, 6 * 60];

export function generateTodos(input: TodoInput): TodoDraft[] {
  const out: TodoDraft[] = [];
  const { itinerary, flights } = input;
  const firstFlight = flights[0];

  // Flights: manage the booking, choose seats, check in when it opens.
  if (firstFlight) {
    out.push({
      key: 'flight:manage',
      kind: 'flight_manage',
      params: { from: firstFlight.from },
      country: null,
      url: null,
      dueOn: addDays(firstFlight.departs.date, -14),
      saleOpensOn: null,
      certainty: 'estimated',
      source: null,
    });
    out.push({
      key: 'flight:seats',
      kind: 'flight_seats',
      params: {},
      country: null,
      url: null,
      dueOn: addDays(firstFlight.departs.date, -7),
      saleOpensOn: null,
      certainty: 'estimated',
      source: null,
    });
  }
  for (const day of itinerary.days) {
    for (const t of day.flights) {
      const departs = t.entries.find((e) => e.step === 'departs');
      const leave = t.entries.find((e) => e.step === 'leave_lodging');
      if (departs && leave) {
        out.push({
          key: `checkin:${t.segmentId}`,
          kind: 'flight_checkin',
          params: { airport: departs.airport ?? '', date: departs.at.date, time: departs.at.time },
          country: departs.airport ? (AIRPORTS.get(departs.airport)?.country ?? null) : null,
          url: null,
          dueOn: departs.at.date,
          saleOpensOn: addDays(departs.at.date, -1),
          certainty: departs.certainty,
          source: null,
        });
      }
      // A ride in the quiet hours: book a private transfer.
      for (const e of t.entries) {
        if ((e.step === 'leave_lodging' || e.step === 'at_lodging') && e.transfer) {
          const m = minuteOfDay(e.at);
          if (m >= QUIET_HOURS[0] && m < QUIET_HOURS[1]) {
            out.push({
              key: `transfer:${t.segmentId}:${e.step}`,
              kind: 'private_transfer',
              params: {
                airport: e.airport ?? t.entries.find((x) => x.airport)?.airport ?? '',
                date: e.at.date,
                time: e.at.time,
              },
              country: null,
              url: null,
              dueOn: addDays(e.at.date, -7),
              saleOpensOn: null,
              certainty: 'estimated',
              source: e.transfer.source,
            });
          }
        }
      }
    }
  }

  // The car: one-way rental across borders, and the winter kit where the law asks.
  const pickup = input.anchors.find((a) => a.kind === 'car_pickup');
  const dropoff = input.anchors.find((a) => a.kind === 'car_return');
  if (pickup && dropoff) {
    const from = input.place(pickup.placeId);
    const to = input.place(dropoff.placeId);
    out.push({
      key: 'car:rental',
      kind: 'car_rental_one_way',
      params: { from: from.name, to: to.name, pickup: pickup.from, dropoff: dropoff.from },
      country: from.country,
      url: null,
      dueOn: addDays(pickup.from, -30),
      saleOpensOn: null,
      certainty: 'estimated',
      source: null,
    });
    const winterCountries = new Set<CountryCode>();
    for (const day of itinerary.days) {
      if (day.drivingMinutes === 0) continue;
      for (const c of day.countries) {
        const rule = winterRuleOn(c, day.date);
        if (rule && rule.kind !== 'no_specific_law') winterCountries.add(c);
      }
    }
    if (winterCountries.size > 0) {
      out.push({
        key: 'car:winter-kit',
        kind: 'car_winter_kit',
        params: { countries: [...winterCountries].join(', ') },
        country: from.country,
        url: null,
        dueOn: addDays(pickup.from, -30),
        saleOpensOn: null,
        certainty: 'unverified',
        source: null,
      });
    }
  }

  // Road charges: vignettes, tunnel tolls, ferries.
  const needs = chargesFor(
    itinerary.days
      .filter((d) => d.drives.length > 0)
      .map((d) => ({
        date: d.date,
        countries: d.countries,
        points: d.drives.flatMap((dr) => dr.points),
        ferry: d.ferryMinutes > 0,
      })),
  );
  for (const n of needs) {
    if (n.charge.kind === 'distance_toll') continue; // paid at the booth, nothing to book
    out.push({
      key: `charge:${n.charge.id}`,
      kind: n.charge.kind,
      params: {
        id: n.charge.id,
        price: n.charge.price ?? '',
        currency: n.charge.currency,
        firstUse: n.firstUse,
      },
      country: n.charge.country,
      url: n.charge.bookingUrl,
      dueOn: n.charge.buyBeforeEntry ? addDays(n.firstUse, -1) : n.firstUse,
      saleOpensOn: null,
      certainty: n.charge.certainty,
      source: n.charge.source,
    });
  }

  // Events with tickets, timed entries along the way.
  for (const a of input.anchors) {
    if (a.kind !== 'event') continue;
    const event = eventAt(a.placeId);
    if (!event) continue;
    out.push({
      key: `event:${a.placeId}:${a.from}`,
      kind: 'event_tickets',
      params: {
        name: event.name,
        date: a.from,
        opensAt: event.saleOpensAt ?? '',
        sellsOutFast: event.sellsOutFast ? 'yes' : 'no',
        resaleWarning: event.resaleWarning ? 'yes' : 'no',
      },
      country: input.place(a.placeId).country,
      url: event.ticketUrl,
      dueOn: event.saleOpensOn,
      saleOpensOn: event.saleOpensOn,
      certainty: event.certainty,
      source: event.source,
    });
  }
  const seen = new Set<string>();
  for (const day of itinerary.days) {
    const here = [day.sleep?.placeId, ...day.drives.flatMap((d) => d.points)].filter(
      (p): p is string => typeof p === 'string',
    );
    for (const placeId of here) {
      for (const act of ACTIVITIES) {
        if (act.placeId !== placeId || !act.needsBooking || seen.has(act.id)) continue;
        seen.add(act.id);
        out.push({
          key: `entry:${act.id}`,
          kind: 'timed_entry',
          params: { name: act.name, date: day.date },
          country: input.place(placeId).country,
          url: act.url ?? null,
          dueOn: addDays(day.date, -7),
          saleOpensOn: null,
          certainty: act.certainty,
          source: act.source ?? null,
        });
      }
    }
  }

  // Local transport worth buying ahead.
  if (itinerary.days.some((d) => d.sleep?.placeId === 'venezia')) {
    const first = itinerary.days.find((d) => d.sleep?.placeId === 'venezia');
    out.push({
      key: 'local:venezia-actv',
      kind: 'local_transport',
      params: { name: 'ACTV (vaporetto)' },
      country: 'IT',
      url: 'https://actv.avmspa.it/en',
      dueOn: first ? first.date : null,
      saleOpensOn: null,
      certainty: 'unverified',
      source: {
        name: 'ACTV',
        url: 'https://actv.avmspa.it/en',
        checkedOn: CHECKED_ON,
        mainPageOnly: true,
      },
    });
  }

  // Christmas Eve and New Year's Eve dinners book out.
  for (const day of itinerary.days) {
    const md = day.date.slice(5);
    if ((md === '12-24' || md === '12-31') && day.sleep) {
      out.push({
        key: `dinner:${day.date}`,
        kind: 'holiday_dinner',
        params: { date: day.date, place: input.place(day.sleep.placeId).name },
        country: input.place(day.sleep.placeId).country,
        url: null,
        dueOn: addDays(day.date, -21),
        saleOpensOn: null,
        certainty: 'estimated',
        source: null,
      });
    }
  }

  return out.sort((a, b) => {
    const ad = a.dueOn ?? '9999-12-31';
    const bd = b.dueOn ?? '9999-12-31';
    return ad < bd ? -1 : ad > bd ? 1 : a.key < b.key ? -1 : 1;
  });
}
