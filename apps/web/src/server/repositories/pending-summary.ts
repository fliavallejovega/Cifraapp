import 'server-only';

import { sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * What saving the read files would put in the books, before anyone presses
 * the button.
 *
 * Per account: how many movements come in and how many go out, with their
 * totals, and every line underneath. Exactly the lines «Guardar» files — the
 * ones read as new — so the summary and the result cannot disagree. Lines the
 * engine merged as repeats, or set aside as already in the books, are counted
 * apart and never in the totals.
 */

export interface PendingLine {
  readonly date: string;
  readonly description: string;
  /** Signed decimal string: negative goes out. */
  readonly amount: string;
  /** The card this line pays, when it is a payment to one. */
  readonly paysCard: string | null;
}

export interface PendingAccount {
  readonly accountId: string;
  readonly name: string;
  readonly maskedNumber: string | null;
  readonly currency: string;
  readonly files: number;
  readonly inflow: { readonly count: number; readonly total: string };
  readonly outflow: { readonly count: number; readonly total: string };
  /** Out of the outflows: payments to the household's own cards — not spending. */
  readonly cardPayments: { readonly count: number; readonly total: string };
  /** Repeats merged and lines already in the books: not filed. */
  readonly skipped: number;
  readonly lines: readonly PendingLine[];
}

export async function loadPendingSummary(
  session: Session,
  householdId: string,
): Promise<readonly PendingAccount[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx.execute<{
      account_id: string;
      name: string;
      masked_number: string | null;
      currency: string;
      files: number;
      in_count: number;
      in_total: string;
      out_count: number;
      out_total: string;
      card_count: number;
      card_total: string;
      skipped: number;
      lines: PendingLine[] | null;
    }>(sql`
      select i.account_id, a.name, a.masked_number, a.currency,
             count(distinct i.id)::int as files,
             count(*) filter (where r.verdict = 'new' and r.amount > 0)::int as in_count,
             coalesce(sum(r.amount) filter (where r.verdict = 'new' and r.amount > 0), 0)::text as in_total,
             count(*) filter (where r.verdict = 'new' and r.amount < 0)::int as out_count,
             coalesce(sum(r.amount) filter (where r.verdict = 'new' and r.amount < 0), 0)::text as out_total,
             count(*) filter (where r.verdict = 'new' and r.amount < 0 and r.apply_to_debt_id is not null)::int as card_count,
             coalesce(sum(r.amount) filter (where r.verdict = 'new' and r.amount < 0 and r.apply_to_debt_id is not null), 0)::text as card_total,
             count(*) filter (where r.verdict in ('duplicate', 'review'))::int as skipped,
             json_agg(json_build_object(
               'date', r.transaction_date::text,
               'description', r.description_original,
               'amount', r.amount::text,
               'paysCard', (select d.name from app.debts d where d.id = r.apply_to_debt_id)
             ) order by r.transaction_date desc, r.amount)
               filter (where r.verdict = 'new') as lines
        from app.imports i
        join app.accounts a on a.id = i.account_id
        join app.import_rows r on r.import_id = i.id
       where i.household_id = ${householdId}
         and i.status = 'review'
         and r.created_transaction_id is null
         and r.verdict <> 'rejected'
         and r.amount is not null
       group by i.account_id, a.name, a.masked_number, a.currency
       order by a.name
    `),
  );

  return rows.map((row) => ({
    accountId: row.account_id,
    name: row.name,
    maskedNumber: row.masked_number,
    currency: row.currency.trim(),
    files: row.files,
    inflow: { count: row.in_count, total: row.in_total },
    outflow: { count: row.out_count, total: row.out_total },
    cardPayments: { count: row.card_count, total: row.card_total },
    skipped: row.skipped,
    lines: row.lines ?? [],
  }));
}
