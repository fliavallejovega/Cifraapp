import { addDays, daysBetween, type PlainDate } from '@app/domain';

import { isFerry } from './catalog/corridors.js';
import type { Composition, DriveRequest } from './compose.js';
import {
  flightTimeline,
  layoverAdvice,
  type FlightTimeline,
  type LayoverAdvice,
} from './flights.js';
import { PASSES, winterRuleOn } from './roads.js';
import { sunTimes } from './sun.js';
import type {
  CountryCode,
  FlightSegment,
  GroundMode,
  Notice,
  Place,
  PlaceKind,
  RouteLeg,
  Stay,
  ZonedTime,
} from './types.js';
import { atMinute, minuteOfDay, minutesBetween } from './zoned.js';

/**
 * The trip, day by day: where you wake up and where you sleep, the flights
 * with their door-to-door timeline, the drives with honest minutes, the hour
 * the sun sets, and what to watch out for.
 */

export const ENGINE_VERSION = 'itinerary-1';

/** Default most minutes at the wheel in one day. */
export const DRIVING_BUDGET_MINUTES = 360;
/** Default departure from the lodging on a driving day. */
export const DEFAULT_DEPARTURE = '09:00';
/** What a border crossing and a mountain day add to the felt length of a day. */
const BORDER_WEIGHT_MINUTES = 30;
const MOUNTAIN_WEIGHT_MINUTES = 30;
/** Ferry boarding: be in the queue this early. */
const FERRY_BOARDING_MINUTES = 30;

/**
 * The router calculates at free flow on a dry road. In winter (November to
 * March) the plan adds 30 % on mountain legs and 15 % elsewhere. The result is
 * shown as `estimated`, next to the router's own figure.
 */
const WINTER_MOUNTAIN_PERCENT = 130;
const WINTER_FLAT_PERCENT = 115;
const MOUNTAIN_ELEVATION_M = 1000;
const MOUNTAIN_ASCENT_M_PER_KM = 20;

/** Time spent at a place passed on the way: a photo at a pass, a walk in a city. */
const STOP_MINUTES: Readonly<Record<PlaceKind, number>> = {
  pass: 15,
  poi: 45,
  market: 120,
  town: 45,
  city: 90,
  port: 0,
  airport: 0,
};

export type RouteResolver = (
  points: readonly string[],
  mode: GroundMode,
) => readonly RouteLeg[] | null;

export interface ItineraryInput {
  readonly start: PlainDate;
  readonly end: PlainDate;
  readonly flights: readonly FlightSegment[];
  /** Stays created by flights (connections, arrival and departure cities). */
  readonly flightStays: readonly Stay[];
  readonly composition: Composition;
  readonly place: (id: string) => Place;
  readonly routes: RouteResolver;
  readonly drivingBudgetMinutes?: number;
  readonly departureTime?: string;
}

export interface DayLeg extends RouteLeg {
  /** Minutes the plan counts, with winter added. */
  readonly plannedMinutes: number;
  readonly mountain: boolean;
}

export interface DayDrive {
  readonly purpose: DriveRequest['purpose'];
  readonly points: readonly string[];
  readonly legs: readonly DayLeg[];
  /** True when some stretch has not been routed yet. */
  readonly incomplete: boolean;
  readonly stopMinutes?: Readonly<Record<string, number>>;
}

export interface ItineraryDay {
  readonly date: PlainDate;
  readonly index: number;
  readonly kind: 'flight' | 'drive' | 'rest';
  /** Where the night is spent; null on a plane or back home. */
  readonly sleep: Stay | null;
  readonly flights: readonly FlightTimeline[];
  readonly layovers: readonly LayoverAdvice[];
  readonly drives: readonly DayDrive[];
  /** Car only, winter included. */
  readonly drivingMinutes: number;
  readonly routerMinutes: number;
  readonly distanceM: number;
  readonly ferryMinutes: number;
  readonly countries: readonly CountryCode[];
  readonly departure: ZonedTime | null;
  readonly estimatedArrival: ZonedTime | null;
  readonly sunset: ZonedTime | null;
  readonly notices: readonly Notice[];
}

