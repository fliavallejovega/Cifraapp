import 'server-only';

import { snapshot, type CustomerMrr, type MrrMovement, type MrrSnapshot } from '@app/ledger';
import {
  accounts,
  aiInvocations,
  documents,
  households,
  invoices,
  jobs,
  journalLines,
  plans,
  subscriptions,
  transactions,
} from '@app/database/schema';
import { Money, todayIn } from '@app/domain';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';

import { adminDb } from './admin-session';

/**
 * The numbers the product is judged by.
 *
 * Three rules run through this file.
 *
 * **Every metric is counted, never estimated.** There is no sampling and no
 * extrapolation; a figure here is a `count(*)` or a sum of rows. A dashboard
 * that rounds for readability is fine, but the rounding happens on the way to
 * the screen and not in the query.
 *
 * **MRR is computed from subscriptions and must agree with the ledger.** The
 * `revenueRecognized` figure comes from journal lines, so a disagreement
 * between the two is visible rather than hidden behind one authoritative
 * number. When they diverge, something is wrong and the point of computing
 * both is that somebody finds out.
 *
 * **Zero and «not applicable» are different answers.** A categorization rate
 * over no categorized rows is not zero percent, it is nothing, and it reads as
 * `null` all the way to the screen so the screen can say so. The same goes for
 * a growth rate against an empty previous period.
 */

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

export interface ProductMetrics {
  readonly households: number;
  readonly activeHouseholds: number;
  readonly accounts: number;
  readonly transactions: number;
  readonly documents: number;
  readonly people: number;
  /** Transactions the system categorized without a person correcting it. */
  readonly automaticCategorization: number | null;
  readonly needsReview: number;
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
    peopleCount,
    categorized,
    review,
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
    db.execute<{ value: number }>(sql`select count(*)::int as value from app.profiles`),
    db
      .select({
        automatic: sql<number>`count(*) filter (where ${transactions.categorySource} = 'system')::int`,
        total: sql<number>`count(*) filter (where ${transactions.categoryId} is not null)::int`,
      })
      .from(transactions)
      .where(isNull(transactions.deletedAt)),
    db
      .select({ value: count() })
      .from(transactions)
      .where(and(isNull(transactions.deletedAt), eq(transactions.status, 'needs_review'))),
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
    people: peopleCount[0]?.value ?? 0,
    // Null rather than 100% when nothing is categorized yet. A rate over zero
    // rows is not a rate.
    automaticCategorization:
      automatic && automatic.total > 0 ? automatic.automatic / automatic.total : null,
    needsReview: review[0]?.value ?? 0,
    aiInvocations: aiCount[0]?.value ?? 0,
    aiCostMicros: BigInt(aiCost[0]?.value ?? '0'),
  };
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

export interface PlanMix {
  readonly code: string;
  readonly name: string;
  readonly price: Money;
  readonly interval: 'month' | 'year';
  readonly subscribers: number;
  /** What this plan contributes to MRR. Zero for a free plan, by arithmetic. */
  readonly mrr: Money;
}

export interface RevenueMetrics {
  readonly snapshot: MrrSnapshot;
  readonly movement: MrrMovement | null;
  /** From the ledger. Should agree with MRR; when it does not, one is wrong. */
  readonly revenueRecognized: Money;
  readonly planMix: readonly PlanMix[];
  readonly byStatus: readonly { status: string; households: number }[];
  readonly invoices: {
    readonly issued: number;
    readonly paid: number;
    readonly outstanding: Money;
  };
  /** Whether a payment processor is wired up at all. */
  readonly hasProvider: boolean;
}

