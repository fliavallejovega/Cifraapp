import { z } from 'zod';

/**
 * Configuration that must never reach the browser bundle: database credentials,
 * service-role keys, provider secrets (spec §121).
 */
export const serverEnvSchema = z.object({
  APP_ENV: z.enum(['development', 'preview', 'production']).default('development'),

  /**
   * Pooled connection, used by the application at request time. Supabase's
   * transaction pooler runs on port 6543 and does not support prepared
   * statements — the client disables them accordingly.
   */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),

  /**
   * Direct connection (port 5432). Migrations and long transactions need a
   * session-mode connection; running them through the transaction pooler fails
   * in ways that are hard to diagnose.
   */
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required.'),

  /**
   * Bypasses row-level security. Server-only, always. Any code path that uses
   * this key is responsible for its own tenant scoping (spec §6, §47).
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required.'),
});

/**
 * Configuration that is safe to ship to the browser. Anything added here is
 * public by definition — the `NEXT_PUBLIC_` prefix is the whole contract.
 */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url('NEXT_PUBLIC_SUPABASE_URL must be a URL.'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required.'),
  NEXT_PUBLIC_APP_URL: z.url('NEXT_PUBLIC_APP_URL must be a URL.').default('http://localhost:3000'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;
