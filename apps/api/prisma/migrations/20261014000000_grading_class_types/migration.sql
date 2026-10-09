-- Grading foundation PR 5 — styles and class types on classes, and how
-- classes count toward a rung (Decisions 140, 143, 149, 152, 170). Additive.

CREATE TYPE "ClassCountMode" AS ENUM ('ANY_TYPE', 'EACH_TYPE');

ALTER TABLE "Class" ADD COLUMN "styles" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "TimetableSlot" ADD COLUMN "styles" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "RankStripeTier" ADD COLUMN "classCountMode" "ClassCountMode" NOT NULL DEFAULT 'ANY_TYPE';
ALTER TABLE "RankStripeTier" ADD COLUMN "classTypeRequirements" JSONB NOT NULL DEFAULT '[]';

-- One-time mapping of existing free text (Decision 152: "existing free-text
-- values need a one-time mapping"). Each `activities` entry that names exactly
-- one style (Discipline) of the same School becomes that style, with no class
-- type yet. An entry that names no style, or a name two styles share, is left
-- out and reported below; `activities` itself is not changed.
WITH matches AS (
  SELECT c."id" AS class_id, d."id" AS discipline_id
  FROM "Class" c
  CROSS JOIN LATERAL unnest(c."activities") AS a(name)
  JOIN "Discipline" d ON d."schoolId" = c."schoolId" AND d."name" = a.name
  WHERE (SELECT COUNT(*) FROM "Discipline" d2 WHERE d2."schoolId" = c."schoolId" AND d2."name" = a.name) = 1
)
UPDATE "Class" c
SET "styles" = sub.styles
FROM (
  SELECT class_id, jsonb_agg(DISTINCT jsonb_build_object('disciplineId', discipline_id, 'classType', NULL)) AS styles
  FROM matches GROUP BY class_id
) sub
WHERE c."id" = sub.class_id;

WITH matches AS (
  SELECT t."id" AS slot_id, d."id" AS discipline_id
  FROM "TimetableSlot" t
  CROSS JOIN LATERAL unnest(t."activities") AS a(name)
  JOIN "Discipline" d ON d."schoolId" = t."schoolId" AND d."name" = a.name
  WHERE (SELECT COUNT(*) FROM "Discipline" d2 WHERE d2."schoolId" = t."schoolId" AND d2."name" = a.name) = 1
)
UPDATE "TimetableSlot" t
SET "styles" = sub.styles
FROM (
  SELECT slot_id, jsonb_agg(DISTINCT jsonb_build_object('disciplineId', discipline_id, 'classType', NULL)) AS styles
  FROM matches GROUP BY slot_id
) sub
WHERE t."id" = sub.slot_id;

DO $$
DECLARE
  unmapped_classes INTEGER;
  unmapped_slots INTEGER;
BEGIN
  SELECT COUNT(*) INTO unmapped_classes FROM "Class" c
  WHERE c."styles" = '[]'::jsonb AND cardinality(c."activities") > 0
    AND EXISTS (SELECT 1 FROM "Discipline" d WHERE d."schoolId" = c."schoolId");
  SELECT COUNT(*) INTO unmapped_slots FROM "TimetableSlot" t
  WHERE t."styles" = '[]'::jsonb AND cardinality(t."activities") > 0
    AND EXISTS (SELECT 1 FROM "Discipline" d WHERE d."schoolId" = t."schoolId");
  IF unmapped_classes > 0 OR unmapped_slots > 0 THEN
    RAISE NOTICE 'Decision 152: % class(es) and % timetable slot(s) in Schools with styles have activities that name no single style; the owner picks their styles.', unmapped_classes, unmapped_slots;
  END IF;
END $$;
