'use server';

import {
  accounts,
  debtPayments,
  debts,
  documents,
  importRows,
  imports,
  transactions,
} from '@app/database/schema';
import { newId } from '@app/domain';
import { cardPaymentDigits, digitsDisagree } from '@app/transaction-engine';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { after } from 'next/server';
import { z } from 'zod';

import { fileImportInto } from './import-filing';
import { scheduleAnalysis } from './analysis-service';
import { reversePayment } from './debt-payments';
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

  // «Let the app find it», or a household with no account yet: the statement
  // itself will say which account it is once it is read.
  if (rawAccountId === DETECT || available.length === 0) {
    const household = session.households.find((entry) => entry.id === householdId);
    return { id: DETECT, currency: household?.baseCurrency ?? 'USD' };
  }

  return chosen.success ? available.find((account) => account.id === chosen.data) : available[0];
}

/** The account choice that means «read it from the statement». */
const DETECT = 'auto';

/**
 * A provisional account for a statement uploaded without one.
 *
 * The worker fills it in from the header, or folds it into the account the
 * printed digits name. Its balance counts every movement until the statement
 * states one, because nobody typed a figure for it.
 */
async function openDetectedAccount(
  session: Session,
  householdId: string,
  currency: string,
  locale: unknown,
): Promise<string | null> {
  const t = await getTranslations({
    locale: locale === 'en' ? 'en' : 'es',
    namespace: 'documents',
  });
  const [created] = await queryAsUser(session, (tx) =>
    tx
      .insert(accounts)
      .values({
        householdId,
        name: t('detected.name'),
        accountType: 'checking',
        currency: currency.trim() === 'PAB' ? 'PAB' : 'USD',
        balanceAnchor: '0',
        balanceAnchorDate: null,
        status: 'active',
        source: 'system',
        needsConfirmation: true,
        createdBy: session.user.id,
        ownerId: session.user.id,
      })
      .returning({ id: accounts.id }),
  );
  return created?.id ?? null;
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
  const accountId =
    input.target.id === DETECT
      ? await openDetectedAccount(session, input.householdId, input.target.currency, input.locale)
      : input.target.id;
  if (!accountId) return { error: 'noAccount' };

  const outcome = await stageDocument(session, {
    householdId: input.householdId,
    accountId,
    currency: input.target.currency.trim() === 'PAB' ? 'PAB' : 'USD',
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
  });

  if (!outcome.ok) {
    // A refused file leaves no provisional account behind it.
    if (input.target.id === DETECT) {
      await queryAsUser(session, (tx) =>
        tx
          .update(accounts)
          .set({ deletedAt: new Date(), status: 'closed' })
          .where(and(eq(accounts.id, accountId), eq(accounts.needsConfirmation, true))),
      );
    }
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

/** Files the chosen rows of one import as the signed-in person. */
async function fileImport(
  session: Session,
  householdId: string,
  importId: string,
  chosen: ReadonlySet<string> | 'proposed',
): Promise<number> {
  return queryAsUser(session, (tx) =>
    fileImportInto(tx, { householdId, userId: session.user.id, importId, chosen }),
  );
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

/**
 * Undoes an import the app saved on its own.
 *
 * Every movement it filed is set aside (soft-deleted, so the record of what
 * happened stays), any debt payment it applied is reversed, and the import
 * goes back to waiting for a person — exactly where it would have been had the
 * app not saved it. The balances follow on their own.
 */
export async function undoAutoFiledImport(input: {
  readonly importId: string;
  readonly locale: string;
}): Promise<{ readonly error?: string; readonly undone?: number }> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };
  const householdId = session.activeHouseholdId;

  const importId = z.uuid().safeParse(input.importId);
  if (!importId.success) return { error: 'notFound' };

  const undone = await queryAsUser(session, async (tx) => {
    const [run] = await tx
      .select({ id: imports.id, autoFiledAt: imports.autoFiledAt })
      .from(imports)
      .where(and(eq(imports.id, importId.data), eq(imports.householdId, householdId)))
      .limit(1);
    if (!run?.autoFiledAt) return null;

    const filed = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.sourceImportId, run.id),
          isNull(transactions.deletedAt),
        ),
      );
    const ids = filed.map((row) => row.id);

    if (ids.length > 0) {
      const payments = await tx
        .select({ id: debtPayments.id })
        .from(debtPayments)
        .where(and(inArray(debtPayments.transactionId, ids), isNull(debtPayments.reversedAt)));
      for (const payment of payments) {
        await reversePayment(tx, {
          householdId,
          paymentId: payment.id,
          reversedBy: session.user.id,
          reason: 'Undone with the import it came from.',
        });
      }
      await tx
        .update(transactions)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(inArray(transactions.id, ids));
      await tx
        .update(importRows)
        .set({ createdTransactionId: null })
        .where(eq(importRows.importId, run.id));
    }

    await tx
      .update(imports)
      .set({ status: 'review', autoFiledAt: null, completedAt: null })
      .where(eq(imports.id, run.id));

    return ids.length;
  });

  if (undone === null) return { error: 'notFound' };
  await afterFiling(session, householdId, input.locale === 'en' ? 'en' : 'es');
  return { undone };
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

