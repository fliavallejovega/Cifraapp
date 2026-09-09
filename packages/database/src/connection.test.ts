import { afterAll, describe, expect, it } from 'vitest';

import { closeConnections, getAdminDb } from './client.js';
import { getSchemaVersion } from './health.js';
import { categoryTemplates } from './schema/app.js';
import { currencies } from './schema/platform.js';
import { CATEGORY_SEED, CURRENCY_SEED } from './seed-data.js';

/**
 * Integration coverage against a real Postgres.
 *
 * Skipped rather than failed when `DIRECT_URL` is absent, so the unit suite runs
 * on a laptop with no credentials and in CI forks that cannot see secrets. The
 * skip is reported, never silent — a suite that quietly tests nothing is worse
 * than one that fails.
 */
const connectionUrl = process.env['TEST_DATABASE_URL'];
const describeWithDatabase = connectionUrl ? describe : describe.skip;

if (!connectionUrl) {
  console.warn('TEST_DATABASE_URL not set — skipping database integration tests.');
}

describeWithDatabase('database connection', () => {
  const db = getAdminDb(connectionUrl ?? '');

  afterAll(async () => {
    await closeConnections();
  });

  it('reports the applied schema version', async () => {
    const version = await getSchemaVersion(db);

    expect(version).not.toBeNull();
    expect(version?.version).toBeGreaterThanOrEqual(1);
    expect(version?.description).toBeTruthy();
  });

  it('has the reference currencies the seed installs', async () => {
    const rows = await db.select({ code: currencies.code }).from(currencies);
    const codes = rows.map((row) => row.code.trim()).sort();

    expect(codes).toEqual(CURRENCY_SEED.map((currency) => currency.code).sort());
  });

  it('has the full category tree, exactly once', async () => {
    const rows = await db.select({ slug: categoryTemplates.slug }).from(categoryTemplates);
    const slugs = rows.map((row) => row.slug);

    // Every template the seed installs is present. Stated as containment and
    // not as an exact count, because later migrations legitimately add rubros
    // the seed file never knew about — the tithe and the retirement bucket came
    // that way. Asserting equality made this test a tripwire on the wrong
    // thing: it failed for a correct migration and passed for months only
    // because the local database was behind the migrations it was tested on.
    for (const template of CATEGORY_SEED) {
      expect(slugs).toContain(template.slug);
    }

    // This is the invariant that actually matters, and it is unchanged: a
    // second seed run that appended instead of upserting would duplicate a
    // slug (spec §67).
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('stores money as numeric, never as a float', async () => {
    // Guards the rule at the database level rather than trusting convention:
    // any column named like money must be NUMERIC, never real/double precision
    // (spec §95). Currently vacuous, and deliberately so — it starts failing the
    // moment Phase 3 adds a balance column with the wrong type.
    const rows = await db.execute<{ table_name: string; column_name: string; data_type: string }>(
      `select table_name, column_name, data_type
         from information_schema.columns
        where table_schema in ('app', 'platform')
          and (column_name like '%amount%' or column_name like '%balance%' or column_name like '%price%')
          and data_type in ('real', 'double precision')`,
    );

    expect(rows).toEqual([]);
  });
});
