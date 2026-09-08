-- What a household owns that is not cash, and what it is worth today.
--
-- Three things arrive together because they are one idea: a holding is a
-- quantity of something, a price is what somebody else says that something is
-- worth right now, and the two multiply into a figure the position can use.
-- Keeping them apart is what makes the figure honest — the household states the
-- quantity, a named source states the price, and the screen can say which is
-- which and when the price was taken.
--
-- **The product still holds no opinion about markets.** It records what you
-- have, values it at a quote it did not invent, and stamps that quote with its
-- source and its moment. A stale price is shown as stale rather than as
-- current, which is the whole reason `as_of` is not nullable.

-- ---------------------------------------------------------------------------
-- Where an account is held, and what it pays
-- ---------------------------------------------------------------------------

-- The rate the account earns, as the household's own statement reports it.
--
-- Asked, never assumed. A bank's savings rate changes, varies by product and by
-- balance tier, and is not something this system has a source for — seeding a
-- plausible figure would put a number nobody stated into a column every
-- projection reads. Null means «not stated», which is different from zero.
alter table app.accounts
  add column if not exists interest_rate numeric(6, 3);

comment on column app.accounts.interest_rate is
  'Annual rate as a percentage: 3.250 means 3.25%. Stated by the household from their own statement; never inferred from the institution.';

-- The banks a Panamanian household actually uses. Names only: a name is a
-- public fact and a rate is not.
insert into app.institutions (name, country)
select name, 'PA'
  from (values
    ('Banco General'),
    ('Banistmo'),
    ('BAC Credomatic'),
    ('Banco Nacional de Panamá'),
    ('Caja de Ahorros'),
    ('Global Bank'),
    ('Multibank'),
    ('Banesco'),
    ('Scotiabank'),
    ('Credicorp Bank'),
    ('Towerbank'),
    ('Capital Bank'),
    ('Banco Aliado'),
    ('Prival Bank'),
    ('St. Georges Bank'),
    ('Mercantil Banco'),
    ('Unibank'),
    ('Banco Lafise'),
    ('Metrobank'),
    ('Canal Bank')
  ) as seed (name)
 where not exists (
   select 1 from app.institutions i where i.name = seed.name and i.country = 'PA'
 );

-- ---------------------------------------------------------------------------
-- Prices
-- ---------------------------------------------------------------------------

create table if not exists app.market_prices (
  -- As the provider names it: `AAPL`, `VOO`, `BTC-USD`. Uppercased on the way
  -- in so one household's `btc-usd` and another's `BTC-USD` are one row.
  symbol           text primary key,
  kind             text not null check (kind in ('equity', 'crypto', 'etf', 'other')),
  display_name     text not null,

  -- Eight decimals, and deliberately not the money type. A price is a quote,
  -- not an amount somebody holds: a satoshi is 0.00000001 BTC and rounding a
  -- quote to four places would make small crypto positions value at zero. The
  -- *value* of a holding is money and is rounded to the currency at the end.
  price            numeric(19, 8) not null check (price >= 0),
  currency         char(3) not null references platform.currencies (code),
  previous_close   numeric(19, 8) check (previous_close >= 0),

  -- Who said so, and when they said it. Both required: a price without a
  -- source is a rumour, and a price without a time is a lie by omission.
  source           text not null,
  as_of            timestamptz not null,

  updated_at       timestamptz not null default now()
);

comment on table app.market_prices is
  'Last known quote per symbol, shared across households. Reference data, not household data: it says what a market said, never what a household owns.';

alter table app.market_prices enable row level security;
alter table app.market_prices force row level security;

-- Readable by anyone signed in — a quote is public information and belongs to
-- no household. Written only by the service role, so nothing a request carries
-- can change what a price says.
drop policy if exists market_prices_readable on app.market_prices;
create policy market_prices_readable on app.market_prices for select to authenticated using (true);

-- A policy decides which rows; a grant decides whether the role may look at
-- the table at all. Both are needed, and forgetting the second fails as
-- «permission denied for table», which reads nothing like a missing GRANT when
-- the policy is sitting right there above it.
grant select on app.market_prices to authenticated;

-- ---------------------------------------------------------------------------
-- Holdings
-- ---------------------------------------------------------------------------

create table if not exists app.holdings (
  id               uuid primary key default public.uuid_generate_v7(),
  household_id     uuid not null references app.households (id) on delete cascade,
  -- Whose it is, when it belongs to a person rather than to the household.
  person_id        uuid references app.household_people (id) on delete set null,

  kind             text not null check (kind in ('equity', 'crypto', 'etf', 'other')),
  symbol           text not null,
  -- What the household calls it. The provider's name is on the price row.
  label            text not null,

  -- Ten decimals: crypto is divisible far past a cent, and a quantity is not
  -- money. Positive only — a short position is a different instrument and a
  -- different conversation, and pretending a negative quantity models one
  -- would put a wrong number in front of somebody.
  quantity         numeric(28, 10) not null check (quantity > 0),

  -- What was paid, when the household knows it. Optional, because plenty of
  -- people do not, and a cost basis invented to complete a form is worse than
  -- an absent one: it turns an unknown gain into a stated one.
  cost_basis       numeric(19, 4),
  currency         char(3) not null default 'USD' references platform.currencies (code),

  notes            text,
  created_by       uuid references app.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

comment on table app.holdings is
  'What a household owns beyond cash: shares, funds, crypto. The quantity is stated by the household; the price it is valued at comes from app.market_prices and carries its own source and moment.';

create index if not exists holdings_household_idx
  on app.holdings (household_id)
  where deleted_at is null;

create index if not exists holdings_symbol_idx
  on app.holdings (symbol)
  where deleted_at is null;

alter table app.holdings enable row level security;
alter table app.holdings force row level security;

drop policy if exists holdings_household_access on app.holdings;
create policy holdings_household_access on app.holdings
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

drop policy if exists holdings_readable_by_accountant on app.holdings;
create policy holdings_readable_by_accountant on app.holdings
  for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));

grant select, insert, update, delete on app.holdings to authenticated;

update platform.schema_version
   set version = 30,
       description = 'Holdings and the quotes that value them; the rate an account pays; the banks of Panama',
       applied_at = now()
 where id;
