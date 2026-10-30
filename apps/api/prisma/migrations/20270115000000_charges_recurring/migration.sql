-- Recurring charges, step 3 of 6 of staff-created charges (v1.3 backlog §3.6;
-- Decision 303 item 1, Decision 338 item 2, Decision 412).
--
-- 1. RecurringCharge: a charge repeated weekly, monthly or yearly from a first
--    date, until an optional end date or number of payments, or until stopped.
--    Its occurrences are made by the daily charge-recurring job.
-- 2. Charge.recurringChargeId and Charge.occurrenceDate: each occurrence is a
--    normal Charge (its own invoice number, the School's tax at that moment).
--    The unique index on the pair means a rerun of the job, or two runs at
--    once, never makes the same occurrence twice.
--
-- RLS: as Charge (migration 20270112000000_charges_and_balance). Written only
-- on the jobs connection after the API's own checks; ultm8_app reads only: the
-- School owner, staff who cover the student, the student, and an active
-- Guardian. Never deleted.

-- CreateEnum
CREATE TYPE "RecurringChargeFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "RecurringChargeStopReason" AS ENUM ('STAFF', 'STUDENT_LEFT');

-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "occurrenceDate" DATE,
ADD COLUMN     "recurringChargeId" TEXT;
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_occurrence_check" CHECK (("recurringChargeId" IS NULL) = ("occurrenceDate" IS NULL));

-- CreateTable
CREATE TABLE "RecurringCharge" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unitAmount" INTEGER NOT NULL,
    "discountType" "ChargeDiscountType",
    "discountValue" INTEGER,
    "currency" TEXT NOT NULL,
    "frequency" "RecurringChargeFrequency" NOT NULL,
    "firstDate" DATE NOT NULL,
    "endDate" DATE,
    "maxOccurrences" INTEGER,
    "nextIndex" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "nextDate" DATE,
    "stoppedAt" TIMESTAMP(3),
    "stoppedById" TEXT,
    "stoppedReason" "RecurringChargeStopReason",
    "restartedAt" TIMESTAMP(3),
    "restartedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringCharge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RecurringCharge_amounts_check" CHECK (
      "unitAmount" > 0
      AND ("discountType" IS NULL) = ("discountValue" IS NULL)
      AND ("discountValue" IS NULL OR "discountValue" > 0)
    ),
    CONSTRAINT "RecurringCharge_end_check" CHECK (
      NOT ("endDate" IS NOT NULL AND "maxOccurrences" IS NOT NULL)
      AND ("endDate" IS NULL OR "endDate" >= "firstDate")
      AND ("maxOccurrences" IS NULL OR "maxOccurrences" > 0)
    ),
    CONSTRAINT "RecurringCharge_counts_check" CHECK (
      "nextIndex" >= 0 AND "createdCount" >= 0 AND "createdCount" <= "nextIndex"
      AND ("maxOccurrences" IS NULL OR "createdCount" <= "maxOccurrences")
    ),
    CONSTRAINT "RecurringCharge_stopped_check" CHECK (("stoppedAt" IS NULL) = ("stoppedReason" IS NULL))
);

-- CreateIndex
CREATE INDEX "RecurringCharge_schoolId_studentId_idx" ON "RecurringCharge"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "RecurringCharge_studentId_idx" ON "RecurringCharge"("studentId");

-- CreateIndex
CREATE INDEX "RecurringCharge_nextDate_idx" ON "RecurringCharge"("nextDate");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_recurringChargeId_occurrenceDate_key" ON "Charge"("recurringChargeId", "occurrenceDate");

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_recurringChargeId_fkey" FOREIGN KEY ("recurringChargeId") REFERENCES "RecurringCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringCharge" ADD CONSTRAINT "RecurringCharge_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringCharge" ADD CONSTRAINT "RecurringCharge_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringCharge" ADD CONSTRAINT "RecurringCharge_stoppedById_fkey" FOREIGN KEY ("stoppedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringCharge" ADD CONSTRAINT "RecurringCharge_restartedById_fkey" FOREIGN KEY ("restartedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringCharge" ADD CONSTRAINT "RecurringCharge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE "RecurringCharge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecurringCharge" FORCE ROW LEVEL SECURITY;

-- ultm8_app reads only.
GRANT SELECT ON "RecurringCharge" TO ultm8_app;

-- The School owner/manager: every row of their School.
CREATE POLICY "recurring_charge_owner_read" ON "RecurringCharge" FOR SELECT TO ultm8_app
  USING (is_active_school_owner_manager("RecurringCharge"."schoolId"));

-- The student: their own rows.
CREATE POLICY "recurring_charge_student_self_read" ON "RecurringCharge" FOR SELECT TO ultm8_app
  USING ("RecurringCharge"."studentId" = current_setting('app.current_user_id', true));

-- An active Guardian: their linked child's rows.
CREATE POLICY "recurring_charge_guardian_read" ON "RecurringCharge" FOR SELECT TO ultm8_app
  USING (EXISTS (
    SELECT 1 FROM "GuardianLink" gl
    WHERE gl."guardianId" = current_setting('app.current_user_id', true)
      AND gl."studentId" = "RecurringCharge"."studentId"
      AND gl."revokedAt" IS NULL
  ));

-- Staff who cover the student, as charge_staff_read. The API narrows this
-- further to those with a charges switch before it reads anything.
CREATE POLICY "recurring_charge_staff_read" ON "RecurringCharge" FOR SELECT TO ultm8_app
  USING (
    is_staff_of_school_without_branches("RecurringCharge"."schoolId")
    OR EXISTS (
      SELECT 1
      FROM "StudentHomeBranch" h
      JOIN "RoleGrant" rg ON rg."branchId" = h."branchId"
      WHERE h."schoolId" = "RecurringCharge"."schoolId"
        AND h."studentId" = "RecurringCharge"."studentId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."schoolId" = "RecurringCharge"."schoolId"
        AND rg."role" IN ('INSTRUCTOR', 'BRANCH_STAFF')
        AND rg."revokedAt" IS NULL
    )
  );

-- ultm8_jobs writes, after the API's own checks: insert, and update to move
-- the series on, stop or restart it. No DELETE for anyone.
GRANT SELECT, INSERT, UPDATE ON "RecurringCharge" TO ultm8_jobs;
CREATE POLICY "recurring_charge_jobs_all" ON "RecurringCharge" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
