'use server';

import {
  classificationLog,
  duplicateCandidates,
  merchants,
  recurringSeries,
  transactions,
  transfers,
} from '@app/database/schema';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';

import { scheduleAnalysis } from './analysis-service';
import { runQueuedJobs } from './jobs';
import { firstIssueKey, optionalUuid, recordName } from './record-input';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Resolving what the engines proposed.
 *
 * Every one of these is a person overruling or confirming a machine, and the
 * shape is the same each time: the proposal is marked resolved *and* the
 * consequence is applied in the same transaction. A queue that emptied without
 * changing anything would be a to-do list pretending to be a system.
 */

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

/**
 * «Yes, it is the same movement.»
 *
 * The newer copy is marked `duplicate` rather than deleted. It came from a
 * statement, and a statement's contents are evidence — the household is saying
 * it should not count, not that the bank never sent it.
 */
export async function resolveDuplicate(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  const decision = z.enum(['same', 'different']).safeParse(formData.get('decision'));
  if (!id.success || !decision.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    const [candidate] = await tx
      .select({
        incomingId: duplicateCandidates.incomingTransactionId,
      })
      .from(duplicateCandidates)
      .where(
        and(
          eq(duplicateCandidates.id, id.data),
          eq(duplicateCandidates.householdId, householdId),
          isNull(duplicateCandidates.resolvedAt),
        ),
      )
      .limit(1);

    if (!candidate) return 'notFound' as const;

    if (decision.data === 'same' && candidate.incomingId) {
      await tx
        .update(transactions)
        .set({ status: 'duplicate', updatedAt: new Date() })
        .where(
          and(eq(transactions.id, candidate.incomingId), eq(transactions.householdId, householdId)),
        );
    }

    await tx
      .update(duplicateCandidates)
      .set({
        resolution: decision.data === 'same' ? 'duplicate' : 'distinct',
        resolvedBy: session.user.id,
        resolvedAt: new Date(),
      })
      .where(eq(duplicateCandidates.id, id.data));

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

/**
 * «Yes, that was money moving between my own accounts.»
 *
 * Both legs become `transfer`, which is what takes them out of spending and out
 * of income at once. The card-payment case is the one that matters most: a
 * $1,200 payment counted as an expense double-counts, because the purchases
 * that produced the balance were already counted when they happened.
 */
export async function resolveTransfer(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  const decision = z.enum(['confirm', 'reject']).safeParse(formData.get('decision'));
  if (!id.success || !decision.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    const [candidate] = await tx
      .select({
        fromId: transfers.fromTransactionId,
        toId: transfers.toTransactionId,
      })
      .from(transfers)
      .where(
        and(
          eq(transfers.id, id.data),
          eq(transfers.householdId, householdId),
          isNull(transfers.confirmedAt),
        ),
      )
      .limit(1);

    if (!candidate) return 'notFound' as const;

    if (decision.data === 'confirm') {
      await tx
        .update(transactions)
        .set({ status: 'transfer', updatedAt: new Date() })
        .where(
          and(
            inArray(transactions.id, [candidate.fromId, candidate.toId]),
            eq(transactions.householdId, householdId),
          ),
        );

      await tx
        .update(transfers)
        .set({ confirmedBy: session.user.id, confirmedAt: new Date() })
        .where(eq(transfers.id, id.data));
    } else {
      // Rejected outright. Keeping a rejected pair would mean proposing it
      // again on the next scan, which is how a queue becomes noise.
      await tx.delete(transfers).where(eq(transfers.id, id.data));
    }

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Recurring series
// ---------------------------------------------------------------------------

/**
 * «Yes, that repeats — treat it as a commitment.»
 *
 * A detected series arrives inactive, deliberately: an unconfirmed pattern must
 * not start subtracting from what a household believes it can spend. Confirming
 * is what turns it on.
 */
export async function resolveRecurring(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  const decision = z.enum(['confirm', 'dismiss']).safeParse(formData.get('decision'));
  const essential = formData.get('isEssential') === 'true';
  if (!id.success || !decision.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(recurringSeries)
      .set(
        decision.data === 'confirm'
          ? {
              isActive: true,
              isEssential: essential,
              confirmedBy: session.user.id,
              confirmedAt: new Date(),
              updatedAt: new Date(),
            }
          : { deletedAt: new Date(), isActive: false, updatedAt: new Date() },
      )
      .where(
        and(
          eq(recurringSeries.id, id.data),
          eq(recurringSeries.householdId, householdId),
          isNull(recurringSeries.deletedAt),
        ),
      )
      .returning({ id: recurringSeries.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Uncertain categories
// ---------------------------------------------------------------------------

/**
 * Accepts or corrects a category the engine was not confident about.
 *
 * Either way the movement leaves `needs_review` and the decision is logged as
 * `user`-sourced with confidence 1 — because a person who says «this is
 * groceries» is not making a 62%-confident guess, and storing it as one would
 * let the next automatic pass overwrite them.
 */
export async function resolveCategory(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  const categoryId = optionalUuid.safeParse(formData.get('categoryId'));
  if (!id.success || !categoryId.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    const [existing] = await tx
      .select({
        categoryId: transactions.categoryId,
        categorySource: transactions.categorySource,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.id, id.data),
          eq(transactions.householdId, householdId),
          isNull(transactions.deletedAt),
        ),
      )
      .limit(1);

    if (!existing) return 'notFound' as const;

    await tx
      .update(transactions)
      .set({
        categoryId: categoryId.data ?? existing.categoryId,
        categorySource: 'user',
        categoryConfidence: '1.000',
        status: 'posted',
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, id.data));

    await tx.insert(classificationLog).values({
      householdId,
      transactionId: id.data,
      previousCategoryId: existing.categoryId,
      categoryId: categoryId.data ?? existing.categoryId,
      previousSource: existing.categorySource,
      source: 'user',
      confidence: '1.000',
      actorId: session.user.id,
      reason:
        categoryId.data && categoryId.data !== existing.categoryId
          ? 'Corrected from the review queue.'
          : 'Confirmed from the review queue.',
    });

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Merchants
// ---------------------------------------------------------------------------

const merchantInput = z.object({
  name: recordName,
  defaultCategoryId: optionalUuid,
});

/**
 * «Everything from Super 99 is groceries.»
 *
 * Setting a merchant's category does two things at once, and both are needed
 * for the promise to be true: it changes what the next import will decide, and
 * it applies to the movements already filed under that merchant which nobody
 * has overruled. Only those — a category a person set by hand is never
 * overwritten by a rule they wrote afterwards.
 */
export async function updateMerchant(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const parsed = merchantInput.safeParse({
    name: formData.get('name'),
    defaultCategoryId: formData.get('defaultCategoryId'),
  });
  if (!parsed.success) return { error: firstIssueKey(parsed.error, { name: 'nameRequired' }) };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    const [merchant] = await tx
      .update(merchants)
      .set({
        name: parsed.data.name,
        defaultCategoryId: parsed.data.defaultCategoryId ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(merchants.id, id.data), eq(merchants.householdId, householdId)))
      .returning({ id: merchants.id });

    if (!merchant) return 'notFound' as const;

    if (parsed.data.defaultCategoryId) {
      await tx
        .update(transactions)
        .set({
          categoryId: parsed.data.defaultCategoryId,
          categorySource: 'rule',
          categoryConfidence: '0.950',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(transactions.merchantId, id.data),
            eq(transactions.householdId, householdId),
            isNull(transactions.deletedAt),
            // The line that keeps the promise honest: a person's own decision
            // outranks a rule, always.
            isNull(transactions.categorySource),
          ),
        );
    }

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  return { ok: true };
}

export async function removeMerchant(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  // The movements keep their category and lose only the merchant link, which is
  // a label. Deleting a merchant must not recategorize a household's history.
  const [removed] = await queryAsUser(session, (tx) =>
    tx
      .delete(merchants)
      .where(and(eq(merchants.id, id.data), eq(merchants.householdId, householdId)))
      .returning({ id: merchants.id }),
  );

  if (!removed) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

/** Runs the four scans again, on demand. */
export async function rescanNow(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const householdId = session.activeHouseholdId;
  await scheduleAnalysis(session, householdId);

  after(async () => {
    try {
      await runQueuedJobs();
    } catch (error: unknown) {
      console.error('[review] rescan failed', { householdId, error });
    }
  });

  revalidateFinancials(formData);
  return { ok: true };
}
