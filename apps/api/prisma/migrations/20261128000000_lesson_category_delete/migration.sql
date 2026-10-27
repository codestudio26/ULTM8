-- Decision 326: the School owner may delete a lesson category. Its lessons
-- move to "No category" through the existing ON DELETE SET NULL foreign key.
GRANT DELETE ON "LessonCategory" TO ultm8_app;

CREATE POLICY "lesson_category_owner_delete" ON "LessonCategory"
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."schoolId" = "LessonCategory"."schoolId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."role" = 'SCHOOL_OWNER_MANAGER'
        AND rg."revokedAt" IS NULL
    )
  );
