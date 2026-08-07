-- Identity and multi-tenancy.
--
-- This migration establishes the boundary every later table depends on. Get it
-- wrong and a household sees another household's money — which is the only
-- failure in this system that cannot be apologised for.
--
-- The rule it encodes: tenant isolation is enforced by Postgres, never by
-- application code that remembers to add a WHERE clause.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

create type app.household_role as enum (
  'owner',      -- created it, can delete it, can change membership
  'partner',    -- full financial peer; the second adult in a couple
  'member',     -- participates, limited administrative rights
  'viewer',     -- reads, writes nothing
  'accountant', -- external professional, explicitly and revocably granted
  'advisor'     -- external advisor, narrower than accountant
);

create type app.organization_kind as enum ('platform', 'accounting_firm', 'white_label');

create type app.member_status as enum ('active', 'invited', 'revoked');

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
--
-- The application-owned half of a user. Supabase owns `auth.users`; everything
-- the product needs about a person lives here, so a change in the auth provider
-- does not reach into the domain.

create table app.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        extensions.citext not null unique,
  display_name text,
  locale       text not null default 'es' check (locale in ('es', 'en')),
  time_zone    text not null default 'America/Panama',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger set_updated_at before update on app.profiles
  for each row execute function public.set_updated_at();

comment on table app.profiles is
  'Application-owned user record. Created on first sign-in; auth.users remains the credential store.';

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------
--
-- Accounting firms and white-label partners. A household may belong to one, or
-- to none — an individual signing up directly has no organization, and the
-- schema must not pretend otherwise.

