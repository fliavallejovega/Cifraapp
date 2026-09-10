'use server';

import { accounts, importRows, imports, transactions } from '@app/database/schema';
import { Money } from '@app/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';

import { scheduleAnalysis } from './analysis-service';
import { applyPaymentToDebt } from './debt-payments';
import { stageDocument } from './import-service';
import { runJobNow, runQueuedJobs } from './jobs';
import { loadSession, queryAsUser } from './session';

/**
 * The upload action.
 *
 * It no longer parses. The file is hashed, stored and queued, and the response
 * comes back as soon as those three are done — because parsing a PDF inside a
 * synchronous request is the thing the project rules forbid, and the thing that
 * made "supports PDF" impossible to ship (spec §12).
 *
 * The work is then kicked off with `after`, which runs it once the response has
 * been flushed. That is what makes the common case feel immediate: a small CSV
 * is usually parsed before the person finishes reading the screen that says it
 * is being read. A file that outlives the invocation is picked up by the cron
 * runner instead, and the screen says so either way.
 */

export interface ImportActionResult {
  readonly error?: string;
  readonly detail?: string;
  readonly jobId?: string;
}

export async function importStatement(
  _previous: ImportActionResult,
  formData: FormData,
): Promise<ImportActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'noAccount' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'unsupportedType' };
  }

  const householdId = session.activeHouseholdId;
  const chosen = z.uuid().safeParse(formData.get('accountId'));

  // The account the statement belongs to. A person who picked one gets that
  // one; otherwise the first active account, because filing against the wrong
  // account is worse than not filing, and the form always offers the choice.
  const available = await queryAsUser(session, (tx) =>
    tx
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, householdId),
          eq(accounts.status, 'active'),
          isNull(accounts.deletedAt),
        ),
      ),
  );

  const target = chosen.success
    ? available.find((account) => account.id === chosen.data)
    : available[0];

  if (!target) return { error: 'noAccount' };

  const bytes = new Uint8Array(await file.arrayBuffer());

  const outcome = await stageDocument(session, {
    householdId,
    accountId: target.id,
    currency: target.currency.trim() === 'PAB' ? 'PAB' : 'USD',
    fileName: file.name,
    mimeType: file.type || 'text/csv',
    bytes,
  });

  if (!outcome.ok) {
    return { error: outcome.reason, ...(outcome.detail ? { detail: outcome.detail } : {}) };
  }

  const jobId = outcome.jobId;
  after(async () => {
    try {
      await runJobNow(jobId);
    } catch (error: unknown) {
      // The cron runner will pick it up. A failure here must not turn a queued
      // import into a failed request the person already saw succeed.
      console.error('[import] inline run failed', { jobId, error });
    }
  });

  const locale = formData.get('locale') === 'en' ? 'en' : 'es';
  revalidatePath(`/${locale}/documents`);

  return { jobId };
}

/**
 * Confirming an import.
 *
 * The step the pipeline was missing. Rows were parsed, assessed and filed under
 * a verdict, and then nothing ever read them back — so every household in the
 * database had import rows and not one transaction. This is where a person's
 * decision becomes money in the ledger.
 *
 * Three properties this has to hold:
 *
 *   - Only what was selected is filed. A row the engine called a duplicate is
 *     not written because it was in the file; it is written because someone
 *     looked at it and said so.
 *   - A row becomes at most one transaction, ever. `created_transaction_id` is
 *     the guard, and it is checked inside the same transaction that writes.
 *   - Provenance survives. Every transaction points back at the import and the
 *     document it came from, so any figure on any screen can be traced to the
 *     file that produced it.
 */
export interface ConfirmActionResult {
  readonly error?: string;
  readonly filed?: number;
}

