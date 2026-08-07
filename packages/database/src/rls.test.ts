import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

/**
 * Row-level security.
 *
 * These are the most important tests in the repository. Everything else in this
 * product can be wrong and recoverable; a household seeing another household's
 * money cannot be. Each case asserts an isolation boundary rather than a happy
 * path, because the happy path passing tells you nothing about whether the
 * boundary holds.
 *
 * The suite runs against real Postgres with the same `auth.uid()` definition
 * Supabase ships, so a policy that passes here passes there for the same reason.
 */

const connectionUrl = process.env['TEST_DATABASE_URL'];
const describeWithDatabase = connectionUrl ? describe : describe.skip;

if (!connectionUrl) {
  console.warn('TEST_DATABASE_URL not set — skipping RLS tests. Run `pnpm db:local` first.');
}

const ALEX = '11111111-1111-4111-8111-111111111111';
const TAYLOR = '22222222-2222-4222-8222-222222222222';
const MORGAN = '33333333-3333-4333-8333-333333333333';

describeWithDatabase('row-level security', () => {
  const sql = postgres(connectionUrl ?? '', { prepare: false, max: 4, onnotice: () => undefined });

  let alexHousehold = '';
  let morganHousehold = '';

  /**
   * Runs a callback as a specific signed-in user, inside a transaction that
   * carries their JWT claims exactly the way a request would.
   */
  function asUser<T>(
    userId: string,
    work: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    // Cast because postgres.js types `begin` as unwrapping arrays of promises,
    // which erases the callback's own return type.
    return sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({
        sub: userId,
        role: 'authenticated',
      })}, true)`;
      await tx`select set_config('role', 'authenticated', true)`;
      return work(tx);
    }) as Promise<T>;
  }

  beforeAll(async () => {
    // Seeded as the owner, outside RLS — this is the provisioning path the auth
    // provider would perform, not something a client can do.
    await sql`delete from auth.users where id in (${ALEX}, ${TAYLOR}, ${MORGAN})`;
    await sql`
      insert into auth.users (id, email) values
        (${ALEX}, 'alex@example.test'),
        (${TAYLOR}, 'taylor@example.test'),
        (${MORGAN}, 'morgan@example.test')
    `;
    await sql`
      insert into app.profiles (id, email, display_name) values
        (${ALEX}, 'alex@example.test', 'Alex'),
        (${TAYLOR}, 'taylor@example.test', 'Taylor'),
        (${MORGAN}, 'morgan@example.test', 'Morgan')
    `;

    alexHousehold = await asUser(ALEX, async (tx) => {
      const rows = await tx<{ create_household: string }[]>`
        select app.create_household('Alex y Taylor', 'USD', 'America/Panama')
      `;
      return rows[0]?.create_household ?? '';
    });

    morganHousehold = await asUser(MORGAN, async (tx) => {
      const rows = await tx<{ create_household: string }[]>`
        select app.create_household('Morgan', 'USD', 'America/Panama')
      `;
      return rows[0]?.create_household ?? '';
    });

    // Taylor joins Alex's household as a partner.
    await asUser(ALEX, async (tx) => {
      await tx`
        insert into app.household_members (household_id, user_id, role, status)
        values (${alexHousehold}, ${TAYLOR}, 'partner', 'active')
      `;
    });
  });

  afterAll(async () => {
    await sql`delete from auth.users where id in (${ALEX}, ${TAYLOR}, ${MORGAN})`;
    await sql.end();
  });

  it('creates a household with its owner in one transaction', async () => {
    expect(alexHousehold).toMatch(/^[0-9a-f-]{36}$/);

    const members = await asUser(
      ALEX,
      (tx) =>
        tx<{ role: string }[]>`
          select role from app.household_members where household_id = ${alexHousehold}
        `,
    );

    expect(members.map((member) => member.role).sort()).toEqual(['owner', 'partner']);
  });

  it('shows a member their own household', async () => {
    const households = await asUser(
      ALEX,
      (tx) => tx<{ id: string }[]>`select id from app.households`,
    );

    expect(households.map((household) => household.id)).toEqual([alexHousehold]);
  });

  it('hides another household entirely — the core isolation guarantee', async () => {
    const households = await asUser(
      MORGAN,
      (tx) => tx<{ id: string }[]>`select id from app.households`,
    );

    expect(households.map((household) => household.id)).toEqual([morganHousehold]);
    expect(households.map((household) => household.id)).not.toContain(alexHousehold);
  });

  it('returns nothing when a household is named directly by id', async () => {
    // Knowing the identifier must not be enough. This is the query an attacker
    // writes after finding a UUID in a log or a URL.
    const rows = await asUser(
      MORGAN,
      (tx) => tx<{ id: string }[]>`select id from app.households where id = ${alexHousehold}`,
    );

    expect(rows).toEqual([]);
  });

  it('hides another household s membership rows', async () => {
    const rows = await asUser(
      MORGAN,
      (tx) =>
        tx<{ id: string }[]>`
          select id from app.household_members where household_id = ${alexHousehold}
        `,
    );

    expect(rows).toEqual([]);
  });

  it('refuses to let an outsider insert themselves into a household', async () => {
    // The attack that matters: granting yourself membership is how every other
    // policy in the system gets bypassed at once.
    await expect(
      asUser(
        MORGAN,
        (tx) =>
          tx`
          insert into app.household_members (household_id, user_id, role, status)
          values (${alexHousehold}, ${MORGAN}, 'owner', 'active')
        `,
      ),
    ).rejects.toThrow();

    const members = await asUser(
      ALEX,
      (tx) =>
        tx<{ user_id: string }[]>`
          select user_id from app.household_members where household_id = ${alexHousehold}
        `,
    );
    expect(members.map((member) => member.user_id)).not.toContain(MORGAN);
  });

  it('refuses to let an outsider rename a household', async () => {
    await asUser(MORGAN, async (tx) => {
      const result = await tx`
        update app.households set name = 'taken' where id = ${alexHousehold}
      `;
      // RLS makes the row invisible rather than raising: zero rows updated.
      expect(result.count).toBe(0);
    });

    const [household] = await asUser(
      ALEX,
      (tx) => tx<{ name: string }[]>`select name from app.households where id = ${alexHousehold}`,
    );
    expect(household?.name).toBe('Alex y Taylor');
  });

  it('lets a partner rename the household but not change membership', async () => {
    await asUser(TAYLOR, async (tx) => {
      const renamed = await tx`
        update app.households set name = 'Alex y Taylor' where id = ${alexHousehold}
      `;
      expect(renamed.count).toBe(1);
    });

    // Membership is an owner-only power, even for a full financial peer.
    await expect(
      asUser(
        TAYLOR,
        (tx) =>
          tx`
          insert into app.household_members (household_id, user_id, role, status)
          values (${alexHousehold}, ${MORGAN}, 'viewer', 'active')
        `,
      ),
    ).rejects.toThrow();
  });

  it('shows a profile only to its owner', async () => {
    const own = await asUser(ALEX, (tx) => tx<{ id: string }[]>`select id from app.profiles`);
    expect(own.map((profile) => profile.id)).toEqual([ALEX]);

    const other = await asUser(
      MORGAN,
      (tx) => tx<{ id: string }[]>`select id from app.profiles where id = ${ALEX}`,
    );
    expect(other).toEqual([]);
  });

  it('refuses to create a household for a user who is not signed in', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`select set_config('role', 'authenticated', true)`;
        return tx`select app.create_household('Anonymous', 'USD', 'America/Panama')`;
      }),
    ).rejects.toThrow();
  });

  it('keeps the audit trail readable only by household administrators', async () => {
    const asOwner = await asUser(
      ALEX,
      (tx) =>
        tx<{ action: string }[]>`
          select action from audit.events where household_id = ${alexHousehold}
        `,
    );
    expect(asOwner.map((event) => event.action)).toContain('household.created');

    const asOutsider = await asUser(
      MORGAN,
      (tx) =>
        tx<{ action: string }[]>`
          select action from audit.events where household_id = ${alexHousehold}
        `,
    );
    expect(asOutsider).toEqual([]);
  });

  it('gives the audit trail no update or delete path at all', async () => {
    // Not "an owner may not delete" — no policy exists for either verb, so the
    // statement matches nothing regardless of who runs it (spec §48).
    const policies = await sql<{ cmd: string }[]>`
      select cmd from pg_policies where schemaname = 'audit' and tablename = 'events'
    `;

    expect(policies.map((policy) => policy.cmd)).toEqual(['SELECT']);
  });

  it('forces row-level security on every table in app and audit', async () => {
    // `enable` alone is not enough: without `force`, any connection running as
    // the table owner silently bypasses every policy above.
    const unforced = await sql<{ relname: string }[]>`
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('app', 'audit')
         and c.relkind = 'r'
         and (not c.relrowsecurity or not c.relforcerowsecurity)
    `;

    expect(unforced.map((table) => table.relname)).toEqual([]);
  });

  it('pins the search path on every security-definer function', async () => {
    // A definer function without a pinned search_path can be tricked into
    // resolving `app.household_members` to a caller-controlled temp table,
    // which hands out membership.
    const unpinned = await sql<{ proname: string }[]>`
      select p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app'
         and p.prosecdef
         and (p.proconfig is null or not exists (
           select 1 from unnest(p.proconfig) as config
            where config like 'search_path=%'
         ))
    `;

    expect(unpinned.map((fn) => fn.proname)).toEqual([]);
  });
});
