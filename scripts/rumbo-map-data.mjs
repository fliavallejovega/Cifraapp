/* eslint-disable no-console -- A CLI script's output is its interface. */
/**
 * Builds the two static files Rumbo's 3D map draws from:
 *
 *   public/rumbo/countries.json   Natural Earth 1:50m country outlines for
 *                                 Europe, simplified with Douglas–Peucker.
 *   public/rumbo/relief.bin       Elevation at 0.1°, little-endian Int16 metres,
 *   public/rumbo/relief.json      decoded from the open Terrarium tiles (AWS
 *                                 Open Data, Mapzen). Its metadata.
 *
 * Both are public-domain or openly licensed data, fetched once and committed,
 * so the map never calls a third party at view time. Run it again only to
 * change the area or the resolution:
 *
 *   NODE_PATH=<path to sharp> node scripts/rumbo-map-data.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public', 'rumbo');
const BBOX = { west: -11, east: 32, south: 34, north: 61 };
const STEP = 0.1;
const ZOOM = 6;
const NE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const TERRARIUM = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

function simplify(points, epsilon) {
  if (points.length < 3) return points;
  const [x1, y1] = points[0];
  const [x2, y2] = points[points.length - 1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  let index = 0;
  let max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(x - x1 - t * dx, y - y1 - t * dy);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= epsilon) return [points[0], points[points.length - 1]];
  return [...simplify(points.slice(0, index + 1), epsilon).slice(0, -1), ...simplify(points.slice(index), epsilon)];
}

const inBox = ([x, y]) => x >= BBOX.west - 2 && x <= BBOX.east + 2 && y >= BBOX.south - 2 && y <= BBOX.north + 2;

async function countries() {
  const geo = await (await fetch(NE)).json();
  const out = [];
  for (const f of geo.features) {
    const iso = f.properties.ISO_A2_EH ?? f.properties.ISO_A2;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = [];
    for (const poly of polys) {
      const outer = poly[0];
      if (!outer.some(inBox)) continue;
      const s = simplify(outer, 0.03).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
      if (s.length >= 4) rings.push(s);
    }
    if (rings.length > 0) out.push({ iso, rings });
  }
  return out;
}

const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

async function relief() {
  const x0 = Math.floor(lon2x(BBOX.west, ZOOM));
  const x1 = Math.floor(lon2x(BBOX.east, ZOOM));
  const y0 = Math.floor(lat2y(BBOX.north, ZOOM));
  const y1 = Math.floor(lat2y(BBOX.south, ZOOM));
  const tiles = new Map();
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const png = Buffer.from(await (await fetch(TERRARIUM(ZOOM, x, y))).arrayBuffer());
      const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      tiles.set(`${x}/${y}`, { data, width: info.width });
    }
  }
  const cols = Math.round((BBOX.east - BBOX.west) / STEP) + 1;
  const rows = Math.round((BBOX.north - BBOX.south) / STEP) + 1;
  const grid = new Int16Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const lat = BBOX.north - r * STEP;
    for (let c = 0; c < cols; c++) {
      const lon = BBOX.west + c * STEP;
      const fx = lon2x(lon, ZOOM);
      const fy = lat2y(lat, ZOOM);
      const tile = tiles.get(`${Math.floor(fx)}/${Math.floor(fy)}`);
      if (!tile) continue;
      const px = Math.min(255, Math.floor((fx % 1) * 256));
      const py = Math.min(255, Math.floor((fy % 1) * 256));
      const i = (py * tile.width + px) * 3;
      const metres = tile.data[i] * 256 + tile.data[i + 1] + tile.data[i + 2] / 256 - 32768;
      grid[r * cols + c] = Math.max(-500, Math.round(metres));
    }
  }
  return { grid, cols, rows };
}

mkdirSync(OUT, { recursive: true });
const c = await countries();
writeFileSync(
  join(OUT, 'countries.json'),
  JSON.stringify({ source: 'Natural Earth 1:50m admin 0 (public domain)', bbox: BBOX, countries: c }),
);
const r = await relief();
writeFileSync(join(OUT, 'relief.bin'), Buffer.from(r.grid.buffer));
writeFileSync(
  join(OUT, 'relief.json'),
  JSON.stringify({
    source: 'Terrarium elevation tiles, AWS Open Data (Mapzen), zoom 6',
    bbox: BBOX,
    step: STEP,
    cols: r.cols,
    rows: r.rows,
    encoding: 'int16le metres, row 0 = north',
  }),
);
console.log(`countries: ${c.length}, relief: ${r.cols}×${r.rows}`);
