-- LOCAL DEVELOPMENT ONLY — never applied to a Supabase project.
--
-- Supabase provides the `auth` schema, `auth.users`, and `auth.uid()`. A bare
-- Postgres does not, so migrations that reference them cannot run and RLS
-- policies cannot be tested.
--
-- This recreates the minimum surface those migrations depend on, with
-- `auth.uid()` matching Supabase's own definition exactly — it reads the JWT
-- claims the connection carries. That fidelity is the point: an RLS policy that
-- passes here has to pass in production for the same reason.
--
-- It lives outside `supabase/migrations/` deliberately. The Supabase CLI applies
-- everything in that directory; a file that redefined `auth.users` on a real
-- project would be a catastrophe.

create schema if not exists auth;
create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create table if not exists auth.users (
  id                uuid primary key default extensions.gen_random_uuid(),
  email             text unique,
  encrypted_password text,
  created_at        timestamptz not null default now()
);

-- Verbatim from Supabase: read `sub` from the request's JWT claims, preferring
-- the flattened setting and falling back to the JSON blob.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
