'use server';

import { goals } from '@app/database/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { currencyOf } from './household-context';
import { firstIssueKey, optionalPlainDate, positiveAmount, recordName } from './record-input';
import { revalidateFinancials, revalidateScreen } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Goals: what the household is saving toward.
 *
 * Priority is an integer and lower wins, matching the allocation engine's
 * ladder. The form offers it as a choice of three — first, next, later — because
 * «100 or 200» is a database detail and nobody ranks their own life numerically.
 *
 * `currentAmount` is stored rather than derived. A goal may be funded from an
 * account the product can see, from an envelope it cannot, or from both; the
 * figure a household states about its own savings is the figure it gets to
 * state, and the detail screen shows the linked account's movement beside it
 * rather than overwriting it.
 */

const PRIORITIES = ['100', '200', '300'] as const;
const STATUSES = ['active', 'reached', 'paused', 'abandoned'] as const;

const goalInput = z.object({
  name: recordName,
  targetAmount: positiveAmount,
  currentAmount: positiveAmount,
  targetDate: optionalPlainDate,
  priority: z.enum(PRIORITIES),
  status: z.enum(STATUSES),
});

const FIELD_ERRORS = {
  name: 'nameRequired',
  targetAmount: 'targetInvalid',
  currentAmount: 'savedInvalid',
  targetDate: 'dateInvalid',
  priority: 'priorityInvalid',
  status: 'statusInvalid',
} as const;

function parse(formData: FormData) {
  return goalInput.safeParse({
    name: formData.get('name'),
    targetAmount: formData.get('targetAmount'),
    currentAmount: formData.get('currentAmount') ?? '0',
    targetDate: formData.get('targetDate'),
    priority: formData.get('priority') ?? '100',
    status: formData.get('status') ?? 'active',
  });
}

export async function createGoal(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;

  const [created] = await queryAsUser(session, (tx) =>
    tx
      .insert(goals)
      .values({
        householdId,
        createdBy: session.user.id,
        name: parsed.data.name,
        targetAmount: parsed.data.targetAmount,
        currentAmount: parsed.data.currentAmount,
        currency: currencyOf(session, householdId),
        priority: Number(parsed.data.priority),
        status: parsed.data.status,
        ...(parsed.data.targetDate ? { targetDate: parsed.data.targetDate } : {}),
      })
      .returning({ id: goals.id }),
  );

  if (!created) return { error: 'createFailed' };

  revalidateFinancials(formData);
  return { created: created.id };
}

export async function updateGoal(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(goals)
      .set({
        name: parsed.data.name,
        targetAmount: parsed.data.targetAmount,
        currentAmount: parsed.data.currentAmount,
        targetDate: parsed.data.targetDate ?? null,
        priority: Number(parsed.data.priority),
        status: parsed.data.status,
        updatedAt: new Date(),
      })
      .where(and(eq(goals.id, id.data), eq(goals.householdId, householdId)))
      .returning({ id: goals.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  revalidateScreen(formData, `goals/${id.data}`);
  return { ok: true };
}

/**
 * Abandons a goal.
 *
 * `goals` has no `deleted_at` and does not need one: the status enum already
 * carries «abandoned», which says more than a missing row ever could. A goal
 * that was given up on is a thing that happened, and the household is allowed
 * to see that it happened.
 */
export async function removeGoal(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const [removed] = await queryAsUser(session, (tx) =>
    tx
      .update(goals)
      .set({ status: 'abandoned', updatedAt: new Date() })
      .where(and(eq(goals.id, id.data), eq(goals.householdId, householdId)))
      .returning({ id: goals.id }),
  );

  if (!removed) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}
