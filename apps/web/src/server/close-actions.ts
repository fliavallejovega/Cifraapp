'use server';

import { accountingPeriods } from '@app/database/schema';
import { isPlainDate, todayIn } from '@app/domain';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { loadClose } from './repositories/close';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Sealing a month, and unsealing one.
 *
 * A closed period is a promise that the figures quoted from it will not change
 * underneath whoever quoted them. So closing is refused while anything the
 * engine calls blocking is still outstanding — a month sealed over eleven
 * uncategorized movements is a promise about numbers already known to be wrong.
 *
 * Reopening demands a reason, and stores it. Somebody will eventually ask why
 * the figures they were given in March are not the figures in the system in
 * June, and «it was reopened on the 4th to correct a duplicated salary» is the
 * only acceptable answer.
 */

const monthInput = z.object({
  month: z.string().refine(isPlainDate),
});

export async function closePeriod(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = monthInput.safeParse({ month: formData.get('month') });
  if (!parsed.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;
  const today = todayIn('America/Panama');

  const view = await loadClose(session, householdId, today, parsed.data.month);

  // Re-checked here rather than trusted from the screen. The button was drawn
  // from a checklist computed seconds ago, and a partner on another device may
  // have imported a statement in between.
  if (!view.checklist.mayClose) return { error: 'blockedByChecklist' };

  await queryAsUser(session, (tx) =>
    tx
      .insert(accountingPeriods)
      .values({
        householdId,
        periodStart: view.period.start,
        periodEnd: view.period.end,
        status: 'closed',
        // The checklist as it stood at close. «We closed with four unreviewed
        // transfers» has to stay answerable afterwards.
        checklist: view.checklist,
        closedBy: session.user.id,
        closedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          accountingPeriods.householdId,
          accountingPeriods.periodStart,
          accountingPeriods.periodEnd,
        ],
        set: {
          status: 'closed',
          checklist: view.checklist,
          closedBy: session.user.id,
          closedAt: new Date(),
          reopenedAt: null,
          reopenedBy: null,
          reopenReason: null,
          updatedAt: new Date(),
        },
      }),
  );

  revalidateFinancials(formData);
  return { ok: true };
}

const reopenInput = z.object({
  id: z.uuid(),
  reason: z.string().trim().min(5).max(500),
});

export async function reopenPeriod(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = reopenInput.safeParse({
    id: formData.get('id'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) return { error: 'reasonRequired' };

  const householdId = session.activeHouseholdId;

  const [reopened] = await queryAsUser(session, (tx) =>
    tx
      .update(accountingPeriods)
      .set({
        status: 'reopened',
        reopenedBy: session.user.id,
        reopenedAt: new Date(),
        reopenReason: parsed.data.reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(accountingPeriods.id, parsed.data.id),
          eq(accountingPeriods.householdId, householdId),
        ),
      )
      .returning({ id: accountingPeriods.id }),
  );

  if (!reopened) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}
