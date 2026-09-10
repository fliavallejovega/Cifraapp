import { getServerEnv } from '@app/validation/env';
import { NextResponse } from 'next/server';

import { refreshCatalogue } from '@/server/catalogue/refresh';
import { publishCalendars } from '@/server/google/publish';
import { sweepMailboxes } from '@/server/google/sweep';
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
 *
 * ## Por qué el barrido de Google viaja aquí dentro
 *
 * Porque este plan de Vercel admite unos pocos crons y este ya corre una vez al
 * día, que es exactamente la cadencia que el buzón y el calendario necesitan.
 * Gastar una entrada de cron —de las que hay— en algo que puede colgarse de una
 * que ya existe sería gastarla mal. `/api/cron/google` sigue existiendo para
 * poder dispararlo a mano cuando alguien conecta su cuenta y no quiere esperar
 * a mañana.
 *
 * Los tres corren en secuencia y ninguno puede tumbar a los otros: cada uno
 * atrapa lo suyo y devuelve nulo, porque una cuenta a la que le retiraron el
 * permiso no puede dejar sin recordatorios a todos los demás hogares.
 *
 * ## Y el catálogo de tarjetas, una vez al mes
 *
 * El día 1. No cada día: las condiciones de una tarjeta cambian por trimestre y
 * las promociones por mes, así que releer trece páginas de bancos a diario es
 * gastar cuota de un tercero para confirmar trece veces lo mismo — y es la
 * forma más rápida de que un banco bloquee al agente.
 *
 * Viaja aquí dentro por lo mismo que el barrido de Google: este plan admite
 * pocos crons y este ya corre a diario. La condición del día es una línea; una
 * entrada de cron es un recurso escaso.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request): Promise<NextResponse> {
  const { CRON_SECRET } = getServerEnv();

  if (!CRON_SECRET || request.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return new NextResponse(null, { status: 401 });
  }

  const reminders = await runDailyReminders().catch((error: unknown) => {
    console.error('[reminders] sweep failed', error);
    return null;
  });

  const mail = await sweepMailboxes().catch((error: unknown) => {
    console.error('[google] mailbox sweep failed', error);
    return null;
  });

  const calendar = await publishCalendars().catch((error: unknown) => {
    console.error('[google] calendar publish failed', error);
    return null;
  });

  // El día 1, y sólo el día 1. La fecha se toma en la zona de Panamá porque el
  // servidor en UTC ya cambió de día a las siete de la tarde.
  const dayInPanama = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Panama', day: '2-digit' }).format(
      new Date(),
    ),
  );

  const catalogue =
    dayInPanama === 1
      ? await refreshCatalogue().catch((error: unknown) => {
          console.error('[catalogue] monthly refresh failed', error);
          return null;
        })
      : null;

  // 503 sólo si el trabajo principal de esta ruta falló. Un buzón caído no debe
  // dejar el cron en rojo para siempre: su motivo ya quedó en la fila de
  // conexión, que es donde se mira.
  const status = reminders ? 'ok' : 'error';
  return NextResponse.json(
    { status, reminders, mail, calendar, catalogue },
    { status: reminders ? 200 : 503 },
  );
}
