-- Whose account this is, when the holder is somebody without a login.
--
-- `accounts.owner_id` points at `app.profiles` — a person who signs in. That is
-- the right column for «which member of this household administers it», and the
-- wrong one for the question the setup questionnaire actually asks about a
-- credit card: whose card is it. A household names its people in
-- `app.household_people`, and most of them never get an account of their own —
-- a child, a parent, a partner who does not use the product.
--
-- Without this, «Rosa's card» could only be recorded by writing the name into
-- the account's own name, which reads fine and is useless: nothing can group by
-- it, and correcting the spelling in one place would leave every other mention
-- of Rosa untouched.
--
-- Nullable, because most accounts belong to the household rather than to a
-- person, and forcing a choice would invent one.
alter table app.accounts
  add column if not exists person_id uuid references app.household_people (id) on delete set null;

comment on column app.accounts.person_id is
  'The household member this account belongs to, when it belongs to one rather than to the household. Distinct from owner_id, which is the profile that administers it.';

create index if not exists accounts_person_idx
  on app.accounts (person_id)
  where person_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- A credit card is two facts, and the product needs both
-- ---------------------------------------------------------------------------
--
-- What is owed on it, which is a debt and drives the payoff plan; and what is
-- still available on it, which is a spending limit and belongs to the position.
-- The schema already carries both — `app.accounts.credit_limit` beside the
-- balance, and `app.debts.account_id` to tie the debt to the card it sits on —
-- and nothing was populating them, so a card entered during setup became a debt
-- with no card behind it and the available credit was unknowable.
--
-- Nothing to migrate here: the columns exist. The gap was in the questionnaire,
-- which never asked.

update platform.schema_version
   set version = 29,
       description = 'Accounts can name the household member they belong to',
       applied_at = now()
 where id;
