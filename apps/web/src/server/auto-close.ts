import 'server-only';

import { accountingPeriods } from '@app/database/schema';
import { todayIn } from '@app/domain';

import { loadClose } from './repositories/close';
import { queryAsUser, type Session } from './session';

/**
 * The month closes on its own when nothing is left to decide.
 *
 * Closing used to be a screen a household had to find, every month, to press a
 * button the checklist had already cleared. Now, the first time someone opens
 * the home screen after a month ends, that month is sealed if the checklist
 * allows it — the same checklist, re-read here, with nothing skipped. A month
 * with anything blocking stays open and the close screen says why. A month a
 * person reopened is never closed again behind their back.
 */
export async function closePreviousMonthIfClear(
  session: Session,
  householdId: string,
  timeZone: string,
): Promise<boolean> {
  const view = await loadClose(session, householdId, todayIn(timeZone));
  if (view.current !== null) return false;
  if (view.movementCount === 0 || !view.checklist.mayClose) return false;

  await queryAsUser(session, (tx) =>
    tx
      .insert(accountingPeriods)
      .values({
        householdId,
        periodStart: view.period.start,
        periodEnd: view.period.end,
        status: 'closed',
        checklist: { ...view.checklist, closedAutomatically: true },
        closedBy: session.user.id,
        closedAt: new Date(),
      })
      .onConflictDoNothing(),
  );
  return true;
}
