'use server';

import {
  tripAnchors,
  tripDrives,
  tripExtraStops,
  tripFlightSegments,
  tripLegs,
  tripLodgingOptions,
  tripPlaces,
  trips,
  tripShares,
  tripTodos,
  tripTravelers,
  tripWishes,
} from '@app/database/schema';
import { todayIn } from '@app/domain';
import { AIRPORTS, PLACES, tagsFromText } from '@app/itinerary';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';

import { enqueueJob, runQueuedJobs } from './jobs';
import { plainDateString } from './record-input';
import { tripsEnabled } from './repositories/trips';
import { revalidateTrip } from './revalidate';
import { composeAndStore, loadRumbo, RUMBO_ROUTE_JOB } from './rumbo';
import { newShareToken } from './rumbo-share';
import { parseTicketText } from './rumbo-ticket';
import {
  geocodePlace,
  routingConfigured,
  SINGLE_ZONE,
  type GeocodedPlace,
} from './routing/openrouteservice';
import { loadSession, queryAsUser, type Session } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Rumbo: every write the itinerary makes.
 *
 * Each action checks the session, the Viajes flag and its input, then works
 * under the person's own RLS context. The itinerary is not written anywhere:
 * the next read computes it from what these actions stored. Actions return
 * error keys, never prose.
 */

type Locale = 'en' | 'es';

interface Context {
  readonly session: Session;
  readonly householdId: string;
}

async function context(): Promise<Context | { error: string }> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };
  if (!(await tripsEnabled(session, session.activeHouseholdId))) return { error: 'moduleOff' };
  return { session, householdId: session.activeHouseholdId };
}

function revalidateRumbo(locale: Locale, tripId: string): void {
  revalidatePath(`/${locale}/trips/${tripId}/route`);
  revalidateTrip(locale, tripId);
}

const tripId = z.uuid();
const country = z.string().regex(/^[A-Z]{2}$/);
const timeZone = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/);
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const amount = z.string().regex(/^\d{1,12}(\.\d{1,4})?$/);

async function ownsTrip(ctx: Context, id: string): Promise<boolean> {
  const rows = await queryAsUser(ctx.session, (tx) =>
    tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.householdId, ctx.householdId)))
      .limit(1),
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

export interface PlaceSuggestion {
  /** A catalog id, or null for a geocoded place. */
  readonly catalogId: string | null;
  readonly name: string;
  readonly label: string;
  readonly country: string;
  readonly lat: number;
  readonly lon: number;
  readonly timeZone: string | null;
  readonly kind: string;
}

function normalized(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Places matching a name: Rumbo's catalog first, then the geocoder. */
export async function searchRumboPlaces(
  query: string,
): Promise<{ places?: PlaceSuggestion[]; error?: string }> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const text = query.trim().slice(0, 80);
  if (text.length < 2) return { places: [] };
  const wanted = normalized(text);
  const fromCatalog: PlaceSuggestion[] = [...PLACES.values()]
    .filter((p) => normalized(p.name).includes(wanted) || p.id.includes(wanted))
    .slice(0, 5)
    .map((p) => ({
      catalogId: p.id,
      name: p.name,
      label: p.name,
      country: p.country,
      lat: p.lat,
      lon: p.lon,
      timeZone: p.timeZone,
      kind: p.kind,
    }));
  const geocoded: GeocodedPlace[] =
    fromCatalog.length >= 3 ? [] : ((await geocodePlace(text)) ?? []);
  return {
    places: [
      ...fromCatalog,
      ...geocoded.filter((g) => g.country !== '').map((g) => ({ catalogId: null, ...g })),
    ],
  };
}

const placeInput = z.union([
  z.object({ catalogId: z.string().regex(/^[a-z0-9_-]{1,40}$/) }),
  z.object({
    catalogId: z.null().optional(),
    name: z.string().trim().min(1).max(160),
    country,
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    timeZone,
    kind: z.enum(['city', 'town', 'poi', 'market']).default('town'),
  }),
]);

type PlaceInput = z.infer<typeof placeInput>;

