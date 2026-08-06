import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * Database access.
 *
 * Two connections exist, and the difference between them is the most important
 * security boundary in the system:
 *
 *   - `getDb()` connects as `authenticated` and runs every statement inside a
 *     transaction that carries the user's JWT claims, so row-level security
 *     applies. This is what request handlers use.
 *
 *   - `getAdminDb()` connects as the owner and bypasses RLS entirely. It exists
 *     for migrations, scheduled jobs and seeds. Any code using it is fully
 *     responsible for its own tenant scoping (spec §6, §47).
 *
 * Nothing here may be imported into a client bundle; the guard below turns that
 * mistake into an immediate, obvious crash rather than a leaked credential.
 */

if ('window' in globalThis) {
  throw new Error(
    '@app/database was imported into a browser bundle. Database access is server-only — move this call into a Server Component, Server Action, or route handler.',
  );
}

let pooledClient: postgres.Sql | undefined;
let directClient: postgres.Sql | undefined;
let pooledDb: Database | undefined;
let adminDb: Database | undefined;

interface ConnectionOptions {
  readonly url: string;
  /**
   * Supabase's transaction pooler (port 6543) multiplexes connections and does
   * not support prepared statements. Sending them produces intermittent,
   * hard-to-reproduce failures under load rather than a clean error.
   */
  readonly pooled: boolean;
  readonly maxConnections?: number;
}

function createClient({ url, pooled, maxConnections }: ConnectionOptions): postgres.Sql {
  return postgres(url, {
    prepare: !pooled,
    max: maxConnections ?? (pooled ? 10 : 4),
    idle_timeout: 20,
    connect_timeout: 10,
    // Money and large identifiers must not round-trip through a JS number.
    types: {
      bigint: postgres.BigInt,
    },
    onnotice: () => {
      // Postgres notices are noise in application logs and occasionally contain
      // statement text, which may include financial descriptions (spec §47).
    },
  });
}

/**
 * Connection that respects row-level security. Prefer `withUserContext` over
 * using this directly, so the tenant scope is always explicit.
 */
export function getDb(connectionUrl: string): Database {
  pooledClient ??= createClient({ url: connectionUrl, pooled: true });
  pooledDb ??= drizzle(pooledClient, { schema, casing: 'snake_case' });
  return pooledDb;
}

/**
 * Connection that bypasses row-level security. Migrations, cron jobs, seeds and
 * platform accounting only.
 */
export function getAdminDb(connectionUrl: string): Database {
  directClient ??= createClient({ url: connectionUrl, pooled: false });
  adminDb ??= drizzle(directClient, { schema, casing: 'snake_case' });
  return adminDb;
}

export interface UserContext {
  /** The authenticated user's Supabase `auth.uid()`. */
  readonly userId: string;
  /** Raw JWT claims, forwarded so RLS policies can read role and metadata. */
  readonly claims: Record<string, unknown>;
}

/**
 * Runs a unit of work as a specific user, inside a single transaction.
 *
 * The claims are set with `set_config(..., true)`, which is transaction-local:
 * when the transaction ends the settings are discarded, so a pooled connection
 * can never carry one user's identity into another user's request. That
 * property is why every RLS-scoped read and every financial write goes through
 * here rather than through a bare query (spec §96).
 */
export async function withUserContext<TResult>(
  db: Database,
  context: UserContext,
  work: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<TResult>,
): Promise<TResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', 'authenticated', true)`);
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify(context.claims)}, true)`,
    );
    await tx.execute(sql`select set_config('request.jwt.claim.sub', ${context.userId}, true)`);

    return work(tx);
  });
}

/** Closes pooled connections. For scripts and test teardown, not request paths. */
export async function closeConnections(): Promise<void> {
  await Promise.all([pooledClient?.end(), directClient?.end()]);
  pooledClient = undefined;
  directClient = undefined;
  pooledDb = undefined;
  adminDb = undefined;
}
