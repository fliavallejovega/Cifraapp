import 'server-only';

import { alertDismissals, transactions } from '@app/database/schema';
import { endOfMonth, Money, startOfMonth, type CurrencyCode, type PlainDate } from '@app/domain';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

import type { BudgetSummary } from './budgets';
import type { CommitmentView, DebtView, GoalView } from './administration';
import type { PlanView } from './plan';
import type { QueueCounts } from './review';

/**
 * What is going to go wrong if nothing changes.
 *
 * Every alert here is derived, on every read, from rows the household can go
 * and look at. None of them is stored, and that is the design: a stored alert
 * is a second copy of a fact that is already in the ledger, and the two
 * disagree the moment somebody corrects a transaction.
 *
 * What *is* stored is the acknowledgement. «I know, I am dealing with it» is
 * not recoverable from the data, and an alert a person already answered that
 * keeps shouting is how a household learns to ignore the whole screen.
 *
 * Two rules for what earns an alert:
 *
 *   - It has to be actionable. «Your net worth fell» is not an alert, it is a
 *     statement; there is nothing to do about it this afternoon.
 *   - It has to be true without a forecast the household did not ask for. The
 *     pace warnings say «at this rate», and mean it arithmetically.
 */

export type AlertSeverity = 'critical' | 'warning' | 'notice';

export interface Alert {
  /** Stable across recomputations, so dismissing it once is enough. */
  readonly key: string;
  readonly kind: string;
  readonly severity: AlertSeverity;
  /** Filled into the catalogue's message for this kind. */
  readonly values: Readonly<Record<string, string>>;
  /** Where a person goes to do something about it. */
  readonly href: string;
}

export interface AlertsView {
  readonly alerts: readonly Alert[];
  readonly dismissedCount: number;
}

/** A category whose spending this month is far above its own normal. */
const SPIKE_RATIO = 1.4;

/** Utilization above this is the figure that moves a credit score. */
const HIGH_UTILIZATION = 0.8;

/** Below this many uncategorized movements it is tidying, not a problem. */
const UNCATEGORIZED_FLOOR = 10;

export interface AlertInputs {
  readonly currency: CurrencyCode;
  readonly today: PlainDate;
  readonly plan: PlanView | null;
  readonly budgets: readonly BudgetSummary[];
  readonly debts: readonly DebtView[];
  readonly goals: readonly GoalView[];
  readonly commitments: readonly CommitmentView[];
  readonly queues: QueueCounts;
  readonly uncategorized: number;
}

export async function loadAlerts(
  session: Session,
  householdId: string,
  inputs: AlertInputs,
): Promise<AlertsView> {
  const raw = [
    ...deterministicAlerts(inputs),
    ...(await spikeAlerts(session, householdId, inputs)),
  ];

  const dismissed = await queryAsUser(session, (tx) =>
    tx
      .select({ key: alertDismissals.alertKey })
      .from(alertDismissals)
      .where(
        and(
          eq(alertDismissals.householdId, householdId),
          gte(alertDismissals.expiresOn, inputs.today),
        ),
      ),
  );

  const silenced = new Set(dismissed.map((row) => row.key));
  const visible = raw.filter((alert) => !silenced.has(alert.key));

  const order: Record<AlertSeverity, number> = { critical: 0, warning: 1, notice: 2 };

  return {
    alerts: [...visible].sort((a, b) => order[a.severity] - order[b.severity]),
    dismissedCount: raw.length - visible.length,
  };
}

