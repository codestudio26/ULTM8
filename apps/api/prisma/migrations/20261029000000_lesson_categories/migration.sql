-- Lesson categories (Decisions 128.15, 191): a real list per School with its
-- own order, and lessons ordered within their category. Replaces the free-text
-- Lesson.category: each School's distinct texts become categories (in
-- alphabetical order), their lessons keep their category in title order, and
-- the text column goes.
--
-- RLS: like Lesson, anyone with an active role at the School reads the list;
-- only its staff (owner, Instructors, Branch Staff) write it, matching the
-- API's own check for lesson writes (assertStaffAtSchool).

CREATE TABLE "LessonCategory" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LessonCategory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LessonCategory_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LessonCategory_schoolId_idx" ON "LessonCategory"("schoolId");

ALTER TABLE "Lesson" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "LessonCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Lesson_categoryId_idx" ON "Lesson"("categoryId");

-- Existing free-text categories become real ones.
INSERT INTO "LessonCategory" ("id", "schoolId", "name", "order", "updatedAt")
SELECT gen_random_uuid()::text, c."schoolId", c."name",
       (ROW_NUMBER() OVER (PARTITION BY c."schoolId" ORDER BY lower(c."name"), c."name"))::int - 1,
       CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT "schoolId", btrim("category") AS "name"
  FROM "Lesson"
  WHERE "category" IS NOT NULL AND btrim("category") <> ''
) c;

UPDATE "Lesson" l
SET "categoryId" = lc."id"
FROM "LessonCategory" lc
WHERE lc."schoolId" = l."schoolId" AND lc."name" = btrim(l."category");

UPDATE "Lesson" l
SET "order" = o.rn
FROM (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "schoolId", "categoryId" ORDER BY lower("title"), "createdAt"))::int - 1 AS rn
  FROM "Lesson"
) o
WHERE o."id" = l."id";

ALTER TABLE "Lesson" DROP COLUMN "category";

GRANT SELECT, INSERT, UPDATE ON "LessonCategory" TO ultm8_app;

ALTER TABLE "LessonCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LessonCategory" FORCE ROW LEVEL SECURITY;
CREATE POLICY "lesson_category_read" ON "LessonCategory"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."schoolId" = "LessonCategory"."schoolId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
    )
  );
CREATE POLICY "lesson_category_staff_insert" ON "LessonCategory"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."schoolId" = "LessonCategory"."schoolId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."role" IN ('SCHOOL_OWNER_MANAGER', 'INSTRUCTOR', 'BRANCH_STAFF')
        AND rg."revokedAt" IS NULL
    )
  );
CREATE POLICY "lesson_category_staff_update" ON "LessonCategory"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."schoolId" = "LessonCategory"."schoolId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."role" IN ('SCHOOL_OWNER_MANAGER', 'INSTRUCTOR', 'BRANCH_STAFF')
        AND rg."revokedAt" IS NULL
    )
  );
