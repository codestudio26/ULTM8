-- Grading/coaching security hardening (Phase 7 security review).

-- 1. Coaches at a School without branches read its enrolled students' STUDENT
-- grants (Decision 177) — current students only, not former ones.
ALTER POLICY "rolegrant_branchless_staff_student_read" ON "RoleGrant"
  USING (
    "RoleGrant"."role" = 'STUDENT'
    AND "RoleGrant"."schoolId" IS NOT NULL
    AND "RoleGrant"."revokedAt" IS NULL
    AND is_staff_of_school_without_branches("RoleGrant"."schoolId")
  );

-- 2. A student's home branch is assigned by the owner (Decision 148). The
-- student's own session may read it and create it once, when joining, but not
-- change it. Was one policy for every command, so the student could also
-- update or delete their row.
DROP POLICY "student_home_branch_owner_or_self" ON "StudentHomeBranch";
CREATE POLICY "student_home_branch_owner_manage" ON "StudentHomeBranch"
  USING (is_active_school_owner_manager("StudentHomeBranch"."schoolId"));
CREATE POLICY "student_home_branch_self_read" ON "StudentHomeBranch"
  FOR SELECT
  USING ("StudentHomeBranch"."studentId" = current_setting('app.current_user_id', true));
CREATE POLICY "student_home_branch_self_join" ON "StudentHomeBranch"
  FOR INSERT
  WITH CHECK ("StudentHomeBranch"."studentId" = current_setting('app.current_user_id', true));

-- 3. Coach invites: only their outcome changes after they're sent (accepted
-- or cancelled); the email, School, branch and token hash never do.
REVOKE UPDATE ON "CoachInvite" FROM ultm8_app;
GRANT UPDATE ("acceptedAt", "acceptedById", "cancelledAt", "cancelledById") ON "CoachInvite" TO ultm8_app;

-- 4. Accepting an invite re-checks it is still good (Decision 183): the
-- School isn't closed, and whoever sent it may still invite to that branch —
-- the School's owner, or Branch Staff there with "Can invite coaches". The
-- invitee has no grant at the School yet, so this is read here, for the
-- holder of the token only. Return type changes, so drop and re-create.
DROP FUNCTION "coach_invite_by_token"(text);
CREATE FUNCTION "coach_invite_by_token"(p_token_hash text)
RETURNS TABLE (
  "id" text, "schoolId" text, "schoolName" text, "schoolArchived" boolean, "branchId" text, "branchName" text,
  "email" text, "invitedById" text, "inviterMayInvite" boolean,
  "expiresAt" timestamp(3), "acceptedAt" timestamp(3), "cancelledAt" timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT ci."id", ci."schoolId", s."name", s."archivedAt" IS NOT NULL, ci."branchId", b."name",
         ci."email", ci."invitedById",
         ci."invitedById" IS NOT NULL AND (
           EXISTS (
             SELECT 1 FROM public."RoleGrant" rg
             WHERE rg."userId" = ci."invitedById" AND rg."schoolId" = ci."schoolId"
               AND rg."role" = 'SCHOOL_OWNER_MANAGER' AND rg."revokedAt" IS NULL
           )
           OR (
             EXISTS (
               SELECT 1 FROM public."StaffPermission" sp
               WHERE sp."userId" = ci."invitedById" AND sp."schoolId" = ci."schoolId" AND sp."canInviteCoaches"
             )
             AND EXISTS (
               SELECT 1 FROM public."RoleGrant" rg
               WHERE rg."userId" = ci."invitedById" AND rg."schoolId" = ci."schoolId"
                 AND rg."role" = 'BRANCH_STAFF' AND rg."revokedAt" IS NULL
                 AND rg."branchId" IS NOT DISTINCT FROM ci."branchId"
             )
           )
         ),
         ci."expiresAt", ci."acceptedAt", ci."cancelledAt"
  FROM public."CoachInvite" ci
  JOIN public."School" s ON s."id" = ci."schoolId"
  LEFT JOIN public."Branch" b ON b."id" = ci."branchId"
  WHERE p_token_hash IS NOT NULL AND p_token_hash <> '' AND ci."tokenHash" = p_token_hash;
$$;
ALTER FUNCTION "coach_invite_by_token"(text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "coach_invite_by_token"(text) TO ultm8_app;
