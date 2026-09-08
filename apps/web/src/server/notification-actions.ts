'use server';

import { notificationPreferences } from '@app/database/schema';
import { z } from 'zod';

import { NOTIFICATION_KINDS } from './repositories/notifications';
import { revalidateScreen } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Choosing what to be told.
 *
 * A preference belongs to a person, not to a household: what one partner wants
 * pushed at them the moment the card comes due is not what the other wants, and
 * a shared setting would make one of them wrong every time.
 *
 * The whole set is saved at once because that is how it is read — a person
 * scans the list, changes two rows, and presses save. Committing each toggle
 * separately would be six writes for one decision.
 */

const KINDS = NOTIFICATION_KINDS as readonly string[];

const CHANNELS = ['email', 'push', 'none'] as const;

export async function savePreferences(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;

  const rows: (typeof notificationPreferences.$inferInsert)[] = [];

  for (const kind of KINDS) {
    const channel = z.enum(CHANNELS).safeParse(formData.get(`channel:${kind}`));
    const throttle = z.coerce
      .number()
      .int()
      .min(0)
      .max(720)
      .safeParse(formData.get(`throttle:${kind}`) ?? '0');

    if (!channel.success || !throttle.success) return { error: 'invalid' };

    rows.push({
      householdId,
      userId: session.user.id,
      kind,
      channel: channel.data,
      throttleHours: throttle.data,
      // «None» is how a person turns one off. Keeping a separate enabled flag
      // in the interface as well would be two controls for one decision.
      isEnabled: channel.data !== 'none',
    });
  }

  await queryAsUser(session, async (tx) => {
    for (const row of rows) {
      await tx
        .insert(notificationPreferences)
        .values(row)
        .onConflictDoUpdate({
          target: [
            notificationPreferences.householdId,
            notificationPreferences.userId,
            notificationPreferences.kind,
          ],
          set: {
            channel: row.channel,
            throttleHours: row.throttleHours,
            isEnabled: row.isEnabled,
            updatedAt: new Date(),
          },
        });
    }
  });

  revalidateScreen(formData, 'notifications');
  return { ok: true };
}
