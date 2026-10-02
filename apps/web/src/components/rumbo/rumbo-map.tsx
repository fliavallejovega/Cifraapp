'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { ClientDay, ClientPlace } from '@/lib/rumbo-types';

/**
 * The route in relief.
 *
 * Country outlines from Natural Earth and elevation from open terrain tiles,
 * both shipped as static files and clipped here to the trip's area. Height is
 * exaggerated fifteen times so the Alps read as Alps on a phone. The selected
 * day's route is drawn thick in brass; the rest of the trip stays faint; the
 * ferry is dashed. Labels are HTML laid over the canvas, so they stay sharp
 * and readable in both themes.
 *
 * Without WebGL the same data draws as a flat SVG map.
 */

type Geometry = Readonly<Record<string, readonly (readonly [number, number, number])[]>>;

interface Relief {
  readonly bbox: { west: number; east: number; south: number; north: number };
  readonly step: number;
  readonly cols: number;
  readonly rows: number;
  readonly data: Int16Array;
}

interface Countries {
  readonly countries: readonly { iso: string; rings: readonly (readonly [number, number])[][] }[];
}

const EXAGGERATION = 15;
const METRES_PER_UNIT = 111_000;
let cache: Promise<{ relief: Relief; countries: Countries }> | null = null;

function loadData(): Promise<{ relief: Relief; countries: Countries }> {
  cache ??= Promise.all([
    fetch('/rumbo/relief.json').then((r) => r.json() as Promise<Omit<Relief, 'data'>>),
    fetch('/rumbo/relief.bin').then((r) => r.arrayBuffer()),
    fetch('/rumbo/countries.json').then((r) => r.json() as Promise<Countries>),
  ]).then(([meta, bin, countries]) => ({
    relief: { ...meta, data: new Int16Array(bin) },
    countries,
  }));
  cache.catch(() => {
    cache = null;
  });
  return cache;
}

