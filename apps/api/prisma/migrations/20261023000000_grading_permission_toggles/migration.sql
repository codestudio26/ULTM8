-- Grading permission becomes seven toggles per person per style (Decision 181).
-- All on by default: a grant made before this keeps everything it allowed
-- (Decision 138), and nobody uses the system live yet.
ALTER TABLE "GradingPermission"
  ADD COLUMN "canPromote" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canDowngrade" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canSignOffSkills" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canAdjustProgress" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canVerifyRanks" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canVoidHistory" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canChangeBoardThresholds" BOOLEAN NOT NULL DEFAULT true;
