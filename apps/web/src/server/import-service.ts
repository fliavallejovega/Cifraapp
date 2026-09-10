import 'server-only';

import { getAdminDb, type Database } from '@app/database';
import { documents, imports, importRows, transactions } from '@app/database/schema';
import { Money, newId, type CurrencyCode, type PlainDate } from '@app/domain';
import {
  assessDuplicate,
  computeDocumentHash,
  detectStatementFormat,
  parseDocument,
  StatementParseError,
  type ExistingTransaction,
} from '@app/transaction-engine';
import { getServerEnv } from '@app/validation/env';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';

import { enqueueJob, registerJobHandler } from './jobs';
import { queryAsUser, type Session } from './session';
import { canReadByOcr, readStatementByOcr, type OcrFailure } from './statement-ocr';
import { buildStorageKey, putDocument, readDocument } from './storage';

/**
 * The import pipeline, in two halves.
 *
 * Upload → hash → store → *enqueue*. Then, out of band: fetch → parse → assess →
 * review. The split is not an optimisation. Parsing a hundred-page PDF takes
 * seconds the platform's request budget does not have, and a person watching a
 * request time out cannot tell a slow parse from a lost statement.
 *
 * Nothing is written to `app.transactions` by either half. The run produces a
 * verdict per row and stops; a person confirms before money enters their
 * records, because an importer that writes first and asks later has already
 * broken the promise the product is built on (spec §12, §14).
 *
 * Three guards, in order of cheapness:
 *
 *   1. The content hash rejects a re-uploaded file before it is parsed.
 *   2. The job's partial unique index makes a double-click one import, not two.
 *   3. The identity engine assesses every row against what is already stored.
 */

/** Anything larger is a document nobody exports from a bank. */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const STATEMENT_IMPORT_JOB = 'statement_import';

const ACCEPTED_MIME_TYPES = new Set([
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/x-ofx',
  'application/ofx',
  'application/pdf',
  // Una foto del estado de cuenta. Es lo que la mitad de la gente tiene a mano,
  // y rechazarla obligaba a buscar una computadora para hacer algo que se hace
  // desde el teléfono en diez segundos.
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/octet-stream',
]);

export type StageOutcome =
  | { readonly ok: true; readonly documentId: string; readonly jobId: string }
  | { readonly ok: false; readonly reason: StageFailure; readonly detail?: string };

export type StageFailure =
  | 'tooLarge'
  | 'unsupportedType'
  | 'alreadyImported'
  | 'unreadable'
  | 'storageUnavailable'
  | 'queueUnavailable';

export interface ImportSummary {
  readonly found: number;
  readonly created: number;
  readonly duplicate: number;
  readonly review: number;
  readonly rejected: number;
}

export interface StageRequest {
  readonly householdId: string;
  readonly accountId: string;
  readonly currency: CurrencyCode;
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

/**
 * Records the file and queues the work.
 *
 * The only thing parsed here is the first two kilobytes, to reject a format
 * nothing can read before a byte reaches storage. A file we cannot read should
 * not leave a document row and an orphaned object behind.
 */
export async function stageDocument(
  session: Session,
  request: StageRequest,
): Promise<StageOutcome> {
  if (request.bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: 'tooLarge' };
  }

  if (!ACCEPTED_MIME_TYPES.has(request.mimeType)) {
    return { ok: false, reason: 'unsupportedType' };
  }

  /*
    El olfateo de formato mira los primeros bytes y decide si esto es un CSV, un
    OFX, un XLSX o un PDF. Un escaneo no es ninguno de los cuatro — un PDF de
    imagen pasa el `%PDF` pero una foto no pasa nada— y antes eso bastaba para
    rechazarlo en la puerta.

    Ahora el veto sólo aplica a lo que tampoco se puede mirar. Un archivo que el
    lector visual puede abrir sigue de largo y se resuelve al parsear: si trae
    capa de texto la lee el parser determinista, y si no, se transcribe.
  */
  const head = new TextDecoder('latin1').decode(request.bytes.subarray(0, 2048));
  if (detectStatementFormat(head, request.fileName) === null && !canReadByOcr(request.mimeType)) {
    return { ok: false, reason: 'unsupportedType' };
  }

  const contentHash = computeDocumentHash(request.bytes);
  const documentId = newId<string>();
  const extension = request.fileName.split('.').pop() ?? '';
  const storageKey = buildStorageKey('documents', request.householdId, documentId, extension);

  const existing = await queryAsUser(session, (tx) =>
    tx
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.householdId, request.householdId),
          eq(documents.contentHash, contentHash),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1),
  );

  if (existing.length > 0) {
    // The cheapest guard of the three, and the one that catches the most common
    // mistake: downloading the same statement twice.
    return { ok: false, reason: 'alreadyImported' };
  }

  try {
    await putDocument(storageKey, request.bytes, request.mimeType);
  } catch {
    return { ok: false, reason: 'storageUnavailable' };
  }

  await queryAsUser(session, (tx) =>
    tx.insert(documents).values({
      id: documentId,
      householdId: request.householdId,
      uploadedBy: session.user.id,
      accountId: request.accountId,
      kind: 'bank_statement',
      fileName: request.fileName,
      mimeType: request.mimeType,
      byteSize: request.bytes.byteLength,
      storageKey,
      contentHash,
    }),
  );

  const jobId = await enqueueJob(session, request.householdId, STATEMENT_IMPORT_JOB, {
    documentId,
    accountId: request.accountId,
    currency: request.currency,
    fileName: request.fileName,
    storageKey,
  });

  if (!jobId) return { ok: false, reason: 'queueUnavailable' };

  return { ok: true, documentId, jobId };
}

