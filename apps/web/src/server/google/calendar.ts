import 'server-only';

import { getAdminDb } from '@app/database';
import { googleConnections } from '@app/database/schema';
import { formatMoney, type Money, type PlainDate } from '@app/domain';
import { getClientEnv, getServerEnv } from '@app/validation/env';
import { eq } from 'drizzle-orm';

import { withAccessToken, type StoredConnection } from './connection';

/**
 * Los compromisos, escritos en el Google Calendar del hogar.
 *
 * El calendario suscribible por URL (`/api/calendar/[token]`) ya cubre a Apple
 * Calendar, a Outlook y al propio Google. Esto existe porque un calendario
 * suscrito en Google es **de sólo lectura**: no se puede marcar hecho, no se
 * puede arrastrar, y el aviso lo decide el cliente y no la persona. Con la
 * cuenta conectada, los compromisos son eventos de verdad en un calendario
 * propio, con sus recordatorios y su color, y quien los mira puede tocarlos.
 *
 * ## En su propio calendario, nunca en el principal
 *
 * Escribir en el calendario personal de alguien y luego tener que retirarlo es
 * una operación que no sale bien: hay que recordar qué evento era de quién,
 * hay que no borrar el cumpleaños que se llama igual. Un calendario aparte se
 * apaga borrando uno, y mientras tanto se puede ocultar con una casilla sin
 * desconectar nada.
 *
 * ## Idempotente por construcción
 *
 * El `id` del evento se deriva del identificador del compromiso, así que
 * sincronizar dos veces actualiza el mismo evento en vez de crear dos. Un
 * compromiso que se salda se borra; uno que cambia de monto o de día se
 * reescribe. Esa es toda la máquina de estados, y es la que hace que un barrido
 * interrumpido a la mitad se pueda repetir sin pensarlo.
 */

const API = 'https://www.googleapis.com/calendar/v3';

export const CALENDAR_SUMMARY = 'Cifraapp · Compromisos';

/** Lo que se publica de cada compromiso. */
export interface CalendarEntry {
  readonly id: string;
  readonly label: string;
  readonly due: PlainDate;
  readonly amount: Money;
  readonly coverage: 'covered' | 'conditional' | 'uncovered' | null;
  readonly note: string | null;
}

export interface SyncOutcome {
  readonly written: number;
  readonly removed: number;
  readonly failed: number;
  readonly reason: string | null;
}

/**
 * Publica los compromisos de un hogar en el calendario de una conexión.
 *
 * `settledIds` son los que dejaron de existir —pagados, borrados, fuera del
 * horizonte— y hay que retirar. Se pasan explícitamente en vez de deducirlos
 * listando el calendario: listar y diferenciar convierte cada sincronización en
 * una lectura completa, y un evento que alguien movió a mano se borraría por
 * «no coincidir».
 */
export async function syncCommitments(
  connection: StoredConnection,
  entries: readonly CalendarEntry[],
  settledIds: readonly string[],
): Promise<SyncOutcome> {
  const result = await withAccessToken(connection, async (accessToken) => {
    const calendarId = connection.calendarId ?? (await ensureCalendar(accessToken, connection.id));

    let written = 0;
    let removed = 0;
    let failed = 0;

    for (const entry of entries) {
      const ok = await upsertEvent(accessToken, calendarId, entry);
      if (ok) written += 1;
      else failed += 1;
    }

    for (const id of settledIds) {
      const ok = await deleteEvent(accessToken, calendarId, eventIdOf(id));
      if (ok) removed += 1;
    }

    await getAdminDb(getServerEnv().DIRECT_URL)
      .update(googleConnections)
      .set({ calendarLastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(googleConnections.id, connection.id));

    return { written, removed, failed, reason: null };
  });

  return result.ok ? result.value : { written: 0, removed: 0, failed: 0, reason: result.reason };
}

/** Crea el calendario propio la primera vez, y recuerda cuál es. */
async function ensureCalendar(accessToken: string, connectionId: string): Promise<string> {
  const response = await fetch(`${API}/calendars`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      summary: CALENDAR_SUMMARY,
      description:
        'Los compromisos que Cifraapp lleva. Se actualiza solo; editarlos aquí no cambia el plan.',
      timeZone: 'America/Panama',
    }),
  });

  if (!response.ok) throw new Error(`calendar_create_${String(response.status)}`);

  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== 'string') throw new Error('calendar_create_malformed');

  await getAdminDb(getServerEnv().DIRECT_URL)
    .update(googleConnections)
    .set({ calendarId: body.id, updatedAt: new Date() })
    .where(eq(googleConnections.id, connectionId));

  return body.id;
}

/**
 * El identificador del evento, derivado del compromiso.
 *
 * Google acepta base32hex en minúsculas, entre 5 y 1024 caracteres. Un UUID con
 * guiones no pasa, así que se limpia y se le pone un prefijo — el prefijo evita
 * chocar con lo que ya hubiera en el calendario y hace evidente de dónde salió.
 */
export function eventIdOf(commitmentId: string): string {
  const cleaned = commitmentId.toLowerCase().replace(/[^0-9a-v]/g, '');
  return `cifraapp${cleaned}`.slice(0, 1024);
}

async function upsertEvent(
  accessToken: string,
  calendarId: string,
  entry: CalendarEntry,
): Promise<boolean> {
  const id = eventIdOf(entry.id);
  const amount = formatMoney(entry.amount, { locale: 'es-PA' });
  const mark = entry.coverage === 'uncovered' ? '⚠ ' : entry.coverage === 'conditional' ? '~ ' : '';

  const body = {
    id,
    summary: `${mark}${amount} · ${entry.label}`,
    description: [
      entry.coverage === 'covered' ? 'Cubierto con lo que hay en cuenta.' : null,
      entry.coverage === 'conditional'
        ? 'Cubierto sólo si entra un cobro que todavía no llegó.'
        : null,
      entry.coverage === 'uncovered'
        ? 'Descubierto: no alcanza ni contando lo que se espera.'
        : null,
      entry.note,
      new URL('/plan', getClientEnv().NEXT_PUBLIC_APP_URL).toString(),
    ]
      .filter((one): one is string => Boolean(one))
      .join('\n'),
    // Día completo: un compromiso vence un día, no a las nueve. Ponerle hora
    // inventa una cita que se solapa con reuniones reales.
    start: { date: entry.due },
    end: { date: nextDay(entry.due) },
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 24 * 60 }] },
  };

  // `PUT` sobre el id que se eligió: crea si no existe y reescribe si existe.
  // Es lo que hace que repetir un barrido interrumpido no duplique nada.
  const response = await fetch(
    `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  return response.ok;
}

async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<boolean> {
  const response = await fetch(
    `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } },
  );

  // 410 es «ya estaba borrado», que para este barrido es exactamente lo mismo
  // que haberlo borrado ahora.
  return response.ok || response.status === 410 || response.status === 404;
}

/** El día siguiente: `end` de un evento de día completo es exclusivo. */
function nextDay(date: PlainDate): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const moved = new Date(Date.UTC(year, month - 1, day + 1));
  return moved.toISOString().slice(0, 10);
}
