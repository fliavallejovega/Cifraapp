'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker once the page is interactive.
 *
 * Render-nothing on purpose: registration is a side effect of being open, not
 * a piece of interface. Failure is silent because the app is complete without
 * it — the worker only accelerates static assets and makes the install prompt
 * eligible; nothing functional depends on its presence.
 */
export function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Production only. The worker serves static assets cache-first, which is
    // safe there because their names carry a content hash — and unsafe in
    // development, where Turbopack reuses chunk names and the worker was
    // caught serving yesterday's stylesheet against today's code.
    // NODE_ENV is inlined by the bundler at build time; it never exists in the
    // browser as an env read, and @app/validation/env is server-side by design.
    // eslint-disable-next-line no-restricted-properties
    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) void registration.unregister();
      });
      return;
    }

    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* The app works identically without it. */
    });
  }, []);

  return null;
}
