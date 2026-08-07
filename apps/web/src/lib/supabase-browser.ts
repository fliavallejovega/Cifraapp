'use client';

import { getClientEnv } from '@app/validation/env';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The browser's Supabase client.
 *
 * Only ever holds the anon key, which is public by design — every read it can
 * perform is one row-level security already permits. Nothing here can reach a
 * household the signed-in user is not a member of.
 */
let client: SupabaseClient | undefined;

export function getBrowserClient(): SupabaseClient {
  const env = getClientEnv();
  client ??= createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return client;
}