export async function loadRevenueMetrics(): Promise<RevenueMetrics> {
  const db = adminDb();
  const today = todayIn('America/Panama');

  const [rows, revenue, statusRows, invoiceRows, catalogue] = await Promise.all([
    db
      .select({
        householdId: subscriptions.householdId,
        status: subscriptions.status,
        planCode: subscriptions.planCode,
        provider: subscriptions.provider,
        price: plans.priceAmount,
        interval: plans.billingInterval,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.code, subscriptions.planCode)),
    db
      .select({ value: sql<string>`coalesce(sum(${journalLines.amount}), 0)` })
      .from(journalLines)
      .where(and(eq(journalLines.accountCode, '4000'), eq(journalLines.side, 'credit'))),
    db
      .select({ status: subscriptions.status, households: count() })
      .from(subscriptions)
      .groupBy(subscriptions.status),
    db
      .select({
        issued: count(),
        paid: sql<number>`count(*) filter (where ${invoices.paidAt} is not null)::int`,
        outstanding: sql<string>`coalesce(sum(${invoices.amount}) filter (where ${invoices.paidAt} is null), 0)`,
      })
      .from(invoices),
    db
      .select({
        code: plans.code,
        name: plans.name,
        price: plans.priceAmount,
        interval: plans.billingInterval,
      })
      .from(plans)
      .where(eq(plans.isActive, true))
      .orderBy(plans.sortOrder),
  ]);

  /** A subscription that is being paid for, or is expected to be. */
  const isPaying = (status: string) =>
    status === 'active' || status === 'past_due' || status === 'grace';

  const monthly = (price: string, interval: 'month' | 'year') => {
    const amount = Money.fromDecimalString(price, 'USD');
    return interval === 'year' ? amount.divide(12) : amount;
  };

  const paying: CustomerMrr[] = rows
    .filter((row) => isPaying(row.status))
    .map((row) => ({
      customerId: row.householdId,
      mrr: monthly(row.price, row.interval),
    }));

  const planMix: PlanMix[] = catalogue.map((plan) => {
    const subscribers = rows.filter(
      (row) => row.planCode === plan.code && isPaying(row.status),
    ).length;
    const unit = monthly(plan.price, plan.interval);
    return {
      code: plan.code,
      name: plan.name,
      price: Money.fromDecimalString(plan.price, 'USD'),
      interval: plan.interval,
      subscribers,
      mrr: unit.multiply(subscribers),
    };
  });

  const invoiceRow = invoiceRows[0];

  return {
    snapshot: snapshot(paying, today, 'USD'),
    // A movement needs a previous point, and nothing snapshots one yet. Null is
    // the honest answer; a movement computed against an empty set would report
    // every customer as new, every month.
    movement: null,
    revenueRecognized: Money.fromDecimalString(revenue[0]?.value ?? '0', 'USD'),
    planMix,
    byStatus: statusRows.map((row) => ({ status: row.status, households: row.households })),
    invoices: {
      issued: invoiceRow?.issued ?? 0,
      paid: invoiceRow?.paid ?? 0,
      outstanding: Money.fromDecimalString(invoiceRow?.outstanding ?? '0', 'USD'),
    },
    hasProvider: rows.some((row) => row.provider !== null),
  };
}

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

export interface Bucket {
  /** The first day of the week, as an ISO date. */
  readonly start: string;
  readonly value: number;
}

export interface GrowthMetrics {
  readonly signupsByWeek: readonly Bucket[];
  readonly householdsByWeek: readonly Bucket[];
  readonly totalSignups: number;
  readonly signupsLast30: number;
  readonly signupsPrevious30: number;
}

/**
 * Twelve weeks of arrivals.
 *
 * The series is generated from a date range and left-joined, so a week nobody
 * signed up is a zero in the middle of the line rather than a gap that the
 * chart quietly closes — the shape of the last three months is the point, and a
 * chart that skips its empty weeks draws a different shape than the truth.
 */
export async function loadGrowthMetrics(): Promise<GrowthMetrics> {
  const db = adminDb();

  const weekly = (table: string, column: string) => sql<{ start: string; value: number }[]>`
    with weeks as (
      select generate_series(
        date_trunc('week', current_date) - interval '11 weeks',
        date_trunc('week', current_date),
        interval '1 week'
      )::date as start
    )
    select w.start::text as start,
           count(t.*)::int as value
      from weeks w
      left join ${sql.raw(table)} t
        on date_trunc('week', t.${sql.raw(column)})::date = w.start
     group by w.start
     order by w.start
  `;

  const [signups, created, totals] = await Promise.all([
    db.execute<{ start: string; value: number }>(weekly('app.profiles', 'created_at')),
    db.execute<{ start: string; value: number }>(
      sql`
        with weeks as (
          select generate_series(
            date_trunc('week', current_date) - interval '11 weeks',
            date_trunc('week', current_date),
            interval '1 week'
          )::date as start
        )
        select w.start::text as start, count(h.*)::int as value
          from weeks w
          left join app.households h
            on date_trunc('week', h.created_at)::date = w.start
           and h.deleted_at is null
         group by w.start order by w.start
      `,
    ),
    db.execute<{ total: number; last30: number; previous30: number }>(sql`
      select
        count(*)::int as total,
        count(*) filter (where created_at > now() - interval '30 days')::int as last30,
        count(*) filter (
          where created_at <= now() - interval '30 days'
            and created_at > now() - interval '60 days'
        )::int as previous30
      from app.profiles
    `),
  ]);

  const totalRow = totals[0];

  return {
    signupsByWeek: signups.map((row) => ({ start: row.start, value: row.value })),
    householdsByWeek: created.map((row) => ({ start: row.start, value: row.value })),
    totalSignups: totalRow?.total ?? 0,
    signupsLast30: totalRow?.last30 ?? 0,
    signupsPrevious30: totalRow?.previous30 ?? 0,
  };
}

