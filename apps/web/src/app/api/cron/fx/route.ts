import { getServerEnv } from '@app/validation/env';
import { NextResponse } from 'next/server';

import { refreshFxRates } from '@/server/fx-rates';

/**
 * Daily exchange rates for Viajes. Same guard as every cron route: Vercel
 * sends the secret, anyone else gets a 401.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: Request): Promise<NextResponse> {
  const { CRON_SECRET } = getServerEnv();
  if (!CRON_SECRET || request.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return new NextResponse(null, { status: 401 });
  }
  try {
    return NextResponse.json({ status: 'ok', ...(await refreshFxRates()) });
  } catch (error: unknown) {
    console.error('[fx] refresh failed', error);
    return NextResponse.json({ status: 'error' }, { status: 503 });
  }
}
