import { Money, type PlainDate } from '@app/domain';
import { describe, expect, it, vi } from 'vitest';

import { checkEntitlement, effectiveEntitlements, isEntitled, isIncluded } from './entitlements.js';
import { FREE_ENTITLEMENTS, SEED_PLANS, seedPlan } from './plans.js';
import { daysInPeriod, prorate } from './proration.js';
import { NullBillingProvider } from './providers/none.js';
import { StripeProvider, signPayload, verifySignature } from './providers/stripe.js';
import { InMemoryEventStore, processEvent } from './webhooks.js';
import type { BillingEvent, Subscription } from './types.js';

const usd = (value: string) => Money.fromDecimalString(value, 'USD');

const PRO = seedPlan('PRO');

const SUBSCRIPTION: Subscription = {
  id: 's1',
  householdId: 'h1',
  planCode: 'PRO',
  status: 'active',
  currentPeriodStart: '2026-08-01' as PlainDate,
  currentPeriodEnd: '2026-08-31' as PlainDate,
  trialEndsOn: null,
  cancelAt: null,
  graceEndsOn: null,
  overrides: {},
};

describe('entitlements', () => {
  it('answers without anyone naming a plan', () => {
    const entitlements = effectiveEntitlements(SUBSCRIPTION, PRO!.entitlements, FREE_ENTITLEMENTS);

    expect(checkEntitlement(entitlements, 'document_imports', 900).decision).toBe('allow');
    expect(isIncluded(entitlements, 'tax_engine')).toBe(true);
    expect(isIncluded(entitlements, 'white_label')).toBe(false);
  });

  it('denies past a limit', () => {
    const verdict = checkEntitlement(FREE_ENTITLEMENTS, 'document_imports', 3);

    expect(verdict.decision).toBe('deny');
    if (verdict.decision === 'deny') expect(verdict.limit).toBe(3);
  });

  it('warns before the wall rather than after it', () => {
    // A household that discovers a limit by hitting it has been failed twice.
    const verdict = checkEntitlement(FREE_ENTITLEMENTS, 'goals', 1);

    expect(verdict.decision).toBe('warn');
    if (verdict.decision === 'warn') expect(verdict.remaining).toBe(0);
  });

  it('treats unlimited as unlimited', () => {
    const entitlements = effectiveEntitlements(SUBSCRIPTION, PRO!.entitlements, FREE_ENTITLEMENTS);
    const verdict = checkEntitlement(entitlements, 'transactions_per_month', 5_000_000);

    expect(verdict.decision).toBe('allow');
    if (verdict.decision === 'allow') expect(verdict.remaining).toBeNull();
  });

  it('lets an override raise a limit for one household', () => {
    const entitlements = effectiveEntitlements(
      { ...SUBSCRIPTION, overrides: { document_imports: 500 } },
      FREE_ENTITLEMENTS,
      FREE_ENTITLEMENTS,
    );

    expect(checkEntitlement(entitlements, 'document_imports', 100).decision).toBe('allow');
  });

  it('lets an override lower one too', () => {
    // Support needs both directions. An override that could only raise a limit
    // leaves no way to contain an abusive account short of cancelling it.
    const entitlements = effectiveEntitlements(
      { ...SUBSCRIPTION, overrides: { document_imports: 1 } },
      PRO!.entitlements,
      FREE_ENTITLEMENTS,
    );

    expect(checkEntitlement(entitlements, 'document_imports', 1).decision).toBe('deny');
  });

  it('drops an expired subscription to free rather than to nothing', () => {
    const entitlements = effectiveEntitlements(
      { ...SUBSCRIPTION, status: 'expired' },
      PRO!.entitlements,
      FREE_ENTITLEMENTS,
    );

    // Locking a household out of their own history because a card expired is not
    // a decision anyone would defend out loud.
    expect(checkEntitlement(entitlements, 'reports', 0).decision).toBe('allow');
    expect(isIncluded(entitlements, 'tax_engine')).toBe(false);
  });

  it('keeps a household working through a failed payment', () => {
    expect(isEntitled('past_due')).toBe(true);
    expect(isEntitled('grace')).toBe(true);
    expect(isEntitled('trialing')).toBe(true);
    expect(isEntitled('expired')).toBe(false);
  });

  it('seeds every plan with a complete entitlement set', () => {
    for (const plan of SEED_PLANS) {
      expect(Object.keys(plan.entitlements)).toHaveLength(Object.keys(FREE_ENTITLEMENTS).length);
    }
  });
});

describe('proration', () => {
  it('credits the unused part of the old plan and charges the rest of the new one', () => {
    const result = prorate({
      from: usd('9.99'),
      to: usd('29.99'),
      daysElapsed: 20,
      daysInPeriod: 30,
    });

    // A third of each plan remains. $29.99 does not divide by three, and the
    // fourth decimal is where that shows — which is exactly why the split is an
    // allocation rather than a rate multiplied back.
    expect(result.credit.toDecimalString()).toBe('3.3300');
    expect(result.charge.toDecimalString()).toBe('9.9967');
    expect(result.net.toDecimalString()).toBe('6.6667');
  });

  it('loses nothing to rounding', () => {
    // The guarantee Money.allocate exists for: the two shares are the whole
    // amount, always, whatever the split.
    for (let elapsed = 0; elapsed <= 30; elapsed += 1) {
      const result = prorate({
        from: usd('9.99'),
        to: usd('9.99'),
        daysElapsed: elapsed,
        daysInPeriod: 30,
      });
      expect(result.net.isZero()).toBe(true);
    }
  });

  it('charges nothing when the period is already over', () => {
    const result = prorate({
      from: usd('9.99'),
      to: usd('29.99'),
      daysElapsed: 30,
      daysInPeriod: 30,
    });

    expect(result.net.isZero()).toBe(true);
  });

  it('counts the days in a period', () => {
    expect(daysInPeriod('2026-08-01', '2026-08-31')).toBe(30);
    expect(daysInPeriod('2026-08-01', '2026-09-01')).toBe(31);
    expect(daysInPeriod('nonsense', '2026-09-01')).toBe(0);
  });
});

