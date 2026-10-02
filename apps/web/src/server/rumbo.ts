import 'server-only';

import { createHash } from 'node:crypto';

import { getAdminDb } from '@app/database';
import {
  borderSystems,
  entryRules,
  fxRates,
  transactions,
  tripAnchors,
  tripBookings,
  tripDrives,
  tripFlightSegments,
  tripLegs,
  tripLodgingOptions,
  tripPlaces,
  trips,
  tripTodos,
  tripTravelers,
  tripWishes,
} from '@app/database/schema';
import { Money, toPlainDate, type CurrencyCode, type PlainDate } from '@app/domain';
import {
  AIRPORTS,
  buildItinerary,
  composeGround,
  CORRIDORS,
  drivesMinutes,
  evaluateEntry,
  flightStays,
  generateTodos,
  lodgingNotices,
  lodgingTotals,
  PLACES,
  presenceOf,
  routeRequestsFor,
  SLEEP_NEAR,
  summarizeStop,
  type Anchor,
  type BorderSystem,
  type Composition,
  type DriveRequest,
  type EntryRule,
  type EntryVerdict,
  type FlightSegment,
  type GroundMode,
  type Itinerary,
  type LodgingOption,
  type LodgingTotals,
  type Notice,
  type Place,
  type RouteLeg,
  type Sacrifice,
  type Stay,
  type StopSummary,
  type TodoDraft,
  type Traveler,
  type Wish,
  type WishOutcome,
} from '@app/itinerary';
import { convertToBase } from '@app/trip-engine';
import { getServerEnv } from '@app/validation/env';
import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';

import { registerJobHandler } from './jobs';
import { ORS_SOURCE, routeDrive, routingConfigured } from './routing/openrouteservice';
import { queryAsUser, type Session } from './session';
import type { Tx } from './trip-ledger';

/**
 * Rumbo on the server: reading a trip's fixed points, flights and wishes,
 * composing the ground part into stays and drives, asking the router in the
 * background, and assembling the view the screens read.
 *
 * The engine (`@app/itinerary`) decides; this module only stores its inputs
 * and its routed answers. Nothing about a day is stored: every read builds
 * the itinerary again from what is here.
 */

export const RUMBO_ROUTE_JOB = 'rumbo_route';

// ---------------------------------------------------------------------------
// Reference by country
// ---------------------------------------------------------------------------

const CURRENCY_BY_COUNTRY: Readonly<Record<string, string>> = {
  IT: 'EUR',
  AT: 'EUR',
  DE: 'EUR',
  FR: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  CH: 'CHF',
  DK: 'DKK',
  SE: 'SEK',
  NO: 'NOK',
  CZ: 'CZK',
  HU: 'HUF',
  PL: 'PLN',
  TR: 'TRY',
  GB: 'GBP',
  PA: 'USD',
  US: 'USD',
  CO: 'COP',
};

const COST_LEVEL_BY_COUNTRY: Readonly<Record<string, 'low' | 'medium' | 'high' | 'very_high'>> = {
  CH: 'very_high',
  DK: 'high',
  NO: 'very_high',
  IT: 'medium',
  AT: 'medium',
  DE: 'medium',
  TR: 'low',
};

const COUNTRY_NAME_EN: Readonly<Record<string, string>> = {
  IT: 'Italy',
  AT: 'Austria',
  CH: 'Switzerland',
  DE: 'Germany',
  DK: 'Denmark',
  TR: 'Turkey',
  PA: 'Panama',
};

export function countryNameForSearch(code: string): string {
  return COUNTRY_NAME_EN[code] ?? code;
}

// ---------------------------------------------------------------------------
// Rows to engine
// ---------------------------------------------------------------------------

type PlaceRow = typeof tripPlaces.$inferSelect;
type LegRow = typeof tripLegs.$inferSelect;
type FlightRow = typeof tripFlightSegments.$inferSelect;
type AnchorRow = typeof tripAnchors.$inferSelect;
type DriveRow = typeof tripDrives.$inferSelect;

export interface RumboPlace extends Place {
  /** The `trip_places` row, when the trip has one. */
  readonly rowId: string | null;
}

function engineId(row: PlaceRow): string {
  return row.catalogId ?? row.id;
}

function placeFromRow(row: PlaceRow): RumboPlace {
  return {
    id: engineId(row),
    rowId: row.id,
    name: row.name,
    country: row.countryCode,
    lat: Number(row.lat),
    lon: Number(row.lon),
    timeZone: row.timeZone,
    kind: row.kind,
    ...(row.altitudeM !== null ? { altitudeM: row.altitudeM } : {}),
  };
}

