'use server';

import {
  classificationLog,
  duplicateCandidates,
  merchants,
  obligations,
  recurringSeries,
  transactions,
  transfers,
} from '@app/database/schema';
import { Money } from '@app/domain';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';

import { scheduleAnalysis } from './analysis-service';
import { runQueuedJobs } from './jobs';
import { firstIssueKey, optionalUuid, recordName } from './record-input';
import { learnFromCorrection } from './category-learning';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

type Tx = Parameters<Parameters<typeof queryAsUser<unknown>>[1]>[0];

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

  const updated = await queryAsUser(session, (tx) =>
    settleSeries(tx, {
      householdId,
      userId: session.user.id,
      id: id.data,
      decision: decision.data,
      essential,
    }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

/**
 * Confirms or dismisses one detected series, and turns a confirmed expense into
 * its commitment. Shared by the review queue and by «esto entendimos».
 */
async function settleSeries(
  tx: Tx,
  input: {
    readonly householdId: string;
    readonly userId: string;
    readonly id: string;
    readonly decision: 'confirm' | 'dismiss';
    /** Null keeps what detection decided. */
    readonly essential: boolean | null;
  },
) {
  const [series] = await tx
    .update(recurringSeries)
    .set(
      input.decision === 'confirm'
        ? {
            isActive: true,
            ...(input.essential === null ? {} : { isEssential: input.essential }),
            confirmedBy: input.userId,
            confirmedAt: new Date(),
            updatedAt: new Date(),
          }
        : { deletedAt: new Date(), isActive: false, updatedAt: new Date() },
    )
    .where(
      and(
        eq(recurringSeries.id, input.id),
        eq(recurringSeries.householdId, input.householdId),
        isNull(recurringSeries.deletedAt),
      ),
    )
    .returning({
      id: recurringSeries.id,
      name: recurringSeries.name,
      direction: recurringSeries.direction,
      amount: recurringSeries.expectedAmount,
      currency: recurringSeries.currency,
      frequency: recurringSeries.frequency,
      anchorDays: recurringSeries.anchorDays,
      anchorAmounts: recurringSeries.anchorAmounts,
      next: recurringSeries.nextExpectedDate,
      accountId: recurringSeries.accountId,
      categoryId: recurringSeries.categoryId,
      merchantId: recurringSeries.merchantId,
      isEssential: recurringSeries.isEssential,
    });

  /*
    Un gasto que se repite, confirmado, es un compromiso.

    Antes confirmarlo sólo encendía la serie, y nada leía las series de gasto:
    el plan y el disponible miran los compromisos. La persona decía «sí, esto
    se repite, cuéntalo» y no se contaba. Ahora la confirmación crea el
    compromiso que la serie describe, una sola vez.
  */
  if (series && input.decision === 'confirm' && series.direction === 'outflow') {
    const [existing] = await tx
      .select({ id: obligations.id })
      .from(obligations)
      .where(
        and(
          eq(obligations.householdId, input.householdId),
          eq(obligations.seriesId, series.id),
          isNull(obligations.deletedAt),
        ),
      )
      .limit(1);
    if (!existing) {
      const currency = series.currency.trim() === 'PAB' ? 'PAB' : 'USD';
      await tx.insert(obligations).values({
        householdId: input.householdId,
        name: series.name,
        expectedAmount: Money.fromDecimalString(series.amount, currency).abs().toDecimalString(),
        currency,
        dueDate: series.next,
        frequency: series.frequency,
        anchorDays: series.anchorDays,
        anchorAmounts: series.anchorAmounts,
        isEssential: series.isEssential,
        detectedBy: 'system',
        seriesId: series.id,
        accountId: series.accountId,
        categoryId: series.categoryId,
        merchantId: series.merchantId,
      });
    }
  }

  return series;
}

/**
 * «Esto entendimos — sí, es así.»
 *
 * The income and fixed payments the movements show, confirmed in one tap
 * instead of one screen each. Each keeps whether detection judged it essential;
 * a person who disagrees with one dismisses it on its own.
 */
export async function confirmUnderstood(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };
  const householdId = session.activeHouseholdId;

  const ids = z.array(z.uuid()).max(50).safeParse(formData.getAll('id'));
  if (!ids.success || ids.data.length === 0) return { error: 'notFound' };

  await queryAsUser(session, async (tx) => {
    for (const id of ids.data) {
      await settleSeries(tx, {
        householdId,
        userId: session.user.id,
        id,
        decision: 'confirm',
        essential: null,
      });
    }
  });

  revalidateFinancials(formData);
  return { ok: true };
}

/** Transfers at or above this are safe to confirm in bulk. */
const SAFE_TRANSFER = '0.900';

/**
 * «Aprobar todo lo seguro.»
 *
 * The review queues used to be one decision per row, by design, and a first
 * month of statements meant a hundred taps. Two kinds of item are safe to
 * settle together: transfers the engine is sure of (the same amount leaving
 * one account of the household and arriving in another), and categories that
 * already carry a proposal. Each accepted category also teaches its merchant,
 * so the next statement asks less. Duplicates are not here: deciding that two
 * movements are one is never done in bulk.
 */
export async function approveSafe(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };
  const householdId = session.activeHouseholdId;

  await queryAsUser(session, async (tx) => {
    const sure = await tx
      .update(transfers)
      .set({ confirmedBy: session.user.id, confirmedAt: new Date() })
      .where(
        and(
          eq(transfers.householdId, householdId),
          isNull(transfers.confirmedAt),
          sql`${transfers.confidence} >= ${SAFE_TRANSFER}::numeric`,
        ),
      )
      .returning({ from: transfers.fromTransactionId, to: transfers.toTransactionId });
    const legs = sure.flatMap((pair) => [pair.from, pair.to]);
    if (legs.length > 0) {
      await tx
        .update(transactions)
        .set({ status: 'transfer', updatedAt: new Date() })
        .where(and(eq(transactions.householdId, householdId), inArray(transactions.id, legs)));
    }

    const proposed = await tx
      .update(transactions)
      .set({ status: 'posted', updatedAt: new Date() })
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.status, 'needs_review'),
          isNotNull(transactions.categoryId),
          isNull(transactions.deletedAt),
        ),
      )
      .returning({ id: transactions.id, categoryId: transactions.categoryId });

    for (const row of proposed) {
      if (!row.categoryId) continue;
      await tx.insert(classificationLog).values({
        householdId,
        transactionId: row.id,
        categoryId: row.categoryId,
        source: 'user',
        confidence: '1.000',
        actorId: session.user.id,
        reason: 'Accepted with everything safe from the review screen.',
      });
      await learnFromCorrection(tx, {
        householdId,
        transactionId: row.id,
        categoryId: row.categoryId,
      });
    }
  });

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
    // A movement with no proposal needs a category chosen, not an empty «yes».
    if (!categoryId.data && !existing.categoryId) return 'categoryRequired' as const;

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

    const chosen = categoryId.data ?? existing.categoryId;
    if (chosen) {
      await learnFromCorrection(tx, { householdId, transactionId: id.data, categoryId: chosen });
    }

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
