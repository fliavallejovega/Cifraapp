import { Money, type PlainDate } from '@app/domain';

import {
  DEFAULT_PRIORITY_ORDER,
  TIER_POLICIES,
  type AllocationLine,
  type AllocationPlan,
  type Claim,
  type ClaimKind,
  type LineExplanation,
} from './types.js';

/**
 * The allocation engine.
 *
 * Money arrives. The system already knows what is committed, what is due, what
 * debt costs most, what tax must be reserved, and what the household's own rules
 * say. This turns all of that into a concrete plan for that money, and every
 * line of it can be explained.
 *
 * The mechanism is a waterfall down the priority ladder. Each tier takes what it
 * can from what is left, and how a tier splits money it cannot fully cover is a
 * property of the tier, not of the algorithm — see `TIER_POLICIES`.
 *
 * `Money.allocate` does the proportional splitting, which is why it was built
 * exact in Phase 0: every scaled unit lands somewhere, the parts sum back to the
 * whole, and the same inputs produce the same split every run. A plan that loses
 * a cent between the lines and the total is a plan nobody can reconcile.
 */

export interface AllocationInput {
  readonly incoming: Money;
  readonly claims: readonly Claim[];
  /** Defaults to the standard ladder. The household may reorder it. */
  readonly order?: readonly ClaimKind[];
  readonly today: PlainDate;
  /** Rule ids that shaped these claims, carried through to the plan. */
  readonly appliedRuleIds?: readonly string[];
}

export function buildAllocationPlan(input: AllocationInput): AllocationPlan {
  const currency = input.incoming.currency;
  const zero = Money.zero(currency);
  const order = input.order ?? DEFAULT_PRIORITY_ORDER;

  const usable = input.claims.filter(
    (claim) => claim.requested.isPositive() && claim.requested.currency === currency,
  );

  const lines: AllocationLine[] = [];
  let remaining = input.incoming;
  let position = 0;

  for (const kind of order) {
    const tier = usable.filter((claim) => claim.kind === kind).sort(withinTier);
    if (tier.length === 0) continue;

    const awards =
      TIER_POLICIES[kind] === 'proportional'
        ? splitProportionally(tier, remaining, currency)
        : fundInOrder(tier, remaining, currency);

    for (const claim of tier) {
      const allocated = awards.get(claim.id) ?? zero;
      lines.push({
        claimId: claim.id,
        kind: claim.kind,
        label: claim.label,
        target: claim.target,
        requested: claim.requested,
        allocated,
        shortfall: claim.requested.subtract(allocated),
        position,
        explanation: explain(claim, allocated, input.today),
        appliedRuleIds: [],
      });
      position += 1;
      remaining = remaining.subtract(allocated);
    }
  }

  const allocated = Money.sum(
    lines.map((line) => line.allocated),
    currency,
  );
  const shortfall = Money.sum(
    lines.map((line) => line.shortfall),
    currency,
  );

  return {
    currency,
    incoming: input.incoming,
    lines,
    allocated,
    unallocated: input.incoming.subtract(allocated),
    fullyFunded: shortfall.isZero(),
    shortfall,
    order,
    appliedRuleIds: input.appliedRuleIds ?? [],
  };
}

/**
 * Fills each claim completely before the next one gets anything.
 *
 * Two overdue bills and enough for one of them produce one settled bill and one
 * partial — never two halves. A half-paid electric bill is still a
 * disconnection, and strict ordering is what stops the tier producing two of
 * them. The remainder is still offered to the claim behind, because money toward
 * an overdue bill beats that money reaching a travel fund.
 */
function fundInOrder(
  tier: readonly Claim[],
  available: Money,
  currency: Money['currency'],
): Map<string, Money> {
  const awards = new Map<string, Money>();
  let left = available;

  for (const claim of tier) {
    if (!left.isPositive()) {
      awards.set(claim.id, Money.zero(currency));
      continue;
    }
    const award = Money.min(left, claim.requested);
    awards.set(claim.id, award);
    left = left.subtract(award);
  }

  return awards;
}

/**
 * Splits what is available across the whole tier at once, weighted by what each
 * claim asked for.
 *
 * Two goals at the same priority and enough money for one of them is the case
 * where splitting is exactly what the household meant. `Money.allocate`
 * guarantees the parts sum back to the whole with no cent invented or lost.
 */
function splitProportionally(
  tier: readonly Claim[],
  available: Money,
  currency: Money['currency'],
): Map<string, Money> {
  const awards = new Map<string, Money>();

  if (!available.isPositive()) {
    for (const claim of tier) awards.set(claim.id, Money.zero(currency));
    return awards;
  }

  const asked = Money.sum(
    tier.map((claim) => claim.requested),
    currency,
  );

  // Everything fits: each claim simply gets what it asked for, and the surplus
  // falls through to the next tier rather than being padded into this one.
  if (available.greaterThanOrEqual(asked)) {
    for (const claim of tier) awards.set(claim.id, claim.requested);
    return awards;
  }

  const shares = available.allocate(tier.map((claim) => claim.requested.scaledUnits));
  tier.forEach((claim, index) => {
    awards.set(claim.id, shares[index] ?? Money.zero(currency));
  });

  return awards;
}

/** Inside a tier: the household's own weight, then what is due soonest, then id. */
function withinTier(a: Claim, b: Claim): number {
  const weightA = a.weight ?? Number.MAX_SAFE_INTEGER;
  const weightB = b.weight ?? Number.MAX_SAFE_INTEGER;
  if (weightA !== weightB) return weightA - weightB;

  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Why this claim received what it received.
 *
 * Every line carries one. A plan a person cannot interrogate is a plan they have
 * to take on faith, and this product does not ask anyone to take money advice on
 * faith.
 *
 * A key and its values, never a sentence — see `LineExplanation`.
 */
function explain(claim: Claim, allocated: Money, today: PlainDate): LineExplanation {
  const amount = allocated.toCurrencyString();
  const label = claim.label;

  if (allocated.isZero()) {
    return { key: 'nothingLeft', values: { label } };
  }

  const partial = allocated.lessThan(claim.requested)
    ? { partialOf: claim.requested.toCurrencyString() }
    : {};

  switch (claim.kind) {
    case 'overdue_essential':
      return {
        key: 'overdueEssential',
        values: { amount, label, due: String(claim.dueDate) },
        ...partial,
      };
    case 'upcoming_essential':
      return {
        key: 'upcomingEssential',
        values: { amount, label, due: String(claim.dueDate) },
        ...partial,
      };
    case 'debt_minimum':
      return { key: 'debtMinimum', values: { amount, label }, ...partial };
    case 'tax_reserve':
      return { key: 'taxReserve', values: { amount }, ...partial };
    case 'emergency_fund':
      return { key: 'emergencyFund', values: { amount, label }, ...partial };
    case 'high_interest_debt':
      return claim.apr
        ? { key: 'highInterestDebt', values: { amount, label, apr: claim.apr }, ...partial }
        : { key: 'expensiveDebt', values: { amount, label }, ...partial };
    case 'investment':
      return { key: 'investment', values: { amount, label }, ...partial };
    case 'goal':
      return claim.dueDate
        ? {
            key: 'goalByDate',
            values: { amount, label, due: String(claim.dueDate) },
            ...partial,
          }
        : { key: 'goal', values: { amount, label }, ...partial };
    case 'discretionary':
      return { key: 'discretionary', values: { amount, today: String(today) } };
  }
}
