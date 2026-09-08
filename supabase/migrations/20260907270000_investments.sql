-- ---------------------------------------------------------------------------
-- Investing, as modelling rather than advice
-- ---------------------------------------------------------------------------
--
-- The product does not recommend instruments. Naming a security to buy is
-- regulated advice in every market this will operate in, and it would break the
-- rule the rest of the system is built on: no figure a household acts on may
-- come from a model rather than from arithmetic they can check.
--
-- What it does instead is answer a question the household already has —
-- «how much would I have to put aside every month to reach this, and what does
-- taking more risk actually buy me?» — with the assumptions visible, editable,
-- and stated as assumptions.
--
-- Two tables. A profile, which is how much risk this household says it will
-- carry and how much it can put in. And a watchlist, which is what they are
-- interested in looking at — the input to the charts and to the explanations,
-- and never a list of things the product told them to buy.

create type app.risk_level as enum ('cash', 'conservative', 'balanced', 'growth');

create table app.investment_profiles (
  household_id     uuid primary key references app.households (id) on delete cascade,

  risk_level       app.risk_level not null default 'balanced',

  -- What the household says it can put in every month. Stated, not inferred
  -- from the plan: what is left over and what somebody is willing to lock away
  -- are different numbers, and only they know the second.
  monthly_capacity numeric(19, 4) not null default 0 check (monthly_capacity >= 0),
  currency         char(3) not null default 'USD' references platform.currencies (code),

  -- The assumption band, in whole percent a year. Overridable per household
  -- precisely because these are assumptions: a figure the product refuses to
  -- let anybody argue with is a figure being passed off as knowledge.
  assumed_low      numeric(6, 3),
  assumed_expected numeric(6, 3),
  assumed_high     numeric(6, 3),

  -- What they care about, in their words: «energía», «bonos de Panamá»,
  -- «tecnología». Feeds the explanation, never the recommendation.
  interests        text[] not null default '{}',

  -- Recorded because it changes what the product is allowed to say. A household
  -- with no emergency fund should be told that before anything else.
  has_emergency_fund boolean not null default false,

  -- Set the first time a household reads the risk disclosure. Without it the
  -- module renders its modelling behind the disclosure rather than under it.
  acknowledged_at  timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint investment_profiles_band_is_ordered
    check (
      assumed_low is null or assumed_expected is null or assumed_high is null
      or (assumed_low <= assumed_expected and assumed_expected <= assumed_high)
    )
);

create trigger investment_profiles_set_updated_at
  before update on app.investment_profiles
  for each row execute function public.set_updated_at();

comment on table app.investment_profiles is
  'How much risk a household says it carries, and the assumptions its modelling uses.';

create table app.investment_watchlist (
  id           uuid primary key default public.uuid_generate_v7(),
  household_id uuid not null references app.households (id) on delete cascade,

  -- As TradingView addresses it: `NASDAQ:AAPL`, `AMEX:SPY`, `TVC:GOLD`. Stored
  -- verbatim because it is a third party's identifier, not ours to normalise.
  symbol       text not null check (length(btrim(symbol)) between 1 and 40),
  -- What the household calls it. The symbol is the machine's name for it.
  label        text not null check (length(btrim(label)) between 1 and 80),
  note         text,

  -- The goal this is being watched for, when it is being watched for one.
  goal_id      uuid references app.goals (id) on delete set null,

  created_by   uuid references app.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),

  unique (household_id, symbol)
);

create index investment_watchlist_household_idx
  on app.investment_watchlist (household_id, created_at);

comment on table app.investment_watchlist is
  'What a household asked to look at. Never a list of things the product proposed.';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table app.investment_profiles enable row level security;
alter table app.investment_profiles force row level security;

create policy investment_profiles_household_access on app.investment_profiles
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

grant select, insert, update, delete on app.investment_profiles to authenticated;

alter table app.investment_watchlist enable row level security;
alter table app.investment_watchlist force row level security;

create policy investment_watchlist_household_access on app.investment_watchlist
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

grant select, insert, update, delete on app.investment_watchlist to authenticated;

-- ---------------------------------------------------------------------------
-- The category tree a household never got
-- ---------------------------------------------------------------------------
--
-- `app.category_templates` has held thirty-eight rows since the second
-- migration and nothing ever copied them into a household. The consequence was
-- quiet and total: no household had a single category, so the classifier had
-- nowhere to file anything, budgets had nothing to budget, and the categories
-- screen was empty for everybody.
--
-- A function rather than a trigger on `households`, because it has to be
-- callable again — for the households that already exist, and for one that
-- archived a category it wants back.

create or replace function app.seed_household_categories(target_household uuid)
returns integer
language plpgsql
security definer
set search_path = app, public, pg_temp
as $$
declare
  parents integer := 0;
  children integer := 0;
begin
  if not app.is_household_member(target_household) then
    raise exception 'Only a member may seed a household''s categories.'
      using errcode = '42501';
  end if;

  -- Parents first, so a child can find the row it hangs from.
  insert into app.categories (household_id, template_slug, name, kind, sort_order, is_system)
  select target_household, t.slug, t.name_es, t.kind, t.sort_order, true
    from app.category_templates t
   where t.parent_slug is null
     and not exists (
       select 1 from app.categories c
        where c.household_id = target_household and c.template_slug = t.slug
     );

  get diagnostics parents = row_count;

  insert into app.categories
    (household_id, parent_id, template_slug, name, kind, sort_order, is_system)
  select target_household, parent.id, t.slug, t.name_es, t.kind, t.sort_order, true
    from app.category_templates t
    join app.categories parent
      on parent.household_id = target_household
     and parent.template_slug = t.parent_slug
   where t.parent_slug is not null
     and not exists (
       select 1 from app.categories c
        where c.household_id = target_household and c.template_slug = t.slug
     );

  get diagnostics children = row_count;

  return parents + children;
end;
$$;

grant execute on function app.seed_household_categories(uuid) to authenticated;

comment on function app.seed_household_categories(uuid) is
  'Copies the global category templates into a household. Idempotent; safe to call again.';

update platform.schema_version
   set version = 27,
       description = 'Investments — risk modelling and a watchlist; and the category tree households never got',
       applied_at = now()
 where id;
