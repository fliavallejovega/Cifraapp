import { addDays, daysBetween, type PlainDate } from '@app/domain';

import type { Corridor, CorridorStop } from './catalog/corridors.js';
import type { Anchor, Notice, Stay, Wish } from './types.js';

/**
 * Composing the ground part of a trip: which places, in what order, how many
 * nights each, around what cannot move.
 *
 * The fixed points (where the car is picked up and returned, friends who
 * expect you, an event on a given day) are hubs. Between two hubs the planner
 * uses a corridor from the catalog — the default one, or the one a wish asks
 * for. Each corridor stop gets a night; nights left over go to a hub that
 * can stretch; when nights are short, the lowest-priority stops go first.
 *
 * The plan is composed twice — once ignoring wishes — and the difference is
 * what the wishes cost, said out loud: «para añadir las Dolomitas se quitaron
 * Verona, el lago de Como, Maloja/Julier y una noche de Arosa».
 */

export interface GroundBounds {
  /** Where and when the car is picked up; the first drive leaves from here that day. */
  readonly start: { readonly placeId: string; readonly date: PlainDate };
  /** Where and when the car is returned; the last drive ends here that day. */
  readonly end: { readonly placeId: string; readonly date: PlainDate };
}

export interface ComposeInput {
  readonly ground: GroundBounds;
  /** `friends`, `event` and `stay` anchors that fall inside the ground part. */
  readonly anchors: readonly Anchor[];
  readonly wishes: readonly Wish[];
  readonly corridors: readonly Corridor[];
  /** Where you sleep for an event held somewhere else (market → nearest town). */
  readonly sleepNear?: Readonly<Record<string, string>>;
}

/** One drive the plan needs: the router turns it into legs. */
export interface DriveRequest {
  readonly date: PlainDate;
  /** Start, places passed, end — in order. */
  readonly points: readonly string[];
  readonly purpose: 'move' | 'day_trip';
}

export type Sacrifice =
  | { readonly kind: 'place_removed'; readonly placeId: string }
  | { readonly kind: 'nights_removed'; readonly placeId: string; readonly nights: number };

export interface WishOutcome {
  readonly wishId: string;
  /** The corridor the wish selected, or null when nothing in the catalog matched. */
  readonly corridorId: string | null;
}

export interface Composition {
  readonly stays: readonly Stay[];
  readonly drives: readonly DriveRequest[];
  readonly corridors: readonly string[];
  readonly wishes: readonly WishOutcome[];
  readonly sacrifices: readonly Sacrifice[];
  readonly notices: readonly Notice[];
  /** The drives of the plan without wishes, to price what the wishes cost in time. */
  readonly baselineDrives: readonly DriveRequest[];
}

interface Hub {
  readonly placeId: string;
  readonly firstNight: PlainDate | null;
  readonly nights: number;
  readonly maxNights: number;
  readonly hosted: boolean;
  readonly paid: boolean;
  readonly anchor: Anchor | null;
}

interface Planned {
  placeId: string;
  firstNight: PlainDate;
  nights: number;
  via: readonly string[];
  origin: Stay['origin'];
  hosted: boolean;
  paid: boolean;
}

function hubsOf(input: ComposeInput): Hub[] {
  const sorted = [...input.anchors]
    .filter((a) => a.kind === 'friends' || a.kind === 'event' || a.kind === 'stay')
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const hubs: Hub[] = [
    {
      placeId: input.ground.start.placeId,
      firstNight: null,
      nights: 0,
      maxNights: 0,
      hosted: false,
      paid: false,
      anchor: null,
    },
  ];
  for (const a of sorted) {
    const placeId = input.sleepNear?.[a.placeId] ?? a.placeId;
    const pinned = a.kind === 'event' ? 1 : daysBetween(a.from, a.to) + 1;
    const nights = Math.max(a.minNights ?? pinned, 1);
    const maxNights =
      a.kind === 'event'
        ? Number.POSITIVE_INFINITY
        : a.kind === 'stay'
          ? nights
          : Math.max(a.maxNights ?? nights, nights);
    hubs.push({
      placeId,
      firstNight: a.from,
      nights,
      maxNights,
      hosted: a.hosted ?? false,
      paid: a.paid ?? false,
      anchor: a,
    });
  }
  hubs.push({
    placeId: input.ground.end.placeId,
    firstNight: null,
    nights: 0,
    maxNights: 0,
    hosted: false,
    paid: false,
    anchor: null,
  });
  return hubs;
}

