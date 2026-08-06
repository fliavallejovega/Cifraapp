/* eslint-disable no-console -- A CLI script's output is its interface. */
import { execFileSync } from 'node:child_process';

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
 */
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
    });
  } catch {
    console.error('\nMigration failed. The database is unchanged for any migration that errored.');
    process.exit(1);
  }

  console.log('Migrations applied.');
}

migrate();
