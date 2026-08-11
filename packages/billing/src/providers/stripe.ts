import { createHmac, timingSafeEqual } from 'node:crypto';

import { Money, type CurrencyCode } from '@app/domain';

import type {
  BillingEvent,
  BillingEventType,
  BillingProvider,
  BillingResult,
  CheckoutRequest,
  CheckoutSession,
} from '../types.js';

/**
 * Stripe, behind the seam.
 *
 * Nothing outside this file knows the word "Stripe". The domain model carries no
 * Stripe identifiers, which is what makes it possible to answer "what may this
 * household do" from the database alone while the processor is unreachable.
 *
 * Signature verification is the security boundary and it is done here, first.
 * A webhook endpoint is a public URL that grants subscriptions; without the
 * signature check, anyone who guesses the path can upgrade themselves. The
 * comparison is constant-time and the timestamp is checked, because a valid old
 * signature replayed later is still a replay.
 */

const DEFAULT_ENDPOINT = 'https://api.stripe.com/v1';

/** Five minutes, matching Stripe's own guidance. Older payloads are refused. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const EVENT_TYPES: Readonly<Record<string, BillingEventType>> = {
  'checkout.session.completed': 'checkout_completed',
  'customer.subscription.created': 'subscription_created',
  'customer.subscription.updated': 'subscription_updated',
  'customer.subscription.deleted': 'subscription_canceled',
  'invoice.payment_succeeded': 'payment_succeeded',
  'invoice.payment_failed': 'payment_failed',
  'invoice.finalized': 'invoice_finalized',
  'charge.refunded': 'refund_issued',
};

export interface StripeOptions {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly endpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  /** Maps a plan code to the price identifier configured in the dashboard. */
  readonly priceIds: Readonly<Record<string, string>>;
}

export class StripeProvider implements BillingProvider {
  readonly id = 'stripe';

  readonly #secretKey: string;
  readonly #webhookSecret: string;
  readonly #endpoint: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => number;
  readonly #priceIds: Readonly<Record<string, string>>;

  constructor(options: StripeOptions) {
    this.#secretKey = options.secretKey;
    this.#webhookSecret = options.webhookSecret;
    this.#endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? (() => Date.now());
    this.#priceIds = options.priceIds;
  }

  async createCheckout(request: CheckoutRequest): Promise<BillingResult<CheckoutSession>> {
    const price = this.#priceIds[request.planCode];
    if (!price) {
      return { ok: false, error: { kind: 'not_configured' } };
    }

    const body = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      customer_email: request.customerEmail,
      // Carried back on the webhook. The processor holds no opinion about which
      // household this is; we do, and this is how the answer survives the trip.
      'metadata[household_id]': request.householdId,
      'metadata[plan_code]': request.planCode,
    });

    try {
      const response = await this.#fetch(`${this.#endpoint}/checkout/sessions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
      });

      if (!response.ok) {
        return {
          ok: false,
          error: {
            kind: 'transport',
            status: response.status,
            message: `Stripe returned ${String(response.status)}.`,
          },
        };
      }

      const payload = (await response.json()) as { url?: unknown; id?: unknown };
      if (typeof payload.url !== 'string' || typeof payload.id !== 'string') {
        return { ok: false, error: { kind: 'malformed_payload', reason: 'No checkout URL.' } };
      }

      return { ok: true, value: { url: payload.url, reference: payload.id } };
    } catch (cause) {
      return {
        ok: false,
        error: {
          kind: 'transport',
          status: null,
          message: cause instanceof Error ? cause.name : 'Request failed.',
        },
      };
    }
  }

  async cancel(
    subscriptionRef: string,
    options: { immediately: boolean },
  ): Promise<BillingResult<void>> {
    // Cancelling at period end is the default, because a household that paid for
    // this month keeps this month. Immediate cancellation is a support action.
    const url = `${this.#endpoint}/subscriptions/${subscriptionRef}`;

    try {
      const response = await this.#fetch(url, {
        method: options.immediately ? 'DELETE' : 'POST',
        headers: {
          authorization: `Bearer ${this.#secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        ...(options.immediately
          ? {}
          : { body: new URLSearchParams({ cancel_at_period_end: 'true' }) }),
      });

      return response.ok
        ? { ok: true, value: undefined }
        : {
            ok: false,
            error: {
              kind: 'transport',
              status: response.status,
              message: `Stripe returned ${String(response.status)}.`,
            },
          };
    } catch (cause) {
      return {
        ok: false,
        error: {
          kind: 'transport',
          status: null,
          message: cause instanceof Error ? cause.name : 'Request failed.',
        },
      };
    }
  }

  parseWebhook(payload: string, signature: string): BillingResult<BillingEvent> {
    const verified = verifySignature(payload, signature, this.#webhookSecret, this.#now());
    if (!verified) return { ok: false, error: { kind: 'signature_invalid' } };

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return { ok: false, error: { kind: 'malformed_payload', reason: 'Body was not JSON.' } };
    }

    const body = parsed as {
      id?: unknown;
      type?: unknown;
      created?: unknown;
      data?: { object?: Record<string, unknown> };
    };

    if (typeof body.id !== 'string' || typeof body.type !== 'string') {
      return { ok: false, error: { kind: 'malformed_payload', reason: 'No event id or type.' } };
    }

    const object = body.data?.object ?? {};

    return {
      ok: true,
      value: {
        id: body.id,
        provider: this.id,
        type: EVENT_TYPES[body.type] ?? 'unknown',
        occurredAt: new Date(
          typeof body.created === 'number' ? body.created * 1000 : this.#now(),
        ).toISOString(),
        subscriptionRef: asString(object['subscription']) ?? asString(object['id']),
        customerRef: asString(object['customer']),
        amount: readAmount(object),
        raw: parsed,
      },
    };
  }
}

/**
 * Constant-time verification of a `Stripe-Signature` header.
 *
 * The header is `t=<unix seconds>,v1=<hex>`, and the signed payload is
 * `${t}.${body}`. Both halves matter: without the timestamp in the digest, a
 * captured request could be replayed forever, and without the tolerance check
 * the timestamp in the digest would prove nothing.
 */
export function verifySignature(
  payload: string,
  header: string,
  secret: string,
  nowMs: number,
): boolean {
  const parts = new Map(
    header
      .split(',')
      .map((part) => part.trim().split('='))
      .filter((pair): pair is [string, string] => pair.length === 2),
  );

  const timestamp = parts.get('t');
  const provided = parts.get('v1');
  if (!timestamp || !provided) return false;

  const ageSeconds = Math.abs(nowMs / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Builds the header a webhook would carry. Test-only, and the reason it is exported. */
export function signPayload(payload: string, secret: string, timestampSeconds: number): string {
  const signature = createHmac('sha256', secret)
    .update(`${String(timestampSeconds)}.${payload}`)
    .digest('hex');

  return `t=${String(timestampSeconds)},v1=${signature}`;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The amount on an event, in whole currency units.
 *
 * Stripe reports minor units — 1999 for $19.99 — and `fromMinorUnits` is the
 * only correct way in. Dividing by 100 in JavaScript is where a billing figure
 * stops being exact.
 */
function readAmount(object: Record<string, unknown>): Money | null {
  const raw = object['amount_paid'] ?? object['amount_total'] ?? object['amount'];
  const currency = object['currency'];

  if (typeof raw !== 'number' || typeof currency !== 'string') return null;

  return Money.fromMinorUnits(raw, currency.toUpperCase() as CurrencyCode);
}
