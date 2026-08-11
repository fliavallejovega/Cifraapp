-- The AI copilot.
--
-- AI explains this system; it never is this system. Nothing in these tables
-- holds a balance, a tax figure, a permission or a ledger entry — they hold what
-- was asked, which prompt version asked it, what it cost, and what was cached
-- (spec §41).
--
-- Two of them exist entirely to keep the feature honest. `ai_invocations` is the
-- record that makes cost real rather than estimated at the end of the month, and
-- `ai_budgets` is the ceiling that is checked before a call rather than after
-- it. A copilot without both is a bill nobody predicted.

create type app.ai_feature as enum (
  'merchant_classification',
  'allocation_explanation',
  'anomaly_summary',
  'budget_suggestion',
  'document_interpretation',
  'rule_proposal',
  'scenario_narration',
  'question_answer'
);

-- Every way a call can end. The failures are ordinary outcomes, logged with the
-- successes, because the ratio between them is the only signal that a prompt
-- revision made things worse.
create type app.ai_outcome as enum (
  'ok',
  'cache_hit',
  'not_configured',
  'budget_exhausted',
  'missing_grounding',
  'transport_error',
  'malformed_output',
  'ungrounded_figures',
  'refused'
);

-- ---------------------------------------------------------------------------
-- Model catalogue and pricing
-- ---------------------------------------------------------------------------
--
-- Pricing lives here, not in code. A provider changing a rate must not need a
-- deployment, and the cost recorded against a call must be the rate that was in
-- force when it was made.
--
-- The unit is the micro-dollar: an integer millionth of a currency unit. Model
-- pricing is quoted per million tokens and a single call costs a fraction of a
-- hundredth of a cent, which numeric(19,4) — right for a household ledger —
-- would round to nothing. Token counts on each invocation remain the
-- authoritative record; cost is derived from them and always an estimate.

create table platform.ai_models (
  provider       text not null,
  model_key      text not null,
  display_name   text not null,

  input_micros_per_million  bigint not null check (input_micros_per_million >= 0),
  output_micros_per_million bigint not null check (output_micros_per_million >= 0),
  currency       char(3) not null default 'USD' references platform.currencies (code),

  context_window integer,
  is_active      boolean not null default true,

  -- Where the figures came from and when anyone last confirmed them. A price
  -- nobody has checked is a guess, and the column says so out loud.
  price_source_url text,
  price_checked_at timestamptz,

  created_at     timestamptz not null default now(),

  primary key (provider, model_key)
);

comment on column platform.ai_models.price_checked_at is
  'Null means these rates have never been verified against the provider''s published pricing. Cost estimates derived from them are indicative only.';

-- ---------------------------------------------------------------------------
-- Spending
-- ---------------------------------------------------------------------------

create table app.ai_budgets (
  household_id   uuid primary key references app.households (id) on delete cascade,

  -- Zero means uncapped. A deployment that has not decided is not silently
  -- given an unlimited allowance by default — the application supplies its own
  -- ceiling when no row exists.
  monthly_cap_micros bigint not null default 0 check (monthly_cap_micros >= 0),

  updated_at     timestamptz not null default now()
);

create table app.ai_invocations (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,
  profile_id     uuid references app.profiles (id) on delete set null,

  feature        app.ai_feature not null,
  -- `allocation-explanation-v1`. The version is part of the identifier because a
  -- prompt revision is a new prompt, and comparing two of them on real logs is
  -- the only way to know whether the revision helped.
  prompt_id      text not null,
  locale         text not null default 'es',

  provider       text not null,
  model          text not null,

  input_tokens   integer not null default 0 check (input_tokens >= 0),
  output_tokens  integer not null default 0 check (output_tokens >= 0),
  cost_micros    bigint not null default 0 check (cost_micros >= 0),

  cache_hit      boolean not null default false,
  latency_ms     integer not null default 0 check (latency_ms >= 0),

  outcome        app.ai_outcome not null,
  -- Why it failed, in the engine's own words. Never the provider's response
  -- body: that can echo the prompt, and the prompt carries household facts.
  failure_detail text,

  created_at     timestamptz not null default now(),

  -- A cache hit costs nothing. Recording the original cost here would bill the
  -- household again every time the answer is served.
  constraint ai_invocations_cache_hits_are_free
    check (not cache_hit or cost_micros = 0)
);

