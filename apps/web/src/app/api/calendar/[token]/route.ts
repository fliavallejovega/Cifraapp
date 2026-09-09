import { calendarFor } from '@/server/calendar-feed';

/**
 * El calendario de compromisos, en el formato que suscriben Apple y Google.
 *
 * Diez líneas y ninguna decisión: todo lo que se puede equivocar —resolver el
 * token, filtrar por hogar, proyectar las fechas, escribir el `.ics`— está en
 * `calendar-feed.ts` y en `@app/budget-engine`, donde se puede probar sin
 * levantar un servidor.
 *
 * `no-store` porque un calendario que se cachea es un calendario que enseña el
 * compromiso de ayer, y porque el cliente ya trae su propio intervalo de
 * refresco dentro del archivo.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const calendar = await calendarFor(token);

  if (!calendar) {
    // Sin cuerpo y sin detalle: un enlace que no vale y uno revocado se
    // responden igual, para no ayudar a quien esté probando direcciones.
    return new Response(null, { status: 404 });
  }

  return new Response(calendar.body, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="cifraapp.ics"',
      'cache-control': 'no-store, max-age=0',
      // Este contenido no lo interpreta un navegador y no debe indexarse.
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
