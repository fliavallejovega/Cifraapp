/*
 * The service worker, kept deliberately small.
 *
 * What it caches: the app's static assets — hashed bundles under /_next/static
 * and the icons. Immutable by construction, so cache-first is safe forever.
 *
 * What it will NEVER cache: pages, server actions or API responses. Every one
 * of them carries somebody's financial position, and a stale balance served
 * from a cache is worse than an error — it is a wrong number wearing the
 * interface of a right one. Offline, this app says it is offline.
 */

const STATIC_CACHE = 'norte-static-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Old static caches die on version bump; nothing else is ours to touch.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('norte-') && key !== STATIC_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/'));

  if (event.request.method !== 'GET' || !isStaticAsset) {
    // The network owns everything that could be money.
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const hit = await cache.match(event.request);
      if (hit) return hit;

      const response = await fetch(event.request);
      if (response.ok) {
        await cache.put(event.request, response.clone());
      }
      return response;
    })(),
  );
});
