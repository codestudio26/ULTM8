-- Instructor specialisations picked from the School's styles (Decision 152,
-- item 1). Additive.
ALTER TABLE "Instructor" ADD COLUMN "specializationStyleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- One-time mapping (Decision 152: "existing free-text values need a one-time
-- mapping"): each specialisation that names exactly one style of the same
-- School becomes that style. Others are left for the owner; `specializations`
-- itself is not changed here.
UPDATE "Instructor" i
SET "specializationStyleIds" = sub.ids
FROM (
  SELECT i2."id" AS instructor_id, array_agg(DISTINCT d."id") AS ids
  FROM "Instructor" i2
  CROSS JOIN LATERAL unnest(i2."specializations") AS s(name)
  JOIN "Discipline" d ON d."schoolId" = i2."schoolId" AND d."name" = s.name
  WHERE (SELECT COUNT(*) FROM "Discipline" d2 WHERE d2."schoolId" = i2."schoolId" AND d2."name" = s.name) = 1
  GROUP BY i2."id"
) sub
WHERE i."id" = sub.instructor_id;
