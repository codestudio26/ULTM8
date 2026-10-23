-- Promotion fee (Decisions 287, 297, 300, 307, 313). Additive.
--
-- 1. Two School-wide switches, owner only (Decision 297), both off by default
--    (Decision 307): the promotion fee itself, and "Allow grading before the
--    fee is paid".
-- 2. A price per rung, in the School's currency, minor units; null = free
--    (Decision 300). Hidden by the API while the fee is off (Decision 307).
-- 3. PromotionFeeRequest: one per priced grade, answered by the student or
--    the Guardian of a linked minor. Paying it belongs to staff-created
--    charges (Decision 303), not built yet.

ALTER TABLE "School" ADD COLUMN "promotionFeeEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "School" ADD COLUMN "promotionFeeGradeBeforePaid" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "RankStripeTier" ADD COLUMN "promotionFeeMinor" INTEGER;
-- One way to say "free": no price. Zero and negative prices are refused.
ALTER TABLE "RankStripeTier" ADD CONSTRAINT "RankStripeTier_promotionFeeMinor_positive" CHECK ("promotionFeeMinor" IS NULL OR "promotionFeeMinor" > 0);

CREATE TYPE "PromotionFeeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'PAID', 'DECLINED', 'WAIVED', 'CANCELLED');
CREATE TYPE "PromotionToDecideResolution" AS ENUM ('PROMOTED', 'DISMISSED');

CREATE TABLE "PromotionFeeRequest" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "toRungId" TEXT NOT NULL,
    "toRungName" TEXT NOT NULL,
    "expectedCurrentRungId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT,
    "status" "PromotionFeeStatus" NOT NULL DEFAULT 'PENDING',
    "promotionWaits" BOOLEAN NOT NULL,
    "pendingGrade" JSONB,
    "promotionEventId" TEXT,
    "gradedById" TEXT,
    "respondedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "closedById" TEXT,
    "waivedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "toDecideAt" TIMESTAMP(3),
    "toDecideRemindedAt" TIMESTAMP(3),
    "toDecideResolvedAt" TIMESTAMP(3),
    "toDecideResolution" "PromotionToDecideResolution",
    "toDecideResolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionFeeRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PromotionFeeRequest_amountMinor_positive" CHECK ("amountMinor" > 0),
    CONSTRAINT "PromotionFeeRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PromotionFeeRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PromotionFeeRequest_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PromotionFeeRequest_gradedById_fkey" FOREIGN KEY ("gradedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PromotionFeeRequest_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PromotionFeeRequest_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PromotionFeeRequest_toDecideResolvedById_fkey" FOREIGN KEY ("toDecideResolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "PromotionFeeRequest_schoolId_status_idx" ON "PromotionFeeRequest"("schoolId", "status");
CREATE INDEX "PromotionFeeRequest_studentId_idx" ON "PromotionFeeRequest"("studentId");
CREATE INDEX "PromotionFeeRequest_disciplineId_idx" ON "PromotionFeeRequest"("disciplineId");
CREATE INDEX "PromotionFeeRequest_toDecideAt_idx" ON "PromotionFeeRequest"("toDecideAt");

-- No DELETE from the app: a request is answered, waived or cancelled, never removed.
GRANT SELECT, INSERT, UPDATE ON "PromotionFeeRequest" TO ultm8_app;

ALTER TABLE "PromotionFeeRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromotionFeeRequest" FORCE ROW LEVEL SECURITY;

-- The School owner/manager: every request of their School.
CREATE POLICY "promotion_fee_request_owner" ON "PromotionFeeRequest"
  USING (is_active_school_owner_manager("PromotionFeeRequest"."schoolId"));

-- The student: their own requests. Grading writes run under the student's own
-- context (Decision 88), so the API writes requests there too, after its own
-- checks (a coach grading, the payer answering, the owner waiving).
CREATE POLICY "promotion_fee_request_student_self" ON "PromotionFeeRequest"
  USING ("PromotionFeeRequest"."studentId" = current_setting('app.current_user_id', true));

-- An active Guardian of the student reads the student's requests (Decision
-- 300 item 5: the Guardian accepts for a child). Their answer is written
-- under the student's context after GuardiansService.assertGuardianOfStudent,
-- the same way grading reads for a guardian already work (Decision 132).
CREATE POLICY "promotion_fee_request_guardian_read" ON "PromotionFeeRequest"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "GuardianLink" gl
      WHERE gl."guardianId" = current_setting('app.current_user_id', true)
        AND gl."studentId" = "PromotionFeeRequest"."studentId"
        AND gl."revokedAt" IS NULL
    )
  );

-- Staff who see the student on the Grading Board read their requests ("Waiting
-- for fee", "Fee declined", "to decide"): the same rule as grading_board_rows()
-- (Decisions 168, 169): in a School with no branches every staff member; in a
-- School with branches, staff assigned to the student's home branch. Read only.
CREATE POLICY "promotion_fee_request_staff_read" ON "PromotionFeeRequest"
  FOR SELECT
  USING (
    is_staff_of_school_without_branches("PromotionFeeRequest"."schoolId")
    OR EXISTS (
      SELECT 1
      FROM "StudentHomeBranch" h
      JOIN "RoleGrant" rg ON rg."branchId" = h."branchId"
      WHERE h."schoolId" = "PromotionFeeRequest"."schoolId"
        AND h."studentId" = "PromotionFeeRequest"."studentId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."schoolId" = "PromotionFeeRequest"."schoolId"
        AND rg."role" IN ('INSTRUCTOR', 'BRANCH_STAFF')
        AND rg."revokedAt" IS NULL
    )
  );

-- The "to decide" reminder (Decision 313) runs in the daily grading sweep as
-- ultm8_jobs: it reads requests left "to decide" and marks the one reminder
-- as sent. Its only write is that marker (plus updatedAt, which Prisma sets on
-- every update), as with StudentRank.readyNotifiedAt (Decision 178.5).
GRANT SELECT ON "PromotionFeeRequest" TO ultm8_jobs;
CREATE POLICY "promotion_fee_request_jobs_read" ON "PromotionFeeRequest" FOR SELECT TO ultm8_jobs USING (true);
GRANT UPDATE ("toDecideRemindedAt", "updatedAt") ON "PromotionFeeRequest" TO ultm8_jobs;
CREATE POLICY "promotion_fee_request_jobs_update" ON "PromotionFeeRequest" FOR UPDATE TO ultm8_jobs USING (true) WITH CHECK (true);
