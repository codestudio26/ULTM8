-- Decision 269 — retention-aware purge for WaiverSignature, the per-Student
-- signed legal record Decision 110/226's "Waiver is never purged" exception
-- actually protects. That exception was always scoped to the Waiver TEMPLATE
-- row (title/body) — WaiverSignature (the per-Student signature itself) has
-- never had any archivedAt/purgeAt/purgedAt trio or purge grant at all; this
-- migration gives EntityOffboardingPurgeProcessor's new WaiverSignature sweep
-- (apps/api/src/jobs/entity-offboarding-purge.processor.ts) exactly the two
-- new things it needs: ultm8_jobs read access to compute eligibility, and
-- delete access to act on it. No archivedAt/purgeAt/purgedAt columns are
-- added here — retention eligibility is computed dynamically at sweep time
-- (RoleGrant.revokedAt for departure, User.dateOfBirth for the minors case),
-- not persisted, so there is nothing to backfill and no risk of a persisted
-- purgeAt going stale against a later-changed retention policy.
--
-- Transaction is deliberately NOT touched by this migration or the processor
-- change that follows it — Decision 261 (14 Oct 2026, predates Decision 269)
-- already confirmed Transaction is never deletable, same permanent-retention
-- treatment as Membership. Decision 269's "7 years" framing for Transaction
-- is a retention FLOOR for compliance purposes, not a purge trigger — it does
-- not override Decision 261's standing "never deletable" policy, and nothing
-- here builds a Transaction purge path.

-- ultm8_jobs already holds whole-table SELECT/UPDATE on every RoleGrant
-- column (role/schoolId/userId/revokedAt included — confirmed directly
-- against the live grants before writing this, not assumed) from prior
-- migrations; no new RoleGrant grant is needed.

-- User.dateOfBirth was never previously granted to ultm8_jobs (checked
-- directly — existing grant covers only email/firstName/id/
-- paymentRestrictedAt/surname) — needed to compute the minors'
-- age-of-majority+6-year threshold.
GRANT SELECT ("dateOfBirth") ON "User" TO ultm8_jobs;

-- WaiverSignature itself: no prior ultm8_jobs grant existed at all. SELECT
-- for eligibility computation, DELETE for the actual purge. The pre-existing
-- `waiver_signature_school_staff_or_self` policy (FOR ALL, PUBLIC, scoped by
-- `current_setting('app.current_user_id')`) does not and must not cover
-- ultm8_jobs — a background sweep has no single caller/tenant context — so
-- two new role-scoped PERMISSIVE policies are added, OR-combined with that
-- existing one, the identical mechanism `waiver_jobs_read` already
-- established for the Waiver table itself (20260918000000_notifications_module).
GRANT SELECT, DELETE ON "WaiverSignature" TO ultm8_jobs;

CREATE POLICY "waiver_signature_jobs_read" ON "WaiverSignature"
  FOR SELECT
  TO ultm8_jobs
  USING (true);

CREATE POLICY "waiver_signature_jobs_delete" ON "WaiverSignature"
  FOR DELETE
  TO ultm8_jobs
  USING (true);
