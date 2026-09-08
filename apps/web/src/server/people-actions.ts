'use server';

import { householdPeople, householdSettings } from '@app/database/schema';
import { and, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { checkbox, firstIssueKey, optionalText, recordName } from './record-input';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Who lives in the house.
 *
 * The questionnaire recorded «four people, two dependents» and that was the
 * whole of it: enough to reason about a figure, not enough to show anyone. This
 * is the list that makes «who is the second earner» and «which child is this
 * expense for» answerable.
 *
 * Recording a person also keeps `household_settings` honest. The counts the
 * plan reads are updated from the list whenever the list changes, so the two
 * can never drift into saying different things about the same household.
 */

const RELATIONSHIPS = ['self', 'partner', 'child', 'parent', 'sibling', 'other'] as const;

const optionalYear = z.preprocess(
  (value) => (value === '' || value === undefined || value === null ? undefined : value),
  z.coerce.number().int().min(1900).max(2200).optional(),
);

const personInput = z.object({
  displayName: recordName,
  relationship: z.enum(RELATIONSHIPS),
  isDependent: checkbox,
  birthYear: optionalYear,
  notes: optionalText,
});

const FIELD_ERRORS = {
  displayName: 'nameRequired',
  relationship: 'relationshipInvalid',
  birthYear: 'yearInvalid',
} as const;

function parse(formData: FormData) {
  return personInput.safeParse({
    displayName: formData.get('displayName'),
    relationship: formData.get('relationship') ?? 'other',
    isDependent: formData.get('isDependent'),
    birthYear: formData.get('birthYear'),
    notes: formData.get('notes'),
  });
}

export async function createPerson(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;

  const created = await queryAsUser(session, async (tx) => {
    const [row] = await tx
      .insert(householdPeople)
      .values({
        householdId,
        createdBy: session.user.id,
        displayName: parsed.data.displayName,
        relationship: parsed.data.relationship,
        isDependent: parsed.data.isDependent,
        ...(parsed.data.birthYear === undefined ? {} : { birthYear: parsed.data.birthYear }),
        ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
      })
      .returning({ id: householdPeople.id });

    if (row) await syncCounts(tx, householdId);
    return row ?? null;
  });

  if (!created) return { error: 'createFailed' };

  revalidateFinancials(formData);
  return { created: created.id };
}

export async function updatePerson(
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

  const updated = await queryAsUser(session, async (tx) => {
    const [row] = await tx
      .update(householdPeople)
      .set({
        displayName: parsed.data.displayName,
        relationship: parsed.data.relationship,
        isDependent: parsed.data.isDependent,
        birthYear: parsed.data.birthYear ?? null,
        notes: parsed.data.notes ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(householdPeople.id, id.data),
          eq(householdPeople.householdId, householdId),
          isNull(householdPeople.deletedAt),
        ),
      )
      .returning({ id: householdPeople.id });

    if (row) await syncCounts(tx, householdId);
    return row ?? null;
  });

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

export async function removePerson(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const removed = await queryAsUser(session, async (tx) => {
    const [row] = await tx
      .update(householdPeople)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(householdPeople.id, id.data),
          eq(householdPeople.householdId, householdId),
          isNull(householdPeople.deletedAt),
        ),
      )
      .returning({ id: householdPeople.id });

    if (row) await syncCounts(tx, householdId);
    return row ?? null;
  });

  if (!removed) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

/**
 * Keeps the counts the plan reads equal to the list a person can see.
 *
 * Two records of the same fact will disagree eventually. This makes the list
 * authoritative and the counts derived — the opposite of the questionnaire,
 * where the counts were all there was.
 */
async function syncCounts(
  tx: Parameters<Parameters<typeof queryAsUser>[1]>[0],
  householdId: string,
): Promise<void> {
  const [totals] = await tx
    .select({ total: count() })
    .from(householdPeople)
    .where(and(eq(householdPeople.householdId, householdId), isNull(householdPeople.deletedAt)));

  const [dependents] = await tx
    .select({ total: count() })
    .from(householdPeople)
    .where(
      and(
        eq(householdPeople.householdId, householdId),
        eq(householdPeople.isDependent, true),
        isNull(householdPeople.deletedAt),
      ),
    );

  const memberCount = totals?.total ?? 0;
  // An empty list is not a household of zero people. It means the list has not
  // been filled in, and the stated count stays untouched.
  if (memberCount === 0) return;

  await tx
    .insert(householdSettings)
    .values({
      householdId,
      memberCount,
      dependentCount: dependents?.total ?? 0,
    })
    .onConflictDoUpdate({
      target: householdSettings.householdId,
      set: {
        memberCount,
        dependentCount: dependents?.total ?? 0,
        updatedAt: new Date(),
      },
    });
}
