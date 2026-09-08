import 'server-only';

import { snapshot, type CustomerMrr, type MrrMovement, type MrrSnapshot } from '@app/ledger';
import { Money, todayIn } from '@app/domain';
import { sql } from 'drizzle-orm';

import { adminDb } from './admin-session';

/**
 * The numbers the product is judged by.
 *
 * Four rules run through this file.
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
 * `null` all the way to the screen so the screen can say so.
 *
 * **One statement per section.** This is the rule that was learned the hard
 * way. Written as a `Promise.all` of twenty-odd small queries, the overview
 * screen took thirty seconds and timed out in production — the database is a
 * region away, so every round trip costs a few hundred milliseconds and a pool
 * of four connections turns concurrency back into a queue. Postgres computes
 * all of it in one pass for the price of one trip, so each loader below is
 * exactly one statement: scalar subqueries where a screen needs a figure, and
 * `jsonb` aggregates where it needs a list.
 */

/**
 * `count` and `sum` arrive as strings from numerics. These are the casts home.
 *
 * A `numeric` never reaches JavaScript as a number — that is the point of the
 * whole money discipline in this codebase — so they are read as text and
 * narrowed here rather than trusted at the call site.
 */
const text = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '0';
const toBig = (value: unknown): bigint => BigInt(text(value).split('.')[0] ?? '0');
const toNum = (value: unknown): number => Number(text(value));

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
  const rows = await adminDb().execute(sql`
    select
      (select count(*) from app.households where deleted_at is null)          as households,
      -- "Active" is a household with a transaction in the last thirty days.
      -- Naming the definition matters more than the number: every SaaS means
      -- something different by it, and a metric nobody can define is a metric
      -- nobody can act on.
      (select count(distinct household_id) from app.transactions
        where transaction_date > current_date - interval '30 days')           as active_households,
      (select count(*) from app.accounts where deleted_at is null)            as accounts,
      (select count(*) from app.transactions where deleted_at is null)        as transactions,
      (select count(*) from app.documents)                                    as documents,
      (select count(*) from app.profiles)                                     as people,
      (select count(*) from app.transactions
        where deleted_at is null and status = 'needs_review')                 as needs_review,
      (select count(*) from app.transactions
        where deleted_at is null and category_source = 'system')              as categorized_by_system,
      (select count(*) from app.transactions
        where deleted_at is null and category_id is not null)                 as categorized_total,
      (select count(*) from app.ai_invocations)                               as ai_invocations,
      (select coalesce(sum(cost_micros), 0) from app.ai_invocations)          as ai_cost_micros
  `);

  const row = rows[0] ?? {};
  const categorizedTotal = toNum(row['categorized_total']);

  return {
    households: toNum(row['households']),
    activeHouseholds: toNum(row['active_households']),
    accounts: toNum(row['accounts']),
    transactions: toNum(row['transactions']),
    documents: toNum(row['documents']),
    people: toNum(row['people']),
    // Null rather than 100% when nothing is categorized yet. A rate over zero
    // rows is not a rate.
    automaticCategorization:
      categorizedTotal > 0 ? toNum(row['categorized_by_system']) / categorizedTotal : null,
    needsReview: toNum(row['needs_review']),
    aiInvocations: toNum(row['ai_invocations']),
    aiCostMicros: toBig(row['ai_cost_micros']),
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

/**
 * A subscription that is being paid for, or is expected to be.
 *
 * Past due and grace count. Dropping somebody the day a card fails overstates
 * churn and understates what is recoverable.
 */
const PAYING = sql`status in ('active', 'past_due', 'grace')`;

export async function loadRevenueMetrics(): Promise<RevenueMetrics> {
  const today = todayIn('America/Panama');

  const rows = await adminDb().execute(sql`
    select
      (select coalesce(jsonb_agg(jsonb_build_object(
                'householdId', s.household_id,
                'price',       p.price_amount::text,
                'interval',    p.billing_interval)), '[]'::jsonb)
         from platform.subscriptions s
         join platform.plans p on p.code = s.plan_code
        where ${PAYING})                                                    as paying,

      (select coalesce(jsonb_agg(jsonb_build_object(
                'code',     p.code,
                'name',     p.name,
                'price',    p.price_amount::text,
                'interval', p.billing_interval,
                'subscribers', (
                  select count(*)::int from platform.subscriptions s
                   where s.plan_code = p.code and ${PAYING}))
                order by p.sort_order), '[]'::jsonb)
         from platform.plans p where p.is_active)                           as catalogue,

      (select coalesce(jsonb_agg(jsonb_build_object(
                'status', t.status, 'households', t.n)), '[]'::jsonb)
         from (select status::text as status, count(*)::int as n
                 from platform.subscriptions group by status) t)            as by_status,

      (select coalesce(sum(amount), 0) from platform.journal_lines
        where account_code = '4000' and side = 'credit')                    as recognized,

      (select count(*) from platform.invoices)                              as invoices_issued,
      (select count(*) from platform.invoices where paid_at is not null)    as invoices_paid,
      (select coalesce(sum(amount), 0) from platform.invoices
        where paid_at is null)                                              as invoices_outstanding,
      (select exists (select 1 from platform.subscriptions
        where provider is not null))                                        as has_provider
  `);

  const row = rows[0] ?? {};

  const monthly = (price: string, interval: string) => {
    const amount = Money.fromDecimalString(price, 'USD');
    return interval === 'year' ? amount.divide(12) : amount;
  };

  const payingRows = (row['paying'] ?? []) as {
    householdId: string;
    price: string;
    interval: string;
  }[];
  const catalogue = (row['catalogue'] ?? []) as {
    code: string;
    name: string;
    price: string;
    interval: string;
    subscribers: number;
  }[];

  const paying: CustomerMrr[] = payingRows.map((entry) => ({
    customerId: entry.householdId,
    mrr: monthly(entry.price, entry.interval),
  }));

  return {
    snapshot: snapshot(paying, today, 'USD'),
    // A movement needs a previous point, and nothing snapshots one yet. Null is
    // the honest answer; a movement computed against an empty set would report
    // every customer as new, every month.
    movement: null,
    revenueRecognized: Money.fromDecimalString(text(row['recognized']), 'USD'),
    planMix: catalogue.map((plan) => ({
      code: plan.code,
      name: plan.name,
      price: Money.fromDecimalString(plan.price, 'USD'),
      interval: plan.interval === 'year' ? 'year' : 'month',
      subscribers: plan.subscribers,
      mrr: monthly(plan.price, plan.interval).multiply(plan.subscribers),
    })),
    byStatus: (row['by_status'] ?? []) as { status: string; households: number }[],
    invoices: {
      issued: toNum(row['invoices_issued']),
      paid: toNum(row['invoices_paid']),
      outstanding: Money.fromDecimalString(text(row['invoices_outstanding']), 'USD'),
    },
    hasProvider: row['has_provider'] === true,
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
 * The series is generated from a date range, so a week nobody signed up is a
 * zero in the middle of the line rather than a gap the chart quietly closes —
 * the shape of the last three months is the point, and a chart that skips its
 * empty weeks draws a different shape than the truth.
 */
export async function loadGrowthMetrics(): Promise<GrowthMetrics> {
  const rows = await adminDb().execute(sql`
    with weeks as (
      select generate_series(
        date_trunc('week', current_date) - interval '11 weeks',
        date_trunc('week', current_date),
        interval '1 week'
      )::date as start
    )
    select
      (select jsonb_agg(jsonb_build_object('start', w.start::text, 'value', (
         select count(*)::int from app.profiles p
          where date_trunc('week', p.created_at)::date = w.start
       )) order by w.start) from weeks w)                                   as signups,

      (select jsonb_agg(jsonb_build_object('start', w.start::text, 'value', (
         select count(*)::int from app.households h
          where date_trunc('week', h.created_at)::date = w.start
            and h.deleted_at is null
       )) order by w.start) from weeks w)                                   as households,

      (select count(*) from app.profiles)                                   as total,
      (select count(*) from app.profiles
        where created_at > now() - interval '30 days')                      as last30,
      (select count(*) from app.profiles
        where created_at <= now() - interval '30 days'
          and created_at > now() - interval '60 days')                      as previous30
  `);

  const row = rows[0] ?? {};

  return {
    signupsByWeek: (row['signups'] ?? []) as Bucket[],
    householdsByWeek: (row['households'] ?? []) as Bucket[],
    totalSignups: toNum(row['total']),
    signupsLast30: toNum(row['last30']),
    signupsPrevious30: toNum(row['previous30']),
  };
}

// ---------------------------------------------------------------------------
// The assistant
// ---------------------------------------------------------------------------

/**
 * The assistant's outcomes, grouped the way they should be read.
 *
 * `app.ai_outcome` has nine values, and lumping eight of them together as
 * «failed» would be wrong in a way that matters here. A guardrail refusing an
 * answer that mentioned a figure nobody gave it is the product working: it is
 * the rule that AI is never the source of a number, enforced. Counting that as
 * a failure next to a transport error would make the safety mechanism look
 * like an outage and hide the outage inside it.
 */
const ANSWERED = sql`outcome in ('ok', 'cache_hit')`;
const REFUSED = sql`outcome in ('refused', 'ungrounded_figures', 'missing_grounding')`;
const BROKEN = sql`outcome in ('transport_error', 'malformed_output')`;
const NOT_ATTEMPTED = sql`outcome in ('not_configured', 'budget_exhausted')`;

export interface AssistantMetrics {
  readonly requests: number;
  readonly costMicros: bigint;
  readonly cacheHits: number;
  /** Answered: `ok`, or served from cache. */
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
  const rows = await adminDb().execute(sql`
    select
      (select count(*) from app.ai_invocations)                              as requests,
      (select coalesce(sum(cost_micros), 0) from app.ai_invocations)         as cost,
      (select count(*) from app.ai_invocations where cache_hit)              as cache_hits,
      (select count(*) from app.ai_invocations where ${ANSWERED})            as answered,
      (select count(*) from app.ai_invocations where ${REFUSED})             as refused,
      (select count(*) from app.ai_invocations where ${BROKEN})              as broken,
      (select count(*) from app.ai_invocations where ${NOT_ATTEMPTED})       as not_attempted,
      -- The median, not the mean: one forty-second timeout drags a mean
      -- somewhere useless and leaves the typical request undescribed.
      (select percentile_cont(0.5) within group (order by latency_ms)
         from app.ai_invocations)                                           as median_latency,

      (select coalesce(jsonb_agg(jsonb_build_object(
                'feature', t.feature, 'requests', t.n, 'cost', t.cost)
                order by t.n desc), '[]'::jsonb)
         from (select feature::text as feature, count(*)::int as n,
                      coalesce(sum(cost_micros), 0)::text as cost
                 from app.ai_invocations group by feature) t)               as by_feature,

      (select coalesce(jsonb_agg(jsonb_build_object(
                'model', t.model, 'requests', t.n, 'cost', t.cost)
                order by t.n desc), '[]'::jsonb)
         from (select model, count(*)::int as n,
                      coalesce(sum(cost_micros), 0)::text as cost
                 from app.ai_invocations group by model) t)                 as by_model,

      (select coalesce(jsonb_agg(jsonb_build_object(
                'feature', t.feature, 'outcome', t.outcome,
                'detail', t.failure_detail, 'at', t.created_at)
                order by t.created_at desc), '[]'::jsonb)
         from (select feature::text as feature, outcome::text as outcome,
                      failure_detail, created_at
                 from app.ai_invocations
                where not (${ANSWERED})
                order by created_at desc limit 10) t)                       as recent_failures
  `);

  const row = rows[0] ?? {};
  const median = row['median_latency'];

  const byFeature = (row['by_feature'] ?? []) as {
    feature: string;
    requests: number;
    cost: string;
  }[];
  const byModel = (row['by_model'] ?? []) as { model: string; requests: number; cost: string }[];
  const failures = (row['recent_failures'] ?? []) as {
    feature: string;
    outcome: string;
    detail: string | null;
    at: string;
  }[];

  return {
    requests: toNum(row['requests']),
    costMicros: toBig(row['cost']),
    cacheHits: toNum(row['cache_hits']),
    answered: toNum(row['answered']),
    refused: toNum(row['refused']),
    broken: toNum(row['broken']),
    notAttempted: toNum(row['not_attempted']),
    medianLatencyMs: median == null ? null : Math.round(Number(median)),
    byFeature: byFeature.map((entry) => ({
      feature: entry.feature,
      requests: entry.requests,
      costMicros: toBig(entry.cost),
    })),
    byModel: byModel.map((entry) => ({
      model: entry.model,
      requests: entry.requests,
      costMicros: toBig(entry.cost),
    })),
    recentFailures: failures.map((entry) => ({
      feature: entry.feature,
      outcome: entry.outcome,
      detail: entry.detail,
      at: new Date(entry.at),
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
  const rows = await adminDb().execute(sql`
    select
      (select coalesce(jsonb_agg(jsonb_build_object('status', t.status, 'jobs', t.n)), '[]'::jsonb)
         from (select status::text as status, count(*)::int as n
                 from app.jobs group by status) t)                          as by_status,

      (select coalesce(jsonb_agg(jsonb_build_object(
                'kind', t.kind, 'jobs', t.n, 'failed', t.failed)
                order by t.n desc), '[]'::jsonb)
         from (select kind, count(*)::int as n,
                      count(*) filter (where status = 'failed')::int as failed
                 from app.jobs group by kind) t)                            as by_kind,

      -- Claimed, and still claimed a long time later. This is the shape of a
      -- worker that died mid-job, and it is the one queue number worth an alarm.
      (select count(*) from app.jobs
        where status = 'running'
          and started_at < now() - interval '15 minutes')                   as stuck,

      (select coalesce(jsonb_agg(jsonb_build_object(
                'kind', t.kind, 'attempts', t.attempts,
                'message', t.error_message, 'at', t.updated_at)
                order by t.updated_at desc), '[]'::jsonb)
         from (select kind, attempts, error_message, updated_at
                 from app.jobs where status = 'failed'
                order by updated_at desc limit 10) t)                       as recent_failures,

      (select version from platform.schema_version limit 1)                 as version,
      (select description from platform.schema_version limit 1)             as description
  `);

  const row = rows[0] ?? {};
  const failures = (row['recent_failures'] ?? []) as {
    kind: string;
    attempts: number;
    message: string | null;
    at: string;
  }[];

  return {
    byStatus: (row['by_status'] ?? []) as { status: string; jobs: number }[],
    byKind: (row['by_kind'] ?? []) as { kind: string; jobs: number; failed: number }[],
    stuck: toNum(row['stuck']),
    recentFailures: failures.map((entry) => ({
      kind: entry.kind,
      attempts: entry.attempts,
      message: entry.message,
      at: new Date(entry.at),
    })),
    schemaVersion: toNum(row['version']),
    schemaDescription: typeof row['description'] === 'string' ? row['description'] : '',
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
  const rows = await adminDb().execute(sql`
    select
      (select count(*) from app.profiles)                                   as people,
      (select count(distinct user_id) from auth.mfa_factors
        where status = 'verified')                                          as with_two_factor,
      (select count(*) from platform.admin_users where disabled_at is null) as administrators,
      (select count(*) from app.household_invitations
        where accepted_at is null and expires_at > now())                   as pending,
      (select count(*) from app.household_invitations
        where accepted_at is null and expires_at <= now())                  as expired
  `);

  const row = rows[0] ?? {};

  return {
    people: toNum(row['people']),
    withTwoFactor: toNum(row['with_two_factor']),
    administrators: toNum(row['administrators']),
    pendingInvitations: toNum(row['pending']),
    expiredInvitations: toNum(row['expired']),
  };
}

/** Re-exported so a caller can build a movement once snapshots are stored. */
export { movement } from '@app/ledger';
