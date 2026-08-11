import { describe, expect, it, afterAll } from 'vitest';
import postgres from 'postgres';

/**
 * The security audit, as a test rather than a checklist.
 *
 * A hardening pass done by reading the schema is a hardening pass that decays
 * the week after. These assertions run on every commit and fail when somebody
 * adds a table without a policy, grants `anon` something it should not have, or
 * introduces a floating-point column for money — which are, in order, the three
 * ways this system could quietly stop being trustworthy.
 *
 * Each case checks the *whole schema*, not a list of table names. A test that
 * enumerates the tables it knows about passes forever after the next migration
 * adds one.
 */

const connectionUrl = process.env['TEST_DATABASE_URL'];
const describeWithDatabase = connectionUrl ? describe : describe.skip;

if (!connectionUrl) {
  console.warn('TEST_DATABASE_URL not set — skipping the security audit. Run `pnpm db:local`.');
}

/**
 * Tables that legitimately have no policy.
 *
 * Every entry is service-role only and is reached exclusively by the admin
 * application or a job. RLS is still enabled and forced on all of them, so the
 * absence of a policy denies everything rather than allowing it — that is the
 * property being asserted, not an exemption from it.
 */
const NO_POLICY_EXPECTED = new Set([
  'platform.ai_models',
  'platform.ledger_accounts',
  'platform.journal_entries',
  'platform.journal_lines',
  'platform.billing_events',
  'platform.admin_users',
  'platform.feature_flags',
  'platform.feature_flag_overrides',
  'platform.organization_branding',
  'audit.admin_actions',
]);

describeWithDatabase('security audit', () => {
  const sql = postgres(connectionUrl ?? '', { prepare: false, max: 2, onnotice: () => undefined });

  afterAll(async () => {
    await sql.end();
  });

  it('has row-level security enabled and forced on every application table', async () => {
    const rows = await sql<{ schema: string; table: string; enabled: boolean; forced: boolean }[]>`
      select n.nspname as schema, c.relname as table,
             c.relrowsecurity as enabled, c.relforcerowsecurity as forced
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r'
         and n.nspname in ('app', 'platform', 'audit')
       order by 1, 2
    `;

    expect(rows.length).toBeGreaterThan(0);

    const unprotected = rows.filter((row) => !row.enabled || !row.forced);

    // Forced matters as much as enabled. Without it the table owner — which is
    // the role migrations and jobs connect as — bypasses every policy, and a
    // job written next year would quietly read across tenants.
    expect(unprotected.map((row) => `${row.schema}.${row.table}`)).toEqual([]);
  });

  it('gives every table with a customer-facing grant at least one policy', async () => {
    const rows = await sql<{ schema: string; table: string; policies: number }[]>`
      select n.nspname as schema, c.relname as table,
             (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r'
         and n.nspname in ('app', 'platform', 'audit')
       order by 1, 2
    `;

    const missing = rows
      .filter((row) => row.policies === 0)
      .map((row) => `${row.schema}.${row.table}`)
      .filter((name) => !NO_POLICY_EXPECTED.has(name));

    // A table with RLS forced and no policy denies everything, which is safe but
    // usually means somebody forgot. The allowlist above is the set where that
    // was the intent.
    expect(missing).toEqual([]);
  });

  it('never stores money in a floating-point column', async () => {
    const rows = await sql<{ table: string; column: string; type: string }[]>`
      select table_schema || '.' || table_name as table, column_name as column, data_type as type
        from information_schema.columns
       where table_schema in ('app', 'platform', 'audit')
         and data_type in ('real', 'double precision', 'money')
    `;

    // Floating point cannot represent 0.10. A column that holds an amount in a
    // float is a rounding error waiting for a large enough balance.
    expect(rows).toEqual([]);
  });

  it('keeps every monetary column at the same scale', async () => {
    const rows = await sql<{ table: string; column: string; scale: number | null }[]>`
      select table_schema || '.' || table_name as table, column_name as column,
             numeric_scale as scale
        from information_schema.columns
       where table_schema in ('app', 'platform')
         and data_type = 'numeric'
         and (column_name like '%amount%' or column_name like '%balance%'
              or column_name like '%price%' or column_name like '%payment%')
    `;

    const wrongScale = rows.filter((row) => row.scale !== 4);

    // Four decimals, everywhere, because interest accrual and allocation both
    // need sub-cent intermediates. A column at scale 2 silently truncates them.
    expect(wrongScale).toEqual([]);
  });

  it('grants the anonymous role nothing beyond public content', async () => {
    const rows = await sql<{ table: string; privilege: string }[]>`
      select table_schema || '.' || table_name as table, privilege_type as privilege
        from information_schema.role_table_grants
       where grantee = 'anon'
         and table_schema in ('app', 'platform', 'audit')
       order by 1, 2
    `;

    const allowed = new Set([
      'platform.schema_version',
      'platform.currencies',
      'platform.tax_jurisdictions',
      'platform.plans',
      'platform.plan_entitlements',
      'platform.content_pages',
      'platform.content_authors',
      'platform.content_categories',
      'platform.media_assets',
      'platform.faqs',
      'platform.testimonials',
      'platform.redirects',
      'platform.legal_documents',
    ]);

    const unexpected = rows.filter((row) => !allowed.has(row.table));

    // The anonymous key is public by design. Everything it can reach is
    // reachable by anyone on the internet, so the list is short and asserted.
    expect(unexpected).toEqual([]);
  });

  it('never grants the anonymous role a write', async () => {
    const rows = await sql<{ table: string; privilege: string }[]>`
      select table_schema || '.' || table_name as table, privilege_type as privilege
        from information_schema.role_table_grants
       where grantee = 'anon'
         and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    `;

    expect(rows).toEqual([]);
  });

  it('keeps the audit trail append-only', async () => {
    const rows = await sql<{ table: string; privilege: string; grantee: string }[]>`
      select table_name as table, privilege_type as privilege, grantee
        from information_schema.role_table_grants
       where table_schema = 'audit'
         and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
         and grantee in ('anon', 'authenticated')
    `;

    // An audit trail its subjects can rewrite is a log.
    expect(rows).toEqual([]);
  });

  it('runs every security definer function with a pinned search path', async () => {
    const rows = await sql<{ name: string; config: string[] | null }[]>`
      select p.proname as name, p.proconfig as config
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('app', 'platform', 'public')
         and p.prosecdef
    `;

    const unpinned = rows
      .filter((row) => !(row.config ?? []).some((entry) => entry.startsWith('search_path=')))
      .map((row) => row.name);

    // A security definer function without a pinned search_path can be hijacked
    // by a caller who creates a same-named object in a schema it searches first.
    // This is the classic Postgres privilege escalation, and it is one column in
    // a catalogue away from being detectable.
    expect(unpinned).toEqual([]);
  });

  it('records the schema generation the application expects', async () => {
    const [row] = await sql<{ version: number }[]>`
      select version from platform.schema_version limit 1
    `;

    expect(row?.version).toBeGreaterThanOrEqual(19);
  });
});
