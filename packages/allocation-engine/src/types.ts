import type { Money, PlainDate } from '@app/domain';

/**
 * What a dollar can be asked to do.
 *
 * The order these appear in is the product's default answer to "what should I do
 * with the next dollar", and it is the one thing in this system a household is
 * most likely to disagree with — so it is configurable, and the engine records
 * which order produced a given plan.
 */
export type ClaimKind =
  | 'overdue_essential'
  | 'upcoming_essential'
  | 'debt_minimum'
  | 'tax_reserve'
  | 'emergency_fund'
  | 'high_interest_debt'
  | 'investment'
  | 'goal'
  | 'discretionary';

/**
 * The default ladder (spec §36). Overdue essentials first because a late rent
 * costs more than any interest rate in the household; discretionary last because
 * it is what is left, not what is planned.
 */
export const DEFAULT_PRIORITY_ORDER: readonly ClaimKind[] = [
  'overdue_essential',
  'upcoming_essential',
  'debt_minimum',
  'tax_reserve',
  'emergency_fund',
  'high_interest_debt',
  'investment',
  'goal',
  'discretionary',
];

/**
 * How a tier splits money it cannot fully cover.
 *
 * `sequential` fills each claim completely before the next one gets anything, so
 * the most urgent bill is settled and only the remainder — if there is one —
 * reaches the bill behind it. `proportional` shares what is available across the
 * whole tier from the start.
 *
 * The distinction is not cosmetic. Two overdue bills and enough for one of them
 * must produce one settled bill and one partial, not two halves: a half-paid
 * electric bill is still a disconnection, and ordering is the only thing that
 * prevents two of them. Two savings goals at the same priority are the opposite
 * case — sharing is precisely what the household meant by ranking them equally.
 *
 * Neither policy withholds money. A partial payment toward an overdue bill is
 * better than that money sitting in the tier below, so the remainder is always
 * offered and the gap is reported as the line's shortfall.
 */
export type TierPolicy = 'sequential' | 'proportional';

export const TIER_POLICIES: Record<ClaimKind, TierPolicy> = {
  overdue_essential: 'sequential',
  upcoming_essential: 'sequential',
  debt_minimum: 'sequential',
  tax_reserve: 'sequential',
  emergency_fund: 'sequential',
  high_interest_debt: 'sequential',
  investment: 'proportional',
  goal: 'proportional',
  discretionary: 'proportional',
};

/** A reference the household would recognize: `debt:mastercard`, `goal:travel`. */
export type TargetRef = string;

export interface Claim {
  readonly id: string;
  readonly kind: ClaimKind;
  /** What the household calls it. */
  readonly label: string;
  readonly target: TargetRef;
  readonly requested: Money;
  readonly dueDate?: PlainDate | null;
  /** The APR, for a debt claim. Carried so the explanation can cite it. */
  readonly apr?: string | null;
  /** Lower goes first inside its tier. Ties break on due date, then id. */
  readonly weight?: number | null;
}

export interface AllocationLine {
  readonly claimId: string;
  readonly kind: ClaimKind;
  readonly label: string;
  readonly target: TargetRef;
  readonly requested: Money;
  readonly allocated: Money;
  /** requested − allocated. Non-zero means this claim went unfunded. */
  readonly shortfall: Money;
  readonly position: number;
  /** In the household's own terms, citing the reason this claim ranks here. */
  readonly explanation: string;
  /** Rules that changed this line, so the plan can be traced back to them. */
  readonly appliedRuleIds: readonly string[];
}

export interface AllocationPlan {
  readonly currency: Money['currency'];
  readonly incoming: Money;
  readonly lines: readonly AllocationLine[];
  readonly allocated: Money;
  /** What no claim asked for. Genuinely free money, not a rounding remainder. */
  readonly unallocated: Money;
  /** True when every claim was met in full. */
  readonly fullyFunded: boolean;
  readonly shortfall: Money;
  readonly order: readonly ClaimKind[];
  readonly appliedRuleIds: readonly string[];
}

/**
 * What the household did with a plan.
 *
 * Acceptance rate is the single most meaningful product metric (spec §36): a
 * recommendation nobody follows is not a recommendation, it is a report.
 */
export type PlanOutcome = 'proposed' | 'viewed' | 'accepted' | 'modified' | 'dismissed';
