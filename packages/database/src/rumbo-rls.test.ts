import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

/**
 * Rumbo: lugares, anclas, vuelos, rutas, hospedaje y compras de un viaje son
 * de su hogar y de nadie más. Cada caso afirma un límite.
 */

const connectionUrl = process.env['TEST_DATABASE_URL'];
const describeWithDatabase = connectionUrl ? describe : describe.skip;

const ALBA = 'abababab-abab-4bab-8bab-abababababab';
const BRUNO = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';

const RUMBO_TABLES = [
  'trip_places',
  'trip_anchors',
  'trip_wishes',
  'trip_flight_segments',
  'trip_drives',
  'trip_lodging_options',
  'trip_todos',
  'trip_shares',
  'trip_extra_stops',
] as const;

describeWithDatabase('rumbo: row-level security and invariants', () => {
  const sql = postgres(connectionUrl ?? '', { prepare: false, max: 4, onnotice: () => undefined });

  let albaHousehold = '';
  let brunoHousehold = '';
  let trip = '';
  let place = '';
  let leg = '';

  function asUser<T>(
    userId: string,
    work: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    return sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({
        sub: userId,
        role: 'authenticated',
      })}, true)`;
      await tx`select set_config('role', 'authenticated', true)`;
      return work(tx);
    }) as Promise<T>;
  }

  async function household(userId: string, name: string): Promise<string> {
    return asUser(userId, async (tx) => {
      const rows = await tx<{ create_household: string }[]>`
        select app.create_household(${name}, 'USD', 'America/Panama')
      `;
      return rows[0]?.create_household ?? '';
    });
  }

  beforeAll(async () => {
    await sql`delete from auth.users where id in (${ALBA}, ${BRUNO}) or email in ('alba@example.test', 'bruno@example.test')`;
    await sql`insert into auth.users (id, email) values (${ALBA}, 'alba@example.test'), (${BRUNO}, 'bruno@example.test')`;
    await sql`
      insert into app.profiles (id, email, display_name) values
        (${ALBA}, 'alba@example.test', 'Alba'), (${BRUNO}, 'bruno@example.test', 'Bruno')
    `;
    albaHousehold = await household(ALBA, 'Alba');
    brunoHousehold = await household(BRUNO, 'Bruno');

    await asUser(ALBA, async (tx) => {
      const [t] = await tx<{ id: string }[]>`
        insert into app.trips (household_id, name, start_date, end_date, base_currency)
        values (${albaHousehold}, 'Venecia a Copenhague', '2026-12-09', '2026-12-27', 'USD')
        returning id
      `;
      trip = t?.id ?? '';
      const [p] = await tx<{ id: string }[]>`
        insert into app.trip_places (household_id, trip_id, catalog_id, name, country_code, lat, lon, time_zone, kind)
        values (${albaHousehold}, ${trip}, 'arosa', 'Arosa', 'CH', 46.785385, 9.678935, 'Europe/Zurich', 'town')
        returning id
      `;
      place = p?.id ?? '';
      const [l] = await tx<{ id: string }[]>`
        insert into app.trip_legs (household_id, trip_id, city, country_code, arrival_date, departure_date,
          local_currency, timezone, place_id, stay_origin, hosted)
        values (${albaHousehold}, ${trip}, 'Arosa', 'CH', '2026-12-15', '2026-12-17', 'CHF', 'Europe/Zurich',
          ${place}, 'anchor', true)
        returning id
      `;
      leg = l?.id ?? '';
      await tx`
        insert into app.trip_anchors (household_id, trip_id, kind, place_id, from_date, to_date, max_nights, hosted)
        values (${albaHousehold}, ${trip}, 'friends', ${place}, '2026-12-15', '2026-12-16', 3, true)
      `;
      await tx`
        insert into app.trip_wishes (household_id, trip_id, body, tags)
        values (${albaHousehold}, ${trip}, 'Mi esposa quiere ir a las Dolomitas', '{dolomitas}')
      `;
      await tx`
        insert into app.trip_flight_segments (household_id, trip_id, from_iata, to_iata, departs_local, departs_tz,
          departs_certainty, arrives_local, arrives_tz, arrives_certainty)
        values (${albaHousehold}, ${trip}, 'PTY', 'IST', '2026-12-09 22:00', 'America/Panama', 'confirmed',
          '2026-12-10 18:40', 'Europe/Istanbul', 'estimated')
      `;
      await tx`
        insert into app.trip_drives (household_id, trip_id, drive_date, purpose, points, mode, request_hash)
        values (${albaHousehold}, ${trip}, '2026-12-15', 'move', '{bolzano,arosa}', 'car', ${'a'.repeat(64)})
      `;
      await tx`
        insert into app.trip_lodging_options (household_id, trip_id, leg_id, provider, name, total_price, currency)
        values (${albaHousehold}, ${trip}, ${leg}, 'airbnb', 'Chalet', 420, 'USD')
      `;
      await tx`
        insert into app.trip_todos (household_id, trip_id, todo_key, kind, country_code)
        values (${albaHousehold}, ${trip}, 'charge:ch-vignette-year', 'vignette', 'CH')
      `;
      await tx`
        insert into app.trip_shares (household_id, trip_id, token_hash, hint)
        values (${albaHousehold}, ${trip}, ${'b'.repeat(64)}, 'abcd')
      `;
      await tx`
        insert into app.trip_extra_stops (household_id, trip_id, stop_date, place_id, minutes)
        values (${albaHousehold}, ${trip}, '2026-12-16', ${place}, 90)
      `;
    });
  });

  afterAll(async () => {
    await sql`delete from app.households where id in (${albaHousehold}, ${brunoHousehold})`;
    await sql`delete from auth.users where id in (${ALBA}, ${BRUNO})`;
    await sql.end();
  });

  it('shows every Rumbo table to its own household', async () => {
    for (const table of RUMBO_TABLES) {
      const rows = await asUser(ALBA, (tx) =>
        tx.unsafe<{ n: string }[]>(`select count(*)::text as n from app.${table}`),
      );
      expect({ table, n: rows[0]?.n }).toEqual({ table, n: '1' });
    }
  });

  it('hides every Rumbo table from another household', async () => {
    for (const table of RUMBO_TABLES) {
      const rows = await asUser(BRUNO, (tx) =>
        tx.unsafe<{ n: string }[]>(`select count(*)::text as n from app.${table}`),
      );
      expect({ table, n: rows[0]?.n }).toEqual({ table, n: '0' });
    }
  });

  it('refuses a place hung from another household’s trip', async () => {
    await expect(
      asUser(
        BRUNO,
        (tx) => tx`
        insert into app.trip_places (household_id, trip_id, name, country_code, lat, lon, time_zone, kind)
        values (${brunoHousehold}, ${trip}, 'Zúrich', 'CH', 47.37, 8.54, 'Europe/Zurich', 'city')
      `,
      ),
    ).rejects.toThrow();
  });

  it('refuses an anchor whose place belongs to another trip', async () => {
    const other = await asUser(ALBA, async (tx) => {
      const [t] = await tx<{ id: string }[]>`
        insert into app.trips (household_id, name, start_date, end_date, base_currency)
        values (${albaHousehold}, 'Otro', '2027-01-01', '2027-01-05', 'USD') returning id
      `;
      return t?.id ?? '';
    });
    await expect(
      asUser(
        ALBA,
        (tx) => tx`
        insert into app.trip_anchors (household_id, trip_id, kind, place_id, from_date, to_date)
        values (${albaHousehold}, ${other}, 'event', ${place}, '2027-01-02', '2027-01-02')
      `,
      ),
    ).rejects.toThrow();
  });

  it('keeps a lodging price and its currency together', async () => {
    await expect(
      asUser(ALBA, (tx) => tx`update app.trip_legs set my_lodging_price = 300 where id = ${leg}`),
    ).rejects.toThrow(/trip_legs_my_price_currency/);
    const ok = await asUser(
      ALBA,
      (tx) =>
        tx`update app.trip_legs set my_lodging_price = 300, my_lodging_currency = 'USD' where id = ${leg} returning id`,
    );
    expect(ok).toHaveLength(1);
  });

  it('lets anyone signed in read entry rules, and nobody write them from a request', async () => {
    const rows = await asUser(BRUNO, (tx) => tx`select count(*) from platform.entry_rules`);
    expect(rows).toHaveLength(1);
    await expect(
      asUser(
        BRUNO,
        (tx) => tx`
        insert into platform.entry_rules (passport_country, zone, status, source_name, source_url, checked_on)
        values ('CO', 'schengen', 'visa_required', 'x', 'https://x.test', '2026-10-02')
      `,
      ),
    ).rejects.toThrow();
  });
});