const EVENT: BillingEvent = {
  id: 'evt_1',
  provider: 'stripe',
  type: 'payment_succeeded',
  occurredAt: '2026-08-11T00:00:00.000Z',
  subscriptionRef: 'sub_1',
  customerRef: 'cus_1',
  amount: usd('29.99'),
  raw: {},
};

describe('webhook idempotency', () => {
  it('applies an event once', async () => {
    const store = new InMemoryEventStore();
    const apply = vi.fn().mockResolvedValue(true);

    expect(await processEvent(store, EVENT, apply)).toBe('applied');
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('makes a redelivery a no-op', async () => {
    // A processor delivering the same event twice is normal operation. Charging
    // or extending twice is not.
    const store = new InMemoryEventStore();
    const apply = vi.fn().mockResolvedValue(true);

    await processEvent(store, EVENT, apply);
    expect(await processEvent(store, EVENT, apply)).toBe('duplicate');
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('records an event it chose not to act on', async () => {
    const store = new InMemoryEventStore();

    expect(await processEvent(store, EVENT, () => Promise.resolve(false))).toBe('ignored');
    expect(store.outcomeOf('stripe', 'evt_1')).toBe('ignored');
  });

  it('lets a genuine failure be retried', async () => {
    const store = new InMemoryEventStore();
    const failing = vi.fn().mockRejectedValue(new Error('database unavailable'));

    expect(await processEvent(store, EVENT, failing)).toBe('failed');

    // The claim is released, so the processor's retry is the retry.
    const succeeding = vi.fn().mockResolvedValue(true);
    expect(await processEvent(store, EVENT, succeeding)).toBe('applied');
    expect(succeeding).toHaveBeenCalledTimes(1);
  });
});

describe('stripe adapter', () => {
  const secret = 'whsec_test';
  const nowSeconds = 1_800_000_000;
  const provider = new StripeProvider({
    secretKey: 'sk_test',
    webhookSecret: secret,
    priceIds: { PRO: 'price_pro' },
    now: () => nowSeconds * 1000,
  });

  const payload = JSON.stringify({
    id: 'evt_2',
    type: 'invoice.payment_succeeded',
    created: nowSeconds,
    data: {
      object: { subscription: 'sub_9', customer: 'cus_9', amount_paid: 2999, currency: 'usd' },
    },
  });

  it('accepts a correctly signed payload', () => {
    const result = provider.parseWebhook(payload, signPayload(payload, secret, nowSeconds));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('evt_2');
      expect(result.value.type).toBe('payment_succeeded');
      expect(result.value.subscriptionRef).toBe('sub_9');
      // Stripe reports minor units. Dividing by 100 in JavaScript is where a
      // billing figure stops being exact.
      expect(result.value.amount?.toDecimalString()).toBe('29.9900');
    }
  });

  it('refuses a payload signed with the wrong secret', () => {
    const result = provider.parseWebhook(payload, signPayload(payload, 'whsec_other', nowSeconds));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('signature_invalid');
  });

  it('refuses a tampered body', () => {
    const signature = signPayload(payload, secret, nowSeconds);
    const tampered = payload.replace('2999', '1');

    expect(provider.parseWebhook(tampered, signature).ok).toBe(false);
  });

  it('refuses a replayed signature from last week', () => {
    const old = nowSeconds - 60 * 60 * 24 * 7;
    const result = provider.parseWebhook(payload, signPayload(payload, secret, old));

    expect(result.ok).toBe(false);
  });

  it('refuses a header with no signature in it', () => {
    expect(verifySignature(payload, 't=123', secret, nowSeconds * 1000)).toBe(false);
    expect(verifySignature(payload, '', secret, nowSeconds * 1000)).toBe(false);
  });

  it('reports an unmapped event type rather than guessing', () => {
    const other = JSON.stringify({
      id: 'evt_3',
      type: 'radar.early_fraud_warning.created',
      created: nowSeconds,
    });
    const result = provider.parseWebhook(other, signPayload(other, secret, nowSeconds));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe('unknown');
  });

  it('will not start a checkout for a plan with no configured price', async () => {
    const result = await provider.createCheckout({
      householdId: 'h1',
      planCode: 'FAMILY',
      successUrl: 'https://example.test/ok',
      cancelUrl: 'https://example.test/no',
      customerEmail: 'someone@example.test',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('not_configured');
  });
});

describe('no processor configured', () => {
  it('is an ordinary state, not a crash', async () => {
    const provider = new NullBillingProvider();

    const checkout = await provider.createCheckout();
    expect(checkout.ok).toBe(false);
    expect(provider.parseWebhook().ok).toBe(false);
  });
});