export interface ItineraryTotals {
  readonly days: number;
  readonly lodgingNights: number;
  readonly drivingDays: number;
  readonly distanceM: number;
  readonly drivingMinutes: number;
  readonly routerMinutes: number;
  readonly ferryMinutes: number;
}

export interface Itinerary {
  readonly engineVersion: string;
  readonly days: readonly ItineraryDay[];
  readonly totals: ItineraryTotals;
  readonly notices: readonly Notice[];
}

function isWinter(date: PlainDate): boolean {
  const month = Number(date.slice(5, 7));
  return month >= 11 || month <= 3;
}

function isMountain(leg: RouteLeg): boolean {
  if ((leg.maxElevationM ?? 0) >= MOUNTAIN_ELEVATION_M) return true;
  const km = leg.distanceM / 1000;
  return km > 0 && (leg.ascentM ?? 0) / km >= MOUNTAIN_ASCENT_M_PER_KM;
}

function plannedMinutes(leg: RouteLeg, date: PlainDate): number {
  const minutes = leg.durationS / 60;
  if (leg.mode === 'ferry') return Math.ceil(minutes) + FERRY_BOARDING_MINUTES;
  if (!isWinter(date)) return Math.ceil(minutes);
  const percent = isMountain(leg) ? WINTER_MOUNTAIN_PERCENT : WINTER_FLAT_PERCENT;
  return Math.ceil((minutes * percent) / 100);
}

/** A drive split at ferry crossings: each piece goes to the router on its own. */
export function routeRequestsFor(
  points: readonly string[],
): { points: string[]; mode: GroundMode }[] {
  const out: { points: string[]; mode: GroundMode }[] = [];
  let current: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p === undefined) continue;
    const next = points[i + 1];
    current.push(p);
    if (next !== undefined && isFerry(p, next)) {
      if (current.length > 1) out.push({ points: current, mode: 'car' });
      out.push({ points: [p, next], mode: 'ferry' });
      current = [];
    }
  }
  if (current.length > 1) out.push({ points: current, mode: 'car' });
  return out;
}

function stayOn(stays: readonly Stay[], date: PlainDate): Stay | null {
  for (const s of stays) {
    const offset = daysBetween(s.firstNight, date);
    if (offset >= 0 && offset < s.nights) return s;
  }
  return null;
}

function unique<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

