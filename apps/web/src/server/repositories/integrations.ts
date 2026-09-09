import 'server-only';

import { calendarFeeds, googleConnections } from '@app/database/schema';
import { getClientEnv } from '@app/validation/env';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { capabilitiesOf, type GoogleCapability } from '../google/config';
import { queryAsUser, type Session } from '../session';

/**
 * Lo que el hogar tiene conectado hacia fuera.
 *
 * Deliberadamente **sin tokens**. Esta función la llaman componentes de servidor
 * que renderizan una pantalla, y un refresh token que llega a un componente es
 * un token a un paso de un registro de errores. Lo que la pantalla necesita es
 * de qué cuenta se trata, qué permisos dio y si sigue viva; nada de eso es el
 * secreto.
 *
 * Del enlace de calendario sale la pista de seis caracteres y no la dirección
 * completa, por la misma razón: el token se guarda hasheado y no se puede
 * reconstruir, que es exactamente lo que se quiere.
 */

export interface GoogleConnectionView {
  readonly id: string;
  readonly googleEmail: string;
  readonly capabilities: readonly GoogleCapability[];
  readonly status: 'active' | 'revoked' | 'error';
  readonly failedReason: string | null;
  readonly isMine: boolean;
  readonly gmailLastSyncedAt: Date | null;
  readonly calendarLastSyncedAt: Date | null;
}

export interface CalendarFeedView {
  readonly id: string;
  readonly label: string | null;
  readonly hint: string;
  readonly horizonDays: number;
  readonly lastReadAt: Date | null;
  readonly readCount: number;
  readonly createdAt: Date;
}

export interface IntegrationsView {
  readonly google: readonly GoogleConnectionView[];
  readonly feeds: readonly CalendarFeedView[];
  /** La base sobre la que se arma un enlace, para poder enseñar su forma. */
  readonly feedBase: string;
}

export async function loadIntegrations(
  session: Session,
  householdId: string,
): Promise<IntegrationsView> {
  return queryAsUser(session, async (tx) => {
    const [connections, feeds] = await Promise.all([
      tx
        .select({
          id: googleConnections.id,
          userId: googleConnections.userId,
          googleEmail: googleConnections.googleEmail,
          scopes: googleConnections.scopes,
          status: googleConnections.status,
          failedReason: googleConnections.failedReason,
          gmailLastSyncedAt: googleConnections.gmailLastSyncedAt,
          calendarLastSyncedAt: googleConnections.calendarLastSyncedAt,
        })
        .from(googleConnections)
        .where(eq(googleConnections.householdId, householdId)),
      tx
        .select({
          id: calendarFeeds.id,
          label: calendarFeeds.label,
          hint: calendarFeeds.tokenHint,
          horizonDays: calendarFeeds.horizonDays,
          lastReadAt: calendarFeeds.lastReadAt,
          readCount: calendarFeeds.readCount,
          createdAt: calendarFeeds.createdAt,
        })
        .from(calendarFeeds)
        .where(
          and(eq(calendarFeeds.householdId, householdId), isNull(calendarFeeds.revokedAt)),
        )
        .orderBy(desc(calendarFeeds.createdAt)),
    ]);

    return {
      google: connections.map((row) => ({
        id: row.id,
        googleEmail: row.googleEmail,
        capabilities: capabilitiesOf(row.scopes),
        status: row.status as GoogleConnectionView['status'],
        failedReason: row.failedReason,
        // Sólo quien la autorizó puede quitarla: desconectar el buzón de otro
        // miembro sería tocar su cuenta de correo.
        isMine: row.userId === session.profile.id,
        gmailLastSyncedAt: row.gmailLastSyncedAt,
        calendarLastSyncedAt: row.calendarLastSyncedAt,
      })),
      feeds,
      feedBase: new URL('/api/calendar/', getClientEnv().NEXT_PUBLIC_APP_URL).toString(),
    };
  });
}
