import type { BillingEvent } from './types.js';

/**
 * Idempotent webhook handling.
 *
 * A payment processor will deliver the same event twice. That is normal
 * operation — a retry after a slow response, a redelivery after an outage — and
 * a handler that treats it as exceptional will, on one of those days, extend a
 * subscription twice or refund a customer who was already refunded.
 *
 * The protocol is: **claim the event id first, then act.** Claiming is a unique
 * insert, so the second delivery loses the race in the database rather than in a
 * check-then-write window that two workers can both pass. Only the claimant runs
 * the effect.
 *
 * A failed effect releases the claim, because a retry of a genuine failure must
 * be allowed to succeed. That is the one case where "already seen" would be the
 * wrong answer.
 */

export type ProcessOutcome = 'applied' | 'duplicate' | 'ignored' | 'failed';

export interface EventStore {
  /** True when this call claimed the id; false when it was already recorded. */
  claim(provider: string, eventId: string, event: BillingEvent): Promise<boolean>;
  markProcessed(provider: string, eventId: string, outcome: ProcessOutcome): Promise<void>;
  /** Frees the id so a genuine failure can be retried. */
  release(provider: string, eventId: string): Promise<void>;
}

/**
 * Runs `apply` at most once for a given provider event.
 *
 * `apply` returns whether it did anything. An event this system does not act on
 * is still recorded — the log of what a processor sent is the first place a
 * billing dispute gets investigated.
 */
export async function processEvent(
  store: EventStore,
  event: BillingEvent,
  apply: (event: BillingEvent) => Promise<boolean>,
): Promise<ProcessOutcome> {
  const claimed = await store.claim(event.provider, event.id, event);
  if (!claimed) return 'duplicate';

  try {
    const acted = await apply(event);
    const outcome: ProcessOutcome = acted ? 'applied' : 'ignored';
    await store.markProcessed(event.provider, event.id, outcome);
    return outcome;
  } catch {
    // Released rather than marked failed: the next delivery is the retry, and a
    // permanently claimed id would make the retry a silent no-op.
    await store.release(event.provider, event.id);
    return 'failed';
  }
}

/** In-memory store, for tests and for a development environment with no processor. */
export class InMemoryEventStore implements EventStore {
  readonly #seen = new Map<string, ProcessOutcome | 'claimed'>();

  claim(provider: string, eventId: string): Promise<boolean> {
    const key = `${provider}:${eventId}`;
    if (this.#seen.has(key)) return Promise.resolve(false);
    this.#seen.set(key, 'claimed');
    return Promise.resolve(true);
  }

  markProcessed(provider: string, eventId: string, outcome: ProcessOutcome): Promise<void> {
    this.#seen.set(`${provider}:${eventId}`, outcome);
    return Promise.resolve();
  }

  release(provider: string, eventId: string): Promise<void> {
    this.#seen.delete(`${provider}:${eventId}`);
    return Promise.resolve();
  }

  outcomeOf(provider: string, eventId: string): ProcessOutcome | 'claimed' | undefined {
    return this.#seen.get(`${provider}:${eventId}`);
  }
}
