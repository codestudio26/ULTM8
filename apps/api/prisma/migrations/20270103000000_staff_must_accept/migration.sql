-- Decision 396: "New staff must accept first", off by default.
--
-- School.staffMustAcceptFirst: when on, "Give role" for a coach or Branch
-- Staff sends an invite link (CoachInvite) instead of giving the role at once.
--
-- CoachInvite.role: an invite may now be for BRANCH_STAFF as well as
-- INSTRUCTOR. Existing invites are all coach invites.
ALTER TABLE "School" ADD COLUMN "staffMustAcceptFirst" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CoachInvite" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'INSTRUCTOR';
ALTER TABLE "CoachInvite" ADD CONSTRAINT "CoachInvite_role_check" CHECK ("role" IN ('INSTRUCTOR', 'BRANCH_STAFF'));

-- Branch Staff with "Can invite coaches" see and manage coach invites only;
-- a Branch Staff invite is the owner's.
ALTER POLICY "coach_invite_staff_manage" ON "CoachInvite"
  USING ("CoachInvite"."role" = 'INSTRUCTOR' AND can_invite_coaches_at("CoachInvite"."schoolId", "CoachInvite"."branchId"));

-- coach_invite_by_token() gains "role"; for a Branch Staff invite only an
-- owner inviter counts. Otherwise unchanged from
-- 20261123000001_coach_invite_branch_archived.
DROP FUNCTION "coach_invite_by_token"(text);
CREATE FUNCTION "coach_invite_by_token"(p_token_hash text)
RETURNS TABLE (
  "id" text, "schoolId" text, "schoolName" text, "schoolArchived" boolean, "branchId" text, "branchName" text, "branchArchived" boolean,
  "email" text, "role" text, "invitedById" text, "inviterMayInvite" boolean,
  "expiresAt" timestamp(3), "acceptedAt" timestamp(3), "cancelledAt" timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT ci."id", ci."schoolId", s."name", s."archivedAt" IS NOT NULL, ci."branchId", b."name", b."archivedAt" IS NOT NULL,
         ci."email", ci."role"::text, ci."invitedById",
         ci."invitedById" IS NOT NULL AND (
           EXISTS (
             SELECT 1 FROM public."RoleGrant" rg
             WHERE rg."userId" = ci."invitedById" AND rg."schoolId" = ci."schoolId"
               AND rg."role" = 'SCHOOL_OWNER_MANAGER' AND rg."revokedAt" IS NULL
           )
           OR (
             ci."role" = 'INSTRUCTOR'
             AND EXISTS (
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
