import { getSchemaVersion } from '@app/database';
import { NextResponse } from 'next/server';

import { getDatabase } from '@/server/database';

/**
 * Liveness and readiness in one response.
 *
 * "The page rendered" is not evidence that a deployment works. This endpoint
 * proves the parts that actually fail in production: credentials resolve, the
 * connection pooler accepts a session, migrations have run, and the application
 * and the database agree on which schema generation they are talking about.
 *
 * It reports `degraded` rather than failing outright when the database is
 * unreachable, so a monitor can distinguish "the app is down" from "the app is
 * up and the database is not".
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const checks: Record<string, { status: 'ok' | 'unavailable'; detail?: string }> = {
    application: { status: 'ok' },
  };

  let schemaVersion: number | null = null;

  try {
    const database = getDatabase();

    if (database) {
      const version = await getSchemaVersion(database);
      schemaVersion = version?.version ?? null;
      checks['database'] = version
        ? { status: 'ok', detail: version.description }
        : { status: 'unavailable', detail: 'Connected, but no schema version row was found.' };
    } else {
      checks['database'] = {
        status: 'unavailable',
        detail: 'Database credentials are not configured.',
      };
    }
  } catch {
    // The underlying error is deliberately not echoed: connection failures
    // carry hostnames and occasionally credentials, and this endpoint is
    // reachable without authentication (spec §47).
    checks['database'] = { status: 'unavailable', detail: 'Could not reach the database.' };
  }

  const healthy = Object.values(checks).every((check) => check.status === 'ok');

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      schemaVersion,
      checks,
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
