-- Decision 374 — Dashboard: Active students, this week's birthdays, setup checklist.

-- The owner can hide the setup checklist (Decision 318 item 1).
ALTER TABLE "School" ADD COLUMN "setupChecklistHiddenAt" TIMESTAMP(3);

-- This week's birthdays (Decision 318 item 2): every member of staff at the
-- School sees them, children included, with the date but not the age. User RLS
-- doesn't show Branch Staff and coaches the students of a School with branches,
-- so this returns, for the students the caller may see, the month and day of
-- birth only (never the year, so no age can be worked out). Who counts:
--   - the School's owner (an active SCHOOL_OWNER_MANAGER grant): every enrolled student;
--   - an active INSTRUCTOR or BRANCH_STAFF grant: the same students as
--     staff_student_roster (their branches' students, or every student in a
--     School without branches).
-- Only students with an active STUDENT grant and a date of birth.
-- Impersonation-scoped like the other helpers.
CREATE FUNCTION "school_student_birthdays"(p_school_id text)
RETURNS TABLE (
  "id" text, "firstName" text, "surname" text, "birthMonth" integer, "birthDay" integer
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH my_grants AS (
    SELECT rg."role", rg."branchId" FROM public."RoleGrant" rg
    WHERE rg."userId" = current_setting('app.current_user_id', true)
      AND rg."schoolId" = p_school_id
      AND rg."role" IN ('SCHOOL_OWNER_MANAGER', 'INSTRUCTOR', 'BRANCH_STAFF')
      AND rg."revokedAt" IS NULL
  ),
  allowed AS (
    SELECT EXISTS (SELECT 1 FROM my_grants)
      AND (
        current_setting('app.impersonation_school_id', true) IS NULL
        OR current_setting('app.impersonation_school_id', true) = ''
        OR current_setting('app.impersonation_school_id', true) = p_school_id
      ) AS ok,
      EXISTS (SELECT 1 FROM my_grants WHERE "role" = 'SCHOOL_OWNER_MANAGER') AS is_owner,
      EXISTS (SELECT 1 FROM public."Branch" WHERE "schoolId" = p_school_id) AS has_branches
  ),
  students AS (
    SELECT DISTINCT rg."userId" AS sid FROM public."RoleGrant" rg
    WHERE rg."schoolId" = p_school_id AND rg."role" = 'STUDENT' AND rg."revokedAt" IS NULL
  )
  SELECT u."id", u."firstName", u."surname",
         EXTRACT(MONTH FROM u."dateOfBirth")::integer, EXTRACT(DAY FROM u."dateOfBirth")::integer
  FROM students s
  CROSS JOIN allowed a
  JOIN public."User" u ON u."id" = s.sid
  LEFT JOIN public."StudentHomeBranch" h ON h."schoolId" = p_school_id AND h."studentId" = s.sid
  WHERE a.ok
    AND u."dateOfBirth" IS NOT NULL
    AND (
      a.is_owner
      OR NOT a.has_branches
      OR h."branchId" IN (SELECT g."branchId" FROM my_grants g WHERE g."branchId" IS NOT NULL)
    );
$$;
ALTER FUNCTION "school_student_birthdays"(text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "school_student_birthdays"(text) TO ultm8_app;
