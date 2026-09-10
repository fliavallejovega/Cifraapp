import 'server-only';

import { getAdminDb, type Database } from '@app/database';
import { debts, documents, imports, importRows, transactions } from '@app/database/schema';
import { Money, newId, type CurrencyCode, type PlainDate } from '@app/domain';
import { classify } from '@app/category-engine';
import {
  adjudicate,
  assessDuplicate,
  proposeDebt,
  computeDocumentHash,
  detectStatementFormat,
  parseDocument,
  StatementParseError,
  type DebtTarget,
  type ExistingTransaction,
} from '@app/transaction-engine';
import { getServerEnv } from '@app/validation/env';
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';

import { askAboutNearMisses } from './duplicate-opinion';
import { loadClassificationInputs } from './classification-context';
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

  /**
   * De dónde salió cada movimiento que ya estaba, para poder decirlo.
   *
   * «Esto ya está registrado» no le sirve a nadie. «Esto ya lo anotó Vale a
   * mano en su cuenta el 7» es lo que deja decidir sin salir de la pantalla.
   */
  const provenance = new Map<string, { accountId: string; accountName: string | null; source: string }>();

  const storedRows =
    earliest && latest
      ? await db
            .select({
              id: transactions.id,
              accountId: transactions.accountId,
              accountName: sql<string | null>`(
                select a.name from app.accounts a where a.id = ${transactions.accountId}
              )`,
              source: transactions.source,
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
                /*
                  Todo el hogar, no la cuenta que se está importando.

                  Antes esto decía `eq(transactions.accountId, input.accountId)`
                  y ese `and` de una línea era el motivo de que un pago que una
                  persona anotó a mano en su cuenta no apareciera al importar el
                  estado de cuenta de la otra: la fila llegaba a la pantalla
                  marcada «nueva», se confirmaba, y el mismo movimiento quedaba
                  registrado dos veces. Recién un barrido posterior lo notaba,
                  cuando ya era plata en el libro.

                  Una casa no lleva sus cuentas por cuenta bancaria. Lleva una
                  sola, y el mismo pago sale de donde salga.
                */
                eq(transactions.householdId, input.householdId),
                isNull(transactions.deletedAt),
                gte(transactions.transactionDate, shiftDate(earliest, -10)),
                lte(transactions.transactionDate, shiftDate(latest, 10)),
              ),
            )
      : [];

  const stored: ExistingTransaction[] = storedRows.map((row) => {
    provenance.set(row.id, {
      accountId: row.accountId,
      accountName: row.accountName,
      source: row.source,
    });

    return {
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
    };
  });

  const counts = {
    found: input.parsed.transactions.length,
    created: 0,
    duplicate: 0,
    review: 0,
    rejected: input.parsed.rejected.length,
  };

  const rows: (typeof importRows.$inferInsert)[] = [];

  /*
    Clasificar aquí y no después de confirmar.

    Antes la categorización corría **al confirmar**: la casa aprobaba una lista
    de descripciones crudas sin saber con qué rubro iban a quedar ni qué le
    iban a hacer al presupuesto del mes. Aprobar algo que todavía no se puede
    mirar no es aprobar, es firmar.

    Las reglas y los comercios se cargan una vez para toda la corrida, con sus
    alias — que hasta hoy se pasaban vacíos.
  */
  const inputs = await loadClassificationInputs(db, input.householdId);

  /*
    Las deudas de la casa, para reconocer un pago cuando pasa.

    Sin esto un pago de $600 a la tarjeta es un gasto de $600 —el mes se ve peor
    de lo que fue— y la tarjeta sigue debiendo lo mismo. Es dinero moviéndose de
    un bolsillo a otro de la misma casa, y contarlo como gasto es contarlo dos
    veces: una al comprar, otra al pagar.
  */
  const debtTargets: DebtTarget[] = (
    await db
      .select({
        debtId: debts.id,
        label: debts.name,
        counterpartyNormalized: debts.counterpartyNormalized,
        kind: debts.kind,
        outstanding: debts.currentBalance,
        maskedNumber: sql<string | null>`(
          select a.masked_number from app.accounts a where a.id = ${debts.accountId}
        )`,
      })
      .from(debts)
      .where(and(eq(debts.householdId, input.householdId), isNull(debts.deletedAt)))
  ).map((row) => ({
    debtId: row.debtId,
    label: row.label,
    counterpartyNormalized: row.counterpartyNormalized,
    maskedNumber: row.maskedNumber,
    isCard: row.kind === 'credit_card',
    outstanding: Money.fromDecimalString(row.outstanding, input.currency),
  }));

  // Rows already assessed in this run join the comparison set, so a statement
  // that repeats a line inside itself is caught too.
  const seen = [...stored];

  interface Pending {
    readonly candidate: (typeof input.parsed.transactions)[number];
    readonly assessment: ReturnType<typeof assessDuplicate>;
    readonly classification: ReturnType<typeof classify>;
    readonly nearMiss: ExistingTransaction | null;
  }

  const pending: Pending[] = [];

  for (const candidate of input.parsed.transactions) {
    const assessment = assessDuplicate(candidate, seen);

    const classification = classify(
      {
        id: candidate.fingerprint,
        descriptionNormalized: candidate.descriptionNormalized,
        amount: candidate.amount,
        direction: candidate.direction,
        transactionDate: candidate.transactionDate,
      },
      inputs,
    );

    /*
      El casi-acierto: un movimiento ya registrado del mismo monto exacto y
      dentro de la ventana, que el motor no llegó a marcar.

      Es el único sitio donde una segunda lectura cambia algo. «Pago a Giovanni»
      contra «GIOVANNI CINTIONE» es evidente para cualquier persona y opaco para
      un trigrama, y sin este paso la fila llega a la pantalla como nueva.
    */
    const nearMiss =
      assessment.verdict === 'new'
        ? (stored.find(
            (one) =>
              one.amount.abs().equals(candidate.amount.abs()) &&
              withinDays(one.transactionDate, candidate.transactionDate, 4),
          ) ?? null)
        : null;

    pending.push({ candidate, assessment, classification, nearMiss });
  }

  /*
    La segunda lectura, sólo sobre los casi-aciertos, y sólo para subir a
    revisión. Si el proveedor no está configurado o falla, la importación sigue
    con el veredicto del motor: una lectura que no llegó no puede bloquear una
    importación, y el veredicto determinista nunca dependió de ella.
  */
  const opinions = await askAboutNearMisses(
    pending
      .filter((one): one is Pending & { nearMiss: ExistingTransaction } => one.nearMiss !== null)
      .map((one) => ({
        key: one.candidate.fingerprint,
        incoming: one.candidate.descriptionOriginal,
        existing: one.nearMiss.descriptionNormalized,
        amount: one.candidate.amount.toDecimalString(),
        existingAccount: provenance.get(one.nearMiss.id)?.accountName ?? null,
      })),
  );

  for (const one of pending) {
    const opinion = opinions.get(one.candidate.fingerprint) ?? null;
    const ruling = adjudicate(one.assessment.verdict, opinion?.verdict ?? null);

    const matchedId = ruling.aiChangedIt
      ? (one.nearMiss?.id ?? one.assessment.matchedTransactionId)
      : one.assessment.matchedTransactionId;

    const signals = ruling.aiChangedIt
      ? [...one.assessment.signals, 'ai_saw_the_same_movement']
      : [...one.assessment.signals];

    rows.push({
      importId,
      householdId: input.householdId,
      transactionDate: one.candidate.transactionDate,
      amount: one.candidate.amount.toDecimalString(),
      currency: input.currency,
      descriptionOriginal: one.candidate.descriptionOriginal,
      descriptionNormalized: one.candidate.descriptionNormalized,
      externalReference: one.candidate.externalReference ?? null,
      fingerprint: one.candidate.fingerprint,
      verdict: ruling.verdict,
      confidence: one.assessment.confidence.toFixed(3),
      matchedTransactionId: matchedId,
      matchedAccountId: matchedId ? (provenance.get(matchedId)?.accountId ?? null) : null,
      matchedSignals: signals,
      proposedCategoryId: one.classification.categoryId,
      proposedConfidence: one.classification.confidence.toFixed(3),
      proposedSource: one.classification.appliedRuleId
        ? 'rule'
        : one.classification.categoryId
          ? 'merchant'
          : null,
      // La deuda llega preseleccionada, no aplicada. Equivocarse de deuda mueve
      // plata de un saldo a otro sin que nadie lo note, así que alguien lo
      // confirma en la revisión — la preselección ahorra el trabajo, no lo
      // reemplaza.
      applyToDebtId:
        proposeDebt(
          {
            descriptionNormalized: one.candidate.descriptionNormalized,
            direction: one.candidate.direction,
          },
          debtTargets,
        )?.debtId ?? null,
      aiOpinion: opinion?.verdict ?? null,
      aiReason: opinion?.reason ?? null,
    });

    if (ruling.verdict === 'duplicate') counts.duplicate += 1;
    else if (ruling.verdict === 'review') counts.review += 1;
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
/** Si dos fechas caen dentro de una ventana, sin pasar por la zona del servidor. */
function withinDays(a: PlainDate, b: PlainDate, days: number): boolean {
  const gap = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));
  return gap <= days * 24 * 60 * 60 * 1000;
}

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