function chooseCorridor(
  from: string,
  to: string,
  corridors: readonly Corridor[],
  wishTags: ReadonlySet<string>,
): Corridor | null {
  const options = corridors.filter((c) => c.from === from && c.to === to);
  const wished = options.find((c) => !c.default && c.tags.some((t) => wishTags.has(t)));
  return wished ?? options.find((c) => c.default) ?? options[0] ?? null;
}

/** Drops the lowest-priority stops (latest first on a tie) until `room` remain. */
function fitStops(
  stops: readonly CorridorStop[],
  room: number,
): { kept: CorridorStop[]; dropped: CorridorStop[] } {
  const kept = [...stops];
  const dropped: CorridorStop[] = [];
  while (kept.length > Math.max(room, 0)) {
    let worst = 0;
    for (let i = 1; i < kept.length; i++) {
      if ((kept[i]?.priority ?? 0) <= (kept[worst]?.priority ?? 0)) worst = i;
    }
    const [gone] = kept.splice(worst, 1);
    if (gone) dropped.push(gone);
  }
  return { kept, dropped };
}

interface Solved {
  readonly planned: Planned[];
  readonly corridorIds: string[];
  readonly endVia: readonly string[];
  readonly dropped: string[];
  readonly notices: Notice[];
}

function solve(input: ComposeInput, wishTags: ReadonlySet<string>): Solved {
  const hubs = hubsOf(input);
  const planned: Planned[] = [];
  const corridorIds: string[] = [];
  const dropped: string[] = [];
  const notices: Notice[] = [];
  let cursor = input.ground.start.date;
  let endVia: readonly string[] = [];

  for (let i = 0; i + 1 < hubs.length; i++) {
    const from = hubs[i];
    const to = hubs[i + 1];
    if (!from || !to) continue;
    const corridor = chooseCorridor(from.placeId, to.placeId, input.corridors, wishTags);
    if (corridor) corridorIds.push(corridor.id);
    const stops = corridor?.stops ?? [];
    const isLast = i + 2 === hubs.length;
    const boundary = isLast ? input.ground.end.date : (to.firstNight ?? cursor);
    let room = daysBetween(cursor, boundary);

    if (room < 0) {
      notices.push({
        code: 'anchors_overlap',
        severity: 'critical',
        params: { from: from.placeId, to: to.placeId },
      });
      room = 0;
    }

    const { kept, dropped: gone } = fitStops(stops, room);
    for (const s of gone) dropped.push(s.placeId);

    let leftover = room - kept.length;
    // Stretch the next hub backwards first (friends who could host earlier,
    // a base before an event), then the previous hub forwards.
    let nextFirst = to.firstNight;
    let nextNights = to.nights;
    if (!isLast && leftover > 0 && nextFirst) {
      const stretch = Math.min(leftover, to.maxNights - to.nights);
      nextFirst = addDays(nextFirst, -stretch);
      nextNights += stretch;
      leftover -= stretch;
    }
    const prev = planned[planned.length - 1];
    if (leftover > 0 && prev && prev.origin !== 'catalog' && kept.length === 0) {
      prev.nights += leftover;
      leftover = 0;
    }

    let day = cursor;
    kept.forEach((s, index) => {
      const extra = index === kept.length - 1 ? leftover : 0;
      planned.push({
        placeId: s.placeId,
        firstNight: day,
        nights: 1 + extra,
        via: s.via,
        origin: wishTags.size > 0 && corridor && !corridor.default ? 'wish' : 'catalog',
        hosted: false,
        paid: false,
      });
      day = addDays(day, 1 + extra);
    });
    if (kept.length > 0) leftover = 0;
    if (leftover > 0) {
      notices.push({
        code: 'nights_unassigned',
        severity: 'warning',
        params: { nights: leftover, before: to.placeId },
      });
    }

    if (isLast) {
      endVia = corridor?.viaToEnd ?? [];
      cursor = boundary;
    } else if (nextFirst) {
      planned.push({
        placeId: to.placeId,
        firstNight: nextFirst,
        nights: nextNights,
        via: corridor?.viaToEnd ?? [],
        origin: to.anchor?.kind === 'stay' ? 'manual' : 'anchor',
        hosted: to.hosted,
        paid: to.paid,
      });
      cursor = addDays(nextFirst, nextNights);
    }
  }

  return { planned, corridorIds, endVia, dropped, notices };
}

