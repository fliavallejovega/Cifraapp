-- The accountant portal.
--
-- One rule governs everything here: **an accountant never automatically gains
-- access to anything.** Access is granted by the household, scoped to what the
-- grant says, and revocable without notice or explanation (spec §101).
--
-- The implementation detail that matters: this migration does **not** widen
-- `app.is_household_member()`. Doing so would hand every accountant the same
-- rights a member has across every table in one edit, including write access
-- wherever a policy is `for all`. Instead each table the portal genuinely needs
-- gets an additional `select` policy. Postgres ORs policies together, so a
-- household member's access is unchanged and an accountant's is exactly the set
-- enumerated below — visible, greppable, and impossible to widen by accident.

create type app.accountant_scope as enum ('read', 'comment', 'classify');

create table app.accountant_grants (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,
  accountant_id  uuid not null references app.profiles (id) on delete cascade,

  scope          app.accountant_scope not null default 'read',

  granted_by     uuid not null references app.profiles (id) on delete restrict,
  granted_at     timestamptz not null default now(),

  -- An access that expires on its own is safer than one that relies on somebody
  -- remembering. Null means it stands until revoked.
  expires_at     timestamptz,

  revoked_at     timestamptz,
  revoked_by     uuid references app.profiles (id) on delete set null,
  -- Deliberately not required. A household revoking access owes nobody a reason.
  revoke_note    text,

  created_at     timestamptz not null default now(),

  constraint accountant_grants_unique_active unique (household_id, accountant_id),
  constraint accountant_grants_revocation_has_time
    check ((revoked_by is null) or (revoked_at is not null))
);

create index accountant_grants_accountant_idx
  on app.accountant_grants (accountant_id)
  where revoked_at is null;

/**
 * Whether the caller currently holds a grant on a household.
 *
 * Security definer, because it reads a table the caller cannot select from
 * directly — an accountant must not be able to enumerate other people's grants
 * to discover who else works with a household.
 *
 * Three conditions, all required: the grant exists, it has not been revoked, and
 * it has not expired. A grant that has lapsed is not a grant.
 */
create or replace function app.has_accountant_access(
  target_household uuid,
  required_scope app.accountant_scope default 'read'
)
returns boolean
language sql
stable
security definer
set search_path = app, public
as $$
  select exists (
    select 1
      from app.accountant_grants g
     where g.household_id = target_household
       and g.accountant_id = auth.uid()
       and g.revoked_at is null
       and (g.expires_at is null or g.expires_at > now())
       and (
         g.scope = required_scope
         -- `classify` implies `comment` implies `read`. Ordering the enum this
         -- way is what makes a scope check a comparison rather than a list.
         or (required_scope = 'read' and g.scope in ('comment', 'classify'))
         or (required_scope = 'comment' and g.scope = 'classify')
       )
  );
$$;

-- ---------------------------------------------------------------------------
-- Notes and requests
-- ---------------------------------------------------------------------------

create table app.accountant_notes (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,
  author_id      uuid not null references app.profiles (id) on delete cascade,

  -- Optional anchor. A note about one transaction is far more useful attached
  -- to it than sitting in a list of general remarks.
  transaction_id uuid references app.transactions (id) on delete set null,

  body           text not null check (length(trim(body)) between 1 and 4000),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index accountant_notes_household_idx
  on app.accountant_notes (household_id, created_at desc);

create table app.accountant_requests (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,
  accountant_id  uuid not null references app.profiles (id) on delete cascade,

  kind           text not null check (kind in ('document', 'clarification', 'classification', 'other')),
  message        text not null check (length(trim(message)) between 1 and 2000),

  status         text not null default 'open' check (status in ('open', 'answered', 'closed')),
  answered_at    timestamptz,
  answered_by    uuid references app.profiles (id) on delete set null,
  response       text,

  created_at     timestamptz not null default now(),

  constraint accountant_requests_answer_is_complete
    check ((status <> 'answered') or (answered_at is not null and response is not null))
);

create index accountant_requests_open_idx
  on app.accountant_requests (household_id)
  where status = 'open';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table app.accountant_grants enable row level security;
alter table app.accountant_grants force row level security;

-- The household controls its own grants, completely.
create policy accountant_grants_household_manages on app.accountant_grants
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

-- An accountant may see the grants naming them, and nothing else. Not who else
-- works with the household, and not any grant they do not hold.
create policy accountant_grants_own_readable on app.accountant_grants
  for select to authenticated
  using (accountant_id = auth.uid());

alter table app.accountant_notes enable row level security;
alter table app.accountant_notes force row level security;

create policy accountant_notes_household_access on app.accountant_notes
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

create policy accountant_notes_readable_by_accountant on app.accountant_notes
  for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));

-- Writing a note needs `comment`, which is the scope's whole purpose.
create policy accountant_notes_writable_by_accountant on app.accountant_notes
  for insert to authenticated
  with check (app.has_accountant_access(household_id, 'comment') and author_id = auth.uid());

alter table app.accountant_requests enable row level security;
alter table app.accountant_requests force row level security;

create policy accountant_requests_household_access on app.accountant_requests
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

create policy accountant_requests_own on app.accountant_requests
  for select to authenticated
  using (accountant_id = auth.uid());

create policy accountant_requests_raised_by_accountant on app.accountant_requests
  for insert to authenticated
  with check (
    app.has_accountant_access(household_id, 'comment') and accountant_id = auth.uid()
  );

grant select, insert, update, delete
  on app.accountant_grants, app.accountant_notes, app.accountant_requests
  to authenticated;

create trigger accountant_notes_updated_at
  before update on app.accountant_notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- What a grant actually reaches
-- ---------------------------------------------------------------------------
--
-- Enumerated, one table at a time. This list is the definition of "scoped
-- access", and it is short on purpose: a grant reaches the financial picture an
-- accountant needs and nothing else. Notably absent — `app.profiles`,
-- `app.household_members`, `app.ai_invocations`, `app.scenarios`,
-- `platform.subscriptions`. What a household pays, who else lives in it, and
-- what they asked an assistant are not an accountant's business.

create policy accounts_readable_by_accountant on app.accounts
  for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));

create policy transactions_readable_by_accountant on app.transactions
  for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));

create policy categories_readable_by_accountant on app.categories
  for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));

create policy obligations_readable_by_accountant on app.obligations
  for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));

create policy debts_readable_by_accountant on app.debts
  for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));

create policy documents_readable_by_accountant on app.documents
  for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));

create policy tax_profiles_readable_by_accountant on app.tax_profiles
  for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));

create policy tax_estimates_readable_by_accountant on app.tax_estimates
  for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));

create policy expense_classifications_readable_by_accountant on app.expense_classifications
  for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));

-- The one write a grant can carry. `classify` exists so an accountant can do
-- the job they were hired for without being handed the household's whole
-- account.
create policy expense_classifications_writable_by_accountant on app.expense_classifications
  for update to authenticated
  using (app.has_accountant_access(household_id, 'classify'))
  with check (app.has_accountant_access(household_id, 'classify'));

create policy accounting_periods_readable_by_accountant on app.accounting_periods
  for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));

create policy reconciliations_readable_by_accountant on app.reconciliations
  for select to authenticated
  using (app.has_accountant_access(household_id, 'read'));

update platform.schema_version
   set version = 17,
       description = 'Phase 18 — accountant portal: explicit scoped revocable grants, notes, requests',
       applied_at = now()
 where id;
