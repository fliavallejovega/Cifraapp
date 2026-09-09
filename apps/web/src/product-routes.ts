/**
 * Which routes belong to the product, as data.
 *
 * Separate from `proxy.ts` so it can be read by a test without pulling the
 * middleware — and because a list of routes is data, not behaviour.
 *
 * Everything named here requires a session before the page renders. Everything
 * else is public.
 *
 * The list is the guard, and it decayed exactly the way the proxy's own comment
 * warned it would: it still named `/money` and `/transactions`, which no longer
 * exist, and it named none of the twenty-five screens added since. Every page
 * calls `requireHousehold` itself, so nothing was ever exposed — but the point
 * of guarding here is that the redirect happens before a page renders, and a
 * segment missing from this list gives that up silently.
 *
 * It is now the whole product surface, in the order the navigation shows it.
 */
export const PROTECTED_SEGMENTS = [
  '/overview',
  '/welcome',
  '/accounts',
  '/cards',
  '/movements',

  '/commitments',
  '/debts',
  '/goals',
  '/income',
  '/budgets',

  '/documents',
  '/review',
  '/merchants',

  '/plan',
  '/advice',
  '/alerts',
  '/debt-simulator',
  '/scenarios',
  '/projection',
  '/investments',
  '/chat',

  '/reports',
  '/close',
  '/exports',

  '/people',
  '/categories',
  '/rules',
  '/access',
  '/tax',
  '/notifications',
  '/subscription',
  '/settings',
  '/households',
];
