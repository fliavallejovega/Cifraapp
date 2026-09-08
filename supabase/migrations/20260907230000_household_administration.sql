-- ---------------------------------------------------------------------------
-- What the household administers directly
-- ---------------------------------------------------------------------------
--
-- Two things the product promises and the schema had nowhere to put.
--
-- 1. The people. `household_settings.member_count` records how many people the
--    income covers, which is enough to reason about a figure and not enough to
--    show anyone. "Four people, two of them dependents" cannot answer «who is
--    the second earner» or «which child is this expense for». A membership row
--    is not the answer either: a membership is an account that can sign in, and
--    a six-year-old does not have one. So a person in the house is its own row,
--    optionally linked to a membership when that person also signs in.
--
-- 2. The splits. One card charge at a supermarket is groceries and a birthday
--    present, and forcing it into one category is how a budget stops matching
--    what happened. A split does not rewrite the transaction — the transaction
--    keeps its own amount and its own category, and the splits say how that
--    amount divides. A trigger holds the sum to the transaction's amount, so a
--    split that does not add up cannot be stored at all.

create table app.household_people (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,

  -- The membership this person signs in with, when they do. Null for a child,
  -- a dependent parent, or a partner who has not been invited yet.
  member_id      uuid references app.household_members (id) on delete set null,

  display_name   text not null check (length(btrim(display_name)) between 1 and 120),
  relationship   text not null default 'other'
                 check (relationship in ('self','partner','child','parent','sibling','other')),

  -- Whether the household income has to cover this person. It is the fact every
  -- explanation needs, and it is stated rather than inferred from an age.
  is_dependent   boolean not null default false,

  -- A year, not a birth date. The month and day buy nothing the product uses
  -- and are the kind of detail a financial system should not be holding.
  birth_year     smallint check (birth_year between 1900 and 2200),

  notes          text,

  created_by     uuid references app.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index household_people_household_idx
  on app.household_people (household_id)
  where deleted_at is null;

-- One person per membership. Two rows claiming the same sign-in would make
-- «who earns this» unanswerable.
create unique index household_people_member_unique
  on app.household_people (member_id)
  where member_id is not null and deleted_at is null;

create trigger household_people_set_updated_at
  before update on app.household_people
  for each row execute function public.set_updated_at();

comment on table app.household_people is
  'Everyone the household income covers, whether or not they can sign in.';

-- ---------------------------------------------------------------------------

create table app.transaction_splits (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,
  transaction_id uuid not null references app.transactions (id) on delete cascade,

  category_id    uuid references app.categories (id) on delete set null,
  -- Held positive and in the transaction's own direction, exactly like the
  -- amount it divides. A split that could be negative would let two lines
  -- cancel out and still satisfy the sum.
  amount         numeric(19, 4) not null check (amount > 0),

  scope          app.financial_scope not null default 'household',
  -- Which person in the house this part of the charge was for. Optional: most
  -- splits are about categories, some are about people.
  person_id      uuid references app.household_people (id) on delete set null,

  note           text,
  position       integer not null default 0,

  created_by     uuid references app.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index transaction_splits_transaction_idx
  on app.transaction_splits (transaction_id, position);

create index transaction_splits_household_idx
  on app.transaction_splits (household_id, category_id);

create trigger transaction_splits_set_updated_at
  before update on app.transaction_splits
  for each row execute function public.set_updated_at();

comment on table app.transaction_splits is
  'How one transaction divides across categories. The sum always equals the transaction amount.';

-- A split set that does not add up is worse than no split at all: every report
-- reading it would be quietly wrong. Enforced in the database because the
-- product is not the only thing that writes here — an import, a rule and a
-- correction all can.
create or replace function app.assert_splits_balance()
returns trigger
language plpgsql
security definer
set search_path = app, public
as $$
declare
  target_transaction uuid := coalesce(new.transaction_id, old.transaction_id);
  split_total numeric(19, 4);
  transaction_total numeric(19, 4);
begin
  select coalesce(sum(amount), 0) into split_total
    from app.transaction_splits
   where transaction_id = target_transaction;

  -- No splits left is a valid state: the transaction simply carries its own
  -- single category again.
  if split_total = 0 then
    return null;
  end if;

  select abs(amount) into transaction_total
    from app.transactions
   where id = target_transaction;

  if transaction_total is null or split_total <> transaction_total then
    raise exception 'transaction splits must sum to the transaction amount (% <> %)',
      split_total, transaction_total
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

-- Deferred to the end of the statement so a multi-row insert is judged once,
-- when the set is complete, rather than after the first line.
create constraint trigger transaction_splits_balance
  after insert or update or delete on app.transaction_splits
  deferrable initially deferred
  for each row execute function app.assert_splits_balance();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table app.household_people enable row level security;
alter table app.household_people force row level security;

create policy household_people_household_access on app.household_people
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

grant select, insert, update, delete on app.household_people to authenticated;

alter table app.transaction_splits enable row level security;
alter table app.transaction_splits force row level security;

create policy transaction_splits_household_access on app.transaction_splits
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

grant select, insert, update, delete on app.transaction_splits to authenticated;

update platform.schema_version
   set version = 23,
       description = 'Household administration — the people in the house, and how one charge divides',
       applied_at = now()
 where id;
