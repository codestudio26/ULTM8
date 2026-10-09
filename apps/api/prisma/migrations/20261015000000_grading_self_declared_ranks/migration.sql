-- Grading foundation PR 6 — self-declared ranks and their verification
-- (Decisions 137, 147). Additive. Existing StudentRanks were all given by
-- staff, so they default to VERIFIED.

ALTER TYPE "PromotionEventType" ADD VALUE 'SELF_DECLARED';
ALTER TYPE "PromotionEventType" ADD VALUE 'RANK_CORRECTION';

CREATE TYPE "RankVerificationStatus" AS ENUM ('VERIFIED', 'UNVERIFIED');

ALTER TABLE "StudentRank" ADD COLUMN "verificationStatus" "RankVerificationStatus" NOT NULL DEFAULT 'VERIFIED';
ALTER TABLE "StudentRank" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "StudentRank" ADD COLUMN "verifiedById" TEXT;
ALTER TABLE "StudentRank" ADD CONSTRAINT "StudentRank_verifiedById_fkey"
  FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The owner's "waiting to be verified" list (Decision 137, item 4).
CREATE INDEX "StudentRank_schoolId_verificationStatus_idx" ON "StudentRank"("schoolId", "verificationStatus");
