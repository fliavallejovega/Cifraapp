-- The allocation engine.
--
-- The product's whole thesis: most personal finance software reports what
-- already happened, and this answers what should happen next. A plan is a
-- concrete instruction for a specific arrival of money, every line of it
-- explainable (spec §36).
--
-- Plans are stored rather than recomputed on demand. The plan a household saw
-- and acted on is the plan that must still be there afterwards — recomputing it
-- from today's balances would show them something they never agreed to.

create type app.claim_kind as enum (
  'overdue_essential',
  'upcoming_essential',
  'debt_minimum',
  'tax_reserve',
  'emergency_fund',
  'high_interest_debt',
  'investment',
  'goal',
  'discretionary'
);

-- What the household did with the plan. Acceptance rate is the single most
-- meaningful product metric: a recommendation nobody follows is not a
-- recommendation, it is a report.
create type app.plan_outcome as enum (
  'proposed', 'viewed', 'accepted', 'modified', 'dismissed'
);

create table app.allocation_plans (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,

  -- The money this plan is about. Nullable because a household may ask "what if
  -- $2,000 arrived" before it has.
  transaction_id uuid references app.transactions (id) on delete set null,
  incoming_amount numeric(19, 4) not null check (incoming_amount >= 0),
  currency       char(3) not null default 'USD' references platform.currencies (code),

  -- The ladder that produced this plan, in the order it was applied. Stored
  -- because it is configurable: a plan cannot be explained without it.
  priority_order app.claim_kind[] not null,

  allocated_amount numeric(19, 4) not null default 0 check (allocated_amount >= 0),
  unallocated_amount numeric(19, 4) not null default 0,
  shortfall_amount numeric(19, 4) not null default 0 check (shortfall_amount >= 0),

  outcome        app.plan_outcome not null default 'proposed',
  viewed_at      timestamptz,
  decided_at     timestamptz,
  decided_by     uuid references app.profiles (id) on delete set null,

  generated_for  date not null,
  created_at     timestamptz not null default now(),

  -- Every unit of the arriving money is either allocated or explicitly not.
  -- Money.allocate guarantees this in the engine; the database refuses to hold a
  -- plan where it stopped being true.
  constraint allocation_plans_balances
    check (allocated_amount + unallocated_amount = incoming_amount),

  constraint allocation_plans_decision_has_actor
    check ((outcome in ('accepted', 'modified', 'dismissed')) = (decided_at is not null))
);

create index allocation_plans_household_idx
  on app.allocation_plans (household_id, created_at desc);

create table app.allocation_lines (
  id             uuid primary key default public.uuid_generate_v7(),
  plan_id        uuid not null references app.allocation_plans (id) on delete cascade,

  kind           app.claim_kind not null,
  label          text not null,
  -- A reference the household would recognize: `debt:mastercard`, `goal:travel`.
  target         text not null,

  goal_id        uuid references app.goals (id) on delete set null,
  debt_id        uuid references app.debts (id) on delete set null,
  obligation_id  uuid references app.obligations (id) on delete set null,

  requested_amount numeric(19, 4) not null check (requested_amount >= 0),
  allocated_amount numeric(19, 4) not null check (allocated_amount >= 0),
  position       integer not null,

  -- Shown verbatim: "Allocate $228 to Mastercard because it has the highest APR
  -- at 24.5%". A plan a person cannot interrogate is one they must take on
  -- faith, and this product does not ask that.
  explanation    text not null check (length(trim(explanation)) > 0),
  applied_rule_ids uuid[] not null default '{}',

  -- What the household changed it to, when they modified the plan. Null means
  -- they left this line alone.
  accepted_amount numeric(19, 4) check (accepted_amount >= 0),

  created_at     timestamptz not null default now(),

  constraint allocation_lines_within_request
    check (allocated_amount <= requested_amount)
);

create index allocation_lines_plan_idx on app.allocation_lines (plan_id, position);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table app.allocation_plans enable row level security;
alter table app.allocation_plans force row level security;

create policy allocation_plans_household_access on app.allocation_plans
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

-- Lines inherit their plan's household, the same way budget lines inherit their
-- budget's.
alter table app.allocation_lines enable row level security;
alter table app.allocation_lines force row level security;

create policy allocation_lines_access on app.allocation_lines
  for all to authenticated
  using (
    exists (
      select 1 from app.allocation_plans p
       where p.id = plan_id and app.is_household_member(p.household_id)
    )
  )
  with check (
    exists (
      select 1 from app.allocation_plans p
       where p.id = plan_id and app.is_household_member(p.household_id)
    )
  );

grant select, insert, update, delete on app.allocation_plans, app.allocation_lines
  to authenticated;

update platform.schema_version
   set version = 9,
       description = 'Phase 10 — allocation engine: plans, lines and their outcomes',
       applied_at = now()
 where id;
