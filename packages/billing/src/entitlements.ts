import type { EntitlementKey, EntitlementLimit, Entitlements, Subscription } from './types.js';

/**
 * What a household may do, and how close they are to not being able to.
 *
 * The whole point is that no caller ever names a plan. A screen asks "may I
 * import another document" and gets an answer; whether that household is on PRO,
 * on a trial, inside a grace window, or carrying a support-granted exception is
 * this file's problem and nobody else's.
 *
 * The warning threshold matters as much as the limit. A household that discovers
 * their limit by hitting it has been failed twice: once by the wall and once by
 * the silence in front of it.
 */

export const WARN_AT_FRACTION = 0.8;

export const UNLIMITED = null;

/** Nothing included. The base every plan is built up from, never a fallback. */
export const NOTHING: Entitlements = {
  transactions_per_month: 0,
  household_members: 0,
  document_imports: 0,
  rules: 0,
  goals: 0,
  reports: 0,
  tax_engine: 0,
  accountant_mode: 0,
  white_label: 0,
  ai_usage: 0,
};

/**
 * A subscription's effective entitlements.
 *
 * Overrides win, including downwards — a support grant and a support restriction
 * are the same mechanism, and an override that could only raise a limit would
 * leave no way to contain an abusive account without cancelling it.
 *
 * A subscription that has expired falls back to the free plan's entitlements
 * rather than to nothing. Locking a household out of their own financial history
 * because a card expired is not a business decision anyone would defend out loud.
 */
export function effectiveEntitlements(
  subscription: Pick<Subscription, 'status' | 'overrides'>,
  planEntitlements: Entitlements,
  freeEntitlements: Entitlements,
): Entitlements {
  const base =
    subscription.status === 'expired' || subscription.status === 'canceled'
      ? freeEntitlements
      : planEntitlements;

  return { ...base, ...subscription.overrides };
}

export type EntitlementVerdict =
  | { readonly decision: 'allow'; readonly remaining: EntitlementLimit }
  | { readonly decision: 'warn'; readonly remaining: number; readonly fractionUsed: number }
  | { readonly decision: 'deny'; readonly limit: number };

/**
 * Whether one more of something is allowed.
 *
 * `used` is what already exists in the period; `additional` defaults to one more.
 */
export function checkEntitlement(
  entitlements: Entitlements,
  key: EntitlementKey,
  used: number,
  additional = 1,
): EntitlementVerdict {
  const limit = entitlements[key];
  if (limit === UNLIMITED) return { decision: 'allow', remaining: UNLIMITED };

  const projected = used + additional;
  if (projected > limit) return { decision: 'deny', limit };

  const fractionUsed = limit === 0 ? 1 : projected / limit;
  return fractionUsed >= WARN_AT_FRACTION
    ? { decision: 'warn', remaining: limit - projected, fractionUsed }
    : { decision: 'allow', remaining: limit - projected };
}

/** A flag entitlement: included at all, or not. */
export function isIncluded(entitlements: Entitlements, key: EntitlementKey): boolean {
  const limit = entitlements[key];
  return limit === UNLIMITED || limit > 0;
}

/**
 * Whether a subscription currently entitles anyone to anything.
 *
 * A trial does. So does a grace window after a failed payment — that window
 * exists precisely so a household keeps working while they fix a card.
 */
export function isEntitled(status: Subscription['status']): boolean {
  switch (status) {
    case 'trialing':
    case 'active':
    case 'past_due':
    case 'grace':
      return true;
    case 'canceled':
    case 'expired':
      return false;
  }
}
