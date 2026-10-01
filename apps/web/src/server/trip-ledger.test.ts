import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { closeConnections, getDb, withUserContext } from '@app/database';
import { goalCredits, goals, tripBookings, trips, transactions } from '@app/database/schema';
import { toPlainDate } from '@app/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { recordTripMovement, removeTripMovement, syncGoalCredit } = await import('./trip-ledger');

/**
 * The ledger side of Viajes against a real Postgres: an expense is a household
 * movement that moves its account, files under the travel subcategory, is
 * idempotent by client reference, and a paid booking credits the trip's goal.
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
const USER = '88888888-8888-4888-8888-888888888888';

describeWithDatabase('trip ledger', () => {
  const db = getDb(url ?? '');
  const ctx = { userId: USER, claims: { sub: USER, role: 'authenticated' } };
  let householdId = '';
  let accountId = '';
  let tripId = '';
  let goalId = '';

  beforeAll(async () => {
    await db.execute(sql`delete from auth.users where id = ${USER}`);
    await db.execute(
      sql`insert into auth.users (id, email) values (${USER}, 'ledger@example.test')`,
    );
    await db.execute(
      sql`insert into app.profiles (id, email, display_name) values (${USER}, 'ledger@example.test', 'Ledger')`,
    );
    await withUserContext(db, ctx, async (tx) => {
      const rows = await tx.execute<{ id: string }>(
        sql`select app.create_household('Ledger', 'USD', 'America/Panama') as id`,
      );
      householdId = rows[0]?.id ?? '';
      await tx.execute(sql`select app.seed_household_categories(${householdId})`);
      const [account] = await tx.execute<{ id: string }>(
        sql`insert into app.accounts (household_id, name, account_type, current_balance) values (${householdId}, 'Banco', 'checking', 1000) returning id`,
      );
      accountId = account?.id ?? '';
      const [goal] = await tx
        .insert(goals)
        .values({
          householdId,
          name: 'Madrid',
          targetAmount: '3000',
          currentAmount: '100',
          currency: 'USD',
        })
        .returning({ id: goals.id });
      goalId = goal?.id ?? '';
      const [trip] = await tx
        .insert(trips)
        .values({
          householdId,
          name: 'Madrid',
          startDate: '2027-07-01',
          endDate: '2027-07-07',
          baseCurrency: 'USD',
          totalBudget: '3000',
          goalId,
        })
        .returning({ id: trips.id });
      tripId = trip?.id ?? '';
    });
  });

  afterAll(async () => {
    await db.execute(sql`delete from app.households where id = ${householdId}`);
    await db.execute(sql`delete from auth.users where id = ${USER}`);
    await closeConnections();
  });

  it('records an expense as a movement in the travel subcategory and moves the account', async () => {
    const result = await withUserContext(db, ctx, (tx) =>
      recordTripMovement(tx, {
        householdId,
        userId: USER,
        accountId,
        currency: 'USD',
        date: toPlainDate('2027-07-02'),
        baseAmount: '23.10',
        description: 'Cena',
        tripId,
        category: 'food',
        tripDay: toPlainDate('2027-07-02'),
        original: {
          amount: '21.25',
          currency: 'EUR',
          rate: '0.92',
          rateDate: toPlainDate('2027-07-02'),
          source: 'ecb',
        },
        clientRef: '99999999-9999-4999-8999-999999999999',
      }),
    );
    expect(result?.created).toBe(true);

    const rows = await withUserContext(db, ctx, (tx) =>
      tx.execute<{ amount: string; original_amount: string; slug: string; balance: string }>(sql`
        select t.amount::text, t.original_amount::text, c.template_slug as slug, a.current_balance::text as balance
          from app.transactions t join app.categories c on c.id = t.category_id join app.accounts a on a.id = t.account_id
         where t.id = ${result?.id ?? ''}
      `),
    );
    expect(rows[0]).toEqual({
      amount: '-23.1000',
      original_amount: '-21.2500',
      slug: 'travel-food',
      balance: '976.9000',
    });
  });

  it('files the same client reference once', async () => {
    const again = await withUserContext(db, ctx, (tx) =>
      recordTripMovement(tx, {
        householdId,
        userId: USER,
        accountId,
        currency: 'USD',
        date: toPlainDate('2027-07-02'),
        baseAmount: '23.10',
        description: 'Cena',
        tripId,
        category: 'food',
        clientRef: '99999999-9999-4999-8999-999999999999',
      }),
    );
    expect(again?.created).toBe(false);
    const count = await withUserContext(db, ctx, (tx) =>
      tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.tripId, tripId)),
    );
    expect(count).toHaveLength(1);
  });

  it('gives the amount back to the account when the expense is removed', async () => {
    const [row] = await withUserContext(db, ctx, (tx) =>
      tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.tripId, tripId)),
    );
    await withUserContext(db, ctx, (tx) => removeTripMovement(tx, householdId, row?.id ?? ''));
    const [balance] = await withUserContext(db, ctx, (tx) =>
      tx.execute<{ b: string }>(
        sql`select current_balance::text as b from app.accounts where id = ${accountId}`,
      ),
    );
    expect(balance?.b).toBe('1000.0000');
  });

  it('credits a paid booking to the goal, follows changes, and takes it back', async () => {
    const [booking] = await withUserContext(db, ctx, (tx) =>
      tx
        .insert(tripBookings)
        .values({
          householdId,
          tripId,
          bookingType: 'flight',
          amount: '1200',
          currency: 'USD',
          amountBase: '1200',
          paymentStatus: 'paid',
          paidAmount: '1200',
        })
        .returning({ id: tripBookings.id }),
    );
    const bookingId = booking?.id ?? '';
    const current = async () =>
      (
        await withUserContext(db, ctx, (tx) =>
          tx.select({ c: goals.currentAmount }).from(goals).where(eq(goals.id, goalId)),
        )
      )[0]?.c;

    await withUserContext(db, ctx, (tx) =>
      syncGoalCredit(tx, { householdId, goalId, bookingId, paidBase: '1200.00', userId: USER }),
    );
    expect(await current()).toBe('1300.0000');

    await withUserContext(db, ctx, (tx) =>
      syncGoalCredit(tx, { householdId, goalId, bookingId, paidBase: '1000.00', userId: USER }),
    );
    expect(await current()).toBe('1100.0000');

    await withUserContext(db, ctx, (tx) =>
      syncGoalCredit(tx, { householdId, goalId: null, bookingId, paidBase: '0', userId: USER }),
    );
    expect(await current()).toBe('100.0000');
    const credits = await withUserContext(db, ctx, (tx) =>
      tx.select().from(goalCredits).where(eq(goalCredits.goalId, goalId)),
    );
    expect(credits).toEqual([]);
  });
});
