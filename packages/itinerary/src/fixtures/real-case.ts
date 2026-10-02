import { toPlainDate } from '@app/domain';

import { CORRIDORS } from '../catalog/corridors.js';
import { placeOf } from '../catalog/places.js';
import type { ComposeInput } from '../compose.js';
import type { RouteResolver } from '../days.js';
import { estimateConnection, type TicketJourney } from '../flights.js';
import type { Anchor, FlightSegment, RouteLeg, SourceRef, Traveler, Wish } from '../types.js';

import { REAL_CASE_ROUTES } from './real-case-routes.js';

/**
 * The trip this product was born from, as the person would enter it: two
 * travellers, a Turkish Airlines ticket that only prints the outer times,
 * friends in Arosa, a Christmas market on a Saturday, a car returned in
 * Copenhagen before Christmas Eve, and one wish — the Dolomites.
 *
 * Nothing in here is an itinerary. The itinerary is what the engine makes
 * of it; the acceptance test checks that it comes out right on its own.
 */

const d = toPlainDate;

export const REAL_CASE_TRAVELERS: readonly Traveler[] = [
  { id: 't-co', name: 'Viajero', nationalities: ['CO'], residence: 'PA' },
  { id: 't-pa', name: 'Viajera', nationalities: ['PA'], residence: 'PA' },
];

/** What the ticket prints: origin, destination and the outer local times. */
export const REAL_CASE_TICKET: readonly TicketJourney[] = [
  {
    from: 'PTY',
    via: 'IST',
    to: 'VCE',
    departs: { date: d('2026-12-09'), time: '22:00', timeZone: 'America/Panama' },
    arrives: { date: d('2026-12-11'), time: '13:50', timeZone: 'Europe/Rome' },
  },
  {
    from: 'CPH',
    via: 'IST',
    to: 'PTY',
    departs: { date: d('2026-12-26'), time: '10:35', timeZone: 'Europe/Copenhagen' },
    arrives: { date: d('2026-12-27'), time: '17:10', timeZone: 'America/Panama' },
  },
];

export function realCaseFlights(): FlightSegment[] {
  const [out, back] = REAL_CASE_TICKET;
  if (!out || !back) return [];
  const a = estimateConnection(out, ['f1', 'f2']);
  const b = estimateConnection(back, ['f3', 'f4']);
  if (!a || !b) throw new Error('Typical block times missing for the reference ticket.');
  return [...a, ...b];
}

export const REAL_CASE_ANCHORS: readonly Anchor[] = [
  {
    id: 'a-car-pickup',
    kind: 'car_pickup',
    placeId: 'venezia',
    from: d('2026-12-12'),
    to: d('2026-12-12'),
    certainty: 'confirmed',
  },
  {
    id: 'a-friends',
    kind: 'friends',
    placeId: 'arosa',
    from: d('2026-12-15'),
    to: d('2026-12-16'),
    maxNights: 3,
    hosted: true,
    certainty: 'confirmed',
    label: 'Amigos en Arosa',
  },
  {
    id: 'a-market',
    kind: 'event',
    placeId: 'ravenna',
    from: d('2026-12-19'),
    to: d('2026-12-19'),
    certainty: 'confirmed',
    label: 'Mercado de la Ravennaschlucht',
  },
  {
    id: 'a-car-return',
    kind: 'car_return',
    placeId: 'kastrup',
    from: d('2026-12-23'),
    to: d('2026-12-23'),
    certainty: 'confirmed',
  },
];

export const REAL_CASE_WISHES: readonly Wish[] = [
  { id: 'w-dolomitas', text: 'Mi esposa quiere ir a las Dolomitas', tags: ['dolomitas'] },
];

export function realCaseComposeInput(wishes: readonly Wish[] = REAL_CASE_WISHES): ComposeInput {
  return {
    ground: {
      start: { placeId: 'venezia', date: d('2026-12-12') },
      end: { placeId: 'kastrup', date: d('2026-12-23') },
    },
    anchors: REAL_CASE_ANCHORS.filter((a) => a.kind !== 'car_pickup' && a.kind !== 'car_return'),
    wishes,
    corridors: CORRIDORS,
    sleepNear: { ravenna: 'hinterzarten' },
  };
}

const ORS: SourceRef = {
  name: 'openrouteservice (driving-car)',
  url: 'https://openrouteservice.org',
  checkedOn: d(REAL_CASE_ROUTES.consultedAt),
};

/** Resolves drives from the frozen router answers; unknown drives stay unrouted. */
export const realCaseRoutes: RouteResolver = (points, mode) => {
  const route = REAL_CASE_ROUTES.routes.find(
    (r) => r.via.length === points.length && r.via.every((p, i) => p === points[i]),
  );
  if (!route) return null;
  return route.segments.map((s, i): RouteLeg => ({
    from: route.via[i] ?? '',
    to: route.via[i + 1] ?? '',
    mode: route.mode === 'ferry' ? 'ferry' : mode,
    distanceM: s.distanceM,
    durationS: s.durationS,
    ascentM: s.ascentM,
    maxElevationM: s.maxElevationM,
    source: ORS,
    certainty: 'estimated',
  }));
};

export { placeOf as realCasePlace };
