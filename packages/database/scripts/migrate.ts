/* eslint-disable no-console -- A CLI script's output is its interface. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import './load-env.js';

import { getServerEnv } from '@app/validation/env';

/**
 * Applies pending migrations.
 *
 * The Supabase CLI does the work rather than Drizzle's migrator, so that local
 * runs, CI and the Supabase dashboard all agree on which migrations have been
 * applied — they share one ledger, `supabase_migrations.schema_migrations`. Two
 * migration trackers over one database is a reconciliation problem nobody wants
 * to debug at deploy time (ADR-004).
 *
 * Migrations run over the direct connection: the transaction pooler cannot hold
 * the session-level locks DDL needs.
 *
 * And they run from the repository root, not from this package. The Supabase
 * CLI resolves `supabase/migrations` relative to its working directory, so
 * invoked from `packages/database` it found no local migrations at all and
 * refused the push — reporting every applied migration as missing and
 * recommending `migration repair`, which is the one thing nobody should run on
 * a healthy ledger.
 */

/** The repository root: the first ancestor that actually holds `supabase/`. */
function repositoryRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(directory, 'supabase', 'migrations'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  throw new Error('No supabase/migrations directory found above this script.');
}
function migrate(): void {
  const env = getServerEnv();

  if (!env.DIRECT_URL) {
    console.error(
      'DIRECT_URL is not set. Migrations need a session-mode connection (port 5432), not the pooler.',
    );
    process.exit(1);
  }

  console.log('Applying migrations…');

  try {
    execFileSync('supabase', ['db', 'push', '--db-url', env.DIRECT_URL, '--include-all'], {
      stdio: 'inherit',
      cwd: repositoryRoot(),
    });
  } catch {
    console.error('\nMigration failed. The database is unchanged for any migration that errored.');
    process.exit(1);
  }

  console.log('Migrations applied.');
}

migrate();