async function placeIdFor(
  tx: Parameters<Parameters<typeof queryAsUser>[1]>[0],
  householdId: string,
  trip: string,
  input: PlaceInput,
): Promise<string | null> {
  if ('catalogId' in input && input.catalogId) {
    const [existing] = await tx
      .select({ id: tripPlaces.id })
      .from(tripPlaces)
      .where(and(eq(tripPlaces.tripId, trip), eq(tripPlaces.catalogId, input.catalogId)))
      .limit(1);
    if (existing) return existing.id;
    const p = PLACES.get(input.catalogId);
    if (!p) return null;
    const [row] = await tx
      .insert(tripPlaces)
      .values({
        householdId,
        tripId: trip,
        catalogId: p.id,
        name: p.name,
        countryCode: p.country,
        lat: p.lat.toFixed(6),
        lon: p.lon.toFixed(6),
        timeZone: p.timeZone,
        kind: p.kind,
        altitudeM: p.altitudeM ?? null,
        certainty: 'estimated',
      })
      .returning({ id: tripPlaces.id });
    return row?.id ?? null;
  }
  if (!('name' in input)) return null;
  const [row] = await tx
    .insert(tripPlaces)
    .values({
      householdId,
      tripId: trip,
      name: input.name,
      countryCode: input.country,
      lat: input.lat.toFixed(6),
      lon: input.lon.toFixed(6),
      timeZone: input.timeZone,
      kind: input.kind,
      certainty: 'estimated',
      sourceName: 'OpenStreetMap vía openrouteservice',
      sourceUrl: 'https://openrouteservice.org',
      checkedOn: todayIn('UTC'),
    })
    .returning({ id: tripPlaces.id });
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Travellers
// ---------------------------------------------------------------------------

const passportsInput = z.object({
  tripId,
  travelerId: z.uuid(),
  nationalities: z.array(country).min(1).max(4),
  residence: country.nullish(),
});

export async function saveTravelerPassports(
  raw: z.input<typeof passportsInput>,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const parsed = passportsInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  const updated = await queryAsUser(ctx.session, (tx) =>
    tx
      .update(tripTravelers)
      .set({ nationalities: [...new Set(input.nationalities)], residence: input.residence ?? null })
      .where(
        and(
          eq(tripTravelers.id, input.travelerId),
          eq(tripTravelers.tripId, input.tripId),
          eq(tripTravelers.householdId, ctx.householdId),
        ),
      )
      .returning({ id: tripTravelers.id }),
  );
  if (updated.length === 0) return { error: 'notFound' };
  revalidateRumbo(locale, input.tripId);
  return { ok: true };
}

const travelerAddInput = z.object({
  tripId,
  name: z.string().trim().min(1).max(80),
  nationalities: z.array(country).min(1).max(4),
  residence: country.nullish(),
});

export async function addRumboTraveler(
  raw: z.input<typeof travelerAddInput>,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const parsed = travelerAddInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  if (!(await ownsTrip(ctx, input.tripId))) return { error: 'notFound' };
  const [row] = await queryAsUser(ctx.session, (tx) =>
    tx
      .insert(tripTravelers)
      .values({
        householdId: ctx.householdId,
        tripId: input.tripId,
        displayName: input.name,
        nationalities: [...new Set(input.nationalities)],
        residence: input.residence ?? null,
      })
      .returning({ id: tripTravelers.id }),
  );
  revalidateRumbo(locale, input.tripId);
  return row ? { created: row.id } : { error: 'saveFailed' };
}

// ---------------------------------------------------------------------------
// Fixed points
// ---------------------------------------------------------------------------

const anchorInput = z
  .object({
    tripId,
    kind: z.enum(['stay', 'event', 'friends', 'car_pickup', 'car_return']),
    place: placeInput,
    from: plainDateString,
    to: plainDateString,
    maxNights: z.number().int().min(1).max(60).nullish(),
    hosted: z.boolean().default(false),
    paid: z.boolean().default(false),
    label: z.string().trim().max(120).nullish(),
  })
  .refine((v) => v.from <= v.to, { path: ['to'] });

export async function addAnchor(
  raw: z.input<typeof anchorInput>,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const parsed = anchorInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  const result = await queryAsUser(ctx.session, async (tx) => {
    const [trip] = await tx
      .select({ start: trips.startDate, end: trips.endDate })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.householdId, ctx.householdId)))
      .limit(1);
    if (!trip) return { error: 'notFound' } as const;
    if (input.from < trip.start || input.to > trip.end) return { error: 'outsideTrip' } as const;
    const placeId = await placeIdFor(tx, ctx.householdId, input.tripId, input.place);
    if (!placeId) return { error: 'placeUnknown' } as const;
    // The car is picked up and returned once.
    if (input.kind === 'car_pickup' || input.kind === 'car_return') {
      await tx
        .delete(tripAnchors)
        .where(and(eq(tripAnchors.tripId, input.tripId), eq(tripAnchors.kind, input.kind)));
    }
    const [row] = await tx
      .insert(tripAnchors)
      .values({
        householdId: ctx.householdId,
        tripId: input.tripId,
        kind: input.kind,
        placeId,
        fromDate: input.from,
        toDate: input.to,
        maxNights: input.maxNights ?? null,
        hosted: input.kind === 'friends' ? true : input.hosted,
        paid: input.paid,
        label: input.label ?? null,
        certainty: 'confirmed',
      })
      .returning({ id: tripAnchors.id });
    return { id: row?.id ?? '' } as const;
  });
  if ('error' in result) return { error: result.error };
  revalidateRumbo(locale, input.tripId);
  return { created: result.id };
}

