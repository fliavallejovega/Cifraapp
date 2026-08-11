-- The company's own books.
--
-- Real double-entry, in `platform`, entirely separate from any household's
-- money. A customer's subscription payment is two records in two domains — a
-- transaction in their household and a revenue event here — linked explicitly
-- and never sharing a row (spec §86).
--
-- **Every entry balances: debits equal credits.** Enforced by a deferred
-- constraint trigger, not by a helper everyone remembers to call. The deferral
-- matters: an entry is inserted with its lines inside one transaction, so the
-- check has to run at commit rather than after the first line, when the entry is
-- legitimately half-written.
--
-- There is no `balance` column anywhere in this file. A running total that
-- everything increments cannot be audited, drifts, and the drift is found a year
-- later by an accountant with no way to locate where it began.

create type platform.ledger_account_type as enum ('asset', 'liability', 'equity', 'revenue', 'expense');
create type platform.entry_side as enum ('debit', 'credit');

create table platform.ledger_accounts (
  code           text primary key,
  name           text not null,
  account_type   platform.ledger_account_type not null,

  -- Which side increases this account. A field rather than a function of the
  -- type, because a contra account is an ordinary account of its type with the
  -- opposite normal balance.
  normal_balance platform.entry_side not null,
  is_contra      boolean not null default false,

  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

create table platform.journal_entries (
  id             uuid primary key default public.uuid_generate_v7(),

  occurred_on    date not null,
  description    text not null,

  -- What caused this: a payment, a refund, a payout, a vendor invoice. Kept so
  -- an entry can be traced back to the event without reading its memo lines.
  source_kind    text not null,
  source_ref     text,

  currency       char(3) not null default 'USD' references platform.currencies (code),

  -- Set when this entry reverses another. Corrections are new entries, never
  -- edits: a posted entry is a historical claim, and editing one makes every
  -- report printed from it wrong without saying so.
  reverses_entry_id uuid references platform.journal_entries (id),

  created_at     timestamptz not null default now(),
  created_by     text,

  constraint journal_entries_source_ref_unique unique (source_kind, source_ref)
);

create index journal_entries_date_idx on platform.journal_entries (occurred_on desc);

create table platform.journal_lines (
  id             uuid primary key default public.uuid_generate_v7(),
  entry_id       uuid not null references platform.journal_entries (id) on delete cascade,

  account_code   text not null references platform.ledger_accounts (code),
  side           platform.entry_side not null,

  -- Always positive. The side carries the direction; a signed amount would let
  -- the direction be expressed twice and disagree with itself.
  amount         numeric(19, 4) not null check (amount > 0),

  memo           text,
  created_at     timestamptz not null default now()
);

create index journal_lines_entry_idx on platform.journal_lines (entry_id);
create index journal_lines_account_idx on platform.journal_lines (account_code);

-- ---------------------------------------------------------------------------
-- The invariant
-- ---------------------------------------------------------------------------

create or replace function platform.assert_entry_balances()
returns trigger
language plpgsql
as $$
declare
  target uuid;
  total_debits numeric(19, 4);
  total_credits numeric(19, 4);
  line_count integer;
begin
  target := coalesce(new.entry_id, old.entry_id);

  -- The entry may have been deleted along with its lines, which is a legitimate
  -- cascade and not an imbalance.
  if not exists (select 1 from platform.journal_entries where id = target) then
    return null;
  end if;

  select
    coalesce(sum(amount) filter (where side = 'debit'), 0),
    coalesce(sum(amount) filter (where side = 'credit'), 0),
    count(*)
    into total_debits, total_credits, line_count
    from platform.journal_lines
   where entry_id = target;

  if line_count = 0 then
    raise exception 'Journal entry % has no lines.', target
      using errcode = 'check_violation';
  end if;

  if total_debits <> total_credits then
    raise exception
      'Journal entry % does not balance: debits %, credits %.',
      target, total_debits, total_credits
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

-- Deferred to commit. An entry is written with its lines inside one
-- transaction, and after the first line it is legitimately half-written.
create constraint trigger journal_lines_must_balance
  after insert or update or delete on platform.journal_lines
  deferrable initially deferred
  for each row execute function platform.assert_entry_balances();

/**
 * Catches an entry that was written with no lines at all.
 *
 * The line trigger cannot: it only fires when a line exists. An entry with no
 * lines is invisible to it and would sit in the books forever, balancing
 * trivially and meaning nothing.
 */
create or replace function platform.assert_entry_has_lines()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from platform.journal_lines where entry_id = new.id) then
    raise exception 'Journal entry % was committed with no lines.', new.id
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger journal_entries_must_have_lines
  after insert on platform.journal_entries
  deferrable initially deferred
  for each row execute function platform.assert_entry_has_lines();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
--
-- The company's books are not customer data and no household reads them. There
-- is no `authenticated` grant here at all: the admin platform reads these
-- through the service role, and a policy that could be widened by accident is
-- worse than an absent grant.

alter table platform.ledger_accounts enable row level security;
alter table platform.ledger_accounts force row level security;

alter table platform.journal_entries enable row level security;
alter table platform.journal_entries force row level security;

alter table platform.journal_lines enable row level security;
alter table platform.journal_lines force row level security;

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------
--
-- Small on purpose. Every account here exists because something posts to it; a
-- chart with sixty unused accounts is harder to read than one with fifteen that
-- are all live.

insert into platform.ledger_accounts (code, name, account_type, normal_balance, is_contra)
values
  ('1000', 'Cash',                    'asset',     'debit',  false),
  ('1100', 'Processor receivable',    'asset',     'debit',  false),
  ('1200', 'Accounts receivable',     'asset',     'debit',  false),
  ('2000', 'Deferred revenue',        'liability', 'credit', false),
  ('2100', 'Accounts payable',        'liability', 'credit', false),
  ('2200', 'Taxes payable',           'liability', 'credit', false),
  ('3000', 'Retained earnings',       'equity',    'credit', false),
  ('4000', 'Subscription revenue',    'revenue',   'credit', false),
  ('4100', 'Refunds',                 'revenue',   'debit',  true),
  ('4200', 'Discounts',               'revenue',   'debit',  true),
  ('5000', 'Payment processing fees', 'expense',   'debit',  false),
  ('5100', 'Infrastructure',          'expense',   'debit',  false),
  ('5200', 'Software and services',   'expense',   'debit',  false),
  ('5300', 'AI provider usage',       'expense',   'debit',  false),
  ('5900', 'Payroll',                 'expense',   'debit',  false)
on conflict (code) do nothing;

update platform.schema_version
   set version = 14,
       description = 'Phase 15 — internal ledger: chart of accounts, journal entries and lines, balance enforced by trigger',
       applied_at = now()
 where id;
