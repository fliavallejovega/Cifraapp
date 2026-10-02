/* eslint-disable no-console -- A CLI script's output is its interface. */
import './load-env.js';

import { getServerEnv } from '@app/validation/env';
import { sql } from 'drizzle-orm';

import { closeConnections, getAdminDb } from '../src/client.js';

/**
 * Three trips to develop Viajes against, in one household:
 *
 * - **Ciudad de México**, in two and a half months — planning, nothing spent.
 * - **Madrid y Lisboa**, happening now — two legs in euros, spending on the
 *   days already lived, so «Hoy pueden gastar» has something to say.
 * - **Bogotá**, over ten days ago and not closed — so the report and the
 *   close panel have a real trip to work on.
 *
 * Their spending comes out of an account the seed creates, and that account's
 * balance moves with every movement, as the product moves it. Running it
 * again removes the previous seed (trips, movements and account) first, so it
 * is idempotent. Refused on production.
 *
 *     SEED_HOUSEHOLD_ID=<uuid> pnpm db:seed:trips
 */

const PREFIX = 'Semilla · ';
const ACCOUNT = 'Cuenta semilla de viajes';
const TODAY = new Date().toISOString().slice(0, 10);

async function seedTrips(): Promise<void> {
  const env = getServerEnv();
  if (env.APP_ENV === 'production') {
    console.error('Refusing to seed demo trips into production.');
    process.exit(1);
  }
  const household = process.env['SEED_HOUSEHOLD_ID'];
  if (!household || !/^[0-9a-f-]{36}$/.test(household)) {
    console.error('Set SEED_HOUSEHOLD_ID to the household that gets the trips.');
    process.exit(1);
  }
  const db = getAdminDb(env.DIRECT_URL);

  await db.transaction(async (tx) => {
    // Undo a previous run: movements first, then trips, then the account.
    await tx.execute(sql`
      delete from app.transactions
       where household_id = ${household}
         and trip_id in (select id from app.trips where household_id = ${household} and name like ${`${PREFIX}%`})`);
    await tx.execute(
      sql`delete from app.trips where household_id = ${household} and name like ${`${PREFIX}%`}`,
    );
    await tx.execute(
      sql`delete from app.accounts where household_id = ${household} and name = ${ACCOUNT}`,
    );

    const [owner] = await tx.execute<{ user_id: string }>(sql`
        select user_id from app.household_members
         where household_id = ${household} and status = 'active' order by created_at limit 1`);
    if (!owner) throw new Error('The household has no active member.');

    const [account] = await tx.execute<{ id: string }>(sql`
        insert into app.accounts (household_id, name, account_type, currency, current_balance)
        values (${household}, ${ACCOUNT}, 'checking', 'USD', 8000)
        returning id`);
    if (!account) throw new Error('Could not create the seed account.');

    const trip = async (values: {
      name: string;
      start: number;
      end: number;
      budget: string;
      status: string;
      fx: Record<string, { rate: string; date: string }>;
      legs: {
        city: string;
        country: string;
        currency: string;
        zone: string;
        from: number;
        to: number;
      }[];
      travelers: { name: string; type: 'adult' | 'child' }[];
      spent: { day: number; leg: number; category: string; amount: string; who: number }[];
    }) => {
      const [row] = await tx.execute<{ id: string }>(sql`
          insert into app.trips (household_id, created_by, name, start_date, end_date, base_currency,
                                 total_budget, planning_fx, status, funding_account_id)
          values (${household}, ${owner.user_id}, ${PREFIX + values.name},
                  current_date + ${values.start}::int, current_date + ${values.end}::int, 'USD',
                  ${values.budget}, ${JSON.stringify(values.fx)}::jsonb, ${values.status}::app.trip_status, ${account.id})
          returning id`);
      if (!row) throw new Error('Could not create a seed trip.');
      const legIds: string[] = [];
      for (const [position, leg] of values.legs.entries()) {
        const [inserted] = await tx.execute<{ id: string }>(sql`
            insert into app.trip_legs (household_id, trip_id, position, city, country_code, arrival_date,
                                       departure_date, local_currency, lodging_mode, timezone)
            values (${household}, ${row.id}, ${position}, ${leg.city}, ${leg.country},
                    current_date + ${leg.from}::int, current_date + ${leg.to}::int, ${leg.currency},
                    'undecided', ${leg.zone})
            returning id`);
        if (inserted) legIds.push(inserted.id);
      }
      const travelerIds: string[] = [];
      for (const traveler of values.travelers) {
        const [inserted] = await tx.execute<{ id: string }>(sql`
            insert into app.trip_travelers (household_id, trip_id, display_name, traveler_type, weight)
            values (${household}, ${row.id}, ${traveler.name}, ${traveler.type}::app.trip_traveler_type,
                    ${traveler.type === 'child' ? '0.6' : '1'})
            returning id`);
        if (inserted) travelerIds.push(inserted.id);
      }
      for (const [i, s] of values.spent.entries()) {
        await tx.execute(sql`
          insert into app.transactions (household_id, account_id, owner_id, transaction_date, amount, currency,
                                        direction, description_original, description_normalized, status, source,
                                        fingerprint, trip_id, trip_leg_id, trip_category, trip_day, paid_by_traveler_id)
          values (${household}, ${account.id}, ${owner.user_id}, current_date + ${s.day}::int, -${s.amount}::numeric,
                  'USD', 'outflow', ${`${PREFIX}${s.category}`}, ${`semilla ${s.category}`}, 'posted', 'user',
                  ${`seed-${row.id}-${String(i)}`}, ${row.id}, ${legIds[s.leg] ?? null}, ${s.category},
                  current_date + ${s.day}::int, ${travelerIds[s.who] ?? null})`);
        await tx.execute(sql`
          update app.accounts set current_balance = current_balance - ${s.amount}::numeric where id = ${account.id}`);
      }
    };

    await trip({
      name: 'Ciudad de México',
      start: 75,
      end: 81,
      budget: '2400',
      status: 'saving',
      fx: { MXN: { rate: '18.40', date: TODAY } },
      legs: [
        {
          city: 'Ciudad de México',
          country: 'MX',
          currency: 'MXN',
          zone: 'America/Mexico_City',
          from: 75,
          to: 81,
        },
      ],
      travelers: [
        { name: 'Adulto 1', type: 'adult' },
        { name: 'Adulto 2', type: 'adult' },
      ],
      spent: [],
    });

    await trip({
      name: 'Madrid y Lisboa',
      start: -2,
      end: 4,
      budget: '5200',
      status: 'in_progress',
      fx: { EUR: { rate: '0.92', date: TODAY } },
      legs: [
        { city: 'Madrid', country: 'ES', currency: 'EUR', zone: 'Europe/Madrid', from: -2, to: 1 },
        { city: 'Lisboa', country: 'PT', currency: 'EUR', zone: 'Europe/Lisbon', from: 1, to: 4 },
      ],
      travelers: [
        { name: 'Adulto 1', type: 'adult' },
        { name: 'Adulto 2', type: 'adult' },
        { name: 'Niño 1', type: 'child' },
      ],
      spent: [
        { day: -2, leg: 0, category: 'lodging', amount: '185.00', who: 0 },
        { day: -2, leg: 0, category: 'food', amount: '72.40', who: 1 },
        { day: -1, leg: 0, category: 'lodging', amount: '185.00', who: 0 },
        { day: -1, leg: 0, category: 'food', amount: '118.90', who: 1 },
        { day: -1, leg: 0, category: 'activities', amount: '64.00', who: 0 },
        { day: 0, leg: 0, category: 'local_transport', amount: '21.60', who: 1 },
      ],
    });

    await trip({
      name: 'Bogotá',
      start: -16,
      end: -11,
      budget: '1800',
      status: 'in_progress',
      fx: { COP: { rate: '4100', date: TODAY } },
      legs: [
        {
          city: 'Bogotá',
          country: 'CO',
          currency: 'COP',
          zone: 'America/Bogota',
          from: -16,
          to: -11,
        },
      ],
      travelers: [
        { name: 'Adulto 1', type: 'adult' },
        { name: 'Adulto 2', type: 'adult' },
      ],
      spent: [
        { day: -16, leg: 0, category: 'lodging', amount: '96.00', who: 0 },
        { day: -16, leg: 0, category: 'food', amount: '41.30', who: 1 },
        { day: -15, leg: 0, category: 'lodging', amount: '96.00', who: 0 },
        { day: -15, leg: 0, category: 'activities', amount: '58.00', who: 0 },
        { day: -14, leg: 0, category: 'lodging', amount: '96.00', who: 0 },
        { day: -14, leg: 0, category: 'food', amount: '63.75', who: 1 },
        { day: -13, leg: 0, category: 'lodging', amount: '96.00', who: 0 },
        { day: -13, leg: 0, category: 'shopping', amount: '120.00', who: 1 },
        { day: -12, leg: 0, category: 'lodging', amount: '96.00', who: 0 },
        { day: -12, leg: 0, category: 'food', amount: '52.10', who: 0 },
      ],
    });
  });

  console.log(
    'Seeded 3 trips: Ciudad de México (planning), Madrid y Lisboa (now), Bogotá (to close).',
  );
}

seedTrips()
  .then(() => closeConnections())
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('Trip seed failed:', error);
    process.exit(1);
  });
