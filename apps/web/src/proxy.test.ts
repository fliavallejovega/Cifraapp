import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PROTECTED_SEGMENTS } from './product-routes';

/**
 * Every product route is guarded before it renders.
 *
 * The guard in `proxy.ts` is a hand-written list, and a hand-written list of
 * routes decays the moment somebody adds one — which is exactly what happened
 * between the first six screens and the forty-three that followed. Each page
 * calls `requireHousehold` itself, so the decay exposed nothing; what it cost
 * was the redirect happening before a page renders rather than inside it.
 *
 * This test reads the route directory instead of trusting the list, so a screen
 * added tomorrow fails here rather than shipping unguarded by omission.
 */

const PRODUCT_ROUTES = join(import.meta.dirname, 'app', '[locale]', '(product)');

/** Top-level segments under the product route group, as URL paths. */
function productSegments(): string[] {
  return (
    readdirSync(PRODUCT_ROUTES)
      .filter((entry) => statSync(join(PRODUCT_ROUTES, entry)).isDirectory())
      // A dynamic segment is reached through its parent, which is in the list.
      .filter((entry) => !entry.startsWith('[') && !entry.startsWith('('))
      .map((entry) => `/${entry}`)
  );
}

describe('the product guard', () => {
  it('names every screen under the product route group', () => {
    const missing = productSegments().filter((segment) => !PROTECTED_SEGMENTS.includes(segment));

    expect(missing).toEqual([]);
  });

  it('names nothing that is not a route', () => {
    // `/welcome` is the one deliberate exception: it lives outside the product
    // route group because it renders before a household exists.
    const routes = new Set([...productSegments(), '/welcome']);
    const stale = PROTECTED_SEGMENTS.filter((segment) => !routes.has(segment));

    expect(stale).toEqual([]);
  });
});