/**
 * The worker half.
 *
 * Runs with the admin handle, because a job has no session — one of the three
 * sanctioned uses, alongside migrations and seeds. Every statement it touches
 * is still scoped by the household id the job carries, which was written under
 * RLS by the person who uploaded the file.
 */
registerJobHandler(STATEMENT_IMPORT_JOB, async (job, report) => {
  const payload = job.payload as {
    documentId?: string;
    accountId?: string;
    currency?: string;
    fileName?: string;
    mimeType?: string;
    storageKey?: string;
  };

  const { documentId, accountId, storageKey } = payload;
  if (!documentId || !accountId || !storageKey) {
    return { failure: 'This import is missing the file it was meant to read.', retryable: false };
  }

  const currency: CurrencyCode = payload.currency === 'PAB' ? 'PAB' : 'USD';
  const db = getAdminDb(getServerEnv().DIRECT_URL);

  await report(10, 'reading');

  let bytes: Uint8Array;
  try {
    bytes = await readDocument(storageKey);
  } catch {
    // Storage being briefly unreachable is exactly what retries are for.
    return { failure: 'The stored file could not be read.', retryable: true };
  }

  await report(35, 'parsing');

  const mimeType = payload.mimeType ?? '';

  let readByOcr = false;
  let parsed;
  try {
    parsed = parseDocument(bytes, {
      accountId,
      currency,
      ...(payload.fileName ? { fileName: payload.fileName } : {}),
    });
  } catch (error: unknown) {
    /*
      El parser determinista no pudo. Antes esto terminaba aquí.

      Un escaneo y una foto no tienen columnas que recorrer, y hasta hoy se
      rechazaban por su nombre — honesto, pero inútil en un producto cuyo
      trabajo central es leer estados de cuenta. Cuando el archivo es algo que
      se puede mirar, se mira: el documento viaja como adjunto al proveedor que
      ya está configurado y vuelve transcrito, línea por línea.

      La transcripción **no** entra al libro. Pasa por el mismo validador de
      montos y fechas que las demás rutas y cae en la misma cola de revisión,
      así que lo que un modelo leyó mal lo corrige una persona antes de que sea
      un movimiento — no después de haberlo sido.
    */
    if (canReadByOcr(mimeType)) {
      await report(45, 'reading_scan');

      const read = await readStatementByOcr({ bytes, mimeType, accountId, currency });
      if (read.ok) {
        parsed = read.statement;
        readByOcr = true;
      } else {
        return { failure: ocrFailureMessage(read.reason), retryable: read.reason === 'transport' };
      }
    } else {
      // A file that will not parse will not parse next time either. Retrying
      // three times to print the same sentence wastes fifteen minutes of the
      // household's patience.
      return {
        failure:
          error instanceof StatementParseError
            ? error.message
            : 'The file could not be read as a statement.',
        retryable: false,
      };
    }
  }

  await report(65, 'matching');

  const summary = await fileImportRows(db, {
    householdId: job.householdId,
    documentId,
    accountId,
    currency,
    jobId: job.id,
    parsed,
    readByOcr,
  });

  await report(100, 'ready');

  return { result: { importId: summary.importId, ...summary.counts } };
});

interface FileRowsInput {
  readonly householdId: string;
  readonly documentId: string;
  readonly accountId: string;
  readonly currency: CurrencyCode;
  readonly jobId: string;
  readonly parsed: ReturnType<typeof parseDocument>;
  readonly readByOcr: boolean;
}

