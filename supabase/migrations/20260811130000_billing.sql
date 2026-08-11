-- Billing.
--
-- Two decisions are enforced here rather than remembered.
--
-- **Pricing and limits are rows.** No plan name appears in a comparison anywhere
-- in the application; a feature asks what a household is entitled to and gets a
-- number. Running a promotion, correcting a limit, granting one customer an
-- exception or adding a tier is an update, not a deployment (spec §85).
--
-- **A webhook cannot be applied twice.** `billing_events` holds the processor's
-- own event id under a unique constraint, and the handler claims it before
-- acting. A processor redelivering an event is normal operation; extending a
-- subscription twice because of it is not.

create type platform.billing_interval as enum ('month', 'year');

create type platform.subscription_status as enum (
  'trialing', 'active', 'past_due', 'grace', 'canceled', 'expired'
);

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

create table platform.plans (
  code           text primary key,
  name           text not null,

  price_amount   numeric(19, 4) not null check (price_amount >= 0),
  currency       char(3) not null default 'USD' references platform.currencies (code),
  billing_interval platform.billing_interval not null default 'month',

  is_active      boolean not null default true,
  sort_order     integer not null default 0,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table platform.plans is
  'Pricing lives here, never in a component. The figures seeded below come from the specification and are not a commercial commitment; final pricing is an open decision.';

create table platform.plan_entitlements (
  plan_code      text not null references platform.plans (code) on delete cascade,
  entitlement_key text not null check (entitlement_key in (
    'transactions_per_month', 'household_members', 'document_imports', 'rules',
    'goals', 'reports', 'tax_engine', 'accountant_mode', 'white_label', 'ai_usage'
  )),

  -- Null is unlimited. Zero is "not included", which is a different thing and
  -- the distinction decides whether a screen renders at all.
  limit_value    integer check (limit_value is null or limit_value >= 0),

  primary key (plan_code, entitlement_key)
);

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------

create table platform.subscriptions (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,
  plan_code      text not null references platform.plans (code),

  status         platform.subscription_status not null default 'trialing',

  -- The processor's identifiers, confined to these two columns. Nothing else in
  -- the system knows a provider's name, which is what lets entitlements be
  -- answered from the database while the processor is unreachable.
  provider       text,
  provider_customer_ref text,
  provider_subscription_ref text,

  current_period_start date not null,
  current_period_end   date not null,
  trial_ends_on  date,

  -- Set when the household asked to stop. Access continues to the period end:
  -- they paid for this month and they keep this month.
  cancel_at      date,
  canceled_at    timestamptz,
  -- A failed payment starts a window, not an eviction. Cutting access on the
  -- first decline loses customers whose bank simply flagged a foreign charge.
  grace_ends_on  date,

  -- Per-household exceptions, in both directions. A support grant and a support
  -- restriction are the same mechanism.
  entitlement_overrides jsonb not null default '{}'::jsonb,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint subscriptions_period check (current_period_end > current_period_start),
  constraint subscriptions_one_active_per_household unique (household_id)
);

create index subscriptions_provider_ref_idx
  on platform.subscriptions (provider, provider_subscription_ref);

-- ---------------------------------------------------------------------------
-- Events and invoices
-- ---------------------------------------------------------------------------

create table platform.billing_events (
  id             uuid primary key default public.uuid_generate_v7(),
  provider       text not null,
  -- The processor's own id. This unique constraint is the idempotency
  -- guarantee: two concurrent deliveries race here, in the database, rather than
  -- in a check-then-write window both can pass.
  event_id       text not null,

  event_type     text not null,
  payload        jsonb not null,

  received_at    timestamptz not null default now(),
  processed_at   timestamptz,
  outcome        text check (outcome in ('applied', 'duplicate', 'ignored', 'failed')),

  constraint billing_events_unique unique (provider, event_id)
);

create index billing_events_unprocessed_idx
  on platform.billing_events (received_at)
  where processed_at is null;

create table platform.invoices (
  id             uuid primary key default public.uuid_generate_v7(),
  subscription_id uuid not null references platform.subscriptions (id) on delete cascade,

  provider       text,
  provider_invoice_ref text,

  amount         numeric(19, 4) not null check (amount >= 0),
  currency       char(3) not null default 'USD' references platform.currencies (code),
  status         text not null check (status in ('draft', 'open', 'paid', 'void', 'uncollectible', 'refunded')),

  issued_on      date not null,
  paid_at        timestamptz,

  created_at     timestamptz not null default now(),

  constraint invoices_provider_ref_unique unique (provider, provider_invoice_ref)
);

-- ---------------------------------------------------------------------------
-- Usage
-- ---------------------------------------------------------------------------
--
-- Counted per household per period, so an entitlement check is one indexed read
-- rather than a scan over transactions.

create table app.usage_counters (
  household_id   uuid not null references app.households (id) on delete cascade,
  entitlement_key text not null,
  period_start   date not null,

  used           integer not null default 0 check (used >= 0),
  updated_at     timestamptz not null default now(),

  primary key (household_id, entitlement_key, period_start)
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

grant select on platform.plans, platform.plan_entitlements to anon, authenticated;

alter table platform.plans enable row level security;
alter table platform.plans force row level security;

-- The pricing page is public, so the catalogue is world-readable. It contains
-- no customer data.
create policy plans_readable on platform.plans for select using (is_active);

alter table platform.plan_entitlements enable row level security;
alter table platform.plan_entitlements force row level security;

create policy plan_entitlements_readable on platform.plan_entitlements
  for select
  using (exists (select 1 from platform.plans p where p.code = plan_code and p.is_active));

alter table platform.subscriptions enable row level security;
alter table platform.subscriptions force row level security;

-- A household reads its own subscription and never writes it. Billing state is
-- changed by the processor's webhooks through the service role, because a tenant
-- who can update their own plan code has been handed the product for free.
create policy subscriptions_readable on platform.subscriptions
  for select to authenticated
  using (app.is_household_member(household_id));

alter table platform.invoices enable row level security;
alter table platform.invoices force row level security;

create policy invoices_readable on platform.invoices
  for select to authenticated
  using (
    exists (
      select 1 from platform.subscriptions s
       where s.id = subscription_id and app.is_household_member(s.household_id)
    )
  );

-- Events are never readable by a customer. They carry another tenant's
-- identifiers as often as not.
alter table platform.billing_events enable row level security;
alter table platform.billing_events force row level security;

alter table app.usage_counters enable row level security;
alter table app.usage_counters force row level security;

create policy usage_counters_readable on app.usage_counters
  for select to authenticated
  using (app.is_household_member(household_id));

grant select on platform.subscriptions, platform.invoices to authenticated;
grant select on app.usage_counters to authenticated;

create trigger plans_updated_at
  before update on platform.plans
  for each row execute function public.set_updated_at();

create trigger subscriptions_updated_at
  before update on platform.subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Catalogue seed
-- ---------------------------------------------------------------------------
--
-- The figures from the specification. Final pricing is an open decision on the
-- user's list, so these are a starting catalogue and not a commitment. They are
-- rows precisely so that changing them is not a release.

insert into platform.plans (code, name, price_amount, billing_interval, is_active, sort_order)
values
  ('FREE',        'Free',        0.00,  'month', true,  0),
  ('PLUS',        'Plus',        9.99,  'month', true,  1),
  ('COUPLE',      'Couple',      17.99, 'month', true,  2),
  ('PRO',         'Pro',         29.99, 'month', true,  3),
  ('FAMILY',      'Family',      39.99, 'month', true,  4),
  ('ACCOUNTANT',  'Accountant',  0.00,  'month', false, 5),
  ('WHITE_LABEL', 'White label', 0.00,  'month', false, 6)
on conflict (code) do nothing;

insert into platform.plan_entitlements (plan_code, entitlement_key, limit_value)
values
  ('FREE', 'transactions_per_month', 250),
  ('FREE', 'household_members', 1),
  ('FREE', 'document_imports', 3),
  ('FREE', 'rules', 3),
  ('FREE', 'goals', 2),
  ('FREE', 'reports', 3),
  ('FREE', 'tax_engine', 0),
  ('FREE', 'accountant_mode', 0),
  ('FREE', 'white_label', 0),
  ('FREE', 'ai_usage', 0),

  ('PLUS', 'transactions_per_month', null),
  ('PLUS', 'household_members', 1),
  ('PLUS', 'document_imports', 25),
  ('PLUS', 'rules', 25),
  ('PLUS', 'goals', 10),
  ('PLUS', 'reports', null),
  ('PLUS', 'tax_engine', 0),
  ('PLUS', 'accountant_mode', 0),
  ('PLUS', 'white_label', 0),
  ('PLUS', 'ai_usage', 200),

  ('COUPLE', 'transactions_per_month', null),
  ('COUPLE', 'household_members', 2),
  ('COUPLE', 'document_imports', 50),
  ('COUPLE', 'rules', 50),
  ('COUPLE', 'goals', 20),
  ('COUPLE', 'reports', null),
  ('COUPLE', 'tax_engine', 0),
  ('COUPLE', 'accountant_mode', 0),
  ('COUPLE', 'white_label', 0),
  ('COUPLE', 'ai_usage', 400),

  ('PRO', 'transactions_per_month', null),
  ('PRO', 'household_members', 2),
  ('PRO', 'document_imports', null),
  ('PRO', 'rules', null),
  ('PRO', 'goals', null),
  ('PRO', 'reports', null),
  ('PRO', 'tax_engine', 1),
  ('PRO', 'accountant_mode', 0),
  ('PRO', 'white_label', 0),
  ('PRO', 'ai_usage', 1000),

  ('FAMILY', 'transactions_per_month', null),
  ('FAMILY', 'household_members', 6),
  ('FAMILY', 'document_imports', null),
  ('FAMILY', 'rules', null),
  ('FAMILY', 'goals', null),
  ('FAMILY', 'reports', null),
  ('FAMILY', 'tax_engine', 1),
  ('FAMILY', 'accountant_mode', 0),
  ('FAMILY', 'white_label', 0),
  ('FAMILY', 'ai_usage', 1500),

  ('ACCOUNTANT', 'transactions_per_month', null),
  ('ACCOUNTANT', 'household_members', null),
  ('ACCOUNTANT', 'document_imports', null),
  ('ACCOUNTANT', 'rules', null),
  ('ACCOUNTANT', 'goals', null),
  ('ACCOUNTANT', 'reports', null),
  ('ACCOUNTANT', 'tax_engine', 1),
  ('ACCOUNTANT', 'accountant_mode', 1),
  ('ACCOUNTANT', 'white_label', 0),
  ('ACCOUNTANT', 'ai_usage', 2000),

  ('WHITE_LABEL', 'transactions_per_month', null),
  ('WHITE_LABEL', 'household_members', null),
  ('WHITE_LABEL', 'document_imports', null),
  ('WHITE_LABEL', 'rules', null),
  ('WHITE_LABEL', 'goals', null),
  ('WHITE_LABEL', 'reports', null),
  ('WHITE_LABEL', 'tax_engine', 1),
  ('WHITE_LABEL', 'accountant_mode', 1),
  ('WHITE_LABEL', 'white_label', 1),
  ('WHITE_LABEL', 'ai_usage', 5000)
on conflict (plan_code, entitlement_key) do nothing;

update platform.schema_version
   set version = 13,
       description = 'Phase 14 — billing: plan catalogue, entitlements, subscriptions, idempotent events, usage',
       applied_at = now()
 where id;
