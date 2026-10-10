-- Decision 199: the belt-level weekly class cap and required Skills are
-- removed. They live on each rung (RankStripeTier.weeklyClassCountCap and
-- RankStripeTierRequiredSkill, Decision 126), the plain belt's own rung (e.g.
-- "Brown Belt", no stripes) included, and grading reads only those (roadmap
-- Phase 2). Decision 164 already copied every belt's cap onto its rungs and
-- its Skills onto the next belt's first rung; nothing is copied again here,
-- so no student's requirements change. What is dropped is logged.
DO $$
DECLARE
  caps INTEGER;
  skills INTEGER;
BEGIN
  SELECT COUNT(*) INTO caps FROM "Rank" WHERE "weeklyClassCountCap" IS NOT NULL;
  SELECT COUNT(*) INTO skills FROM "RankRequiredSkill";
  RAISE NOTICE 'Decision 199: dropping % belt-level weekly cap(s) and % belt-level required-Skill row(s); grading reads the rungs'' own.', caps, skills;
END $$;

DROP TABLE "RankRequiredSkill";
ALTER TABLE "Rank" DROP COLUMN "weeklyClassCountCap";