// ---------------------------------------------------------------------------
// The assistant
// ---------------------------------------------------------------------------

/**
 * The assistant's outcomes, grouped the way they should be read.
 *
 * `app.ai_outcome` has nine values and lumping eight of them together as
 * «failed» would be wrong in a way that matters here. A guardrail refusing an
 * answer that mentioned a figure nobody gave it is the product working: it is
 * the rule that AI is never the source of a number, enforced. Counting that as
 * a failure next to a transport error would make the safety mechanism look
 * like an outage and hide the outage inside it.
 */
const ANSWERED = ['ok', 'cache_hit'] as const;
const REFUSED = ['refused', 'ungrounded_figures', 'missing_grounding'] as const;
const BROKEN = ['transport_error', 'malformed_output'] as const;
const NOT_ATTEMPTED = ['not_configured', 'budget_exhausted'] as const;

export interface AssistantMetrics {
  readonly requests: number;
  readonly costMicros: bigint;
  readonly cacheHits: number;
  /** Answered: `ok` or served from cache. */
  readonly answered: number;
  /** A guardrail declined to pass the answer on. A correct outcome. */
  readonly refused: number;
  /** The call itself went wrong: transport, or output that would not parse. */
  readonly broken: number;
  /** Never attempted — no provider configured, or the budget was spent. */
  readonly notAttempted: number;
  readonly medianLatencyMs: number | null;
  readonly byFeature: readonly {
    readonly feature: string;
    readonly requests: number;
    readonly costMicros: bigint;
  }[];
  readonly byModel: readonly {
    readonly model: string;
    readonly requests: number;
    readonly costMicros: bigint;
  }[];
  readonly recentFailures: readonly {
    readonly feature: string;
    readonly outcome: string;
    readonly detail: string | null;
    readonly at: Date;
  }[];
}

