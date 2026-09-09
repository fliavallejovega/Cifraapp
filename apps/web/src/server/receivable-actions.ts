'use server';

import { receivables, transactions } from '@app/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { currencyOf } from './household-context';
import { firstIssueKey, positiveAmount, recordName } from './record-input';
import { revalidateFinancials } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * What the household is owed: recording it, and closing it against real money.
 *
 * Nothing in the product created one of these except the setup questionnaire,
 * which meant an independent professional could state their pipeline once, on
 * day one, and never again. That is precisely backwards — the pipeline is the
 * part that changes weekly.
 *
 * The window is the addition that makes this useful. «Entre el 1 y el 10» is
 * what a freelancer actually knows, and it is enough to build a calendar with.
 * It is not enough to spend against, and nothing here changes that: a
 * receivable never reaches `safeToSpend`, whatever its confidence.
 */

const CONFIDENCES = ['confirmed', 'likely', 'estimated'] as const;

const optionalDate = z.preprocess(
  (value) => (value === '' || value === null || value === undefined ? undefined : value),
  z.iso.date().optional(),
);

const receivableInput = z
  .object({
    name: recordName,
    source: z.string().trim().max(120).optional(),
    amount: positiveAmount,
    expectedFrom: optionalDate,
    expectedTo: optionalDate,
    confidence: z.enum(CONFIDENCES).default('estimated'),
    notes: z.string().trim().max(500).optional(),
  })
  // A window that ends before it starts is a typo, and storing it would put a
  // negative stretch of calendar into the plan.
  .refine(
    (value) => !value.expectedFrom || !value.expectedTo || value.expectedFrom <= value.expectedTo,
    { path: ['expectedTo'], message: 'windowInverted' },
  );

const FIELD_ERRORS = {
  name: 'nameRequired',
  amount: 'amountInvalid',
  expectedFrom: 'dateInvalid',
  expectedTo: 'windowInverted',
} as const;

function parse(formData: FormData) {
  const from = formData.get('expectedFrom');
  const to = formData.get('expectedTo');

  return receivableInput.safeParse({
    name: formData.get('name'),
    source: formData.get('source') ?? undefined,
    amount: formData.get('amount'),
    expectedFrom: from,
    // One date typed and the other blank means an exact day, not half a
    // window. Filling it in here keeps every reader downstream from having to
    // handle a third shape.
    expectedTo: to === '' || to === null ? from : to,
    confidence: formData.get('confidence') ?? 'estimated',
    notes: formData.get('notes') ?? undefined,
  });
}

export async function createReceivable(
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
      .insert(receivables)
      .values({
        householdId,
        name: parsed.data.name,
        source: parsed.data.source ?? null,
        amount: parsed.data.amount,
        currency: currencyOf(session, householdId),
        expectedFrom: parsed.data.expectedFrom ?? null,
        expectedTo: parsed.data.expectedTo ?? null,
        // Kept in step for anything still reading the single date.
        expectedOn:
          parsed.data.expectedFrom && parsed.data.expectedFrom === parsed.data.expectedTo
            ? parsed.data.expectedFrom
            : null,
        confidence: parsed.data.confidence,
        notes: parsed.data.notes ?? null,
      })
      .returning({ id: receivables.id }),
  );

  if (!created) return { error: 'createFailed' };

  revalidateFinancials(formData);
  return { created: created.id };
}

export async function updateReceivable(
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
      .update(receivables)
      .set({
        name: parsed.data.name,
        source: parsed.data.source ?? null,
        amount: parsed.data.amount,
        expectedFrom: parsed.data.expectedFrom ?? null,
        expectedTo: parsed.data.expectedTo ?? null,
        expectedOn:
          parsed.data.expectedFrom && parsed.data.expectedFrom === parsed.data.expectedTo
            ? parsed.data.expectedFrom
            : null,
        confidence: parsed.data.confidence,
        notes: parsed.data.notes ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(receivables.id, id.data),
          eq(receivables.householdId, householdId),
          isNull(receivables.deletedAt),
        ),
      )
      .returning({ id: receivables.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

export async function removeReceivable(
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
      .update(receivables)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(receivables.id, id.data),
          eq(receivables.householdId, householdId),
          isNull(receivables.deletedAt),
        ),
      )
      .returning({ id: receivables.id }),
  );

  if (!removed) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}

/**
 * Closing an expectation against the movement that actually paid it.
 *
 * The match is confirmed by a person and never applied by the matcher, and the
 * reason is not caution for its own sake: settling the wrong receivable writes
 * off an invoice nobody paid, and the household stops chasing money it is still
 * owed. The proposal does the looking; the household does the deciding.
 *
 * The date recorded is the movement's, not today's. When it was collected is a
 * fact about the money, and stamping the day somebody got round to confirming
 * it would quietly move every collection forward in the record.
 */
export async function confirmReceivableMatch(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const receivableId = z.uuid().safeParse(formData.get('receivableId'));
  const transactionId = z.uuid().safeParse(formData.get('transactionId'));
  if (!receivableId.success || !transactionId.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const outcome = await queryAsUser(session, async (tx) => {
    const [movement] = await tx
      .select({ id: transactions.id, date: transactions.transactionDate })
      .from(transactions)
      .where(
        and(
          eq(transactions.id, transactionId.data),
          eq(transactions.householdId, householdId),
          eq(transactions.direction, 'inflow'),
          isNull(transactions.deletedAt),
        ),
      )
      .limit(1);

    if (!movement) return 'notFound' as const;

    // A movement already claimed by another expectation must not be spent
    // twice; the partial unique index refuses it, and this is the readable
    // half of that guard.
    const [claimed] = await tx
      .select({ id: receivables.id })
      .from(receivables)
      .where(and(eq(receivables.receivedTransactionId, movement.id), isNull(receivables.deletedAt)))
      .limit(1);

    if (claimed && claimed.id !== receivableId.data) return 'alreadyMatched' as const;

    const [updated] = await tx
      .update(receivables)
      .set({
        receivedOn: movement.date,
        receivedTransactionId: movement.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(receivables.id, receivableId.data),
          eq(receivables.householdId, householdId),
          isNull(receivables.deletedAt),
        ),
      )
      .returning({ id: receivables.id });

    return updated ? ('ok' as const) : ('notFound' as const);
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  return { ok: true };
}

/** Undoing a collection, when the match turned out to be the wrong money. */
export async function reopenReceivable(
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
      .update(receivables)
      .set({ receivedOn: null, receivedTransactionId: null, updatedAt: new Date() })
      .where(
        and(
          eq(receivables.id, id.data),
          eq(receivables.householdId, householdId),
          isNull(receivables.deletedAt),
        ),
      )
      .returning({ id: receivables.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  return { ok: true };
}
