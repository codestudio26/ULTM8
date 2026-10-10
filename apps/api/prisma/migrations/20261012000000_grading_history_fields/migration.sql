-- Grading foundation PR 3 — history fields and the skill sign-off log
-- (Decisions 128, 129, 141, 153, 156, 166). Additive; nothing is removed.

-- PromotionEvent ------------------------------------------------------------

ALTER TYPE "PromotionEventType" ADD VALUE 'ADJUSTMENT';

ALTER TABLE "PromotionEvent" ADD COLUMN "effectiveDate" TIMESTAMP(3);
-- Existing entries took effect when they were written.
UPDATE "PromotionEvent" SET "effectiveDate" = "createdAt";
ALTER TABLE "PromotionEvent" ALTER COLUMN "effectiveDate" SET NOT NULL;
ALTER TABLE "PromotionEvent" ALTER COLUMN "effectiveDate" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "PromotionEvent" ADD COLUMN "reason" TEXT;
ALTER TABLE "PromotionEvent" ADD COLUMN "systemNote" TEXT;
ALTER TABLE "PromotionEvent" ADD COLUMN "note" TEXT;
ALTER TABLE "PromotionEvent" ADD COLUMN "rungsSkipped" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PromotionEvent" ADD COLUMN "startingClasses" INTEGER;
ALTER TABLE "PromotionEvent" ADD COLUMN "voidedAt" TIMESTAMP(3);
ALTER TABLE "PromotionEvent" ADD COLUMN "voidedById" TEXT;
ALTER TABLE "PromotionEvent" ADD COLUMN "voidReason" TEXT;
ALTER TABLE "PromotionEvent" ADD CONSTRAINT "PromotionEvent_voidedById_fkey"
  FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Decision 141: deleting an instructor's account keeps students' history; the
-- "graded by" becomes empty and reads "Former instructor".
ALTER TABLE "PromotionEvent" ALTER COLUMN "performedById" DROP NOT NULL;
ALTER TABLE "PromotionEvent" DROP CONSTRAINT "PromotionEvent_performedById_fkey";
ALTER TABLE "PromotionEvent" ADD CONSTRAINT "PromotionEvent_performedById_fkey"
  FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SkillSignOffLog (Decision 156) --------------------------------------------

CREATE TABLE "SkillSignOffLog" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "studentRankId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "fromStatus" "SkillSignOffStatus" NOT NULL,
    "toStatus" "SkillSignOffStatus" NOT NULL,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkillSignOffLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SkillSignOffLog_studentRankId_fkey" FOREIGN KEY ("studentRankId") REFERENCES "StudentRank"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SkillSignOffLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SkillSignOffLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SkillSignOffLog_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SkillSignOffLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Append-only from the app: no UPDATE or DELETE grant.
GRANT SELECT, INSERT ON "SkillSignOffLog" TO ultm8_app;
CREATE INDEX "SkillSignOffLog_schoolId_idx" ON "SkillSignOffLog"("schoolId");
CREATE INDEX "SkillSignOffLog_studentId_idx" ON "SkillSignOffLog"("studentId");
CREATE INDEX "SkillSignOffLog_studentRankId_idx" ON "SkillSignOffLog"("studentRankId");

-- Same narrow shape as StudentRankSkillStatus (Decision 88).
ALTER TABLE "SkillSignOffLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SkillSignOffLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "skill_sign_off_log_school_staff_or_self" ON "SkillSignOffLog"
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."schoolId" = "SkillSignOffLog"."schoolId"
        AND rg."role" = 'SCHOOL_OWNER_MANAGER'
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
    )
    OR "SkillSignOffLog"."studentId" = current_setting('app.current_user_id', true)
  );