export async function removeAnchor(
  trip: string,
  anchorId: string,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  if (!tripId.safeParse(trip).success || !z.uuid().safeParse(anchorId).success)
    return { error: 'invalid' };
  const removed = await queryAsUser(ctx.session, (tx) =>
    tx
      .delete(tripAnchors)
      .where(
        and(
          eq(tripAnchors.id, anchorId),
          eq(tripAnchors.tripId, trip),
          eq(tripAnchors.householdId, ctx.householdId),
        ),
      )
      .returning({ id: tripAnchors.id }),
  );
  if (removed.length === 0) return { error: 'notFound' };
  revalidateRumbo(locale, trip);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Wishes
// ---------------------------------------------------------------------------

const wishInput = z.object({
  tripId,
  text: z.string().trim().min(2).max(300),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
});

export async function addWish(
  raw: z.input<typeof wishInput>,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const parsed = wishInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  if (!(await ownsTrip(ctx, input.tripId))) return { error: 'notFound' };
  const tags = [
    ...new Set([...tagsFromText(input.text), ...input.tags.map((t) => t.toLowerCase())]),
  ];
  const [row] = await queryAsUser(ctx.session, (tx) =>
    tx
      .insert(tripWishes)
      .values({ householdId: ctx.householdId, tripId: input.tripId, body: input.text, tags })
      .returning({ id: tripWishes.id }),
  );
  revalidateRumbo(locale, input.tripId);
  return row ? { created: row.id } : { error: 'saveFailed' };
}

export async function removeWish(
  trip: string,
  wishId: string,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  if (!tripId.safeParse(trip).success || !z.uuid().safeParse(wishId).success)
    return { error: 'invalid' };
  const removed = await queryAsUser(ctx.session, (tx) =>
    tx
      .delete(tripWishes)
      .where(
        and(
          eq(tripWishes.id, wishId),
          eq(tripWishes.tripId, trip),
          eq(tripWishes.householdId, ctx.householdId),
        ),
      )
      .returning({ id: tripWishes.id }),
  );
  if (removed.length === 0) return { error: 'notFound' };
  revalidateRumbo(locale, trip);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------

const iata = z.string().regex(/^[A-Z]{3}$/);

const flightInput = z.object({
  tripId,
  from: iata,
  to: iata,
  departsDate: plainDateString,
  departsTime: localTime,
  arrivesDate: plainDateString,
  arrivesTime: localTime,
  flightNumber: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{2,3}\s?\d{1,5}[A-Z]?$/)
    .nullish(),
  /** True when the times were read off the ticket; false when typed as a guess. */
  fromTicket: z.boolean().default(true),
});

export async function addFlightSegment(
  raw: z.input<typeof flightInput>,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const parsed = flightInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  const from = AIRPORTS.get(input.from);
  const to = AIRPORTS.get(input.to);
  if (!from || !to) return { error: 'airportUnknown' };
  if (!(await ownsTrip(ctx, input.tripId))) return { error: 'notFound' };
  const certainty = input.fromTicket ? 'confirmed' : 'estimated';
  const [row] = await queryAsUser(ctx.session, (tx) =>
    tx
      .insert(tripFlightSegments)
      .values({
        householdId: ctx.householdId,
        tripId: input.tripId,
        fromIata: input.from,
        toIata: input.to,
        departsLocal: `${input.departsDate} ${input.departsTime}:00`,
        departsTz: from.timeZone,
        departsCertainty: certainty,
        arrivesLocal: `${input.arrivesDate} ${input.arrivesTime}:00`,
        arrivesTz: to.timeZone,
        arrivesCertainty: certainty,
        flightNumber: input.flightNumber?.replace(/\s+/g, '') ?? null,
      })
      .returning({ id: tripFlightSegments.id }),
  );
  revalidateRumbo(locale, input.tripId);
  return row ? { created: row.id } : { error: 'saveFailed' };
}

const confirmTimeInput = z.object({
  tripId,
  segmentId: z.uuid(),
  which: z.enum(['departs', 'arrives']),
  date: plainDateString,
  time: localTime,
});

/** The exact time from «Itinerary details» replaces an estimate and becomes «En su boleto». */
export async function confirmFlightTime(
  raw: z.input<typeof confirmTimeInput>,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const parsed = confirmTimeInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  const local = `${input.date} ${input.time}:00`;
  const set =
    input.which === 'departs'
      ? { departsLocal: local, departsCertainty: 'confirmed' as const }
      : { arrivesLocal: local, arrivesCertainty: 'confirmed' as const };
  const updated = await queryAsUser(ctx.session, (tx) =>
    tx
      .update(tripFlightSegments)
      .set(set)
      .where(
        and(
          eq(tripFlightSegments.id, input.segmentId),
          eq(tripFlightSegments.tripId, input.tripId),
          eq(tripFlightSegments.householdId, ctx.householdId),
        ),
      )
      .returning({ id: tripFlightSegments.id }),
  );
  if (updated.length === 0) return { error: 'notFound' };
  revalidateRumbo(locale, input.tripId);
  return { ok: true };
}

export async function removeFlightSegment(
  trip: string,
  segmentId: string,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  if (!tripId.safeParse(trip).success || !z.uuid().safeParse(segmentId).success)
    return { error: 'invalid' };
  const removed = await queryAsUser(ctx.session, (tx) =>
    tx
      .delete(tripFlightSegments)
      .where(
        and(
          eq(tripFlightSegments.id, segmentId),
          eq(tripFlightSegments.tripId, trip),
          eq(tripFlightSegments.householdId, ctx.householdId),
        ),
      )
      .returning({ id: tripFlightSegments.id }),
  );
  if (removed.length === 0) return { error: 'notFound' };
  revalidateRumbo(locale, trip);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Composing and routing
// ---------------------------------------------------------------------------

async function startRouting(ctx: Context, trip: string): Promise<void> {
  if (!routingConfigured()) return;
  await enqueueJob(ctx.session, ctx.householdId, RUMBO_ROUTE_JOB, { tripId: trip });
  after(async () => {
    try {
      await runQueuedJobs();
    } catch {
      // The daily runner picks it up; the screen says the routes are pending.
    }
  });
}

/**
 * Arms the trip: stays around the fixed points, drives between them, and
 * the routes requested in the background. Replacing legs typed by hand in
 * Viajes needs `replaceManualLegs`, which the screen asks for first.
 */
export async function composeRumbo(
  trip: string,
  options: { readonly replaceManualLegs?: boolean } = {},
  locale: Locale = 'es',
): Promise<RecordActionResult & { readonly pending?: number }> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  if (!tripId.safeParse(trip).success) return { error: 'invalid' };
  let result;
  try {
    result = await queryAsUser(ctx.session, (tx) =>
      composeAndStore(tx, ctx.householdId, trip, {
        replaceManualLegs: options.replaceManualLegs ?? false,
      }),
    );
  } catch {
    return { error: 'saveFailed' };
  }
  if ('error' in result) return { error: result.error };
  if (result.pending > 0) await startRouting(ctx, trip);
  revalidateRumbo(locale, trip);
  return { ok: true, pending: result.pending };
}

export async function retryRumboRouting(
  trip: string,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  if (!tripId.safeParse(trip).success) return { error: 'invalid' };
  await queryAsUser(ctx.session, (tx) =>
    tx
      .update(tripDrives)
      .set({ status: 'pending', failure: null })
      .where(
        and(
          eq(tripDrives.tripId, trip),
          eq(tripDrives.householdId, ctx.householdId),
          eq(tripDrives.status, 'failed'),
        ),
      ),
  );
  await startRouting(ctx, trip);
  revalidateRumbo(locale, trip);
  return { ok: true };
}

const manualLegInput = z.object({
  tripId,
  driveId: z.uuid(),
  distanceKm: z.number().min(0.1).max(3000),
  minutes: z.number().int().min(1).max(2000),
});

/** Manual mode: kilometres and minutes typed by the person, for a drive the router could not do. */
export async function setManualDrive(
  raw: z.input<typeof manualLegInput>,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const parsed = manualLegInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  const updated = await queryAsUser(ctx.session, async (tx) => {
    const [drive] = await tx
      .select({ points: tripDrives.points })
      .from(tripDrives)
      .where(
        and(
          eq(tripDrives.id, input.driveId),
          eq(tripDrives.tripId, input.tripId),
          eq(tripDrives.householdId, ctx.householdId),
        ),
      )
      .limit(1);
    if (!drive) return false;
    // The typed total goes on the first stretch; the stops in between keep their order.
    const pairs = drive.points.slice(1).map((to, i) => ({ from: drive.points[i] ?? '', to }));
    await tx
      .update(tripDrives)
      .set({
        status: 'routed',
        failure: null,
        legs: pairs.map((p, i) => ({
          ...p,
          distanceM: i === 0 ? Math.round(input.distanceKm * 1000) : 0,
          durationS: i === 0 ? input.minutes * 60 : 0,
        })),
        sourceName: 'Escrito a mano',
        sourceUrl: null,
        fetchedAt: new Date(),
      })
      .where(eq(tripDrives.id, input.driveId));
    return true;
  });
  if (!updated) return { error: 'notFound' };
  revalidateRumbo(locale, input.tripId);
  return { ok: true };
}

const settingsInput = z.object({
  tripId,
  drivingBudget: z.number().int().min(60).max(900),
  departureTime: localTime,
  lodgingCap: amount.nullish(),
  breakfast: z.boolean().default(false),
  parking: z.boolean().default(false),
  groundMode: z.enum(['car', 'train', 'mixed']).default('car'),
});

export async function saveRumboSettings(
  raw: z.input<typeof settingsInput>,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const parsed = settingsInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  const updated = await queryAsUser(ctx.session, (tx) =>
    tx
      .update(trips)
      .set({
        rumboDrivingBudget: input.drivingBudget,
        rumboDepartureTime: input.departureTime,
        rumboLodgingCap: input.lodgingCap ?? null,
        rumboLodgingPrefs: { breakfast: input.breakfast, parking: input.parking },
        rumboGroundMode: input.groundMode,
      })
      .where(and(eq(trips.id, input.tripId), eq(trips.householdId, ctx.householdId)))
      .returning({ id: trips.id }),
  );
  if (updated.length === 0) return { error: 'notFound' };
  revalidateRumbo(locale, input.tripId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Lodging
// ---------------------------------------------------------------------------

const myPriceInput = z.object({ tripId, legId: z.uuid(), price: amount.nullable() });

/** «Mi precio»: the whole stay in the trip's currency, or null to clear it. */
export async function setMyLodgingPrice(
  raw: z.input<typeof myPriceInput>,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const parsed = myPriceInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  const updated = await queryAsUser(ctx.session, async (tx) => {
    const [trip] = await tx
      .select({ base: trips.baseCurrency })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.householdId, ctx.householdId)))
      .limit(1);
    if (!trip) return [];
    return tx
      .update(tripLegs)
      .set({
        myLodgingPrice: input.price,
        myLodgingCurrency: input.price === null ? null : trip.base,
      })
      .where(and(eq(tripLegs.id, input.legId), eq(tripLegs.tripId, input.tripId)))
      .returning({ id: tripLegs.id });
  });
  if (updated.length === 0) return { error: 'notFound' };
  revalidateRumbo(locale, input.tripId);
  return { ok: true };
}

