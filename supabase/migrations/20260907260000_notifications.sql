-- ---------------------------------------------------------------------------
-- Telling people things
-- ---------------------------------------------------------------------------
--
-- A financial system that only speaks when opened is a system nobody opens. The
-- one alert worth the most — «the card is due in three days and there is not
-- enough in the account» — is worth exactly nothing on a screen the household
-- will next look at on the fifth.
--
-- Two tables, because they answer two different questions and conflating them
-- is the standard mistake:
--
--   - What does this household want to be told, and how? That is a preference,
--     it is per channel and per kind, and it changes rarely.
--   - What did we actually send, when, and did it arrive? That is a log, it
--     grows forever, and it is the only defence against «I never got that».
--
-- Nothing here sends anything. Delivery is a job, like every other piece of work
-- that cannot happen inside a request.

create table app.notification_preferences (
  household_id   uuid not null references app.households (id) on delete cascade,
  user_id        uuid not null references app.profiles (id) on delete cascade,

  -- What the notice is about. Text rather than an enum for the same reason the
  -- job kind is: adding one should be a deploy, not a migration plus a deploy.
  kind           text not null check (length(kind) between 1 and 64),
  channel        text not null check (channel in ('email', 'push', 'none')),

  -- How often at most, in whole hours. Zero means "as it happens". A daily
  -- digest is 24; a household that wants the card reminder immediately and the
  -- spending summary weekly sets two different rows.
  throttle_hours smallint not null default 0
                 check (throttle_hours between 0 and 720),

  is_enabled     boolean not null default true,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  primary key (household_id, user_id, kind)
);

create trigger notification_preferences_set_updated_at
  before update on app.notification_preferences
  for each row execute function public.set_updated_at();

comment on table app.notification_preferences is
  'What each member wants to be told about, through which channel, and how often at most.';

create table app.notification_deliveries (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,
  user_id        uuid references app.profiles (id) on delete set null,

  kind           text not null,
  channel        text not null check (channel in ('email', 'push')),

  -- The alert this was about, when it was about one. Lets a delivery be traced
  -- back to the condition that triggered it rather than to a timestamp.
  subject_key    text,

  -- Rendered at send time and kept. The catalogue changes; what a person was
  -- actually told does not, and «what did that email say» has to stay
  -- answerable after the copy is rewritten.
  title          text not null,
  body           text not null,

  status         text not null default 'queued'
                 check (status in ('queued', 'sent', 'failed', 'suppressed')),
  -- Why it was not sent. 'throttled', 'disabled', 'no_channel', or the
  -- provider's own complaint.
  reason         text,

  sent_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index notification_deliveries_household_idx
  on app.notification_deliveries (household_id, created_at desc);

-- The throttle's index: the last time this person was told about this thing.
create index notification_deliveries_throttle_idx
  on app.notification_deliveries (user_id, kind, created_at desc)
  where status = 'sent';

comment on table app.notification_deliveries is
  'Every notice we sent or decided not to send, with the words as they were sent.';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
--
-- A member manages their own preferences and reads their own deliveries. Not
-- another member's: what somebody chose to be told about is theirs.

alter table app.notification_preferences enable row level security;
alter table app.notification_preferences force row level security;

create policy notification_preferences_own on app.notification_preferences
  for all to authenticated
  using (app.is_household_member(household_id) and user_id = auth.uid())
  with check (app.is_household_member(household_id) and user_id = auth.uid());

grant select, insert, update, delete on app.notification_preferences to authenticated;

alter table app.notification_deliveries enable row level security;
alter table app.notification_deliveries force row level security;

-- Read only. The runner writes these with the service role, and a delivery a
-- member could write by hand would make the log worthless as evidence.
create policy notification_deliveries_own on app.notification_deliveries
  for select to authenticated
  using (app.is_household_member(household_id) and (user_id is null or user_id = auth.uid()));

grant select on app.notification_deliveries to authenticated;

update platform.schema_version
   set version = 26,
       description = 'Notifications — what each member wants to be told, and what we actually sent',
       applied_at = now()
 where id;
