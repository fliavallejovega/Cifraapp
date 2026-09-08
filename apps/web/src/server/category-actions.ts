'use server';

import { categories, transactions } from '@app/database/schema';
import { and, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { firstIssueKey, optionalUuid, recordName } from './record-input';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Spending categories: the household's own vocabulary for where money goes.
 *
 * The tree ships seeded from templates, and until now that was the whole story —
 * a household could not add «school bus» or rename «Groceries» to what they
 * actually call it. A category system a person cannot shape is one they stop
 * using, and then every figure derived from it is a figure about nothing.
 *
 * Two rules the database will not enforce and this file must:
 *
 *   - A system category can be renamed but not removed. It is what the import
 *     pipeline and the seeded rules point at.
 *   - A category with movements filed against it is archived, never deleted.
 *     Deleting would set those movements' category to null and quietly rewrite
 *     three months of reports.
 */

const KINDS = ['income', 'expense', 'transfer', 'investment'] as const;

const categoryInput = z.object({
  name: recordName,
  kind: z.enum(KINDS),
  parentId: optionalUuid,
});

const FIELD_ERRORS = { name: 'nameRequired', kind: 'kindInvalid' } as const;

function parse(formData: FormData) {
  return categoryInput.safeParse({
    name: formData.get('name'),
    kind: formData.get('kind') ?? 'expense',
    parentId: formData.get('parentId'),
  });
}

export async function createCategory(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  const householdId = session.activeHouseholdId;

  const created = await queryAsUser(session, async (tx) => {
    // A child inherits its parent's kind. A «food» expense with an income
    // subcategory under it would make every rollup wrong in a way no screen
    // would show.
    let kind = parsed.data.kind;

    if (parsed.data.parentId) {
      const [parent] = await tx
        .select({ kind: categories.kind })
        .from(categories)
        .where(
          and(eq(categories.id, parsed.data.parentId), eq(categories.householdId, householdId)),
        )
        .limit(1);

      if (!parent) return null;
      kind = parent.kind;
    }

    const [row] = await tx
      .insert(categories)
      .values({
        householdId,
        name: parsed.data.name,
        kind,
        isSystem: false,
        ...(parsed.data.parentId ? { parentId: parsed.data.parentId } : {}),
      })
      .returning({ id: categories.id });

    return row ?? null;
  });

  if (!created) return { error: 'createFailed' };

  revalidateFinancials(formData);
  return { created: created.id };
}

export async function updateCategory(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: firstIssueKey(parsed.error, FIELD_ERRORS) };

  // A category cannot be its own parent, and the check is here rather than in
  // the schema because the id only exists at this point.
  if (parsed.data.parentId === id.data) return { error: 'parentIsSelf' };

  const householdId = session.activeHouseholdId;

  const updated = await queryAsUser(session, async (tx) => {
    const [existing] = await tx
      .select({ isSystem: categories.isSystem, kind: categories.kind })
      .from(categories)
      .where(and(eq(categories.id, id.data), eq(categories.householdId, householdId)))
      .limit(1);

    if (!existing) return null;

    // A seeded category keeps its kind. Rules and templates point at what it is,
    // not at what it is called, so the name is the part that is safe to change.
    const kind = existing.isSystem ? existing.kind : parsed.data.kind;

    const [row] = await tx
      .update(categories)
      .set({
        name: parsed.data.name,
        kind,
        parentId: parsed.data.parentId ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(categories.id, id.data), eq(categories.householdId, householdId)))
      .returning({ id: categories.id });

    return row ?? null;
  });

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

/**
 * Removes a category, or archives it when removing would rewrite history.
 *
 * The distinction is not a nicety. A category with three months of groceries
 * behind it, deleted, leaves those movements uncategorized and every report
 * that mentioned food silently different. Archived, it stops being offered and
 * keeps answering for what already happened.
 */
export async function removeCategory(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    const [existing] = await tx
      .select({ isSystem: categories.isSystem, archivedAt: categories.archivedAt })
      .from(categories)
      .where(and(eq(categories.id, id.data), eq(categories.householdId, householdId)))
      .limit(1);

    if (!existing) return 'notFound' as const;

    // Already archived, and asked for again: bring it back. The same control
    // reads «archive» or «restore» depending on where the row stands.
    if (existing.archivedAt !== null) {
      await tx
        .update(categories)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(eq(categories.id, id.data));
      return 'ok' as const;
    }

    const [used] = await tx
      .select({ total: count() })
      .from(transactions)
      .where(
        and(
          eq(transactions.categoryId, id.data),
          eq(transactions.householdId, householdId),
          isNull(transactions.deletedAt),
        ),
      );

    const [children] = await tx
      .select({ total: count() })
      .from(categories)
      .where(and(eq(categories.parentId, id.data), isNull(categories.archivedAt)));

    const inUse = (used?.total ?? 0) > 0 || (children?.total ?? 0) > 0 || existing.isSystem;

    if (inUse) {
      await tx
        .update(categories)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(categories.id, id.data));
      return 'ok' as const;
    }

    await tx
      .delete(categories)
      .where(and(eq(categories.id, id.data), eq(categories.householdId, householdId)));

    return 'ok' as const;
  });

  if (outcome === 'notFound') return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}
