import type { Money, PlainDate } from '@app/domain';

/**
 * Subscriptions that never double-charge.
 *
 * Two rules shape everything here.
 *
 * **Entitlements, not plan checks.** There is no `PlanCode` comparison anywhere
 * in this package's logic, and none should exist in the application either. A
 * feature asks "may this household import another document" and gets an answer
 * derived from limits — so granting one customer an exception, running a
 * promotion, or adding a plan is a row, not a deployment. `if (plan === 'pro')`
 * is the line that has to be found in eleven files the day pricing changes.
 *
 * **Webhooks are idempotent.** A payment processor will deliver the same event
 * twice; that is normal operation, not a fault. Replaying one must be a no-op,
 * and the only reliable way to guarantee it is to record the provider's event id
 * before acting and refuse a second attempt on the same id.
 */

export type PlanCode = 'FREE' | 'PLUS' | 'COUPLE' | 'PRO' | 'FAMILY' | 'ACCOUNTANT' | 'WHITE_LABEL';

export type BillingInterval = 'month' | 'year';

/**
 * What a plan allows.
 *
 * Every entitlement is a number or a flag, never a plan name. Adding a plan
 * means adding rows; changing what a plan allows means changing rows.
 */
export type EntitlementKey =
  | 'transactions_per_month'
  | 'household_members'
  | 'document_imports'
  | 'rules'
  | 'goals'
  | 'reports'
  | 'tax_engine'
  | 'accountant_mode'
  | 'white_label'
  | 'ai_usage';

/** `null` is unlimited. Zero is "not included", which is a different thing. */
export type EntitlementLimit = number | null;

export type Entitlements = Readonly<Record<EntitlementKey, EntitlementLimit>>;

export interface Plan {
  readonly code: PlanCode;
  readonly name: string;
  /** Read from the database. Pricing never lives in a component. */
  readonly price: Money;
  readonly interval: BillingInterval;
  readonly isActive: boolean;
  readonly entitlements: Entitlements;
}

/**
 * Where a subscription is in its life.
 *
 * `past_due` and `grace` are separate on purpose. A failed payment does not end
 * a subscription — it starts a window in which the household keeps working while
 * they fix a card, and cutting access on the first decline loses customers whose
 * bank simply flagged a foreign charge.
 */
export type SubscriptionStatus =
  'trialing' | 'active' | 'past_due' | 'grace' | 'canceled' | 'expired';

export interface Subscription {
  readonly id: string;
  readonly householdId: string;
  readonly planCode: PlanCode;
  readonly status: SubscriptionStatus;
  readonly currentPeriodStart: PlainDate;
  readonly currentPeriodEnd: PlainDate;
  readonly trialEndsOn: PlainDate | null;
  /** Set when the household asked to stop; access continues until the period ends. */
  readonly cancelAt: PlainDate | null;
  readonly graceEndsOn: PlainDate | null;
  /** Per-household exceptions. A support grant is a row, not a code change. */
  readonly overrides: Partial<Entitlements>;
}

/** What a provider tells us happened. Provider-specific shapes never get past the adapter. */
export type BillingEventType =
  | 'checkout_completed'
  | 'subscription_created'
  | 'subscription_updated'
  | 'subscription_canceled'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'invoice_finalized'
  | 'refund_issued'
  | 'unknown';

export interface BillingEvent {
  /** The provider's own id. The idempotency key, and the reason replay is safe. */
  readonly id: string;
  readonly provider: string;
  readonly type: BillingEventType;
  readonly occurredAt: string;
  readonly subscriptionRef: string | null;
  readonly customerRef: string | null;
  readonly amount: Money | null;
  /** The untouched payload, for a support question six months from now. */
  readonly raw: unknown;
}

export type BillingFailure =
  | { readonly kind: 'not_configured' }
  | { readonly kind: 'signature_invalid' }
  | { readonly kind: 'malformed_payload'; readonly reason: string }
  | { readonly kind: 'transport'; readonly status: number | null; readonly message: string };

export interface CheckoutRequest {
  readonly householdId: string;
  readonly planCode: PlanCode;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly customerEmail: string;
}

export interface CheckoutSession {
  readonly url: string;
  readonly reference: string;
}

/**
 * The provider seam.
 *
 * Stripe is behind this and nothing else knows its name. The domain model has no
 * Stripe identifiers on it, which is what makes it possible to answer "what does
 * this household have access to" from the database alone when the processor is
 * unreachable.
 */
export interface BillingProvider {
  readonly id: string;
  createCheckout(request: CheckoutRequest): Promise<BillingResult<CheckoutSession>>;
  cancel(subscriptionRef: string, options: { immediately: boolean }): Promise<BillingResult<void>>;
  /** Verifies the signature and translates the payload. Never trusts either. */
  parseWebhook(payload: string, signature: string): BillingResult<BillingEvent>;
}

export type BillingResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: BillingFailure };
