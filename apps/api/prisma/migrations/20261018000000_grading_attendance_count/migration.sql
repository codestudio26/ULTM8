-- Grading engine, roadmap Phase 2b (Decisions 140, 149, 170, 171): attendance
-- counts per class type, and the moment counting toward the current rung began.
ALTER TABLE "StudentRank" ADD COLUMN "classesAttendedByType" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "StudentRank" ADD COLUMN "countingSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing rows: counting began at the last action that reset the class count
-- (a grade, downgrade or stripe award), else when the rank row was created.
UPDATE "StudentRank" sr
SET "countingSince" = COALESCE(
  (SELECT MAX(pe."createdAt") FROM "PromotionEvent" pe
   WHERE pe."studentRankId" = sr."id"
     AND pe."type" IN ('PROMOTION', 'DOWNGRADE', 'STRIPE_AWARD', 'BULK_PROMOTION', 'BULK_STRIPE_AWARD')),
  sr."createdAt");
