import 'server-only';

/**
 * A short-lived cache for **public** content only.
 *
 * The marketing site reads the same handful of rows — the plan catalogue, the
 * FAQ list, a page body — on every anonymous request. Under any real traffic
 * that is thousands of identical queries a minute against a connection pool
 * sized for a product, and it is what made the end-to-end suite time out the
 * first time it ran several browsers at once.
 *
 * The rule that makes this safe is absolute and is the reason the module is
 * named this way: **nothing tenant-scoped may be cached here.** A cache keyed by
 * a string, in a process shared between requests, is exactly how one household's
 * figures end up on another household's screen. Every read that goes through
 * `withUserContext` is disqualified, without exception — those queries are
 * answered by row-level security, and a cache in front of them answers with
 * whoever asked first.
 *
 * The TTL is short on purpose. Content edited in the database should appear
 * within a minute, which is the difference between a cache and a deployment.
 */

const TTL_MS = 60_000;

interface Entry {
  readonly value: unknown;
  readonly expiresAt: number;
}

const entries = new Map<string, Entry>();

/** In-flight reads, so a cold cache under load produces one query, not fifty. */
const inFlight = new Map<string, Promise<unknown>>();

export async function cachedPublicRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);

  if (hit && hit.expiresAt > now) return hit.value as T;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = read()
    .then((value) => {
      entries.set(key, { value, expiresAt: Date.now() + TTL_MS });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

/** Test and development helper. Clears everything. */
export function clearPublicCache(): void {
  entries.clear();
  inFlight.clear();
}
