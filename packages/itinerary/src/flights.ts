import { addDays, daysBetween, toPlainDate, type PlainDate } from '@app/domain';

import {
  AIRPORTS,
  ENTRY_MINUTES,
  INTERNATIONAL_CHECKIN_MINUTES,
  LAYOVER_EXIT_MINUTES,
  LONG_LAYOVER_MINUTES,
  TYPICAL_BLOCK_MINUTES,
  type TransferOption,
} from './catalog/airports.js';
import type { Certainty, FlightSegment, Notice, SourceRef, Stay, ZonedTime } from './types.js';
import { addMinutes, minuteOfDay, minutesBetween, zoneDifferenceMinutes } from './zoned.js';

/**
 * Flights: the nights they create, the day-of timeline from hotel door to
 * hotel door, and what to do with a long connection.
 */

// ---------------------------------------------------------------------------
// Connections the ticket does not print
// ---------------------------------------------------------------------------

export interface TicketJourney {
  readonly from: string;
  readonly via: string;
  readonly to: string;
  readonly departs: ZonedTime;
  readonly arrives: ZonedTime;
}

/**
 * Splits a ticket that only shows origin, destination and total duration into
 * its two flights, using typical block times and the real zone of each
 * airport. The two printed times stay `confirmed`; the two at the connection
 * are `estimated` and the screen asks for the exact ones.
 */
export function estimateConnection(
  j: TicketJourney,
  ids: readonly [string, string],
): [FlightSegment, FlightSegment] | null {
  const hub = AIRPORTS.get(j.via);
  const first = TYPICAL_BLOCK_MINUTES[`${j.from}-${j.via}`];
  const second = TYPICAL_BLOCK_MINUTES[`${j.via}-${j.to}`];
  if (!hub || first === undefined || second === undefined) return null;
  const arrivesHub = addMinutes(j.departs, first, hub.timeZone);
  const departsHub = addMinutes(j.arrives, -second, hub.timeZone);
  if (minutesBetween(arrivesHub, departsHub) < 0) return null;
  return [
    {
      id: ids[0],
      from: j.from,
      to: j.via,
      departs: j.departs,
      departsCertainty: 'confirmed',
      arrives: arrivesHub,
      arrivesCertainty: 'estimated',
    },
    {
      id: ids[1],
      from: j.via,
      to: j.to,
      departs: departsHub,
      departsCertainty: 'estimated',
      arrives: j.arrives,
      arrivesCertainty: 'confirmed',
    },
  ];
}

// ---------------------------------------------------------------------------
// Nights that flights create
// ---------------------------------------------------------------------------

export interface FlightStayBounds {
  /** First day of the ground part (car pick-up). */
  readonly groundStart: PlainDate | null;
  /** Last day of the ground part (car return). */
  readonly groundEnd: PlainDate | null;
}

function cityOf(iata: string): string | null {
  return AIRPORTS.get(iata)?.cityPlaceId ?? null;
}

/**
 * Nights spent because of flights: a connection that crosses midnight on the
 * ground, the city of arrival before the ground part starts, and the city of
 * departure after it ends. A night on a plane is not a stay.
 */
export function flightStays(segments: readonly FlightSegment[], bounds: FlightStayBounds): Stay[] {
  const sorted = [...segments].sort((a, b) => minutesBetween(b.departs, a.departs));
  const stays: Stay[] = [];
  const push = (placeId: string | null, firstNight: PlainDate, lastDayExclusive: PlainDate) => {
    const nights = daysBetween(firstNight, lastDayExclusive);
    if (!placeId || nights <= 0) return;
    stays.push({ placeId, firstNight, nights, origin: 'flight', hosted: false, paid: false });
  };

  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    if (!seg) continue;
    const next = sorted[i + 1];
    const arrivalDay = seg.arrives.date;
    if (next?.from === seg.to) {
      // Same airport: a layover. Only the nights on the ground count.
      push(cityOf(seg.to), arrivalDay, next.departs.date);
      continue;
    }
    if (bounds.groundStart && arrivalDay <= bounds.groundStart) {
      push(cityOf(seg.to), arrivalDay, bounds.groundStart);
    }
    if (next && bounds.groundEnd && next.departs.date >= bounds.groundEnd) {
      push(cityOf(next.from), bounds.groundEnd, next.departs.date);
    }
  }
  return stays.sort((a, b) => (a.firstNight < b.firstNight ? -1 : 1));
}

