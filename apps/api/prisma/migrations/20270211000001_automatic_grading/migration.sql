-- Automatic grading (Decision 321 items 1–7; GRADING-BACKEND-HANDOVER.md B12).
--
-- 1. Discipline: the requirement tick boxes (classes, days in rank and skills
--    ticked by default, as every style worked before; hours, days attended
--    and minimum age not), the automatic promotion setting (MANUAL by
--    default) and "Auto-assign first belt" (off by default). So nothing
--    changes for a School until its owner changes a setting. Discipline rows
--    are already readable and writable under the existing policies; the
--    owner-only rule is enforced in the service, as for the style's other
--    settings.
--
-- 2. RankStripeTier: hours, days attended and minimum age per rung. Null =
--    not asked. Same table policies as the rung's other numbers.
--
-- 3. PromotionEvent: "automatic" (given by the system, no performer) and when
--    and by whom an automatic promotion was undone. Written under the
--    student's own context like every other history write; no grant change.
--
-- 4. ultm8_jobs may read TrainingLog. The grading-notifications job (the
--    daily sweep and the check after each check-in) decides readiness and
--    automatic promotion with hours trained and days attended in a style
--    that ticks them, the same way it already reads StudentRank and the
--    ladder (20261022000000). Read only, and only this table: the job never
--    writes it. The promotion itself is applied by the API's grading path
--    under the student's own context, never by ultm8_jobs.

CREATE TYPE "GradingPromotionMode" AS ENUM ('MANUAL', 'AUTO_STRIPES', 'AUTO_ALL');

ALTER TABLE "Discipline"
  ADD COLUMN "requireClasses" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "requireDaysInRank" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "requireSkills" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "requireHours" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requireDaysAttended" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requireMinimumAge" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "promotionMode" "GradingPromotionMode" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "autoAssignFirstRank" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "RankStripeTier"
  ADD COLUMN "hoursRequired" INTEGER,
  ADD COLUMN "daysAttendedRequired" INTEGER,
  ADD COLUMN "minimumAge" INTEGER,
  ADD CONSTRAINT "RankStripeTier_hoursRequired_nonnegative" CHECK ("hoursRequired" IS NULL OR "hoursRequired" >= 0),
  ADD CONSTRAINT "RankStripeTier_daysAttendedRequired_nonnegative" CHECK ("daysAttendedRequired" IS NULL OR "daysAttendedRequired" >= 0),
  ADD CONSTRAINT "RankStripeTier_minimumAge_range" CHECK ("minimumAge" IS NULL OR ("minimumAge" >= 0 AND "minimumAge" <= 120));

ALTER TABLE "PromotionEvent"
  ADD COLUMN "automatic" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "automaticUndoneAt" TIMESTAMP(3),
  ADD COLUMN "automaticUndoneById" TEXT;

ALTER TABLE "PromotionEvent" ADD CONSTRAINT "PromotionEvent_automaticUndoneById_fkey"
  FOREIGN KEY ("automaticUndoneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

GRANT SELECT ON "TrainingLog" TO ultm8_jobs;
CREATE POLICY "training_log_jobs_read" ON "TrainingLog" FOR SELECT TO ultm8_jobs USING (true);
