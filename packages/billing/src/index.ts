export {
  NOTHING,
  UNLIMITED,
  WARN_AT_FRACTION,
  checkEntitlement,
  effectiveEntitlements,
  isEntitled,
  isIncluded,
  type EntitlementVerdict,
} from './entitlements.js';

export { FREE_ENTITLEMENTS, SEED_PLANS, seedPlan } from './plans.js';

export { daysInPeriod, prorate, type Proration, type ProrationInput } from './proration.js';

export { NullBillingProvider } from './providers/none.js';
export {
  SIGNATURE_TOLERANCE_SECONDS,
  StripeProvider,
  signPayload,
  verifySignature,
  type StripeOptions,
} from './providers/stripe.js';

export {
  InMemoryEventStore,
  processEvent,
  type EventStore,
  type ProcessOutcome,
} from './webhooks.js';

export type {
  BillingEvent,
  BillingEventType,
  BillingFailure,
  BillingInterval,
  BillingProvider,
  BillingResult,
  CheckoutRequest,
  CheckoutSession,
  EntitlementKey,
  EntitlementLimit,
  Entitlements,
  Plan,
  PlanCode,
  Subscription,
  SubscriptionStatus,
} from './types.js';
