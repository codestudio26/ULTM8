-- Decision 309 — a discipline can be archived (retired) once no live class or
-- timetable slot uses it; it is never purged, since students' rank history
-- points at it. Null = in use.
ALTER TABLE "Discipline" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Decision 309 — the owner puts a discipline's skills in order. Existing
-- skills start in name order, which is how they were listed until now.
ALTER TABLE "Skill" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
UPDATE "Skill" AS s
SET "order" = ranked.position
FROM (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "disciplineId" ORDER BY "name", "id") - 1)::int AS position
  FROM "Skill"
) AS ranked
WHERE s."id" = ranked."id";
