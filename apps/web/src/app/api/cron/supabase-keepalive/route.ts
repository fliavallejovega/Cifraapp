import { getClientEnv, getServerEnv } from '@app/validation/env';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDatabase } from '@/server/database';

/**
 * Daily keep-alive for the Supabase project.
 *
 * Free-tier projects pause after a week without activity. A scheduled ping
 * through Postgres and the auth API counts as use and keeps the project awake.
 * The route is not public: only Vercel Cron, with the matching bearer secret,
 * may invoke it.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorizeCron(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  const { CRON_SECRET } = getServerEnv();

  if (!authorizeCron(request, CRON_SECRET)) {
    return new NextResponse(null, { status: 401 });
  }

  const database = getDatabase();
  if (!database) {
    return NextResponse.json({ status: 'error', detail: 'no_database' }, { status: 503 });
  }

  try {
    await database.execute(sql`select 1 as ping`);
  } catch {
    return NextResponse.json({ status: 'error', detail: 'database_unreachable' }, { status: 503 });
  }

  let authApiOk = false;
  try {
    const clientEnv = getClientEnv();
    const response = await fetch(`${clientEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    authApiOk = response.ok;
  } catch {
    authApiOk = false;
  }

  const healthy = authApiOk;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        database: { status: 'ok' },
        authApi: { status: authApiOk ? 'ok' : 'unavailable' },
      },
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
