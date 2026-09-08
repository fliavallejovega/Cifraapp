import 'server-only';

import { formatMoney, type CurrencyCode, type MoneyLocale, type PlainDate } from '@app/domain';

import type { DebtView, GoalView } from './administration';
import type { BudgetSummary } from './budgets';
import type { PlanView } from './plan';
import type { QueueCounts } from './review';

/**
 * How a conversation opens.
 *
 * Every word of it is composed here, from rows, and none of it comes from the
 * model. That is not caution for its own sake: the opening states figures —
 * what is available, what the most expensive debt costs — and the rule the
 * whole product rests on is that the assistant never sources a number.
 *
 * The shape is three things, in the order a person needs them:
 *
 *   1. **What we already know.** Opening with «tell me about yourself» when the
 *      system holds four months of their statements is insulting, and it is the
 *      reason most financial chatbots feel like a form.
 *   2. **What we cannot know.** Two questions, asked once. No ledger contains
 *      whether somebody is trying to leave a job or is afraid of the school
 *      fee, and those change every answer that follows.
 *   3. **Ways in.** Starter questions built from this household's own rows, so
 *      every one of them is answerable. A suggestion the data cannot support is
 *      a promise the next screen breaks.
 */

export interface OpeningFact {
  readonly label: string;
  readonly value: string;
}

export interface ChatOpening {
  readonly facts: readonly OpeningFact[];
  /** What the household has to tell us, because no row holds it. */
  readonly questions: readonly string[];
  /** Tappable prompts, each one answerable from data that exists. */
  readonly starters: readonly string[];
  /** False when there is not enough recorded to open with anything real. */
  readonly hasContext: boolean;
}

export interface OpeningLabels {
  readonly facts: {
    readonly available: string;
    readonly committed: string;
    readonly liquid: string;
    readonly debt: string;
    readonly goal: string;
    readonly pending: string;
  };
  readonly questions: readonly string[];
  readonly starters: {
    readonly surplus: string;
    readonly shortfall: string;
    readonly debt: string;
    readonly goal: string;
    readonly budget: string;
    readonly month: string;
  };
}

export interface OpeningInputs {
  readonly currency: CurrencyCode;
  readonly moneyLocale: MoneyLocale;
  readonly today: PlainDate;
  readonly plan: PlanView;
  readonly debts: readonly DebtView[];
  readonly goals: readonly GoalView[];
  readonly budgets: readonly BudgetSummary[];
  readonly queues: QueueCounts;
}

/** Fills `{name}`-style placeholders without dragging the catalogue in here. */
function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

export function buildOpening(inputs: OpeningInputs, labels: OpeningLabels): ChatOpening {
  const money = (value: Parameters<typeof formatMoney>[0]) =>
    formatMoney(value, { locale: inputs.moneyLocale });

  const safe = inputs.plan.safeToSpend.safeToSpend;
  const facts: OpeningFact[] = [];
  const starters: string[] = [];

  if (!inputs.plan.isEmpty) {
    facts.push({ label: labels.facts.available, value: money(safe) });
    facts.push({
      label: labels.facts.committed,
      value: money(inputs.plan.safeToSpend.totalClaimed),
    });
    facts.push({ label: labels.facts.liquid, value: money(inputs.plan.safeToSpend.liquid) });

    starters.push(
      safe.isPositive()
        ? fill(labels.starters.surplus, { amount: money(safe) })
        : fill(labels.starters.shortfall, { amount: money(safe.abs()) }),
    );
  }

  // The most expensive balance carrying something. This is the fact that most
  // often changes what a household should do next, so it leads.
  const expensive = [...inputs.debts]
    .filter((debt) => debt.currentBalance.isPositive())
    .sort((a, b) => Number(b.apr) - Number(a.apr))[0];

  if (expensive) {
    const apr = expensive.apr.includes('.')
      ? expensive.apr.replace(/0+$/, '').replace(/\.$/, '')
      : expensive.apr;

    facts.push({
      label: labels.facts.debt,
      value: `${expensive.name} · ${money(expensive.currentBalance)} · ${apr}%`,
    });
    starters.push(fill(labels.starters.debt, { name: expensive.name }));
  }

  const nearest = [...inputs.goals]
    .filter((goal) => goal.status === 'active' && goal.targetAmount.greaterThan(goal.currentAmount))
    .sort((a, b) => a.priority - b.priority)[0];

  if (nearest) {
    facts.push({
      label: labels.facts.goal,
      value: `${nearest.name} · ${money(nearest.currentAmount)} / ${money(nearest.targetAmount)}`,
    });
    starters.push(fill(labels.starters.goal, { name: nearest.name }));
  }

  const hot = inputs.budgets
    .flatMap((budget) => budget.state.lines.map((line) => ({ budget, line })))
    .find((entry) => entry.line.isProjectedOver || entry.line.isOverspent);

  if (hot) {
    starters.push(fill(labels.starters.budget, { budget: hot.budget.name }));
  }

  if (inputs.queues.total > 0) {
    facts.push({ label: labels.facts.pending, value: String(inputs.queues.total) });
  }

  // Always last, and always answerable: it needs only transactions, and a
  // household with none sees the empty opening instead.
  starters.push(labels.starters.month);

  return {
    facts,
    questions: labels.questions,
    // Four is what fits without turning the opening into a menu.
    starters: starters.slice(0, 4),
    hasContext: facts.length > 0,
  };
}

/**
 * The conversation so far, as the model is allowed to see it.
 *
 * Capped, and oldest turns dropped first: a thread that ran for forty exchanges
 * would otherwise send its whole history on every question, and the cost of an
 * answer would grow with how long somebody had been talking.
 *
 * Prior answers are safe to feed back only because every one of them already
 * passed the guardrail when it was produced — an answer containing a figure the
 * product could not verify was never stored as an answer.
 */
export function conversationGrounding(
  messages: readonly { readonly role: 'user' | 'assistant'; readonly body: string }[],
  labels: { readonly you: string; readonly assistant: string },
  maxTurns = 12,
): string {
  const recent = messages.slice(-maxTurns);
  if (recent.length === 0) return 'none';

  return recent
    .map((message) => {
      const who = message.role === 'user' ? labels.you : labels.assistant;
      // Long answers are trimmed rather than dropped: what matters for a
      // follow-up is what was decided, and that is at the start.
      const body = message.body.length > 600 ? `${message.body.slice(0, 600)}…` : message.body;
      return `${who}: ${body}`;
    })
    .join('\n');
}
