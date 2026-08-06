import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

/**
 * Resolves the locale before a page renders: reads the cookie, falls back to
 * `Accept-Language`, then to Spanish, and redirects to the prefixed path.
 */
export default createMiddleware(routing);

export const config = {
  /**
   * Everything except API routes, Next internals and files with an extension.
   * `/api/health` in particular must answer without a locale prefix — a monitor
   * hitting it should not be redirected.
   */
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
