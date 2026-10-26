-- Students page review fixes (Decision 324).
--
-- 1. S13 — a home branch belongs to an enrolment. Revoking a STUDENT grant now
-- deletes the student's StudentHomeBranch row at that School
-- (RoleGrantsService.revoke). Rows left behind by revokes before this change
-- are removed here: they stopped the student from ever enrolling again
-- (StudentHomeBranch is unique per School and student, so re-joining failed
-- with "A record with this value already exists") and counted as a dependent
-- that blocked archiving the branch (Decision 252), with no way for the owner
-- to move or remove them. Deleting needs the DELETE privilege, which the app
-- role never had on this table; RLS (student_home_branch_owner_manage) still
-- limits it to the School's owner — the student's own session has no delete
-- policy.
GRANT DELETE ON "StudentHomeBranch" TO ultm8_app;

-- A Guardian withdrawing baseline consent revokes every grant the child holds,
-- through the jobs role (GuardiansService.withdrawConsent); it now removes the
-- child's home branches with them.
GRANT DELETE ON "StudentHomeBranch" TO ultm8_jobs;
CREATE POLICY "student_home_branch_jobs_delete" ON "StudentHomeBranch" FOR DELETE TO ultm8_jobs USING (true);

DELETE FROM "StudentHomeBranch" h
WHERE NOT EXISTS (
  SELECT 1 FROM "RoleGrant" rg
  WHERE rg."userId" = h."studentId"
    AND rg."schoolId" = h."schoolId"
    AND rg."role" = 'STUDENT'
    AND rg."revokedAt" IS NULL
);

-- 2. S1 — Branch Staff and Instructors see the students they cover. Decision
-- 168 gave the Grading Board a rule for which students a staff member covers,
-- and Decision 177 let coaches read STUDENT grants at a School without
-- branches; at a School with branches nothing did, so a coach's Students list
-- came back empty and editing one of their own branch's students 404'd (the
-- User row's own RLS joins RoleGrant under the caller's RLS). This is the
-- branched half of the same rule: an active INSTRUCTOR or BRANCH_STAFF grant
-- at a branch lets its holder READ the current STUDENT grants of the students
-- whose home branch it is, and nothing more. A staff grant with no branch
-- covers no students at a School with branches, and a student with no home
-- branch yet stays the owner's alone (Decision 148). RoleGrant policies can't
-- query RoleGrant without recursing, so the check is a SECURITY DEFINER helper
-- built and scoped exactly like is_staff_of_school_without_branches: the
-- caller's own active grants, narrowed to the impersonated School during
-- impersonation. The helper role already reads RoleGrant and StudentHomeBranch.
CREATE FUNCTION "is_staff_covering_student"(p_school_id text, p_student_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."StudentHomeBranch" h
    JOIN public."RoleGrant" rg
      ON rg."schoolId" = h."schoolId" AND rg."branchId" = h."branchId"
    WHERE h."schoolId" = p_school_id
      AND h."studentId" = p_student_id
      AND rg."userId" = current_setting('app.current_user_id', true)
      AND rg."role" IN ('INSTRUCTOR', 'BRANCH_STAFF')
      AND rg."revokedAt" IS NULL
  )
  AND (
    current_setting('app.impersonation_school_id', true) IS NULL
    OR current_setting('app.impersonation_school_id', true) = ''
    OR current_setting('app.impersonation_school_id', true) = p_school_id
  );
$$;
ALTER FUNCTION "is_staff_covering_student"(text, text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "is_staff_covering_student"(text, text) TO ultm8_app;

CREATE POLICY "rolegrant_branch_staff_student_read" ON "RoleGrant"
  FOR SELECT
  USING (
    "RoleGrant"."role" = 'STUDENT'
    AND "RoleGrant"."schoolId" IS NOT NULL
    AND "RoleGrant"."revokedAt" IS NULL
    AND is_staff_covering_student("RoleGrant"."schoolId", "RoleGrant"."userId")
  );
