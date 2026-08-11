-- Hardening.
--
-- Everything in this file was found by the security audit in
-- `packages/database/src/security-audit.test.ts` rather than by reading the
-- schema. That is the point of writing the audit as a test: a hardening pass
-- done by inspection decays the week after, and this one runs on every commit.

-- ---------------------------------------------------------------------------
-- Forced row-level security on the reference tables
-- ---------------------------------------------------------------------------
--
-- These three were created in Phase 0 with `enable row level security` and no
-- `force`. Enabled alone exempts the table's owner — which is the role
-- migrations, jobs and seeds connect as — from every policy on it.
--
-- For world-readable reference data the practical risk is small: the policy
-- these tables carry is `using (true)`. The reason to fix it anyway is that
-- "every table in these schemas is forced" is a property a test can assert,
-- while "every table except three, for reasons" is a sentence somebody has to
-- remember. The exception is the thing that eventually hides a real one.

alter table platform.schema_version force row level security;
alter table platform.currencies force row level security;
alter table platform.tax_jurisdictions force row level security;

update platform.schema_version
   set version = 20,
       description = 'Phase 21 — hardening: forced row-level security on the reference tables',
       applied_at = now()
 where id;
