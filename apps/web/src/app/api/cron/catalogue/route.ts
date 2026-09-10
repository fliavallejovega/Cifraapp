import { getServerEnv } from '@app/validation/env';
import { NextResponse } from 'next/server';

import { refreshCatalogue } from '@/server/catalogue/refresh';

/**
 * El barrido del catálogo, a mano.
 *
 * El mensual viaja dentro del cron diario y corre el día 1. Esta ruta existe
 * para dispararlo cuando hace falta: acaba de salir el estudio nuevo de
 * ACODECO, un banco cambió sus promociones a mitad de mes, o alguien quiere ver
 * qué encuentra sin esperar tres semanas.
 *
 * No es pública. Sólo con el secreto del cron.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request): Promise<NextResponse> {
  const { CRON_SECRET } = getServerEnv();

  if (!CRON_SECRET || request.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const outcome = await refreshCatalogue();
    return NextResponse.json({ status: 'ok', ...outcome });
  } catch (error: unknown) {
    console.error('[catalogue] refresh failed', error);
    return NextResponse.json({ status: 'error' }, { status: 503 });
  }
}