export async function loadAssistantMetrics(): Promise<AssistantMetrics> {
  const db = adminDb();

  const [totals, byFeature, byModel, failures] = await Promise.all([
    db
      .select({
        requests: count(),
        cost: sql<string>`coalesce(sum(${aiInvocations.costMicros}), 0)`,
        cacheHits: sql<number>`count(*) filter (where ${aiInvocations.cacheHit})::int`,
        answered: sql<number>`count(*) filter (where ${aiInvocations.outcome} = any(${ANSWERED}::app.ai_outcome[]))::int`,
        refused: sql<number>`count(*) filter (where ${aiInvocations.outcome} = any(${REFUSED}::app.ai_outcome[]))::int`,
        broken: sql<number>`count(*) filter (where ${aiInvocations.outcome} = any(${BROKEN}::app.ai_outcome[]))::int`,
        notAttempted: sql<number>`count(*) filter (where ${aiInvocations.outcome} = any(${NOT_ATTEMPTED}::app.ai_outcome[]))::int`,
        // The median, not the mean: one 40-second timeout drags a mean into
        // uselessness and leaves the typical request undescribed.
        median: sql<
          number | null
        >`percentile_cont(0.5) within group (order by ${aiInvocations.latencyMs})`,
      })
      .from(aiInvocations),
    db
      .select({
        feature: aiInvocations.feature,
        requests: count(),
        cost: sql<string>`coalesce(sum(${aiInvocations.costMicros}), 0)`,
      })
      .from(aiInvocations)
      .groupBy(aiInvocations.feature)
      .orderBy(desc(count())),
    db
      .select({
        model: aiInvocations.model,
        requests: count(),
        cost: sql<string>`coalesce(sum(${aiInvocations.costMicros}), 0)`,
      })
      .from(aiInvocations)
      .groupBy(aiInvocations.model)
      .orderBy(desc(count())),
    db
      .select({
        feature: aiInvocations.feature,
        outcome: aiInvocations.outcome,
        detail: aiInvocations.failureDetail,
        at: aiInvocations.createdAt,
      })
      .from(aiInvocations)
      .where(sql`${aiInvocations.outcome} <> all(${ANSWERED}::app.ai_outcome[])`)
      .orderBy(desc(aiInvocations.createdAt))
      .limit(10),
  ]);

  const row = totals[0];

  return {
    requests: row?.requests ?? 0,
    costMicros: BigInt(row?.cost ?? '0'),
    cacheHits: row?.cacheHits ?? 0,
    answered: row?.answered ?? 0,
    refused: row?.refused ?? 0,
    broken: row?.broken ?? 0,
    notAttempted: row?.notAttempted ?? 0,
    medianLatencyMs: row?.median != null ? Math.round(row.median) : null,
    byFeature: byFeature.map((entry) => ({
      feature: entry.feature,
      requests: entry.requests,
      costMicros: BigInt(entry.cost),
    })),
    byModel: byModel.map((entry) => ({
      model: entry.model,
      requests: entry.requests,
      costMicros: BigInt(entry.cost),
    })),
    recentFailures: failures.map((entry) => ({
      feature: entry.feature,
      outcome: entry.outcome,
      detail: entry.detail,
      at: entry.at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export interface OperationsMetrics {
  readonly byStatus: readonly { status: string; jobs: number }[];
  readonly byKind: readonly { kind: string; jobs: number; failed: number }[];
  readonly stuck: number;
  readonly recentFailures: readonly {
    readonly kind: string;
    readonly attempts: number;
    readonly message: string | null;
    readonly at: Date;
  }[];
  readonly schemaVersion: number;
  readonly schemaDescription: string;
}

export async function loadOperationsMetrics(): Promise<OperationsMetrics> {
  const db = adminDb();

  const [byStatus, byKind, stuck, failures, version] = await Promise.all([
    db.select({ status: jobs.status, jobs: count() }).from(jobs).groupBy(jobs.status),
    db
      .select({
        kind: jobs.kind,
        jobs: count(),
        failed: sql<number>`count(*) filter (where ${jobs.status} = 'failed')::int`,
      })
      .from(jobs)
      .groupBy(jobs.kind)
      .orderBy(desc(count())),
    // Claimed, and still claimed a long time later. This is the shape of a
    // worker that died mid-job, and it is the one queue number worth an alarm.
    db
      .select({ value: count() })
      .from(jobs)
      .where(sql`${jobs.status} = 'running' and ${jobs.startedAt} < now() - interval '15 minutes'`),
    db
      .select({
        kind: jobs.kind,
        attempts: jobs.attempts,
        message: jobs.errorMessage,
        at: jobs.updatedAt,
      })
      .from(jobs)
      .where(eq(jobs.status, 'failed'))
      .orderBy(desc(jobs.updatedAt))
      .limit(10),
    db.execute<{ version: number; description: string }>(
      sql`select version, description from platform.schema_version limit 1`,
    ),
  ]);

  const schema = version[0];

  return {
    byStatus: byStatus.map((row) => ({ status: row.status, jobs: row.jobs })),
    byKind: byKind.map((row) => ({ kind: row.kind, jobs: row.jobs, failed: row.failed })),
    stuck: stuck[0]?.value ?? 0,
    recentFailures: failures.map((row) => ({
      kind: row.kind,
      attempts: row.attempts,
      message: row.message,
      at: row.at,
    })),
    schemaVersion: schema?.version ?? 0,
    schemaDescription: schema?.description ?? '',
  };
}

// ---------------------------------------------------------------------------
// Security posture
// ---------------------------------------------------------------------------

export interface SecurityMetrics {
  readonly people: number;
  readonly withTwoFactor: number;
  readonly administrators: number;
  readonly pendingInvitations: number;
  readonly expiredInvitations: number;
}

export async function loadSecurityMetrics(): Promise<SecurityMetrics> {
  const db = adminDb();

  const rows = await db.execute<{
    people: number;
    with_two_factor: number;
    administrators: number;
    pending: number;
    expired: number;
  }>(sql`
    select
      (select count(*)::int from app.profiles) as people,
      (select count(distinct user_id)::int from auth.mfa_factors where status = 'verified')
        as with_two_factor,
      (select count(*)::int from platform.admin_users where disabled_at is null)
        as administrators,
      (select count(*)::int from app.household_invitations
        where accepted_at is null and expires_at > now()) as pending,
      (select count(*)::int from app.household_invitations
        where accepted_at is null and expires_at <= now()) as expired
  `);

  const row = rows[0];

  return {
    people: row?.people ?? 0,
    withTwoFactor: row?.with_two_factor ?? 0,
    administrators: row?.administrators ?? 0,
    pendingInvitations: row?.pending ?? 0,
    expiredInvitations: row?.expired ?? 0,
  };
}

/** Re-exported so a caller can build a movement once snapshots are stored. */
export { movement } from '@app/ledger';