const useOptionInput = z.object({ tripId, optionId: z.uuid() });

/** «Usar este precio»: the option's total becomes the person's price for that stop. */
export async function applyLodgingOption(
  raw: z.input<typeof useOptionInput>,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const parsed = useOptionInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  const ok = await queryAsUser(ctx.session, async (tx) => {
    const [option] = await tx
      .select()
      .from(tripLodgingOptions)
      .where(
        and(
          eq(tripLodgingOptions.id, input.optionId),
          eq(tripLodgingOptions.tripId, input.tripId),
          eq(tripLodgingOptions.householdId, ctx.householdId),
        ),
      )
      .limit(1);
    if (!option?.totalPrice || !option.currency) return false;
    await tx
      .update(tripLegs)
      .set({
        myLodgingPrice: option.totalPrice,
        myLodgingCurrency: option.currency,
        chosenOptionId: option.id,
      })
      .where(eq(tripLegs.id, option.legId));
    return true;
  });
  if (!ok) return { error: 'notFound' };
  revalidateRumbo(locale, input.tripId);
  return { ok: true };
}

const optionInput = z.object({
  tripId,
  legId: z.uuid(),
  provider: z.enum(['airbnb', 'booking', 'other']),
  name: z.string().trim().min(1).max(160),
  kind: z.string().trim().max(60).nullish(),
  listingId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,40}$/)
    .nullish(),
  rating: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$/)
    .nullish(),
  reviews: z.number().int().min(0).max(1_000_000).nullish(),
  totalPrice: amount.nullish(),
  url: z.url().startsWith('https://').nullish(),
  recommended: z.boolean().default(false),
});

