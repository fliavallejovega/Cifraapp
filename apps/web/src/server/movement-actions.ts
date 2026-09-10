'use server';

import {
  accounts,
  categories,
  classificationLog,
  transactionSplits,
  transactions,
} from '@app/database/schema';
import { Money, type CurrencyCode, type PlainDate } from '@app/domain';
import { computeFingerprint, normalizeDescription } from '@app/transaction-engine';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { currencyOf } from './household-context';
import {
  firstIssueKey,
  optionalText,
  optionalUuid,
  plainDateString,
  positiveAmount,
} from './record-input';
import { applyPaymentToDebt } from './debt-payments';
import { localeOf, revalidateFinancials, revalidateScreen } from './revalidate';
import { loadSession, queryAsUser } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * What a household does to a movement.
 *
 * Correcting a category is the single most-used action in a product like this,
 * and until now there was nowhere to do it. Everything else here exists because
 * of what that correction implies:
 *
 *   - A correction is *logged*. `classification_log` is what makes an automatic
 *     classification undoable and a settled habit detectable, and neither is
 *     recoverable from the transaction row, which only ever holds the current
 *     answer.
 *   - A correction is `user`-sourced with confidence 1. A person who says «this
 *     is groceries» is not making a 78%-confident guess, and storing it as one
 *     would let a later automatic pass overwrite it.
 *   - Excluding is a status, not a deletion. The movement happened; what the
 *     household is saying is that it should not count.
 */

const CORRECTABLE_STATUSES = ['posted', 'pending', 'excluded', 'transfer', 'reconciled'] as const;

export async function setMovementCategory(
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

    // The category has to belong to this household. RLS would already refuse a
    // foreign one, but failing here says «not found» instead of a policy error.
    if (categoryId.data) {
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, categoryId.data), eq(categories.householdId, householdId)))
        .limit(1);
      if (!category) return 'categoryNotFound' as const;
    }

    await tx
      .update(transactions)
      .set({
        categoryId: categoryId.data ?? null,
        categorySource: 'user',
        categoryConfidence: '1.000',
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, id.data));

    await tx.insert(classificationLog).values({
      householdId,
      transactionId: id.data,
      previousCategoryId: existing.categoryId,
      categoryId: categoryId.data ?? null,
      previousSource: existing.categorySource,
      source: 'user',
      confidence: '1.000',
      actorId: session.user.id,
      reason: 'Corrected by a household member.',
    });

    return 'ok' as const;
  });

  if (outcome === 'notFound') return { error: 'notFound' };
  if (outcome === 'categoryNotFound') return { error: 'categoryNotFound' };

  revalidateFinancials(formData);
  revalidateScreen(formData, `movements/${id.data}`);
  return { ok: true };
}

