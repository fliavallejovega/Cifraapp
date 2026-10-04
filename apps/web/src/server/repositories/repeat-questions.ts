import 'server-only';

import { sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * Lines that appear in more than one file still waiting for review.
 *
 * Screenshots of a banking app overlap: the bottom of one is the top of the
 * next, so the same movement is read twice. Nothing has reached the ledger
 * yet, which is why the duplicate engine — which compares against the ledger —
 * cannot see it. This compares the pending files with each other, by the same
 * fingerprint (account, date, amount, description), and turns each repeat into
 * a question for the person: is it one movement or two?
 */

export interface RepeatQuestion {
  readonly accountId: string;
  readonly accountName: string;
  readonly fingerprint: string;
  readonly date: string;
  readonly description: string;
  readonly amount: string;
  readonly currency: string;
  /** The files it appears in, oldest first. */
  readonly files: readonly string[];
  readonly copies: number;
}

export async function loadRepeatQuestions(
  session: Session,
  householdId: string,
): Promise<readonly RepeatQuestion[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx.execute<{
      account_id: string;
      account_name: string;
      fingerprint: string;
      transaction_date: string;
      description: string;
      amount: string;
      currency: string;
      files: string[];
      copies: number;
    }>(sql`
      select i.account_id,
             a.name as account_name,
             r.fingerprint,
             min(r.transaction_date)::text as transaction_date,
             min(r.description_original) as description,
             min(r.amount)::text as amount,
             a.currency,
             array_agg(d.file_name order by i.started_at) as files,
             count(*)::int as copies
        from app.import_rows r
        join app.imports i on i.id = r.import_id
        join app.accounts a on a.id = i.account_id
        left join app.documents d on d.id = i.document_id
       where i.household_id = ${householdId}
         and i.status = 'review'
         and r.verdict = 'new'
         and r.created_transaction_id is null
         and r.distinct_confirmed = false
         and r.fingerprint is not null
       group by i.account_id, a.name, a.currency, r.fingerprint
      having count(distinct r.import_id) > 1
       order by min(r.transaction_date) desc
       limit 50
    `),
  );

  return rows.map((row) => ({
    accountId: row.account_id,
    accountName: row.account_name,
    fingerprint: row.fingerprint,
    date: row.transaction_date,
    description: row.description,
    amount: row.amount,
    currency: row.currency.trim(),
    files: row.files,
    copies: row.copies,
  }));
}