/** An option pasted by hand: Airbnb and Booking have no open API to read from. */
export async function addLodgingOption(
  raw: z.input<typeof optionInput>,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const parsed = optionInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  const row = await queryAsUser(ctx.session, async (tx) => {
    const [trip] = await tx
      .select({ base: trips.baseCurrency })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.householdId, ctx.householdId)))
      .limit(1);
    if (!trip) return null;
    if (input.recommended) {
      await tx
        .update(tripLodgingOptions)
        .set({ recommended: false })
        .where(eq(tripLodgingOptions.legId, input.legId));
    }
    const [inserted] = await tx
      .insert(tripLodgingOptions)
      .values({
        householdId: ctx.householdId,
        tripId: input.tripId,
        legId: input.legId,
        provider: input.provider,
        name: input.name,
        kind: input.kind ?? null,
        listingId: input.listingId ?? null,
        rating: input.rating ?? null,
        reviews: input.reviews ?? null,
        totalPrice: input.totalPrice ?? null,
        currency: input.totalPrice ? trip.base : null,
        url: input.url ?? null,
        recommended: input.recommended,
        // A hotel price is a «desde» until the person checks it on the hotel's page.
        certainty: 'unverified',
        sourceName:
          input.provider === 'airbnb'
            ? 'Airbnb'
            : input.provider === 'booking'
              ? 'Booking.com'
              : null,
        checkedOn: todayIn('UTC'),
      })
      .returning({ id: tripLodgingOptions.id });
    return inserted ?? null;
  });
  if (!row) return { error: 'notFound' };
  revalidateRumbo(locale, input.tripId);
  return { created: row.id };
}

