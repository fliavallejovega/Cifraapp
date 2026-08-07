-- Core financial data model.
--
-- The shape of `app.transactions` is the most consequential decision in this
-- schema. Migrating it once it holds millions of rows behind RLS is the most
-- expensive operation in this project's future, so every column the engines will
-- need is here now, even where the engine that fills it arrives later.
--
-- Money is numeric(19,4) everywhere. Financial dates are `date`, never
-- timestamptz — a transaction posted on July 31 happened on July 31 in every
-- timezone, and one that slides between months corrupts budgets, statements and
-- tax periods (ADR-005, ADR-006).

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

create type app.account_type as enum (
  'checking', 'savings', 'credit_card', 'loan', 'mortgage', 'investment',
  'cash', 'digital_wallet', 'business', 'tax_reserve', 'other_asset', 'other_liability'
);

create type app.account_status as enum ('active', 'closed', 'archived');

-- Whose money this is, inside a household that may deliberately not share
-- everything. Privacy inside a household is a product feature (spec §27).
create type app.financial_scope as enum ('personal', 'partner', 'household', 'business');

create type app.transaction_status as enum (
  'pending',      -- authorized, not yet posted
  'posted',       -- settled
  'excluded',     -- deliberately outside every total
  'transfer',     -- one leg of a movement between own accounts; not spending
  'duplicate',    -- resolved against an existing transaction
  'needs_review', -- the system is not confident enough to decide
  'reconciled'    -- matched against a statement balance
);

create type app.transaction_direction as enum ('inflow', 'outflow');

-- Where a classification came from. Every classification in this system is
-- explainable, and this is half the explanation (spec §98).
create type app.provenance as enum (
  'system', 'user', 'ai', 'accountant', 'imported', 'bank', 'rule', 'tax_rule'
);

create type app.tax_classification as enum (
  'personal', 'business', 'mixed', 'non_deductible',
  'potentially_deductible', 'requires_review'
);

create type app.debt_strategy as enum ('avalanche', 'snowball', 'custom', 'hybrid');

create type app.goal_status as enum ('active', 'reached', 'paused', 'abandoned');

create type app.budget_period as enum ('weekly', 'monthly', 'annual', 'sinking');

-- ---------------------------------------------------------------------------
-- Institutions and accounts
-- ---------------------------------------------------------------------------

create table app.institutions (
  id           uuid primary key default public.uuid_generate_v7(),
  name         text not null,
  country      char(2) not null default 'PA',
  -- Hints the statement parsers use to recognise this institution's documents.
  parser_key   text unique,
  created_at   timestamptz not null default now()
);

create table app.accounts (
  id                uuid primary key default public.uuid_generate_v7(),
  household_id      uuid not null references app.households (id) on delete cascade,
  owner_id          uuid references app.profiles (id) on delete set null,
  institution_id    uuid references app.institutions (id) on delete set null,

  name              text not null,
  -- Last four only. A full account number is never stored (spec §47).
  masked_number     text,
  account_type      app.account_type not null,
  scope             app.financial_scope not null default 'household',
  currency          char(3) not null default 'USD' references platform.currencies (code),

  current_balance   numeric(19, 4) not null default 0,
  available_balance numeric(19, 4),
  credit_limit      numeric(19, 4),

  status            app.account_status not null default 'active',
  source            app.provenance not null default 'user',
  -- Drives the staleness indicator: advice from a three-month-old balance is
  -- worse than no advice (spec §106).
  last_imported_at  timestamptz,

  created_by        uuid references app.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,

  constraint accounts_credit_limit_only_for_credit
    check (credit_limit is null or account_type in ('credit_card', 'loan', 'mortgage'))
);

create index accounts_household_idx on app.accounts (household_id) where deleted_at is null;

create trigger set_updated_at before update on app.accounts
  for each row execute function public.set_updated_at();

comment on column app.accounts.masked_number is
  'Last four digits at most. Full account numbers are never stored anywhere in this system.';

-- ---------------------------------------------------------------------------
-- Merchants and categories
-- ---------------------------------------------------------------------------

