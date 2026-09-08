import { getSchemaVersion } from '@app/database';
import { getServerEnv } from '@app/validation/env';
import { NextResponse } from 'next/server';

import { copilotIsConfigured } from '@/server/ai';
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
 *
 * It also reports which optional providers this deployment has, and that is
 * more than a nicety: switching the copilot on is an environment change that
 * only takes effect on the next build, and until this existed the only way to
 * find out whether it had landed was to sign in and read a banner. Names and
 * booleans only — never a key, and never a reason a key was rejected.
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
  const env = getServerEnv();

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      schemaVersion,
      checks,
      // What this deployment can do beyond the deterministic core. Every one of
      // these is a supported `false`: the product works without all of them.
      providers: {
        copilot: copilotIsConfigured() ? env.AI_PROVIDER : 'none',
        billing: env.BILLING_PROVIDER,
        cron: Boolean(env.CRON_SECRET),
      },
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