export async function removeLodgingOption(
  trip: string,
  optionId: string,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  if (!tripId.safeParse(trip).success || !z.uuid().safeParse(optionId).success)
    return { error: 'invalid' };
  const removed = await queryAsUser(ctx.session, (tx) =>
    tx
      .delete(tripLodgingOptions)
      .where(
        and(
          eq(tripLodgingOptions.id, optionId),
          eq(tripLodgingOptions.tripId, trip),
          eq(tripLodgingOptions.householdId, ctx.householdId),
        ),
      )
      .returning({ id: tripLodgingOptions.id }),
  );
  if (removed.length === 0) return { error: 'notFound' };
  revalidateRumbo(locale, trip);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

const todoInput = z.object({
  tripId,
  key: z.string().regex(/^[a-z0-9_:.-]{1,120}$/),
  status: z.enum(['pending', 'bought', 'dismissed']),
  confirmationCode: z.string().trim().max(60).nullish(),
});

/**
 * Marks a purchase as bought (with its booking number) or back to pending.
 * The item's facts come from the current plan, not from the request: the
 * screen cannot invent a deadline or a link.
 */
export async function setTodoStatus(
  raw: z.input<typeof todoInput>,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const parsed = todoInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  if (input.confirmationCode && /\d{13,19}/.test(input.confirmationCode.replace(/[\s-]/g, ''))) {
    // Looks like a card number: never stored.
    return { error: 'cardNumber' };
  }
  const view = await loadRumbo(ctx.session, ctx.householdId, input.tripId, todayIn('UTC'));
  const todo = view?.todos.find((t) => t.key === input.key);
  if (!view || !todo) return { error: 'notFound' };
  await queryAsUser(ctx.session, (tx) =>
    tx
      .insert(tripTodos)
      .values({
        householdId: ctx.householdId,
        tripId: input.tripId,
        todoKey: todo.key,
        kind: todo.kind,
        titleParams: { ...todo.params },
        countryCode: todo.country,
        url: todo.url,
        dueOn: todo.dueOn,
        saleOpensOn: todo.saleOpensOn,
        status: input.status,
        confirmationCode: input.confirmationCode ?? null,
        boughtAt: input.status === 'bought' ? new Date() : null,
        certainty: todo.certainty,
        sourceName: todo.source?.name ?? null,
        sourceUrl: todo.source?.url ?? null,
        checkedOn: todo.source?.checkedOn ?? null,
      })
      .onConflictDoUpdate({
        target: [tripTodos.tripId, tripTodos.todoKey],
        set: {
          status: input.status,
          confirmationCode: input.confirmationCode ?? null,
          boughtAt: input.status === 'bought' ? new Date() : null,
          updatedAt: new Date(),
        },
      }),
  );
  revalidateRumbo(locale, input.tripId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

/** A read-only link to the itinerary. The token is shown once; only its hash is kept. */
export async function createTripShare(
  trip: string,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  if (!tripId.safeParse(trip).success) return { error: 'invalid' };
  if (!(await ownsTrip(ctx, trip))) return { error: 'notFound' };
  const { token, hash, hint } = newShareToken();
  await queryAsUser(ctx.session, (tx) =>
    tx.insert(tripShares).values({
      householdId: ctx.householdId,
      tripId: trip,
      tokenHash: hash,
      hint,
      createdBy: ctx.session.user.id,
    }),
  );
  revalidateRumbo(locale, trip);
  return { ok: true, secret: token };
}

export async function revokeTripShare(
  trip: string,
  shareId: string,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  if (!tripId.safeParse(trip).success || !z.uuid().safeParse(shareId).success)
    return { error: 'invalid' };
  const revoked = await queryAsUser(ctx.session, (tx) =>
    tx
      .update(tripShares)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(tripShares.id, shareId),
          eq(tripShares.tripId, trip),
          eq(tripShares.householdId, ctx.householdId),
        ),
      )
      .returning({ id: tripShares.id }),
  );
  if (revoked.length === 0) return { error: 'notFound' };
  revalidateRumbo(locale, trip);
  return { ok: true };
}

const ticketTextInput = z.object({ tripId, text: z.string().min(10).max(20_000) });

/** A booking pasted as text: the flights it prints, with any connection estimated. */
export async function importTicketText(
  raw: z.input<typeof ticketTextInput>,
  locale: Locale = 'es',
): Promise<RecordActionResult & { readonly count?: number }> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const parsed = ticketTextInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  if (!(await ownsTrip(ctx, input.tripId))) return { error: 'notFound' };
  const { segments } = parseTicketText(input.text, todayIn('UTC'));
  if (segments.length === 0) return { error: 'ticketUnreadable' };
  const inserted = await queryAsUser(ctx.session, async (tx) => {
    const existing = await tx
      .select({ from: tripFlightSegments.fromIata, departs: tripFlightSegments.departsLocal })
      .from(tripFlightSegments)
      .where(eq(tripFlightSegments.tripId, input.tripId));
    const seen = new Set(existing.map((e) => `${e.from}@${e.departs.slice(0, 16)}`));
    let n = 0;
    for (const [position, s] of segments.entries()) {
      const departs = `${s.departs.date} ${s.departs.time}:00`;
      if (seen.has(`${s.from}@${departs.slice(0, 16)}`)) continue;
      await tx.insert(tripFlightSegments).values({
        householdId: ctx.householdId,
        tripId: input.tripId,
        position,
        fromIata: s.from,
        toIata: s.to,
        departsLocal: departs,
        departsTz: s.departs.timeZone,
        departsCertainty: s.departsCertainty,
        arrivesLocal: `${s.arrives.date} ${s.arrives.time}:00`,
        arrivesTz: s.arrives.timeZone,
        arrivesCertainty: s.arrivesCertainty,
      });
      n += 1;
    }
    return n;
  });
  revalidateRumbo(locale, input.tripId);
  return { ok: true, count: inserted };
}

