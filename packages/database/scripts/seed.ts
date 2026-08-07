/* eslint-disable no-console -- A CLI script's output is its interface. */
import './load-env.js';

import { getServerEnv } from '@app/validation/env';

import { closeConnections, getAdminDb } from '../src/client.js';
import { categoryTemplates } from '../src/schema/app.js';
import { currencies, taxJurisdictions } from '../src/schema/platform.js';
import { CATEGORY_SEED, CURRENCY_SEED, JURISDICTION_SEED } from '../src/seed-data.js';

/**
 * Seeds global reference data.
 *
 * Idempotent by construction: every statement upserts on a natural key, so
 * running this against a database that has already been seeded is a no-op
 * rather than a duplicate-key error or a second copy of the category tree
 * (spec §67).
 */
async function seed(): Promise<void> {
  const env = getServerEnv();
  const db = getAdminDb(env.DIRECT_URL);

  console.log('Seeding reference data…');

  await db.transaction(async (tx) => {
    await tx
      .insert(currencies)
      .values(CURRENCY_SEED.map((currency) => ({ ...currency, isActive: true })))
      .onConflictDoUpdate({
        target: currencies.code,
        set: {
          nameEn: currencies.nameEn,
          nameEs: currencies.nameEs,
          symbol: currencies.symbol,
          minorUnits: currencies.minorUnits,
        },
      });
    console.log(`  currencies: ${String(CURRENCY_SEED.length)}`);

    await tx
      .insert(taxJurisdictions)
      .values([...JURISDICTION_SEED])
      .onConflictDoUpdate({
        target: taxJurisdictions.code,
        set: {
          nameEn: taxJurisdictions.nameEn,
          nameEs: taxJurisdictions.nameEs,
          authorityName: taxJurisdictions.authorityName,
          authorityUrl: taxJurisdictions.authorityUrl,
        },
      });
    console.log(`  tax jurisdictions: ${String(JURISDICTION_SEED.length)}`);

    // Parents before children: the table's own foreign key requires that a
    // parent slug already exists.
    const roots = CATEGORY_SEED.filter((category) => category.parentSlug === null);
    const children = CATEGORY_SEED.filter((category) => category.parentSlug !== null);

    for (const batch of [roots, children]) {
      await tx
        .insert(categoryTemplates)
        .values([...batch])
        .onConflictDoUpdate({
          target: categoryTemplates.slug,
          set: {
            nameEn: categoryTemplates.nameEn,
            nameEs: categoryTemplates.nameEs,
            kind: categoryTemplates.kind,
            sortOrder: categoryTemplates.sortOrder,
            parentSlug: categoryTemplates.parentSlug,
          },
        });
    }
    console.log(`  category templates: ${String(CATEGORY_SEED.length)}`);
  });

  console.log('Seed complete.');
}

seed()
  .then(() => closeConnections())
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
