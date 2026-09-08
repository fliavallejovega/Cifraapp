import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

/**
 * The invariants the database holds on its own.
 *
 * Application code checks these too, and that is the point: the check in the
 * action turns a constraint violation into a sentence a person can act on, and
 * the constraint is what makes the sentence true when the next caller is a job,
 * a migration, or an endpoint nobody has written yet.
 *
 * Two are asserted here because both were invented for this product rather than
 * inherited from a schema convention, and neither is obvious from reading the
 * table: a set of splits sums to the transaction it divides, and a queued job
 * is claimed exactly once.
 */

const connectionUrl = process.env['TEST_DATABASE_URL'];
const describeWithDatabase = connectionUrl ? describe : describe.skip;

if (!connectionUrl) {
  console.warn('TEST_DATABASE_URL not set — skipping invariant tests. Run `pnpm db:local` first.');
}

const OWNER = '44444444-4444-4444-8444-444444444444';

describeWithDatabase('database invariants', () => {
  const sql = postgres(connectionUrl ?? '', { prepare: false, max: 4, onnotice: () => undefined });

  let householdId = '';
  let accountId = '';
  let transactionId = '';

  beforeAll(async () => {
    await sql`delete from auth.users where id = ${OWNER}`;
    await sql`insert into auth.users (id, email) values (${OWNER}, 'owner@example.test')`;
    await sql`
      insert into app.profiles (id, email, display_name)
      values (${OWNER}, 'owner@example.test', 'Owner')
    `;

    // `create_household` refuses without a signed-in user, so the claims are
    // carried exactly the way a request would carry them.
    householdId = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({
        sub: OWNER,
        role: 'authenticated',
      })}, true)`;
      await tx`select set_config('role', 'authenticated', true)`;

      const created = await tx<{ create_household: string }[]>`
        select app.create_household('Invariants', 'USD', 'America/Panama')
      `;
      return created[0]?.create_household ?? '';
    });

    // Provisioned outside RLS: this is the seeding path, not something a client
    // performs, and the policies themselves are asserted in `rls.test.ts`.
    const accounts = await sql<{ id: string }[]>`
      insert into app.accounts (household_id, name, account_type, currency, current_balance)
      values (${householdId}, 'Corriente', 'checking', 'USD', 1000)
      returning id
    `;
    accountId = accounts[0]?.id ?? '';

    const transactions = await sql<{ id: string }[]>`
      insert into app.transactions (
        household_id, account_id, transaction_date, amount, currency, direction,
        description_original, description_normalized, fingerprint
      )
      values (
        ${householdId}, ${accountId}, '2026-09-01', -100.0000, 'USD', 'outflow',
        'SUPER 99', 'super 99', 'fingerprint-invariants'
      )
      returning id
    `;
    transactionId = transactions[0]?.id ?? '';
  });

  afterAll(async () => {
    await sql`delete from app.households where id = ${householdId}`;
    await sql`delete from auth.users where id = ${OWNER}`;
    await sql.end();
  });

  describe('transaction splits', () => {
    // Splits are held positive and sum to the transaction's *magnitude*: two
    // negative lines could cancel out and still satisfy a signed sum.
    it('accepts a set of splits that sums to the transaction', async () => {
      await sql.begin(async (tx) => {
        await tx`
          insert into app.transaction_splits (household_id, transaction_id, amount, position)
          values
            (${householdId}, ${transactionId}, 60.0000, 0),
            (${householdId}, ${transactionId}, 40.0000, 1)
        `;
      });

      const rows = await sql<{ total: string }[]>`
        select coalesce(sum(amount), 0)::text as total
          from app.transaction_splits where transaction_id = ${transactionId}
      `;
      expect(rows[0]?.total).toBe('100.0000');

      await sql`delete from app.transaction_splits where transaction_id = ${transactionId}`;
    });

    it('refuses a set that does not add up', async () => {
      // The trigger is deferred, so this fails at commit rather than on the
      // second row — which is exactly what allows the valid case above to be
      // inserted as two statements.
      await expect(
        sql.begin(async (tx) => {
          await tx`
            insert into app.transaction_splits (household_id, transaction_id, amount, position)
            values
              (${householdId}, ${transactionId}, 60.0000, 0),
              (${householdId}, ${transactionId}, 30.0000, 1)
          `;
        }),
      ).rejects.toThrow(/sum to the transaction amount/);
    });

    it('treats removing every split as a valid state, not as a violation', async () => {
      await sql.begin(async (tx) => {
        await tx`
          insert into app.transaction_splits (household_id, transaction_id, amount, position)
          values (${householdId}, ${transactionId}, 100.0000, 0)
        `;
      });

      await expect(
        sql`delete from app.transaction_splits where transaction_id = ${transactionId}`,
      ).resolves.toBeDefined();
    });

    it('refuses a split of zero or less', async () => {
      await expect(
        sql`
          insert into app.transaction_splits (household_id, transaction_id, amount, position)
          values (${householdId}, ${transactionId}, 0, 0)
        `,
      ).rejects.toThrow();
    });
  });

  describe('the job queue', () => {
    it('hands the same queued job to only one worker', async () => {
      const [job] = await sql<{ id: string }[]>`
        insert into app.jobs (household_id, kind, payload)
        values (${householdId}, 'statement_import', '{"documentId":"a"}'::jsonb)
        returning id
      `;

      const claim = () => sql<{ id: string }[]>`
        update app.jobs as j
           set status = 'running', started_at = now(), attempts = j.attempts + 1
         where j.id = (
           select candidate.id from app.jobs as candidate
            where candidate.status = 'queued' and candidate.run_after <= now()
            order by candidate.run_after, candidate.created_at
            for update skip locked
            limit 1
         )
        returning j.id
      `;

      // Two workers arriving at once. The second must come away with nothing
      // rather than with the same job — a statement imported twice is the
      // failure this whole mechanism exists to prevent.
      const [first, second] = await Promise.all([claim(), claim()]);
      const claimed = [...first, ...second].map((row) => row.id);

      expect(claimed).toEqual([job?.id]);

      await sql`delete from app.jobs where household_id = ${householdId}`;
    });

    it('allows only one live job per document', async () => {
      await sql`
        insert into app.jobs (household_id, kind, payload)
        values (${householdId}, 'statement_import', '{"documentId":"same"}'::jsonb)
      `;

      // A person double-clicking upload gets one import, not two.
      await expect(
        sql`
          insert into app.jobs (household_id, kind, payload)
          values (${householdId}, 'statement_import', '{"documentId":"same"}'::jsonb)
        `,
      ).rejects.toThrow();

      await sql`delete from app.jobs where household_id = ${householdId}`;
    });

    it('refuses to record a finished job with no time on it', async () => {
      await expect(
        sql`
          insert into app.jobs (household_id, kind, status)
          values (${householdId}, 'statement_import', 'succeeded')
        `,
      ).rejects.toThrow();
    });
  });
});
