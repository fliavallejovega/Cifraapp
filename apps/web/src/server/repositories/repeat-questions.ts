import 'server-only';

import { importRows } from '@app/database/schema';
import {
  resolveRepeatLines,
  type RepeatFile,
  type RepeatLine,
  type RepeatReason,
} from '@app/transaction-engine';
import { inArray, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * Lines that appear in more than one file still waiting for review.
 *
 * Screenshots of a banking app overlap: the bottom of one is the top of the
 * next, so the same movement is read twice. Nothing has reached the ledger
 * yet, which is why the duplicate engine — which compares against the ledger —
 * cannot see it.
 *
 * The engine settles first what the evidence settles (`resolveRepeatLines`:
 * reference numbers, overlapping captures, the seam between two captures) and
 * says so, with a way back. Only what it cannot settle becomes a question —
 * with the account, the direction, which files and the files themselves to
 * look at.
 */

const AUTO_REASONS: readonly RepeatReason[] = [
  'same_reference',
  'screenshot_overlap',
  'screenshot_seam',
  'same_details',
];

export interface RepeatFileRef {
  readonly documentId: string;
  readonly fileName: string;
  readonly isImage: boolean;
  /** Where the line sits in the image, 0 to 1, when the reader said. */
  readonly top: number | null;
}

export interface RepeatQuestion {
  readonly accountId: string;
  readonly accountName: string;
  readonly maskedNumber: string | null;
  readonly fingerprint: string;
  readonly date: string;
  readonly description: string;
  readonly amount: string;
  readonly currency: string;
  /** The files it appears in, oldest first. */
  readonly files: readonly RepeatFileRef[];
  readonly copies: number;
}

export interface MergedRepeat {
  readonly rowId: string;
  readonly accountName: string;
  readonly maskedNumber: string | null;
  readonly date: string;
  readonly description: string;
  readonly amount: string;
  readonly currency: string;
  readonly reason: RepeatReason;
  readonly fileName: string;
  /** The copy that stays first, then the one merged into it. */
  readonly files: readonly RepeatFileRef[];
}

export interface RepeatReport {
  readonly questions: readonly RepeatQuestion[];
  readonly merged: readonly MergedRepeat[];
}

export async function loadRepeatQuestions(
  session: Session,
  householdId: string,
): Promise<RepeatReport> {
  return queryAsUser(session, async (tx) => {
    // 1. Settle what the evidence settles.
    const pending = await tx.execute<{
      id: string;
      import_id: string;
      account_id: string;
      fingerprint: string;
      transaction_date: string;
      external_reference: string | null;
      started_at: string;
    }>(sql`
      select r.id, r.import_id, i.account_id, r.fingerprint,
             r.transaction_date::text as transaction_date,
             r.external_reference, i.started_at::text as started_at
        from app.import_rows r
        join app.imports i on i.id = r.import_id
       where i.household_id = ${householdId}
         and i.status = 'review'
         and r.verdict = 'new'
         and r.created_transaction_id is null
         and r.distinct_confirmed = false
         and r.fingerprint is not null
         and r.transaction_date is not null
    `);

    type MutableFile = RepeatFile & { lines: RepeatLine[] };
    const byAccount = new Map<string, Map<string, MutableFile>>();
    for (const row of pending) {
      const files = byAccount.get(row.account_id) ?? new Map<string, MutableFile>();
      byAccount.set(row.account_id, files);
      const file: MutableFile = files.get(row.import_id) ?? {
        importId: row.import_id,
        order: Date.parse(row.started_at),
        lines: [],
      };
      files.set(row.import_id, file);
      file.lines.push({
        id: row.id,
        fingerprint: row.fingerprint,
        date: row.transaction_date,
        externalReference: row.external_reference,
      });
    }

    for (const files of byAccount.values()) {
      if (files.size < 2) continue;
      const { duplicates, distinct } = resolveRepeatLines([...files.values()]);
      for (const reason of AUTO_REASONS) {
        const ids = duplicates.filter((d) => d.reason === reason).map((d) => d.id);
        if (ids.length === 0) continue;
        await tx
          .update(importRows)
          .set({ verdict: 'duplicate', matchedSignals: [reason] })
          .where(inArray(importRows.id, ids));
      }
      if (distinct.length > 0) {
        await tx
          .update(importRows)
          .set({ distinctConfirmed: true })
          .where(inArray(importRows.id, [...distinct]));
      }
    }

    // 2. What is left is a question.
    const open = await tx.execute<{
      account_id: string;
      account_name: string;
      masked_number: string | null;
      fingerprint: string;
      transaction_date: string;
      description: string;
      amount: string;
      currency: string;
      files: { documentId: string; fileName: string; mimeType: string; top: number | null }[];
      copies: number;
    }>(sql`
      select i.account_id,
             a.name as account_name,
             a.masked_number,
             r.fingerprint,
             min(r.transaction_date)::text as transaction_date,
             min(r.description_original) as description,
             min(r.amount)::text as amount,
             a.currency,
             json_agg(json_build_object(
               'documentId', d.id, 'fileName', d.file_name, 'mimeType', d.mime_type,
               'top', r.source_top::float8
             ) order by i.started_at) as files,
             count(*)::int as copies
        from app.import_rows r
        join app.imports i on i.id = r.import_id
        join app.accounts a on a.id = i.account_id
        join app.documents d on d.id = i.document_id
       where i.household_id = ${householdId}
         and i.status = 'review'
         and r.verdict = 'new'
         and r.created_transaction_id is null
         and r.distinct_confirmed = false
         and r.fingerprint is not null
       group by i.account_id, a.name, a.masked_number, a.currency, r.fingerprint
      having count(distinct r.import_id) > 1
       order by min(r.transaction_date) desc
       limit 50
    `);

    // 3. What the engine merged, so the person can see it and undo it.
    const merged = await tx.execute<{
      id: string;
      account_name: string;
      masked_number: string | null;
      transaction_date: string;
      description: string;
      amount: string;
      currency: string;
      reason: RepeatReason;
      file_name: string;
      files: { documentId: string; fileName: string; mimeType: string; top: number | null }[];
    }>(sql`
      select r.id, a.name as account_name, a.masked_number,
             coalesce((
               select json_agg(f order by f.started_at) from (
                 select d2.id as "documentId", d2.file_name as "fileName",
                        d2.mime_type as "mimeType", r2.source_top::float8 as top, i2.started_at
                   from app.import_rows r2
                   join app.imports i2 on i2.id = r2.import_id
                   join app.documents d2 on d2.id = i2.document_id
                  where i2.account_id = i.account_id
                    and i2.status = 'review'
                    and r2.fingerprint = r.fingerprint
                    and r2.created_transaction_id is null
                    and (r2.id = r.id or r2.verdict = 'new')
                  limit 4
               ) f
             ), '[]') as files,
             r.transaction_date::text as transaction_date,
             r.description_original as description, r.amount::text as amount,
             a.currency, r.matched_signals->>0 as reason, d.file_name
        from app.import_rows r
        join app.imports i on i.id = r.import_id
        join app.accounts a on a.id = i.account_id
        join app.documents d on d.id = i.document_id
       where i.household_id = ${householdId}
         and i.status = 'review'
         and r.verdict = 'duplicate'
         and r.created_transaction_id is null
         and r.matched_signals->>0 in ('same_reference', 'screenshot_overlap', 'screenshot_seam', 'same_details')
       order by r.transaction_date desc
       limit 100
    `);

    return {
      questions: open.map((row) => ({
        accountId: row.account_id,
        accountName: row.account_name,
        maskedNumber: row.masked_number,
        fingerprint: row.fingerprint,
        date: row.transaction_date,
        description: row.description,
        amount: row.amount,
        currency: row.currency.trim(),
        files: row.files.map(toFileRef),
        copies: row.copies,
      })),
      merged: merged.map((row) => ({
        rowId: row.id,
        accountName: row.account_name,
        maskedNumber: row.masked_number,
        date: row.transaction_date,
        description: row.description,
        amount: row.amount,
        currency: row.currency.trim(),
        reason: row.reason,
        fileName: row.file_name,
        files: row.files.map(toFileRef),
      })),
    };
  });
}

function toFileRef(file: {
  documentId: string;
  fileName: string;
  mimeType: string;
  top: number | null;
}): RepeatFileRef {
  return {
    documentId: file.documentId,
    fileName: file.fileName,
    isImage: file.mimeType.startsWith('image/'),
    top: typeof file.top === 'number' && file.top >= 0 && file.top <= 1 ? file.top : null,
  };
}
