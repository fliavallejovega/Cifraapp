'use server';

import { alertDismissals } from '@app/database/schema';
import { endOfMonth, todayIn } from '@app/domain';
import { z } from 'zod';

import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * «I know.»
 *
 * The alert itself is derived and is never stored — it is recomputed from the
 * ledger every time the screen opens, so it cannot disagree with the rows
 * behind it. What cannot be derived is that somebody read it and decided to
 * live with it, and an alert that keeps shouting after that is how a household
 * learns to ignore the entire screen.
 *
 * The dismissal expires at the end of the month, deliberately. A budget that is
 * still going to overrun in November is a new fact, and silencing it in October
 * must not silence it then.
 */
export async function dismissAlert(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const key = z.string().trim().min(1).max(200).safeParse(formData.get('id'));
  if (!key.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;
  const expiresOn = endOfMonth(todayIn('America/Panama'));

  await queryAsUser(session, (tx) =>
    tx
      .insert(alertDismissals)
      .values({
        householdId,
        alertKey: key.data,
        dismissedBy: session.user.id,
        expiresOn,
      })
      .onConflictDoUpdate({
        target: [alertDismissals.householdId, alertDismissals.alertKey],
        set: { dismissedBy: session.user.id, dismissedAt: new Date(), expiresOn },
      }),
  );

  revalidateFinancials(formData);
  return { ok: true };
}
