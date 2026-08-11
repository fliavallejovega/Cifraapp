import 'server-only';

import { getClientEnv } from '@app/validation/env';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The Supabase client for an administrator's session.
 *
 * Cookies are scoped to this application's origin (port 3001 in development), so
 * a session established on the customer application does not carry over. Signing
 * in here is required even when the same credentials work on the product.
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
          // Server Components cannot set cookies. Sign-in runs in a Server Action,
          // which can — and a read-only render that skips refresh is fine.
        }
      },
    },
  });
}
