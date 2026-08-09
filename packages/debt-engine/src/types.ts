import type { Money, PlainDate } from '@app/domain';

/**
 * How the household decides which debt to attack with the money left over after
 * every minimum has been paid.
 *
 *   avalanche  highest rate first — mathematically optimal, saves the most money
 *   snowball   smallest balance first — clears accounts fastest, keeps people going
 *   custom     the household's own order
 *   hybrid     quick wins first, then avalanche
 *
 * The product does not take a side. Avalanche wins on arithmetic and snowball
 * wins on the arithmetic actually being followed through, and which one is right
 * depends on a person the engine cannot see. What it can do is show the cost of
 * the choice honestly, which is what the simulation is for.
 */
export type DebtStrategy = 'avalanche' | 'snowball' | 'custom' | 'hybrid';

export interface Debt {
  readonly id: string;
  readonly name: string;
  readonly currentBalance: Money;
  /** A percentage with up to three decimals: `'24.500'` means 24.5% a year. */
  readonly apr: string;
  readonly minimumPayment: Money;
  readonly creditLimit?: Money | null;
  /** A teaser rate that applies until it expires, then the ordinary APR resumes. */
  readonly promotionalApr?: string | null;
  readonly promotionalExpiresOn?: PlainDate | null;
  /** Lower goes first under the `custom` strategy. */
  readonly strategyPriority?: number | null;
}

export interface OrderedDebt {
  readonly debt: Debt;
  readonly position: number;
  /** The rate actually in force today, promotional or ordinary. */
  readonly effectiveApr: string;
  /** Why this debt sits here, in the household's own terms. */
  readonly reason: string;
}

/** One month of a payoff simulation. */
export interface PayoffMonth {
  readonly month: string;
  readonly interestAccrued: Money;
  readonly principalPaid: Money;
  readonly paid: Money;
  readonly closingBalance: Money;
  /** Which debt received the money above the minimums. */
  readonly targetDebtId: string | null;
  readonly clearedDebtIds: readonly string[];
}

export interface DebtOutcome {
  readonly debtId: string;
  readonly name: string;
  readonly payoffDate: PlainDate | null;
  readonly monthsToPayoff: number | null;
  readonly interestPaid: Money;
}

export interface PayoffPlan {
  readonly strategy: DebtStrategy;
  readonly months: readonly PayoffMonth[];
  readonly outcomes: readonly DebtOutcome[];
  readonly totalInterest: Money;
  readonly debtFreeOn: PlainDate | null;
  readonly monthsToDebtFree: number | null;
  /** Debts the plan never clears inside the horizon. */
  readonly unresolvedDebtIds: readonly string[];
}

/**
 * Why a simulation could not be run at all. These are expected outcomes, not
 * faults — a household asking "what if I pay $300 a month" against $420 of
 * minimums deserves an answer, not an exception.
 */
export type SimulationProblem =
  | { readonly kind: 'below_minimums'; readonly required: Money; readonly offered: Money }
  | { readonly kind: 'no_debts' }
  | { readonly kind: 'currency_mismatch'; readonly expected: string; readonly found: string };
