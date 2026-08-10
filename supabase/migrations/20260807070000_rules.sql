-- The rule engine.
--
-- A rule is `WHEN [condition] THEN [action]`, stored as structured JSON and
-- never as executable code. That is not a stylistic preference: a rule arrives
-- from a customer, and anything this system could evaluate as an expression a
-- customer could use to reach data that is not theirs (spec §110).
--
-- The conditions may only reference facts from a catalogue held in
-- `@app/rule-engine`, and the actions only describe intents that the allocation
-- engine, the classifier or the notification layer decide whether to carry out.
-- Nothing stored here is ever run.

create table app.rules (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,

  name           text not null check (length(trim(name)) > 0),
  -- Written by whoever wrote the rule, shown to the household verbatim. A rule
  -- nobody can explain is a rule nobody can review, so it is not optional.
  explanation    text not null check (length(trim(explanation)) > 0),

  -- Validated by app code on write and again on read. The database enforces the
  -- shape; the engine enforces the vocabulary, because the catalogue of facts a
  -- rule may name lives in code where widening it requires a review.
  conditions     jsonb not null,
  actions        jsonb not null check (jsonb_array_length(actions) between 1 and 8),

  priority       integer not null default 100,
  is_active      boolean not null default true,
  effective_from date,
  effective_to   date,

  source         app.provenance not null default 'user',
  created_by     uuid references app.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  constraint rules_conditions_are_an_object
    check (jsonb_typeof(conditions) = 'object'),
  constraint rules_actions_are_an_array
    check (jsonb_typeof(actions) = 'array'),
  constraint rules_window_ordered
    check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create index rules_household_idx on app.rules (household_id, priority)
  where is_active and deleted_at is null;

create trigger rules_set_updated_at
  before update on app.rules
  for each row execute function public.set_updated_at();

-- Every evaluation, including the rules that did *not* fire.
--
-- "Why did nothing happen?" is the question a household actually asks, and it
-- cannot be answered from a log that only records matches. A skipped rule
-- carries the reason it was skipped — switched off, expired, or missing a fact
-- the system does not have yet.
create table app.rule_executions (
  id             uuid primary key default public.uuid_generate_v7(),
  household_id   uuid not null references app.households (id) on delete cascade,
  rule_id        uuid not null references app.rules (id) on delete cascade,

  matched        boolean not null,
  skip_reason    text check (
    skip_reason in ('inactive', 'not_yet_effective', 'expired', 'invalid', 'missing_fact')
  ),
  -- What the rule asked for, exactly as it asked. Stored rather than recomputed,
  -- so replaying an old decision shows what was decided, not what today's rules
  -- would decide.
  actions        jsonb not null default '[]'::jsonb,
  explanation    text not null,

  -- What the evaluation was about: an allocation plan, an import, a scheduled
  -- run. Nullable because a rule may be evaluated with nothing to attach to.
  context_kind   text,
  context_id     uuid,

  evaluated_at   timestamptz not null default now(),

  constraint rule_executions_skip_reason_matches
    check (matched = (skip_reason is null))
);

create index rule_executions_rule_idx
  on app.rule_executions (rule_id, evaluated_at desc);

create index rule_executions_household_idx
  on app.rule_executions (household_id, evaluated_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array['rules', 'rule_executions'] loop
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

grant select, insert, update, delete on app.rules, app.rule_executions to authenticated;

update platform.schema_version
   set version = 8,
       description = 'Phase 9 — rule engine: structured rules and their execution history',
       applied_at = now()
 where id;
