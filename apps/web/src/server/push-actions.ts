'use server';

import { pushSubscriptions } from '@app/database/schema';
import { and, eq } from 'drizzle-orm';

import { loadSession, queryAsUser } from './session';

/**
 * Suscribir y dar de baja este navegador.
 *
 * El permiso se pide desde la pantalla de preferencias y no al entrar: pedirlo
 * en la primera visita es la forma más segura de que lo nieguen para siempre, y
 * un permiso negado no se puede volver a pedir desde la aplicación.
 */

export interface PushResult {
  readonly ok: boolean;
  readonly error?: string;
}

export async function subscribeToPush(
  endpoint: string,
  p256dh: string,
  auth: string,
  label: string,
): Promise<PushResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { ok: false, error: 'signInRequired' };
  if (!endpoint.startsWith('https://')) return { ok: false, error: 'invalid' };

  const householdId = session.activeHouseholdId;

  try {
    await queryAsUser(session, async (tx) => {
      await tx
        .insert(pushSubscriptions)
        .values({
          householdId,
          userId: session.profile.id,
          endpoint,
          p256dh,
          auth,
          label: label.slice(0, 80),
        })
        // El mismo navegador que vuelve a suscribirse trae el mismo endpoint:
        // se actualiza en vez de duplicar, o el mismo aviso llegaría dos veces.
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { p256dh, auth, householdId, userId: session.profile.id, updatedAt: new Date() },
        });
    });
    return { ok: true };
  } catch {
    return { ok: false, error: 'saveFailed' };
  }
}

export async function unsubscribeFromPush(endpoint: string): Promise<PushResult> {
  const session = await loadSession();
  if (!session) return { ok: false, error: 'signInRequired' };

  try {
    await queryAsUser(session, async (tx) => {
      await tx
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.endpoint, endpoint),
            eq(pushSubscriptions.userId, session.profile.id),
          ),
        );
    });
    return { ok: true };
  } catch {
    return { ok: false, error: 'saveFailed' };
  }
}