function elevationAt(relief: Relief, lon: number, lat: number): number {
  const c = (lon - relief.bbox.west) / relief.step;
  const r = (relief.bbox.north - lat) / relief.step;
  const c0 = Math.max(0, Math.min(relief.cols - 2, Math.floor(c)));
  const r0 = Math.max(0, Math.min(relief.rows - 2, Math.floor(r)));
  const fx = Math.min(Math.max(c - c0, 0), 1);
  const fy = Math.min(Math.max(r - r0, 0), 1);
  const at = (cc: number, rr: number) => Math.max(relief.data[rr * relief.cols + cc] ?? 0, 0);
  const top = at(c0, r0) * (1 - fx) + at(c0 + 1, r0) * fx;
  const bottom = at(c0, r0 + 1) * (1 - fx) + at(c0 + 1, r0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * A design token as a three.js colour. Tokens may be written in any CSS colour
 * syntax (oklch included), which three cannot parse; the browser can, so the
 * colour is painted on a 1×1 canvas and read back as sRGB.
 */
function token(name: string, fallback: string): THREE.Color {
  const value =
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.Color(fallback);
    ctx.fillStyle = fallback;
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
    return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  } catch {
    return new THREE.Color(fallback);
  }
}

export interface RumboMapProps {
  readonly places: Readonly<Record<string, ClientPlace>>;
  readonly geometry: Geometry;
  readonly days: readonly ClientDay[];
  readonly selected: number;
}

interface Frame {
  readonly lon0: number;
  readonly lat0: number;
  readonly cos: number;
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
}

function frameOf(
  geometry: Geometry,
  places: Readonly<Record<string, ClientPlace>>,
  days: readonly ClientDay[],
): Frame | null {
  const pts: { lon: number; lat: number }[] = [];
  for (const line of Object.values(geometry)) for (const [lon, lat] of line) pts.push({ lon, lat });
  if (pts.length === 0) {
    for (const d of days)
      for (const id of d.focus) {
        const p = places[id];
        if (p && d.drives.length > 0) pts.push(p);
      }
  }
  if (pts.length === 0) return null;
  const west = Math.min(...pts.map((p) => p.lon)) - 0.8;
  const east = Math.max(...pts.map((p) => p.lon)) + 0.8;
  const south = Math.min(...pts.map((p) => p.lat)) - 0.6;
  const north = Math.max(...pts.map((p) => p.lat)) + 0.6;
  const lat0 = (south + north) / 2;
  return {
    lon0: (west + east) / 2,
    lat0,
    cos: Math.cos((lat0 * Math.PI) / 180),
    west,
    east,
    south,
    north,
  };
}

export function RumboMap({ places, geometry, days, selected }: RumboMapProps) {
  const t = useTranslations('rumbo.map');
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'flat' | 'error'>('loading');
  const frame = useMemo(() => frameOf(geometry, places, days), [geometry, places, days]);
  const selectedRef = useRef(selected);
  const apiRef = useRef<{ select: (i: number) => void } | null>(null);

  useEffect(() => {
    selectedRef.current = selected;
    apiRef.current?.select(selected);
  }, [selected]);

  useEffect(() => {
    if (!frame || !host.current) return;
    if (!webglAvailable()) {
      setState('flat');
      return;
    }
    let disposed = false;
    let raf = 0;
    const container = host.current;
    const labelLayer = labels.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const project = (lon: number, lat: number, elevation: number) =>
      new THREE.Vector3(
        (lon - frame.lon0) * frame.cos,
        (elevation / METRES_PER_UNIT) * EXAGGERATION,
        -(lat - frame.lat0),
      );

    loadData()
      .then(({ relief, countries }) => {
        if (disposed) return;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(renderer.domElement);
        renderer.domElement.setAttribute('aria-hidden', 'true');
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = !reduced;
        controls.maxPolarAngle = Math.PI * 0.45;
        controls.minDistance = 1.5;
        controls.maxDistance = 40;

        const colors = {
          land: token('--color-ground-sunk', '#ece6da'),
          high: token('--color-ink-tertiary', '#6b6457'),
          outline: token('--color-ink-tertiary', '#6b6457'),
          route: token('--color-brand', '#a8843c'),
          dim: token('--color-ink-secondary', '#4b4a52'),
          ferry: token('--color-positive', '#2f6f5e'),
        };

        // Terrain over the trip's area.
        const spanX = (frame.east - frame.west) * frame.cos;
        const spanZ = frame.north - frame.south;
        const segX = Math.min(220, Math.round((frame.east - frame.west) / relief.step));
        const segZ = Math.min(180, Math.round((frame.north - frame.south) / relief.step));
        const plane = new THREE.PlaneGeometry(spanX, spanZ, segX, segZ);
        plane.rotateX(-Math.PI / 2);
        const pos = plane.attributes['position'] as THREE.BufferAttribute;
        const vertexColors: number[] = [];
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const z = pos.getZ(i);
          const lon = x / frame.cos + frame.lon0;
          const lat = -z + frame.lat0;
          const e = elevationAt(relief, lon, lat);
          pos.setY(i, (e / METRES_PER_UNIT) * EXAGGERATION);
          // Hypsometric tint: paper in the plains, ink on the summits.
          const c = colors.land.clone().lerp(colors.high, Math.min(e / 3200, 1) * 0.7);
          vertexColors.push(c.r, c.g, c.b);
        }
        plane.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
        plane.computeVertexNormals();
        const terrain = new THREE.Mesh(
          plane,
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 1,
            metalness: 0,
            flatShading: false,
          }),
        );
        terrain.position.set((frame.west + frame.east) / 2 - frame.lon0, 0, 0);
        terrain.position.x *= frame.cos;
        scene.add(terrain);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.4);
        sun.position.set(-4, 6, 3);
        scene.add(sun);

        // Country outlines, clipped by keeping only vertices inside the area.
        const outline = new THREE.LineBasicMaterial({
          color: colors.outline,
          transparent: true,
          opacity: 0.55,
        });
        for (const country of countries.countries) {
          for (const ring of country.rings) {
            let run: THREE.Vector3[] = [];
            const flush = () => {
              if (run.length > 1)
                scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(run), outline));
              run = [];
            };
            for (const [lon, lat] of ring) {
              if (lon < frame.west || lon > frame.east || lat < frame.south || lat > frame.north) {
                flush();
                continue;
              }
              const v = project(lon, lat, elevationAt(relief, lon, lat));
              v.y += 0.004;
              run.push(v);
            }
            flush();
          }
        }

        // Routes: every stored piece, faint; the selected day's, thick.
        const pieceLine = (key: string) => {
          const line = geometry[key];
          if (!line) return null;
          return line.map(([lon, lat, e]) => {
            const v = project(lon, lat, Math.max(e, elevationAt(relief, lon, lat)));
            v.y += 0.012;
            return v;
          });
        };
        const faint = new THREE.LineBasicMaterial({
          color: colors.dim,
          transparent: true,
          opacity: 0.45,
        });
        const ferryMaterial = new THREE.LineDashedMaterial({
          color: colors.ferry,
          dashSize: 0.08,
          gapSize: 0.05,
        });
        for (const key of Object.keys(geometry)) {
          const pts = pieceLine(key);
          if (!pts) continue;
          const obj = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            key.startsWith('ferry|') ? ferryMaterial : faint,
          );
          if (key.startsWith('ferry|')) obj.computeLineDistances();
          scene.add(obj);
        }
        const highlight = new THREE.Group();
        scene.add(highlight);
        const brass = new THREE.MeshStandardMaterial({
          color: colors.route,
          roughness: 0.4,
          metalness: 0.3,
        });

        // Labels: overnight places always, the day's stops when selected.
        const stayIds = [...new Set(days.flatMap((d) => (d.sleep ? d.focus.slice(-1) : [])))];
        const labelEls = new Map<string, HTMLSpanElement>();
        const labelPos = new Map<string, THREE.Vector3>();
        const ensureLabel = (id: string) => {
          const p = places[id];
          if (!p || !labelLayer) return;
          if (
            p.lon < frame.west ||
            p.lon > frame.east ||
            p.lat < frame.south ||
            p.lat > frame.north
          )
            return;
          if (!labelEls.has(id)) {
            const el = document.createElement('span');
            el.textContent = p.name;
            el.className =
              'pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-(--radius-xs) border border-[color:var(--color-surface-border)] bg-[color:var(--color-surface)] px-2 py-1 text-xs text-[color:var(--color-ink)] shadow-(--shadow-card)';
            labelLayer.appendChild(el);
            labelEls.set(id, el);
            const v = project(p.lon, p.lat, elevationAt(relief, p.lon, p.lat));
            v.y += 0.03;
            labelPos.set(id, v);
          }
        };
        for (const id of stayIds) ensureLabel(id);

        let target = new THREE.Vector3();
        let wantCamera = new THREE.Vector3();
        const select = (i: number) => {
          const day = days[i];
          highlight.clear();
          for (const [id, el] of labelEls) {
            el.style.opacity = day?.focus.includes(id) ? '1' : stayIds.includes(id) ? '0.55' : '0';
          }
          if (!day) return;
          const pts: THREE.Vector3[] = [];
          for (const dr of day.drives) {
            for (const leg of dr.legs) {
              const line = pieceLine(leg.geometryKey);
              if (!line) continue;
              pts.push(...line);
              if (leg.mode === 'ferry') continue;
              const curve = new THREE.CatmullRomCurve3(line);
              highlight.add(
                new THREE.Mesh(
                  new THREE.TubeGeometry(curve, Math.max(line.length * 2, 8), 0.018, 6, false),
                  brass,
                ),
              );
            }
          }
          for (const id of day.focus) ensureLabel(id);
          for (const id of day.focus) {
            const el = labelEls.get(id);
            if (el) el.style.opacity = '1';
          }
          if (pts.length === 0) {
            for (const id of day.focus) {
              const v = labelPos.get(id);
              if (v) pts.push(v);
            }
          }
          if (pts.length > 0) {
            const box = new THREE.Box3().setFromPoints(pts);
            target = box.getCenter(new THREE.Vector3());
            const size = Math.max(box.getSize(new THREE.Vector3()).length(), 1.2);
            wantCamera = target.clone().add(new THREE.Vector3(0, size * 0.9, size * 1.1));
          } else {
            target = new THREE.Vector3();
            wantCamera = new THREE.Vector3(0, spanZ * 0.9, spanZ * 1.05);
          }
          if (reduced) {
            controls.target.copy(target);
            camera.position.copy(wantCamera);
          }
        };

        camera.position.set(0, spanZ * 0.9, spanZ * 1.05);
        select(selectedRef.current);
        apiRef.current = { select };

        const resize = () => {
          const w = container.clientWidth;
          const h = container.clientHeight;
          renderer.setSize(w, h, false);
          renderer.domElement.style.width = '100%';
          renderer.domElement.style.height = '100%';
          camera.aspect = w / Math.max(h, 1);
          camera.updateProjectionMatrix();
        };
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(container);

        let moving = 0;
        const vec = new THREE.Vector3();
        const loop = () => {
          raf = requestAnimationFrame(loop);
          if (!reduced && moving < 90) {
            controls.target.lerp(target, 0.08);
            camera.position.lerp(wantCamera, 0.08);
            moving += 1;
          }
          controls.update();
          renderer.render(scene, camera);
          const w = container.clientWidth;
          const h = container.clientHeight;
          for (const [id, el] of labelEls) {
            const p = labelPos.get(id);
            if (!p) continue;
            vec.copy(p).project(camera);
            const visible = vec.z < 1 && Math.abs(vec.x) < 1.05 && Math.abs(vec.y) < 1.05;
            el.style.display = visible ? 'block' : 'none';
            el.style.transform = `translate(${String(Math.round(((vec.x + 1) / 2) * w))}px, ${String(Math.round(((1 - vec.y) / 2) * h))}px) translate(-50%, -130%)`;
          }
        };
        const origSelect = select;
        apiRef.current = {
          select: (i: number) => {
            moving = 0;
            origSelect(i);
          },
        };
        loop();
        setState('ready');

        const cleanup = () => {
          cancelAnimationFrame(raf);
          observer.disconnect();
          controls.dispose();
          renderer.dispose();
          scene.traverse((o) => {
            if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
              (o.geometry as THREE.BufferGeometry).dispose();
            }
          });
          renderer.domElement.remove();
          for (const el of labelEls.values()) el.remove();
        };
        disposers.push(cleanup);
      })
      .catch(() => {
        if (!disposed) setState('error');
      });

    const disposers: (() => void)[] = [];
    return () => {
      disposed = true;
      apiRef.current = null;
      for (const d of disposers) d();
    };
  }, [frame, geometry, places, days]);

  if (!frame) return null;

  return (
    <div className="relative">
      <div
        ref={host}
        role="img"
        aria-label={t('label')}
        className="relative h-[clamp(16rem,55vh,32rem)] w-full touch-none overflow-hidden rounded-(--radius-lg) bg-[color:var(--color-ground-sunk)]"
      >
        <div ref={labels} className="pointer-events-none absolute inset-0 overflow-hidden" />
        {state === 'loading' && (
          <p className="absolute inset-x-0 bottom-4 text-center text-sm text-[color:var(--color-ink-secondary)]">
            {t('loading')}
          </p>
        )}
        {state === 'flat' && (
          <FlatMap
            frame={frame}
            places={places}
            geometry={geometry}
            days={days}
            selected={selected}
          />
        )}
        {state === 'error' && (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-[color:var(--color-ink-secondary)]">
            {t('error')}
          </p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[color:var(--color-ink-secondary)]">
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
        <span className="ml-auto">{state === 'flat' ? t('flat') : t('hint')}</span>
      </div>
    </div>
  );
}

/** The flat fallback: same frame, same lines, no WebGL. */
function FlatMap({
  frame,
  places,
  geometry,
  days,
  selected,
}: {
  readonly frame: Frame;
  readonly places: Readonly<Record<string, ClientPlace>>;
  readonly geometry: Geometry;
  readonly days: readonly ClientDay[];
  readonly selected: number;
}) {
  const width = 1000;
  const height = Math.round(
    ((frame.north - frame.south) / ((frame.east - frame.west) * frame.cos)) * width,
  );
  const x = (lon: number) => ((lon - frame.west) / (frame.east - frame.west)) * width;
  const y = (lat: number) => ((frame.north - lat) / (frame.north - frame.south)) * height;
  const day = days[selected];
  const dayKeys = new Set(day?.drives.flatMap((d) => d.legs.map((l) => l.geometryKey)) ?? []);
  const path = (line: readonly (readonly [number, number, number])[]) =>
    line
      .map(([lon, lat], i) => `${i === 0 ? 'M' : 'L'}${x(lon).toFixed(1)},${y(lat).toFixed(1)}`)
      .join(' ');
  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className="absolute inset-0 h-full w-full"
      aria-hidden
    >
      {Object.entries(geometry).map(([key, line]) => (
        <path
          key={key}
          d={path(line)}
          fill="none"
          stroke={
            dayKeys.has(key)
              ? 'var(--color-brand)'
              : key.startsWith('ferry|')
                ? 'var(--color-positive)'
                : 'var(--color-ink-tertiary)'
          }
          strokeWidth={dayKeys.has(key) ? 5 : 2}
          strokeDasharray={key.startsWith('ferry|') ? '8 6' : undefined}
          strokeLinecap="round"
        />
      ))}
      {(day?.focus ?? []).map((id) => {
        const p = places[id];
        if (!p) return null;
        return (
          <g key={id}>
            <circle cx={x(p.lon)} cy={y(p.lat)} r={6} fill="var(--color-ink)" />
            <text x={x(p.lon) + 10} y={y(p.lat) - 10} fontSize={22} fill="var(--color-ink)">
              {p.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
