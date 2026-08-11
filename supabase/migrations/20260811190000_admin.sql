-- The admin platform.
--
-- Administrative access is a separate thing from being a customer. It lives in
-- `platform`, it is granted row by row, and it is checked by the admin
-- application rather than inherited from any household membership. A customer
-- account that could become an administrator by editing its own row is not an
-- access model.
--
-- Roles are narrow because the alternative — one `is_admin` flag — means every
-- support request is answered by somebody who can also issue refunds and read
-- the ledger. Support should be able to see a ticket and a subscription state;
-- it should not be able to read a household's transactions, and the policies
-- below reflect that.

create type platform.admin_role as enum (
  'super_admin', 'finance_admin', 'support_admin', 'content_admin', 'tax_reviewer'
);

create table platform.admin_users (
  profile_id     uuid primary key references app.profiles (id) on delete cascade,
  role           platform.admin_role not null,

  granted_by     uuid references app.profiles (id) on delete set null,
  granted_at     timestamptz not null default now(),
  -- Disabled rather than deleted: an administrator who acted needs to remain
  -- resolvable in the audit trail long after their access ends.
  disabled_at    timestamptz,

  created_at     timestamptz not null default now()
);

create or replace function platform.is_admin(required_role platform.admin_role default null)
returns boolean
language sql
stable
security definer
set search_path = platform, public
as $$
  select exists (
    select 1
      from platform.admin_users a
     where a.profile_id = auth.uid()
       and a.disabled_at is null
       -- A super admin satisfies every requirement. Every other role satisfies
       -- only its own; there is no hierarchy between support and finance.
       and (required_role is null or a.role = required_role or a.role = 'super_admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- Feature flags
-- ---------------------------------------------------------------------------
--
-- Scoped global → organization → household → user, most specific winning. The
-- ordering is what makes it possible to switch something on for one household
-- to reproduce a bug without switching it on for everyone.

create type platform.flag_scope as enum ('global', 'organization', 'household', 'user');

create table platform.feature_flags (
  key            text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  description    text not null,
  -- What applies when no override matches. False for anything unfinished: a
  -- flag that defaults on is not a flag, it is a release.
  default_enabled boolean not null default false,
  created_at     timestamptz not null default now()
);

create table platform.feature_flag_overrides (
  id             uuid primary key default public.uuid_generate_v7(),
  flag_key       text not null references platform.feature_flags (key) on delete cascade,

  scope          platform.flag_scope not null,
  -- Null only for the global scope, which is the whole platform.
  target_id      uuid,

  enabled        boolean not null,
  note           text,

  created_by     uuid references app.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint feature_flag_overrides_target_matches_scope
    check ((scope = 'global') = (target_id is null)),
  constraint feature_flag_overrides_unique unique (flag_key, scope, target_id)
);

-- ---------------------------------------------------------------------------
-- Support
-- ---------------------------------------------------------------------------

create table platform.support_tickets (
  id             uuid primary key default public.uuid_generate_v7(),

  profile_id     uuid references app.profiles (id) on delete set null,
  household_id   uuid references app.households (id) on delete set null,

  subject        text not null check (length(trim(subject)) between 1 and 200),
  body           text not null,

  -- What the person was looking at. A transaction reference, not the
  -- transaction: support reads the ticket, and reading the household's
  -- financial data is a separate permission it does not have.
  transaction_ref text,

  status         text not null default 'open'
    check (status in ('open', 'waiting', 'resolved', 'closed')),
  assigned_to    uuid references app.profiles (id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  resolved_at    timestamptz
);

create index support_tickets_open_idx on platform.support_tickets (created_at desc)
  where status in ('open', 'waiting');

-- ---------------------------------------------------------------------------
-- Administrative audit
-- ---------------------------------------------------------------------------
--
-- Append-only, in the audit schema, and not readable by the administrators it
-- records. An audit trail its subjects can edit is a log.

create table audit.admin_actions (
  id             uuid primary key default public.uuid_generate_v7(),
  actor_id       uuid not null references app.profiles (id) on delete restrict,
  actor_role     platform.admin_role not null,

  action         text not null,
  target_kind    text not null,
  target_id      text,

  -- Before and after, when the action changed something. The pair is what makes
  -- an audit entry answerable rather than merely present.
  before         jsonb,
  after          jsonb,

  ip_hash        text,
  created_at     timestamptz not null default now()
);

create index admin_actions_actor_idx on audit.admin_actions (actor_id, created_at desc);
create index admin_actions_target_idx on audit.admin_actions (target_kind, target_id);

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
--
-- Every table here is service-role only. The admin application connects with the
-- service role and is responsible for its own authorization — it checks
-- `platform.is_admin()` before every read. That is a deliberate trade: giving
-- administrators an `authenticated` grant would mean writing policies that
-- distinguish five roles across the whole schema, and a policy that can be
-- widened by accident is worse than an application boundary that is obvious.

alter table platform.admin_users enable row level security;
alter table platform.admin_users force row level security;

alter table platform.feature_flags enable row level security;
alter table platform.feature_flags force row level security;

alter table platform.feature_flag_overrides enable row level security;
alter table platform.feature_flag_overrides force row level security;

alter table platform.support_tickets enable row level security;
alter table platform.support_tickets force row level security;

alter table audit.admin_actions enable row level security;
alter table audit.admin_actions force row level security;

-- A person may open a ticket about their own account and read their own
-- tickets. That is the only customer-facing access in this migration.
create policy support_tickets_own on platform.support_tickets
  for select to authenticated
  using (profile_id = auth.uid());

create policy support_tickets_own_insert on platform.support_tickets
  for insert to authenticated
  with check (profile_id = auth.uid());

grant select, insert on platform.support_tickets to authenticated;

create trigger support_tickets_updated_at
  before update on platform.support_tickets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Flags
-- ---------------------------------------------------------------------------
--
-- Everything unfinished, defaulting off. These are the switches the
-- specification names; each one exists because a feature behind it is either
-- incomplete or carries a risk that should be opened deliberately.

insert into platform.feature_flags (key, description, default_enabled)
values
  ('bank_connections', 'Direct bank connections. Not built; imports are file-based.', false),
  ('tax_engine_panama', 'Panama tax estimates. Rules are an unreviewed draft.', false),
  ('accountant_mode', 'The accountant portal and client grants.', false),
  ('white_label', 'Organization branding and custom domains.', false),
  ('ai_copilot', 'The AI copilot. Requires a configured provider key.', false),
  ('scenario_engine', 'What-if projections against a position snapshot.', false),
  ('advanced_reports', 'Operating statement, reconciliation and the monthly close.', false)
on conflict (key) do nothing;

update platform.schema_version
   set version = 19,
       description = 'Phase 20 — admin platform: roles, feature flags with scoped overrides, support tickets, admin audit',
       applied_at = now()
 where id;
