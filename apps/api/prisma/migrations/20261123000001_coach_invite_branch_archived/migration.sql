-- Decision 296: a coach invite to a Branch that has since been archived can't
-- be accepted (it would put a new coach on a Branch waiting to be purged).
-- coach_invite_by_token() gains "branchArchived"; otherwise unchanged from
-- 20261026000000_grading_security_hardening.
DROP FUNCTION "coach_invite_by_token"(text);
CREATE FUNCTION "coach_invite_by_token"(p_token_hash text)
RETURNS TABLE (
  "id" text, "schoolId" text, "schoolName" text, "schoolArchived" boolean, "branchId" text, "branchName" text, "branchArchived" boolean,
  "email" text, "invitedById" text, "inviterMayInvite" boolean,
  "expiresAt" timestamp(3), "acceptedAt" timestamp(3), "cancelledAt" timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT ci."id", ci."schoolId", s."name", s."archivedAt" IS NOT NULL, ci."branchId", b."name", b."archivedAt" IS NOT NULL,
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
