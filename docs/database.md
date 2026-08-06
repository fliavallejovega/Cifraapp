# Database

Postgres, hosted on Supabase. Drizzle defines the schema and types; the Supabase
CLI applies migrations (ADR-004).

## Schemas

| Schema     | Holds                                                                 | Access                                                   |
| ---------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| `app`      | Customer financial data — households, accounts, transactions, budgets | RLS on every table; `authenticated` has `usage` only     |
| `platform` | SaaS company accounting, subscriptions, ledger, reference data        | `service_role`; a narrow read grant for reference tables |
| `audit`    | Append-only trail of sensitive operations                             | `service_role` only; no updates, no deletes              |
| `public`   | Shared functions (`uuid_generate_v7`, `set_updated_at`) and enums     | Functions only, no tables                                |

Access is revoked by default. Every migration grants exactly what its tables
need, on top of their own RLS policies. A blanket schema grant is how a tenant
isolation bug becomes a data breach.

## Conventions

**Money.** `numeric(19,4)`. Never `real`, never `double precision`, never
`float`. An integration test queries `information_schema` for any column named
like money with a floating-point type and fails if it finds one.

**Dates.** Financial dates are `date`. System and audit columns are
`timestamptz`. Never a timestamp for something that is a calendar day (ADR-006).

**Identifiers.** `uuid` primary keys, v7, generated in the application with
`public.uuid_generate_v7()` as the column default (ADR-007).

**Timestamps.** Every table carries `created_at` and `updated_at`, the latter
maintained by the shared `set_updated_at()` trigger rather than by the client.

**Soft deletion.** `deleted_at timestamptz` where an audit or accounting
retention requirement makes a hard delete wrong.

**Naming.** `snake_case` throughout. Drizzle is configured with
`casing: 'snake_case'`, so TypeScript stays camelCase without a mapping layer.

## Migrations

Files live in `supabase/migrations/` and are named `YYYYMMDDHHMMSS_description.sql`
— the 14-digit form the Supabase CLI requires.

```bash
pnpm db:generate   # drizzle-kit writes candidate SQL from the schema
                   # → read it before committing
pnpm db:migrate    # supabase db push --db-url $DIRECT_URL
pnpm db:seed       # idempotent reference data
pnpm db:reset      # development only; refuses production
```

Generated SQL is reviewed by hand every time. An auto-generated diff against a
database holding real financial history can drop a column it believes is unused.

Migrations run over `DIRECT_URL`. The transaction pooler cannot hold the
session-level locks DDL requires.

## Applied migrations

| File                                | Adds                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `20260806120000_foundation.sql`     | Extensions (`pgcrypto`, `citext`, `pg_trgm`), the three schemas, `uuid_generate_v7()`, `set_updated_at()`, `platform.schema_version` |
| `20260806120100_reference_data.sql` | `platform.currencies`, `platform.tax_jurisdictions`, `app.category_templates`, `category_kind` enum                                  |

`pg_trgm` is installed early because the duplicate-detection engine in Phase 5
compares normalized merchant descriptions (`SUPER 99 CDE` against `SUPER99 #034`)
— a similarity search that needs a GIN index to stay fast at scale.

## Seed data

`pnpm db:seed` installs global reference data: two currencies (USD and PAB, kept
distinct despite the 1:1 peg), Panama as a tax jurisdiction marked
`is_supported = false` until Phase 12 implements reviewed rules, and the default
category tree from the specification in both interface languages.

Every statement upserts on a natural key, so a second run is a no-op. An
integration test asserts the row count matches the seed definition exactly —
which is what would catch a seed that appended instead of upserting.

The category tree is validated by unit tests that run without a database: unique
slugs, no orphaned parents, no cycles, no missing translation, and children that
inherit their parent's `kind`. That last one matters because a child that turned
a transfer into an expense would make every credit card payment count as
spending.

## Row-level security

Every table in `app` has RLS enabled. Policies are written per table in the
migration that creates it, and Phase 2 establishes the household membership
policies the rest of the system builds on.

RLS is enforced by Postgres, not by TypeScript. The application never filters by
tenant in application code and calls that security.
