-- Grading foundation PR 2 — per-rung ladder fields (Decisions 126, 128, 164).
--
-- Adds, without removing anything:
--   Rank:           name (belt name), tagColour, coralAccent (drawing only)
--   RankStripeTier: name, stripeSegments, weeklyClassCountCap, timeOnly
--   RankStripeTierRequiredSkill: per-rung required Skills
-- Rank.weeklyClassCountCap, Rank.yearsInRankFlag and RankRequiredSkill stay as
-- they are; the current GradingService still reads them until the grading
-- engine (roadmap Phase 2) switches over. ULTM8 is pre-launch (Decision 164),
-- so the backfills below only touch development/test data, but they are
-- written to be correct for any data.

-- Rank ------------------------------------------------------------------------

ALTER TABLE "Rank" ADD COLUMN "name" TEXT;
UPDATE "Rank" SET "name" = 'Belt ' || ("order" + 1)::text;
ALTER TABLE "Rank" ALTER COLUMN "name" SET NOT NULL;

ALTER TABLE "Rank" ADD COLUMN "tagColour" TEXT;
ALTER TABLE "Rank" ADD COLUMN "coralAccent" TEXT;

-- RankStripeTier --------------------------------------------------------------

ALTER TABLE "RankStripeTier" ADD COLUMN "name" TEXT;
ALTER TABLE "RankStripeTier" ADD COLUMN "stripeSegments" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "RankStripeTier" ADD COLUMN "weeklyClassCountCap" INTEGER;
ALTER TABLE "RankStripeTier" ADD COLUMN "timeOnly" BOOLEAN NOT NULL DEFAULT false;

-- Name each existing rung from its belt ("Belt 2 · 3 Stripes"), carry the
-- single count/colour into one segment, and copy the belt-level cap and
-- years-in-rank flag onto every rung of that belt.
UPDATE "RankStripeTier" t
SET
  "name" = r."name" || CASE
    WHEN t."count" = 0 THEN ''
    WHEN t."count" = 1 THEN ' · 1 Stripe'
    ELSE ' · ' || t."count"::text || ' Stripes'
  END,
  "stripeSegments" = CASE
    WHEN t."count" = 0 THEN '[]'::jsonb
    ELSE jsonb_build_array(jsonb_build_object('count', t."count", 'colour', t."colour"))
  END,
  "weeklyClassCountCap" = r."weeklyClassCountCap",
  "timeOnly" = r."yearsInRankFlag"
FROM "Rank" r
WHERE r."id" = t."rankId";

ALTER TABLE "RankStripeTier" ALTER COLUMN "name" SET NOT NULL;

-- RankStripeTierRequiredSkill -------------------------------------------------

-- Same shape and RLS approach as RankRequiredSkill (ranks_module migration):
-- no schoolId of its own; a caller can only reach a row by already seeing
-- both the rung and the Skill under their own policies.
CREATE TABLE "RankStripeTierRequiredSkill" (
    "stripeTierId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    CONSTRAINT "RankStripeTierRequiredSkill_pkey" PRIMARY KEY ("stripeTierId", "skillId"),
    CONSTRAINT "RankStripeTierRequiredSkill_stripeTierId_fkey" FOREIGN KEY ("stripeTierId") REFERENCES "RankStripeTier"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RankStripeTierRequiredSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "RankStripeTierRequiredSkill_skillId_idx" ON "RankStripeTierRequiredSkill"("skillId");
GRANT SELECT, INSERT, UPDATE, DELETE ON "RankStripeTierRequiredSkill" TO ultm8_app;

ALTER TABLE "RankStripeTierRequiredSkill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RankStripeTierRequiredSkill" FORCE ROW LEVEL SECURITY;
CREATE POLICY "rank_stripe_tier_required_skill_tenant_isolation" ON "RankStripeTierRequiredSkill"
  USING (
    EXISTS (SELECT 1 FROM "RankStripeTier" t WHERE t."id" = "RankStripeTierRequiredSkill"."stripeTierId")
    AND EXISTS (SELECT 1 FROM "Skill" s WHERE s."id" = "RankStripeTierRequiredSkill"."skillId")
  );

-- Decision 164: a belt's existing required Skills (old meaning: "needed to
-- LEAVE this belt") move to the FIRST rung of the NEXT belt in the same
-- Discipline (new meaning, Decision 127: "needed to get INTO this rung").
-- Skills on a Discipline's top belt have no next rung and are not copied.
INSERT INTO "RankStripeTierRequiredSkill" ("stripeTierId", "skillId")
SELECT DISTINCT next_tier."id", rrs."skillId"
FROM "RankRequiredSkill" rrs
JOIN "Rank" cur ON cur."id" = rrs."rankId"
JOIN "Rank" nxt ON nxt."disciplineId" = cur."disciplineId" AND nxt."order" = cur."order" + 1
JOIN "RankStripeTier" next_tier ON next_tier."rankId" = nxt."id"
  AND next_tier."order" = (SELECT MIN(t2."order") FROM "RankStripeTier" t2 WHERE t2."rankId" = nxt."id")
ON CONFLICT DO NOTHING;
