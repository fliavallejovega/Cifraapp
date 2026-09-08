import { getClientEnv } from '@app/validation/env';
import { createServerClient } from '@supabase/ssr';
import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { routing } from './i18n/routing';
import { PROTECTED_SEGMENTS } from './product-routes';

/**
 * Runs before a request reaches a route. Next 16 calls this the proxy; it is
 * the file that used to be `middleware.ts`.
 *
 * Two jobs, in order.
 *
 * First, refresh the Supabase session. Access tokens are short-lived, and a
 * Server Component cannot write cookies — so if the refresh does not happen
 * here, a user gets signed out mid-session for no reason they can see.
 *
 * Second, resolve the locale and, if the route is part of the product, send a
 * visitor with no session to sign in before a page renders.
 *
 * **That second job reads the cookie; it does not verify it**, and the
 * distinction is deliberate. `getUser()` validates the token against the auth
 * server, which is a network round trip on *every* navigation — and it was
 * being spent twice, because the page then calls `loadSession`, which verifies
 * again before it reads a single row. Moving between screens cost two auth
 * calls and three database round trips, and it felt like it.
 *
 * So the middleware is now a redirect, not a boundary. Somebody arriving with
 * an edited cookie gets past it and is stopped by the page: `requireHousehold`
 * verifies with the auth server, finds nothing, and sends them to sign in —
 * and row-level security stands behind that. Nothing here decides what data
 * anybody may read.
 *
 * `getSession()` still refreshes an expired token and still writes the new
 * cookies through the handler below, so the reason this file exists survives.
 * The network call now happens when a token actually needs refreshing rather
 * than on every request.
 */

const intlMiddleware = createIntlMiddleware(routing);

function stripLocale(pathname: string): string {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return '/';
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1);
  }
  return pathname;
}

function localeOf(pathname: string): string {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) return locale;
  }
  return routing.defaultLocale;
}

export default async function proxy(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');

  // Supabase sometimes lands PKCE codes on Site URL root instead of /auth/callback
  // when the dashboard Site URL still points at localhost during migration.
  if (code && request.nextUrl.pathname !== '/auth/callback') {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/callback';
    if (!url.searchParams.has('next')) {
      const locale = localeOf(request.nextUrl.pathname);
      url.searchParams.set('next', `/${locale}/reset-password`);
    }
    return NextResponse.redirect(url);
  }

  const response = intlMiddleware(request);
  const env = getClientEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Read, and refreshed if expired — not verified. See the note above: the
  // page verifies before it reads anything, and RLS stands behind that.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const path = stripLocale(request.nextUrl.pathname);
  const locale = localeOf(request.nextUrl.pathname);

  const needsSession = PROTECTED_SEGMENTS.some(
    (segment) => path === segment || path.startsWith(`${segment}/`),
  );

  if (needsSession && !session) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/sign-in`;
    // Carry the destination so the user lands where they were going, not on a
    // generic home page that makes them navigate again.
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  /**
   * Everything except API routes, Next internals and files with an extension.
   * `/api/health` in particular must answer without a locale prefix — a monitor
   * hitting it should not be redirected.
   */
  matcher: ['/((?!api|auth|_next|_vercel|.*\\..*).*)'],
};
