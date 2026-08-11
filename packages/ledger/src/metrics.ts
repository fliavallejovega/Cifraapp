import { Money, type CurrencyCode, type PlainDate } from '@app/domain';

import type { CustomerMrr, MrrMovement, MrrSnapshot } from './types.js';

/**
 * SaaS metrics, computed so they can be reconciled rather than believed.
 *
 * MRR here comes from subscriptions; revenue in the ledger comes from postings.
 * They are two views of the same business and they should agree. Computing both
 * is what makes a disagreement visible — a metric that cannot be checked against
 * the books is a number a founder repeats until someone with an audit asks where
 * it came from.
 *
 * Every figure is `Money`. A dashboard that rounds MRR to the nearest dollar is
 * fine; a system that stores it that way cannot reconcile to a ledger that does
 * not.
 */

/** An annual plan contributes a twelfth of its price each month. */
export function monthlyEquivalent(price: Money, interval: 'month' | 'year'): Money {
  return interval === 'year' ? price.divide(12) : price;
}

export function snapshot(
  customers: readonly CustomerMrr[],
  on: PlainDate,
  currency: CurrencyCode,
): MrrSnapshot {
  const paying = customers.filter((customer) => customer.mrr.isPositive());
  const mrr = Money.sum(
    paying.map((customer) => customer.mrr),
    currency,
  );

  return {
    on,
    currency,
    mrr,
    arr: mrr.multiply(12),
    customers: paying.length,
    // Averaged over paying customers only. Including free accounts makes ARPU a
    // measure of how many people signed up, which is a different question.
    arpu: paying.length === 0 ? Money.zero(currency) : mrr.divide(paying.length),
  };
}

/**
 * How recurring revenue moved between two points.
 *
 * The five components are exhaustive by construction — opening plus new plus
 * expansion less contraction less churn equals closing — because a movement
 * analysis that does not tie out is worse than none: it invites the reader to
 * trust a decomposition that is quietly missing a customer.
 */
export function movement(
  previous: readonly CustomerMrr[],
  current: readonly CustomerMrr[],
  currency: CurrencyCode,
): MrrMovement {
  const before = new Map(previous.map((customer) => [customer.customerId, customer.mrr]));
  const after = new Map(current.map((customer) => [customer.customerId, customer.mrr]));
  const zero = Money.zero(currency);

  let newMrr = zero;
  let expansion = zero;
  let contraction = zero;
  let churned = zero;
  let logoChurn = 0;
  let retainedFromBefore = zero;

  for (const [customerId, then] of before) {
    const now = after.get(customerId) ?? zero;

    if (!now.isPositive()) {
      churned = churned.add(then);
      logoChurn += 1;
      continue;
    }

    retainedFromBefore = retainedFromBefore.add(now);

    if (now.greaterThan(then)) {
      expansion = expansion.add(now.subtract(then));
    } else if (now.lessThan(then)) {
      contraction = contraction.add(then.subtract(now));
    }
  }

  for (const [customerId, now] of after) {
    if (!before.has(customerId) && now.isPositive()) {
      newMrr = newMrr.add(now);
    }
  }

  const opening = Money.sum([...before.values()], currency);
  const closing = Money.sum([...after.values()], currency);

  return {
    currency,
    opening,
    newMrr,
    expansion,
    contraction,
    churned,
    closing,
    logoChurn,
    // Both retention figures look only at customers present at the start.
    // Including new customers would let a good sales month hide churn entirely.
    netRetention: ratio(retainedFromBefore, opening),
    grossRetention: ratio(Money.max(retainedFromBefore.subtract(expansion), zero), opening),
  };
}

/**
 * Lifetime value, as the crude estimate it is.
 *
 * ARPU divided by monthly churn. It is a projection built on the assumption that
 * this month's churn continues forever, which it does not, and it is reported
 * here so that nobody computes it a second way somewhere else. Null when churn
 * is zero: a cohort that has lost nobody has no measurable lifetime, and
 * reporting infinity as a number would put it on a slide.
 */
export function lifetimeValue(arpu: Money, monthlyChurnRate: number): Money | null {
  if (monthlyChurnRate <= 0 || !Number.isFinite(monthlyChurnRate)) return null;
  return arpu.divide(monthlyChurnRate);
}

/** Customers lost over customers at the start, 0–1. */
export function logoChurnRate(lost: number, atStart: number): number | null {
  return atStart === 0 ? null : lost / atStart;
}

function ratio(part: Money, whole: Money): number | null {
  if (!whole.isPositive()) return null;
  return Number((part.scaledUnits * 10_000n) / whole.scaledUnits) / 10_000;
}
