import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

/**
 * Viajes: el aislamiento entre hogares y las reglas que la base defiende sola.
 *
 * Un viaje lleva itinerarios, nombres, reservas y gastos. Que otro hogar pueda
 * leerlo —o colgarle un gasto suyo— es el fallo que no se arregla después.
 * Cada caso afirma un límite, no un camino feliz.
 */

const connectionUrl = process.env['TEST_DATABASE_URL'];
const describeWithDatabase = connectionUrl ? describe : describe.skip;

const RIVER = '44444444-4444-4444-8444-444444444444';
const SAGE = '55555555-5555-4555-8555-555555555555';
const QUINN = '66666666-6666-4666-8666-666666666666';

const TRIP_TABLES = [
  'trips',
  'trip_legs',
  'trip_travelers',
  'trip_scenarios',
  'trip_overrides',
  'trip_bookings',
  'trip_reserve_releases',
  'trip_checklist_items',
] as const;

describeWithDatabase('trips: row-level security and invariants', () => {
  const sql = postgres(connectionUrl ?? '', { prepare: false, max: 4, onnotice: () => undefined });

  let riverHousehold = '';
  let quinnHousehold = '';
  let trip = '';
  let leg = '';
  let quinnAccount = '';
  let riverAccount = '';

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
    await sql`delete from auth.users where id in (${RIVER}, ${SAGE}, ${QUINN})`;
    await sql`
      insert into auth.users (id, email) values
        (${RIVER}, 'river@example.test'), (${SAGE}, 'sage@example.test'), (${QUINN}, 'quinn@example.test')
    `;
    await sql`
      insert into app.profiles (id, email, display_name) values
        (${RIVER}, 'river@example.test', 'River'),
        (${SAGE}, 'sage@example.test', 'Sage'),
        (${QUINN}, 'quinn@example.test', 'Quinn')
    `;

    riverHousehold = await household(RIVER, 'River y Sage');
    quinnHousehold = await household(QUINN, 'Quinn');

    await asUser(RIVER, async (tx) => {
      await tx`
        insert into app.household_members (household_id, user_id, role, status)
        values (${riverHousehold}, ${SAGE}, 'partner', 'active')
      `;
      const [t] = await tx<{ id: string }[]>`
        insert into app.trips (household_id, name, start_date, end_date, base_currency, total_budget)
        values (${riverHousehold}, 'Madrid en familia', '2027-07-01', '2027-07-07', 'USD', 3000)
        returning id
      `;
      trip = t?.id ?? '';
      const [l] = await tx<{ id: string }[]>`
        insert into app.trip_legs (household_id, trip_id, city, country_code, arrival_date, departure_date, local_currency, timezone)
        values (${riverHousehold}, ${trip}, 'Madrid', 'ES', '2027-07-01', '2027-07-07', 'EUR', 'Europe/Madrid')
        returning id
      `;
      leg = l?.id ?? '';
      await tx`
        insert into app.trip_travelers (household_id, trip_id, display_name, traveler_type, weight)
        values (${riverHousehold}, ${trip}, 'River', 'adult', 1)
      `;
      await tx`
        insert into app.trip_bookings (household_id, trip_id, leg_id, booking_type, amount, currency, amount_base, payment_status, paid_amount)
        values (${riverHousehold}, ${trip}, ${leg}, 'lodging', 700, 'USD', 700, 'paid', 700)
      `;
      const [a] = await tx<{ id: string }[]>`
        insert into app.accounts (household_id, name, account_type) values (${riverHousehold}, 'Banco', 'checking')
        returning id
      `;
      riverAccount = a?.id ?? '';
    });

    quinnAccount = await asUser(QUINN, async (tx) => {
      const [a] = await tx<{ id: string }[]>`
        insert into app.accounts (household_id, name, account_type) values (${quinnHousehold}, 'Banco', 'checking')
        returning id
      `;
      return a?.id ?? '';
    });
  });

  afterAll(async () => {
    await sql`delete from app.households where id in (${riverHousehold}, ${quinnHousehold})`;
    await sql`delete from auth.users where id in (${RIVER}, ${SAGE}, ${QUINN})`;
    await sql.end();
  });

  it('shows the trip to every member of its household', async () => {
    const rows = await asUser(SAGE, (tx) => tx<{ id: string }[]>`select id from app.trips`);
    expect(rows.map((row) => row.id)).toEqual([trip]);
  });

  it('hides every trip table from another household, even by id', async () => {
    for (const table of TRIP_TABLES) {
      const rows = await asUser(QUINN, (tx) =>
        tx.unsafe<{ n: string }[]>(`select count(*)::text as n from app.${table}`),
      );
      expect({ table, n: rows[0]?.n }).toEqual({ table, n: '0' });
    }
    const direct = await asUser(QUINN, (tx) => tx`select id from app.trips where id = ${trip}`);
    expect(direct).toEqual([]);
  });

  it('refuses to let another household change or delete a trip', async () => {
    const updated = await asUser(
      QUINN,
      (tx) => tx`update app.trips set name = 'mío' where id = ${trip} returning id`,
    );
    const deleted = await asUser(
      QUINN,
      (tx) => tx`delete from app.trips where id = ${trip} returning id`,
    );
    expect(updated).toEqual([]);
    expect(deleted).toEqual([]);
  });

  it('refuses a leg hung from another household’s trip', async () => {
    // With its own household id: the composite key does not match.
    await expect(
      asUser(
        QUINN,
        (tx) => tx`
        insert into app.trip_legs (household_id, trip_id, city, arrival_date, departure_date, local_currency)
        values (${quinnHousehold}, ${trip}, 'París', '2027-07-02', '2027-07-03', 'EUR')
      `,
      ),
    ).rejects.toThrow();
    // With the victim's household id: the policy's check refuses it.
    await expect(
      asUser(
        QUINN,
        (tx) => tx`
        insert into app.trip_legs (household_id, trip_id, city, arrival_date, departure_date, local_currency)
        values (${riverHousehold}, ${trip}, 'París', '2027-07-02', '2027-07-03', 'EUR')
      `,
      ),
    ).rejects.toThrow();
  });

  it('refuses a transaction that points at another household’s trip', async () => {
    await expect(
      asUser(
        QUINN,
        (tx) => tx`
        insert into app.transactions (household_id, account_id, transaction_date, amount, currency, direction,
          description_original, description_normalized, fingerprint, trip_id)
        values (${quinnHousehold}, ${quinnAccount}, '2027-07-02', -10, 'USD', 'outflow', 'x', 'x', 'fp-q', ${trip})
      `,
      ),
    ).rejects.toThrow(/own household/);
  });

  it('keeps legs inside the trip and lets them share only the transition day', async () => {
    await expect(
      asUser(
        RIVER,
        (tx) => tx`
        insert into app.trip_legs (household_id, trip_id, city, arrival_date, departure_date, local_currency)
        values (${riverHousehold}, ${trip}, 'Lisboa', '2027-07-06', '2027-07-09', 'EUR')
      `,
      ),
    ).rejects.toThrow(/within its trip/);

    await expect(
      asUser(
        RIVER,
        (tx) => tx`
        insert into app.trip_legs (household_id, trip_id, city, arrival_date, departure_date, local_currency)
        values (${riverHousehold}, ${trip}, 'Toledo', '2027-07-03', '2027-07-05', 'EUR')
      `,
      ),
    ).rejects.toThrow(/transition day/);

    // Shrinking Madrid and adding Paris on the transition day is a valid pair.
    await asUser(RIVER, async (tx) => {
      await tx`update app.trip_legs set departure_date = '2027-07-04' where id = ${leg}`;
      await tx`
        insert into app.trip_legs (household_id, trip_id, city, arrival_date, departure_date, local_currency, position)
        values (${riverHousehold}, ${trip}, 'París', '2027-07-04', '2027-07-07', 'EUR', 1)
      `;
    });
    const legs = await asUser(
      RIVER,
      (tx) =>
        tx<
          { city: string }[]
        >`select city from app.trip_legs where trip_id = ${trip} order by position`,
    );
    expect(legs.map((row) => row.city)).toEqual(['Madrid', 'París']);
  });

  it('stores a foreign amount only with its currency, rate, date and source', async () => {
    await expect(
      asUser(
        RIVER,
        (tx) => tx`
        insert into app.transactions (household_id, account_id, transaction_date, amount, currency, direction,
          description_original, description_normalized, fingerprint, trip_id, original_amount)
        values (${riverHousehold}, ${riverAccount}, '2027-07-02', -10, 'USD', 'outflow', 'x', 'x', 'fp-a', ${trip}, -9.2)
      `,
      ),
    ).rejects.toThrow(/original_currency_complete/);
  });

  it('files the same offline expense once, whatever the retries', async () => {
    const ref = '77777777-7777-4777-8777-777777777777';
    const insert = () =>
      asUser(
        RIVER,
        (tx) => tx`
        insert into app.transactions (household_id, account_id, transaction_date, amount, currency, direction,
          description_original, description_normalized, fingerprint, trip_id, trip_day, trip_category, client_ref)
        values (${riverHousehold}, ${riverAccount}, '2027-07-02', -12.5, 'USD', 'outflow', 'Café', 'cafe', 'fp-c',
          ${trip}, '2027-07-02', 'food', ${ref})
      `,
      );
    await insert();
    await expect(insert()).rejects.toThrow(/client_ref/);
  });

  it('refuses trip details on a transaction that has no trip', async () => {
    await expect(
      asUser(
        RIVER,
        (tx) => tx`
        insert into app.transactions (household_id, account_id, transaction_date, amount, currency, direction,
          description_original, description_normalized, fingerprint, trip_category)
        values (${riverHousehold}, ${riverAccount}, '2027-07-02', -10, 'USD', 'outflow', 'x', 'x', 'fp-b', 'food')
      `,
      ),
    ).rejects.toThrow(/trip_parts_need_trip/);
  });

  it('seeds the travel subcategories into every household', async () => {
    const rows = await asUser(
      RIVER,
      (tx) => tx<{ slug: string }[]>`
      select c.template_slug as slug from app.categories c
       where c.household_id = ${riverHousehold} and c.template_slug like 'travel-%'
    `,
    );
    // A household created after the migration gets them from the templates.
    expect(rows.length).toBe(10);
  });
});