function placeResolver(rows: readonly PlaceRow[]): (id: string) => RumboPlace {
  const byId = new Map<string, RumboPlace>();
  for (const r of rows) {
    const p = placeFromRow(r);
    byId.set(p.id, p);
    byId.set(r.id, p);
  }
  return (id) => {
    const known = byId.get(id);
    if (known) return known;
    const catalog = PLACES.get(id);
    if (catalog) return { ...catalog, rowId: null };
    // A place deleted under a stale plan: keep the screen alive, say nothing false.
    return {
      id,
      rowId: null,
      name: id,
      country: 'ZZ',
      lat: 0,
      lon: 0,
      timeZone: 'UTC',
      kind: 'town',
    };
  };
}

function flightFromRow(row: FlightRow): FlightSegment {
  const split = (local: string) => ({
    date: toPlainDate(local.slice(0, 10)),
    time: local.slice(11, 16),
  });
  return {
    id: row.id,
    from: row.fromIata,
    to: row.toIata,
    departs: { ...split(row.departsLocal), timeZone: row.departsTz },
    departsCertainty: row.departsCertainty,
    arrives: { ...split(row.arrivesLocal), timeZone: row.arrivesTz },
    arrivesCertainty: row.arrivesCertainty,
    ...(row.carrier ? { carrier: row.carrier } : {}),
    ...(row.flightNumber ? { number: row.flightNumber } : {}),
    ...(row.recordLocator ? { recordLocator: row.recordLocator } : {}),
    ...(row.baggage ? { baggage: row.baggage } : {}),
  };
}

function anchorFromRow(row: AnchorRow, places: Map<string, PlaceRow>): Anchor | null {
  const place = places.get(row.placeId);
  if (!place) return null;
  return {
    id: row.id,
    kind: row.kind,
    placeId: engineId(place),
    from: toPlainDate(row.fromDate),
    to: toPlainDate(row.toDate),
    ...(row.minNights !== null ? { minNights: row.minNights } : {}),
    ...(row.maxNights !== null ? { maxNights: row.maxNights } : {}),
    hosted: row.hosted,
    paid: row.paid,
    certainty: row.certainty,
    ...(row.label ? { label: row.label } : {}),
  };
}

function stayFromLeg(row: LegRow, places: Map<string, PlaceRow>): Stay {
  const place = row.placeId ? places.get(row.placeId) : undefined;
  const nights = Math.max(
    Math.round((Date.parse(row.departureDate) - Date.parse(row.arrivalDate)) / 86_400_000),
    0,
  );
  return {
    placeId: place ? engineId(place) : row.id,
    firstNight: toPlainDate(row.arrivalDate),
    nights,
    origin: row.stayOrigin ?? 'manual',
    hosted: row.hosted,
    paid: row.lodgingMode === 'prepaid',
  };
}

/** The resolver the engine routes through: stored drives, matched by their points. */
function routesFrom(rows: readonly DriveRow[]) {
  const byKey = new Map<string, DriveRow>();
  for (const r of rows) byKey.set(`${r.mode}|${r.points.join('>')}`, r);
  return (points: readonly string[], mode: GroundMode): readonly RouteLeg[] | null => {
    const row = byKey.get(`${mode}|${points.join('>')}`);
    if (row?.status !== 'routed') return null;
    const checkedOn = toPlainDate((row.fetchedAt ?? row.updatedAt).toISOString().slice(0, 10));
    return row.legs.map((l) => ({
      from: l.from,
      to: l.to,
      mode,
      distanceM: l.distanceM,
      durationS: l.durationS,
      ...(l.ascentM !== undefined ? { ascentM: l.ascentM } : {}),
      ...(l.maxElevationM !== undefined ? { maxElevationM: l.maxElevationM } : {}),
      source: {
        name: row.sourceName ?? ORS_SOURCE.name,
        url: row.sourceUrl ?? ORS_SOURCE.url,
        checkedOn,
      },
      certainty: 'estimated' as const,
    }));
  };
}

function requestHash(
  mode: string,
  points: readonly string[],
  place: (id: string) => Place,
): string {
  const coords = points.map((id) => {
    const p = place(id);
    return `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`;
  });
  return createHash('sha256')
    .update(`${mode}|${coords.join(';')}`)
    .digest('hex');
}

// ---------------------------------------------------------------------------
// The stored plan
// ---------------------------------------------------------------------------

export interface RumboPlanSnapshot {
  readonly engineVersion: string;
  readonly drives: readonly DriveRequest[];
  readonly baselineDrives: readonly DriveRequest[];
  readonly corridors: readonly string[];
  readonly sacrifices: readonly Sacrifice[];
  readonly wishes: readonly WishOutcome[];
  readonly notices: readonly Notice[];
}

