-- Decision 226 (POST-SPEC-55-DECISION-LOG.md) — entity-level tenant offboarding
-- for the 7 entities confirmed to have no delete/archive mechanism today:
-- Branch, Class, TimetableSlot, Instructor, Rank, Waiver, Lesson. Same full
-- archivedAt/purgeAt/purgedAt trio and 90-day retention semantics as
-- School/Franchise's own (Decision 110, 20261006000000_tenant_lifecycle_module)
-- — chosen deliberately over MembershipPlan's simpler bare-archivedAt-no-purge
-- shape (this session's own earlier build) as the more literal reading of "the
-- same 90-day retention pattern used elsewhere in this project," since this
-- codebase actually has two different existing shapes and the product owner's
-- answer didn't specify which. Flagged explicitly in the PR description as a
-- disclosed judgment call.
--
-- Hand-authored, not `prisma migrate dev`-generated (this repo's established
-- convention) — unverified against real Postgres until this phase's own
-- verification step runs it.
--
-- One deliberate exception, carried from Decision 110: Waiver is NEVER
-- hard-purged by the new EntityOffboardingPurgeProcessor, regardless of
-- purgeAt — see Waiver's own schema.prisma comment for the full reasoning.
-- Waiver therefore needs no new ultm8_jobs DELETE grant at all (it already
-- holds SELECT, from 20260918000000_notifications_module) — least-privilege,
-- same "add only the specific grant a new use actually needs" discipline every
-- prior migration in this schema follows.
--
-- ultm8_app already holds whole-table SELECT/INSERT/UPDATE/DELETE on all 7
-- tables (each entity's own original module migration), so none of the new
-- columns need a new grant there — every existing archive/unarchive-style
-- service method already writes/reads through that same whole-table grant.

-- ============================================================================
-- 1. Branch — archivedAt/purgeAt/purgedAt.
-- ============================================================================

ALTER TABLE "Branch" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Branch" ADD COLUMN "purgeAt" TIMESTAMP(3);
ALTER TABLE "Branch" ADD COLUMN "purgedAt" TIMESTAMP(3);
CREATE INDEX "Branch_purgeAt_idx" ON "Branch"("purgeAt");

-- ============================================================================
-- 2. Class — archivedAt/purgeAt/purgedAt.
-- ============================================================================

ALTER TABLE "Class" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Class" ADD COLUMN "purgeAt" TIMESTAMP(3);
ALTER TABLE "Class" ADD COLUMN "purgedAt" TIMESTAMP(3);
CREATE INDEX "Class_purgeAt_idx" ON "Class"("purgeAt");

-- ============================================================================
-- 3. TimetableSlot — archivedAt/purgeAt/purgedAt.
-- ============================================================================

ALTER TABLE "TimetableSlot" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "TimetableSlot" ADD COLUMN "purgeAt" TIMESTAMP(3);
ALTER TABLE "TimetableSlot" ADD COLUMN "purgedAt" TIMESTAMP(3);
CREATE INDEX "TimetableSlot_purgeAt_idx" ON "TimetableSlot"("purgeAt");

-- ============================================================================
-- 4. Instructor — archivedAt/purgeAt/purgedAt.
-- ============================================================================

ALTER TABLE "Instructor" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Instructor" ADD COLUMN "purgeAt" TIMESTAMP(3);
ALTER TABLE "Instructor" ADD COLUMN "purgedAt" TIMESTAMP(3);
CREATE INDEX "Instructor_purgeAt_idx" ON "Instructor"("purgeAt");

-- ============================================================================
-- 5. Rank — archivedAt/purgeAt/purgedAt.
-- ============================================================================

ALTER TABLE "Rank" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Rank" ADD COLUMN "purgeAt" TIMESTAMP(3);
ALTER TABLE "Rank" ADD COLUMN "purgedAt" TIMESTAMP(3);
CREATE INDEX "Rank_purgeAt_idx" ON "Rank"("purgeAt");

-- ============================================================================
-- 6. Waiver — archivedAt/purgeAt/purgedAt. Never hard-purged (see schema
--    comment); the columns still exist for API/UI shape consistency with the
--    other 6 (same 90-day countdown display), the purge job just always skips
--    rows here once it finds them.
-- ============================================================================

ALTER TABLE "Waiver" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Waiver" ADD COLUMN "purgeAt" TIMESTAMP(3);
ALTER TABLE "Waiver" ADD COLUMN "purgedAt" TIMESTAMP(3);
CREATE INDEX "Waiver_purgeAt_idx" ON "Waiver"("purgeAt");

-- ============================================================================
-- 7. Lesson — archivedAt/purgeAt/purgedAt.
-- ============================================================================

ALTER TABLE "Lesson" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Lesson" ADD COLUMN "purgeAt" TIMESTAMP(3);
ALTER TABLE "Lesson" ADD COLUMN "purgedAt" TIMESTAMP(3);
CREATE INDEX "Lesson_purgeAt_idx" ON "Lesson"("purgeAt");

-- ============================================================================
-- 8. ultm8_jobs — the new entity-offboarding-purge sweep
--    (entity-offboarding-purge.processor.ts, this phase). Needs SELECT (to
--    find purgeAt-elapsed rows) + DELETE (the actual purge) on 6 of the 7
--    tables — every one of them FORCE ROW LEVEL SECURITY (each entity's own
--    original module migration), so a GRANT alone is not sufficient: a
--    matching permissive USING(true) policy is required per command, same
--    "a column/row grant without the matching RLS policy is silently
--    unusable" lesson 20261006000000_tenant_lifecycle_module's own header
--    comment already documents (and 20260908000000_timetable_module's
--    "CI CAUGHT A REAL BUG HERE" comment independently reconfirms for this
--    exact role). No child-table grants are added for cascade-configured
--    children (RankStripeTier/RankStripeTierRequiredSkill under Rank,
--    LessonSkill/LessonContent under Lesson, StudentHomeBranch/RoleGrant/
--    CoachInvite/WaitlistEntry/Class/TimetableSlot/Instructor/Booking under
--    Branch) — this schema's own FK ON DELETE CASCADE already fires
--    regardless of the deleting role's own grants on the child table, the
--    exact behavior 20260908000000_timetable_module's "CI CAUGHT A REAL BUG
--    HERE" comment and tenant-lifecycle-purge.processor.ts's own header
--    comment both already establish ("a role with DELETE-grant+policy ONLY
--    on the parent table still triggers every child's CASCADE... even with
--    zero grants on the child tables themselves") — verified against this
--    migration's own grep of every FK touching these 7 tables before writing
--    this, not assumed.
--
--    Rank is the one exception needing MORE than a plain DELETE-and-catch-
--    P2003: StudentRank.currentRankId -> Rank is the only RESTRICT among
--    Rank's own dependents (DB-enforced already); PromotionEvent's
--    fromRankId/toRankId and InstructorBelt's rankId/stripeTierId are
--    SET NULL / CASCADE respectively, which would let a plain DELETE
--    silently destroy grading-history Rank linkage or an instructor's
--    declared belt — exactly what Decision 198's own deleteRank() already
--    refuses to do via an explicit application-level check, not a DB
--    constraint. The purge job re-derives the same three checks
--    (holders/history/declared) immediately before attempting delete, so it
--    needs its own SELECT grant on PromotionEvent/InstructorBelt (StudentRank
--    already holds one, 20261022000000_grading_ready_notification).
--
--    Waiver needs NOTHING new — see the header comment above.
-- ============================================================================

GRANT DELETE ON "Branch" TO ultm8_jobs;
CREATE POLICY "branch_jobs_delete" ON "Branch"
  FOR DELETE
  TO ultm8_jobs
  USING (true);

GRANT DELETE ON "Class" TO ultm8_jobs;
CREATE POLICY "class_jobs_delete" ON "Class"
  FOR DELETE
  TO ultm8_jobs
  USING (true);

GRANT DELETE ON "TimetableSlot" TO ultm8_jobs;
CREATE POLICY "timetable_slot_jobs_delete" ON "TimetableSlot"
  FOR DELETE
  TO ultm8_jobs
  USING (true);

-- Instructor: never granted anything to ultm8_jobs before now (grepped every
-- prior migration to confirm) — needs SELECT (to find due rows) AND DELETE.
GRANT SELECT ON "Instructor" TO ultm8_jobs;
CREATE POLICY "instructor_jobs_read" ON "Instructor"
  FOR SELECT
  TO ultm8_jobs
  USING (true);
GRANT DELETE ON "Instructor" TO ultm8_jobs;
CREATE POLICY "instructor_jobs_delete" ON "Instructor"
  FOR DELETE
  TO ultm8_jobs
  USING (true);

GRANT DELETE ON "Rank" TO ultm8_jobs;
CREATE POLICY "rank_jobs_delete" ON "Rank"
  FOR DELETE
  TO ultm8_jobs
  USING (true);

-- Rank's own extra pre-delete re-verification (see header comment above).
GRANT SELECT ON "PromotionEvent" TO ultm8_jobs;
CREATE POLICY "promotion_event_jobs_read" ON "PromotionEvent"
  FOR SELECT
  TO ultm8_jobs
  USING (true);
GRANT SELECT ON "InstructorBelt" TO ultm8_jobs;
CREATE POLICY "instructor_belt_jobs_read" ON "InstructorBelt"
  FOR SELECT
  TO ultm8_jobs
  USING (true);

-- Lesson: never granted anything to ultm8_jobs before now — needs SELECT AND
-- DELETE, same reasoning as Instructor above.
GRANT SELECT ON "Lesson" TO ultm8_jobs;
CREATE POLICY "lesson_jobs_read" ON "Lesson"
  FOR SELECT
  TO ultm8_jobs
  USING (true);
GRANT DELETE ON "Lesson" TO ultm8_jobs;
CREATE POLICY "lesson_jobs_delete" ON "Lesson"
  FOR DELETE
  TO ultm8_jobs
  USING (true);
