'use server';

import {
  NullBillingProvider,
  StripeProvider,
  type BillingProvider,
  type PlanCode,
} from '@app/billing';
import { getServerEnv } from '@app/validation/env';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requestAppOrigin } from './app-origin';
import { localeOf } from './revalidate';
import { loadSession } from './session';
import type { RecordActionResult } from '@/components/records/spec';

/**
 * Paying for this.
 *
 * The provider is built from the environment and is a null object when nothing
 * is configured — which is the state of most deployments of this product, and
 * has to read as a state of the world rather than as a crash. `checkoutIsReady`
 * is what the screen asks before offering a button that would go nowhere.
 *
 * Nothing here writes a subscription. The webhook does, with the service role,
 * after verifying a signature — because a tenant who can update their own plan
 * code has the product for free.
 */

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

/**
 * Whether this deployment can take a payment at all.
 *
 * Async because every export of a `'use server'` module has to be — the value
 * itself is a synchronous read of validated configuration.
 */
export async function checkoutIsReady(): Promise<boolean> {
  const env = getServerEnv();
  return Promise.resolve(
    env.BILLING_PROVIDER === 'stripe' &&
      Boolean(env.STRIPE_SECRET_KEY) &&
      Boolean(env.STRIPE_WEBHOOK_SECRET),
  );
}

export async function startCheckout(
  _previous: RecordActionResult,
  formData: FormData,
): Promise<RecordActionResult> {
  const session = await loadSession();
  if (!session?.activeHouseholdId) return { error: 'signInRequired' };

  // The codes the billing package knows about. A plan row could name anything;
  // checkout may only be started for one the provider can price.
  const planCode = z
    .enum(['PLUS', 'COUPLE', 'PRO', 'FAMILY', 'ACCOUNTANT', 'WHITE_LABEL'] as const)
    .safeParse(formData.get('planCode'));
  if (!planCode.success) return { error: 'notFound' };

  if (!(await checkoutIsReady())) return { error: 'checkoutUnavailable' };

  const householdId = session.activeHouseholdId;
  const locale = localeOf(formData);
  const origin = await requestAppOrigin();

  const result = await buildProvider().createCheckout({
    householdId,
    planCode: planCode.data satisfies PlanCode,
    successUrl: `${origin}/${locale}/subscription?checkout=done`,
    cancelUrl: `${origin}/${locale}/subscription`,
    customerEmail: session.profile.email,
  });

  if (!result.ok) return { error: 'checkoutFailed' };

  redirect(result.value.url);
}
