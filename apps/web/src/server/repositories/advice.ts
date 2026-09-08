import 'server-only';

import { QUESTION_ANSWER_V1, type PromptLocale } from '@app/ai';
import { formatMoney, Money, type CurrencyCode, type PlainDate } from '@app/domain';

import { ask, copilotIsConfigured } from '../ai';
import type { Session } from '../session';

import type { Alert } from './alerts';
import type { BudgetSummary } from './budgets';
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
 */

export type AdviceNarrative =
  | { readonly state: 'unavailable' }
  | { readonly state: 'declined'; readonly reason: 'budget' | 'quality' | 'error' }
  | { readonly state: 'answered'; readonly body: string; readonly usedFacts: readonly string[] };

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
  readonly narrative: AdviceNarrative;
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
        apr: trim(expensive.apr),
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
        ? await narrate(session, householdId, inputs, steps, locale)
        : { state: 'unavailable' },
  };
}

async function narrate(
  session: Session,
  householdId: string,
  inputs: AdviceInputs,
  steps: readonly AdviceStep[],
  locale: PromptLocale,
): Promise<AdviceNarrative> {
  const moneyLocale = locale === 'en' ? 'en-US' : 'es-PA';
  const money = (value: Money) => formatMoney(value, { locale: moneyLocale });

  // The grounding is formatted exactly as the screen formats it, so the
  // guardrail compares the model's figures against the strings the household
  // will actually read — not against a differently-rounded copy of them.
  const result = await ask(session, householdId, {
    prompt: QUESTION_ANSWER_V1,
    locale,
    currency: inputs.currency,
    grounding: {
      question:
        locale === 'en'
          ? 'What should this household do with its money this month?'
          : '¿Qué debería hacer este hogar con su dinero este mes?',
      available: money(inputs.plan.safeToSpend.safeToSpend),
      liquid: money(inputs.plan.safeToSpend.liquid),
      steps: steps.map((step) => step.kind).join(', '),
      debts: inputs.debts
        .map((debt) => `${debt.name} ${money(debt.currentBalance)} at ${trim(debt.apr)}%`)
        .join(' · '),
      goals: inputs.goals
        .filter((goal) => goal.status === 'active')
        .map((goal) => `${goal.name} ${money(goal.currentAmount)} of ${money(goal.targetAmount)}`)
        .join(' · '),
    },
  });

  if (!result.ok) {
    switch (result.error.kind) {
      case 'not_configured':
        return { state: 'unavailable' };
      case 'budget_exhausted':
        return { state: 'declined', reason: 'budget' };
      case 'ungrounded_figures':
      case 'malformed_output':
      case 'refused':
        // The guardrail working. The household is told the assistant declined
        // rather than shown a sentence nobody could verify.
        return { state: 'declined', reason: 'quality' };
      case 'missing_grounding':
      case 'transport':
        return { state: 'declined', reason: 'error' };
    }
  }

  const answerable = result.value.output['answerable'];
  if (answerable === false) return { state: 'declined', reason: 'quality' };

  const answer = result.value.output['answer'];
  const usedFacts = result.value.output['usedFacts'];

  return {
    state: 'answered',
    body: typeof answer === 'string' ? answer : '',
    usedFacts: Array.isArray(usedFacts) ? usedFacts.map((fact) => String(fact)) : [],
  };
}

function trim(rate: string): string {
  return rate.includes('.') ? rate.replace(/0+$/, '').replace(/\.$/, '') : rate;
}
