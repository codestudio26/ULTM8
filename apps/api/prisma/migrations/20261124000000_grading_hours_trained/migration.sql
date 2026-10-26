-- Hours trained (Decisions 301 items 1, 5, 6 and 306): logged, not graded.
--
-- Hours are a RECORD ONLY (Decision 306). Nothing in the grading engine
-- reads this table: no requirement, no %, no readiness, no board column.
--
-- 1. School."openMatCountsTowardHours" — "Open mat counts toward hours"
--    (Grading → Settings), off by default. Changed by the School owner or a
--    coach with the grading-settings right (today
--    GradingPermission."canChangeBoardThresholds") for any style at the
--    School; the API checks that. School rows are already readable and
--    writable at the RLS level by anyone holding a role at the School
--    ("school_tenant_isolation"); the narrower business rule is enforced in
--    the service, as for every other School field.
--
-- 2. "TrainingLog" — one row per style per check-in (the class's scheduled
--    length) and one per "Log a class" (the picked class's length, or the
--    coach's minutes, 60 by default), in whole minutes.
--
--    RLS: the same narrow shape as the other grading records
--    (StudentRank/PromotionEvent, 20260914000000_ranks_module): the School
--    Owner/Manager or the row's own student may read. Every API read and
--    write runs under the student's own context (Decision 88), so the only
--    INSERT path is "as the student", into a School where that student holds
--    a live role — never another School. Append-only from the app: no UPDATE
--    or DELETE grant (FK actions — SET NULL when a class or booking is
--    purged, CASCADE when a School, student, style or history entry is
--    deleted — run as the table owner and need no grant).
--
-- No backfill: hours start from this release. Past check-ins would need each
-- class's style and type at the time, and past "Log a class" entries never
-- recorded a length, so they can't be derived reliably.

ALTER TABLE "School" ADD COLUMN "openMatCountsTowardHours" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "TrainingLogSource" AS ENUM ('CHECK_IN', 'LOGGED');

CREATE TABLE "TrainingLog" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "source" "TrainingLogSource" NOT NULL,
    "openMat" BOOLEAN NOT NULL DEFAULT false,
    "countsTowardHours" BOOLEAN NOT NULL DEFAULT true,
    "classId" TEXT,
    "bookingId" TEXT,
    "promotionEventId" TEXT,
    "trainedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TrainingLog_minutes_positive" CHECK ("minutes" > 0)
);

CREATE INDEX "TrainingLog_schoolId_idx" ON "TrainingLog"("schoolId");
CREATE INDEX "TrainingLog_studentId_disciplineId_idx" ON "TrainingLog"("studentId", "disciplineId");
CREATE INDEX "TrainingLog_classId_idx" ON "TrainingLog"("classId");
CREATE INDEX "TrainingLog_promotionEventId_idx" ON "TrainingLog"("promotionEventId");
CREATE UNIQUE INDEX "TrainingLog_bookingId_disciplineId_key" ON "TrainingLog"("bookingId", "disciplineId");

ALTER TABLE "TrainingLog" ADD CONSTRAINT "TrainingLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingLog" ADD CONSTRAINT "TrainingLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingLog" ADD CONSTRAINT "TrainingLog_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingLog" ADD CONSTRAINT "TrainingLog_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrainingLog" ADD CONSTRAINT "TrainingLog_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrainingLog" ADD CONSTRAINT "TrainingLog_promotionEventId_fkey" FOREIGN KEY ("promotionEventId") REFERENCES "PromotionEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only from the app: no UPDATE or DELETE grant.
GRANT SELECT, INSERT ON "TrainingLog" TO ultm8_app;

ALTER TABLE "TrainingLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingLog" FORCE ROW LEVEL SECURITY;

CREATE POLICY "training_log_owner_or_self_read" ON "TrainingLog"
  FOR SELECT
  TO ultm8_app
  USING (
    is_active_school_owner_manager("TrainingLog"."schoolId")
    OR "TrainingLog"."studentId" = current_setting('app.current_user_id', true)
  );

-- Written only under the student's own context, and only into a School where
-- the student holds a live role (their own RoleGrant rows are always visible
-- to them: rolegrant_self_only).
CREATE POLICY "training_log_written_as_student" ON "TrainingLog"
  FOR INSERT
  TO ultm8_app
  WITH CHECK (
    "TrainingLog"."studentId" = current_setting('app.current_user_id', true)
    AND EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."schoolId" = "TrainingLog"."schoolId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
    )
  );