function isSnapshot(value: unknown): value is RumboPlanSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { drives?: unknown }).drives)
  );
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface RumboRows {
  readonly trip: typeof trips.$inferSelect;
  readonly travelers: (typeof tripTravelers.$inferSelect)[];
  readonly places: PlaceRow[];
  readonly anchors: AnchorRow[];
  readonly wishes: (typeof tripWishes.$inferSelect)[];
  readonly flights: FlightRow[];
  readonly legs: LegRow[];
  readonly drives: DriveRow[];
  readonly options: (typeof tripLodgingOptions.$inferSelect)[];
  readonly todos: (typeof tripTodos.$inferSelect)[];
  readonly rules: (typeof entryRules.$inferSelect)[];
  readonly systems: (typeof borderSystems.$inferSelect)[];
}

export async function readRumboRows(
  tx: Tx,
  householdId: string,
  tripId: string,
): Promise<RumboRows | null> {
  const [trip] = await tx
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.householdId, householdId)));
  if (!trip) return null;
  const [
    travelers,
    places,
    anchors,
    wishes,
    flights,
    legs,
    drives,
    options,
    todos,
    rules,
    systems,
  ] = await Promise.all([
    tx
      .select()
      .from(tripTravelers)
      .where(eq(tripTravelers.tripId, tripId))
      .orderBy(asc(tripTravelers.createdAt)),
    tx.select().from(tripPlaces).where(eq(tripPlaces.tripId, tripId)),
    tx
      .select()
      .from(tripAnchors)
      .where(eq(tripAnchors.tripId, tripId))
      .orderBy(asc(tripAnchors.fromDate)),
    tx
      .select()
      .from(tripWishes)
      .where(eq(tripWishes.tripId, tripId))
      .orderBy(asc(tripWishes.position)),
    tx
      .select()
      .from(tripFlightSegments)
      .where(eq(tripFlightSegments.tripId, tripId))
      .orderBy(asc(tripFlightSegments.departsLocal)),
    tx
      .select()
      .from(tripLegs)
      .where(eq(tripLegs.tripId, tripId))
      .orderBy(asc(tripLegs.arrivalDate)),
    tx
      .select()
      .from(tripDrives)
      .where(eq(tripDrives.tripId, tripId))
      .orderBy(asc(tripDrives.driveDate)),
    tx
      .select()
      .from(tripLodgingOptions)
      .where(eq(tripLodgingOptions.tripId, tripId))
      .orderBy(asc(tripLodgingOptions.position)),
    tx.select().from(tripTodos).where(eq(tripTodos.tripId, tripId)),
    tx.select().from(entryRules).where(isNull(entryRules.validTo)),
    tx.select().from(borderSystems),
  ]);
  return {
    trip,
    travelers,
    places,
    anchors,
    wishes,
    flights,
    legs,
    drives,
    options,
    todos,
    rules,
    systems,
  };
}

export interface RumboTodo extends TodoDraft {
  readonly rowId: string | null;
  readonly status: 'pending' | 'bought' | 'dismissed';
  readonly confirmationCode: string | null;
  /** No longer asked by the plan; kept because it was bought. */
  readonly orphaned: boolean;
}

export interface RumboLodgingStop extends StopSummary {
  readonly countryName: string;
  readonly unconvertedOptions: number;
}

export interface RumboView {
  readonly trip: {
    readonly id: string;
    readonly name: string;
    readonly start: PlainDate;
    readonly end: PlainDate;
    readonly baseCurrency: string;
    readonly drivingBudget: number;
    readonly departureTime: string;
    readonly lodgingCap: string | null;
    readonly composedAt: string | null;
  };
  readonly travelers: readonly (Traveler & { readonly rowId: string })[];
  readonly anchors: readonly (Anchor & { readonly placeName: string })[];
  readonly wishes: readonly (Wish & { readonly outcome: WishOutcome | null })[];
  readonly flights: readonly FlightSegment[];
  readonly places: Readonly<Record<string, RumboPlace>>;
  readonly itinerary: Itinerary | null;
  readonly plan: RumboPlanSnapshot | null;
  /** Minutes the wishes add to the drives, against the plan without them. */
  readonly wishCostMinutes: number | null;
  readonly geometry: Readonly<Record<string, readonly [number, number, number][]>>;
  readonly routing: {
    readonly configured: boolean;
    readonly pending: number;
    readonly failed: number;
  };
  readonly entry: readonly EntryVerdict[];
  readonly todos: readonly RumboTodo[];
  readonly lodging: {
    readonly stops: readonly RumboLodgingStop[];
    readonly totals: LodgingTotals;
    readonly notices: readonly Notice[];
    readonly currency: string;
    readonly adults: number;
  };
  /** Listing ids and links, which the engine does not need but the screen does. */
  readonly lodgingRows: readonly {
    readonly id: string;
    readonly listingId: string | null;
    readonly url: string | null;
  }[];
  /** Stored routing requests by `mode|a>b>c`, for the manual mode. */
  readonly driveRows: readonly {
    readonly id: string;
    readonly key: string;
    readonly status: string;
  }[];
  readonly today: PlainDate;
}

