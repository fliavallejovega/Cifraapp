import type { BillingEvent, BillingProvider, BillingResult, CheckoutSession } from '../types.js';

/**
 * The provider used when no processor is configured.
 *
 * Every deployment of this product starts here, and most development happens
 * here. Billing being switched off has to be an ordinary state that the
 * entitlement layer handles — a household with no subscription row gets the free
 * plan's entitlements and the product works.
 */
export class NullBillingProvider implements BillingProvider {
  readonly id = 'none';

  createCheckout(): Promise<BillingResult<CheckoutSession>> {
    return Promise.resolve({ ok: false, error: { kind: 'not_configured' } });
  }

  cancel(): Promise<BillingResult<void>> {
    return Promise.resolve({ ok: false, error: { kind: 'not_configured' } });
  }

  parseWebhook(): BillingResult<BillingEvent> {
    // A webhook arriving at a deployment with no processor is not a signature
    // problem, it is a misrouted request. Saying so keeps the alert honest.
    return { ok: false, error: { kind: 'not_configured' } };
  }
}
