import { accrueAcrossWindow, type Debt } from '@app/debt-engine';
import {
  addMonths,
  daysBetween,
  endOfMonth,
  Money,
  startOfMonth,
  type PlainDate,
} from '@app/domain';

import type {
  Baseline,
  ProjectedMonth,
  Projection,
  Scenario,
  ScenarioChange,
  ScenarioComparison,
} from './types.js';

/**
 * The projection itself: one month at a time, in the order money actually moves.
 *
 * Income arrives, living costs leave, interest accrues on what is owed, the
 * minimum payments go out, goals take their contribution, and whatever is left
 * changes the balance. Doing it in that order matters — interest charged before
 * the payment is what a card issuer does, and a projection that pays first
 * quietly reports a household as debt-free a month or two early.
 *
 * Interest comes from the debt engine rather than a monthly approximation, so a
 * scenario and a real payoff plan agree about what a card costs. A promotional
 * rate expiring mid-scenario is handled there too.
 */

export const MAX_HORIZON_MONTHS = 600;

export function project(baseline: Baseline, scenario: Scenario): Projection {
  const currency = baseline.currency;
  const zero = Money.zero(currency);
  const horizon = Math.max(1, Math.min(scenario.horizonMonths, MAX_HORIZON_MONTHS));

  const balances = new Map<string, Money>(
    baseline.debts.map((debt) => [debt.id, debt.currentBalance]),
  );
  const debtsById = new Map<string, Debt>(baseline.debts.map((debt) => [debt.id, debt]));
  const goalBalances = new Map(baseline.goals.map((goal) => [goal.id, goal.current]));

  let liquid = baseline.liquid;
  let totalInterest = zero;
  let runwayMonths: number | null = null;
  let firstShortfallMonth: PlainDate | null = null;

  const months: ProjectedMonth[] = [];

  for (let index = 0; index < horizon; index += 1) {
    const month = startOfMonth(addMonths(baseline.startMonth, index));
    const days = daysBetween(month, endOfMonth(month)) + 1;
    const active = scenario.changes.filter((change) => isActive(change, index));

    // A financed purchase adds its debt the month it happens, not before.
    for (const change of scenario.changes) {
      if (change.startsInMonths === index && change.addedDebt) {
        debtsById.set(change.addedDebt.id, change.addedDebt);
        balances.set(change.addedDebt.id, change.addedDebt.currentBalance);
      }
    }

    const income = active.reduce(
      (running, change) =>
        change.monthlyIncomeDelta ? running.add(change.monthlyIncomeDelta) : running,
      baseline.monthlyIncome,
    );

    const recurringExpenses = active.reduce(
      (running, change) =>
        change.monthlyExpenseDelta ? running.add(change.monthlyExpenseDelta) : running,
      baseline.monthlyExpenses,
    );

    const oneTime = scenario.changes.reduce(
      (running, change) =>
        change.startsInMonths === index && change.oneTimeCost
          ? running.add(change.oneTimeCost)
          : running,
      zero,
    );

    const expenses = Money.max(recurringExpenses.add(oneTime), zero);

    let interestThisMonth = zero;
    let paymentsThisMonth = zero;

    for (const [id, debt] of debtsById) {
      const opening = balances.get(id) ?? zero;
      if (!opening.isPositive()) continue;

      const interest = accrueAcrossWindow(debt, opening, month, days);
      const owed = opening.add(interest);
      const payment = Money.min(debt.minimumPayment, owed);

      balances.set(id, owed.subtract(payment));
      interestThisMonth = interestThisMonth.add(interest);
      paymentsThisMonth = paymentsThisMonth.add(payment);
    }

    let goalContributions = zero;
    for (const goal of baseline.goals) {
      const current = goalBalances.get(goal.id) ?? zero;
      const remaining = goal.target.subtract(current);
      if (!remaining.isPositive()) continue;

      const contribution = Money.min(goal.monthlyContribution, remaining);
      goalBalances.set(goal.id, current.add(contribution));
      goalContributions = goalContributions.add(contribution);
    }

    const netCashFlow = income
      .subtract(expenses)
      .subtract(paymentsThisMonth)
      .subtract(goalContributions);

    liquid = liquid.add(netCashFlow);
    totalInterest = totalInterest.add(interestThisMonth);

    const debtBalance = Money.sum([...balances.values()], currency);
    const goalTotal = Money.sum([...goalBalances.values()], currency);
    const isCashPressure = liquid.isNegative();

    if (isCashPressure && runwayMonths === null) {
      runwayMonths = index;
      firstShortfallMonth = month;
    }

    months.push({
      month,
      income,
      expenses,
      debtPayments: paymentsThisMonth,
      interestAccrued: interestThisMonth,
      goalContributions,
      netCashFlow,
      liquid,
      debtBalance,
      netWorth: liquid.add(goalTotal).subtract(debtBalance),
      isCashPressure,
    });
  }

  const last = months[months.length - 1];

  return {
    currency,
    months,
    endingLiquid: last?.liquid ?? baseline.liquid,
    endingDebt: last?.debtBalance ?? Money.sum([...balances.values()], currency),
    endingNetWorth: last?.netWorth ?? baseline.liquid,
    totalInterest,
    runwayMonths,
    firstShortfallMonth,
  };
}

/**
 * The scenario beside the same household with nothing changed.
 *
 * A projection alone invites the wrong question — "is $3,000 in eighteen months
 * good?" — which nobody can answer. Against the do-nothing case it becomes the
 * question the household actually has: what does this decision cost.
 */
export function compare(baseline: Baseline, scenario: Scenario): ScenarioComparison {
  const doNothing = project(baseline, {
    ...scenario,
    id: `${scenario.id}-baseline`,
    changes: [],
  });
  const withChanges = project(baseline, scenario);

  return {
    baseline: doNothing,
    scenario: withChanges,
    liquidDelta: withChanges.endingLiquid.subtract(doNothing.endingLiquid),
    debtDelta: withChanges.endingDebt.subtract(doNothing.endingDebt),
    netWorthDelta: withChanges.endingNetWorth.subtract(doNothing.endingNetWorth),
    interestDelta: withChanges.totalInterest.subtract(doNothing.totalInterest),
    runwayDeltaMonths: runwayDelta(doNothing.runwayMonths, withChanges.runwayMonths),
  };
}

/**
 * Null when neither case runs out inside the horizon, or when only one does —
 * "you now run out in month 14, and did not before" is a fact the caller should
 * state from the two projections rather than a subtraction pretending to be a
 * number of months.
 */
function runwayDelta(baseline: number | null, scenario: number | null): number | null {
  if (baseline === null || scenario === null) return null;
  return scenario - baseline;
}

function isActive(change: ScenarioChange, index: number): boolean {
  if (index < change.startsInMonths) return false;
  if (change.durationMonths === null) return true;
  return index < change.startsInMonths + change.durationMonths;
}