function toRule(row: typeof entryRules.$inferSelect): EntryRule {
  return {
    passportCountry: row.passportCountry,
    zone: row.zone,
    status: row.status,
    maxStayDays: row.maxStayDays,
    windowDays: row.windowDays,
    conditions: row.conditions,
    source: { name: row.sourceName, url: row.sourceUrl, checkedOn: toPlainDate(row.checkedOn) },
    validFrom: row.validFrom ? toPlainDate(row.validFrom) : null,
    validTo: row.validTo ? toPlainDate(row.validTo) : null,
  };
}

function toSystem(row: typeof borderSystems.$inferSelect): BorderSystem {
  return {
    id: row.id,
    zone: row.zone,
    startsOn: row.startsOn ? toPlainDate(row.startsOn) : null,
    exempt: row.exempt,
    source: { name: row.sourceName, url: row.sourceUrl, checkedOn: toPlainDate(row.checkedOn) },
  };
}

function toBase(
  amount: string,
  currency: string,
  base: string,
  fx: Readonly<Record<string, { rate: string }>>,
): string | null {
  if (currency === base) return amount;
  const rate = fx[currency]?.rate;
  if (!rate) return null;
  return convertToBase(amount, rate, { minorUnits: 2 }, { minorUnits: 2 });
}

export function buildView(rows: RumboRows, today: PlainDate): RumboView {
  const { trip } = rows;
  const placesById = new Map(rows.places.map((p) => [p.id, p]));
  const place = placeResolver(rows.places);
  const snapshot = isSnapshot(trip.rumboPlan) ? trip.rumboPlan : null;
  const anchors = rows.anchors
    .map((a) => anchorFromRow(a, placesById))
    .filter((a): a is Anchor => a !== null);
  const flights = rows.flights.map(flightFromRow);
  const stays = rows.legs.map((l) => stayFromLeg(l, placesById));
  const routes = routesFrom(rows.drives);

  let itinerary: Itinerary | null = null;
  if (snapshot && stays.length > 0) {
    const composition: Composition = {
      stays,
      drives: snapshot.drives,
      corridors: snapshot.corridors,
      wishes: snapshot.wishes,
      sacrifices: snapshot.sacrifices,
      notices: snapshot.notices,
      baselineDrives: snapshot.baselineDrives,
    };
    itinerary = buildItinerary({
      start: toPlainDate(trip.startDate),
      end: toPlainDate(trip.endDate),
      flights,
      flightStays: [],
      composition,
      place,
      routes,
      drivingBudgetMinutes: trip.rumboDrivingBudget,
      departureTime: trip.rumboDepartureTime,
    });
  }

  let wishCostMinutes: number | null = null;
  if (snapshot?.wishes.some((w) => w.corridorId)) {
    const withWish = drivesMinutes(snapshot.drives, routes);
    const without = drivesMinutes(snapshot.baselineDrives, routes);
    if (withWish !== null && without !== null) wishCostMinutes = withWish - without;
  }

  const travelers = rows.travelers.map((t) => ({
    id: t.id,
    rowId: t.id,
    name: t.displayName,
    nationalities: t.nationalities,
    ...(t.residence ? { residence: t.residence } : {}),
  }));

  const entry = itinerary
    ? evaluateEntry({
        travelers,
        presence: presenceOf(itinerary, place, (iata) => AIRPORTS.get(iata)?.country ?? null),
        rules: rows.rules.map(toRule),
        systems: rows.systems.map(toSystem),
        today,
      })
    : [];

  // Purchases: what the plan asks for, with what the person already marked.
  const drafts = itinerary ? generateTodos({ itinerary, flights, anchors, place }) : [];
  const stored = new Map(rows.todos.map((t) => [t.todoKey, t]));
  const todos: RumboTodo[] = drafts.map((d) => {
    const s = stored.get(d.key);
    return {
      ...d,
      rowId: s?.id ?? null,
      status: s?.status ?? 'pending',
      confirmationCode: s?.confirmationCode ?? null,
      orphaned: false,
    };
  });
  const draftKeys = new Set(drafts.map((d) => d.key));
  for (const s of rows.todos) {
    if (draftKeys.has(s.todoKey) || s.status !== 'bought') continue;
    todos.push({
      key: s.todoKey,
      kind: s.kind as TodoDraft['kind'],
      params: s.titleParams,
      country: s.countryCode,
      url: s.url,
      dueOn: s.dueOn ? toPlainDate(s.dueOn) : null,
      saleOpensOn: s.saleOpensOn ? toPlainDate(s.saleOpensOn) : null,
      certainty: s.certainty,
      source: null,
      rowId: s.id,
      status: s.status,
      confirmationCode: s.confirmationCode,
      orphaned: true,
    });
  }

  // Lodging, in the trip's base currency.
  const base = trip.baseCurrency as CurrencyCode;
  const fx = trip.planningFx;
  const adults = Math.max(travelers.length, 1);
  const stops: RumboLodgingStop[] = rows.legs
    .filter((l) => l.stayOrigin !== null)
    .map((leg) => {
      const stay = stayFromLeg(leg, placesById);
      const p = place(stay.placeId);
      let unconverted = 0;
      const options: LodgingOption[] = rows.options
        .filter((o) => o.legId === leg.id)
        .map((o) => {
          const amount =
            o.totalPrice && o.currency ? toBase(o.totalPrice, o.currency, base, fx) : null;
          if (o.totalPrice && amount === null) unconverted += 1;
          return {
            id: o.id,
            provider: o.provider,
            name: o.name,
            kind: o.kind,
            rating: o.rating,
            reviews: o.reviews,
            total: amount ? Money.fromDecimalString(amount, base) : null,
            recommended: o.recommended,
            certainty: o.certainty,
          };
        });
      const mine =
        leg.myLodgingPrice && leg.myLodgingCurrency
          ? toBase(leg.myLodgingPrice, leg.myLodgingCurrency, base, fx)
          : null;
      const summary = summarizeStop({
        legId: leg.id,
        placeId: stay.placeId,
        placeName: p.name,
        firstNight: stay.firstNight,
        nights: stay.nights,
        hosted: leg.hosted,
        paid: leg.lodgingMode === 'prepaid',
        options,
        myPrice: mine ? Money.fromDecimalString(mine, base) : null,
      });
      return {
        ...summary,
        countryName: countryNameForSearch(p.country),
        unconvertedOptions: unconverted,
      };
    });
  const cap = trip.rumboLodgingCap ? Money.fromDecimalString(trip.rumboLodgingCap, base) : null;

  const geometry: Record<string, [number, number, number][]> = {};
  for (const d of rows.drives) {
    if (d.status === 'routed' && d.geometry)
      geometry[`${d.mode}|${d.points.join('>')}`] = d.geometry;
  }

  const places: Record<string, RumboPlace> = {};
  const referenced = new Set<string>([
    ...stays.map((s) => s.placeId),
    ...anchors.map((a) => a.placeId),
    ...(snapshot?.drives.flatMap((d) => d.points) ?? []),
  ]);
  for (const id of referenced) places[id] = place(id);

  const live = new Set(
    (snapshot?.drives ?? []).flatMap((d) =>
      routeRequestsFor(d.points).map((r) => `${r.mode}|${r.points.join('>')}`),
    ),
  );
  const liveDrives = rows.drives.filter((d) => live.has(`${d.mode}|${d.points.join('>')}`));

  return {
    trip: {
      id: trip.id,
      name: trip.name,
      start: toPlainDate(trip.startDate),
      end: toPlainDate(trip.endDate),
      baseCurrency: trip.baseCurrency,
      drivingBudget: trip.rumboDrivingBudget,
      departureTime: trip.rumboDepartureTime,
      lodgingCap: trip.rumboLodgingCap,
      composedAt: trip.rumboComposedAt?.toISOString() ?? null,
    },
    travelers,
    anchors: anchors.map((a) => ({ ...a, placeName: place(a.placeId).name })),
    wishes: rows.wishes.map((w) => ({
      id: w.id,
      text: w.body,
      tags: w.tags,
      outcome: snapshot?.wishes.find((o) => o.wishId === w.id) ?? null,
    })),
    flights,
    places,
    itinerary,
    plan: snapshot,
    wishCostMinutes,
    geometry,
    routing: {
      configured: routingConfigured(),
      pending: liveDrives.filter((d) => d.status === 'pending').length,
      failed: liveDrives.filter((d) => d.status === 'failed').length,
    },
    entry,
    todos,
    lodging: {
      stops,
      totals: lodgingTotals(stops, base),
      notices: lodgingNotices(stops, cap),
      currency: base,
      adults,
    },
    lodgingRows: rows.options.map((o) => ({ id: o.id, listingId: o.listingId, url: o.url })),
    driveRows: rows.drives.map((d) => ({
      id: d.id,
      key: `${d.mode}|${d.points.join('>')}`,
      status: d.status,
    })),
    today,
  };
}

