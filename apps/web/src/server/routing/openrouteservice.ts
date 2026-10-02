import 'server-only';

import { getServerEnv } from '@app/validation/env';

/**
 * openrouteservice: the router behind Rumbo's driving legs.
 *
 * One request per drive (a start, the places passed, an end) returns the
 * distance, the minutes and the climb of each stretch, plus a geometry the
 * map draws. Every answer is stored with its source and date by the caller;
 * this module only asks.
 *
 * Without a key the provider is absent and the caller leaves the legs
 * «por calcular», which is a supported state, not a failure.
 */

const DIRECTIONS = 'https://api.openrouteservice.org/v2/directions';
export const ORS_SOURCE = {
  name: 'openrouteservice',
  url: 'https://openrouteservice.org',
} as const;

/** A coordinate as the router wants it. */
export interface LonLat {
  readonly lon: number;
  readonly lat: number;
}

export interface RoutedLeg {
  readonly distanceM: number;
  readonly durationS: number;
  readonly ascentM: number;
  readonly maxElevationM: number;
}

export interface RoutedDrive {
  readonly legs: readonly RoutedLeg[];
  /** [lon, lat, elevation], simplified. */
  readonly geometry: readonly [number, number, number][];
}

export type RouteFailure = 'not_configured' | 'not_routable' | 'quota' | 'unavailable';

export type RouteAnswer = { ok: true; drive: RoutedDrive } | { ok: false; failure: RouteFailure };

interface OrsFeature {
  geometry: { coordinates: number[][] };
  properties: {
    segments?: { distance: number; duration: number }[];
    way_points?: number[];
  };
}

export function routingConfigured(): boolean {
  return Boolean(getServerEnv().ORS_API_KEY);
}

/** Douglas–Peucker on lon/lat, about 300 m: enough for a map of a country. */
export function simplify(
  points: readonly [number, number, number][],
  epsilon = 0.003,
): [number, number, number][] {
  if (points.length < 3) return [...points];
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return [...points];
  let index = 0;
  let max = 0;
  const [x1, y1] = first;
  const dx = last[0] - x1;
  const dy = last[1] - y1;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    if (!p) continue;
    const t =
      dx === 0 && dy === 0
        ? 0
        : Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(p[0] - x1 - t * dx, p[1] - y1 - t * dy);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= epsilon) return [first, last];
  const left = simplify(points.slice(0, index + 1), epsilon);
  const right = simplify(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

/** Climb and highest point of one stretch, from the full-resolution geometry. */
function stretchProfile(
  coords: readonly number[][],
  from: number,
  to: number,
): { ascentM: number; maxElevationM: number } {
  let ascentM = 0;
  let maxElevationM = 0;
  for (let i = from; i <= to; i++) {
    const z = coords[i]?.[2] ?? 0;
    if (z > maxElevationM) maxElevationM = z;
    if (i > from) {
      const prev = coords[i - 1]?.[2] ?? 0;
      if (z > prev) ascentM += z - prev;
    }
  }
  return { ascentM: Math.round(ascentM), maxElevationM: Math.round(maxElevationM) };
}

export async function routeDrive(
  points: readonly LonLat[],
  signal?: AbortSignal,
): Promise<RouteAnswer> {
  const key = getServerEnv().ORS_API_KEY;
  if (!key) return { ok: false, failure: 'not_configured' };

  let response: Response;
  try {
    response = await fetch(`${DIRECTIONS}/driving-car/geojson`, {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coordinates: points.map((p) => [p.lon, p.lat]),
        elevation: true,
        instructions: true,
        maneuvers: false,
        // Places like a ferry pier or a pass sit off the road graph.
        radiuses: points.map(() => 2000),
      }),
      signal: signal ?? AbortSignal.timeout(20_000),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, failure: 'unavailable' };
  }

  if (response.status === 404 || response.status === 400)
    return { ok: false, failure: 'not_routable' };
  if (response.status === 429 || response.status === 403) return { ok: false, failure: 'quota' };
  if (!response.ok) return { ok: false, failure: 'unavailable' };

  const body = (await response.json()) as { features?: OrsFeature[] };
  const feature = body.features?.[0];
  const segments = feature?.properties.segments ?? [];
  const coords = feature?.geometry.coordinates ?? [];
  const wayPoints = feature?.properties.way_points ?? [];
  if (!feature || segments.length !== points.length - 1)
    return { ok: false, failure: 'not_routable' };

  const legs: RoutedLeg[] = segments.map((s, i) => ({
    distanceM: Math.round(s.distance),
    durationS: Math.round(s.duration),
    ...stretchProfile(coords, wayPoints[i] ?? 0, wayPoints[i + 1] ?? coords.length - 1),
  }));
  const geometry = simplify(
    coords.map((c): [number, number, number] => [
      Math.round((c[0] ?? 0) * 1e5) / 1e5,
      Math.round((c[1] ?? 0) * 1e5) / 1e5,
      Math.round(c[2] ?? 0),
    ]),
  );
  return { ok: true, drive: { legs, geometry } };
}

