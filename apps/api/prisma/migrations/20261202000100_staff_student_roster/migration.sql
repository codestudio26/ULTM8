-- Decision 353 (Q4 follow-up) — the students a Branch Staff member or coach can
-- pick when booking a walk-in (Timetable) or adding a student to a Class.
--
-- RoleGrant RLS only lets the School's owner list its students (plus staff of a
-- School without branches, rolegrant_branchless_staff_student_read), so Branch
-- Staff and coaches at a School with branches saw an empty list. This returns
-- them the same students the Grading Board does (Decision 139,
-- grading_board_rows, 20261027000000): an active INSTRUCTOR or BRANCH_STAFF
-- grant at the School is required; in a School with branches, the students
-- whose home branch is one of the caller's branches; in a School without
-- branches, every enrolled student. Only students with an active STUDENT grant.
-- Impersonation-scoped like the other helpers. It returns the roster's own
-- columns (name, email, photo, enrolled date) and nothing else.

CREATE FUNCTION "staff_student_roster"(p_school_id text)
RETURNS TABLE (
  "id" text, "firstName" text, "surname" text, "email" text,
  "profilePhotoUrl" text, "enrolledAt" timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH my_grants AS (
    SELECT rg."branchId" FROM public."RoleGrant" rg
    WHERE rg."userId" = current_setting('app.current_user_id', true)
      AND rg."schoolId" = p_school_id
      AND rg."role" IN ('INSTRUCTOR', 'BRANCH_STAFF')
      AND rg."revokedAt" IS NULL
  ),
  allowed AS (
    SELECT EXISTS (SELECT 1 FROM my_grants)
      AND (
        current_setting('app.impersonation_school_id', true) IS NULL
        OR current_setting('app.impersonation_school_id', true) = ''
        OR current_setting('app.impersonation_school_id', true) = p_school_id
      ) AS ok,
      EXISTS (SELECT 1 FROM public."Branch" WHERE "schoolId" = p_school_id) AS has_branches
  ),
  students AS (
    SELECT rg."userId" AS sid, MIN(rg."grantedAt") AS enrolled FROM public."RoleGrant" rg
    WHERE rg."schoolId" = p_school_id AND rg."role" = 'STUDENT' AND rg."revokedAt" IS NULL
    GROUP BY rg."userId"
  )
  SELECT u."id", u."firstName", u."surname", u."email", u."profilePhotoUrl", s.enrolled
  FROM students s
  CROSS JOIN allowed a
  JOIN public."User" u ON u."id" = s.sid
  LEFT JOIN public."StudentHomeBranch" h ON h."schoolId" = p_school_id AND h."studentId" = s.sid
  WHERE a.ok
    AND (NOT a.has_branches OR h."branchId" IN (SELECT g."branchId" FROM my_grants g WHERE g."branchId" IS NOT NULL))
  ORDER BY s.enrolled ASC;
$$;
ALTER FUNCTION "staff_student_roster"(text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "staff_student_roster"(text) TO ultm8_app;
