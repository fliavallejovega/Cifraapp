'use client';

import { getClientEnv } from '@app/validation/env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client for password-recovery emails only.
 *
 * PKCE ties the one-time code to a verifier stored when the person asked for the
 * reset. Email clients, in-app browsers and link prefetchers break that: the
 * code is consumed or the verifier is missing, and the reset page shows
 * "expired" seconds after the mail arrived. Implicit flow puts tokens in the URL
 * fragment on the reset page itself, which this product already handles.
 */
let client: SupabaseClient | undefined;

export function getRecoveryClient(): SupabaseClient {
  const env = getClientEnv();
  client ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
      flowType: 'implicit',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return client;
}
