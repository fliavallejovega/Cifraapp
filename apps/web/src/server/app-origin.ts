import 'server-only';

import { getClientEnv } from '@app/validation/env';
import { headers } from 'next/headers';

/**
 * The public origin for this request.
 *
 * Email links must target the hostname the user is actually on, not a value that
 * was accidentally baked into the client bundle as localhost during a misconfigured
 * build. Request headers are authoritative on the server; env is the fallback.
 */
export async function requestAppOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');

  if (host) {
    const proto =
      h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    return `${proto}://${host}`.replace(/\/$/, '');
  }

  return getClientEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
}

export async function requestAuthCallbackUrl(nextPath: string): Promise<string> {
  const next = nextPath.startsWith('/') ? nextPath : `/${nextPath}`;
  return `${await requestAppOrigin()}/auth/callback?next=${encodeURIComponent(next)}`;
}
