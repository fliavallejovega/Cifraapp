/* eslint-disable no-console -- A CLI script's output is its interface. */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import './load-env.js';

/**
 * Rebuilds a local Postgres database from the migrations, for development and
 * for the RLS test suite.
 *
 * Local Postgres is not Supabase: it has no `auth` schema and no `auth.uid()`.
 * The shim in `supabase/local/` supplies those with Supabase's own definitions,
 * so a policy proven here holds there. Everything after the shim is the real
 * migration set, applied in filename order — the same order the Supabase CLI
 * uses.
 *
 * Usage: `pnpm db:local` (drops and rebuilds), or `--keep` to apply only.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase/migrations');
const SHIM = join(REPO_ROOT, 'supabase/local/auth-shim.sql');

const DATABASE = process.env['LOCAL_DB_NAME'] ?? 'norte_dev';
const HOST = process.env['LOCAL_DB_HOST'] ?? '127.0.0.1';
const PORT = process.env['LOCAL_DB_PORT'] ?? '5432';

function psql(database: string, args: string[]): string {
  return execFileSync(
    'psql',
    ['-h', HOST, '-p', PORT, '-d', database, '-v', 'ON_ERROR_STOP=1', ...args],
    { encoding: 'utf8' },
  );
}

function main(): void {
  const keep = process.argv.includes('--keep');

  if (!keep) {
    console.log(`Rebuilding ${DATABASE}…`);
    psql('postgres', ['-c', `drop database if exists ${DATABASE} with (force)`]);
    psql('postgres', ['-c', `create database ${DATABASE}`]);
  }

  console.log('  auth shim');
  psql(DATABASE, ['-f', SHIM]);

  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const migration of migrations) {
    console.log(`  ${migration}`);
    psql(DATABASE, ['-f', join(MIGRATIONS_DIR, migration)]);
  }

  // Reference data is part of a working database, not an optional extra —
  // households reference platform.currencies by foreign key.
  console.log('  seed');
  const connectionUrl = `postgresql://${HOST}:${PORT}/${DATABASE}`;
  execFileSync('pnpm', ['exec', 'tsx', join(HERE, 'seed.ts')], {
    stdio: 'inherit',
    env: { ...process.env, DIRECT_URL: connectionUrl, DATABASE_URL: connectionUrl },
  });

  // A migration that references a table the previous one did not create fails
  // loudly above. Reaching here means the whole set applies from empty.
  const version = psql(DATABASE, [
    '-tAc',
    "select version || ' — ' || description from platform.schema_version",
  ]).trim();

  console.log(`\nApplied ${String(migrations.length)} migrations. Schema version ${version}.`);
  console.log(`\nConnection string:\n  ${connectionUrl}`);

  // Surface anything the migrations left unprotected. Cheap here, expensive to
  // discover in production.
  const unprotected = psql(DATABASE, [
    '-tAc',
    `select table_schema || '.' || table_name
       from information_schema.tables t
      where t.table_schema in ('app', 'audit')
        and t.table_type = 'BASE TABLE'
        and not exists (
          select 1 from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = t.table_schema
             and c.relname = t.table_name
             and c.relrowsecurity
        )`,
  ]).trim();

  if (unprotected) {
    console.error(`\nTables without row-level security:\n${unprotected}`);
    process.exit(1);
  }

  void readFileSync;
}

main();
