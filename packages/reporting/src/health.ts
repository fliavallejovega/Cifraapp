import type { Money } from '@app/domain';

import type { HealthComponent, HealthScore } from './types.js';

/**
 * The financial health score.
 *
 * **Never presented as a credit score.** It measures nothing a lender uses, and
 * implying otherwise would be a lie with consequences for someone's borrowing.
 *
 * The design constraint is that "why 82?" must have an answer. So the score is
 * the weighted mean of components that are each computed from one visible
 * figure, and each carries that figure with it. Nothing here is a coefficient
 * fitted to anything; every curve below is a stated opinion about what good
 * looks like, and a household that disagrees can see exactly what they are
 * disagreeing with.
 *
 * A component with no data is left out rather than scored zero. A household that
 * has entered no debts is not a household with perfect debt management, and it is
 * certainly not one with the worst.
 */

export interface HealthInput {
  /** Liquid savings and one month of expenses, for the emergency-fund component. */
  readonly liquid: Money | null;
  readonly monthlyExpenses: Money | null;
  /** Total revolving balance against total limit, 0–1. Null when no limits are known. */
  readonly creditUtilization: number | null;
  /** Obligations paid on time over those due, 0–1. */
  readonly punctuality: number | null;
  /** Saved over earned across the period, 0–1. Negative when spending outran income. */
  readonly savingsRate: number | null;
  /** Net cash flow over income, 0–1. */
  readonly cashFlowRatio: number | null;
  /** Mean progress across active goals, 0–1. */
  readonly goalProgress: number | null;
  /** Reserved over estimated, 0–1. Null when tax is not configured. */
  readonly taxReadiness: number | null;
}

const WEIGHTS = {
  emergencyFund: 25,
  debtUtilization: 20,
  punctuality: 20,
  savingsRate: 15,
  cashFlow: 10,
  goalProgress: 5,
  taxReadiness: 5,
} as const;

/** Six months of expenses is full marks; three is the halfway point. */
const FULL_EMERGENCY_MONTHS = 6;

export function healthScore(input: HealthInput): HealthScore {
  const components: HealthComponent[] = [];

  const months = emergencyMonths(input.liquid, input.monthlyExpenses);
  if (months !== null) {
    components.push({
      key: 'emergencyFund',
      score: clamp((months / FULL_EMERGENCY_MONTHS) * 100),
      weight: WEIGHTS.emergencyFund,
      detail: months.toFixed(1),
    });
  }

  if (input.creditUtilization !== null) {
    // Under 30% is where the advice consistently sits; above that the score falls
    // away rather than dropping off a cliff, because a household at 35% is not in
    // a different situation from one at 29%.
    const score = input.creditUtilization <= 0.3 ? 100 : clamp((1 - input.creditUtilization) * 140);
    components.push({
      key: 'debtUtilization',
      score,
      weight: WEIGHTS.debtUtilization,
      detail: (input.creditUtilization * 100).toFixed(1),
    });
  }

  if (input.punctuality !== null) {
    components.push({
      key: 'punctuality',
      score: clamp(input.punctuality * 100),
      weight: WEIGHTS.punctuality,
      detail: (input.punctuality * 100).toFixed(1),
    });
  }

  if (input.savingsRate !== null) {
    // A 20% savings rate is full marks. Negative rates score zero rather than
    // going below it: there is no useful distinction between −5% and −40% here,
    // and the cash-flow component already carries the severity.
    components.push({
      key: 'savingsRate',
      score: clamp((input.savingsRate / 0.2) * 100),
      weight: WEIGHTS.savingsRate,
      detail: (input.savingsRate * 100).toFixed(1),
    });
  }

  if (input.cashFlowRatio !== null) {
    components.push({
      key: 'cashFlow',
      score: clamp((input.cashFlowRatio / 0.1) * 100),
      weight: WEIGHTS.cashFlow,
      detail: (input.cashFlowRatio * 100).toFixed(1),
    });
  }

  if (input.goalProgress !== null) {
    components.push({
      key: 'goalProgress',
      score: clamp(input.goalProgress * 100),
      weight: WEIGHTS.goalProgress,
      detail: (input.goalProgress * 100).toFixed(1),
    });
  }

  if (input.taxReadiness !== null) {
    components.push({
      key: 'taxReadiness',
      score: clamp(input.taxReadiness * 100),
      weight: WEIGHTS.taxReadiness,
      detail: (input.taxReadiness * 100).toFixed(1),
    });
  }

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const weighted = components.reduce(
    (sum, component) => sum + component.score * component.weight,
    0,
  );

  return {
    // Rounded to a whole number, because a score with a decimal invites a
    // precision the inputs do not have.
    score: totalWeight === 0 ? 0 : Math.round(weighted / totalWeight),
    components,
    isPartial: components.length < Object.keys(WEIGHTS).length,
  };
}

/** Months of expenses the liquid balance covers, or null when either is unknown. */
export function emergencyMonths(
  liquid: Money | null,
  monthlyExpenses: Money | null,
): number | null {
  if (!liquid || !monthlyExpenses?.isPositive()) return null;
  if (!liquid.isPositive()) return 0;

  return Number((liquid.scaledUnits * 1000n) / monthlyExpenses.scaledUnits) / 1000;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
