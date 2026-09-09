import { getServerEnv } from '@app/validation/env';
import { NextResponse } from 'next/server';

import { publishCalendars } from '@/server/google/publish';
import { sweepMailboxes } from '@/server/google/sweep';

/**
 * El barrido de Google: leer el buzón y publicar el calendario.
 *
 * Los dos en la misma ejecución porque comparten el token y la mitad del costo
 * es renovarlo. Corren en secuencia y no en paralelo: si el correo agota la
 * cuota de la cuenta, el calendario debe fallar con un motivo y no competir por
 * lo que queda.
 *
 * No lanza. Una cuenta a la que le retiraron el permiso deja su motivo en la
 * fila de conexión, y el cron sigue con las demás — un hogar que revocó no puede
 * dejar sin sincronizar a todos los otros.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request): Promise<NextResponse> {
  const { CRON_SECRET } = getServerEnv();

  if (!CRON_SECRET || request.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return new NextResponse(null, { status: 401 });
  }

  const mail = await sweepMailboxes().catch((error: unknown) => {
    console.error('[google] mailbox sweep failed', error);
    return null;
  });

  const calendar = await publishCalendars().catch((error: unknown) => {
    console.error('[google] calendar publish failed', error);
    return null;
  });

  return NextResponse.json({ status: 'ok', mail, calendar });
}
