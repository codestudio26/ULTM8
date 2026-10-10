-- Grading Board, roadmap Phase 3b (Decisions 152, 175): the manual
-- Active/Inactive switch per student per style. Null follows membership.
ALTER TABLE "StudentRank" ADD COLUMN "boardActiveOverride" BOOLEAN;

-- Coaches see which students belong to their branches (Decision 168, approved
-- by Gus for the Grading Board): an active INSTRUCTOR or BRANCH_STAFF grant at
-- a branch lets its holder READ the StudentHomeBranch rows of that branch, and
-- nothing else. Read-only (FOR SELECT): assigning home branches stays with the
-- owner. The subquery reads RoleGrant under RoleGrant's own RLS
-- (rolegrant_self_only: the caller's own grants, impersonation-scoped since
-- 20261002000000), so it can only ever match the caller's own grants. Each
-- student's grading data is still read under that student's own context.
CREATE POLICY "student_home_branch_staff_read" ON "StudentHomeBranch"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."userId" = current_setting('app.current_user_id', true)
        AND rg."schoolId" = "StudentHomeBranch"."schoolId"
        AND rg."branchId" = "StudentHomeBranch"."branchId"
        AND rg."role" IN ('INSTRUCTOR', 'BRANCH_STAFF')
        AND rg."revokedAt" IS NULL
    )
  );

-- A School with no branches: the School is the branch (Decisions 168, 169,
-- approved by Gus for the Grading Board). Its INSTRUCTOR/BRANCH_STAFF can READ
-- the School's STUDENT role grants — who is enrolled — and nothing more.
-- RoleGrant policies can't query RoleGrant without recursing, so the staff
-- check is a SECURITY DEFINER helper, built and scoped exactly like
-- is_active_school_owner_manager (20261002000000): the caller's own active
-- grant, narrowed to the impersonated School during impersonation. It also
-- requires the School to have no Branch at all; once branches exist, coaches
-- see their branches' students through student_home_branch_staff_read instead.
-- The helper role reads RoleGrant already; it needs Branch too (read-only).
GRANT SELECT ON "Branch" TO ultm8_rls_helper;

CREATE FUNCTION "is_staff_of_school_without_branches"(p_school_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."RoleGrant"
    WHERE "userId" = current_setting('app.current_user_id', true)
      AND "schoolId" = p_school_id
      AND "role" IN ('INSTRUCTOR', 'BRANCH_STAFF')
      AND "revokedAt" IS NULL
  )
  AND NOT EXISTS (SELECT 1 FROM public."Branch" WHERE "schoolId" = p_school_id)
  AND (
    current_setting('app.impersonation_school_id', true) IS NULL
    OR current_setting('app.impersonation_school_id', true) = ''
    OR current_setting('app.impersonation_school_id', true) = p_school_id
  );
$$;
ALTER FUNCTION "is_staff_of_school_without_branches"(text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "is_staff_of_school_without_branches"(text) TO ultm8_app;

CREATE POLICY "rolegrant_branchless_staff_student_read" ON "RoleGrant"
  FOR SELECT
  USING (
    "RoleGrant"."role" = 'STUDENT'
    AND "RoleGrant"."schoolId" IS NOT NULL
    AND is_staff_of_school_without_branches("RoleGrant"."schoolId")
  );
