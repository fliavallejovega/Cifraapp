import 'server-only';

import { getDb, type Database } from '@app/database';
import { getServerEnv } from '@app/validation/env';

/**
 * The application's handle on the database.
 *
 * The `server-only` import is load-bearing: it makes importing this module from
 * a Client Component a build error rather than a shipped connection string.
 *
 * Returns `null` when no credentials are configured, so the application still
 * boots and can say so — the health endpoint reports the gap instead of the
 * process crashing on an unrelated page.
 */
export function getDatabase(): Database | null {
  const env = getServerEnv();

  if (!env.DATABASE_URL) {
    return null;
  }

  return getDb(env.DATABASE_URL);
}