// ---------------------------------------------------------------------------
// The day of a flight
// ---------------------------------------------------------------------------

export type TimelineStep =
  'leave_lodging' | 'at_airport' | 'departs' | 'arrives' | 'exit_airport' | 'at_lodging';

export interface TimelineEntry {
  readonly step: TimelineStep;
  readonly at: ZonedTime;
  readonly certainty: Certainty;
  readonly airport?: string;
  /** For `arrives`: minutes the arrival zone is ahead of the departure zone. */
  readonly zoneDifferenceMinutes?: number;
  readonly transfer?: {
    readonly mode: TransferOption['mode'];
    readonly minutes: number;
    readonly source: SourceRef;
  };
}

export interface FlightTimeline {
  readonly segmentId: string;
  readonly entries: readonly TimelineEntry[];
  readonly notices: readonly Notice[];
}

function inService(option: TransferOption, at: ZonedTime): boolean {
  if (!option.serviceHours) return true;
  const [open, close] = option.serviceHours.map((t) => {
    const [h, m] = t.split(':').map(Number) as [number, number];
    return h * 60 + m;
  }) as [number, number];
  const now = minuteOfDay(at);
  return close > open ? now >= open && now < close : now >= open || now < close;
}

function isRush(at: ZonedTime): boolean {
  const m = minuteOfDay(at);
  return (m >= 420 && m < 570) || (m >= 1020 && m < 1170);
}

/** The quickest transfer running at that hour, with rush-hour traffic added. */
export function pickTransfer(
  iata: string,
  at: ZonedTime,
): { option: TransferOption; minutes: number; notices: Notice[] } | null {
  const airport = AIRPORTS.get(iata);
  if (!airport) return null;
  const notices: Notice[] = [];
  let best: { option: TransferOption; minutes: number } | null = null;
  for (const option of airport.transfers) {
    if (!inService(option, at)) {
      notices.push({
        code: 'transfer_not_running',
        severity: 'info',
        params: { airport: iata, mode: option.mode },
      });
      continue;
    }
    const minutes = option.minutes + (isRush(at) ? (option.rushExtraMinutes ?? 0) : 0);
    if (!best || minutes < best.minutes) best = { option, minutes };
  }
  if (!best) return null;
  if (isRush(at) && best.option.rushExtraMinutes) {
    notices.push({
      code: 'transfer_rush_hour',
      severity: 'info',
      params: { airport: iata, minutes: best.option.rushExtraMinutes },
    });
  }
  return { ...best, notices };
}

export interface TimelineContext {
  /** True when the night before was spent in this city (not on a connecting flight). */
  readonly fromLodging: boolean;
  /** True when the night after is spent in the arrival city. */
  readonly toLodging: boolean;
}

/**
 * Door to door: leave the lodging, be at the airport three hours early, fly,
 * clear immigration and bags, ride to the next lodging. Every derived step is
 * `estimated`; the flight's own times keep the certainty of the ticket.
 */