export async function loadRumbo(
  session: Session,
  householdId: string,
  tripId: string,
  today: PlainDate,
): Promise<RumboView | null> {
  const rows = await queryAsUser(session, (tx) => readRumboRows(tx, householdId, tripId));
  return rows ? buildView(rows, today) : null;
}

// ---------------------------------------------------------------------------
// Composing
// ---------------------------------------------------------------------------

export type ComposeError =
  'tripNotFound' | 'needsCarAnchors' | 'manualLegsExist' | 'legHasMoney' | 'staysOutsideTrip';

export interface ComposeResult {
  readonly pending: number;
  readonly notices: readonly Notice[];
}

async function ensurePlaces(
  tx: Tx,
  householdId: string,
  tripId: string,
  ids: readonly string[],
  existing: PlaceRow[],
): Promise<PlaceRow[]> {
  const have = new Set(existing.flatMap((p) => [p.id, p.catalogId ?? '']));
  const missing = [...new Set(ids)].filter((id) => !have.has(id) && PLACES.has(id));
  if (missing.length === 0) return existing;
  const inserted = await tx
    .insert(tripPlaces)
    .values(
      missing.map((id) => {
        const p = PLACES.get(id);
        if (!p) throw new Error(`Unknown catalog place ${id}`);
        return {
          householdId,
          tripId,
          catalogId: p.id,
          name: p.name,
          countryCode: p.country,
          lat: p.lat.toFixed(6),
          lon: p.lon.toFixed(6),
          timeZone: p.timeZone,
          kind: p.kind,
          altitudeM: p.altitudeM ?? null,
          certainty: 'estimated' as const,
          sourceName: 'OpenStreetMap vía openrouteservice',
          sourceUrl: 'https://openrouteservice.org',
          checkedOn: '2026-10-02',
        };
      }),
    )
    .returning();
  return [...existing, ...inserted];
}

