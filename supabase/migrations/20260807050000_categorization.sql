-- Categorization and learning.
--
-- The system's job is to stop asking. A person who files Adobe under Business /
-- Software twice should never be asked a third time — and when the system does
-- decide on its own, it must be able to say why, and be corrected without
-- argument (spec §26, §98).
--
-- Two tables carry that: the rules that decide, and the log of every decision
-- and every correction. The log is not an audit nicety; it is the training data
-- for rule proposals and the only way to undo a bad automatic classification.

-- How a rule's pattern is compared. Deliberately not a regular expression: a
-- customer-authored regex is arbitrary computation running against every row of
-- every import, and a backtracking pattern written by someone trying to
-- categorize their groceries is still a denial of service (spec §110).
create type app.match_kind as enum ('equals', 'starts_with', 'contains', 'tokens');

-- The category a merchant's transactions have settled into. Kept on the merchant
-- rather than recomputed, so a new statement row inherits it without a scan over
-- the household's history.
alter table app.merchants
  add column default_category_id uuid references app.categories (id) on delete set null;

create table app.merchant_rules (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,

  match_kind     app.match_kind not null default 'contains',
  -- Stored already normalized, so matching in Postgres and matching in the
  -- engine compare the same two strings.
  pattern        text not null check (length(trim(pattern)) > 0),

  merchant_id    uuid references app.merchants (id) on delete set null,
  category_id    uuid references app.categories (id) on delete set null,

  tax_classification app.tax_classification,
  business_percentage numeric(5, 2) check (business_percentage between 0 and 100),

  -- Which authority wrote this. The ordering between them is the product's
  -- promise made mechanical: a person outranks an inference, always.
  source         app.provenance not null default 'user',
  confidence     numeric(4, 3) not null default 1 check (confidence between 0 and 1),
  priority       integer not null default 100,

  is_active      boolean not null default true,
  effective_from date,
  effective_to   date,

  -- How many corrections the household made before this rule was proposed. Null
  -- for a rule someone wrote directly.
  supporting_corrections integer,

  created_by     uuid references app.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- `mixed` with no percentage is not a classification, it is a question. Same
  -- constraint the transactions table carries, for the same reason.
  constraint merchant_rules_mixed_needs_percentage
    check (tax_classification is distinct from 'mixed' or business_percentage is not null),

  constraint merchant_rules_window_ordered
    check (effective_to is null or effective_from is null or effective_to >= effective_from),

  -- A rule that changes nothing is a rule nobody can explain.
  constraint merchant_rules_does_something
    check (category_id is not null or merchant_id is not null or tax_classification is not null),

  -- One rule per pattern per authority. A household writing the same rule twice
  -- is correcting the first one, not adding a second.
  unique (household_id, match_kind, pattern, source)
);

create index merchant_rules_lookup_idx
  on app.merchant_rules (household_id, source, priority)
  where is_active;

create trigger merchant_rules_set_updated_at
  before update on app.merchant_rules
  for each row execute function public.set_updated_at();

-- Every change of a transaction's classification, by anyone, including the
-- system itself. Append-only by convention: a correction is a new row, never an
-- overwrite, because the previous value is what makes an undo possible.
create table app.classification_log (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,
  transaction_id uuid not null references app.transactions (id) on delete cascade,

  previous_category_id uuid references app.categories (id) on delete set null,
  category_id          uuid references app.categories (id) on delete set null,
  previous_source      app.provenance,
  source               app.provenance not null,

  confidence     numeric(4, 3) check (confidence between 0 and 1),
  applied_rule_id uuid references app.merchant_rules (id) on delete set null,
  actor_id       uuid references app.profiles (id) on delete set null,
  reason         text not null,
  created_at     timestamptz not null default now(),

  -- A change that changed nothing is noise in the one place that must stay
  -- readable when someone is disputing a figure.
  constraint classification_log_is_a_change
    check (category_id is distinct from previous_category_id
        or source is distinct from previous_source)
);

create index classification_log_transaction_idx
  on app.classification_log (transaction_id, created_at desc);

-- The probe that feeds rule proposals: this household's recent corrections for
-- one merchant.
create index classification_log_learning_idx
  on app.classification_log (household_id, created_at desc)
  where source in ('user', 'accountant');

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array['merchant_rules', 'classification_log'] loop
    execute format('alter table app.%I enable row level security', target);
    execute format('alter table app.%I force row level security', target);
    execute format(
      'create policy %I on app.%I for all to authenticated
         using (app.is_household_member(household_id))
         with check (app.is_household_member(household_id))',
      target || '_household_access', target
    );
  end loop;
end
$$;

grant select, insert, update, delete on app.merchant_rules, app.classification_log
  to authenticated;

update platform.schema_version
   set version = 6,
       description = 'Phase 6 — categorization and learning: merchant rules, classification log',
       applied_at = now()
 where id;