export async function confirmImport(
  _previous: ConfirmActionResult,
  formData: FormData,
): Promise<ConfirmActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const importId = z.uuid().safeParse(formData.get('importId'));
  if (!importId.success) return { error: 'notFound' };

  const selected = new Set(
    formData
      .getAll('rows')
      .filter((value): value is string => typeof value === 'string')
      .filter((value) => z.uuid().safeParse(value).success),
  );

  if (selected.size === 0) return { error: 'nothingSelected' };

  const householdId = session.activeHouseholdId;

  const filed = await queryAsUser(session, async (tx) => {
    const [header] = await tx
      .select({
        id: imports.id,
        accountId: imports.accountId,
        documentId: imports.documentId,
      })
      .from(imports)
      .where(and(eq(imports.id, importId.data), eq(imports.householdId, householdId)))
      .limit(1);

    if (!header?.accountId) return 0;

    const [account] = await tx
      .select({ currency: accounts.currency })
      .from(accounts)
      .where(eq(accounts.id, header.accountId))
      .limit(1);

    const currency = account?.currency.trim() === 'PAB' ? 'PAB' : 'USD';

    const candidates = await tx
      .select({
        id: importRows.id,
        transactionDate: importRows.transactionDate,
        amount: importRows.amount,
        descriptionOriginal: importRows.descriptionOriginal,
        descriptionNormalized: importRows.descriptionNormalized,
        externalReference: importRows.externalReference,
        fingerprint: importRows.fingerprint,
        verdict: importRows.verdict,
        createdTransactionId: importRows.createdTransactionId,
        proposedCategoryId: importRows.proposedCategoryId,
        chosenCategoryId: importRows.chosenCategoryId,
        applyToDebtId: importRows.applyToDebtId,
      })
      .from(importRows)
      .where(eq(importRows.importId, header.id));

    const writable = candidates.filter(
      (row) =>
        selected.has(row.id) &&
        // Already filed once. Re-submitting the form must not double it.
        row.createdTransactionId === null &&
        row.verdict !== 'rejected' &&
        row.transactionDate !== null &&
        row.amount !== null &&
        row.fingerprint !== null,
    );

    let count = 0;

    for (const row of writable) {
      const amount = Money.fromDecimalString(row.amount ?? '0', currency);
      const description = row.descriptionOriginal ?? '';

      const [created] = await tx
        .insert(transactions)
        .values({
          householdId,
          accountId: header.accountId,
          ownerId: session.user.id,
          transactionDate: row.transactionDate ?? '',
          amount: row.amount ?? '0',
          currency,
          // The sign in the statement is the direction. Nothing infers it from
          // the description, which is where categorization guesses go wrong.
          direction: amount.isNegative() ? 'outflow' : 'inflow',
          // El rubro que la persona eligió al revisar gana sobre el que el
          // motor propuso; sin ninguno de los dos, nulo — y una fila sin rubro
          // entra a la cola de categorías en vez de quedarse invisible.
          categoryId: row.chosenCategoryId ?? row.proposedCategoryId,
          descriptionOriginal: description,
          descriptionNormalized: row.descriptionNormalized ?? description,
          externalReference: row.externalReference,
          fingerprint: row.fingerprint ?? '',
          status: 'posted',
          source: 'imported',
          sourceDocumentId: header.documentId,
          sourceImportId: header.id,
        })
        .returning({ id: transactions.id });

      if (!created) continue;

      await tx
        .update(importRows)
        .set({ createdTransactionId: created.id })
        .where(eq(importRows.id, row.id));

      /*
        Y si esta fila es un pago a una deuda, se aplica ahora.

        Este es el paso que faltaba entero. Un pago a Giovanni entraba como un
        gasto suelto: salía del mes, no bajaba de ningún saldo, y la deuda
        seguía diciendo mil ochocientos para siempre. La casa terminaba llevando
        esa cuenta en la cabeza, que es el trabajo que este producto existe para
        quitar.

        Se aplica dentro de la misma transacción de base que creó el movimiento:
        un pago registrado cuya deuda no bajó, o una deuda que bajó sin pago que
        la explique, son dos formas de que los números dejen de cuadrar.
      */
      if (row.applyToDebtId) {
        await applyPaymentToDebt(tx, {
          householdId,
          debtId: row.applyToDebtId,
          transactionId: created.id,
          amount: amount.abs(),
          currency,
          paidOn: row.transactionDate ?? '',
          appliedBy: session.user.id,
        });
      }

      count += 1;
    }

    // Settled only when nothing importable is still waiting. A partial
    // confirmation leaves the import open, because the rest is still a decision
    // somebody has to make.
    const remaining = candidates.filter(
      (row) =>
        row.verdict !== 'rejected' &&
        row.createdTransactionId === null &&
        !writable.some((written) => written.id === row.id),
    );

    await tx
      .update(imports)
      .set(
        remaining.length === 0
          ? { status: 'completed', completedAt: new Date() }
          : { status: 'review' },
      )
      .where(eq(imports.id, header.id));

    return count;
  });

  if (filed === 0) return { error: 'nothingFiled' };

  // Now that there are transactions, the four engines that were built and never
  // run against a real row have something to look at: transfers, duplicates,
  // recurring patterns and categories. All four propose; none of them decides.
  await scheduleAnalysis(session, householdId);
  after(async () => {
    try {
      await runQueuedJobs();
    } catch (error: unknown) {
      console.error('[import] analysis run failed', { householdId, error });
    }
  });

  const locale = formData.get('locale') === 'en' ? 'en' : 'es';
  for (const path of [
    'documents',
    'overview',
    'plan',
    'reports',
    'accounts',
    'movements',
    'review',
    'review/duplicates',
    'review/transfers',
    'review/recurring',
    'review/categories',
  ]) {
    revalidatePath(`/${locale}/${path}`);
  }
  revalidatePath(`/${locale}/documents/${importId.data}`);

  return { filed };
}

/** Closes an import without filing anything. The rows and the file stay. */
export async function discardImport(
  _previous: ConfirmActionResult,
  formData: FormData,
): Promise<ConfirmActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  const importId = z.uuid().safeParse(formData.get('importId'));
  if (!importId.success) return { error: 'notFound' };

  const householdId = session.activeHouseholdId;

  await queryAsUser(session, (tx) =>
    tx
      .update(imports)
      .set({ status: 'discarded', completedAt: new Date() })
      .where(and(eq(imports.id, importId.data), eq(imports.householdId, householdId))),
  );

  const locale = formData.get('locale') === 'en' ? 'en' : 'es';
  revalidatePath(`/${locale}/documents`);
  revalidatePath(`/${locale}/documents/${importId.data}`);

  return { filed: 0 };
}
