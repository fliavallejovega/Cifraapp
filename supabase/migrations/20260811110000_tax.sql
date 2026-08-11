-- The tax engine.
--
-- The highest legal risk in this project, and the schema is shaped by that
-- rather than by convenience.
--
-- A tax rule is a fact about the world on a date, published by an authority, and
-- it changes. Encoding one in application code makes it a fact about a
-- deployment instead — undated, unsourced, and wrong the moment the law moves.
-- So rules live here, versioned, with their source, and they change without a
-- release (spec §45).
--
-- Two invariants the database enforces rather than trusts:
--
--   1. A **published** rule set requires a named reviewer and a review date on
--      the set. Publication is a person putting their name on figures they
--      checked against the primary source. Nothing else is publication.
--   2. Every stored calculation records the **rule set version** that produced
--      it. The figure a household saw in March must still be explainable in
--      November after the rules have moved twice.

create type platform.rule_set_status as enum (
  'draft', 'in_review', 'approved', 'published', 'superseded'
);

create type app.taxpayer_status as enum (
  'salaried',
  'independent_professional',
  'freelancer',
  'merchant',
  'mixed_income',
  'personal_business'
);

create type app.accounting_method as enum ('cash', 'accrual');

create type app.expense_classification as enum (
  'PERSONAL',
  'BUSINESS',
  'MIXED',
  'NON_DEDUCTIBLE',
  'POTENTIALLY_DEDUCTIBLE',
  'REQUIRES_REVIEW'
);

-- ---------------------------------------------------------------------------
-- Versioned, sourced rules
-- ---------------------------------------------------------------------------

create table platform.tax_rule_sets (
  id             uuid primary key default public.uuid_generate_v7(),
  jurisdiction   char(2) not null references platform.tax_jurisdictions (code),
  fiscal_year    integer not null check (fiscal_year between 2000 and 2100),
  version        integer not null check (version > 0),

  status         platform.rule_set_status not null default 'draft',

  effective_from date not null,
  effective_to   date,

  currency       char(3) not null references platform.currencies (code),

  reviewed_by    text,
  reviewed_at    timestamptz,
  published_at   timestamptz,
  notes          text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint tax_rule_sets_unique_version unique (jurisdiction, fiscal_year, version),
  constraint tax_rule_sets_window check (effective_to is null or effective_to >= effective_from),

  -- The rule that carries the legal risk. A set cannot reach `published`
  -- without a person's name and the date they checked it.
  constraint tax_rule_sets_publication_requires_review
    check (status <> 'published' or (reviewed_by is not null and reviewed_at is not null))
);

create index tax_rule_sets_lookup_idx
  on platform.tax_rule_sets (jurisdiction, effective_from desc, version desc);

create table platform.tax_rules (
  id             uuid primary key default public.uuid_generate_v7(),
  rule_set_id    uuid not null references platform.tax_rule_sets (id) on delete cascade,

  tax_type       text not null check (tax_type in ('income', 'itbms', 'social_security', 'municipal')),
  -- `income.brackets`, `itbms.general`. Unique within a set; the engine looks
  -- rules up by this and refuses to compute when one is missing.
  rule_key       text not null,
  kind           text not null check (kind in ('brackets', 'flat_rate', 'threshold', 'deduction', 'deadline')),

  -- The rule's own shape, in the engine's vocabulary. Validated on read the same
  -- way a stored automation rule is: a row edited by hand is caught and reported
  -- as invalid rather than trusted.
  payload        jsonb not null,

  -- Provenance travels with the rule, never in a separate document that drifts.
  source         text not null,
  source_url     text,
  source_reference text not null,
  notes          text,

  created_at     timestamptz not null default now(),

  constraint tax_rules_unique_key unique (rule_set_id, rule_key)
);

