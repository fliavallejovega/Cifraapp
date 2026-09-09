import 'server-only';

import { accounts, receivables, transactions } from '@app/database/schema';
import { Money, toPlainDate, type CurrencyCode, type PlainDate } from '@app/domain';
import {
  proposeReceivableMatches,
  type MatchProposal,
  type MatchReason,
} from '@app/transaction-engine';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * What the household is owed, and what of it has already landed.
 *
 * Two things live here that the product used to keep apart for no good reason.
 * The first is the expectation — the invoice, the deposit that comes back, the
 * client who pays «in the first fortnight». The second is the reconciliation:
 * once a statement is imported, some of that money is sitting in an account
 * under a description nobody has connected to anything.
 *
 * Joining them is the whole job. Without it a household that has been paid
 * still reads that it is owed, and the plan keeps waiting for money that
 * arrived three weeks ago.
 */

export type Confidence = 'confirmed' | 'likely' | 'estimated';

export interface ReceivableView {
  readonly id: string;
  readonly name: string;
  readonly source: string | null;
  readonly amount: Money;
  /** The window it is expected in. Both null means «no sé cuándo». */
  readonly expectedFrom: PlainDate | null;
  readonly expectedTo: PlainDate | null;
  readonly confidence: Confidence;
  readonly receivedOn: PlainDate | null;
  /** The movement that settled it, when one did. */
  readonly receivedTransactionId: string | null;
  readonly notes: string | null;
}

/** A proposed join, with the movement's own details so it can be judged. */
export interface MatchCandidate {
  readonly receivableId: string;
  readonly receivableName: string;
  readonly transactionId: string;
  readonly date: PlainDate;
  readonly amount: Money;
  readonly description: string;
  readonly accountName: string;
  readonly score: number;
  readonly reasons: readonly MatchReason[];
}

export async function loadReceivables(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<readonly ReceivableView[]> {
  const rows = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: receivables.id,
        name: receivables.name,
        source: receivables.source,
        amount: receivables.amount,
        expectedFrom: receivables.expectedFrom,
        expectedTo: receivables.expectedTo,
        expectedOn: receivables.expectedOn,
        confidence: receivables.confidence,
        receivedOn: receivables.receivedOn,
        receivedTransactionId: receivables.receivedTransactionId,
        notes: receivables.notes,
      })
      .from(receivables)
      .where(and(eq(receivables.householdId, householdId), isNull(receivables.deletedAt)))
      .orderBy(receivables.expectedFrom, receivables.name),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    source: row.source,
    amount: Money.fromDecimalString(row.amount, currency),
    // A row written before windows existed carries only the exact date, and it
    // is a window of one day. Resolving it here means no screen has to know
    // there were ever two shapes.
    expectedFrom: (row.expectedFrom ?? row.expectedOn) as PlainDate | null,
    expectedTo: (row.expectedTo ?? row.expectedOn) as PlainDate | null,
    confidence: row.confidence,
    receivedOn: row.receivedOn as PlainDate | null,
    receivedTransactionId: row.receivedTransactionId,
    notes: row.notes,
  }));
}

/**
 * How far back to look for money that might settle an open expectation.
 *
 * Six months. Further back and the proposals are dominated by coincidence —
 * every household has some deposit, somewhere, that happens to be the size of
 * the invoice being looked at.
 */
const LOOKBACK_DAYS = 183;

/**
 * Money that arrived and might be one of the things still on the books.
 *
 * Only inflows, only movements not already claimed by another receivable, and
 * only against accounts the household holds. The proposals come back scored and
 * unapplied: confirming one changes what the household believes it is owed, and
 * that decision is not the software's to make.
 */
export async function loadMatchCandidates(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
  today: PlainDate,
): Promise<readonly MatchCandidate[]> {
  const open = (await loadReceivables(session, householdId, currency)).filter(
    (entry) => entry.receivedOn === null,
  );

  if (open.length === 0) return [];

  const since = shiftDays(today, -LOOKBACK_DAYS);

  const arrived = await queryAsUser(session, (tx) =>
    tx
      .select({
        id: transactions.id,
        date: transactions.transactionDate,
        amount: transactions.amount,
        description: transactions.descriptionOriginal,
        accountName: accounts.name,
        claimed: receivables.id,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(receivables, eq(receivables.receivedTransactionId, transactions.id))
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.direction, 'inflow'),
          isNull(transactions.deletedAt),
          gte(transactions.transactionDate, since),
        ),
      )
      .orderBy(desc(transactions.transactionDate))
      .limit(500),
  );

  const unclaimed = arrived.filter((row) => row.claimed === null);
  if (unclaimed.length === 0) return [];

  const byId = new Map(unclaimed.map((row) => [row.id, row]));

  const proposals: readonly MatchProposal[] = proposeReceivableMatches(
    open.map((entry) => ({
      id: entry.id,
      name: entry.name,
      source: entry.source,
      amount: entry.amount,
      expectedFrom: entry.expectedFrom,
      expectedTo: entry.expectedTo,
    })),
    unclaimed.map((row) => ({
      id: row.id,
      date: row.date as PlainDate,
      amount: Money.fromDecimalString(row.amount, currency),
      description: row.description,
    })),
  );

  const names = new Map(open.map((entry) => [entry.id, entry.name]));

  // One proposal per movement: a single deposit cannot settle two invoices, and
  // offering it twice invites a household to claim the same money for both.
  const spent = new Set<string>();
  const candidates: MatchCandidate[] = [];

  for (const proposal of proposals) {
    if (spent.has(proposal.transactionId)) continue;
    const row = byId.get(proposal.transactionId);
    if (!row) continue;

    spent.add(proposal.transactionId);
    candidates.push({
      receivableId: proposal.receivableId,
      receivableName: names.get(proposal.receivableId) ?? '',
      transactionId: row.id,
      date: row.date as PlainDate,
      amount: Money.fromDecimalString(row.amount, currency),
      description: row.description,
      accountName: row.accountName,
      score: proposal.score,
      reasons: proposal.reasons,
    });
  }

  return candidates;
}

/** Calendar arithmetic on a plain date, without going through a timestamp. */
function shiftDays(date: PlainDate, days: number): PlainDate {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return toPlainDate(moment.toISOString().slice(0, 10));
}
