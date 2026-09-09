'use server';

import { calendarFeeds } from '@app/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { newFeedToken } from './calendar-feed';
import { disconnect } from './google/connection';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Conectar y desconectar lo de fuera: el calendario y la cuenta de Google.
 *
 * Las dos acciones que crean un secreto lo devuelven **una vez**. El enlace del
 * calendario no se puede volver a leer después —se guarda hasheado— y eso no es
 * una molestia que se pueda ahorrar: es lo que hace que una base de datos
 * filtrada no entregue los compromisos de nadie. La pantalla lo enseña con la
 * advertencia de copiarlo ahora, igual que las invitaciones de miembro.
 */

/** Cuántos enlaces vivos puede tener un hogar. Uno por dispositivo y sobra. */
const MAX_FEEDS = 5;

export async function createCalendarFeed(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const label = z
    .string()
    .trim()
    .max(60)
    .optional()
    .safeParse(formData.get('label') ?? undefined);
  const horizon = z.coerce
    .number()
    .int()
    .min(7)
    .max(400)
    .default(120)
    .safeParse(formData.get('horizonDays') ?? 120);

  if (!horizon.success) return { error: 'horizonInvalid' };

  const householdId = session.activeHouseholdId;
  const { token, hash, hint } = newFeedToken();

  const outcome = await queryAsUser(session, async (tx) => {
    const live = await tx
      .select({ id: calendarFeeds.id })
      .from(calendarFeeds)
      .where(
        and(eq(calendarFeeds.householdId, householdId), isNull(calendarFeeds.revokedAt)),
      );

    if (live.length >= MAX_FEEDS) return 'tooManyFeeds' as const;

    await tx.insert(calendarFeeds).values({
      householdId,
      createdBy: session.profile.id,
      tokenHash: hash,
      tokenHint: hint,
      label: label.success ? (label.data ?? null) : null,
      horizonDays: horizon.data,
    });

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  // El valor en claro viaja de vuelta una vez y no se guarda en ningún sitio.
  return { ok: true, secret: token };
}

export async function revokeCalendarFeed(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  // Se revoca, no se borra. La fila revocada es lo que permite responder «ese
  // enlace lo cortamos el martes» meses después.
  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(calendarFeeds)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(calendarFeeds.id, id.data),
          eq(calendarFeeds.householdId, householdId),
          isNull(calendarFeeds.revokedAt),
        ),
      )
      .returning({ id: calendarFeeds.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

/**
 * Desconectar Google.
 *
 * Retira el permiso en Google antes de borrar la fila. Al revés, la aplicación
 * se quedaría con acceso al buzón de alguien que cree haberla desconectado, y
 * sin la fila ya no habría token con el que retirarlo.
 */
export async function disconnectGoogle(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  await disconnect(session.activeHouseholdId, session.profile.id);

  revalidateFinancials(formData);
  return { ok: true };
}
