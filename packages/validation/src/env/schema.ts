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

  /**
   * The AI copilot, off unless a deployment turns it on.
   *
   * Off is a working configuration, not a degraded one: the product's decisions
   * are deterministic and every copilot surface renders without a provider
   * (spec §41). A missing key must therefore never fail a boot — it selects the
   * null provider, and the screen says the assistant is unavailable.
   */
  AI_PROVIDER: z.enum(['anthropic', 'openai', 'none']).default('none'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  /** Overrides the provider's default model. Pricing is read from the database. */
  AI_MODEL: z.string().optional(),

  /**
   * Ceiling per household per calendar month, in whole currency units. Zero is
   * uncapped and is the wrong setting for anything a customer can reach.
   */
  AI_MONTHLY_BUDGET: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'AI_MONTHLY_BUDGET must be an amount like "5.00".')
    .default('0'),

  /**
   * Billing, off unless a processor is named.
   *
   * With no processor every household is on the free plan's entitlements and the
   * product works. That is a supported state, not a broken one — and the webhook
   * endpoint refuses everything rather than trusting an unsigned payload.
   */
  BILLING_PROVIDER: z.enum(['stripe', 'none']).default('none'),
  STRIPE_SECRET_KEY: z.string().optional(),
  /** Without this, the webhook endpoint is a public URL that grants subscriptions. */
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
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
