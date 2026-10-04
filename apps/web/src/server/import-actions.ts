'use server';

import {
  accounts,
  debts,
  documents,
  importRows,
  imports,
  transactions,
} from '@app/database/schema';
import { Money, newId } from '@app/domain';
import { digitsDisagree } from '@app/transaction-engine';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';

import { scheduleAnalysis } from './analysis-service';
import { applyPaymentToDebt, paysTheDebt } from './debt-payments';
import { MAX_STATEMENT_BYTES, MAX_UPLOAD_PARTS, UPLOAD_CHUNK_BYTES } from '../lib/upload-limits';
import {
  isAcceptedStatementType,
  isAlreadyStored,
  STATEMENT_IMPORT_JOB,
  stageDocument,
} from './import-service';
import { enqueueJob, runJobNow, runQueuedJobs } from './jobs';
import { loadRepeatQuestions } from './repositories/repeat-questions';
import { loadStatementQueue, type QueueEntry } from './repositories/statement-queue';
import { loadSession, queryAsUser, type Session } from './session';
import { buildUploadPartKey, deleteDocument, putDocument, readDocument } from './storage';

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
  const target = await resolveTargetAccount(session, householdId, formData.get('accountId'));
  if (!target) return { error: 'noAccount' };

  return stageAndQueue(session, {
    householdId,
    target,
    fileName: file.name,
    mimeType: file.type || 'text/csv',
    bytes: new Uint8Array(await file.arrayBuffer()),
    locale: formData.get('locale'),
  });
}

/*
  Un archivo en partes.

  Un estado de cuenta en PDF de 6 MB no cabía en una petición de 4 MB, y el
  rechazo llegaba como un error genérico después de esperar la subida entera.
  Ahora el navegador lo manda en pedazos de 3,5 MB: se pide permiso, se guarda
  cada pedazo al llegar y, con el último, el servidor los une y sigue por el
  mismo camino de siempre — el mismo hash, el mismo veto de formato, la misma
  cola. Nada de lo que decide si un archivo entra cambió de lugar.
*/

export interface BeginUploadResult {
  readonly error?: string;
  readonly uploadId?: string;
}

export async function beginStatementUpload(input: {
  readonly accountId: string;
  readonly byteSize: number;
  readonly mimeType: string;
  readonly contentHash: string;
}): Promise<BeginUploadResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'noAccount' };
  const householdId = session.activeHouseholdId;

  if (!Number.isInteger(input.byteSize) || input.byteSize <= 0) {
    return { error: 'unsupportedType' };
  }
  if (input.byteSize > MAX_STATEMENT_BYTES) return { error: 'tooLarge' };
  if (!isAcceptedStatementType(input.mimeType)) return { error: 'unsupportedType' };

  const target = await resolveTargetAccount(session, householdId, input.accountId);
  if (!target) return { error: 'noAccount' };

  if (
    /^[0-9a-f]{64}$/.test(input.contentHash) &&
    (await isAlreadyStored(session, householdId, input.contentHash))
  ) {
    return { error: 'alreadyImported' };
  }

  return { uploadId: newId<string>() };
}

export async function uploadStatementPart(
  formData: FormData,
): Promise<{ readonly error?: string }> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'noAccount' };

  const uploadId = z.uuid().safeParse(formData.get('uploadId'));
  const index = z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_UPLOAD_PARTS - 1)
    .safeParse(formData.get('index'));
  const part = formData.get('part');

  if (!uploadId.success || !index.success || !(part instanceof Blob)) {
    return { error: 'unreadable' };
  }
  if (part.size === 0 || part.size > UPLOAD_CHUNK_BYTES) return { error: 'tooLarge' };

  try {
    await putDocument(
      buildUploadPartKey(session.activeHouseholdId, uploadId.data, index.data),
      new Uint8Array(await part.arrayBuffer()),
      'application/octet-stream',
    );
  } catch {
    return { error: 'storageUnavailable' };
  }

  return {};
}

