-- Decision 347: a per-School owner switch that lets Branch Staff record cash
-- or bank transfer payments taken at the desk. Off for every School.
ALTER TABLE "School" ADD COLUMN "branchStaffCanRecordPayments" BOOLEAN NOT NULL DEFAULT false;

-- The students a Branch Staff member may record a desk payment for: the same
-- rule as the grading board (Decisions 168, 169, 177). In a School with
-- branches, students whose home branch is one of the caller's branches; in a
-- School without branches, every enrolled student. Active STUDENT grants only,
-- impersonation-scoped like the other helpers. Returns names only. Whether
-- the School's switch is on is checked by the API, not here.
CREATE FUNCTION "desk_payment_students"(p_school_id text)
RETURNS TABLE ("id" text, "firstName" text, "surname" text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH my_grants AS (
    SELECT rg."branchId" FROM public."RoleGrant" rg
    WHERE rg."userId" = current_setting('app.current_user_id', true)
      AND rg."schoolId" = p_school_id
      AND rg."role" = 'BRANCH_STAFF'
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
    SELECT DISTINCT rg."userId" AS sid FROM public."RoleGrant" rg
    WHERE rg."schoolId" = p_school_id AND rg."role" = 'STUDENT' AND rg."revokedAt" IS NULL
  )
  SELECT u."id", u."firstName", u."surname"
  FROM students s
  CROSS JOIN allowed a
  JOIN public."User" u ON u."id" = s.sid
  LEFT JOIN public."StudentHomeBranch" h ON h."schoolId" = p_school_id AND h."studentId" = s.sid
  WHERE a.ok
    AND (NOT a.has_branches OR h."branchId" IN (SELECT g."branchId" FROM my_grants g WHERE g."branchId" IS NOT NULL));
$$;
ALTER FUNCTION "desk_payment_students"(text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "desk_payment_students"(text) TO ultm8_app;
