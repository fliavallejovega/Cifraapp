import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit generates candidate SQL from the schema definitions; it does not
 * apply anything. Generated files land in `supabase/migrations` with the
 * Supabase timestamp prefix, are reviewed by hand, and are applied by the
 * Supabase CLI (ADR-004).
 *
 * The review step is not ceremony. An auto-generated migration against a
 * database holding real financial history can drop a column it thinks is
 * unused; reading the SQL before it runs is the only thing that catches that.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/*.ts',
  out: '../../supabase/migrations',
  casing: 'snake_case',
  migrations: {
    prefix: 'supabase',
  },
  dbCredentials: {
    url: process.env['DIRECT_URL'] ?? '',
  },
  schemaFilter: ['app', 'platform', 'audit'],
  verbose: true,
  strict: true,
});