function placesOf(s: Solved): Set<string> {
  const out = new Set<string>();
  for (const p of s.planned) {
    out.add(p.placeId);
    for (const v of p.via) out.add(v);
  }
  for (const v of s.endVia) out.add(v);
  return out;
}

function nightsByPlace(s: Solved): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of s.planned) m.set(p.placeId, (m.get(p.placeId) ?? 0) + p.nights);
  return m;
}

/** The ground part of the trip, and what the wishes cost against the default plan. */
export function composeGround(input: ComposeInput): Composition {
  const wishTags = new Set(input.wishes.flatMap((w) => w.tags.map((t) => t.toLowerCase())));
  const chosen = solve(input, wishTags);
  const baseline = solve(input, new Set());

  const sacrifices: Sacrifice[] = [];
  const chosenPlaces = placesOf(chosen);
  for (const id of placesOf(baseline)) {
    if (!chosenPlaces.has(id)) sacrifices.push({ kind: 'place_removed', placeId: id });
  }
  const chosenNights = nightsByPlace(chosen);
  for (const [id, n] of nightsByPlace(baseline)) {
    const now = chosenNights.get(id);
    if (now !== undefined && now < n)
      sacrifices.push({ kind: 'nights_removed', placeId: id, nights: n - now });
  }
  for (const id of chosen.dropped) {
    if (!sacrifices.some((s) => s.placeId === id))
      sacrifices.push({ kind: 'place_removed', placeId: id });
  }

  const wishes: WishOutcome[] = input.wishes.map((w) => {
    const tags = new Set(w.tags.map((t) => t.toLowerCase()));
    const hit = input.corridors.find(
      (c) => chosen.corridorIds.includes(c.id) && !c.default && c.tags.some((t) => tags.has(t)),
    );
    return { wishId: w.id, corridorId: hit?.id ?? null };
  });
  const notices = [...chosen.notices];
  for (const w of wishes) {
    if (!w.corridorId)
      notices.push({ code: 'wish_unmatched', severity: 'info', params: { wish: w.wishId } });
  }

  const drives = drivesOf(input, chosen);

  const stays: Stay[] = chosen.planned.map((p) => ({
    placeId: p.placeId,
    firstNight: p.firstNight,
    nights: p.nights,
    origin: p.origin,
    hosted: p.hosted,
    paid: p.paid,
  }));

  return {
    stays,
    drives,
    corridors: chosen.corridorIds,
    wishes,
    sacrifices,
    notices,
    baselineDrives: wishTags.size > 0 ? drivesOf(input, baseline) : drives,
  };
}

/** Drives: one each day the bed changes, plus round trips to events held elsewhere. */
function drivesOf(input: ComposeInput, solved: Solved): DriveRequest[] {
  const drives: DriveRequest[] = [];
  let previous = input.ground.start.placeId;
  for (const p of solved.planned) {
    if (p.placeId !== previous) {
      drives.push({ date: p.firstNight, points: [previous, ...p.via, p.placeId], purpose: 'move' });
    }
    previous = p.placeId;
  }
  drives.push({
    date: input.ground.end.date,
    points: [previous, ...solved.endVia, input.ground.end.placeId],
    purpose: 'move',
  });
  for (const a of input.anchors) {
    const base = input.sleepNear?.[a.placeId];
    if (a.kind === 'event' && base && base !== a.placeId) {
      drives.push({ date: a.from, points: [base, a.placeId, base], purpose: 'day_trip' });
    }
  }
  return drives.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
