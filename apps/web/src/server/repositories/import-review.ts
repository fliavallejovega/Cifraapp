import 'server-only';

import { accounts, documents, importRows, imports } from '@app/database/schema';
import { Money, type CurrencyCode, type PlainDate } from '@app/domain';
import { and, asc, eq } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * One import, ready to be reviewed.
 *
 * The pipeline parsed statements, assessed every line and wrote a verdict for
 * each — and then stopped, because nothing ever read these rows back. The
 * result was an importer that could take a file and never produce a movement:
 * every household in the database had import rows and zero transactions.
 *
 * The verdict is the point of the screen. A row the engine believes is new is
 * pre-selected; one it believes is a duplicate is not, and says which signals
 * matched. The person decides, and the decision is what writes to the ledger.
 */

export type Verdict = 'new' | 'duplicate' | 'review' | 'rejected';

export interface ImportRowView {
  readonly id: string;
  readonly lineNumber: number | null;
  readonly date: PlainDate | null;
  readonly amount: Money | null;
  readonly description: string;
  readonly verdict: Verdict;
  readonly confidence: number | null;
  readonly signals: readonly string[];
  readonly rejectionReason: string | null;
  readonly raw: string | null;
  /** Set once this row has become a transaction. It cannot become a second one. */
  readonly createdTransactionId: string | null;
}

export interface ImportReview {
  readonly id: string;
  readonly fileName: string;
  readonly accountId: string | null;
  readonly accountName: string | null;
  readonly currency: CurrencyCode;
  readonly status: string;
  readonly startedAt: Date;
  readonly rows: readonly ImportRowView[];
  readonly counts: {
    readonly new: number;
    readonly duplicate: number;
    readonly review: number;
    readonly rejected: number;
    readonly alreadyFiled: number;
  };
  /** True when every importable row has already become a transaction. */
  readonly isSettled: boolean;
}

export async function loadImportReview(
  session: Session,
  householdId: string,
  importId: string,
  currency: CurrencyCode,
): Promise<ImportReview | null> {
  return queryAsUser(session, async (tx) => {
    const [header] = await tx
      .select({
        id: imports.id,
        status: imports.status,
        startedAt: imports.startedAt,
        accountId: imports.accountId,
        accountName: accounts.name,
        fileName: documents.fileName,
      })
      .from(imports)
      .innerJoin(documents, eq(documents.id, imports.documentId))
      .leftJoin(accounts, eq(accounts.id, imports.accountId))
      .where(and(eq(imports.id, importId), eq(imports.householdId, householdId)))
      .limit(1);

    if (!header) return null;

    const rows = await tx
      .select({
        id: importRows.id,
        lineNumber: importRows.lineNumber,
        date: importRows.transactionDate,
        amount: importRows.amount,
        descriptionOriginal: importRows.descriptionOriginal,
        verdict: importRows.verdict,
        confidence: importRows.confidence,
        signals: importRows.matchedSignals,
        rejectionReason: importRows.rejectionReason,
        raw: importRows.raw,
        createdTransactionId: importRows.createdTransactionId,
      })
      .from(importRows)
      .where(eq(importRows.importId, importId))
      // Rejected lines carry a line number and no date; dated rows sort by
      // date. Ordering by both keeps the list in the file's own order.
      .orderBy(asc(importRows.transactionDate), asc(importRows.lineNumber));

    const views: ImportRowView[] = rows.map((row) => ({
      id: row.id,
      lineNumber: row.lineNumber,
      date: (row.date as PlainDate | null) ?? null,
      amount: row.amount === null ? null : Money.fromDecimalString(row.amount, currency),
      description: row.descriptionOriginal ?? '',
      verdict: normalizeVerdict(row.verdict),
      confidence: row.confidence === null ? null : Number(row.confidence),
      signals: Array.isArray(row.signals) ? (row.signals as string[]) : [],
      rejectionReason: row.rejectionReason,
      raw: row.raw,
      createdTransactionId: row.createdTransactionId,
    }));

    const counts = {
      new: views.filter((row) => row.verdict === 'new').length,
      duplicate: views.filter((row) => row.verdict === 'duplicate').length,
      review: views.filter((row) => row.verdict === 'review').length,
      rejected: views.filter((row) => row.verdict === 'rejected').length,
      alreadyFiled: views.filter((row) => row.createdTransactionId !== null).length,
    };

    const importable = views.filter((row) => row.verdict !== 'rejected');

    return {
      id: header.id,
      fileName: header.fileName,
      accountId: header.accountId,
      accountName: header.accountName,
      currency,
      status: header.status,
      startedAt: header.startedAt,
      rows: views,
      counts,
      isSettled:
        importable.length > 0 && importable.every((row) => row.createdTransactionId !== null),
    };
  });
}

/** The verdict column is free text in the schema; the interface needs a set. */
function normalizeVerdict(value: string): Verdict {
  return value === 'duplicate' || value === 'review' || value === 'rejected' ? value : 'new';
}
