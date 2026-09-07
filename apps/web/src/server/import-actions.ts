'use server';

import { accounts, importRows, imports, transactions } from '@app/database/schema';
import { Money } from '@app/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { runImport, type ImportSummary } from './import-service';
import { loadSession, queryAsUser } from './session';

/**
 * The upload action.
 *
 * The file is read into memory and handed to the import service. For the file
 * sizes a bank statement actually reaches that is fine; when PDF and OCR arrive
 * this moves to a background job, because parsing must never happen inside a
 * synchronous request (spec §12).
 */

export interface ImportActionResult {
  readonly error?: string;
  readonly detail?: string;
  readonly summary?: ImportSummary;
  readonly importId?: string;
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

  // An import needs an account to belong to. Rather than guessing, the first
  // active account is used and Phase 4's account picker replaces this — a
  // transaction filed against the wrong account is worse than one not filed.
  const account = await queryAsUser(session, (tx) =>
    tx
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, householdId),
          eq(accounts.status, 'active'),
          isNull(accounts.deletedAt),
        ),
      )
      .limit(1),
  );

  const target = account[0];
  if (!target) return { error: 'noAccount' };

  const bytes = new Uint8Array(await file.arrayBuffer());

  const outcome = await runImport(session, {
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

  const locale = formData.get('locale') === 'en' ? 'en' : 'es';
  revalidatePath(`/${locale}/documents`);

  // The counts travel as numbers, not as a sentence. The English string that
  // used to be built here rendered untranslated on a Spanish screen, and every
  // user-visible word belongs in the catalogue (project rule).
  return { importId: outcome.importId, summary: outcome.summary };
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

  const locale = formData.get('locale') === 'en' ? 'en' : 'es';
  for (const path of ['documents', 'overview', 'plan', 'reports', 'accounts']) {
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