export function buildItinerary(input: ItineraryInput): Itinerary {
  const budget = input.drivingBudgetMinutes ?? DRIVING_BUDGET_MINUTES;
  const departureTime = input.departureTime ?? DEFAULT_DEPARTURE;
  const stays = [...input.flightStays, ...input.composition.stays];
  const flights = [...input.flights].sort((a, b) => minutesBetween(b.departs, a.departs));
  const tripNotices: Notice[] = [...input.composition.notices];

  // Timelines once per segment; each day shows the entries that fall on it.
  const timelines = flights.map((seg, i) => {
    const prev = flights[i - 1];
    const next = flights[i + 1];
    const connectingIn = prev?.to === seg.from && prev.arrives.date === seg.departs.date;
    const connectingOut = next?.from === seg.to && next.departs.date === seg.arrives.date;
    return flightTimeline(seg, { fromLodging: !connectingIn, toLodging: !connectingOut });
  });
  const layovers: LayoverAdvice[] = [];
  for (let i = 0; i + 1 < flights.length; i++) {
    const a = flights[i];
    const b = flights[i + 1];
    if (a && a.to === b?.from) {
      const advice = layoverAdvice(a, b);
      if (advice) layovers.push(advice);
    }
  }

  const winterNoticed = new Set<CountryCode>();
  const days: ItineraryDay[] = [];
  const dayCount = daysBetween(input.start, input.end) + 1;

  for (let index = 0; index < dayCount; index++) {
    const date = addDays(input.start, index);
    const notices: Notice[] = [];

    const dayTimelines: FlightTimeline[] = timelines
      .map((t) => ({ ...t, entries: t.entries.filter((e) => e.at.date === date) }))
      .filter((t) => t.entries.length > 0);
    const dayLayovers = layovers.filter(
      (l) => flights.find((f) => f.id === l.arrivalSegmentId)?.arrives.date === date,
    );

    const drives: DayDrive[] = [];
    for (const req of input.composition.drives.filter((d) => d.date === date)) {
      const legs: DayLeg[] = [];
      let incomplete = false;
      for (const piece of routeRequestsFor(req.points)) {
        const resolved = input.routes(piece.points, piece.mode);
        if (!resolved) {
          incomplete = true;
          continue;
        }
        for (const leg of resolved) {
          legs.push({
            ...leg,
            plannedMinutes: plannedMinutes(leg, date),
            mountain: isMountain(leg),
          });
        }
      }
      if (incomplete) notices.push({ code: 'route_pending', severity: 'info' });
      drives.push({
        purpose: req.purpose,
        points: req.points,
        legs,
        incomplete,
        ...(req.stopMinutes ? { stopMinutes: req.stopMinutes } : {}),
      });
    }

    const carLegs = drives.flatMap((d) => d.legs).filter((l) => l.mode === 'car');
    const ferryLegs = drives.flatMap((d) => d.legs).filter((l) => l.mode === 'ferry');
    const drivingMinutes = carLegs.reduce((s, l) => s + l.plannedMinutes, 0);
    const routerMinutes = carLegs.reduce((s, l) => s + Math.ceil(l.durationS / 60), 0);
    const distanceM = carLegs.reduce((s, l) => s + l.distanceM, 0);
    const ferryMinutes = ferryLegs.reduce((s, l) => s + l.plannedMinutes, 0);
    const points = drives.flatMap((d) => d.points);
    const countries = unique(points.map((p) => input.place(p).country));
    const mountain = carLegs.some((l) => l.mountain);

    let departure: ZonedTime | null = null;
    let estimatedArrival: ZonedTime | null = null;
    let sunset: ZonedTime | null = null;
    const move = drives.find((d) => d.purpose === 'move');
    if (move && move.legs.length > 0) {
      const first = input.place(move.points[0] ?? '');
      const last = input.place(move.points[move.points.length - 1] ?? '');
      const [h, m] = departureTime.split(':').map(Number) as [number, number];
      departure = atMinute(date, h * 60 + m, first.timeZone);
      const stops = move.points
        .slice(1, -1)
        .reduce((s, p) => s + (move.stopMinutes?.[p] ?? STOP_MINUTES[input.place(p).kind]), 0);
      const moveMinutes = move.legs.reduce((s, l) => s + l.plannedMinutes, 0);
      estimatedArrival = atMinute(date, h * 60 + m + moveMinutes + stops, last.timeZone);
      sunset = sunTimes(date, last.lat, last.lon, last.timeZone)?.sunset ?? null;
      const dark =
        sunset !== null &&
        (estimatedArrival.date > date || minuteOfDay(estimatedArrival) > minuteOfDay(sunset));
      if (dark && sunset) {
        // The latest departure that still arrives in daylight, if the day allows one.
        const sunrise = sunTimes(date, first.lat, first.lon, first.timeZone)?.sunrise;
        const latest = minuteOfDay(sunset) - moveMinutes - stops;
        const feasible = sunrise !== undefined && latest >= minuteOfDay(sunrise);
        notices.push({
          code: mountain ? 'mountain_after_dark' : 'arrives_after_dark',
          severity: mountain ? 'warning' : 'info',
          params: {
            sunset: sunset.time,
            arrival: estimatedArrival.time,
            leaveBy: feasible ? atMinute(date, latest, first.timeZone).time : '',
          },
        });
      }
    }

    if (drivingMinutes > 0) {
      const weighted =
        drivingMinutes +
        BORDER_WEIGHT_MINUTES * Math.max(countries.length - 1, 0) +
        (mountain ? MOUNTAIN_WEIGHT_MINUTES : 0);
      if (weighted > budget) {
        notices.push({
          code: 'over_driving_budget',
          severity: 'warning',
          params: { minutes: drivingMinutes, weighted, budget },
        });
      }
      if (countries.length > 1) {
        notices.push({
          code: 'border_day',
          severity: 'info',
          params: { countries: countries.join(' → ') },
        });
      }
    }

    for (const p of points) {
      const pass = PASSES.get(p);
      if (pass && pass.status !== 'open_all_year' && isWinter(date)) {
        notices.push({
          code: pass.status === 'closed_in_winter' ? 'pass_closed' : 'pass_may_close',
          severity: pass.status === 'closed_in_winter' ? 'critical' : 'warning',
          params: { pass: p, alternative: pass.alternative ?? '' },
        });
      }
    }
    if (drivingMinutes > 0) {
      for (const c of countries) {
        const rule = winterRuleOn(c, date);
        if (rule && rule.kind !== 'no_specific_law' && !winterNoticed.has(c)) {
          winterNoticed.add(c);
          notices.push({
            code: `winter_${rule.kind}`,
            severity: 'warning',
            params: { country: c },
          });
        }
      }
    }
    if (ferryLegs.length > 0)
      notices.push({ code: 'ferry_book', severity: 'warning', params: { minutes: ferryMinutes } });
    // A timeline's notices belong to the day of the moment they describe.
    for (const t of dayTimelines)
      notices.push(...t.notices.filter((n) => n.params?.['date'] === date));
    for (const l of dayLayovers) notices.push(...l.notices);

    const sleep = index === dayCount - 1 ? null : stayOn(stays, date);
    days.push({
      date,
      index,
      kind: dayTimelines.length > 0 ? 'flight' : drivingMinutes > 0 ? 'drive' : 'rest',
      sleep,
      flights: dayTimelines,
      layovers: dayLayovers,
      drives,
      drivingMinutes,
      routerMinutes,
      distanceM,
      ferryMinutes,
      countries,
      departure,
      estimatedArrival,
      sunset,
      notices,
    });
  }

  // Car return before a holiday when shops and offices close.
  const lastDrive = input.composition.drives[input.composition.drives.length - 1];
  if (lastDrive) {
    const md = lastDrive.date.slice(5);
    if (md === '12-24' || md === '12-25' || md === '12-31' || md === '01-01') {
      tripNotices.push({
        code: 'car_return_on_holiday',
        severity: 'warning',
        params: { date: lastDrive.date },
      });
    }
  }
  const nightsWithoutBed = days
    .slice(0, -1)
    .filter((d) => d.sleep === null && d.flights.length === 0);
  for (const d of nightsWithoutBed) {
    tripNotices.push({
      code: 'night_without_lodging',
      severity: 'critical',
      params: { date: d.date },
    });
  }

  const totals: ItineraryTotals = {
    days: days.length,
    lodgingNights: days.filter((d) => d.sleep !== null).length,
    drivingDays: days.filter((d) => d.drivingMinutes > 0).length,
    distanceM: days.reduce((s, d) => s + d.distanceM, 0),
    drivingMinutes: days.reduce((s, d) => s + d.drivingMinutes, 0),
    routerMinutes: days.reduce((s, d) => s + d.routerMinutes, 0),
    ferryMinutes: days.reduce((s, d) => s + d.ferryMinutes, 0),
  };

  return { engineVersion: ENGINE_VERSION, days, totals, notices: tripNotices };
}

