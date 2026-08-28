import { getClientEnv } from '@app/validation/env';

/**
 * Canonical origin for Supabase auth redirects in email links.
 *
 * Must match Supabase → Authentication → URL Configuration → Site URL, and every
 * production hostname the app is served from must appear in Redirect URLs.
 * `window.location.origin` is wrong here: a misconfigured dashboard Site URL
 * still sends people to localhost even when they requested the reset on production.
 */
export function authAppOrigin(): string {
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    return window.location.origin.replace(/\/$/, '');
  }
  return getClientEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
}

/** PKCE callback that exchanges `code` server-side before the user sets a password. */
export function authCallbackUrl(nextPath: string): string {
  const next = nextPath.startsWith('/') ? nextPath : `/${nextPath}`;
  return `${authAppOrigin()}/auth/callback?next=${encodeURIComponent(next)}`;
}
