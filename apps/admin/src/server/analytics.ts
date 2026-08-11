import 'server-only';

import {
  movement,
  snapshot,
  type CustomerMrr,
  type MrrMovement,
  type MrrSnapshot,
} from '@app/ledger';
import {
  accounts,
  aiInvocations,
  documents,
  households,
  journalLines,
  plans,
  subscriptions,
  transactions,
} from '@app/database/schema';
import { Money, todayIn } from '@app/domain';
import { and, count, eq, isNull, sql } from 'drizzle-orm';

import { adminDb } from './admin-session';

/**
 * The numbers the product is judged by.
 *
 * Two rules run through this file.
 *
 * **Every metric is counted, never estimated.** There is no sampling and no
 * extrapolation; a figure here is a `count(*)` or a sum of rows. A dashboard
 * that rounds for readability is fine, but the rounding happens on the way to
 * the screen and not in the query.
 *
 * **MRR is computed from subscriptions and must agree with the ledger.** The
 * `revenueRecognized` figure comes from journal lines, so a disagreement between
 * the two is visible rather than hidden behind one authoritative number. When
 * they diverge, something is wrong and the point of computing both is that
 * somebody finds out.
 */

export interface ProductMetrics {
  readonly households: number;
  readonly activeHouseholds: number;
  readonly accounts: number;
  readonly transactions: number;
  readonly documents: number;
  /** Transactions the system categorized without a person correcting it. */
  readonly automaticCategorization: number | null;
  readonly aiInvocations: number;
  readonly aiCostMicros: bigint;
}

export async function loadProductMetrics(): Promise<ProductMetrics> {
  const db = adminDb();

  const [
    householdCount,
    activeCount,
    accountCount,
    transactionCount,
    documentCount,
    categorized,
    aiCount,
    aiCost,
  ] = await Promise.all([
    db.select({ value: count() }).from(households).where(isNull(households.deletedAt)),
    // "Active" is a household with a transaction in the last 30 days. Naming the
    // definition matters more than the number: every SaaS means something
    // different by it, and a metric nobody can define is a metric nobody can act
    // on.
    db
      .select({ value: sql<number>`count(distinct ${transactions.householdId})::int` })
      .from(transactions)
      .where(sql`${transactions.transactionDate} > current_date - interval '30 days'`),
    db.select({ value: count() }).from(accounts).where(isNull(accounts.deletedAt)),
    db.select({ value: count() }).from(transactions).where(isNull(transactions.deletedAt)),
    db.select({ value: count() }).from(documents),
    db
      .select({
        automatic: sql<number>`count(*) filter (where ${transactions.categorySource} = 'system')::int`,
        total: sql<number>`count(*) filter (where ${transactions.categoryId} is not null)::int`,
      })
      .from(transactions)
      .where(isNull(transactions.deletedAt)),
    db.select({ value: count() }).from(aiInvocations),
    db
      .select({ value: sql<string>`coalesce(sum(${aiInvocations.costMicros}), 0)` })
      .from(aiInvocations),
  ]);

  const automatic = categorized[0];

  return {
    households: householdCount[0]?.value ?? 0,
    activeHouseholds: activeCount[0]?.value ?? 0,
    accounts: accountCount[0]?.value ?? 0,
    transactions: transactionCount[0]?.value ?? 0,
    documents: documentCount[0]?.value ?? 0,
    // Null rather than 100% when nothing is categorized yet. A rate over zero
    // rows is not a rate.
    automaticCategorization:
      automatic && automatic.total > 0 ? automatic.automatic / automatic.total : null,
    aiInvocations: aiCount[0]?.value ?? 0,
    aiCostMicros: BigInt(aiCost[0]?.value ?? '0'),
  };
}

export interface RevenueMetrics {
  readonly snapshot: MrrSnapshot;
  readonly movement: MrrMovement | null;
  /** From the ledger. Should agree with MRR; when it does not, one is wrong. */
  readonly revenueRecognized: Money;
}

export async function loadRevenueMetrics(): Promise<RevenueMetrics> {
  const db = adminDb();
  const today = todayIn('America/Panama');

  const rows = await db
    .select({
      householdId: subscriptions.householdId,
      status: subscriptions.status,
      price: plans.priceAmount,
      currency: plans.currency,
      interval: plans.billingInterval,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.code, subscriptions.planCode));

  const paying: CustomerMrr[] = rows
    .filter((row) => row.status === 'active' || row.status === 'past_due' || row.status === 'grace')
    .map((row) => {
      const price = Money.fromDecimalString(row.price, 'USD');
      return {
        customerId: row.householdId,
        mrr: row.interval === 'year' ? price.divide(12) : price,
      };
    });

  const [revenue] = await db
    .select({ value: sql<string>`coalesce(sum(${journalLines.amount}), 0)` })
    .from(journalLines)
    .where(and(eq(journalLines.accountCode, '4000'), eq(journalLines.side, 'credit')));

  return {
    snapshot: snapshot(paying, today, 'USD'),
    // A movement needs a previous point, and nothing snapshots one yet. Null is
    // the honest answer; a movement computed against an empty set would report
    // every customer as new, every month.
    movement: null,
    revenueRecognized: Money.fromDecimalString(revenue?.value ?? '0', 'USD'),
  };
}

/** Re-exported so a caller can build a movement once snapshots are stored. */
export { movement };
