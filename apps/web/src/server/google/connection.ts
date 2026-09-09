import 'server-only';

import { getAdminDb } from '@app/database';
import { googleConnections } from '@app/database/schema';
import { getServerEnv } from '@app/validation/env';
import { and, eq } from 'drizzle-orm';

import { capabilitiesOf, type GoogleCapability } from './config';
import { open, refreshAccessToken, revokeAtGoogle, seal } from './tokens';

/**
 * Las conexiones de Google, leídas y renovadas.
 *
 * Este archivo es el único que abre un refresh token, y corre siempre con la
 * conexión de administración porque sus dos consumidores son trabajos de fondo:
 * el barrido del buzón y la publicación del calendario. Ninguna pantalla llama
 * aquí y ninguna necesita — un token que llega a un componente de servidor es un
 * token a un paso de un registro de errores.
 *
 * `withAccessToken` es la única puerta. Renueva, guarda el refresco rotado
 * cuando Google lo rota, y marca la conexión como caída con su motivo cuando
 * deja de servir, que es lo que permite que la pantalla diga «reconectá tu
 * cuenta» en vez de dejar de sincronizar en silencio.
 */

export interface StoredConnection {
  readonly id: string;
  readonly householdId: string;
  readonly userId: string;
  readonly googleEmail: string;
  readonly capabilities: readonly GoogleCapability[];
  readonly calendarId: string | null;
  readonly gmailHistoryId: string | null;
}

type AdminDb = ReturnType<typeof getAdminDb>;

function admin(): AdminDb {
  return getAdminDb(getServerEnv().DIRECT_URL);
}

/**
 * Guarda una conexión recién autorizada, o actualiza la que ya había.
 *
 * Reconectar la misma cuenta actualiza en vez de acumular: dos filas de la misma
 * persona serían dos barridos del mismo buzón y el gasto entrando dos veces.
 */
export async function saveConnection(input: {
  householdId: string;
  userId: string;
  googleEmail: string;
  refreshToken: string;
  scopes: readonly string[];
}): Promise<void> {
  const db = admin();
  const sealed = seal(input.refreshToken);

  await db
    .insert(googleConnections)
    .values({
      householdId: input.householdId,
      userId: input.userId,
      googleEmail: input.googleEmail,
      refreshToken: sealed,
      scopes: [...input.scopes],
      status: 'active',
    })
    .onConflictDoUpdate({
      target: [googleConnections.householdId, googleConnections.userId],
      set: {
        googleEmail: input.googleEmail,
        refreshToken: sealed,
        scopes: [...input.scopes],
        status: 'active',
        failedReason: null,
        updatedAt: new Date(),
      },
    });
}

/** Las conexiones vivas de un hogar que sirven para lo que se pide. */
export async function connectionsFor(
  householdId: string,
  capability: GoogleCapability,
): Promise<StoredConnection[]> {
  const rows = await admin()
    .select()
    .from(googleConnections)
    .where(
      and(eq(googleConnections.householdId, householdId), eq(googleConnections.status, 'active')),
    );

  return rows
    .map(toStored)
    .filter((connection) => connection.capabilities.includes(capability));
}

/** Todas las vivas, para el barrido diario. */
export async function activeConnections(capability: GoogleCapability): Promise<StoredConnection[]> {
  const rows = await admin()
    .select()
    .from(googleConnections)
    .where(eq(googleConnections.status, 'active'));

  return rows.map(toStored).filter((one) => one.capabilities.includes(capability));
}

function toStored(row: typeof googleConnections.$inferSelect): StoredConnection {
  return {
    id: row.id,
    householdId: row.householdId,
    userId: row.userId,
    googleEmail: row.googleEmail,
    capabilities: capabilitiesOf(row.scopes),
    calendarId: row.calendarId,
    gmailHistoryId: row.gmailHistoryId,
  };
}

export type AccessResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/**
 * Corre algo con un token de acceso fresco.
 *
 * Se pide uno nuevo cada vez en vez de cachearlo. Dura una hora, cuesta una
 * petición, y guardarlo obligaría a custodiar una segunda credencial viva para
 * ahorrar eso — un mal negocio en un producto que ya decidió no guardar de más.
 */
export async function withAccessToken<T>(
  connection: StoredConnection,
  run: (accessToken: string) => Promise<T>,
): Promise<AccessResult<T>> {
  const db = admin();

  const [row] = await db
    .select({ refreshToken: googleConnections.refreshToken })
    .from(googleConnections)
    .where(eq(googleConnections.id, connection.id))
    .limit(1);

  if (!row) return { ok: false, reason: 'gone' };

  const refresh = open(row.refreshToken);
  if (!refresh) {
    // La llave rotó, o la fila se manipuló. Las dos se arreglan reconectando, y
    // ninguna se arregla reintentando.
    await markFailed(connection.id, 'unreadable_token');
    return { ok: false, reason: 'unreadable_token' };
  }

  const granted = await refreshAccessToken(refresh);
  if (!granted.ok) {
    // `invalid_grant` es que la persona retiró el permiso desde Google. No es un
    // fallo transitorio y reintentarlo mañana no lo arregla.
    if (granted.reason === 'invalid_grant') {
      await markRevoked(connection.id);
      return { ok: false, reason: 'revoked' };
    }
    await markFailed(connection.id, granted.reason);
    return { ok: false, reason: granted.reason };
  }

  if (granted.value.refreshToken && granted.value.refreshToken !== refresh) {
    await db
      .update(googleConnections)
      .set({ refreshToken: seal(granted.value.refreshToken), updatedAt: new Date() })
      .where(eq(googleConnections.id, connection.id));
  }

  try {
    const value = await run(granted.value.accessToken);
    await db
      .update(googleConnections)
      .set({ failedReason: null, updatedAt: new Date() })
      .where(eq(googleConnections.id, connection.id));
    return { ok: true, value };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message.slice(0, 200) : 'unknown';
    await markFailed(connection.id, reason);
    return { ok: false, reason };
  }
}

export async function markFailed(id: string, reason: string): Promise<void> {
  await admin()
    .update(googleConnections)
    .set({ status: 'error', failedReason: reason, updatedAt: new Date() })
    .where(eq(googleConnections.id, id));
}

export async function markRevoked(id: string): Promise<void> {
  await admin()
    .update(googleConnections)
    .set({ status: 'revoked', failedReason: 'revoked_at_google', updatedAt: new Date() })
    .where(eq(googleConnections.id, id));
}

/**
 * Desconecta de verdad: retira el permiso en Google y luego borra la fila.
 *
 * En ese orden. Borrar primero dejaría a la aplicación con acceso al buzón de
 * alguien que cree haberla desconectado, y sin la fila ya no habría token con
 * el que retirarlo.
 */
export async function disconnect(householdId: string, userId: string): Promise<void> {
  const db = admin();

  const [row] = await db
    .select({ id: googleConnections.id, refreshToken: googleConnections.refreshToken })
    .from(googleConnections)
    .where(
      and(eq(googleConnections.householdId, householdId), eq(googleConnections.userId, userId)),
    )
    .limit(1);

  if (!row) return;

  const refresh = open(row.refreshToken);
  if (refresh) await revokeAtGoogle(refresh);

  await db.delete(googleConnections).where(eq(googleConnections.id, row.id));
}
