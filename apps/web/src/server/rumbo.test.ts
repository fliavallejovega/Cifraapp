import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { closeConnections, getDb, withUserContext } from '@app/database';
import { tripLegs, trips, tripTodos } from '@app/database/schema';
import { toPlainDate } from '@app/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./jobs', () => ({ registerJobHandler: () => undefined }));
vi.mock('./routing/openrouteservice', () => ({
  ORS_SOURCE: { name: 'openrouteservice', url: 'https://openrouteservice.org' },
  routeDrive: () => Promise.resolve({ ok: false, failure: 'not_configured' }),
  routingConfigured: () => false,
}));

const { buildView, composeAndStore, readRumboRows } = await import('./rumbo');

/**
 * Rumbo on a real Postgres: the reference trip, seeded as a person would
 * enter it, composes into the itinerary the acceptance criteria describe —
 * from the database, through the server, without editing anything by hand.
 * Skipped without `TEST_DATABASE_URL` (see `pnpm db:local`).
 */

function testDatabaseUrl(): string | undefined {
  if (process.env['TEST_DATABASE_URL']) return process.env['TEST_DATABASE_URL'];
  try {
    const env = readFileSync(resolve(__dirname, '../../../../.env.local'), 'utf8');
    return /^TEST_DATABASE_URL=(.+)$/m.exec(env)?.[1]?.replace(/^["']|["']$/g, '');
  } catch {
    return undefined;
  }
}

const url = testDatabaseUrl();
const describeWithDatabase = url ? describe : describe.skip;
const USER = '99999999-9999-4999-8999-999999999999';
const REPO = resolve(__dirname, '../../../..');

describeWithDatabase('rumbo: the reference trip from the database', () => {
  const db = getDb(url ?? '');
  const ctx = { userId: USER, claims: { sub: USER, role: 'authenticated' } };
  let householdId = '';
  let tripId = '';

  const asUser = <T>(work: Parameters<typeof withUserContext<T>>[2]) =>
    withUserContext(db, ctx, work);

  beforeAll(async () => {
    await db.execute(sql`delete from auth.users where id = ${USER}`);
    await db.execute(
      sql`insert into auth.users (id, email) values (${USER}, 'rumbo@example.test')`,
    );
    await db.execute(
      sql`insert into app.profiles (id, email, display_name) values (${USER}, 'rumbo@example.test', 'Rumbo')`,
    );
    householdId = await asUser(async (tx) => {
      const rows = await tx.execute<{ id: string }>(
        sql`select app.create_household('Rumbo', 'USD', 'America/Panama') as id`,
      );
      return rows[0]?.id ?? '';
    });
    execFileSync('pnpm', ['--filter', '@app/database', 'db:seed:rumbo'], {
      cwd: REPO,
      env: {
        ...process.env,
        SEED_HOUSEHOLD_ID: householdId,
        DIRECT_URL: url,
        DATABASE_URL: url,
        APP_ENV: 'development',
      },
      stdio: 'pipe',
    });
    const [trip] = await asUser((tx) =>
      tx.select({ id: trips.id }).from(trips).where(eq(trips.householdId, householdId)),
    );
    tripId = trip?.id ?? '';
  }, 120_000);

  afterAll(async () => {
    await db.execute(sql`delete from app.households where id = ${householdId}`);
    await db.execute(sql`delete from auth.users where id = ${USER}`);
    await closeConnections();
  });

  it('composes 19 days, 17 nights and 10 driving days, routed from the cache', async () => {
    const result = await asUser((tx) =>
      composeAndStore(tx, householdId, tripId, { replaceManualLegs: false }),
    );
    expect(result).toEqual({ pending: 0, notices: [] });
    const rows = await asUser((tx) => readRumboRows(tx, householdId, tripId));
    if (!rows) throw new Error('no rows');
    const view = buildView(rows, toPlainDate('2026-10-02'));
    expect(view.itinerary?.totals.days).toBe(19);
    expect(view.itinerary?.totals.lodgingNights).toBe(17);
    expect(view.itinerary?.totals.drivingDays).toBe(10);
    expect(view.routing.pending).toBe(0);
    expect(view.plan?.sacrifices.map((s) => s.placeId)).toEqual(
      expect.arrayContaining(['verona', 'como', 'maloja', 'julier', 'arosa']),
    );
    expect(view.wishCostMinutes).not.toBeNull();
  });

  it('stores the stays as legs the budget sees, Arosa hosted', async () => {
    const legs = await asUser((tx) =>
      tx.select().from(tripLegs).where(eq(tripLegs.tripId, tripId)).orderBy(tripLegs.arrivalDate),
    );
    expect(legs.map((l) => `${l.arrivalDate.slice(8)}:${l.city}`)).toEqual([
      '10:Estambul (Sultanahmet)',
      '11:Venecia',
      "12:Cortina d'Ampezzo",
      '13:Canazei (Val di Fassa)',
      '14:Bolzano',
      '15:Arosa',
      '17:Hinterzarten (Selva Negra)',
      '20:Rüdesheim am Rhein',
      '21:Colonia',
      '22:Hamburgo',
      '23:Copenhague',
      '26:Estambul (Sultanahmet)',
    ]);
    const arosa = legs.find((l) => l.city === 'Arosa');
    expect(arosa?.hosted).toBe(true);
    expect(arosa?.lodgingMode).toBe('none');
    expect(arosa?.localCurrency).toBe('CHF');
  });

  it('reads the entry rules: no visa anywhere, 16 of 90 Schengen days', async () => {
    const rows = await asUser((tx) => readRumboRows(tx, householdId, tripId));
    if (!rows) throw new Error('no rows');
    const view = buildView(rows, toPlainDate('2026-10-02'));
    expect(view.entry.length).toBe(4);
    expect(view.entry.every((v) => v.status === 'visa_free' && v.certainty === 'confirmed')).toBe(
      true,
    );
    expect(view.entry.filter((v) => v.zone === 'schengen').map((v) => v.daysUsed)).toEqual([
      16, 16,
    ]);
  });

  it('keeps a bought purchase across a new composition', async () => {
    await asUser((tx) =>
      tx.insert(tripTodos).values({
        householdId,
        tripId,
        todoKey: 'charge:ch-vignette-year',
        kind: 'vignette',
        status: 'bought',
        confirmationCode: 'EV-123',
      }),
    );
    await asUser((tx) => composeAndStore(tx, householdId, tripId, { replaceManualLegs: false }));
    const rows = await asUser((tx) => readRumboRows(tx, householdId, tripId));
    if (!rows) throw new Error('no rows');
    const view = buildView(rows, toPlainDate('2026-10-02'));
    const swiss = view.todos.find((t) => t.key === 'charge:ch-vignette-year');
    expect(swiss?.status).toBe('bought');
    expect(swiss?.confirmationCode).toBe('EV-123');
    expect(view.todos.map((t) => t.key)).toEqual(
      expect.arrayContaining([
        'charge:at-vignette-10d',
        'charge:scandlines-puttgarden-rodby',
        'event:ravenna:2026-12-19',
      ]),
    );
    expect(
      view.todos.some((t) => t.kind === 'private_transfer' && t.params['date'] === '2026-12-27'),
    ).toBe(true);
  });
});