create table app.merchants (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid references app.households (id) on delete cascade,
  name           text not null,
  normalized_name text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The alias table is what lets 'SUPER 99 CDE', 'SUPER99 #034' and
-- 'SUPER 99 COSTA DEL ESTE' resolve to one merchant (spec §10).
create table app.merchant_aliases (
  id          uuid primary key default public.uuid_generate_v7(),
  merchant_id uuid not null references app.merchants (id) on delete cascade,
  pattern     text not null,
  source      app.provenance not null default 'system',
  created_at  timestamptz not null default now()
);

create index merchants_normalized_trgm
  on app.merchants using gin (normalized_name extensions.gin_trgm_ops);

create index merchant_aliases_merchant_idx on app.merchant_aliases (merchant_id);

create table app.categories (
  id            uuid primary key default public.uuid_generate_v7(),
  household_id  uuid not null references app.households (id) on delete cascade,
  parent_id     uuid references app.categories (id) on delete cascade,
  template_slug text references app.category_templates (slug) on delete set null,
  name          text not null,
  kind          public.category_kind not null,
  sort_order    integer not null default 0,
  is_system     boolean not null default false,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index categories_household_idx on app.categories (household_id);

create trigger set_updated_at before update on app.categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------

create table app.transactions (
  id                   uuid primary key default public.uuid_generate_v7(),
  household_id         uuid not null references app.households (id) on delete cascade,
  account_id           uuid not null references app.accounts (id) on delete cascade,
  owner_id             uuid references app.profiles (id) on delete set null,

  -- Calendar dates. `posted_date` is null until the transaction settles.
  transaction_date     date not null,
  posted_date          date,

  amount               numeric(19, 4) not null,
  currency             char(3) not null references platform.currencies (code),
  direction            app.transaction_direction not null,

  -- The original text is never destroyed. Normalization must be reversible, or
  -- a bad normalizer silently rewrites history (spec §10).
  description_original text not null,
  description_normalized text not null,

  merchant_id          uuid references app.merchants (id) on delete set null,
  category_id          uuid references app.categories (id) on delete set null,
  category_source      app.provenance,
  category_confidence  numeric(4, 3) check (category_confidence between 0 and 1),

  scope                app.financial_scope not null default 'household',
  tax_classification   app.tax_classification,
  -- For a mixed expense: the share attributable to the business. Stored, not
  -- derived at report time, because the user's answer is the fact.
  business_percentage  numeric(5, 2) check (business_percentage between 0 and 100),

  status               app.transaction_status not null default 'posted',

  -- Provenance and identity
  source               app.provenance not null default 'imported',
  source_document_id   uuid,
  source_import_id     uuid,
  external_reference   text,
  -- Deterministic identity: account + date + amount + normalized description.
  -- The duplicate engine's first line of defence (Phase 5).
  fingerprint          text not null,
  duplicate_group_id   uuid,

  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,

  -- The sign must agree with the direction, always. Without this, an inflow
  -- recorded as negative quietly reverses a month's net cash flow.
  constraint transactions_amount_matches_direction check (
    (direction = 'inflow' and amount >= 0) or (direction = 'outflow' and amount <= 0)
  ),
  constraint transactions_posted_after_transaction check (
    posted_date is null or posted_date >= transaction_date
  ),
  -- A mixed classification without a percentage is not a classification.
  constraint transactions_mixed_needs_percentage check (
    tax_classification <> 'mixed' or business_percentage is not null
  )
);

-- Indexes driven by the queries this table will actually serve.
create index transactions_household_date_idx
  on app.transactions (household_id, transaction_date desc)
  where deleted_at is null;

create index transactions_account_date_idx
  on app.transactions (account_id, transaction_date desc)
  where deleted_at is null;

-- The duplicate engine's exact-match probe.
create index transactions_fingerprint_idx on app.transactions (household_id, fingerprint);

-- The duplicate engine's near-match probe: same account, same amount, dates
-- within a window.
create index transactions_dedupe_probe_idx
  on app.transactions (account_id, amount, transaction_date);

-- Fuzzy description matching for the probabilistic pass.
create index transactions_description_trgm
  on app.transactions using gin (description_normalized extensions.gin_trgm_ops);

create index transactions_needs_review_idx
  on app.transactions (household_id, transaction_date desc)
  where status = 'needs_review';

create index transactions_external_reference_idx
  on app.transactions (account_id, external_reference)
  where external_reference is not null;

create trigger set_updated_at before update on app.transactions
  for each row execute function public.set_updated_at();

comment on table app.transactions is
  'Every money movement. Transfers are two rows linked by app.transfers, never one row and never an expense plus an income.';

-- ---------------------------------------------------------------------------
-- Transfers
-- ---------------------------------------------------------------------------
--
-- A movement between the household's own accounts is not income and not
-- spending. A credit card payment is a transfer; the card purchases it settles
-- were already counted as expenses when they occurred. Getting this wrong
-- double-counts spending every single month (spec §11).

create table app.transfers (
  id                 uuid primary key default public.uuid_generate_v7(),
  household_id       uuid not null references app.households (id) on delete cascade,
  from_transaction_id uuid not null references app.transactions (id) on delete cascade,
  to_transaction_id   uuid not null references app.transactions (id) on delete cascade,
  amount             numeric(19, 4) not null check (amount > 0),
  currency           char(3) not null references platform.currencies (code),
  is_card_payment    boolean not null default false,
  confidence         numeric(4, 3) not null check (confidence between 0 and 1),
  detected_by        app.provenance not null default 'system',
  confirmed_by       uuid references app.profiles (id) on delete set null,
  confirmed_at       timestamptz,
  created_at         timestamptz not null default now(),

  constraint transfers_distinct_legs check (from_transaction_id <> to_transaction_id),
  unique (from_transaction_id, to_transaction_id)
);

create index transfers_household_idx on app.transfers (household_id);

-- ---------------------------------------------------------------------------
-- Duplicate resolution
-- ---------------------------------------------------------------------------

create table app.duplicate_candidates (
  id                  uuid primary key default public.uuid_generate_v7(),
  household_id        uuid not null references app.households (id) on delete cascade,
  existing_transaction_id uuid not null references app.transactions (id) on delete cascade,
  -- Null while the candidate is still an unimported row under review.
  incoming_transaction_id uuid references app.transactions (id) on delete cascade,
  import_id           uuid,
  confidence          numeric(4, 3) not null check (confidence between 0 and 1),
  -- Which rules fired, so the decision can be explained and audited.
  matched_signals     jsonb not null default '[]'::jsonb,
  resolution          text check (resolution in ('merged', 'kept_both', 'discarded', 'pending')),
  resolved_by         uuid references app.profiles (id) on delete set null,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now()
);

create index duplicate_candidates_household_idx
  on app.duplicate_candidates (household_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Obligations, budgets, goals, debts
-- ---------------------------------------------------------------------------

create table app.obligations (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,
  account_id     uuid references app.accounts (id) on delete set null,
  category_id    uuid references app.categories (id) on delete set null,
  merchant_id    uuid references app.merchants (id) on delete set null,

  name           text not null,
  expected_amount numeric(19, 4) not null,
  currency       char(3) not null default 'USD' references platform.currencies (code),
  due_date       date not null,
  -- 'monthly', 'weekly', 'annual', or null for a one-off.
  frequency      text,
  next_expected_date date,
  is_essential   boolean not null default true,
  confidence     numeric(4, 3) check (confidence between 0 and 1),
  detected_by    app.provenance not null default 'user',
  settled_transaction_id uuid references app.transactions (id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index obligations_household_due_idx
  on app.obligations (household_id, due_date)
  where deleted_at is null;

create trigger set_updated_at before update on app.obligations
  for each row execute function public.set_updated_at();

create table app.budgets (
  id            uuid primary key default public.uuid_generate_v7(),
  household_id  uuid not null references app.households (id) on delete cascade,
  name          text not null,
  period        app.budget_period not null default 'monthly',
  starts_on     date not null,
  ends_on       date,
  scope         app.financial_scope not null default 'household',
  rolls_over    boolean not null default false,
  created_by    uuid references app.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint budgets_period_ordered check (ends_on is null or ends_on >= starts_on)
);

create table app.budget_lines (
  id           uuid primary key default public.uuid_generate_v7(),
  budget_id    uuid not null references app.budgets (id) on delete cascade,
  category_id  uuid references app.categories (id) on delete set null,
  planned_amount numeric(19, 4) not null,
  currency     char(3) not null default 'USD' references platform.currencies (code),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (budget_id, category_id)
);

create index budgets_household_idx on app.budgets (household_id) where deleted_at is null;

create trigger set_updated_at before update on app.budgets
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on app.budget_lines
  for each row execute function public.set_updated_at();

create table app.goals (
  id              uuid primary key default public.uuid_generate_v7(),
  household_id    uuid not null references app.households (id) on delete cascade,
  account_id      uuid references app.accounts (id) on delete set null,
  name            text not null,
  target_amount   numeric(19, 4) not null check (target_amount > 0),
  current_amount  numeric(19, 4) not null default 0,
  currency        char(3) not null default 'USD' references platform.currencies (code),
  target_date     date,
  priority        integer not null default 100,
  scope           app.financial_scope not null default 'household',
  status          app.goal_status not null default 'active',
  created_by      uuid references app.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index goals_household_idx on app.goals (household_id, priority);

create trigger set_updated_at before update on app.goals
  for each row execute function public.set_updated_at();

create table app.debts (
  id                uuid primary key default public.uuid_generate_v7(),
  household_id      uuid not null references app.households (id) on delete cascade,
  account_id        uuid references app.accounts (id) on delete set null,
  name              text not null,
  principal         numeric(19, 4) not null,
  current_balance   numeric(19, 4) not null,
  currency          char(3) not null default 'USD' references platform.currencies (code),
  -- Annual percentage rate as a percentage: 24.50 means 24.5%.
  apr               numeric(6, 3) not null check (apr >= 0),
  minimum_payment   numeric(19, 4) not null default 0,
  due_day           smallint check (due_day between 1 and 31),
  statement_day     smallint check (statement_day between 1 and 31),
  credit_limit      numeric(19, 4),
  promotional_apr   numeric(6, 3) check (promotional_apr >= 0),
  promotional_expires_on date,
  strategy_priority integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,

  constraint debts_promotional_needs_expiry
    check ((promotional_apr is null) = (promotional_expires_on is null))
);

create index debts_household_idx on app.debts (household_id) where deleted_at is null;

create trigger set_updated_at before update on app.debts
  for each row execute function public.set_updated_at();

create table app.household_settings (
  household_id      uuid primary key references app.households (id) on delete cascade,
  buffer_minimum    numeric(19, 4) not null default 0,
  debt_strategy     app.debt_strategy not null default 'avalanche',
  tax_reserve_rate  numeric(5, 2) check (tax_reserve_rate between 0 and 100),
  updated_at        timestamptz not null default now()
);

create trigger set_updated_at before update on app.household_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

do $$
declare
  target text;
  tables text[] := array[
    'accounts', 'merchants', 'merchant_aliases', 'categories', 'transactions',
    'transfers', 'duplicate_candidates', 'obligations', 'budgets',
    'goals', 'debts', 'household_settings'
  ];
begin
  foreach target in array tables loop
    execute format('alter table app.%I enable row level security', target);
    execute format('alter table app.%I force row level security', target);
  end loop;
end
$$;

-- Institutions are shared reference data, like currencies.
alter table app.institutions enable row level security;
alter table app.institutions force row level security;
create policy institutions_readable on app.institutions
  for select to authenticated using (true);

-- Everything tenant-scoped resolves through the same membership check. Writing
-- it once per table by hand is how one table eventually gets a subtly different
-- predicate.
do $$
declare
  target text;
  tables text[] := array[
    'accounts', 'categories', 'transactions', 'transfers', 'duplicate_candidates',
    'obligations', 'budgets', 'goals', 'debts'
  ];
begin
  foreach target in array tables loop
    execute format(
      'create policy %I on app.%I for all to authenticated
         using (app.is_household_member(household_id))
         with check (app.is_household_member(household_id))',
      target || '_household_access', target
    );
  end loop;
end
$$;

-- Merchants may be global (household_id null) or household-owned.
create policy merchants_household_access on app.merchants
  for all to authenticated
  using (household_id is null or app.is_household_member(household_id))
  with check (household_id is not null and app.is_household_member(household_id));

create policy merchant_aliases_access on app.merchant_aliases
  for all to authenticated
  using (
    exists (
      select 1 from app.merchants m
       where m.id = merchant_id
         and (m.household_id is null or app.is_household_member(m.household_id))
    )
  )
  with check (
    exists (
      select 1 from app.merchants m
       where m.id = merchant_id
         and m.household_id is not null
         and app.is_household_member(m.household_id)
    )
  );

-- Budget lines inherit their budget's household.
alter table app.budget_lines enable row level security;
alter table app.budget_lines force row level security;
create policy budget_lines_access on app.budget_lines
  for all to authenticated
  using (
    exists (
      select 1 from app.budgets b
       where b.id = budget_id and app.is_household_member(b.household_id)
    )
  )
  with check (
    exists (
      select 1 from app.budgets b
       where b.id = budget_id and app.is_household_member(b.household_id)
    )
  );

create policy household_settings_access on app.household_settings
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on
  app.accounts, app.merchants, app.merchant_aliases, app.categories,
  app.transactions, app.transfers, app.duplicate_candidates, app.obligations,
  app.budgets, app.budget_lines, app.goals, app.debts, app.household_settings
  to authenticated;

grant select on app.institutions to authenticated;

update platform.schema_version
   set version = 4,
       description = 'Phase 3 — financial model: accounts, transactions, transfers, categories, merchants, budgets, goals, debts',
       applied_at = now()
 where id;