function deterministicAlerts(inputs: AlertInputs): Alert[] {
  const alerts: Alert[] = [];
  const month = inputs.today.slice(0, 7);

  // ---- The buffer -------------------------------------------------------
  if (inputs.plan && !inputs.plan.isEmpty) {
    const safe = inputs.plan.safeToSpend.safeToSpend;
    if (safe.isNegative()) {
      alerts.push({
        key: `buffer_negative:${month}`,
        kind: 'bufferNegative',
        severity: 'critical',
        values: { amount: safe.abs().toDecimalString() },
        href: '/plan',
      });
    }
  }

  // ---- Commitments already past due --------------------------------------
  // A deduction at source is never settled by a transaction, because no
  // transaction will ever exist for it — the money was taken before it
  // arrived. Left in, every payroll deduction became a critical «vencido»
  // alert on its due date and stayed there for good.
  const overdue = inputs.commitments.filter(
    (commitment) =>
      !commitment.isSettled && !commitment.isDeductedAtSource && commitment.dueDate < inputs.today,
  );

  for (const commitment of overdue) {
    alerts.push({
      key: `overdue:${commitment.id}:${commitment.dueDate}`,
      kind: 'overdueCommitment',
      severity: commitment.isEssential ? 'critical' : 'warning',
      values: { name: commitment.name, amount: commitment.expectedAmount.toDecimalString() },
      href: '/commitments',
    });
  }

  // ---- Budget lines that the pace, not the ledger, will break -------------
  for (const budget of inputs.budgets) {
    for (const line of budget.state.lines) {
      if (line.isOverspent) {
        alerts.push({
          key: `budget_over:${line.id}:${month}`,
          kind: 'budgetOverspent',
          severity: 'warning',
          values: {
            amount: line.remaining.abs().toDecimalString(),
            budget: budget.name,
          },
          href: `/budgets/${budget.id}`,
        });
      } else if (line.isProjectedOver) {
        alerts.push({
          key: `budget_pace:${line.id}:${month}`,
          kind: 'budgetPace',
          severity: 'notice',
          values: {
            projected: line.projected.toDecimalString(),
            planned: line.planned.toDecimalString(),
            budget: budget.name,
          },
          href: `/budgets/${budget.id}`,
        });
      }
    }
  }

  // ---- Cards near their limit --------------------------------------------
  for (const debt of inputs.debts) {
    if (!debt.creditLimit?.isPositive()) continue;

    const used =
      Number(debt.currentBalance.toDecimalString()) / Number(debt.creditLimit.toDecimalString());

    if (used >= HIGH_UTILIZATION) {
      alerts.push({
        key: `utilization:${debt.id}:${month}`,
        kind: 'highUtilization',
        severity: 'warning',
        values: { name: debt.name, percent: String(Math.round(used * 100)) },
        href: `/debts/${debt.id}`,
      });
    }
  }

  // ---- Goals that will not arrive on the date they were given -------------
  for (const goal of inputs.goals) {
    if (goal.status !== 'active' || !goal.targetDate) continue;

    const missing = goal.targetAmount.subtract(goal.currentAmount);
    if (!missing.isPositive()) continue;

    if (goal.targetDate < inputs.today) {
      alerts.push({
        key: `goal_late:${goal.id}`,
        kind: 'goalLate',
        severity: 'notice',
        values: { name: goal.name, amount: missing.toDecimalString() },
        href: `/goals/${goal.id}`,
      });
    }
  }

  // ---- Work waiting on a person ------------------------------------------
  if (inputs.queues.total > 0) {
    alerts.push({
      key: `review_backlog:${month}`,
      kind: 'reviewBacklog',
      severity: 'notice',
      values: { count: String(inputs.queues.total) },
      href: '/review',
    });
  }

  if (inputs.uncategorized >= UNCATEGORIZED_FLOOR) {
    alerts.push({
      key: `uncategorized:${month}`,
      kind: 'uncategorized',
      severity: 'notice',
      values: { count: String(inputs.uncategorized) },
      href: '/movements?category=none',
    });
  }

  return alerts;
}

/**
 * Categories spending far above their own normal this month.
 *
 * «You spent 40% more on groceries» is only worth saying against a household's
 * own median, not against a benchmark. Computed in SQL because it compares this
 * month against five previous ones per category, and doing that in JavaScript
 * would mean loading a year of rows to produce four sentences.
 */
async function spikeAlerts(
  session: Session,
  householdId: string,
  inputs: AlertInputs,
): Promise<Alert[]> {
  const monthStart = startOfMonth(inputs.today);
  const monthEnd = endOfMonth(inputs.today);
  const lookback = new Date(`${monthStart}T00:00:00Z`);
  lookback.setUTCMonth(lookback.getUTCMonth() - 6);

  const rows = await queryAsUser(session, (tx) =>
    tx.execute<{ name: string; current: string; usual: string }>(sql`
      with monthly as (
        select t.category_id,
               to_char(t.transaction_date, 'YYYY-MM') as month,
               -- Outflows are stored negative. Comparing them as stored would
               -- rank a bigger spend as a smaller number and invert the test.
               abs(sum(t.amount)) as total
          from app.transactions t
         where t.household_id = ${householdId}
           and t.direction = 'outflow'
           and t.status in ('posted', 'pending', 'reconciled')
           and t.deleted_at is null
           and t.category_id is not null
           and t.transaction_date >= ${lookback.toISOString().slice(0, 10)}
           and t.transaction_date <= ${monthEnd}
         group by t.category_id, month
      ),
      baseline as (
        select category_id,
               -- Discrete, not continuous: the continuous variant returns
               -- double precision, and a spending baseline that reaches the
               -- screen as 412.30000000000007 is a float that escaped into
               -- money. The discrete median stays numeric.
               percentile_disc(0.5) within group (order by total) as usual
          from monthly
         where month < ${monthStart.slice(0, 7)}
         group by category_id
        having count(*) >= 3
      )
      select c.name,
             m.total::text as current,
             b.usual::text as usual
        from monthly m
        join baseline b on b.category_id = m.category_id
        join app.categories c on c.id = m.category_id
       where m.month = ${monthStart.slice(0, 7)}
         and b.usual > 0
         and m.total > b.usual * ${String(SPIKE_RATIO)}
    `),
  );

  return rows.map((row) => {
    const current = Money.fromDecimalString(row.current, inputs.currency).abs();
    const usual = Money.fromDecimalString(row.usual, inputs.currency).abs();
    const increase = Math.round(
      (Number(current.toDecimalString()) / Number(usual.toDecimalString()) - 1) * 100,
    );

    return {
      key: `spike:${row.name}:${monthStart.slice(0, 7)}`,
      kind: 'categorySpike',
      severity: 'warning' as const,
      values: {
        category: row.name,
        percent: String(increase),
        amount: current.toDecimalString(),
        usual: usual.toDecimalString(),
      },
      href: '/movements',
    };
  });
}

/** How many movements are still waiting for a category. */
export async function countUncategorized(session: Session, householdId: string): Promise<number> {
  const [row] = await queryAsUser(session, (tx) =>
    tx
      .select({ total: sql<number>`count(*)::int` })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, householdId),
          isNull(transactions.categoryId),
          isNull(transactions.deletedAt),
        ),
      ),
  );

  return row?.total ?? 0;
}
