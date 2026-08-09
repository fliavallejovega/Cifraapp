import { daysBetween, Money, type CurrencyCode, type DateRange, type PlainDate } from '@app/domain';

import { median } from './statistics.js';
import type { BudgetLineInput, BudgetLineState } from './types.js';

/**
 * Budget state.
 *
 * A budget line has five numbers, and conflating any two of them misleads:
 *
 *   planned    what the household decided
 *   spent      what has actually left the account
 *   committed  what is due inside the period and has not left yet
 *   remaining  planned + rollover − spent − committed
 *   projected  where the period ends at the current pace
 *
 * `remaining` is the one people act on, and it is the reason `committed` cannot
 * be folded into `spent`: a grocery line with $200 left and a $180 bill due on
 * the 28th has $20 left, not $200. `projected` is the early warning — a line can
 * be well inside budget on the 10th and certain to break it by the 30th, and
 * saying so on the 10th is the only time it is useful.
 */

export interface BudgetStateInput {
  readonly currency: CurrencyCode;
  readonly period: DateRange;
  readonly today: PlainDate;
  readonly lines: readonly BudgetLineInput[];
  /** Actual spending in the period, by category id. */
  readonly spentByCategory: ReadonlyMap<string, Money>;
  /** Due inside the period and unpaid, by category id. */
  readonly committedByCategory?: ReadonlyMap<string, Money>;
}

export interface BudgetState {
  readonly currency: CurrencyCode;
  readonly period: DateRange;
  readonly lines: readonly BudgetLineState[];
  readonly planned: Money;
  readonly spent: Money;
  readonly committed: Money;
  readonly remaining: Money;
  readonly projected: Money;
  /** Days elapsed and total, so a caller can show the pace it was told. */
  readonly elapsedDays: number;
  readonly periodDays: number;
  readonly isOverspent: boolean;
  readonly isProjectedOver: boolean;
}

export function computeBudgetState(input: BudgetStateInput): BudgetState {
  const { currency } = input;
  const zero = Money.zero(currency);

  const periodDays = daysBetween(input.period.start, input.period.end) + 1;
  const elapsedDays = clampInt(daysBetween(input.period.start, input.today) + 1, 1, periodDays);
  const isClosed = input.today > input.period.end;

  const lines = input.lines.map((line): BudgetLineState => {
    const rolloverIn = line.rolloverIn ?? zero;
    const spent = (line.categoryId ? input.spentByCategory.get(line.categoryId) : null) ?? zero;
    const committed =
      (line.categoryId ? input.committedByCategory?.get(line.categoryId) : null) ?? zero;

    const budgeted = line.planned.add(rolloverIn);
    const remaining = budgeted.subtract(spent).subtract(committed);
    const projected = projectSpend(spent, committed, elapsedDays, periodDays, isClosed);

    return {
      id: line.id,
      categoryId: line.categoryId,
      planned: line.planned,
      rolloverIn,
      spent,
      committed,
      remaining,
      projected,
      isOverspent: remaining.isNegative(),
      isProjectedOver: projected.greaterThan(budgeted),
    };
  });

  const planned = Money.sum(
    lines.map((line) => line.planned.add(line.rolloverIn)),
    currency,
  );
  const spent = Money.sum(
    lines.map((line) => line.spent),
    currency,
  );
  const committed = Money.sum(
    lines.map((line) => line.committed),
    currency,
  );
  const projected = Money.sum(
    lines.map((line) => line.projected),
    currency,
  );
  const remaining = planned.subtract(spent).subtract(committed);

  return {
    currency,
    period: input.period,
    lines,
    planned,
    spent,
    committed,
    remaining,
    projected,
    elapsedDays,
    periodDays,
    isOverspent: remaining.isNegative(),
    isProjectedOver: projected.greaterThan(planned),
  };
}

/**
 * How much of the period must have passed before pacing means anything.
 *
 * Two days into a month with one $900 rent charge posted, straight-line pacing
 * predicts $13,950 for the month. That warning is not merely wrong, it is
 * actively harmful: an alert that absurd teaches people to dismiss the alerts
 * that are real. Early in a period the only honest projection is what has
 * already happened plus what is already due.
 */
const MIN_ELAPSED_FRACTION_FOR_PACING = 0.2;

/**
 * Where the line lands at the current pace.
 *
 * Straight-line extrapolation from elapsed days, floored at what is already
 * spent plus what is already due, and suppressed entirely until enough of the
 * period has passed for a rate to exist. Once the period has closed there is
 * nothing to extrapolate — the projection is simply what happened.
 */
function projectSpend(
  spent: Money,
  committed: Money,
  elapsedDays: number,
  periodDays: number,
  isClosed: boolean,
): Money {
  const floor = spent.add(committed);
  if (isClosed || elapsedDays >= periodDays) return floor;
  if (elapsedDays < periodDays * MIN_ELAPSED_FRACTION_FOR_PACING) return floor;

  const paced = spent.multiply(periodDays).divide(elapsedDays);
  return Money.max(paced, floor);
}

export interface BudgetSuggestion {
  readonly categoryId: string;
  /** The median of the household's own monthly spending in this category. */
  readonly suggested: Money;
  readonly monthsObserved: number;
  readonly confidence: number;
  readonly explanation: string;
}

/** Fewer months than this and a median is just one of the numbers. */
export const MIN_MONTHS_FOR_SUGGESTION = 3;

/**
 * Builds a budget from what the household actually spends, not from a template.
 *
 * A budget generated from percentages someone read in a magazine gets abandoned
 * in week two. A budget that says "you spend about $420 on groceries" is a
 * statement the household recognizes, and can then decide to argue with.
 *
 * The median, again, rather than the mean: the month with the birthday party
 * should not set the grocery budget for the year.
 */
export function suggestBudget(
  monthlyTotalsByCategory: ReadonlyMap<string, readonly Money[]>,
): BudgetSuggestion[] {
  const suggestions: BudgetSuggestion[] = [];

  for (const [categoryId, months] of monthlyTotalsByCategory) {
    if (months.length < MIN_MONTHS_FOR_SUGGESTION) continue;

    const centre = median(months);
    if (!centre?.isPositive()) continue;

    const suggested = centre.roundToCurrencyPrecision();
    const confidence = Math.min(0.5 + 0.1 * (months.length - MIN_MONTHS_FOR_SUGGESTION), 0.9);

    suggestions.push({
      categoryId,
      suggested,
      monthsObserved: months.length,
      confidence,
      explanation: `Based on ${String(months.length)} months of your own spending.`,
    });
  }

  return suggestions.sort((a, b) =>
    b.suggested.scaledUnits === a.suggested.scaledUnits
      ? a.categoryId < b.categoryId
        ? -1
        : 1
      : b.suggested.scaledUnits > a.suggested.scaledUnits
        ? 1
        : -1,
  );
}

function clampInt(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