// ---------------------------------------------------------------------------
// Places by name
// ---------------------------------------------------------------------------

const GEOCODE = 'https://api.openrouteservice.org/geocode/search';

/**
 * Zones for countries with a single one. A place in a country with several
 * (the United States, Brazil…) needs the person to pick its zone.
 */
export const SINGLE_ZONE: Readonly<Record<string, string>> = {
  IT: 'Europe/Rome',
  AT: 'Europe/Vienna',
  CH: 'Europe/Zurich',
  DE: 'Europe/Berlin',
  DK: 'Europe/Copenhagen',
  FR: 'Europe/Paris',
  NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels',
  LU: 'Europe/Luxembourg',
  CZ: 'Europe/Prague',
  SI: 'Europe/Ljubljana',
  HR: 'Europe/Zagreb',
  HU: 'Europe/Budapest',
  PL: 'Europe/Warsaw',
  SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  GR: 'Europe/Athens',
  TR: 'Europe/Istanbul',
  PA: 'America/Panama',
  CO: 'America/Bogota',
  CR: 'America/Costa_Rica',
};

export interface GeocodedPlace {
  readonly name: string;
  readonly label: string;
  readonly country: string;
  readonly lat: number;
  readonly lon: number;
  readonly timeZone: string | null;
  readonly kind: 'city' | 'town' | 'poi';
}

interface PeliasFeature {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; label?: string; country_a?: string; layer?: string };
}

/** The geocoder answers ISO alpha-3; the rest of the product speaks alpha-2. */
const ALPHA3: Readonly<Record<string, string>> = {
  ITA: 'IT',
  AUT: 'AT',
  CHE: 'CH',
  DEU: 'DE',
  DNK: 'DK',
  FRA: 'FR',
  NLD: 'NL',
  BEL: 'BE',
  LUX: 'LU',
  CZE: 'CZ',
  SVN: 'SI',
  HRV: 'HR',
  HUN: 'HU',
  POL: 'PL',
  SWE: 'SE',
  NOR: 'NO',
  GBR: 'GB',
  IRL: 'IE',
  GRC: 'GR',
  TUR: 'TR',
  PAN: 'PA',
  COL: 'CO',
  CRI: 'CR',
  ESP: 'ES',
  PRT: 'PT',
  USA: 'US',
  MEX: 'MX',
  BRA: 'BR',
  ARG: 'AR',
  CHL: 'CL',
  PER: 'PE',
  NGA: 'NG',
};

/**
 * Up to five places matching a name, from OpenStreetMap through
 * openrouteservice. Mountain passes and ferry piers are not always found;
 * those come from Rumbo's own catalog.
 */
export async function geocodePlace(text: string): Promise<GeocodedPlace[] | null> {
  const key = getServerEnv().ORS_API_KEY;
  if (!key) return null;
  const q = new URLSearchParams({
    text,
    size: '5',
    layers: 'locality,localadmin,venue,neighbourhood',
  });
  try {
    const response = await fetch(`${GEOCODE}?${q.toString()}`, {
      headers: { Authorization: key },
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { features?: PeliasFeature[] };
    return (body.features ?? []).map((f) => {
      const country = ALPHA3[f.properties.country_a ?? ''] ?? '';
      return {
        name: f.properties.name ?? text,
        label: f.properties.label ?? f.properties.name ?? text,
        country,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        timeZone: SINGLE_ZONE[country] ?? null,
        kind:
          f.properties.layer === 'venue'
            ? 'poi'
            : f.properties.layer === 'locality'
              ? 'city'
              : 'town',
      };
    });
  } catch {
    return null;
  }
}