/** Excludes a movement from every figure, or brings it back. */
export async function setMovementStatus(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  const status = z.enum(CORRECTABLE_STATUSES).safeParse(formData.get('status'));
  if (!id.success || !status.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(transactions)
      .set({ status: status.data, updatedAt: new Date() })
      .where(
        and(
          eq(transactions.id, id.data),
          eq(transactions.householdId, householdId),
          isNull(transactions.deletedAt),
        ),
      )
      .returning({ id: transactions.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateFinancials(formData);
  revalidateScreen(formData, `movements/${id.data}`);
  return { ok: true };
}

export async function setMovementNote(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  const note = optionalText.safeParse(formData.get('notes'));
  if (!id.success || !note.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  const [updated] = await queryAsUser(session, (tx) =>
    tx
      .update(transactions)
      .set({ notes: note.data ?? null, updatedAt: new Date() })
      .where(
        and(
          eq(transactions.id, id.data),
          eq(transactions.householdId, householdId),
          isNull(transactions.deletedAt),
        ),
      )
      .returning({ id: transactions.id }),
  );

  if (!updated) return { error: 'notFound' };

  revalidateScreen(formData, `movements/${id.data}`, 'movements');
  return { ok: true };
}

const splitLine = z.object({
  amount: positiveAmount,
  categoryId: optionalUuid,
  personId: optionalUuid,
  note: optionalText,
});

/**
 * Divides one movement across several categories.
 *
 * The whole set is replaced at once rather than edited line by line, because
 * the invariant is about the set: the parts sum to the whole. A per-line editor
 * would have to pass through states where they do not, and the database — which
 * holds that invariant with a deferred constraint trigger — would refuse every
 * one of them.
 *
 * Sending an empty set clears the split, and the movement carries its own
 * single category again.
 */
export async function setMovementSplits(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const id = z.uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'notFound' };

  const raw = formData.get('splits');
  if (typeof raw !== 'string') return { error: 'invalid' };

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { error: 'invalid' };
  }

  const parsed = z.array(splitLine).max(40).safeParse(decoded);
  if (!parsed.success) return { error: 'splitInvalid' };

  const householdId = session.activeHouseholdId;
  const currency = currencyOf(session, householdId) as CurrencyCode;

  const outcome = await queryAsUser(session, async (tx) => {
    const [movement] = await tx
      .select({ amount: transactions.amount })
      .from(transactions)
      .where(
        and(
          eq(transactions.id, id.data),
          eq(transactions.householdId, householdId),
          isNull(transactions.deletedAt),
        ),
      )
      .limit(1);

    if (!movement) return 'notFound' as const;

    await tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, id.data));

    if (parsed.data.length === 0) return 'ok' as const;

    const total = Money.sum(
      parsed.data.map((line) => Money.fromDecimalString(line.amount, currency)),
      currency,
    );
    const whole = Money.fromDecimalString(movement.amount, currency).abs();

    // Checked here as well as in the database. The trigger is the guarantee;
    // this is what turns «check_violation» into a sentence a person can act on.
    if (!total.equals(whole)) return 'splitDoesNotSum' as const;

    await tx.insert(transactionSplits).values(
      parsed.data.map((line, index) => ({
        householdId,
        transactionId: id.data,
        amount: line.amount,
        position: index,
        createdBy: session.user.id,
        ...(line.categoryId ? { categoryId: line.categoryId } : {}),
        ...(line.personId ? { personId: line.personId } : {}),
        ...(line.note ? { note: line.note } : {}),
      })),
    );

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  revalidateScreen(formData, `movements/${id.data}`);
  return { ok: true };
}

const manualInput = z.object({
  accountId: z.uuid(),
  transactionDate: plainDateString,
  amount: positiveAmount,
  direction: z.enum(['inflow', 'outflow']),
  description: z.string().trim().min(1).max(200),
  categoryId: optionalUuid,
  /**
   * La deuda que este movimiento paga, cuando paga una.
   *
   * Es lo que convierte «registrar un gasto» en «registrar un pago». Sin esto,
   * los $500 que alguien le dio a Giovanni en efectivo salían del mes y la
   * deuda seguía diciendo $1,800 — y la casa terminaba llevando esa cuenta en
   * la cabeza, que es el trabajo que este producto existe para quitar.
   */
  debtId: optionalUuid,
  notes: optionalText,
});

const MANUAL_ERRORS = {
  accountId: 'accountRequired',
  debtId: 'notFound',
  transactionDate: 'dateInvalid',
  amount: 'amountInvalid',
  description: 'descriptionRequired',
} as const;

/**
 * Records a movement nobody will ever import.
 *
 * Cash. The taxi, the fonda, the twenty dollars to a neighbour. None of it
 * appears on any statement, and a system that only knows what the bank knows
 * reports a household as spending less than it does — which makes «available»
 * generous in exactly the wrong direction.
 *
 * Marked `source = 'user'` and fingerprinted like everything else, so that if
 * the same charge later arrives in a statement the duplicate engine sees it.
 */
export async function createManualMovement(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const parsed = manualInput.safeParse({
    accountId: formData.get('accountId'),
    transactionDate: formData.get('transactionDate'),
    amount: formData.get('amount'),
    direction: formData.get('direction') ?? 'outflow',
    description: formData.get('description'),
    categoryId: formData.get('categoryId'),
    debtId: formData.get('debtId'),
    notes: formData.get('notes'),
  });

  if (!parsed.success) return { error: firstIssueKey(parsed.error, MANUAL_ERRORS) };

  const householdId = session.activeHouseholdId;
  const currency = currencyOf(session, householdId) as CurrencyCode;
  const { normalized } = normalizeDescription(parsed.data.description);

  const created = await queryAsUser(session, async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, parsed.data.accountId),
          eq(accounts.householdId, householdId),
          isNull(accounts.deletedAt),
        ),
      )
      .limit(1);

    if (!account) return null;

    // The column's own constraint: an outflow is negative and an inflow is
    // positive, always. Storing a magnitude with a direction beside it would
    // let the two disagree, and a month's net cash flow would quietly reverse.
    const magnitude = Money.fromDecimalString(parsed.data.amount, currency).abs();
    const amount = parsed.data.direction === 'outflow' ? magnitude.negate() : magnitude;

    const [row] = await tx
      .insert(transactions)
      .values({
        householdId,
        accountId: parsed.data.accountId,
        ownerId: session.user.id,
        transactionDate: parsed.data.transactionDate,
        amount: amount.toDecimalString(),
        currency,
        direction: parsed.data.direction,
        descriptionOriginal: parsed.data.description,
        descriptionNormalized: normalized,
        status: 'posted',
        source: 'user',
        // Fingerprinted on the signed amount, exactly as the import pipeline
        // does — otherwise the same charge recorded by hand and then imported
        // would hash differently and the duplicate engine would never see it.
        fingerprint: computeFingerprint({
          accountId: parsed.data.accountId,
          // Validated against the `YYYY-MM-DD` shape by the schema above, which
          // is exactly what `PlainDate` asserts (ADR-006).
          transactionDate: parsed.data.transactionDate as PlainDate,
          amount,
          descriptionNormalized: normalized,
        }),
        ...(parsed.data.categoryId
          ? {
              categoryId: parsed.data.categoryId,
              categorySource: 'user' as const,
              categoryConfidence: '1.000',
            }
          : {}),
        ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
      })
      .returning({ id: transactions.id });

    if (!row) return null;

    // Cash leaves the account it came from. A movement that did not move the
    // balance would make the position disagree with the ledger the moment it
    // was recorded.
    await tx
      .update(accounts)
      .set({
        // The amount already carries its sign, so the balance simply adds it.
        currentBalance: sql`${accounts.currentBalance} + ${amount.toDecimalString()}::numeric`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, parsed.data.accountId));

    /*
      Y si esto paga una deuda, se aplica en la misma transacción de base.

      Un pago registrado cuya deuda no bajó, y una deuda que bajó sin pago que
      la explique, son las dos formas de que los números dejen de cuadrar.
      Ninguna de las dos puede existir ni por un instante.

      Sólo una salida baja una deuda. Una entrada la subiría, o es otra cosa, y
      en los dos casos no es esto.
    */
    if (parsed.data.debtId && parsed.data.direction === 'outflow') {
      await applyPaymentToDebt(tx, {
        householdId,
        debtId: parsed.data.debtId,
        transactionId: row.id,
        amount: magnitude,
        currency,
        paidOn: parsed.data.transactionDate,
        appliedBy: session.user.id,
      });
    }

    if (parsed.data.categoryId) {
      await tx.insert(classificationLog).values({
        householdId,
        transactionId: row.id,
        categoryId: parsed.data.categoryId,
        source: 'user',
        confidence: '1.000',
        actorId: session.user.id,
        reason: 'Stated when the movement was recorded by hand.',
      });
    }

    return row;
  });

  if (!created) return { error: 'accountRequired' };

  revalidateFinancials(formData);
  redirect(`/${localeOf(formData)}/movements/${created.id}`);
}

/**
 * Removes a movement recorded by hand.
 *
 * Only a hand-recorded one. An imported movement is evidence of what a
 * statement said, and deleting it would put the product's figures and the
 * bank's permanently out of agreement with nothing to show why. Those are
 * excluded instead.
 */
export async function removeMovement(
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
      .select({
        source: transactions.source,
        amount: transactions.amount,
        direction: transactions.direction,
        accountId: transactions.accountId,
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
    if (existing.source !== 'user') return 'importedCannotDelete' as const;

    await tx
      .update(transactions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(transactions.id, id.data));

    // The balance it moved when it was recorded moves back. The stored amount
    // carries its sign, so undoing it is a subtraction whichever way it went.
    await tx
      .update(accounts)
      .set({
        currentBalance: sql`${accounts.currentBalance} - ${existing.amount}::numeric`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, existing.accountId));

    return 'ok' as const;
  });

  if (outcome !== 'ok') return { error: outcome };

  revalidateFinancials(formData);
  return { ok: true };
}
