import 'server-only';

import { notificationDeliveries, notificationPreferences } from '@app/database/schema';
import { and, desc, eq } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * What this member wants to be told, and what they were actually told.
 *
 * The kinds are declared here rather than in the database because each one is a
 * condition some code computes: adding one means writing that code, and a row
 * naming a kind nothing produces would be a promise the product cannot keep.
 *
 * The defaults are the ones worth defending. The two that can cost real money —
 * a payment coming due, and the buffer going negative — arrive as they happen.
 * Everything else is a weekly digest, because a product that notifies about
 * everything gets muted, and then it notifies about nothing.
 */

export const NOTIFICATION_KINDS = [
  'commitmentDue',
  'bufferNegative',
  'budgetPace',
  'importFinished',
  'reviewBacklog',
  'weeklySummary',
  'thirteenthMonth',
  'statementUpload',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

interface KindDefault {
  readonly channel: 'email' | 'push' | 'none';
  readonly throttleHours: number;
  readonly isEnabled: boolean;
}

const DEFAULTS: Readonly<Record<NotificationKind, KindDefault>> = {
  // Money is about to leave. Immediate, or it is pointless.
  commitmentDue: { channel: 'email', throttleHours: 0, isEnabled: true },
  bufferNegative: { channel: 'email', throttleHours: 0, isEnabled: true },
  budgetPace: { channel: 'email', throttleHours: 168, isEnabled: true },
  importFinished: { channel: 'email', throttleHours: 0, isEnabled: true },
  reviewBacklog: { channel: 'email', throttleHours: 168, isEnabled: true },
  weeklySummary: { channel: 'email', throttleHours: 168, isEnabled: true },
  /**
   * Las tres partidas del decimotercer mes.
   *
   * Son de las pocas entradas grandes cuya fecha se sabe con meses de
   * anticipación, y la que más fácil se gasta antes de decidir para qué era.
   * Inmediata: avisar tarde de un dinero que ya entró no sirve de nada.
   */
  thirteenthMonth: { channel: 'email', throttleHours: 0, isEnabled: true },
  /**
   * Subir los estados de cuenta, dos veces al mes.
   *
   * Diez días de estrangulamiento: son dos avisos al mes por diseño, y un
   * tercero por un reintento sería el que enseña a ignorarlos.
   */
  statementUpload: { channel: 'email', throttleHours: 24 * 10, isEnabled: true },
};

export interface PreferenceView {
  readonly kind: NotificationKind;
  readonly channel: 'email' | 'push' | 'none';
  readonly throttleHours: number;
  readonly isEnabled: boolean;
  /** True when nothing has been chosen and the default is what is shown. */
  readonly isDefault: boolean;
}

export interface DeliveryView {
  readonly id: string;
  readonly kind: string;
  readonly channel: string;
  readonly title: string;
  readonly body: string;
  readonly status: string;
  readonly reason: string | null;
  readonly createdAt: Date;
}

export async function loadPreferences(
  session: Session,
  householdId: string,
): Promise<readonly PreferenceView[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.householdId, householdId),
          eq(notificationPreferences.userId, session.user.id),
        ),
      ),
  );

  const stored = new Map(rows.map((row) => [row.kind, row]));

  return NOTIFICATION_KINDS.map((kind) => {
    const row = stored.get(kind);
    const fallback = DEFAULTS[kind];

    return {
      kind,
      channel: (row?.channel as PreferenceView['channel']) ?? fallback.channel,
      throttleHours: row?.throttleHours ?? fallback.throttleHours,
      isEnabled: row?.isEnabled ?? fallback.isEnabled,
      isDefault: row === undefined,
    };
  });
}

/**
 * What was actually sent.
 *
 * Shown because «I never got that» is a real conversation, and because a
 * suppressed notice with its reason — throttled, disabled, no channel — is the
 * only way a household can tell «nothing happened» from «we decided not to tell
 * you».
 */
export async function loadDeliveries(
  session: Session,
  householdId: string,
  limit = 25,
): Promise<readonly DeliveryView[]> {
  return queryAsUser(session, (tx) =>
    tx
      .select({
        id: notificationDeliveries.id,
        kind: notificationDeliveries.kind,
        channel: notificationDeliveries.channel,
        title: notificationDeliveries.title,
        body: notificationDeliveries.body,
        status: notificationDeliveries.status,
        reason: notificationDeliveries.reason,
        createdAt: notificationDeliveries.createdAt,
      })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.householdId, householdId))
      .orderBy(desc(notificationDeliveries.createdAt))
      .limit(limit),
  );
}
