-- ---------------------------------------------------------------------------
-- Asking, and being told
-- ---------------------------------------------------------------------------
--
-- Two things the copilot needs that the AI tables do not provide.
--
-- `ai_invocations` records every call: the prompt, the tokens, the cost, the
-- outcome. It is an audit log, and it is the right shape for one. It is the
-- wrong shape for a conversation — a thread has an order, a subject, and a
-- lifetime, and reconstructing one from invocation rows would mean inferring
-- all three from timestamps.
--
-- Alerts are the opposite problem. They are *derived*: «you will not reach the
-- 30th at this rate» is recomputed from the ledger every time the screen is
-- opened, and storing them would create a second version of a fact that is
-- already stored. What cannot be derived is that somebody read one and said
-- «I know». So only the dismissal is kept.

create table app.chat_threads (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,

  -- Taken from the first question asked, so a thread is findable later without
  -- anybody being made to name it before they have asked anything.
  title          text not null check (length(btrim(title)) between 1 and 200),

  created_by     uuid references app.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index chat_threads_household_idx
  on app.chat_threads (household_id, updated_at desc)
  where deleted_at is null;

create trigger chat_threads_set_updated_at
  before update on app.chat_threads
  for each row execute function public.set_updated_at();

create table app.chat_messages (
  id             uuid primary key default public.uuid_generate_v7(),
  thread_id      uuid not null references app.chat_threads (id) on delete cascade,
  household_id   uuid not null references app.households (id) on delete cascade,

  role           text not null check (role in ('user', 'assistant')),
  body           text not null,

  -- The figures the answer was allowed to use, exactly as they were handed to
  -- the model. This is what makes a months-old answer auditable: without it,
  -- «you had $2,740 available» is a claim nobody can check against anything.
  grounding      jsonb not null default '{}'::jsonb,

  -- The audit row for the call that produced this message, when a call was made.
  invocation_id  uuid references app.ai_invocations (id) on delete set null,
  -- Figures the guardrail could not tie back to the grounding. An answer with
  -- any is shown with the warning attached, never silently.
  ungrounded     text[] not null default '{}',

  author_id      uuid references app.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index chat_messages_thread_idx on app.chat_messages (thread_id, created_at);

comment on table app.chat_messages is
  'A conversation about a household''s own finances, with the figures each answer was grounded in.';

-- ---------------------------------------------------------------------------

create table app.alert_dismissals (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,

  -- Stable across recomputations: the same condition about the same subject
  -- produces the same key, so dismissing it once is enough.
  alert_key      text not null check (length(alert_key) between 1 and 200),

  dismissed_by   uuid references app.profiles (id) on delete set null,
  dismissed_at   timestamptz not null default now(),

  -- Dismissal is for this month, not forever. A budget that is still going to
  -- overrun in November is a new fact, and silencing it in October must not
  -- silence it then.
  expires_on     date not null,

  unique (household_id, alert_key)
);

create index alert_dismissals_household_idx on app.alert_dismissals (household_id, expires_on);

comment on table app.alert_dismissals is
  'Alerts a household has acknowledged. The alerts themselves are derived, never stored.';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table app.chat_threads enable row level security;
alter table app.chat_threads force row level security;

create policy chat_threads_household_access on app.chat_threads
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

grant select, insert, update, delete on app.chat_threads to authenticated;

alter table app.chat_messages enable row level security;
alter table app.chat_messages force row level security;

-- Read and write, never update. A message that can be edited after the fact is
-- not a record of what was asked or of what was answered.
create policy chat_messages_household_read on app.chat_messages
  for select to authenticated
  using (app.is_household_member(household_id));

create policy chat_messages_household_write on app.chat_messages
  for insert to authenticated
  with check (app.is_household_member(household_id));

create policy chat_messages_household_delete on app.chat_messages
  for delete to authenticated
  using (app.is_household_member(household_id));

grant select, insert, delete on app.chat_messages to authenticated;

alter table app.alert_dismissals enable row level security;
alter table app.alert_dismissals force row level security;

create policy alert_dismissals_household_access on app.alert_dismissals
  for all to authenticated
  using (app.is_household_member(household_id))
  with check (app.is_household_member(household_id));

grant select, insert, update, delete on app.alert_dismissals to authenticated;

update platform.schema_version
   set version = 25,
       description = 'Advice — conversations with their grounding, and the alerts a household has acknowledged',
       applied_at = now()
 where id;