create table app.organizations (
  id         uuid primary key default public.uuid_generate_v7(),
  slug       extensions.citext not null unique,
  name       text not null,
  kind       app.organization_kind not null default 'accounting_firm',
  created_by uuid references app.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger set_updated_at before update on app.organizations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Households
-- ---------------------------------------------------------------------------

create table app.households (
  id              uuid primary key default public.uuid_generate_v7(),
  name            text not null,
  organization_id uuid references app.organizations (id) on delete set null,
  base_currency   char(3) not null default 'USD' references platform.currencies (code),
  time_zone       text not null default 'America/Panama',
  created_by      uuid references app.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Soft delete. Accounting and audit retention make a hard delete wrong; the
  -- privacy workflow in Phase 21 decides when a purge is actually permitted.
  deleted_at      timestamptz
);

create index households_organization_idx on app.households (organization_id)
  where organization_id is not null;

create trigger set_updated_at before update on app.households
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------

create table app.household_members (
  id           uuid primary key default public.uuid_generate_v7(),
  household_id uuid not null references app.households (id) on delete cascade,
  user_id      uuid not null references app.profiles (id) on delete cascade,
  role         app.household_role not null default 'member',
  status       app.member_status not null default 'active',
  invited_by   uuid references app.profiles (id) on delete set null,
  joined_at    timestamptz not null default now(),
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint household_members_revoked_consistency
    check ((status = 'revoked') = (revoked_at is not null))
);

-- One live membership per person per household. Revoked rows stay for the audit
-- trail, so the uniqueness is partial rather than absolute.
create unique index household_members_active_unique
  on app.household_members (household_id, user_id)
  where status <> 'revoked';

create index household_members_user_idx on app.household_members (user_id)
  where status = 'active';

create trigger set_updated_at before update on app.household_members
  for each row execute function public.set_updated_at();

create table app.organization_members (
  id              uuid primary key default public.uuid_generate_v7(),
  organization_id uuid not null references app.organizations (id) on delete cascade,
  user_id         uuid not null references app.profiles (id) on delete cascade,
  role            app.household_role not null default 'member',
  status          app.member_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index organization_members_active_unique
  on app.organization_members (organization_id, user_id)
  where status <> 'revoked';

create trigger set_updated_at before update on app.organization_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
--
-- The token is stored hashed. An invitation row is readable by household
-- administrators, and a leaked database dump must not hand anyone a working
-- invitation link.

create table app.household_invitations (
  id           uuid primary key default public.uuid_generate_v7(),
  household_id uuid not null references app.households (id) on delete cascade,
  email        extensions.citext not null,
  role         app.household_role not null default 'member',
  token_hash   text not null unique,
  invited_by   uuid references app.profiles (id) on delete set null,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid references app.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index household_invitations_household_idx
  on app.household_invitations (household_id);

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------
--
-- Append only. No update policy and no delete policy exist for this table by
-- design: a trail that can be rewritten is not a trail (spec §48).

create table audit.events (
  id              uuid primary key default public.uuid_generate_v7(),
  actor_user_id   uuid,
  actor_role      text,
  action          text not null,
  entity_type     text not null,
  entity_id       uuid,
  household_id    uuid,
  organization_id uuid,
  metadata        jsonb not null default '{}'::jsonb,
  -- Recorded where legally appropriate. Never a full account number, a tax id,
  -- a credential or a transaction description (spec §47).
  ip_address      inet,
  user_agent      text,
  occurred_at     timestamptz not null default now()
);

create index audit_events_household_idx on audit.events (household_id, occurred_at desc);
create index audit_events_actor_idx on audit.events (actor_user_id, occurred_at desc);
create index audit_events_entity_idx on audit.events (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER is load-bearing, not a convenience. A policy on
-- household_members that queries household_members recurses infinitely; running
-- the lookup as the definer steps outside RLS exactly once, deliberately, in a
-- function whose body is fixed and reviewable.
--
-- `set search_path` is equally load-bearing: without it, a caller could shadow
-- `app.household_members` with a temp table and hand themselves membership.

create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid()
$$;

create or replace function app.is_household_member(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select exists (
    select 1
      from app.household_members m
     where m.household_id = target_household
       and m.user_id = auth.uid()
       and m.status = 'active'
  )
$$;

create or replace function app.has_household_role(
  target_household uuid,
  allowed app.household_role[]
)
returns boolean
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select exists (
    select 1
      from app.household_members m
     where m.household_id = target_household
       and m.user_id = auth.uid()
       and m.status = 'active'
       and m.role = any (allowed)
  )
$$;

comment on function app.is_household_member(uuid) is
  'Membership check for RLS policies. SECURITY DEFINER to break policy recursion; search_path pinned so it cannot be shadowed.';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table app.profiles enable row level security;
alter table app.organizations enable row level security;
alter table app.households enable row level security;
alter table app.household_members enable row level security;
alter table app.organization_members enable row level security;
alter table app.household_invitations enable row level security;
alter table audit.events enable row level security;

-- Force RLS even for the table owner. Without this, any connection that happens
-- to run as the owner silently sees everything.
--
-- `enable` is the common half-measure: it turns policies on for ordinary roles
-- and leaves the owner exempt. Since migrations, jobs and seeds all connect as
-- the owner, that exemption is exactly where a mistake would go unnoticed.
-- Roles that genuinely need to bypass — `service_role` — carry BYPASSRLS, which
-- is explicit and auditable in a way an ownership accident is not.
--
-- app.category_templates was created in the reference-data migration with
-- `enable` only. Corrected here rather than by editing that migration, which
-- has already been applied.
alter table app.category_templates force row level security;

alter table app.profiles force row level security;
alter table app.organizations force row level security;
alter table app.households force row level security;
alter table app.household_members force row level security;
alter table app.organization_members force row level security;
alter table app.household_invitations force row level security;
alter table audit.events force row level security;

-- Profiles: a person sees and edits themselves. Nothing else.
create policy profiles_select_self on app.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_insert_self on app.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update_self on app.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Households: visible to active members.
create policy households_select_member on app.households
  for select to authenticated
  using (deleted_at is null and app.is_household_member(id));

-- Creating a household is how a new user starts. The creator must be themselves;
-- the accompanying owner membership is created in the same transaction.
create policy households_insert_own on app.households
  for insert to authenticated
  with check (created_by = auth.uid());

create policy households_update_admin on app.households
  for update to authenticated
  using (app.has_household_role(id, array['owner', 'partner']::app.household_role[]))
  with check (app.has_household_role(id, array['owner', 'partner']::app.household_role[]));

-- Membership: any active member may see who else is in the household — a
-- financial group with hidden participants is not a group anyone should trust.
create policy household_members_select on app.household_members
  for select to authenticated
  using (app.is_household_member(household_id));

-- Only an owner changes membership. The bootstrap case — the first owner row for
-- a household you just created — is handled by a SECURITY DEFINER function
-- rather than by loosening this policy.
create policy household_members_write_owner on app.household_members
  for all to authenticated
  using (app.has_household_role(household_id, array['owner']::app.household_role[]))
  with check (app.has_household_role(household_id, array['owner']::app.household_role[]));

create policy household_invitations_admin on app.household_invitations
  for all to authenticated
  using (app.has_household_role(household_id, array['owner', 'partner']::app.household_role[]))
  with check (app.has_household_role(household_id, array['owner', 'partner']::app.household_role[]));

create policy organizations_select_member on app.organizations
  for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from app.organization_members om
       where om.organization_id = id
         and om.user_id = auth.uid()
         and om.status = 'active'
    )
  );

create policy organization_members_select on app.organization_members
  for select to authenticated
  using (user_id = auth.uid());

-- Audit: readable by household administrators, writable by nobody through this
-- path. Entries are written by the service role and by SECURITY DEFINER
-- functions, never by a client statement.
create policy audit_events_select_admin on audit.events
  for select to authenticated
  using (
    household_id is not null
    and app.has_household_role(household_id, array['owner', 'partner']::app.household_role[])
  );

-- ---------------------------------------------------------------------------
-- Bootstrap
-- ---------------------------------------------------------------------------
--
-- Creating a household and its first owner membership is a chicken-and-egg
-- problem against the membership policy: you cannot be an owner of a household
-- that has no members. Rather than weaken the policy — which would let anyone
-- insert themselves into any household — the two rows are written together by a
-- definer function that validates the caller.

create or replace function app.create_household(
  household_name text,
  currency char(3) default 'USD',
  household_time_zone text default 'America/Panama'
)
returns uuid
language plpgsql
security definer
set search_path = app, public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  new_household uuid;
begin
  if caller is null then
    raise exception 'A household can only be created by a signed-in user.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from app.profiles p where p.id = caller) then
    raise exception 'No profile exists for the current user.'
      using errcode = '42501';
  end if;

  insert into app.households (name, base_currency, time_zone, created_by)
  values (household_name, currency, household_time_zone, caller)
  returning id into new_household;

  insert into app.household_members (household_id, user_id, role, status, joined_at)
  values (new_household, caller, 'owner', 'active', now());

  insert into audit.events (actor_user_id, action, entity_type, entity_id, household_id)
  values (caller, 'household.created', 'household', new_household, new_household);

  return new_household;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert, update on app.profiles to authenticated;
grant select, insert, update on app.households to authenticated;
grant select, insert, update, delete on app.household_members to authenticated;
grant select, insert, update, delete on app.household_invitations to authenticated;
grant select on app.organizations to authenticated;
grant select on app.organization_members to authenticated;
grant select on audit.events to authenticated;

grant execute on function app.current_user_id() to authenticated;
grant execute on function app.is_household_member(uuid) to authenticated;
grant execute on function app.has_household_role(uuid, app.household_role[]) to authenticated;
grant execute on function app.create_household(text, char, text) to authenticated;

grant usage on schema audit to authenticated;

update platform.schema_version
   set version = 3,
       description = 'Phase 2 — identity: profiles, households, membership, organizations, invitations, audit',
       applied_at = now()
 where id;
