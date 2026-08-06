-- Foundation migration.
--
-- Establishes the primitives every later migration depends on: extensions, the
-- schema separation that keeps the three financial worlds apart (spec §132),
-- shared trigger functions, and time-ordered identifiers.
--
-- Nothing here holds user data. Tables arrive in Phase 2 (auth and tenancy) and
-- Phase 3 (accounts, transactions, budgets), each behind its own migration.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

-- Trigram matching. The duplicate-detection engine (Phase 5) compares normalized
-- merchant descriptions such as 'SUPER 99 CDE' against 'SUPER99 #034'; that is a
-- similarity search, and it needs a GIN index to stay fast at millions of rows.
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Schemas — the three financial worlds must never share a namespace (spec §132)
-- ---------------------------------------------------------------------------

-- Customer financial data: households, accounts, transactions, budgets, goals.
create schema if not exists app;

-- Append-only record of who did what (spec §48). Separated so that a mistake in
-- an application grant can never hand out the ability to rewrite history.
create schema if not exists audit;

-- The SaaS company's own books: subscriptions, invoices, double-entry ledger.
-- A customer's money and the company's revenue are different domains that happen
-- to share a database (spec §30, §86).
create schema if not exists platform;

comment on schema app is 'Customer financial data. Every table is tenant-scoped and RLS-protected.';
comment on schema audit is 'Append-only audit trail. Writes only, no updates or deletes.';
comment on schema platform is 'SaaS company accounting and operations. Never mixed with customer data.';

-- ---------------------------------------------------------------------------
-- Identifiers
-- ---------------------------------------------------------------------------

-- UUID v7: a 48-bit millisecond timestamp followed by randomness, so primary
-- keys sort by creation time. Random v4 keys scatter inserts across the whole
-- B-tree and fragment it; v7 keys append (ADR-007).
--
-- The application generates these in TypeScript for round-trip-free inserts;
-- this function is the default for rows created by SQL, jobs and seeds.
create or replace function public.uuid_generate_v7()
returns uuid
language plpgsql
volatile
as $$
declare
  unix_ts_ms bytea;
  uuid_bytes bytea;
begin
  unix_ts_ms := substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3);

  -- 10 random bytes, then overwrite the version nibble (7) and the variant bits.
  uuid_bytes := unix_ts_ms || extensions.gen_random_bytes(10);
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);

  return encode(uuid_bytes, 'hex')::uuid;
end;
$$;

comment on function public.uuid_generate_v7() is
  'Time-ordered UUID v7. Preferred over gen_random_uuid() for primary keys on high-volume tables.';

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger. Keeps updated_at honest regardless of what the client sends.';

-- ---------------------------------------------------------------------------
-- Schema version marker
-- ---------------------------------------------------------------------------
--
-- A single row the application reads at startup and the health endpoint reports.
-- It answers "which shape of the schema is this deployment actually talking to",
-- which matters the moment migrations and application code can be deployed
-- independently.

create table if not exists platform.schema_version (
  id            boolean primary key default true,
  version       integer not null,
  description   text not null,
  applied_at    timestamptz not null default now(),
  constraint schema_version_single_row check (id)
);

comment on table platform.schema_version is
  'Single-row marker of the applied schema generation. Read by /api/health.';

insert into platform.schema_version (id, version, description)
values (true, 1, 'Phase 0 — foundation: extensions, schemas, uuid v7, updated_at trigger')
on conflict (id) do update
  set version = excluded.version,
      description = excluded.description,
      applied_at = now();

-- ---------------------------------------------------------------------------
-- Default privileges
-- ---------------------------------------------------------------------------
--
-- Deny by default. Every later migration grants exactly the access a table
-- needs, on top of its own RLS policies. Relying on a blanket schema grant is
-- how a tenant isolation bug becomes a data breach (spec §47, §95).

revoke all on schema app from public, anon, authenticated;
revoke all on schema audit from public, anon, authenticated;
revoke all on schema platform from public, anon, authenticated;

grant usage on schema app to authenticated, service_role;
grant usage on schema audit to service_role;
grant usage on schema platform to service_role;

-- The health check reads the version marker with the anonymous key, so this one
-- row is deliberately world-readable. It contains no user data.
grant usage on schema platform to anon, authenticated;
grant select on platform.schema_version to anon, authenticated;

alter table platform.schema_version enable row level security;

drop policy if exists schema_version_readable on platform.schema_version;
create policy schema_version_readable
  on platform.schema_version
  for select
  using (true);
