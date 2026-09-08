import 'server-only';

import { allocationLines, allocationPlans, debts, goals, transactions } from '@app/database/schema';
import { Money, type CurrencyCode, type PlainDate } from '@app/domain';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import { queryAsUser, type Session } from '../session';

/**
 * Plans a household accepted, and what happened afterwards.
 *
 * The plan is read back exactly as it was stored. It is never recomputed from
 * today's balances — that would show somebody a plan they never agreed to,
 * which is the one thing a record of a decision must not do.
 *
 * Compliance is measured only where it can be measured honestly: a line that
 * points at a debt or a goal with an account behind it can be checked against
 * money that actually arrived there. A line pointing at something the product
 * cannot observe is reported as unmeasured rather than assumed followed, and a
 * plan with none of the first kind says so instead of printing a percentage
 * built on nothing.
 */

export interface AcceptedLine {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly planned: Money;
  readonly explanation: string;
  /** What actually moved toward this target after the plan, when observable. */
  readonly actual: Money | null;
}

export interface AcceptedPlan {
  readonly id: string;
  readonly generatedFor: PlainDate;
  readonly incoming: Money;
  readonly allocated: Money;
  readonly outcome: 'proposed' | 'viewed' | 'accepted' | 'modified' | 'dismissed';
  readonly decidedAt: Date | null;
  readonly lines: readonly AcceptedLine[];
  /** Null when nothing on this plan could be checked against real movements. */
  readonly compliance: number | null;
}

export async function loadAcceptedPlans(
  session: Session,
  householdId: string,
  currency: CurrencyCode,
): Promise<readonly AcceptedPlan[]> {
  return queryAsUser(session, async (tx) => {
    const plans = await tx
      .select()
      .from(allocationPlans)
      .where(eq(allocationPlans.householdId, householdId))
      .orderBy(desc(allocationPlans.createdAt))
      .limit(12);

    if (plans.length === 0) return [];

    const lines = await tx
      .select()
      .from(allocationLines)
      .where(
        inArray(
          allocationLines.planId,
          plans.map((plan) => plan.id),
        ),
      )
      .orderBy(allocationLines.position);

    // The accounts behind the debts and goals these plans point at. Without an
    // account there is nothing to observe, and the line stays unmeasured.
    const debtIds = [
      ...new Set(lines.map((line) => line.debtId).filter((id): id is string => id !== null)),
    ];
    const goalIds = [
      ...new Set(lines.map((line) => line.goalId).filter((id): id is string => id !== null)),
    ];

    const accountFor = new Map<string, string>();

    if (debtIds.length > 0) {
      const rows = await tx
        .select({ id: debts.id, accountId: debts.accountId })
        .from(debts)
        .where(and(eq(debts.householdId, householdId), inArray(debts.id, debtIds)));
      for (const row of rows) if (row.accountId) accountFor.set(row.id, row.accountId);
    }

    if (goalIds.length > 0) {
      const rows = await tx
        .select({ id: goals.id, accountId: goals.accountId })
        .from(goals)
        .where(and(eq(goals.householdId, householdId), inArray(goals.id, goalIds)));
      for (const row of rows) if (row.accountId) accountFor.set(row.id, row.accountId);
    }

    const results: AcceptedPlan[] = [];

    for (const plan of plans) {
      const planLines = lines.filter((line) => line.planId === plan.id);

      const built: AcceptedLine[] = [];
      let plannedMeasured = Money.zero(currency);
      let actualMeasured = Money.zero(currency);
      let measurable = 0;

      for (const line of planLines) {
        const target = line.debtId ?? line.goalId;
        const accountId = target ? accountFor.get(target) : undefined;

        let actual: Money | null = null;

        if (accountId) {
          const [row] = await tx
            .select({
              total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,
            })
            .from(transactions)
            .where(
              and(
                eq(transactions.householdId, householdId),
                eq(transactions.accountId, accountId),
                eq(transactions.direction, 'inflow'),
                isNull(transactions.deletedAt),
                gte(transactions.transactionDate, plan.generatedFor),
              ),
            );

          actual = Money.fromDecimalString(row?.total ?? '0', currency);
          measurable += 1;

          const planned = Money.fromDecimalString(line.allocatedAmount, currency);
          plannedMeasured = plannedMeasured.add(planned);
          // Capped at what was planned: sending double to one debt does not
          // earn credit for the goal that got nothing.
          actualMeasured = actualMeasured.add(Money.min(actual, planned));
        }

        built.push({
          id: line.id,
          label: line.label,
          kind: line.kind,
          planned: Money.fromDecimalString(line.allocatedAmount, currency),
          explanation: line.explanation,
          actual,
        });
      }

      results.push({
        id: plan.id,
        generatedFor: plan.generatedFor as PlainDate,
        incoming: Money.fromDecimalString(plan.incomingAmount, currency),
        allocated: Money.fromDecimalString(plan.allocatedAmount, currency),
        outcome: plan.outcome,
        decidedAt: plan.decidedAt,
        lines: built,
        compliance:
          measurable === 0 || !plannedMeasured.isPositive()
            ? null
            : Math.round(
                (Number(actualMeasured.toDecimalString()) /
                  Number(plannedMeasured.toDecimalString())) *
                  100,
              ),
      });
    }

    return results;
  });
}
