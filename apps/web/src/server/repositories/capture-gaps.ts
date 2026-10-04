import 'server-only';

import { findCaptureGaps, type CaptureFile, type EdgeLine } from '@app/transaction-engine';
import { sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * Seams between captures where something may be missing.
 *
 * Read from the captures still waiting to be saved, per account, with every
 * line they hold — merged repeats included, because a repeat is exactly the
 * evidence that two captures overlap. A seam the household already confirmed
 * is not asked again.
 */

export interface CaptureGapView {
  readonly accountId: string;
  readonly accountName: string;
  readonly maskedNumber: string | null;
  readonly from: string;
  readonly to: string;
  readonly olderImportId: string;
  readonly evidence: 'cut_line' | 'days_apart' | 'no_overlap';
  /** The day of the line cut at the top of the older capture, when legible. */
  readonly cutText: string | null;
  readonly newer: {
    readonly documentId: string;
    readonly fileName: string;
    readonly isImage: boolean;
  };
  readonly older: {
    readonly documentId: string;
    readonly fileName: string;
    readonly isImage: boolean;
  };
}

export async function loadCaptureGaps(
  session: Session,
  householdId: string,
): Promise<readonly CaptureGapView[]> {
  return queryAsUser(session, async (tx) => {
    const runs = await tx.execute<{
      id: string;
      account_id: string;
      account_name: string;
      masked_number: string | null;
      edge_lines: { top: EdgeLine | null; bottom: EdgeLine | null } | null;
      continuity_confirmed: boolean;
      document_id: string;
      file_name: string;
      mime_type: string;
      lines: { fingerprint: string; date: string; amount: string }[] | null;
    }>(sql`
      select i.id, i.account_id, a.name as account_name, a.masked_number,
             i.edge_lines, i.continuity_confirmed,
             d.id as document_id, d.file_name, d.mime_type,
             (
               select json_agg(json_build_object(
                 'fingerprint', r.fingerprint,
                 'date', r.transaction_date::text,
                 'amount', r.amount::text
               ))
                 from app.import_rows r
                where r.import_id = i.id
                  and r.verdict <> 'rejected'
                  and r.fingerprint is not null
                  and r.transaction_date is not null
             ) as lines
        from app.imports i
        join app.accounts a on a.id = i.account_id
        join app.documents d on d.id = i.document_id
       where i.household_id = ${householdId}
         and i.status = 'review'
         and i.read_by_ocr
    `);

    const byId = new Map(runs.map((run) => [run.id, run]));
    const byAccount = new Map<string, CaptureFile[]>();
    for (const run of runs) {
      const files = byAccount.get(run.account_id) ?? [];
      files.push({
        importId: run.id,
        lines: run.lines ?? [],
        edges: { top: run.edge_lines?.top ?? null, bottom: run.edge_lines?.bottom ?? null },
      });
      byAccount.set(run.account_id, files);
    }

    const views: CaptureGapView[] = [];
    for (const files of byAccount.values()) {
      for (const gap of findCaptureGaps(files)) {
        const newer = byId.get(gap.newerImportId);
        const older = byId.get(gap.olderImportId);
        if (!newer || !older || older.continuity_confirmed) continue;
        // What shows of the line cut at the top of the older capture — the one
        // that belongs to neither side.
        const top = older.edge_lines?.top ?? null;
        const cut = top?.date ?? '';
        views.push({
          accountId: older.account_id,
          accountName: older.account_name,
          maskedNumber: older.masked_number,
          from: gap.from,
          to: gap.to,
          olderImportId: older.id,
          evidence: gap.evidence,
          cutText: cut === '' ? null : cut,
          newer: {
            documentId: newer.document_id,
            fileName: newer.file_name,
            isImage: newer.mime_type.startsWith('image/'),
          },
          older: {
            documentId: older.document_id,
            fileName: older.file_name,
            isImage: older.mime_type.startsWith('image/'),
          },
        });
      }
    }
    return views;
  });
}
