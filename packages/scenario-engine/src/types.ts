import type { Debt } from '@app/debt-engine';
import type { CurrencyCode, Money, PlainDate } from '@app/domain';

/**
 * "What happens if…", answered arithmetically.
 *
 * A scenario is never run against live rows. It takes a **snapshot** — a plain
 * value, copied out of the household's position — and projects forward from it.
 * Nothing in this package can reach a database, and that is the isolation the
 * spec asks for: a household must be able to model losing their job without any
 * risk that modelling it changes something.
 *
 * The projection is deterministic and boring on purpose. It is arithmetic the
 * household could check on paper, not a forecast: it says what follows from
 * these assumptions, and the assumptions are all visible.
 */

export type ScenarioKind =
  | 'vehicle_purchase'
  | 'marriage'
  | 'child'
  | 'income_loss'
  | 'bonus'
  | 'debt_payoff'
  | 'vacation'
  | 'move'
  | 'rent_increase'
  | 'job_change';

/** A goal as the projection needs it: where it is, where it is going, and the pace. */
export interface GoalSnapshot {
  readonly id: string;
  readonly name: string;
  readonly current: Money;
  readonly target: Money;
  readonly monthlyContribution: Money;
}

export interface Baseline {
  readonly currency: CurrencyCode;
  /** The first month projected. Always the first day of that month. */
  readonly startMonth: PlainDate;
  readonly liquid: Money;
  readonly monthlyIncome: Money;
  /** Everything that leaves each month except debt payments, which are derived. */
  readonly monthlyExpenses: Money;
  readonly debts: readonly Debt[];
  readonly goals: readonly GoalSnapshot[];
}

/**
 * One change a scenario makes, and when.
 *
 * Every field is a delta against the baseline rather than a replacement, so a
 * scenario reads as what it actually is — "rent goes up $150" — and two changes
 * can be combined without either needing to know about the other.
 */
export interface ScenarioChange {
  readonly label: string;
  /** 0 applies from the first projected month. */
  readonly startsInMonths: number;
  /** Null runs to the end of the horizon. */
  readonly durationMonths: number | null;
  /** Paid once, in the month the change starts. A car deposit, a wedding. */
  readonly oneTimeCost: Money | null;
  readonly monthlyExpenseDelta: Money | null;
  readonly monthlyIncomeDelta: Money | null;
  /** Debt taken on to make the change happen: the car loan, the mortgage. */
  readonly addedDebt: Debt | null;
}

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly kind: ScenarioKind;
  readonly changes: readonly ScenarioChange[];
  readonly horizonMonths: number;
}

export interface ProjectedMonth {
  readonly month: PlainDate;
  readonly income: Money;
  /** Living costs. Debt payments are reported separately; they are not optional. */
  readonly expenses: Money;
  readonly debtPayments: Money;
  readonly interestAccrued: Money;
  readonly goalContributions: Money;
  readonly netCashFlow: Money;
  readonly liquid: Money;
  readonly debtBalance: Money;
  readonly netWorth: Money;
  /**
   * True when the month's outgoings exceeded what came in *and* the buffer could
   * not absorb it. This is the day a household would bounce something.
   */
  readonly isCashPressure: boolean;
}

export interface Projection {
  readonly currency: CurrencyCode;
  readonly months: readonly ProjectedMonth[];
  readonly endingLiquid: Money;
  readonly endingDebt: Money;
  readonly endingNetWorth: Money;
  readonly totalInterest: Money;
  /**
   * Months before liquid funds run out, or null if they do not inside the
   * horizon. Null is not reassurance — it is the horizon being shorter than the
   * problem.
   */
  readonly runwayMonths: number | null;
  readonly firstShortfallMonth: PlainDate | null;
}

/** The scenario against the same household with nothing changed. */
export interface ScenarioComparison {
  readonly baseline: Projection;
  readonly scenario: Projection;
  readonly liquidDelta: Money;
  readonly debtDelta: Money;
  readonly netWorthDelta: Money;
  readonly interestDelta: Money;
  /** Negative means the scenario shortens how long the household lasts. */
  readonly runwayDeltaMonths: number | null;
}
