import 'server-only';

import type { PromptLocale } from '@app/ai';
import { Money, type CurrencyCode, type PlainDate } from '@app/domain';

import { trimRate } from '@/lib/format';

import { copilotIsConfigured } from '../ai';
import type { Session } from '../session';

import type { Alert } from './alerts';
import type { BudgetSummary } from './budgets';
import { explainPlan, type PlanNarrative } from './copilot';
import type { DebtView, GoalView } from './administration';
import type { PlanView } from './plan';

/**
 * The month's advice.
 *
 * Every claim on this screen is a figure the deterministic engines already
 * computed, in the order they matter: what is available, what the plan says the
 * next dollar should do, which debt costs the most to leave alone, and which
 * goal is closest to being reached.
 *
 * The copilot's contribution is one paragraph, and it is additive by
 * construction. If the provider is missing, over budget, slow or ungrounded,
 * the household loses a paragraph and keeps every number. That is the rule the
 * product is built on — the AI explains what the engine decided, and is never
 * the source of a figure.
 *
 * That paragraph is `explainPlan`'s, not a second one written here. The first
 * version of this screen asked the *question-answering* prompt for advice, and
 * that prompt is built to refuse anything the facts do not directly answer — so
 * it declined every time, correctly, and the screen showed a decline forever.
 * The plan's narrator is the one whose job this is.
 */

export interface AdviceStep {
  readonly kind:
    | 'coverBuffer'
    | 'payOverdue'
    | 'attackDebt'
    | 'fundGoal'
    | 'trimBudget'
    | 'nothingLeft'
    | 'allClear';
  readonly values: Readonly<Record<string, string>>;
  readonly href: string;
  readonly amount: Money | null;
}

export interface AdviceView {
  readonly currency: CurrencyCode;
  readonly month: string;
  readonly available: Money;
  readonly committed: Money;
  readonly steps: readonly AdviceStep[];
  readonly narrative: PlanNarrative;
  readonly copilotConfigured: boolean;
  readonly isEmpty: boolean;
}

export interface AdviceInputs {
  readonly currency: CurrencyCode;
  readonly today: PlainDate;
  readonly plan: PlanView;
  readonly debts: readonly DebtView[];
  readonly goals: readonly GoalView[];
  readonly budgets: readonly BudgetSummary[];
  readonly alerts: readonly Alert[];
}

/**
 * The ladder, in the order the product argues for it everywhere else.
 *
 * Buffer, then what is already late, then the most expensive debt, then the
 * nearest goal, then the line that is running hot. A household that follows
 * only the first item has still done the most valuable thing available to them
 * this month, which is what makes the order worth having.
 */
export function buildSteps(inputs: AdviceInputs): readonly AdviceStep[] {
  const steps: AdviceStep[] = [];
  const safe = inputs.plan.safeToSpend.safeToSpend;

  if (safe.isNegative()) {
    steps.push({
      kind: 'coverBuffer',
      values: { amount: safe.abs().toDecimalString() },
      href: '/plan',
      amount: safe.abs(),
    });
  }

  const overdue = inputs.alerts.filter((alert) => alert.kind === 'overdueCommitment');
  if (overdue.length > 0) {
    steps.push({
      kind: 'payOverdue',
      values: { count: String(overdue.length) },
      href: '/commitments',
      amount: null,
    });
  }

  // The most expensive balance with something on it. Ordering by rate is the
  // argument the plan makes every month; repeating it here keeps the screens
  // from disagreeing.
  const expensive = [...inputs.debts]
    .filter((debt) => debt.currentBalance.isPositive())
    .sort((a, b) => Number(b.apr) - Number(a.apr))[0];

  if (expensive && safe.isPositive()) {
    steps.push({
      kind: 'attackDebt',
      values: {
        name: expensive.name,
        apr: trimRate(expensive.apr),
        amount: safe.toDecimalString(),
      },
      href: `/debts/${expensive.id}`,
      amount: safe,
    });
  }

  const nearest = [...inputs.goals]
    .filter((goal) => goal.status === 'active' && goal.targetAmount.greaterThan(goal.currentAmount))
    .sort((a, b) => a.priority - b.priority)[0];

  if (nearest && safe.isPositive() && !expensive) {
    const missing = nearest.targetAmount.subtract(nearest.currentAmount);
    steps.push({
      kind: 'fundGoal',
      values: { name: nearest.name, amount: Money.min(safe, missing).toDecimalString() },
      href: `/goals/${nearest.id}`,
      amount: Money.min(safe, missing),
    });
  }

  const hot = inputs.budgets
    .flatMap((budget) => budget.state.lines.map((line) => ({ budget, line })))
    .find((entry) => entry.line.isProjectedOver || entry.line.isOverspent);

  if (hot) {
    steps.push({
      kind: 'trimBudget',
      values: {
        budget: hot.budget.name,
        projected: hot.line.projected.toDecimalString(),
        planned: hot.line.planned.toDecimalString(),
      },
      href: `/budgets/${hot.budget.id}`,
      amount: null,
    });
  }

  if (steps.length === 0) {
    steps.push({
      kind: safe.isPositive() ? 'allClear' : 'nothingLeft',
      values: { amount: safe.abs().toDecimalString() },
      href: '/overview',
      amount: null,
    });
  }

  return steps;
}

export async function loadAdvice(
  session: Session,
  householdId: string,
  inputs: AdviceInputs,
  locale: PromptLocale,
): Promise<AdviceView> {
  const steps = buildSteps(inputs);
  const configured = copilotIsConfigured();

  return {
    currency: inputs.currency,
    month: inputs.today.slice(0, 7),
    available: inputs.plan.safeToSpend.safeToSpend,
    committed: inputs.plan.safeToSpend.totalClaimed,
    steps,
    copilotConfigured: configured,
    isEmpty: inputs.plan.isEmpty,
    narrative:
      configured && !inputs.plan.isEmpty
        ? await explainPlan(session, householdId, inputs.plan, locale)
        : { state: 'unavailable' },
  };
}