// ---------------------------------------------------------------------------
// Stops the person adds to a day
// ---------------------------------------------------------------------------

const extraStopInput = z.object({
  tripId,
  date: plainDateString,
  place: z.union([
    placeInput,
    z.object({
      googlePlaceId: z.string().min(1).max(300),
      name: z.string().trim().min(1).max(160),
      country: country.nullish(),
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
    }),
  ]),
  minutes: z.number().int().min(0).max(720).nullish(),
});

/**
 * A place added to a day: Rumbo slots it into that day's drive where it costs
 * the least detour (or makes a round trip on a day without driving), asks the
 * router again and recomputes the hours and the daylight.
 */
export async function addExtraStop(
  raw: z.input<typeof extraStopInput>,
  locale: Locale = 'es',
): Promise<RecordActionResult & { readonly pending?: number }> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  const parsed = extraStopInput.safeParse(raw);
  if (!parsed.success) return { error: 'invalid' };
  const input = parsed.data;
  let result;
  try {
    result = await queryAsUser(ctx.session, async (tx) => {
      const anchors = await tx
        .select({ kind: tripAnchors.kind, from: tripAnchors.fromDate })
        .from(tripAnchors)
        .where(
          and(eq(tripAnchors.tripId, input.tripId), eq(tripAnchors.householdId, ctx.householdId)),
        );
      const pickup = anchors.find((a) => a.kind === 'car_pickup')?.from;
      const dropoff = anchors.find((a) => a.kind === 'car_return')?.from;
      if (!pickup || !dropoff || input.date < pickup || input.date > dropoff)
        return { error: 'noCarThatDay' } as const;

      let placeId: string | null;
      const p = input.place;
      if ('googlePlaceId' in p) {
        const [existing] = await tx
          .select({ id: tripPlaces.id })
          .from(tripPlaces)
          .where(
            and(eq(tripPlaces.tripId, input.tripId), eq(tripPlaces.googlePlaceId, p.googlePlaceId)),
          )
          .limit(1);
        if (existing) {
          placeId = existing.id;
        } else {
          const countryCode = p.country ?? 'ZZ';
          const [row] = await tx
            .insert(tripPlaces)
            .values({
              householdId: ctx.householdId,
              tripId: input.tripId,
              googlePlaceId: p.googlePlaceId,
              name: p.name,
              countryCode: /^[A-Z]{2}$/.test(countryCode) ? countryCode : 'ZZ',
              lat: p.lat.toFixed(6),
              lon: p.lon.toFixed(6),
              timeZone: SINGLE_ZONE[countryCode] ?? 'UTC',
              kind: 'poi',
              certainty: 'estimated',
              sourceName: 'Google Maps',
              sourceUrl: 'https://www.google.com/maps',
              checkedOn: todayIn('UTC'),
            })
            .returning({ id: tripPlaces.id });
          placeId = row?.id ?? null;
        }
      } else {
        placeId = await placeIdFor(tx, ctx.householdId, input.tripId, p);
      }
      if (!placeId) return { error: 'placeUnknown' } as const;
      await tx
        .insert(tripExtraStops)
        .values({
          householdId: ctx.householdId,
          tripId: input.tripId,
          stopDate: input.date,
          placeId,
          minutes: input.minutes ?? null,
          createdBy: ctx.session.user.id,
        })
        .onConflictDoUpdate({
          target: [tripExtraStops.tripId, tripExtraStops.stopDate, tripExtraStops.placeId],
          set: { minutes: input.minutes ?? null },
        });
      return composeAndStore(tx, ctx.householdId, input.tripId, { replaceManualLegs: false });
    });
  } catch {
    return { error: 'saveFailed' };
  }
  if ('error' in result) return { error: result.error };
  if (result.pending > 0) await startRouting(ctx, input.tripId);
  revalidateRumbo(locale, input.tripId);
  return { ok: true, pending: result.pending };
}

export async function removeExtraStop(
  trip: string,
  stopId: string,
  locale: Locale = 'es',
): Promise<RecordActionResult> {
  const ctx = await context();
  if ('error' in ctx) return { error: ctx.error };
  if (!tripId.safeParse(trip).success || !z.uuid().safeParse(stopId).success)
    return { error: 'invalid' };
  let result;
  try {
    result = await queryAsUser(ctx.session, async (tx) => {
      const removed = await tx
        .delete(tripExtraStops)
        .where(
          and(
            eq(tripExtraStops.id, stopId),
            eq(tripExtraStops.tripId, trip),
            eq(tripExtraStops.householdId, ctx.householdId),
          ),
        )
        .returning({ id: tripExtraStops.id });
      if (removed.length === 0) return { error: 'notFound' } as const;
      return composeAndStore(tx, ctx.householdId, trip, { replaceManualLegs: false });
    });
  } catch {
    return { error: 'saveFailed' };
  }
  if ('error' in result) return { error: result.error };
  if (result.pending > 0) await startRouting(ctx, trip);
  revalidateRumbo(locale, trip);
  return { ok: true };
}
