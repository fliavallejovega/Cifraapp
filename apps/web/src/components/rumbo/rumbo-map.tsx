'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ClientDay, ClientPlace } from '@/lib/rumbo-types';

/**
 * The route on Google Maps: the real map, with its towns, restaurants,
 * viewpoints and fuel stations around the road, so the person sees what is
 * near and can add it to the day.
 *
 * Every stretch of the trip is drawn faint; the selected day's is drawn in
 * brass and the map frames it. The ferry is dashed. Tapping a place on the
 * map — a museum, a café — offers to add it to that day.
 *
 * Without a Google Maps key the same lines draw on a flat map, and the screen
 * says what is missing.
 */

type Geometry = Readonly<Record<string, readonly (readonly [number, number, number])[]>>;

export interface PickedPlace {
  readonly googlePlaceId: string;
  readonly name: string;
  readonly country: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly address: string | null;
}

let loader: Promise<typeof google> | null = null;

/** Loads the Maps JavaScript API once per page, in the person's language. */
export function loadGoogleMaps(key: string, language: string): Promise<typeof google> {
  if (typeof window === 'undefined') return Promise.reject(new Error('server'));
  if (typeof google !== 'undefined' && typeof google.maps.importLibrary === 'function') {
    return Promise.resolve(google);
  }
  loader ??= new Promise((resolve, reject) => {
    const callback = '__rumboMapsReady';
    (window as unknown as Record<string, () => void>)[callback] = () => {
      resolve(google);
    };
    const script = document.createElement('script');
    const q = new URLSearchParams({ key, v: 'weekly', language, loading: 'async', callback });
    script.src = `https://maps.googleapis.com/maps/api/js?${q.toString()}`;
    script.async = true;
    script.onerror = () => {
      loader = null;
      reject(new Error('maps'));
    };
    document.head.appendChild(script);
  });
  return loader;
}

/**
 * A numbered name pinned to a point: plain HTML over the map, so it reads in
 * the product's own type and theme. Built when Google's library is loaded.
 */
function placeLabel(
  map: google.maps.Map,
  position: google.maps.LatLngLiteral,
  text: string,
): google.maps.OverlayView {
  class Label extends google.maps.OverlayView {
    private el: HTMLDivElement | null = null;
    override onAdd(): void {
      const el = document.createElement('div');
      el.textContent = text;
      el.className =
        'absolute whitespace-nowrap rounded-full border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-3 py-1 text-xs font-medium text-[color:var(--color-ink)] shadow-(--shadow-card)';
      el.style.transform = 'translate(-50%, calc(-100% - 8px))';
      this.el = el;
      this.getPanes()?.floatPane.appendChild(el);
    }
    override draw(): void {
      const point = this.getProjection().fromLatLngToDivPixel(new google.maps.LatLng(position));
      if (this.el && point) {
        this.el.style.left = `${String(point.x)}px`;
        this.el.style.top = `${String(point.y)}px`;
      }
    }
    override onRemove(): void {
      this.el?.remove();
      this.el = null;
    }
  }
  const label = new Label();
  label.setMap(map);
  return label;
}

/** A design token as a colour Google understands; the browser translates any CSS colour. */
function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const probe = document.createElement('canvas').getContext('2d');
  if (!value || !probe) return fallback;
  probe.fillStyle = fallback;
  probe.fillStyle = value;
  return probe.fillStyle;
}

export interface RumboMapProps {
  readonly places: Readonly<Record<string, ClientPlace>>;
  readonly geometry: Geometry;
  readonly days: readonly ClientDay[];
  readonly selected: number;
  readonly apiKey: string | null;
  readonly locale: string;
  /** A place tapped on the map, offered to the day. */
  readonly onPick?: (place: PickedPlace) => void;
}

