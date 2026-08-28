import { getClientEnv } from '@app/validation/env';
import { createServerClient } from '@supabase/ssr';
import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { routing } from './i18n/routing';

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
 * Second, resolve the locale and, if the route is part of the product rather
 * than the marketing site, require a session. The guard lives here rather than
 * in each page because a route added later would otherwise ship unprotected by
 * omission — and RLS would be the only thing standing between a signed-out
 * visitor and a database query.
 */

const intlMiddleware = createIntlMiddleware(routing);

/** Routes inside the product. Everything else is public. */
const PROTECTED_SEGMENTS = [
  '/overview',
  '/welcome',
  '/money',
  '/transactions',
  '/plan',
  '/documents',
  '/settings',
];

/** Routes a signed-in user has no reason to see. */
const AUTH_SEGMENTS = ['/sign-in', '/sign-up'];

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

  // Verified against the auth server, not decoded from the cookie. The cookie
  // is a value the browser controls.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = stripLocale(request.nextUrl.pathname);
  const locale = localeOf(request.nextUrl.pathname);

  const needsSession = PROTECTED_SEGMENTS.some(
    (segment) => path === segment || path.startsWith(`${segment}/`),
  );

  if (needsSession && !user) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/sign-in`;
    // Carry the destination so the user lands where they were going, not on a
    // generic home page that makes them navigate again.
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  if (user && AUTH_SEGMENTS.some((segment) => path === segment)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/overview`;
    url.search = '';
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
