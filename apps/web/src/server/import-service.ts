import 'server-only';

import { documents, imports, importRows, transactions } from '@app/database/schema';
import { Money, newId, type PlainDate } from '@app/domain';
import {
  assessDuplicate,
  computeDocumentHash,
  parseStatement,
  StatementParseError,
  type ExistingTransaction,
} from '@app/transaction-engine';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';

import { queryAsUser, type Session } from './session';
import { buildStorageKey, putDocument } from './storage';

/**
 * The import pipeline.
 *
 * Upload → hash → store → parse → assess → review. Nothing is written to
 * `app.transactions` here; this run produces a verdict per row and stops. A
 * person confirms before money enters their records, because an importer that
 * writes first and asks later has already broken the promise the product is
 * built on (spec §12, §14).
 *
 * Three guards, in order of cheapness:
 *
 *   1. The content hash rejects a re-uploaded file before it is parsed.
 *   2. The idempotency key makes a retried run a no-op rather than a second copy.
 *   3. The identity engine assesses every row against what is already stored.
 */

/** Anything larger is a document nobody exports from a bank. */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const ACCEPTED_MIME_TYPES = new Set([
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel',
  'application/x-ofx',
  'application/ofx',
  'application/octet-stream',
]);

export type ImportOutcome =
  | { readonly ok: true; readonly importId: string; readonly summary: ImportSummary }
  | { readonly ok: false; readonly reason: ImportFailure; readonly detail?: string };

export type ImportFailure =
  'tooLarge' | 'unsupportedType' | 'alreadyImported' | 'unreadable' | 'storageUnavailable';

export interface ImportSummary {
  readonly found: number;
  readonly created: number;
  readonly duplicate: number;
  readonly review: number;
  readonly rejected: number;
}

export interface ImportRequest {
  readonly householdId: string;
  readonly accountId: string;
  readonly currency: 'USD' | 'PAB';
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export async function runImport(session: Session, request: ImportRequest): Promise<ImportOutcome> {
  if (request.bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: 'tooLarge' };
  }

  if (!ACCEPTED_MIME_TYPES.has(request.mimeType)) {
    return { ok: false, reason: 'unsupportedType' };
  }

  const contentHash = computeDocumentHash(request.bytes);
  const text = new TextDecoder('utf-8').decode(request.bytes);

  // Parsed before anything is stored. A file we cannot read should not leave a
  // document row and an orphaned object behind.
  let parsed;
  try {
    parsed = parseStatement(text, {
      accountId: request.accountId,
      currency: request.currency,
      fileName: request.fileName,
    });
  } catch (error: unknown) {
    return {
      ok: false,
      reason: 'unreadable',
      ...(error instanceof StatementParseError ? { detail: error.message } : {}),
    };
  }

  const documentId = newId<string>();
  const extension = request.fileName.split('.').pop() ?? '';
  const storageKey = buildStorageKey('documents', request.householdId, documentId, extension);

  return queryAsUser(session, async (tx) => {
    const existingDocument = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.householdId, request.householdId),
          eq(documents.contentHash, contentHash),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    if (existingDocument.length > 0) {
      // The cheapest guard of the three, and the one that catches the most
      // common mistake: downloading the same statement twice.
      return { ok: false, reason: 'alreadyImported' } as const;
    }

    try {
      await putDocument(storageKey, request.bytes, request.mimeType);
    } catch {
      return { ok: false, reason: 'storageUnavailable' } as const;
    }

    await tx.insert(documents).values({
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
      ...(parsed.periodStart ? { statementPeriodStart: parsed.periodStart } : {}),
      ...(parsed.periodEnd ? { statementPeriodEnd: parsed.periodEnd } : {}),
    });

    const importId = newId<string>();

    // Only the window the identity engine can actually match within is loaded.
    // Pulling a whole history to compare a hundred rows would be both slow and
    // pointless — nothing outside the window can be a duplicate.
    const dates = parsed.transactions.map((candidate) => candidate.transactionDate).sort();
    const earliest = dates[0];
    const latest = dates[dates.length - 1];

    const stored: ExistingTransaction[] =
      earliest && latest
        ? (
            await tx
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
                  eq(transactions.accountId, request.accountId),
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
            amount: Money.fromDecimalString(row.amount, request.currency),
            descriptionNormalized: row.descriptionNormalized,
            externalReference: row.externalReference,
            fingerprint: row.fingerprint,
            merchantId: row.merchantId,
            sourceDocumentId: row.sourceDocumentId,
          }))
        : [];

    const summary = {
      found: parsed.transactions.length,
      created: 0,
      duplicate: 0,
      review: 0,
      rejected: parsed.rejected.length,
    };
    const rows: (typeof importRows.$inferInsert)[] = [];

    // Rows already assessed in this run join the comparison set, so a statement
    // that repeats a line inside itself is caught too.
    const seen = [...stored];

    for (const candidate of parsed.transactions) {
      const assessment = assessDuplicate(candidate, seen);

      rows.push({
        importId,
        householdId: request.householdId,
        transactionDate: candidate.transactionDate,
        amount: candidate.amount.toDecimalString(),
        currency: request.currency,
        descriptionOriginal: candidate.descriptionOriginal,
        descriptionNormalized: candidate.descriptionNormalized,
        externalReference: candidate.externalReference ?? null,
        fingerprint: candidate.fingerprint,
        verdict: assessment.verdict === 'new' ? 'new' : assessment.verdict,
        confidence: assessment.confidence.toFixed(3),
        matchedTransactionId: assessment.matchedTransactionId,
        matchedSignals: [...assessment.signals],
      });

      if (assessment.verdict === 'duplicate') summary.duplicate += 1;
      else if (assessment.verdict === 'review') summary.review += 1;
      else summary.created += 1;
    }

    for (const rejection of parsed.rejected) {
      rows.push({
        importId,
        householdId: request.householdId,
        lineNumber: rejection.line,
        verdict: 'rejected',
        rejectionReason: rejection.reason,
        raw: rejection.raw.slice(0, 500),
        matchedSignals: [],
      });
    }

    await tx.insert(imports).values({
      id: importId,
      householdId: request.householdId,
      documentId,
      accountId: request.accountId,
      startedBy: session.user.id,
      status: 'review',
      format: parsed.format,
      rowsFound: summary.found,
      rowsNew: summary.created,
      rowsDuplicate: summary.duplicate,
      rowsReview: summary.review,
      rowsRejected: summary.rejected,
      // Same file, same account, same run — a retry cannot produce a second
      // import (spec §67).
      idempotencyKey: `${request.householdId}:${request.accountId}:${contentHash}`,
    });

    if (rows.length > 0) {
      await tx.insert(importRows).values(rows);
    }

    return { ok: true, importId, summary } as const;
  });
}

/** Shifts a calendar date without going near a `Date`'s timezone. */
function shiftDate(date: PlainDate, days: number): string {
  const [year = '0', month = '1', day = '1'] = date.split('-');
  const shifted = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + days));
  return shifted.toISOString().slice(0, 10);
}