/**
 * «Those payments are to this card»: links the digits a bank printed on card
 * payments to a card the household registered, and marks the payments still
 * waiting to be saved as payments to that card's debt — transfers, not
 * expenses. Future statements pick the link up when they are read.
 */
export async function linkCardDigits(input: {
  readonly digits: string;
  readonly accountId: string;
  readonly locale: string;
}): Promise<{ readonly error?: string; readonly linked?: number }> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };
  const accountId = z.uuid().safeParse(input.accountId);
  const digits = z
    .string()
    .regex(/^\d{4}$/)
    .safeParse(input.digits);
  if (!accountId.success || !digits.success) return { error: 'notFound' };
  const householdId = session.activeHouseholdId;

  const linked = await queryAsUser(session, async (tx) => {
    const [card] = await tx
      .select({ id: accounts.id, aliases: accounts.cardAliasDigits })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountId.data),
          eq(accounts.householdId, householdId),
          eq(accounts.accountType, 'credit_card'),
          isNull(accounts.deletedAt),
        ),
      )
      .limit(1);
    if (!card) return null;

    const [debt] = await tx
      .select({ id: debts.id })
      .from(debts)
      .where(and(eq(debts.accountId, card.id), isNull(debts.deletedAt)))
      .limit(1);
    if (!debt) return null;

    if (!card.aliases.includes(digits.data)) {
      await tx
        .update(accounts)
        .set({ cardAliasDigits: [...card.aliases, digits.data] })
        .where(eq(accounts.id, card.id));
    }

    // The same reading the engine does — `cardPaymentDigits` — over the lines
    // still waiting, so only payments to a card with these digits are marked.
    const waiting = await tx
      .select({ id: importRows.id, description: importRows.descriptionOriginal })
      .from(importRows)
      .innerJoin(imports, eq(imports.id, importRows.importId))
      .where(
        and(
          eq(imports.householdId, householdId),
          eq(imports.status, 'review'),
          eq(importRows.verdict, 'new'),
          isNull(importRows.createdTransactionId),
          isNull(importRows.applyToDebtId),
          sql`${importRows.amount} < 0`,
        ),
      );
    const ids = waiting
      .filter((row) => cardPaymentDigits(row.description ?? '') === digits.data)
      .map((row) => row.id);
    if (ids.length > 0) {
      await tx
        .update(importRows)
        .set({ applyToDebtId: debt.id })
        .where(inArray(importRows.id, ids));
    }
    return ids.length;
  });

  if (linked === null) return { error: 'cannotLink' };
  revalidatePath(`/${input.locale === 'en' ? 'en' : 'es'}/documents`);
  return { linked };
}

/** «Nothing is missing there»: the seam above this capture is not asked again. */
export async function confirmCaptureContinuity(input: {
  readonly importId: string;
  readonly locale: string;
}): Promise<{ readonly error?: string; readonly ok?: true }> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };
  const importId = z.uuid().safeParse(input.importId);
  if (!importId.success) return { error: 'notFound' };
  const householdId = session.activeHouseholdId;

  await queryAsUser(session, (tx) =>
    tx
      .update(imports)
      .set({ continuityConfirmed: true })
      .where(and(eq(imports.id, importId.data), eq(imports.householdId, householdId))),
  );
  revalidatePath(`/${input.locale === 'en' ? 'en' : 'es'}/documents`);
  return { ok: true };
}
