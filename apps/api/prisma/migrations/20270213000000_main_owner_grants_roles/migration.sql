-- Decision 423 item 10: only the School's main owner adds or removes people
-- (co-owners, Branch Staff and coaches). Co-owners and Branch Staff no longer
-- invite anyone, and the Branch Staff switch "Can invite coaches" goes.
--
-- The API checks the main owner itself (TenantAuthorizationService.
-- assertSchoolMainOwner), the same way it already narrows what an owner may
-- grant (Decision 80): RLS stays the tenant boundary. This migration removes
-- the database paths that let Branch Staff with the switch see, send and
-- cancel invites, and the column itself.

-- 1. Invites still open from anyone but the School's main owner (co-owners,
--    and Branch Staff with the old switch) are cancelled, so the owner's list
--    matches what still works. The main owner is the live owner grant flagged
--    isMainOwner, else the earliest live owner grant (mainOwnerGrant).
--    cancelledById stays null: nobody cancelled them by hand.
UPDATE "CoachInvite" ci
SET "cancelledAt" = now()
WHERE ci."acceptedAt" IS NULL
  AND ci."cancelledAt" IS NULL
  AND ci."expiresAt" > now()
  AND ci."invitedById" IS DISTINCT FROM (
    SELECT rg."userId" FROM "RoleGrant" rg
    WHERE rg."schoolId" = ci."schoolId" AND rg."role" = 'SCHOOL_OWNER_MANAGER' AND rg."revokedAt" IS NULL
    ORDER BY rg."isMainOwner" DESC, rg."grantedAt" ASC, rg."id" ASC
    LIMIT 1
  );

-- 2. Branch Staff no longer see or manage invites.
DROP POLICY "coach_invite_staff_manage" ON "CoachInvite";
DROP FUNCTION "can_invite_coaches_at"(text, text);

-- 3. An invite works while its sender is still an owner of the School (as
--    before for owners); the Branch Staff case is gone. Otherwise unchanged
--    from 20270103000000_staff_must_accept.
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
         ci."invitedById" IS NOT NULL AND EXISTS (
           SELECT 1 FROM public."RoleGrant" rg
           WHERE rg."userId" = ci."invitedById" AND rg."schoolId" = ci."schoolId"
             AND rg."role" = 'SCHOOL_OWNER_MANAGER' AND rg."revokedAt" IS NULL
         ),
         ci."expiresAt", ci."acceptedAt", ci."cancelledAt"
  FROM public."CoachInvite" ci
  JOIN public."School" s ON s."id" = ci."schoolId"
  LEFT JOIN public."Branch" b ON b."id" = ci."branchId"
  WHERE p_token_hash IS NOT NULL AND p_token_hash <> '' AND ci."tokenHash" = p_token_hash;
$$;
ALTER FUNCTION "coach_invite_by_token"(text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "coach_invite_by_token"(text) TO ultm8_app;

-- 4. The activity log: Branch Staff no longer write "invite sent/cancelled".
--    Otherwise unchanged from 20270110000000_staff_activity.
ALTER POLICY "staff_activity_actor_insert" ON "StaffActivity"
  WITH CHECK (
    "StaffActivity"."actorId" = current_setting('app.current_user_id', true)
    AND (
      is_active_school_owner_manager("StaffActivity"."schoolId")
      OR (
        "StaffActivity"."action" = 'INVITE_ACCEPTED'
        AND "StaffActivity"."targetUserId" = current_setting('app.current_user_id', true)
      )
    )
  );

-- 5. The switch itself.
ALTER TABLE "StaffPermission" DROP COLUMN "canInviteCoaches";

-- 6. Cancelling an invite reads its School first, unscoped, so anyone but the
--    main owner gets the same 403 as on every other add-or-remove path
--    instead of a 404 (CoachInvitesService.cancel). Two columns only.
GRANT SELECT ("id", "schoolId") ON "CoachInvite" TO ultm8_jobs;
CREATE POLICY "coach_invite_jobs_read" ON "CoachInvite" FOR SELECT TO ultm8_jobs USING (true);