export async function finishStatementUpload(input: {
  readonly uploadId: string;
  readonly parts: number;
  readonly accountId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly locale: string;
}): Promise<ImportActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'noAccount' };
  const householdId = session.activeHouseholdId;

  const uploadId = z.uuid().safeParse(input.uploadId);
  const parts = z.number().int().min(1).max(MAX_UPLOAD_PARTS).safeParse(input.parts);
  if (!uploadId.success || !parts.success) return { error: 'unreadable' };

  const target = await resolveTargetAccount(session, householdId, input.accountId);
  if (!target) return { error: 'noAccount' };

  const keys = Array.from({ length: parts.data }, (_, index) =>
    buildUploadPartKey(householdId, uploadId.data, index),
  );

  // The pieces go whatever happens next: joined, refused or failed, they have
  // done their job, and a piece left behind is a fragment of a bank statement
  // sitting in storage with nothing pointing at it.
  after(async () => {
    await Promise.allSettled(keys.map((key) => deleteDocument(key)));
  });

  const pieces: Uint8Array[] = [];
  let total = 0;
  try {
    for (const key of keys) {
      const piece = await readDocument(key);
      total += piece.byteLength;
      if (total > MAX_STATEMENT_BYTES) return { error: 'tooLarge' };
      pieces.push(piece);
    }
  } catch {
    return { error: 'storageUnavailable' };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const piece of pieces) {
    bytes.set(piece, offset);
    offset += piece.byteLength;
  }

  return stageAndQueue(session, {
    householdId,
    target,
    fileName: input.fileName,
    mimeType: input.mimeType || 'application/octet-stream',
    bytes,
    locale: input.locale,
  });
}

interface TargetAccount {
  readonly id: string;
  readonly currency: string;
}

/**
 * The account the statement belongs to. A person who picked one gets that one;
 * otherwise the first active account, because filing against the wrong account
 * is worse than not filing, and every form offers the choice.
 */
async function resolveTargetAccount(
  session: Session,
  householdId: string,
  rawAccountId: unknown,
): Promise<TargetAccount | undefined> {
  const chosen = z.uuid().safeParse(rawAccountId);

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

  return chosen.success ? available.find((account) => account.id === chosen.data) : available[0];
}

