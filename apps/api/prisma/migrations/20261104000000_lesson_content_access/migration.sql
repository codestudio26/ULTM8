-- Decision 208: who may read a lesson's content is decided in the database too,
-- not only by the API (Decisions 154, 190, 195). The content (description,
-- video, captions) moves to its own table; the lesson's title, category,
-- order, styles and "free" stay on "Lesson", readable by anyone at the School
-- as before, so a locked lesson still shows what it is.

CREATE TABLE "LessonContent" (
  "lessonId" TEXT NOT NULL,
  "description" TEXT,
  "videoRef" TEXT,
  "captionTrackRef" TEXT,
  CONSTRAINT "LessonContent_pkey" PRIMARY KEY ("lessonId"),
  CONSTRAINT "LessonContent_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "LessonContent" ("lessonId", "description", "videoRef", "captionTrackRef")
SELECT "id", "description", "videoRef", "captionTrackRef" FROM "Lesson";

ALTER TABLE "Lesson" DROP COLUMN "description", DROP COLUMN "videoRef", DROP COLUMN "captionTrackRef";

GRANT SELECT, INSERT, UPDATE, DELETE ON "LessonContent" TO ultm8_app;

-- The helper reads what the rule needs, bypassing those tables' own RLS
-- (the caller is a student, who can't read every row the rule looks at).
GRANT SELECT ON "Lesson", "LessonSkill", "Skill", "MembershipPlan" TO ultm8_rls_helper;

-- Staff at the lesson's School (Owner/Manager, Branch Staff, Instructor):
-- they read and write every lesson's content.
CREATE FUNCTION "is_lesson_staff"(p_lesson_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."Lesson" l
    JOIN public."RoleGrant" rg ON rg."schoolId" = l."schoolId"
    WHERE l."id" = p_lesson_id
      AND rg."userId" = current_setting('app.current_user_id', true)
      AND rg."revokedAt" IS NULL
      AND rg."role" IN ('SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF', 'INSTRUCTOR')
      AND (
        current_setting('app.impersonation_school_id', true) IS NULL
        OR current_setting('app.impersonation_school_id', true) = ''
        OR current_setting('app.impersonation_school_id', true) = l."schoolId"
      )
  );
$$;
ALTER FUNCTION "is_lesson_staff"(text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "is_lesson_staff"(text) TO ultm8_app;

-- Who may read a lesson's content: staff; anyone at the School when the
-- lesson is free; a student with a live membership (active, not expired,
-- credits left) on a plan that includes lessons and covers one of the
-- lesson's styles (its skills' styles). Same rule as the API's.
CREATE FUNCTION "can_view_lesson_content"(p_lesson_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT public."is_lesson_staff"(p_lesson_id) OR EXISTS (
    SELECT 1
    FROM public."Lesson" l
    WHERE l."id" = p_lesson_id
      AND (
        current_setting('app.impersonation_school_id', true) IS NULL
        OR current_setting('app.impersonation_school_id', true) = ''
        OR current_setting('app.impersonation_school_id', true) = l."schoolId"
      )
      AND (
        (l."free" AND EXISTS (
          SELECT 1 FROM public."RoleGrant" rg
          WHERE rg."schoolId" = l."schoolId"
            AND rg."userId" = current_setting('app.current_user_id', true)
            AND rg."revokedAt" IS NULL
        ))
        OR EXISTS (
          SELECT 1
          FROM public."Membership" m
          JOIN public."MembershipPlan" p ON p."id" = m."membershipPlanId"
          WHERE m."studentId" = current_setting('app.current_user_id', true)
            AND m."schoolId" = l."schoolId"
            AND m."status" = 'ACTIVE'
            AND (m."expiryDate" IS NULL OR m."expiryDate" >= (now() AT TIME ZONE 'UTC'))
            AND (m."classesRemaining" IS NULL OR m."classesRemaining" > 0)
            AND p."includesLessons"
            AND p."disciplineIds" && ARRAY(
              SELECT s."disciplineId"
              FROM public."LessonSkill" ls
              JOIN public."Skill" s ON s."id" = ls."skillId"
              WHERE ls."lessonId" = l."id"
            )
        )
      )
  );
$$;
ALTER FUNCTION "can_view_lesson_content"(text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "can_view_lesson_content"(text) TO ultm8_app;

ALTER TABLE "LessonContent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LessonContent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "lesson_content_read" ON "LessonContent"
  FOR SELECT
  USING (can_view_lesson_content("LessonContent"."lessonId"));
CREATE POLICY "lesson_content_staff_write" ON "LessonContent"
  USING (is_lesson_staff("LessonContent"."lessonId"))
  WITH CHECK (is_lesson_staff("LessonContent"."lessonId"));