create index ai_invocations_household_idx
  on app.ai_invocations (household_id, created_at desc);

create index ai_invocations_spend_idx
  on app.ai_invocations (household_id, created_at)
  where cost_micros > 0;

-- ---------------------------------------------------------------------------
-- Cache
-- ---------------------------------------------------------------------------
--
-- "Is SUPERMERCADO REY 04 a grocery store" has the same answer every time.
-- Entries are scoped to a household because the key is a hash of facts, and one
-- household's facts must never produce another household's answer — even when
-- the hash happens to match.

create table app.ai_cache (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,

  cache_key      text not null,
  prompt_id      text not null,
  model          text not null,

  output         jsonb not null,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,

  hits           integer not null default 0 check (hits >= 0),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz,

  constraint ai_cache_unique_per_household unique (household_id, cache_key)
);

create index ai_cache_expiry_idx on app.ai_cache (expires_at)
  where expires_at is not null;

-- ---------------------------------------------------------------------------
-- Scenarios
-- ---------------------------------------------------------------------------
--
-- "What if we bought a car." A scenario is stored assumptions, never a change to
-- anything real: the engine projects from a snapshot and writes nothing back.
-- That isolation is the reason a household can safely model losing their job.

create table app.scenarios (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,

  name           text not null check (length(trim(name)) between 1 and 120),
  kind           text not null,

  -- The changes, as the scenario engine's own shape. Validated by the engine on
  -- read, the same way stored rules are.
  changes        jsonb not null default '[]'::jsonb,
  horizon_months integer not null default 60 check (horizon_months between 1 and 600),

  created_by     uuid references app.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index scenarios_household_idx on app.scenarios (household_id)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

grant select on platform.ai_models to authenticated;

alter table platform.ai_models enable row level security;
alter table platform.ai_models force row level security;

create policy ai_models_readable on platform.ai_models
  for select to authenticated
  using (is_active);

alter table app.ai_budgets enable row level security;
alter table app.ai_budgets force row level security;

create policy ai_budgets_household_access on app.ai_budgets
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

alter table app.ai_invocations enable row level security;
alter table app.ai_invocations force row level security;

-- Readable by the household, never rewritable by it. A spending record a tenant
-- can edit is not a spending record.
create policy ai_invocations_readable on app.ai_invocations
  for select to authenticated
  using (app.is_household_member(household_id));

create policy ai_invocations_insertable on app.ai_invocations
  for insert to authenticated
  with check (app.is_household_member(household_id));

alter table app.ai_cache enable row level security;
alter table app.ai_cache force row level security;

create policy ai_cache_household_access on app.ai_cache
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

alter table app.scenarios enable row level security;
alter table app.scenarios force row level security;

create policy scenarios_household_access on app.scenarios
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

grant select, insert, update, delete on app.ai_budgets, app.ai_cache, app.scenarios
  to authenticated;
grant select, insert on app.ai_invocations to authenticated;

-- ---------------------------------------------------------------------------
-- Catalogue seed
-- ---------------------------------------------------------------------------
--
-- Starting points, not published prices. `price_checked_at` is null on every
-- row: nobody has confirmed these against the providers, so every cost derived
-- from them is indicative until an administrator updates the rate and stamps the
-- column. The application shows AI spending as an estimate for that reason.

insert into platform.ai_models
  (provider, model_key, display_name, input_micros_per_million, output_micros_per_million, context_window, price_source_url)
values
  ('anthropic', 'claude-sonnet-5', 'Claude Sonnet 5', 3000000, 15000000, 200000, 'https://www.anthropic.com/pricing'),
  ('anthropic', 'claude-haiku-4-5-20251001', 'Claude Haiku 4.5', 1000000, 5000000, 200000, 'https://www.anthropic.com/pricing'),
  ('openai', 'gpt-4.1', 'GPT-4.1', 2000000, 8000000, 128000, 'https://openai.com/api/pricing')
on conflict (provider, model_key) do nothing;

update platform.schema_version
   set version = 10,
       description = 'Phase 11 — AI copilot: model catalogue, invocations, budgets, cache and scenarios',
       applied_at = now()
 where id;
