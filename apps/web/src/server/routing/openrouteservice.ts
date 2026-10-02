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
function stretchProfile(coords: readonly number[][], from: number, to: number): { ascentM: number; maxElevationM: number } {
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

export async function routeDrive(points: readonly LonLat[], signal?: AbortSignal): Promise<RouteAnswer> {
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

  if (response.status === 404 || response.status === 400) return { ok: false, failure: 'not_routable' };
  if (response.status === 429 || response.status === 403) return { ok: false, failure: 'quota' };
  if (!response.ok) return { ok: false, failure: 'unavailable' };

  const body = (await response.json()) as { features?: OrsFeature[] };
  const feature = body.features?.[0];
  const segments = feature?.properties.segments ?? [];
  const coords = feature?.geometry.coordinates ?? [];
  const wayPoints = feature?.properties.way_points ?? [];
  if (!feature || segments.length !== points.length - 1) return { ok: false, failure: 'not_routable' };

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
