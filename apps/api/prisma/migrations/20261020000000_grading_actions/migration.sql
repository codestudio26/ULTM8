-- Grading actions, roadmap Phase 3a. Additive.
-- Per-style "skills required" switch (Decision 128, item 10); off by default,
-- which is today's behaviour (a written acknowledgement lets grading go ahead).
ALTER TABLE "Discipline" ADD COLUMN "skillsRequiredToGrade" BOOLEAN NOT NULL DEFAULT false;
-- Starting classes per type for "each type required" rungs (Decision 174).
ALTER TABLE "PromotionEvent" ADD COLUMN "startingClassesByType" JSONB;
