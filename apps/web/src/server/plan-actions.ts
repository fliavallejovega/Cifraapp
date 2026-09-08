'use server';

import { allocationLines, allocationPlans } from '@app/database/schema';
import { and, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';

import { currencyOf } from './household-context';
import { loadPlan } from './repositories/plan';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Accepting a plan, and living with it afterwards.
 *
 * Until now the plan was recomputed on every visit and never written down,
 * which made it a suggestion that evaporated. A household could read «put
 * $2,590 against this card», do it, and have nothing to compare against a month
 * later — so «did I do what I decided?» was unanswerable, and a system that
 * cannot answer that cannot help anybody improve.
 *
 * The plan is stored as it was seen. Recomputing it from today's balances would
 * show the household something they never agreed to, which is the one thing a
 * record of a decision must never do.
 */

export async function acceptPlan(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;
  const view = await loadPlan(session, householdId);

  if (view.isEmpty) return { error: 'nothingToAccept' };

  const currency = currencyOf(session, householdId);

  // The engine has no language: a line's reason is a key and its values, and
  // the catalogue turns it into a sentence. What gets stored is the sentence the
  // household actually read, because a record of a decision that renders
  // differently later is not a record of that decision.
  const t = await getTranslations('plan');
  const explain = (line: (typeof view.plan.lines)[number]): string => {
    const sentence = t(`reason.${line.explanation.key}`, line.explanation.values);
    return line.explanation.partialOf
      ? `${sentence} ${t('reason.partial', { requested: line.explanation.partialOf })}`
      : sentence;
  };

  const created = await queryAsUser(session, async (tx) => {
    const [plan] = await tx
      .insert(allocationPlans)
      .values({
        householdId,
        incomingAmount: view.plan.incoming.toDecimalString(),
        currency,
        priorityOrder: [...view.plan.order],
        allocatedAmount: view.plan.allocated.toDecimalString(),
        unallocatedAmount: view.plan.unallocated.toDecimalString(),
        shortfallAmount: view.plan.shortfall.toDecimalString(),
        outcome: 'accepted',
        viewedAt: new Date(),
        decidedAt: new Date(),
        decidedBy: session.user.id,
        generatedFor: view.today,
      })
      .returning({ id: allocationPlans.id });

    if (!plan) return null;

    if (view.plan.lines.length > 0) {
      await tx.insert(allocationLines).values(
        view.plan.lines.map((line, index) => ({
          planId: plan.id,
          kind: line.kind,
          label: line.label,
          target: line.target,
          requestedAmount: line.requested.toDecimalString(),
          allocatedAmount: line.allocated.toDecimalString(),
          position: index,
          explanation: explain(line),
          appliedRuleIds: [...line.appliedRuleIds],
          // The household accepted the plan as it stood, so what they accepted
          // is what was allocated. A modified line would carry a different
          // figure here, and the difference is the record worth having.
          acceptedAmount: line.allocated.toDecimalString(),
          ...referenceOf(line.claimId),
        })),
      );
    }

    return plan;
  });

  if (!created) return { error: 'createFailed' };

  revalidateFinancials(formData);
  return { created: created.id };
}

/** Records that a plan was seen and set aside, which is also a decision. */
export async function dismissPlan(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(allocationPlans)
      .set({ outcome: 'dismissed', decidedAt: new Date(), decidedBy: session.user.id })
      .where(and(eq(allocationPlans.id, id.data), eq(allocationPlans.householdId, householdId)))
      .returning({ id: allocationPlans.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

/**
 * The row a plan line points at, recovered from the claim id.
 *
 * The allocation engine identifies claims by a composed string —
 * `debt-min-<uuid>`, `goal-<uuid>` — because it has no idea what a table is.
 * Storing the reference means a stored plan can still be read months later when
 * the debt has been renamed and the goal has been reached.
 */
function referenceOf(claimId: string): {
  goalId?: string;
  debtId?: string;
  obligationId?: string;
} {
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(claimId)?.[0];
  if (!uuid) return {};

  if (claimId.startsWith('goal-')) return { goalId: uuid };
  if (claimId.startsWith('debt-')) return { debtId: uuid };
  if (claimId.startsWith('obligation-')) return { obligationId: uuid };

  return {};
}
