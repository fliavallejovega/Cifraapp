import 'server-only';

import { getClientEnv, getServerEnv } from '@app/validation/env';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Supabase clients for the server.
 *
 * Two of them, and the distinction is the same one the database draws: the
 * request client carries the signed-in user's session, so PostgREST and Storage
 * enforce RLS on their behalf. The admin client carries the service-role key,
 * bypasses everything, and is reserved for provisioning.
 */

export async function createRequestClient(): Promise<SupabaseClient> {
  const env = getClientEnv();
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the
          // session on every request, so a read-only render here is expected
          // rather than an error worth surfacing.
        }
      },
    },
  });
}

/**
 * Bypasses row-level security entirely. Provisioning, jobs and webhooks only —
 * anything using it is responsible for its own tenant scoping.
 */
export function createAdminClient(): SupabaseClient {
  // The generic parameters of `createServerClient` default to the `public`
  // schema, which this project does not use for application data. Widening to
  // the untyped client is deliberate until `supabase gen types` is wired up.
  const clientEnv = getClientEnv();
  const serverEnv = getServerEnv();

  return createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      cookies: { getAll: () => [], setAll: () => undefined },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  ) as SupabaseClient;
}

/**
 * The signed-in user, verified against the auth server.
 *
 * `getUser()` rather than `getSession()`: the session is read from a cookie the
 * client controls, and trusting it would mean trusting a value the browser can
 * edit. `getUser()` validates the token with Supabase before returning.
 */
export async function getAuthenticatedUser(): Promise<User | null> {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.auth.getUser();

  if (error) return null;
  return data.user;
}

/** The access token to forward to Postgres so RLS policies see the caller. */
export async function getAccessToken(): Promise<string | null> {
  const supabase = await createRequestClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