async function stageAndQueue(
  session: Session,
  input: {
    readonly householdId: string;
    readonly target: TargetAccount;
    readonly fileName: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
    readonly locale: unknown;
  },
): Promise<ImportActionResult> {
  const outcome = await stageDocument(session, {
    householdId: input.householdId,
    accountId: input.target.id,
    currency: input.target.currency.trim() === 'PAB' ? 'PAB' : 'USD',
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
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

  const locale = input.locale === 'en' ? 'en' : 'es';
  revalidatePath(`/${locale}/documents`);
  revalidatePath(`/${locale}/family-expenses`);

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
  const filed = await fileImport(session, householdId, importId.data, selected);

  if (filed === 0) return { error: 'nothingFiled' };

  await afterFiling(session, householdId, formData.get('locale') === 'en' ? 'en' : 'es');
  revalidatePath(`/${formData.get('locale') === 'en' ? 'en' : 'es'}/documents/${importId.data}`);

  return { filed };
}

/**
 * Files the chosen rows of one import as transactions, in one database
 * transaction. `'proposed'` takes what the review screen would have selected
 * by itself: the rows the engine believes are new.
 */
async function fileImport(
  session: Session,
  householdId: string,
  importId: string,
  chosen: ReadonlySet<string> | 'proposed',
): Promise<number> {
  return queryAsUser(session, async (tx) => {
    const [header] = await tx
      .select({
        id: imports.id,
        accountId: imports.accountId,
        documentId: imports.documentId,
      })
      .from(imports)
      .where(and(eq(imports.id, importId), eq(imports.householdId, householdId)))
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
        distinctConfirmed: importRows.distinctConfirmed,
      })
      .from(importRows)
      .where(eq(importRows.importId, header.id));

    const selected =
      chosen === 'proposed'
        ? new Set(candidates.filter((row) => row.verdict === 'new').map((row) => row.id))
        : chosen;

    /*
      The same movement already filed from another file of this account.

      Overlapping screenshots carry the same lines, and confirming the second
      file would file them twice. A line whose fingerprint is already in the
      ledger from a different import is held back — unless the person said, on
      the repeat question, that they are two movements.
    */
    const fingerprints = candidates
      .map((row) => row.fingerprint)
      .filter((value): value is string => value !== null);
    const already = new Set(
      fingerprints.length === 0
        ? []
        : (
            await tx
              .select({ fingerprint: transactions.fingerprint })
              .from(transactions)
              .where(
                and(
                  eq(transactions.householdId, householdId),
                  eq(transactions.accountId, header.accountId),
                  isNull(transactions.deletedAt),
                  inArray(transactions.fingerprint, fingerprints),
                  sql`${transactions.sourceImportId} is distinct from ${header.id}`,
                ),
              )
          ).map((row) => row.fingerprint),
    );

    const writable = candidates.filter(
      (row) =>
        selected.has(row.id) &&
        // Already filed once. Re-submitting the form must not double it.
        row.createdTransactionId === null &&
        row.verdict !== 'rejected' &&
        row.transactionDate !== null &&
        row.amount !== null &&
        row.fingerprint !== null &&
        (row.distinctConfirmed || !already.has(row.fingerprint)),
    );

    let count = 0;

    for (const row of writable) {
      const amount = Money.fromDecimalString(row.amount ?? '0', currency);
      const description = row.descriptionOriginal ?? '';
      const direction = amount.isNegative() ? ('outflow' as const) : ('inflow' as const);

      /*
        Si esta fila paga una deuda, se decide **antes** de insertar.

        Un pago no es un gasto: es plata moviéndose de un bolsillo a otro de la
        misma casa. Nace como transferencia y sin rubro, en una sola escritura —
        insertarlo como gasto y corregirlo después deja un instante en que las
        cifras del mes están mal, y el cierre del mes puede caer justo ahí.

        Y hacia dónde va el dinero decide si paga: entrando a la cuenta que lleva
        la deuda, o saliendo de cualquier otra.
      */
      let paysDebt = false;
      if (row.applyToDebtId) {
        const [target] = await tx
          .select({ accountId: debts.accountId })
          .from(debts)
          .where(and(eq(debts.id, row.applyToDebtId), eq(debts.householdId, householdId)))
          .limit(1);

        paysDebt =
          target !== undefined &&
          paysTheDebt({
            debtAccountId: target.accountId,
            movementAccountId: header.accountId,
            direction,
          });
      }

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
          direction,
          // Un pago no lleva rubro: no le falta uno, no le toca ninguno.
          // Fuera de ese caso, el que la persona eligió al revisar gana sobre el
          // que el motor propuso, y sin ninguno de los dos queda nulo — y una
          // fila sin rubro entra a la cola en vez de quedarse invisible.
          categoryId: paysDebt ? null : (row.chosenCategoryId ?? row.proposedCategoryId),
          descriptionOriginal: description,
          descriptionNormalized: row.descriptionNormalized ?? description,
          externalReference: row.externalReference,
          fingerprint: row.fingerprint ?? '',
          // Una transferencia no es gasto ni ingreso, así que no entra en el
          // mes ni en ningún presupuesto.
          status: paysDebt ? 'transfer' : 'posted',
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
      if (paysDebt && row.applyToDebtId) {
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
    // A line held back because it is already filed from another file is not
    // waiting on anybody: it is settled.
    const remaining = candidates.filter(
      (row) =>
        row.verdict !== 'rejected' &&
        row.createdTransactionId === null &&
        !writable.some((written) => written.id === row.id) &&
        !(row.fingerprint !== null && !row.distinctConfirmed && already.has(row.fingerprint)),
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
}

/**
 * Now that there are transactions, the four engines that were built and never
 * run against a real row have something to look at: transfers, duplicates,
 * recurring patterns and categories. All four propose; none of them decides.
 */
async function afterFiling(session: Session, householdId: string, locale: 'es' | 'en') {
  await scheduleAnalysis(session, householdId);
  after(async () => {
    try {
      await runQueuedJobs();
    } catch (error: unknown) {
      console.error('[import] analysis run failed', { householdId, error });
    }
  });

  for (const path of [
    'documents',
    'family-expenses',
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
}

export interface SaveAllResult {
  readonly error?: 'signInRequired' | 'repeatsOpen' | 'nothingFiled';
  readonly files?: number;
  readonly filed?: number;
  /** Files left for a person to look at: their digits name another account. */
  readonly heldBack?: number;
}

/**
 * «Guardar todo lo leído»: every file waiting for review, filed the way its
 * review screen would file it — the lines the engine believes are new.
 *
 * Still a person's decision, made once instead of eleven times. Two things
 * keep it from deciding what only a person can: repeated lines must be
 * answered first, and a file whose own digits name another account is left
 * out for its own screen. Oldest file first, so an overlapping line is filed
 * from the file it appeared in first and held back from the rest.
 */
export async function saveAllReviewed(input: { readonly locale: string }): Promise<SaveAllResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };
  const householdId = session.activeHouseholdId;
  const locale = input.locale === 'en' ? 'en' : 'es';

  const repeats = await loadRepeatQuestions(session, householdId);
  if (repeats.questions.length > 0) return { error: 'repeatsOpen' };

  const waiting = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: imports.id,
        statedDigits: imports.statedAccountDigits,
        onFile: accounts.maskedNumber,
      })
      .from(imports)
      .innerJoin(accounts, eq(accounts.id, imports.accountId))
      .where(and(eq(imports.householdId, householdId), eq(imports.status, 'review')))
      .orderBy(imports.startedAt),
  );

  let files = 0;
  let filed = 0;
  let heldBack = 0;
  for (const run of waiting) {
    if (digitsDisagree(run.statedDigits, run.onFile)) {
      heldBack += 1;
      continue;
    }
    const count = await fileImport(session, householdId, run.id, 'proposed');
    if (count > 0) files += 1;
    filed += count;
  }

  if (filed === 0) return { error: 'nothingFiled', heldBack };
  await afterFiling(session, householdId, locale);
  return { files, filed, heldBack };
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

/**
 * Moving a statement to the account it says it belongs to.
 *
 * The rows were read against the account it was dropped under, and every
 * fingerprint carries that account — so the import is not edited in place. It
 * is closed without filing anything, the document is pointed at the right
 * account, and the same file is read again there. Nothing had entered the
 * ledger yet: an import that already filed rows is refused, because moving it
 * then would move money that was already counted.
 */
export async function moveImportToAccount(input: {
  readonly importId: string;
  readonly accountId: string;
  readonly locale: string;
}): Promise<ImportActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'noAccount' };
  const householdId = session.activeHouseholdId;

  const importId = z.uuid().safeParse(input.importId);
  if (!importId.success) return { error: 'unreadable' };

  const target = await resolveTargetAccount(session, householdId, input.accountId);
  if (target?.id !== input.accountId) return { error: 'noAccount' };

  const moved = await queryAsUser(session, async (tx) => {
    const [run] = await tx
      .select({
        id: imports.id,
        status: imports.status,
        documentId: imports.documentId,
        fileName: documents.fileName,
        mimeType: documents.mimeType,
        storageKey: documents.storageKey,
        uploadedAt: documents.createdAt,
      })
      .from(imports)
      .innerJoin(documents, eq(documents.id, imports.documentId))
      .where(and(eq(imports.id, importId.data), eq(imports.householdId, householdId)))
      .limit(1);

    if (!run?.documentId || run.status !== 'review') return null;

    const [filed] = await tx
      .select({ id: importRows.id })
      .from(importRows)
      .where(and(eq(importRows.importId, run.id), isNotNull(importRows.createdTransactionId)))
      .limit(1);
    if (filed) return null;

    await tx
      .update(imports)
      .set({ status: 'discarded', completedAt: new Date() })
      .where(eq(imports.id, run.id));
    await tx
      .update(documents)
      .set({ accountId: target.id })
      .where(eq(documents.id, run.documentId));

    return run;
  });

  if (!moved?.documentId) return { error: 'cannotMove' };

  const jobId = await enqueueJob(session, householdId, STATEMENT_IMPORT_JOB, {
    documentId: moved.documentId,
    accountId: target.id,
    currency: target.currency.trim() === 'PAB' ? 'PAB' : 'USD',
    fileName: moved.fileName,
    mimeType: moved.mimeType,
    storageKey: moved.storageKey,
    uploadedAt: moved.uploadedAt.toISOString(),
  });
  if (!jobId) return { error: 'queueUnavailable' };

  after(async () => {
    try {
      await runJobNow(jobId);
    } catch (error: unknown) {
      console.error('[import] inline run failed', { jobId, error });
    }
  });

  const locale = input.locale === 'en' ? 'en' : 'es';
  revalidatePath(`/${locale}/family-expenses`);
  revalidatePath(`/${locale}/documents`);
  return { jobId };
}

/**
 * One account's reading queue, for the zone that shows it.
 *
 * Polled while something is still being read. Every poll also nudges a job
 * that has waited too long — the same trick the processing screen uses: on a
 * platform where a killed invocation can strand a job, a person watching is
 * the most reliable worker available.
 */
export async function readStatementQueue(
  accountId: string,
): Promise<{ readonly entries: readonly QueueEntry[] }> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { entries: [] };
  const id = z.uuid().safeParse(accountId);
  if (!id.success) return { entries: [] };

  const entries = await loadStatementQueue(session, session.activeHouseholdId, id.data);
  const stranded = entries.find(
    (entry) =>
      entry.status === 'queued' && Date.now() - Date.parse(entry.createdAt) > STRANDED_AFTER_MS,
  );
  if (stranded) {
    after(async () => {
      try {
        await runJobNow(stranded.jobId);
      } catch (error: unknown) {
        console.error('[import] queue nudge failed', { jobId: stranded.jobId, error });
      }
    });
  }
  return { entries };
}