export function RumboMap(props: RumboMapProps) {
  const t = useTranslations('rumbo.map');
  return (
    <div className="flex flex-col gap-2">
      {props.apiKey ? (
        <GoogleRouteMap {...props} apiKey={props.apiKey} />
      ) : (
        <FlatRouteMap {...props} />
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[color:var(--color-ink-secondary)]">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="h-1 w-6 rounded-full bg-[color:var(--color-brand)]" />
          {t('legendRoute')}
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="h-px w-6 bg-[color:var(--color-ink-secondary)]" />
          {t('legendOther')}
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="w-6 border-t-2 border-dashed border-[color:var(--color-positive)]"
          />
          {t('legendFerry')}
        </span>
        <span className="ml-auto">{props.apiKey ? t('hintGoogle') : t('noKey')}</span>
      </div>
    </div>
  );
}

function dayKeys(day: ClientDay | undefined): Set<string> {
  return new Set(day?.drives.flatMap((d) => d.legs.map((l) => l.geometryKey)) ?? []);
}

function GoogleRouteMap({
  places,
  geometry,
  days,
  selected,
  apiKey,
  locale,
  onPick,
}: RumboMapProps & { readonly apiKey: string }) {
  const t = useTranslations('rumbo.map');
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const mapRef = useRef<google.maps.Map | null>(null);
  const linesRef = useRef(new Map<string, google.maps.Polyline>());
  const markersRef = useRef<google.maps.OverlayView[]>([]);
  const pickRef = useRef(onPick);

  useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);

  // The map and every stretch, once.
  useEffect(() => {
    if (!host.current) return;
    let cancelled = false;
    const lines = linesRef.current;
    const element = host.current;
    loadGoogleMaps(apiKey, locale)
      .then(async (g) => {
        if (cancelled) return;
        const { Map: GoogleMap } = await g.maps.importLibrary('maps');
        const map = new GoogleMap(element, {
          center: { lat: 47.5, lng: 10 },
          zoom: 6,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: true,
          gestureHandling: 'cooperative',
        });
        mapRef.current = map;
        const dim = token('--color-ink-tertiary', '#6b6457');
        const ferry = token('--color-positive', '#2f6f5e');
        for (const [key, line] of Object.entries(geometry)) {
          const isFerry = key.startsWith('ferry|');
          const poly = new g.maps.Polyline({
            map,
            path: line.map(([lon, lat]) => ({ lat, lng: lon })),
            strokeColor: isFerry ? ferry : dim,
            strokeOpacity: isFerry ? 0 : 0.55,
            strokeWeight: 3,
            ...(isFerry
              ? {
                  icons: [
                    {
                      icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: ferry, scale: 3 },
                      offset: '0',
                      repeat: '14px',
                    },
                  ],
                }
              : {}),
          });
          lines.set(key, poly);
        }
        // A place on the base map: its details, then the offer to add it.
        map.addListener(
          'click',
          (event: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => {
            if (!('placeId' in event) || !event.placeId) return;
            event.stop();
            const id = event.placeId;
            void (async () => {
              const { Place } = await g.maps.importLibrary('places');
              const place = new Place({ id, requestedLanguage: locale });
              await place.fetchFields({
                fields: ['displayName', 'location', 'addressComponents', 'formattedAddress'],
              });
              if (!place.location) return;
              const country =
                place.addressComponents?.find((c) => c.types.includes('country'))?.shortText ??
                null;
              pickRef.current?.({
                googlePlaceId: id,
                name: place.displayName ?? '',
                country,
                lat: place.location.lat(),
                lon: place.location.lng(),
                address: place.formattedAddress ?? null,
              });
            })();
          },
        );
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
      for (const l of lines.values()) l.setMap(null);
      lines.clear();
    };
  }, [apiKey, locale, geometry]);

  // The selected day: brass, framed, its stops numbered.
  useEffect(() => {
    const map = mapRef.current;
    if (state !== 'ready' || !map) return;
    const day = days[selected];
    const keys = dayKeys(day);
    const brass = token('--color-brand', '#a8843c');
    const dim = token('--color-ink-tertiary', '#6b6457');
    for (const [key, poly] of linesRef.current) {
      if (key.startsWith('ferry|')) continue;
      const on = keys.has(key);
      poly.setOptions({
        strokeColor: on ? brass : dim,
        strokeOpacity: on ? 0.95 : 0.4,
        strokeWeight: on ? 6 : 3,
        zIndex: on ? 10 : 1,
      });
    }
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];
    const bounds = new google.maps.LatLngBounds();
    for (const key of keys)
      for (const [lon, lat] of geometry[key] ?? []) bounds.extend({ lat, lng: lon });
    const focus = day?.focus ?? [];
    focus.forEach((id, i) => {
      const p = places[id];
      if (!p) return;
      bounds.extend({ lat: p.lat, lng: p.lon });
      markersRef.current.push(
        placeLabel(map, { lat: p.lat, lng: p.lon }, `${String(i + 1)} · ${p.name}`),
      );
    });
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 48);
      if (focus.length === 1 && keys.size === 0) map.setZoom(12);
    }
  }, [state, selected, days, places, geometry]);

  return (
    <div className="relative">
      <div
        ref={host}
        role="region"
        aria-label={t('label')}
        className="h-[clamp(18rem,60vh,36rem)] w-full overflow-hidden rounded-(--radius-lg) bg-[color:var(--color-ground-sunk)]"
      />
      {state === 'loading' && (
        <p className="absolute inset-x-0 bottom-4 text-center text-sm text-[color:var(--color-ink-secondary)]">
          {t('loading')}
        </p>
      )}
      {state === 'error' && (
        <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-[color:var(--color-ink-secondary)]">
          {t('error')}
        </p>
      )}
    </div>
  );
}

