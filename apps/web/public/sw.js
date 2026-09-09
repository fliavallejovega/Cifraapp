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

/*
 * Push.
 *
 * El sobre viene cifrado de punta a punta: el servicio que lo transportó no
 * pudo leerlo, y aquí se abre por primera vez. Por eso el cuerpo se trata como
 * lo que es —un JSON del propio servidor— y aun así se lee con cuidado: un
 * mensaje mal formado no debe dejar al service worker en un estado del que solo
 * salga reinstalando la aplicación.
 *
 * Lo que NUNCA lleva: una cifra que no se pueda decir en una pantalla de
 * bloqueo. Un aviso es «hoy vencen cuatro pagos», no el saldo de nadie.
 */
self.addEventListener('push', (event) => {
  let data = { title: 'Cifra', body: '', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Sin cuerpo legible se muestra el aviso genérico: haber recibido algo ya
    // es información, y callarse sería peor que decir poco.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Un mismo asunto reemplaza al anterior en vez de apilarse: tres avisos
      // del mismo pago en la bandeja son la forma más rápida de que alguien
      // apague los avisos.
      tag: data.url,
      data: { url: data.url },
    }),
  );
});

/*
 * Y al tocarla, llevar a donde el aviso prometía.
 *
 * Si la aplicación ya está abierta se la enfoca en vez de abrir otra pestaña:
 * dos copias de una aplicación financiera son dos estados que pueden discrepar.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