const STRANDED_AFTER_MS = 20_000;

/**
 * The answer to «is this one movement or two?» for a line repeated across
 * pending files.
 *
 * «One» keeps the copy in the oldest file and marks the others as duplicates,
 * which start unselected on the review screen — nothing is deleted, and a
 * person can still tick one back. «Two» records the answer on every copy, so
 * the question is not asked again and confirming files them all.
 */
export async function answerRepeat(input: {
  readonly accountId: string;
  readonly fingerprint: string;
  readonly same: boolean;
  readonly locale: string;
}): Promise<{ readonly error?: string; readonly ok?: true }> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };
  const accountId = z.uuid().safeParse(input.accountId);
  const fingerprint = z
    .string()
    .regex(/^[0-9a-f]{16,64}$/)
    .safeParse(input.fingerprint);
  if (!accountId.success || !fingerprint.success) return { error: 'notFound' };
  const householdId = session.activeHouseholdId;

  await queryAsUser(session, async (tx) => {
    const copies = await tx
      .select({ id: importRows.id, startedAt: imports.startedAt })
      .from(importRows)
      .innerJoin(imports, eq(imports.id, importRows.importId))
      .where(
        and(
          eq(imports.householdId, householdId),
          eq(imports.accountId, accountId.data),
          eq(imports.status, 'review'),
          eq(importRows.fingerprint, fingerprint.data),
          eq(importRows.verdict, 'new'),
          isNull(importRows.createdTransactionId),
        ),
      )
      .orderBy(imports.startedAt);

    if (input.same) {
      const extra = copies.slice(1).map((copy) => copy.id);
      if (extra.length > 0) {
        await tx
          .update(importRows)
          .set({ verdict: 'duplicate' })
          .where(inArray(importRows.id, extra));
      }
    } else if (copies.length > 0) {
      await tx
        .update(importRows)
        .set({ distinctConfirmed: true })
        .where(
          inArray(
            importRows.id,
            copies.map((copy) => copy.id),
          ),
        );
    }
  });

  const locale = input.locale === 'en' ? 'en' : 'es';
  revalidatePath(`/${locale}/documents`);
  return { ok: true };
}

/**
 * Undoes a merge the engine made on its own: the copy goes back to being a
 * movement to save, and is marked as distinct so it is not merged again.
 */
export async function undoRepeatMerge(input: {
  readonly rowId: string;
  readonly locale: string;
}): Promise<{ readonly error?: string; readonly ok?: true }> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };
  const rowId = z.uuid().safeParse(input.rowId);
  if (!rowId.success) return { error: 'notFound' };
  const householdId = session.activeHouseholdId;

  await queryAsUser(session, (tx) =>
    tx
      .update(importRows)
      .set({ verdict: 'new', matchedSignals: [], distinctConfirmed: true })
      .where(
        and(
          eq(importRows.id, rowId.data),
          eq(importRows.householdId, householdId),
          eq(importRows.verdict, 'duplicate'),
          isNull(importRows.createdTransactionId),
        ),
      ),
  );

  revalidatePath(`/${input.locale === 'en' ? 'en' : 'es'}/documents`);
  return { ok: true };
}
