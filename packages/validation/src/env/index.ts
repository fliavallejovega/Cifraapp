/* eslint-disable no-restricted-properties -- This module is the one place
   `process.env` may be read; everything else consumes the validated result. */

import { clientEnvSchema, serverEnvSchema, type ClientEnv, type ServerEnv } from './schema.js';

/**
 * The single door to environment configuration.
 *
 * A missing or malformed variable fails loudly the first time it is needed,
 * with every problem listed at once, instead of surfacing weeks later as an
 * `undefined` in a connection string. Validation is lazy rather than at module
 * load so that a build, a lint run, or a unit test does not require production
 * secrets to be present.
 */

let cachedServerEnv: ServerEnv | undefined;
let cachedClientEnv: ClientEnv | undefined;

/** Set by tooling that must import application code without real credentials. */
function validationIsSkipped(): boolean {
  return process.env['SKIP_ENV_VALIDATION'] === 'true';
}

export class EnvironmentError extends Error {
  constructor(scope: 'server' | 'client', issues: string[]) {
    super(
      `Invalid ${scope} environment configuration:\n${issues.map((issue) => `  • ${issue}`).join('\n')}\n\nCompare your .env.local against .env.example.`,
    );
    this.name = 'EnvironmentError';
  }
}

export function getServerEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;

  // `'window' in globalThis` rather than `typeof window`, because this package
  // compiles without the DOM lib — the check has to work without that global
  // being declared.
  if ('window' in globalThis) {
    throw new Error(
      'getServerEnv() was called in the browser. Server configuration must never be bundled for the client.',
    );
  }

  if (validationIsSkipped()) {
    cachedServerEnv = {
      APP_ENV: 'development',
      DATABASE_URL: '',
      DIRECT_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      AI_PROVIDER: 'none',
      AI_MONTHLY_BUDGET: '0',
      BILLING_PROVIDER: 'none',
    };
    return cachedServerEnv;
  }

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new EnvironmentError(
      'server',
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }

  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

export function getClientEnv(): ClientEnv {
  if (cachedClientEnv) return cachedClientEnv;

  // Next.js inlines `process.env.NEXT_PUBLIC_*` at build time only when each key
  // is written out literally, so this cannot be a loop over the schema's shape.
  const source = {
    NEXT_PUBLIC_SUPABASE_URL: process.env['NEXT_PUBLIC_SUPABASE_URL'],
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    NEXT_PUBLIC_APP_URL: process.env['NEXT_PUBLIC_APP_URL'],
  };

  if (validationIsSkipped()) {
    cachedClientEnv = {
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    };
    return cachedClientEnv;
  }

  const parsed = clientEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvironmentError(
      'client',
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }

  cachedClientEnv = parsed.data;
  return cachedClientEnv;
}

/** Test-only. Clears the memoized values so a case can vary the environment. */
export function resetEnvCache(): void {
  cachedServerEnv = undefined;
  cachedClientEnv = undefined;
}

export { clientEnvSchema, serverEnvSchema, type ClientEnv, type ServerEnv } from './schema.js';
