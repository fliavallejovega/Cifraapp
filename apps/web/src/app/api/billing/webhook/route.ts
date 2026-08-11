import {
  NullBillingProvider,
  StripeProvider,
  processEvent,
  type BillingProvider,
  type EventStore,
} from '@app/billing';
import { getAdminDb } from '@app/database';
import { billingEvents, subscriptions } from '@app/database/schema';
import { getServerEnv } from '@app/validation/env';
import { and, eq, sql } from 'drizzle-orm';

/**
 * The payment processor's webhook.
 *
 * This endpoint is a public URL that changes what customers are entitled to, so
 * the order of operations is not negotiable:
 *
 *   1. **Verify the signature.** Before parsing, before reading, before
 *      anything. Without it, anyone who guesses the path upgrades themselves.
 *   2. **Claim the event id.** A unique insert, so two concurrent deliveries
 *      race in Postgres rather than in a check-then-write window both can pass.
 *   3. **Then act**, exactly once.
 *
 * It runs with the service role because a webhook has no user session, and
 * because a subscription is deliberately not writable by the household it
 * belongs to — a tenant who can update their own plan code has the product for
 * free. Everything below is scoped by the processor's own references, which is
 * this file's own responsibility rather than row-level security's.
 */

export const dynamic = 'force-dynamic';

function buildProvider(): BillingProvider {
  const env = getServerEnv();

  if (env.BILLING_PROVIDER === 'stripe' && env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) {
    return new StripeProvider({
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      priceIds: {},
    });
  }

  return new NullBillingProvider();
}

export async function POST(request: Request): Promise<Response> {
  const provider = buildProvider();
  const signature = request.headers.get('stripe-signature') ?? '';
  const payload = await request.text();

  const parsed = provider.parseWebhook(payload, signature);

  if (!parsed.ok) {
    // 400 for a bad signature, so a misconfigured processor retries and a
    // forged request gets nothing. The body says nothing useful to an attacker.
    const status = parsed.error.kind === 'not_configured' ? 501 : 400;
    return new Response(null, { status });
  }

  const event = parsed.value;
  const db = getAdminDb(getServerEnv().DIRECT_URL);

  const store: EventStore = {
    async claim(providerId, eventId, claimed) {
      const inserted = await db
        .insert(billingEvents)
        .values({
          provider: providerId,
          eventId,
          eventType: claimed.type,
          payload: claimed.raw,
        })
        .onConflictDoNothing({ target: [billingEvents.provider, billingEvents.eventId] })
        .returning({ id: billingEvents.id });

      return inserted.length > 0;
    },

    async markProcessed(providerId, eventId, outcome) {
      await db
        .update(billingEvents)
        .set({ processedAt: sql`now()`, outcome })
        .where(and(eq(billingEvents.provider, providerId), eq(billingEvents.eventId, eventId)));
    },

    async release(providerId, eventId) {
      await db
        .delete(billingEvents)
        .where(and(eq(billingEvents.provider, providerId), eq(billingEvents.eventId, eventId)));
    },
  };

  const outcome = await processEvent(store, event, async (accepted) => {
    if (!accepted.subscriptionRef) return false;

    switch (accepted.type) {
      case 'payment_failed':
        // Past due, not cancelled. The grace window is what stops a flagged
        // foreign charge from ending a subscription.
        await db
          .update(subscriptions)
          .set({ status: 'past_due' })
          .where(eq(subscriptions.providerSubscriptionRef, accepted.subscriptionRef));
        return true;

      case 'payment_succeeded':
        await db
          .update(subscriptions)
          .set({ status: 'active', graceEndsOn: null })
          .where(eq(subscriptions.providerSubscriptionRef, accepted.subscriptionRef));
        return true;

      case 'subscription_canceled':
        await db
          .update(subscriptions)
          .set({ status: 'canceled', canceledAt: sql`now()` })
          .where(eq(subscriptions.providerSubscriptionRef, accepted.subscriptionRef));
        return true;

      // Everything else is recorded and not acted on. The log of what a
      // processor sent is the first place a billing dispute is investigated,
      // and an event nobody handles is still evidence.
      case 'checkout_completed':
      case 'subscription_created':
      case 'subscription_updated':
      case 'invoice_finalized':
      case 'refund_issued':
      case 'unknown':
        return false;
    }
  });

  // 200 on a duplicate. A processor told it failed will redeliver forever.
  return Response.json({ outcome }, { status: outcome === 'failed' ? 500 : 200 });
}
