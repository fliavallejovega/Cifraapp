/* eslint-disable no-console -- A CLI script's output is its interface. */
import './load-env.js';

import { createHash } from 'node:crypto';

import {
  PLACES,
  REAL_CASE_ANCHORS,
  REAL_CASE_ROUTES,
  REAL_CASE_TRAVELERS,
  REAL_CASE_WISHES,
  realCaseFlights,
} from '@app/itinerary';
import { getServerEnv } from '@app/validation/env';
import { sql } from 'drizzle-orm';

import { closeConnections, getAdminDb } from '../src/client.js';

/**
 * The trip Rumbo was born from, as a person would enter it — two travellers
 * with their passports, the Turkish Airlines ticket, friends in Arosa, the
 * Ravennaschlucht market, the car returned in Copenhagen, and the wish to see
 * the Dolomites — so the screens and the end-to-end test have it to work on.
 *
 * Nothing here is an itinerary: «Armar el viaje» composes it. The routes are
 * openrouteservice's answers of 2026-10-02, stored as the household's cache,
 * so composing does not call the router. Idempotent; refused on production.
 *
 *     SEED_HOUSEHOLD_ID=<uuid> pnpm db:seed:rumbo
 */

const NAME = 'Semilla · Venecia → Copenhague';

function hash(mode: string, points: readonly string[]): string {
  const coords = points.map((id) => {
    const p = PLACES.get(id);
    if (!p) throw new Error(`Unknown place ${id}`);
    return `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`;
  });
  return createHash('sha256')
    .update(`${mode}|${coords.join(';')}`)
    .digest('hex');
}

async function seedRumbo(): Promise<void> {
  const env = getServerEnv();
  if (env.APP_ENV === 'production') {
    console.error('Refusing to seed demo trips into production.');
    process.exit(1);
  }
  const household = process.env['SEED_HOUSEHOLD_ID'];
  if (!household || !/^[0-9a-f-]{36}$/.test(household)) {
    console.error('Set SEED_HOUSEHOLD_ID to the household that gets the trip.');
    process.exit(1);
  }
  const db = getAdminDb(env.DIRECT_URL);

  const tripId = await db.transaction(async (tx) => {
    await tx.execute(
      sql`delete from app.trips where household_id = ${household} and name = ${NAME}`,
    );
    const [owner] = await tx.execute<{ user_id: string }>(sql`
      select user_id from app.household_members
       where household_id = ${household} and status = 'active' order by created_at limit 1`);
    if (!owner) throw new Error('The household has no active member.');

    const [trip] = await tx.execute<{ id: string }>(sql`
      insert into app.trips (household_id, created_by, name, start_date, end_date, base_currency,
                             total_budget, status, rumbo_ground_mode, rumbo_lodging_cap, cover_emoji)
      values (${household}, ${owner.user_id}, ${NAME}, '2026-12-09', '2026-12-27', 'USD',
              9000, 'planning', 'car', 100, '🏔️')
      returning id`);
    if (!trip) throw new Error('Trip not created.');

    for (const t of REAL_CASE_TRAVELERS) {
      await tx.execute(sql`
        insert into app.trip_travelers (household_id, trip_id, display_name, nationalities, residence)
        values (${household}, ${trip.id}, ${t.name}, ${`{${t.nationalities.join(',')}}`}::char(2)[], ${t.residence ?? null})`);
    }

    for (const [position, f] of realCaseFlights().entries()) {
      await tx.execute(sql`
        insert into app.trip_flight_segments (household_id, trip_id, position, carrier, from_iata, to_iata,
          departs_local, departs_tz, departs_certainty, arrives_local, arrives_tz, arrives_certainty)
        values (${household}, ${trip.id}, ${position}, 'Turkish Airlines', ${f.from}, ${f.to},
          ${`${f.departs.date} ${f.departs.time}:00`}, ${f.departs.timeZone}, ${f.departsCertainty}::app.rumbo_certainty,
          ${`${f.arrives.date} ${f.arrives.time}:00`}, ${f.arrives.timeZone}, ${f.arrivesCertainty}::app.rumbo_certainty)`);
    }

    const placeRow = new Map<string, string>();
    const ensurePlace = async (id: string): Promise<string> => {
      const known = placeRow.get(id);
      if (known) return known;
      const p = PLACES.get(id);
      if (!p) throw new Error(`Unknown place ${id}`);
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into app.trip_places (household_id, trip_id, catalog_id, name, country_code, lat, lon, time_zone, kind, altitude_m)
        values (${household}, ${trip.id}, ${p.id}, ${p.name}, ${p.country}, ${p.lat}, ${p.lon}, ${p.timeZone}, ${p.kind}, ${p.altitudeM ?? null})
        returning id`);
      if (!row) throw new Error('Place not created.');
      placeRow.set(id, row.id);
      return row.id;
    };

    for (const a of REAL_CASE_ANCHORS) {
      const placeId = await ensurePlace(a.placeId);
      await tx.execute(sql`
        insert into app.trip_anchors (household_id, trip_id, kind, place_id, from_date, to_date, max_nights, hosted, paid, label)
        values (${household}, ${trip.id}, ${a.kind}::app.rumbo_anchor_kind, ${placeId}, ${a.from}, ${a.to},
                ${a.maxNights ?? null}, ${a.hosted ?? false}, ${a.paid ?? false}, ${a.label ?? null})`);
    }

    for (const [position, w] of REAL_CASE_WISHES.entries()) {
      await tx.execute(sql`
        insert into app.trip_wishes (household_id, trip_id, body, tags, position)
        values (${household}, ${trip.id}, ${w.text}, ${`{${w.tags.join(',')}}`}::text[], ${position})`);
    }

    // The router's answers, as cache: composing finds them by their points.
    for (const [position, r] of REAL_CASE_ROUTES.routes.entries()) {
      const mode = r.mode ?? 'car';
      const legs = r.segments.map((s, i) => ({
        from: r.via[i] ?? '',
        to: r.via[i + 1] ?? '',
        ...s,
      }));
      await tx.execute(sql`
        insert into app.trip_drives (household_id, trip_id, drive_date, position, purpose, points, mode, legs,
                                     geometry, request_hash, status, source_name, source_url, fetched_at)
        values (${household}, ${trip.id}, '2026-12-09', ${position}, 'move', ${`{${r.via.join(',')}}`}::text[],
                ${mode}, ${JSON.stringify(legs)}::jsonb, ${JSON.stringify(r.geometry)}::jsonb,
                ${hash(mode, r.via)}, 'routed', 'openrouteservice', 'https://openrouteservice.org',
                ${`${REAL_CASE_ROUTES.consultedAt}T12:00:00Z`})`);
    }
    return trip.id;
  });

  console.log(`Seeded «${NAME}»: ${tripId}`);
  await closeConnections();
}

void seedRumbo();
