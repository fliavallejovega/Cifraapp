-- ---------------------------------------------------------------------------
-- Household profile — what the setup questionnaire records
-- ---------------------------------------------------------------------------
--
-- Everything the questionnaire asks already had a table: income becomes a
-- recurring series, a monthly commitment an obligation, a card a debt, a plan
-- for the future a goal. Three answers had nowhere to go, and they are the ones
-- that give the rest their meaning:
--
--   - How many people the money has to cover. A thousand dollars left over is a
--     different fact for one person than for a family of five, and every
--     explanation the copilot writes is wrong without it.
--   - How many of those depend on the household's income rather than earning.
--   - Whether setup was ever finished, so a person is asked once and then left
--     alone. Inferring it from "does a row exist somewhere" would re-open the
--     questionnaire for anyone who deliberately skipped every step.
--
-- These sit on `household_settings` rather than a new table: it is already the
-- one row per household that holds the household's own choices, it already
-- carries the RLS policy that scopes it to members, and a second table would
-- need its own policy saying exactly the same thing.

alter table app.household_settings
  add column if not exists member_count smallint,
  add column if not exists dependent_count smallint,
  add column if not exists onboarding_completed_at timestamptz;

-- A household of zero people has no finances to manage, and a negative count is
-- a bug reaching the column. Bounded generously above: the constraint exists to
-- catch a mistyped field, not to have an opinion about family size.
alter table app.household_settings
  drop constraint if exists household_settings_member_count_check;
alter table app.household_settings
  add constraint household_settings_member_count_check
  check (member_count is null or (member_count >= 1 and member_count <= 50));

alter table app.household_settings
  drop constraint if exists household_settings_dependent_count_check;
alter table app.household_settings
  add constraint household_settings_dependent_count_check
  check (
    dependent_count is null
    or (dependent_count >= 0 and dependent_count <= coalesce(member_count, 50))
  );

comment on column app.household_settings.member_count is
  'People the household income has to cover, as stated during setup.';
comment on column app.household_settings.dependent_count is
  'How many of those do not earn. A subset of member_count, never larger.';
comment on column app.household_settings.onboarding_completed_at is
  'When setup was finished. Null means the questionnaire has not been answered.';

update platform.schema_version
   set version = 21,
       description = 'Household profile — member counts and setup completion from the questionnaire',
       applied_at = now()
 where id;