export function flightTimeline(seg: FlightSegment, ctx: TimelineContext): FlightTimeline {
  const entries: TimelineEntry[] = [];
  const notices: Notice[] = [];

  if (ctx.fromLodging) {
    const atAirport = addMinutes(seg.departs, -INTERNATIONAL_CHECKIN_MINUTES);
    const transfer = pickTransfer(seg.from, atAirport);
    if (transfer) {
      notices.push(...transfer.notices);
      entries.push({
        step: 'leave_lodging',
        at: addMinutes(atAirport, -transfer.minutes),
        certainty: 'estimated',
        transfer: {
          mode: transfer.option.mode,
          minutes: transfer.minutes,
          source: transfer.option.source,
        },
      });
    }
    entries.push({ step: 'at_airport', at: atAirport, certainty: 'estimated', airport: seg.from });
  }

  entries.push({
    step: 'departs',
    at: seg.departs,
    certainty: seg.departsCertainty,
    airport: seg.from,
  });
  entries.push({
    step: 'arrives',
    at: seg.arrives,
    certainty: seg.arrivesCertainty,
    airport: seg.to,
    zoneDifferenceMinutes: zoneDifferenceMinutes(seg.departs, seg.arrives.timeZone),
  });

  if (ctx.toLodging) {
    const exit = addMinutes(seg.arrives, ENTRY_MINUTES);
    entries.push({ step: 'exit_airport', at: exit, certainty: 'estimated', airport: seg.to });
    const transfer = pickTransfer(seg.to, exit);
    if (transfer) {
      notices.push(...transfer.notices);
      entries.push({
        step: 'at_lodging',
        at: addMinutes(exit, transfer.minutes),
        certainty: 'estimated',
        transfer: {
          mode: transfer.option.mode,
          minutes: transfer.minutes,
          source: transfer.option.source,
        },
      });
    }
  }
  return { segmentId: seg.id, entries, notices };
}

// ---------------------------------------------------------------------------
// Long connections
// ---------------------------------------------------------------------------

export const TURKISH_STOPOVER: SourceRef = {
  name: 'Turkish Airlines — Stopover',
  url: 'https://www.turkishairlines.com/en-int/flights/stopover/',
  checkedOn: toPlainDate('2026-10-02'),
  mainPageOnly: true,
};

export interface LayoverAdvice {
  readonly airport: string;
  readonly arrivalSegmentId: string;
  readonly departureSegmentId: string;
  readonly minutes: number;
  readonly overnight: boolean;
  /** Minutes available in the city after exit and the trip back for check-in. */
  readonly cityMinutes: number;
  readonly options: readonly ('hotel' | 'airline_stopover' | 'layover_tour' | 'stay_airside')[];
  readonly notices: readonly Notice[];
}

/** What a connection of more than six hours allows, with its conditions. */
export function layoverAdvice(
  arrival: FlightSegment,
  departure: FlightSegment,
): LayoverAdvice | null {
  const minutes = minutesBetween(arrival.arrives, departure.departs);
  if (minutes < LONG_LAYOVER_MINUTES) return null;
  const airport = AIRPORTS.get(arrival.to);
  const out =
    airport?.transfers.reduce((m, t) => Math.min(m, t.minutes), Number.POSITIVE_INFINITY) ?? 60;
  const cityMinutes = Math.max(
    minutes - LAYOVER_EXIT_MINUTES - out * 2 - INTERNATIONAL_CHECKIN_MINUTES,
    0,
  );
  const overnight = arrival.arrives.date !== departure.departs.date;
  const options: LayoverAdvice['options'][number][] = [];
  const notices: Notice[] = [
    { code: 'layover_visa_check', severity: 'warning', params: { airport: arrival.to } },
  ];
  if (overnight || cityMinutes >= 4 * 60) options.push('hotel');
  // Turkish Airlines' programme: connections of at least 20 h, requested 72 h ahead.
  if (arrival.to === 'IST' && minutes >= 20 * 60) {
    options.push('airline_stopover');
    notices.push({ code: 'stopover_request_72h', severity: 'info', params: { hours: 72 } });
  }
  if (cityMinutes >= 3 * 60) options.push('layover_tour');
  if (options.length === 0) options.push('stay_airside');
  return {
    airport: arrival.to,
    arrivalSegmentId: arrival.id,
    departureSegmentId: departure.id,
    minutes,
    overnight,
    cityMinutes,
    options,
    notices,
  };
}

/** The connection day as calendar dates, for planners that only need days. */
export function layoverNights(arrival: FlightSegment, departure: FlightSegment): PlainDate[] {
  const out: PlainDate[] = [];
  for (let d = arrival.arrives.date; d < departure.departs.date; d = addDays(d, 1)) out.push(d);
  return out;
}