/** Without a key: the same lines on a plain projection, labelled. */
function FlatRouteMap({ places, geometry, days, selected }: RumboMapProps) {
  const t = useTranslations('rumbo.map');
  // Framed on the selected day, so a short drive is not a dot on a country.
  const frame = useMemo(() => {
    const day = days[selected];
    const keys = dayKeys(day);
    const collect = (only: Set<string> | null) => {
      const pts: { lat: number; lon: number }[] = [];
      for (const [key, line] of Object.entries(geometry)) {
        if (only && !only.has(key)) continue;
        for (const [lon, lat] of line) pts.push({ lat, lon });
      }
      return pts;
    };
    let pts = keys.size > 0 ? collect(keys) : [];
    if (pts.length === 0) {
      pts = (day?.focus ?? []).map((id) => places[id]).filter((p) => p !== undefined);
    }
    if (pts.length < 2) pts = [...pts, ...collect(null)];
    if (pts.length === 0) return null;
    const lats = pts.map((p) => p.lat);
    const lons = pts.map((p) => p.lon);
    const padLat = Math.max((Math.max(...lats) - Math.min(...lats)) * 0.15, 0.08);
    const padLon = Math.max((Math.max(...lons) - Math.min(...lons)) * 0.15, 0.12);
    const south = Math.min(...lats) - padLat;
    const north = Math.max(...lats) + padLat;
    const west = Math.min(...lons) - padLon;
    const east = Math.max(...lons) + padLon;
    return { west, east, south, north, cos: Math.cos((((south + north) / 2) * Math.PI) / 180) };
  }, [geometry, days, selected, places]);
  if (!frame) return null;
  const width = 1000;
  const height = Math.round(
    ((frame.north - frame.south) / ((frame.east - frame.west) * frame.cos)) * width,
  );
  const x = (lon: number) => ((lon - frame.west) / (frame.east - frame.west)) * width;
  const y = (lat: number) => ((frame.north - lat) / (frame.north - frame.south)) * height;
  const day = days[selected];
  const keys = dayKeys(day);
  const path = (line: readonly (readonly [number, number, number])[]) =>
    line
      .map(([lon, lat], i) => `${i === 0 ? 'M' : 'L'}${x(lon).toFixed(1)},${y(lat).toFixed(1)}`)
      .join(' ');
  return (
    <div className="overflow-hidden rounded-(--radius-lg) bg-[color:var(--color-ground-sunk)]">
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        className="block h-auto max-h-[60vh] w-full"
        role="img"
        aria-label={t('label')}
      >
        {Object.entries(geometry).map(([key, line]) => (
          <path
            key={key}
            d={path(line)}
            fill="none"
            stroke={
              keys.has(key)
                ? 'var(--color-brand)'
                : key.startsWith('ferry|')
                  ? 'var(--color-positive)'
                  : 'var(--color-ink-tertiary)'
            }
            strokeOpacity={keys.has(key) ? 1 : 0.5}
            strokeWidth={keys.has(key) ? 6 : 2.5}
            strokeDasharray={key.startsWith('ferry|') ? '8 6' : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {(day?.focus ?? []).map((id) => {
          const p = places[id];
          if (!p) return null;
          return (
            <g key={id}>
              <circle cx={x(p.lon)} cy={y(p.lat)} r={7} fill="var(--color-ink)" />
              <text x={x(p.lon) + 12} y={y(p.lat) - 10} fontSize={24} fill="var(--color-ink)">
                {p.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