async function fileImportRows(
  db: Database,
  input: FileRowsInput,
): Promise<{ importId: string; counts: ImportSummary }> {
  const importId = newId<string>();

  // Only the window the identity engine can actually match within is loaded.
  // Pulling a whole history to compare a hundred rows would be both slow and
  // pointless — nothing outside the window can be a duplicate.
  const dates = input.parsed.transactions.map((candidate) => candidate.transactionDate).sort();
  const earliest = dates[0];
  const latest = dates[dates.length - 1];

  const stored: ExistingTransaction[] =
    earliest && latest
      ? (
          await db
            .select({
              id: transactions.id,
              accountId: transactions.accountId,
              transactionDate: transactions.transactionDate,
              postedDate: transactions.postedDate,
              amount: transactions.amount,
              descriptionNormalized: transactions.descriptionNormalized,
              externalReference: transactions.externalReference,
              fingerprint: transactions.fingerprint,
              merchantId: transactions.merchantId,
              sourceDocumentId: transactions.sourceDocumentId,
            })
            .from(transactions)
            .where(
              and(
                eq(transactions.accountId, input.accountId),
                isNull(transactions.deletedAt),
                gte(transactions.transactionDate, shiftDate(earliest, -10)),
                lte(transactions.transactionDate, shiftDate(latest, 10)),
              ),
            )
        ).map((row) => ({
          id: row.id,
          accountId: row.accountId,
          transactionDate: row.transactionDate as PlainDate,
          postedDate: (row.postedDate as PlainDate | null) ?? null,
          amount: Money.fromDecimalString(row.amount, input.currency),
          descriptionNormalized: row.descriptionNormalized,
          externalReference: row.externalReference,
          fingerprint: row.fingerprint,
          merchantId: row.merchantId,
          sourceDocumentId: row.sourceDocumentId,
        }))
      : [];

  const counts = {
    found: input.parsed.transactions.length,
    created: 0,
    duplicate: 0,
    review: 0,
    rejected: input.parsed.rejected.length,
  };

  const rows: (typeof importRows.$inferInsert)[] = [];

  // Rows already assessed in this run join the comparison set, so a statement
  // that repeats a line inside itself is caught too.
  const seen = [...stored];

  for (const candidate of input.parsed.transactions) {
    const assessment = assessDuplicate(candidate, seen);

    rows.push({
      importId,
      householdId: input.householdId,
      transactionDate: candidate.transactionDate,
      amount: candidate.amount.toDecimalString(),
      currency: input.currency,
      descriptionOriginal: candidate.descriptionOriginal,
      descriptionNormalized: candidate.descriptionNormalized,
      externalReference: candidate.externalReference ?? null,
      fingerprint: candidate.fingerprint,
      verdict: assessment.verdict,
      confidence: assessment.confidence.toFixed(3),
      matchedTransactionId: assessment.matchedTransactionId,
      matchedSignals: [...assessment.signals],
    });

    if (assessment.verdict === 'duplicate') counts.duplicate += 1;
    else if (assessment.verdict === 'review') counts.review += 1;
    else counts.created += 1;
  }

  for (const rejection of input.parsed.rejected) {
    rows.push({
      importId,
      householdId: input.householdId,
      lineNumber: rejection.line,
      verdict: 'rejected',
      rejectionReason: rejection.reason,
      raw: rejection.raw.slice(0, 500),
      matchedSignals: [],
    });
  }

  const [document] = await db
    .select({ contentHash: documents.contentHash, uploadedBy: documents.uploadedBy })
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);

  await db.insert(imports).values({
    id: importId,
    householdId: input.householdId,
    documentId: input.documentId,
    accountId: input.accountId,
    startedBy: document?.uploadedBy ?? null,
    jobId: input.jobId,
    status: 'review',
    format: input.parsed.format,
    readByOcr: input.readByOcr,
    rowsFound: counts.found,
    rowsNew: counts.created,
    rowsDuplicate: counts.duplicate,
    rowsReview: counts.review,
    rowsRejected: counts.rejected,
    // Same file, same account — a retry cannot produce a second import
    // (spec §67).
    idempotencyKey: `${input.householdId}:${input.accountId}:${document?.contentHash ?? importId}`,
  });

  if (rows.length > 0) {
    await db.insert(importRows).values(rows);
  }

  // The statement period is only knowable once the rows are read, and the
  // document row was written before that.
  if (input.parsed.periodStart || input.parsed.periodEnd || earliest) {
    await db
      .update(documents)
      .set({
        statementPeriodStart: input.parsed.periodStart ?? earliest ?? null,
        statementPeriodEnd: input.parsed.periodEnd ?? latest ?? null,
      })
      .where(eq(documents.id, input.documentId));
  }

  return { importId, counts };
}

/** Shifts a calendar date without going near a `Date`'s timezone. */
function shiftDate(date: PlainDate, days: number): string {
  const [year = '0', month = '1', day = '1'] = date.split('-');
  const shifted = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * Por qué no se pudo leer un escaneo, en una frase que le sirva a quien subió.
 *
 * «Falló el OCR» no le dice a nadie qué hacer. Cada motivo tiene una salida
 * distinta —conseguir otro archivo, achicarlo, esperar, avisarle a alguien— y
 * decir cuál es la diferencia entre un error y una instrucción.
 */
function ocrFailureMessage(reason: OcrFailure): string {
  switch (reason) {
    case 'not_configured':
      return 'This deployment has no AI provider configured, so a scanned statement cannot be read. Upload the CSV, OFX or XLSX your bank offers.';
    case 'unsupported_type':
      return 'This file is neither a statement this system can parse nor a document it can look at.';
    case 'too_large':
      return 'This scan is too large to read. Export fewer pages, or lower the scan resolution.';
    case 'transport':
      return 'The reader could not be reached. This will be retried.';
    case 'malformed':
      return 'The scan was read but the answer came back unusable. Try a clearer scan.';
    case 'no_rows':
      return 'No movement lines could be read from this scan. It may be a summary page, or too blurred to read. This is not the same as an empty statement.';
  }
}