async function legsWithMoney(tx: Tx, legIds: readonly string[]): Promise<Set<string>> {
  if (legIds.length === 0) return new Set();
  const [moves, bookings] = await Promise.all([
    tx
      .select({ id: transactions.tripLegId })
      .from(transactions)
      .where(and(inArray(transactions.tripLegId, [...legIds]), isNull(transactions.deletedAt))),
    tx
      .select({ id: tripBookings.legId })
      .from(tripBookings)
      .where(and(inArray(tripBookings.legId, [...legIds]), isNull(tripBookings.deletedAt))),
  ]);
  return new Set(
    [...moves, ...bookings].map((r) => r.id).filter((id): id is string => id !== null),
  );
}

/**
 * Composes the trip and stores the result: places, stays as legs, drives as
 * routing requests (copied from the household's cache when the same points
 * were routed before). Legs the family wrote by hand are only replaced when
 * the person confirms it, and never when money hangs from them.
 */
export async function composeAndStore(
  tx: Tx,
  householdId: string,
  tripId: string,
  options: { readonly replaceManualLegs: boolean },
): Promise<ComposeResult | { error: ComposeError }> {
  const rows = await readRumboRows(tx, householdId, tripId);
  if (!rows) return { error: 'tripNotFound' };
  const placesById = new Map(rows.places.map((p) => [p.id, p]));
  const anchors = rows.anchors
    .map((a) => anchorFromRow(a, placesById))
    .filter((a): a is Anchor => a !== null);
  const pickup = anchors.find((a) => a.kind === 'car_pickup');
  const dropoff = anchors.find((a) => a.kind === 'car_return');
  if (!pickup || !dropoff) return { error: 'needsCarAnchors' };

  const wishes: Wish[] = rows.wishes.map((w) => ({ id: w.id, text: w.body, tags: w.tags }));
  const composition = composeGround({
    ground: {
      start: { placeId: pickup.placeId, date: pickup.from },
      end: { placeId: dropoff.placeId, date: dropoff.from },
    },
    anchors: anchors.filter((a) => a.kind !== 'car_pickup' && a.kind !== 'car_return'),
    wishes,
    corridors: CORRIDORS,
    sleepNear: SLEEP_NEAR,
  });
  const flights = rows.flights.map(flightFromRow);
  const stays: Stay[] = [
    ...flightStays(flights, { groundStart: pickup.from, groundEnd: dropoff.from }),
    ...composition.stays,
  ].sort((a, b) => (a.firstNight < b.firstNight ? -1 : 1));

  const start = toPlainDate(rows.trip.startDate);
  const end = toPlainDate(rows.trip.endDate);
  for (const s of stays) {
    const lastDay = new Date(Date.parse(s.firstNight) + s.nights * 86_400_000)
      .toISOString()
      .slice(0, 10);
    if (s.firstNight < start || lastDay > end) return { error: 'staysOutsideTrip' };
  }

  // Places for every stay and every point driven through.
  const allDrives = [...composition.drives, ...composition.baselineDrives];
  const placeRows = await ensurePlaces(
    tx,
    householdId,
    tripId,
    [...stays.map((s) => s.placeId), ...allDrives.flatMap((d) => d.points)],
    rows.places,
  );
  const byEngineId = new Map(placeRows.map((p) => [engineId(p), p]));
  const place = placeResolver(placeRows);

  // Legs: hand-written ones need consent; legs with money stay.
  const manual = rows.legs.filter((l) => l.stayOrigin === null);
  if (manual.length > 0 && !options.replaceManualLegs) return { error: 'manualLegsExist' };
  const managed = rows.legs.filter((l) => l.stayOrigin !== null);
  const keep = new Map<string, LegRow>();
  for (const l of managed) {
    const p = l.placeId ? placesById.get(l.placeId) : undefined;
    if (p) keep.set(`${engineId(p)}@${l.arrivalDate}`, l);
  }
  const wanted = new Set(stays.map((s) => `${s.placeId}@${s.firstNight}`));
  const toDelete = [
    ...manual,
    ...managed.filter((l) => {
      const p = l.placeId ? placesById.get(l.placeId) : undefined;
      return !p || !wanted.has(`${engineId(p)}@${l.arrivalDate}`);
    }),
  ];
  const withMoney = await legsWithMoney(
    tx,
    toDelete.map((l) => l.id),
  );
  if (withMoney.size > 0) return { error: 'legHasMoney' };
  if (toDelete.length > 0) {
    await tx.delete(tripLegs).where(
      inArray(
        tripLegs.id,
        toDelete.map((l) => l.id),
      ),
    );
  }

  for (const [position, s] of stays.entries()) {
    const p = byEngineId.get(s.placeId);
    const engine = place(s.placeId);
    const departure = new Date(Date.parse(s.firstNight) + s.nights * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const lodgingMode = s.hosted ? 'none' : s.paid ? 'prepaid' : 'undecided';
    const existing = keep.get(`${s.placeId}@${s.firstNight}`);
    if (existing) {
      await tx
        .update(tripLegs)
        .set({
          departureDate: departure,
          position,
          stayOrigin: s.origin,
          hosted: s.hosted,
          lodgingMode,
        })
        .where(eq(tripLegs.id, existing.id));
    } else {
      await tx.insert(tripLegs).values({
        householdId,
        tripId,
        position,
        city: engine.name.slice(0, 120),
        countryCode: engine.country,
        arrivalDate: s.firstNight,
        departureDate: departure,
        localCurrency: CURRENCY_BY_COUNTRY[engine.country] ?? rows.trip.baseCurrency,
        costLevel: COST_LEVEL_BY_COUNTRY[engine.country] ?? 'medium',
        timezone: engine.timeZone,
        lodgingMode,
        placeId: p?.id ?? null,
        stayOrigin: s.origin,
        hosted: s.hosted,
      });
    }
  }

  // Planning rates for the new local currencies, as the Viajes wizard fixes them.
  const base = rows.trip.baseCurrency.trim();
  const wantedFx = [
    ...new Set(stays.map((s) => CURRENCY_BY_COUNTRY[place(s.placeId).country] ?? base)),
  ].filter((c) => c !== base && !(c in rows.trip.planningFx));
  if (wantedFx.length > 0) {
    const latest = await tx
      .selectDistinctOn([fxRates.quote], {
        quote: fxRates.quote,
        rate: fxRates.rate,
        date: fxRates.rateDate,
      })
      .from(fxRates)
      .where(and(eq(fxRates.base, base), inArray(fxRates.quote, wantedFx)))
      .orderBy(fxRates.quote, desc(fxRates.rateDate));
    if (latest.length > 0) {
      await tx
        .update(trips)
        .set({
          planningFx: {
            ...rows.trip.planningFx,
            ...Object.fromEntries(
              latest.map((r) => [r.quote.trim(), { rate: r.rate, date: r.date }]),
            ),
          },
        })
        .where(eq(trips.id, tripId));
    }
  }

  // Drives: one routing request per piece, reusing the household's cache.
  const pieces = new Map<
    string,
    {
      date: PlainDate;
      purpose: DriveRequest['purpose'];
      points: string[];
      mode: GroundMode;
      hash: string;
      position: number;
    }
  >();
  let position = 0;
  for (const d of allDrives) {
    for (const piece of routeRequestsFor(d.points)) {
      const key = `${piece.mode}|${piece.points.join('>')}`;
      if (pieces.has(key)) continue;
      pieces.set(key, {
        date: d.date,
        purpose: d.purpose,
        points: piece.points,
        mode: piece.mode,
        hash: requestHash(piece.mode, piece.points, place),
        position: position++,
      });
    }
  }
  const existingDrives = new Map(rows.drives.map((d) => [`${d.mode}|${d.points.join('>')}`, d]));
  const stale = rows.drives.filter((d) => !pieces.has(`${d.mode}|${d.points.join('>')}`));
  if (stale.length > 0)
    await tx.delete(tripDrives).where(
      inArray(
        tripDrives.id,
        stale.map((d) => d.id),
      ),
    );

  const newHashes = [...pieces.entries()]
    .filter(([k]) => !existingDrives.has(k))
    .map(([, v]) => v.hash);
  const cached = newHashes.length
    ? await tx
        .select()
        .from(tripDrives)
        .where(
          and(
            eq(tripDrives.householdId, householdId),
            inArray(tripDrives.requestHash, newHashes),
            eq(tripDrives.status, 'routed'),
          ),
        )
    : [];
  const cacheByHash = new Map(cached.map((c) => [c.requestHash, c]));

  let pending = 0;
  for (const [key, piece] of pieces) {
    const current = existingDrives.get(key);
    if (current) {
      await tx
        .update(tripDrives)
        .set({ driveDate: piece.date, purpose: piece.purpose, position: piece.position })
        .where(eq(tripDrives.id, current.id));
      if (current.status === 'pending') pending += 1;
      continue;
    }
    const hit = cacheByHash.get(piece.hash);
    // A ferry crossing has no road to route; its duration comes from the router too.
    await tx.insert(tripDrives).values({
      householdId,
      tripId,
      driveDate: piece.date,
      position: piece.position,
      purpose: piece.purpose,
      points: piece.points,
      mode: piece.mode,
      requestHash: piece.hash,
      legs: hit?.legs ?? [],
      geometry: hit?.geometry ?? null,
      status: hit ? 'routed' : 'pending',
      sourceName: hit?.sourceName ?? null,
      sourceUrl: hit?.sourceUrl ?? null,
      fetchedAt: hit?.fetchedAt ?? null,
    });
    if (!hit) pending += 1;
  }

  const snapshot: RumboPlanSnapshot = {
    engineVersion: 'itinerary-1',
    drives: composition.drives,
    baselineDrives: composition.baselineDrives,
    corridors: composition.corridors,
    sacrifices: composition.sacrifices,
    wishes: composition.wishes,
    notices: composition.notices,
  };
  await tx
    .update(trips)
    .set({ rumboPlan: snapshot as unknown as Record<string, unknown>, rumboComposedAt: new Date() })
    .where(eq(trips.id, tripId));

  return { pending, notices: composition.notices };
}

// ---------------------------------------------------------------------------
// Routing in the background
// ---------------------------------------------------------------------------

/** openrouteservice's free plan allows 40 directions a minute. */
const ROUTE_SPACING_MS = 1600;

registerJobHandler(RUMBO_ROUTE_JOB, async (job, report) => {
  const tripId = (job.payload as { tripId?: string }).tripId;
  if (!tripId) return { failure: 'missing_trip', retryable: false };
  if (!routingConfigured()) return { result: { skipped: 'not_configured' } };
  const db = getAdminDb(getServerEnv().DIRECT_URL);

  const [placeRows, drives] = await Promise.all([
    db
      .select()
      .from(tripPlaces)
      .where(and(eq(tripPlaces.tripId, tripId), eq(tripPlaces.householdId, job.householdId))),
    db
      .select()
      .from(tripDrives)
      .where(
        and(
          eq(tripDrives.tripId, tripId),
          eq(tripDrives.householdId, job.householdId),
          or(
            eq(tripDrives.status, 'pending'),
            and(eq(tripDrives.status, 'failed'), isNotNull(tripDrives.failure)),
          ),
        ),
      ),
  ]);
  const place = placeResolver(placeRows);
  let done = 0;
  let quota = false;
  for (const d of drives.filter((x) => x.status === 'pending')) {
    const answer = await routeDrive(d.points.map((id) => place(id)));
    done += 1;
    await report(Math.round((done / drives.length) * 100), 'routing');
    if (!answer.ok) {
      if (answer.failure === 'quota' || answer.failure === 'unavailable') {
        quota = true;
        break;
      }
      await db
        .update(tripDrives)
        .set({ status: 'failed', failure: answer.failure })
        .where(eq(tripDrives.id, d.id));
      continue;
    }
    await db
      .update(tripDrives)
      .set({
        status: 'routed',
        failure: null,
        legs: answer.drive.legs.map((l, i) => ({
          from: d.points[i] ?? '',
          to: d.points[i + 1] ?? '',
          ...l,
        })),
        geometry: [...answer.drive.geometry],
        sourceName: ORS_SOURCE.name,
        sourceUrl: ORS_SOURCE.url,
        fetchedAt: new Date(),
      })
      .where(eq(tripDrives.id, d.id));
    await new Promise((resolve) => setTimeout(resolve, ROUTE_SPACING_MS));
  }
  if (quota) return { failure: 'router_busy', retryable: true };
  return { result: { routed: done } };
});
