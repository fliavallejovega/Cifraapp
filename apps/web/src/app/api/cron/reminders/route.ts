import { getServerEnv } from '@app/validation/env';
import { NextResponse } from 'next/server';

import { runDailyReminders } from '@/server/reminders';

/**
 * Los recordatorios del día.
 *
 * Corre a las seis de la mañana, una vez al día, que es el único ritmo que este
 * plan admite. No es una limitación que duela: nada de lo que dice mejora con
 * precisión de minutos —«hoy vencen estos cuatro pagos» sirve igual a las seis
 * que a las once— y lo que sí importa es no llegar mañana.
 *
 * No es pública. Solo Vercel Cron, con el secreto que corresponde.
 *
 * Devuelve el recuento y no lanza: un proveedor de correo caído no debe dejar
 * el cron en rojo para siempre, y el detalle de cada envío queda escrito en
 * `notification_deliveries` con su razón, que es donde se mira cuando alguien
 * dice «no me llegó nada».
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const { CRON_SECRET } = getServerEnv();

  if (!CRON_SECRET || request.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const outcome = await runDailyReminders();
    return NextResponse.json({ status: 'ok', ...outcome });
  } catch (error: unknown) {
    console.error('[reminders] sweep failed', error);
    return NextResponse.json({ status: 'error' }, { status: 503 });
  }
}