-- ---------------------------------------------------------------------------
-- The household's own tax configuration
-- ---------------------------------------------------------------------------
--
-- Asked, never inferred. Cash-basis availability, ITBMS registration and filing
-- deadlines all follow from these answers, and guessing them from transaction
-- patterns puts a household on the wrong return.

create table app.tax_profiles (
  household_id   uuid primary key references app.households (id) on delete cascade,
  jurisdiction   char(2) not null default 'PA' references platform.tax_jurisdictions (code),

  taxpayer_status app.taxpayer_status not null,
  -- Panama's taxpayer identifier. Null until the household supplies it; never
  -- derived from anything.
  ruc            text,
  activity       text,

  accounting_method app.accounting_method not null default 'cash',
  itbms_registered boolean not null default false,

  -- `MM-DD`. Most fiscal years are calendar years. Assuming it for the ones that
  -- are not costs a filing.
  fiscal_year_start text not null default '01-01'
    check (fiscal_year_start ~ '^\d{2}-\d{2}$'),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Estimates
-- ---------------------------------------------------------------------------

create table app.tax_estimates (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,

  -- Which rules produced this. Without it the figure is unexplainable the moment
  -- the rules change, which they do every year.
  rule_set_id    uuid not null references platform.tax_rule_sets (id),

  period_start   date not null,
  period_end     date not null,

  gross_income   numeric(19, 4) not null default 0,
  deductions     numeric(19, 4) not null default 0 check (deductions >= 0),
  taxable_income numeric(19, 4) not null default 0,
  estimated_tax  numeric(19, 4) not null default 0 check (estimated_tax >= 0),

  reserve_target numeric(19, 4) not null default 0 check (reserve_target >= 0),
  reserved_to_date numeric(19, 4) not null default 0 check (reserved_to_date >= 0),

  currency       char(3) not null default 'PAB' references platform.currencies (code),

  -- True only when computed from a finalized return. Until then the product says
  -- "estimated tax reserve" and never "your tax bill".
  is_final       boolean not null default false,

  computed_at    timestamptz not null default now(),

  constraint tax_estimates_period check (period_end >= period_start)
);

create index tax_estimates_household_idx
  on app.tax_estimates (household_id, period_start desc);

-- ---------------------------------------------------------------------------
-- Expense classification
-- ---------------------------------------------------------------------------
--
-- Attached to a transaction rather than replacing its category. A category is
-- what the household calls the spending; this is what it is for tax, and the two
-- disagree often enough that collapsing them loses information.

create table app.expense_classifications (
  transaction_id uuid primary key references app.transactions (id) on delete cascade,
  household_id   uuid not null references app.households (id) on delete cascade,

  classification app.expense_classification not null,
  business_percentage smallint not null default 0
    check (business_percentage between 0 and 100),

  -- A message key, resolved through the catalogue. The engine has no language.
  reason_key     text,
  -- True until a person has confirmed it. Nothing marked true is used on a
  -- return.
  needs_review   boolean not null default true,

  decided_by     uuid references app.profiles (id) on delete set null,
  decided_at     timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Only a mixed expense carries a split. A percentage on a personal expense is
  -- a number nobody can explain.
  constraint expense_classifications_split_belongs_to_mixed
    check (classification = 'MIXED' or business_percentage = 0),

  constraint expense_classifications_decision_has_actor
    check ((decided_at is null) = (decided_by is null))
);

create index expense_classifications_review_idx
  on app.expense_classifications (household_id)
  where needs_review;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

grant select on platform.tax_rule_sets, platform.tax_rules to authenticated;

alter table platform.tax_rule_sets enable row level security;
alter table platform.tax_rule_sets force row level security;

-- Only published sets are readable by a household. A draft is working material
-- and showing one implies a figure nobody has checked.
create policy tax_rule_sets_published_readable on platform.tax_rule_sets
  for select to authenticated
  using (status = 'published');

alter table platform.tax_rules enable row level security;
alter table platform.tax_rules force row level security;

create policy tax_rules_published_readable on platform.tax_rules
  for select to authenticated
  using (
    exists (
      select 1 from platform.tax_rule_sets s
       where s.id = rule_set_id and s.status = 'published'
    )
  );

alter table app.tax_profiles enable row level security;
alter table app.tax_profiles force row level security;

create policy tax_profiles_household_access on app.tax_profiles
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

alter table app.tax_estimates enable row level security;
alter table app.tax_estimates force row level security;

create policy tax_estimates_household_access on app.tax_estimates
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

alter table app.expense_classifications enable row level security;
alter table app.expense_classifications force row level security;

create policy expense_classifications_household_access on app.expense_classifications
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

grant select, insert, update, delete
  on app.tax_profiles, app.tax_estimates, app.expense_classifications
  to authenticated;

create trigger tax_profiles_updated_at
  before update on app.tax_profiles
  for each row execute function public.set_updated_at();

create trigger tax_rule_sets_updated_at
  before update on platform.tax_rule_sets
  for each row execute function public.set_updated_at();

create trigger expense_classifications_updated_at
  before update on app.expense_classifications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Panama 2026 — DRAFT, NOT REVIEWED
-- ---------------------------------------------------------------------------
--
-- These figures were transcribed from the commonly cited text of the Código
-- Fiscal. Nobody has verified them against a primary DGI publication, so the set
-- is `draft`, `reviewed_by` is null, and the RLS policy above makes it invisible
-- to every household. `platform.tax_jurisdictions.is_supported` for PA stays
-- false.
--
-- Publishing this is not a status change. It is a qualified person reading the
-- primary source, confirming each figure, and putting their name and the date on
-- it.

insert into platform.tax_rule_sets
  (jurisdiction, fiscal_year, version, status, effective_from, effective_to, currency, notes)
values
  ('PA', 2026, 1, 'draft', '2026-01-01', '2026-12-31', 'PAB',
   'Transcribed from the commonly cited text of the Código Fiscal. Not verified against a primary DGI publication. Must be confirmed by a qualified reviewer before publication.')
on conflict (jurisdiction, fiscal_year, version) do nothing;

insert into platform.tax_rules
  (rule_set_id, tax_type, rule_key, kind, payload, source, source_url, source_reference, notes)
select s.id, v.tax_type, v.rule_key, v.kind, v.payload::jsonb,
       'Dirección General de Ingresos (DGI), Panamá', 'https://dgi.mef.gob.pa/',
       v.source_reference, v.notes
  from platform.tax_rule_sets s
  cross join (values
    ('income', 'income.brackets', 'brackets',
     '{"brackets":[{"from":"0.0000","upTo":"11000.0000","rate":"0.000"},{"from":"11000.0000","upTo":"50000.0000","rate":"15.000"},{"from":"50000.0000","upTo":null,"rate":"25.000"}]}',
     'Código Fiscal de Panamá, artículo 700',
     'Unverified transcription. Confirm against the primary source before publication.'),
    ('itbms', 'itbms.general', 'flat_rate',
     '{"rate":"7.000"}',
     'ITBMS — general rate',
     'Unverified transcription. Confirm against the primary source before publication.'),
    ('income', 'income.return.natural_persons', 'deadline',
     '{"monthDay":"03-15","label":"Declaración jurada de rentas — personas naturales"}',
     'Annual income tax return, natural persons — filing deadline',
     'Deadlines shift by resolution more often than rates do. Unverified; confirm against the current DGI calendar.')
  ) as v(tax_type, rule_key, kind, payload, source_reference, notes)
 where s.jurisdiction = 'PA' and s.fiscal_year = 2026 and s.version = 1
on conflict (rule_set_id, rule_key) do nothing;

update platform.schema_version
   set version = 11,
       description = 'Phase 12 — tax engine: versioned sourced rules, taxpayer profiles, estimates, expense classification',
       applied_at = now()
 where id;
