-- ---------------------------------------------------------------------------
-- Background work
-- ---------------------------------------------------------------------------
--
-- Parsing a PDF cannot happen inside the request that uploaded it. A hundred-
-- page statement takes seconds, the platform's request budget does not stretch
-- that far, and a person watching a spinner has no way to tell a slow parse
-- from a lost one. So the upload records the file and enqueues the work, and
-- the work reports on itself.
--
-- This is a queue in Postgres rather than a queue service, and that is a
-- deliberate limit rather than a shortcut. The work is per-household, low
-- volume, and already needs a transaction against these tables; a separate
-- broker would add a second source of truth about whether a job ran, and
-- "did my statement import" is not a question that may have two answers.
--
-- Claiming uses `for update skip locked`, so two workers running at once take
-- different jobs instead of the same one twice.

create type app.job_status as enum (
  'queued',
  'running',
  'succeeded',
  'failed',
  -- A person who navigated away from an import they no longer want. The row
  -- stays, because "it was cancelled" and "it never existed" are different
  -- answers to "what happened to my file".
  'cancelled'
);

create table app.jobs (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,

  -- What kind of work this is. Text rather than an enum: a new job kind should
  -- be a deploy, not a migration plus a deploy, and the runner refuses a kind
  -- it does not know.
  kind           text not null check (length(kind) between 1 and 64),
  status         app.job_status not null default 'queued',

  -- Everything the worker needs, and nothing it could look up. Small on
  -- purpose: a payload carrying a file would make this table the storage layer.
  payload        jsonb not null default '{}'::jsonb,

  -- Whole percent. A progress bar is the difference between "this is working"
  -- and "this is stuck", and that difference is the entire reason a person
  -- tolerates waiting at all.
  progress       smallint not null default 0 check (progress between 0 and 100),
  progress_note  text,

  attempts       integer not null default 0 check (attempts >= 0),
  max_attempts   integer not null default 3 check (max_attempts >= 1),

  -- What the work produced, for the screen that reports on it.
  result         jsonb,
  -- Shown to the household verbatim, so it has to be written for them.
  error_message  text,

  -- Retries back off by setting this forward rather than by sleeping in a
  -- worker: a process that sleeps is a process that can be killed mid-sleep.
  run_after      timestamptz not null default now(),

  created_by     uuid references app.profiles (id) on delete set null,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A finished job has an outcome to show and a time it reached it.
  constraint jobs_finished_has_time
    check (
      (status in ('succeeded', 'failed', 'cancelled')) = (finished_at is not null)
    )
);

-- The claim query's index: oldest runnable job first, and only the runnable
-- ones are in it.
create index jobs_runnable_idx
  on app.jobs (run_after, created_at)
  where status = 'queued';

create index jobs_household_idx on app.jobs (household_id, created_at desc);

-- One live job per document. A person who double-clicks upload gets one import,
-- not two, and the second click is a no-op rather than a duplicate statement.
create unique index jobs_active_document_unique
  on app.jobs (household_id, kind, (payload ->> 'documentId'))
  where status in ('queued', 'running') and payload ? 'documentId';

create trigger jobs_set_updated_at
  before update on app.jobs
  for each row execute function public.set_updated_at();

comment on table app.jobs is
  'Work that cannot run inside a request: parsing, OCR, exports, recurrence detection.';

-- ---------------------------------------------------------------------------
-- What an import needs to say while it is still running
-- ---------------------------------------------------------------------------

alter table app.imports
  add column if not exists job_id uuid references app.jobs (id) on delete set null;

create index if not exists imports_job_idx on app.imports (job_id)
  where job_id is not null;

comment on column app.imports.job_id is
  'The background job that produced this import, when one did.';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
--
-- A household sees and cancels its own jobs. It does not get to mark one
-- succeeded: the runner connects as the service role, and a status a member
-- could write by hand is a status that means nothing.

alter table app.jobs enable row level security;
alter table app.jobs force row level security;

create policy jobs_household_read on app.jobs
  for select to authenticated
  using (app.is_household_member(household_id));

create policy jobs_household_enqueue on app.jobs
  for insert to authenticated
  with check (app.is_household_member(household_id) and status = 'queued');

create policy jobs_household_cancel on app.jobs
  for update to authenticated
  using (app.is_household_member(household_id) and status = 'queued')
  with check (app.is_household_member(household_id) and status = 'cancelled');

grant select, insert, update on app.jobs to authenticated;

update platform.schema_version
   set version = 24,
       description = 'Background work — the queue that lets a PDF be parsed outside a request',
       applied_at = now()
 where id;