/** Minutes the drives of one plan take, for comparing a plan with and without wishes. */
export function drivesMinutes(
  drives: readonly DriveRequest[],
  routes: RouteResolver,
): number | null {
  let sum = 0;
  for (const d of drives) {
    for (const piece of routeRequestsFor(d.points)) {
      const legs = routes(piece.points, piece.mode);
      if (!legs) return null;
      for (const l of legs) if (l.mode === 'car') sum += plannedMinutes(l, d.date);
    }
  }
  return sum;
}

/** Countries set foot in, day by day: where you sleep, drive through, take off and land. */
export function presenceOf(
  itinerary: Itinerary,
  place: (id: string) => Place,
  airportCountry: (iata: string) => CountryCode | null,
): { date: PlainDate; countries: CountryCode[] }[] {
  return itinerary.days.map((d) => {
    const countries = new Set<CountryCode>(d.countries);
    if (d.sleep) countries.add(place(d.sleep.placeId).country);
    for (const t of d.flights) {
      for (const e of t.entries) {
        if (
          e.airport &&
          (e.step === 'departs' ||
            e.step === 'arrives' ||
            e.step === 'at_airport' ||
            e.step === 'exit_airport')
        ) {
          const c = airportCountry(e.airport);
          if (c) countries.add(c);
        }
      }
    }
    return { date: d.date, countries: [...countries] };
  });
}
