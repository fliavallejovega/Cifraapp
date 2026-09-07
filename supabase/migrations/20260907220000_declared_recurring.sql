-- ---------------------------------------------------------------------------
-- A recurring series a person declared, rather than one we detected
-- ---------------------------------------------------------------------------
--
-- `occurrence_count >= 3` was the right rule for the only way a series could be
-- created when it was written: the recurrence engine will not call a pattern
-- recurring until it has seen it three times, and the constraint stopped a
-- half-confident guess from being stored as a fact.
--
-- The setup questionnaire creates the other kind. A person saying "my salary
-- lands on the 15th and the 30th" has made a claim about the future with zero
-- observations behind it, and that is not a weaker version of a detected
-- series — it is a different thing, marked `detected_by = 'user'` and carrying
-- `confirmed_by`. Forcing it to claim three sightings would have been the one
-- dishonest way to satisfy the old rule.
--
-- So the rule now says what it always meant: detection needs three occurrences,
-- a declaration needs none.

alter table app.recurring_series
  drop constraint if exists recurring_series_occurrence_count_check;

alter table app.recurring_series
  add constraint recurring_series_occurrence_count_check
  check (
    occurrence_count >= 0
    and (detected_by = 'user' or occurrence_count >= 3)
  );

comment on column app.recurring_series.occurrence_count is
  'Times the pattern was actually observed. Zero for a series the household declared during setup; at least three for one the engine detected.';

update platform.schema_version
   set version = 22,
       description = 'Declared recurring series: occurrence count applies to detection, not to a statement',
       applied_at = now()
 where id;
