import type { Money, PlainDate } from '@app/domain';

/**
 * How often something repeats.
 *
 * `semimonthly` is not a rounding of `biweekly`. Panamanian salaries are paid on
 * the 15th and the last day of the month — 24 payments a year on two fixed
 * calendar days, not 26 payments every fourteen days. Collapsing the two makes
 * the engine predict a 27th paycheck that never arrives, and a cash-flow
 * forecast built on a phantom paycheck is worse than no forecast.
 */
export type Frequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'quarterly' | 'annual';

/** One dated movement, as the recurrence and forecast passes need to see it. */
export interface Occurrence {
  readonly id: string;
  readonly date: PlainDate;
  readonly amount: Money;
}

export interface RecurringSeries {
  readonly frequency: Frequency;
  /** The typical amount — a median, so one unusual month does not move it. */
  readonly expectedAmount: Money;
  readonly lastSeen: PlainDate;
  readonly nextExpectedDate: PlainDate;
  /** 0–1, built from how regular the timing is and how stable the amount is. */
  readonly confidence: number;
  readonly occurrenceCount: number;
  /** How much the amounts vary around the median, 0 = identical every time. */
  readonly amountVariation: number;
  /**
   * The calendar days a `semimonthly` series lands on, `31` meaning month end.
   * Carried on the series so projecting it forward needs nothing else — a salary
   * paid on the 5th and the 20th must not be projected onto the 15th and 31st.
   */
  readonly anchorDays?: readonly number[];
  readonly explanation: string;
}

/** A claim on money that has not been paid yet. */
export interface UpcomingObligation {
  readonly id: string;
  readonly name: string;
  readonly due: PlainDate;
  readonly amount: Money;
  readonly isEssential: boolean;
}

export interface BudgetLineInput {
  readonly id: string;
  readonly categoryId: string | null;
  readonly planned: Money;
  /** Carried in from the previous period, when the budget rolls over. */
  readonly rolloverIn?: Money;
}

export interface BudgetLineState {
  readonly id: string;
  readonly categoryId: string | null;
  readonly planned: Money;
  readonly rolloverIn: Money;
  /** Actually spent so far in the period. */
  readonly spent: Money;
  /** Due inside the period and not yet paid. */
  readonly committed: Money;
  /** planned + rollover − spent − committed. May be negative. */
  readonly remaining: Money;
  /** Where the period ends up at the current pace. Never below spent + committed. */
  readonly projected: Money;
  readonly isOverspent: boolean;
  /** True when the pace, not the ledger, is what will break the line. */
  readonly isProjectedOver: boolean;
}
