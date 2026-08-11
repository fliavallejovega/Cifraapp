-- Reporting, reconciliation and the monthly close.
--
-- Statements are computed from transaction rows on demand and are not stored:
-- a stored statement is a copy that silently disagrees with its source the first
-- time a transaction is corrected. What *is* stored is everything a statement
-- cannot recompute — which month a household declared finished, which balance
-- their bank said they had, and which export was produced when.
--
-- The one enforced invariant here is that a closed month does not change. It is
-- a trigger rather than a convention because a rule living only in application
-- code is one a job, a migration or a future endpoint eventually walks around.

create type app.period_status as enum ('open', 'closing', 'closed', 'reopened');

-- ---------------------------------------------------------------------------
-- Accounting periods
-- ---------------------------------------------------------------------------

create table app.accounting_periods (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,

  period_start   date not null,
  period_end     date not null,

  status         app.period_status not null default 'open',

  -- The checklist as it stood at close: uncategorized, duplicates, transfers,
  -- reconciliation, recurring changes, tax classification. Kept because "we
  -- closed with four unreviewed transfers" is the context a later question needs.
  checklist      jsonb not null default '{}'::jsonb,

  closed_by      uuid references app.profiles (id) on delete set null,
  closed_at      timestamptz,
  reopened_by    uuid references app.profiles (id) on delete set null,
  reopened_at    timestamptz,
  reopen_reason  text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint accounting_periods_range check (period_end >= period_start),
  constraint accounting_periods_unique unique (household_id, period_start, period_end),

  constraint accounting_periods_close_has_actor
    check ((status = 'closed') = (closed_at is not null)),

  -- Reopening a closed month is allowed and never silent. The reason is on the
  -- row, because somebody will ask why the figures they quoted changed.
  constraint accounting_periods_reopen_has_reason
    check (status <> 'reopened' or (reopened_at is not null and reopen_reason is not null))
);

create index accounting_periods_household_idx
  on app.accounting_periods (household_id, period_start desc);

/**
 * Refuses a write that would change a closed month.
 *
 * Corrections to a closed period are new entries in an open one that reference
 * what they adjust — never edits. A closed month's figures have been quoted to
 * an accountant, on a return, or in a decision, and changing them retroactively
 * makes every earlier copy wrong without saying so.
 */
create or replace function app.reject_writes_to_closed_periods()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
declare
  target_date date;
  target_household uuid;
begin
  if tg_op = 'DELETE' then
    target_date := old.transaction_date;
    target_household := old.household_id;
  else
    target_date := new.transaction_date;
    target_household := new.household_id;
  end if;

  if exists (
    select 1
      from app.accounting_periods p
     where p.household_id = target_household
       and p.status = 'closed'
       and target_date between p.period_start and p.period_end
  ) then
    raise exception
      'This month is closed. Record a correcting entry in an open period instead of changing a closed one.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger transactions_respect_closed_periods
  before insert or update or delete on app.transactions
  for each row execute function app.reject_writes_to_closed_periods();

-- ---------------------------------------------------------------------------
-- Reconciliation
-- ---------------------------------------------------------------------------
--
-- The difference between the bank's figure and the system's is recorded, not
-- resolved by adjustment. A plug entry makes the two numbers agree and destroys
-- the only evidence of what was missing — and what is missing is usually a
-- transaction the household needs to see.

create table app.reconciliations (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,
  account_id     uuid not null references app.accounts (id) on delete cascade,

  statement_date date not null,
  statement_balance numeric(19, 4) not null,
  system_balance numeric(19, 4) not null,
  difference     numeric(19, 4) not null,

  -- Message keys and the transaction ids behind them, as the engine returned
  -- them. Rendered through the catalogue; the engine has no language.
  candidates     jsonb not null default '[]'::jsonb,

  resolved_at    timestamptz,
  resolved_by    uuid references app.profiles (id) on delete set null,
  resolution_note text,

  created_at     timestamptz not null default now(),

  constraint reconciliations_difference_is_derived
    check (difference = statement_balance - system_balance)
);

create index reconciliations_account_idx
  on app.reconciliations (account_id, statement_date desc);

-- ---------------------------------------------------------------------------
-- Exports
-- ---------------------------------------------------------------------------

create table app.report_exports (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,

  report_kind    text not null,
  format         text not null check (format in ('csv', 'json', 'pdf', 'xlsx')),

  period_start   date,
  period_end     date,

  -- Object storage key, when the export was large enough to be kept. Small
  -- exports stream straight to the browser and never land anywhere.
  r2_key         text,
  byte_size      integer check (byte_size is null or byte_size >= 0),

  requested_by   uuid references app.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz
);

create index report_exports_household_idx
  on app.report_exports (household_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table app.accounting_periods enable row level security;
alter table app.accounting_periods force row level security;

create policy accounting_periods_household_access on app.accounting_periods
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

alter table app.reconciliations enable row level security;
alter table app.reconciliations force row level security;

create policy reconciliations_household_access on app.reconciliations
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

alter table app.report_exports enable row level security;
alter table app.report_exports force row level security;

create policy report_exports_household_access on app.report_exports
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

grant select, insert, update, delete
  on app.accounting_periods, app.reconciliations, app.report_exports
  to authenticated;

create trigger accounting_periods_updated_at
  before update on app.accounting_periods
  for each row execute function public.set_updated_at();

update platform.schema_version
   set version = 12,
       description = 'Phase 13 — reporting: accounting periods with closed-month protection, reconciliation, exports',
       applied_at = now()
 where id;
