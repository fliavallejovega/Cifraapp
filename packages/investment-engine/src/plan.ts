import type { Money } from '@app/domain';

import { projectContribution, requiredContribution } from './contribution.js';
import { DEFAULT_BANDS, suitsHorizon, type RiskBand, type RiskLevel } from './risk.js';

/**
 * What each level of risk would ask of a household, for one goal.
 *
 * Four answers to the same question — «what would I have to put in every month
 * to get there» — one per risk level, each with the range its assumption band
 * implies. Shown together, because the point of the screen is the trade: less
 * risk means more money in, and more risk means a wider range of where you
 * actually land.
 *
 * Nothing here recommends. The engine reports what each choice would require
 * and what each has historically cost in bad years; which one a household
 * picks is theirs, and the screen says so.
 */

export interface GoalTarget {
  readonly id: string;
  readonly name: string;
  readonly target: Money;
  readonly current: Money;
  readonly months: number;
}

export interface LevelOutcome {
  readonly level: RiskLevel;
  readonly band: RiskBand;
  /** The contribution the expected assumption implies. */
  readonly monthly: Money;
  /** Where that same contribution lands if the poor assumption holds instead. */
  readonly ifPoor: Money;
  readonly ifExpected: Money;
  readonly ifGood: Money;
  /** True when the horizon is too short for this level, whatever the maths says. */
  readonly tooShort: boolean;
  /** What a fall of the historical size would take off the balance on the way. */
  readonly drawdownAtWorst: Money;
  readonly unreachable: boolean;
}

export interface GoalPlan {
  readonly goal: GoalTarget;
  readonly outcomes: readonly LevelOutcome[];
  /** What the household would need with no growth at all. The honest floor. */
  readonly withoutGrowth: Money;
}

export function planForGoal(
  goal: GoalTarget,
  bands: Readonly<Record<RiskLevel, RiskBand>> = DEFAULT_BANDS,
): GoalPlan {
  const levels = Object.values(bands);

  const outcomes = levels.map((band): LevelOutcome => {
    const required = requiredContribution({
      target: goal.target,
      current: goal.current,
      months: goal.months,
      annualRatePercent: band.expected,
    });

    const project = (rate: string) =>
      projectContribution({
        monthly: required.monthly,
        current: goal.current,
        months: goal.months,
        annualRatePercent: rate,
      });

    const ifExpected = project(band.expected);

    // The fall is applied to where the money would be, not to the target: a
    // 30% drawdown on a balance of $1,200 is $360, and quoting it against the
    // goal instead would overstate it for most of the horizon.
    const drawdown = ifExpected.percentage(String(band.historicalDrawdown));

    return {
      level: band.level,
      band,
      monthly: required.monthly,
      ifPoor: project(band.low),
      ifExpected,
      ifGood: project(band.high),
      tooShort: !suitsHorizon(band, goal.months),
      drawdownAtWorst: drawdown,
      unreachable: required.unreachable,
    };
  });

  const withoutGrowth = requiredContribution({
    target: goal.target,
    current: goal.current,
    months: goal.months,
    annualRatePercent: '0',
  }).monthly;

  return { goal, outcomes, withoutGrowth };
}

/**
 * Whether a household can afford a plan at all.
 *
 * The most useful thing this module can say is often «none of these fit» — and
 * saying it beats printing four contributions the household has no room for.
 * Capacity is what the plan engine already computed as available, not a figure
 * invented here.
 */
export function affordable(plan: GoalPlan, capacity: Money): readonly LevelOutcome[] {
  return plan.outcomes.filter(
    (outcome) => !outcome.unreachable && outcome.monthly.lessThanOrEqual(capacity),
  );
}
