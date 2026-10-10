-- Coach invites and "Can invite coaches" (Decision 183).
--
-- StaffPermission: per Branch Staff member per School; "Can invite coaches"
-- lets them send coach invites for their own branches. Set by the owner.
--
-- CoachInvite: one person, by email, to coach at a School (and a branch). The
-- link carries a random token; only its SHA-256 is stored. Single use, 7 days,
-- cancellable. Accepting it gives the invitee an INSTRUCTOR RoleGrant, written
-- under their own context (rolegrant_self_only), as SchoolsService.join()
-- already does for STUDENT.
--
-- Who sees and writes invites:
--   * the School Owner/Manager — every invite of their School;
--   * Branch Staff with "Can invite coaches" — invites for their own branches
--     (can_invite_coaches_at below);
--   * the token holder — only the one row whose hash matches
--     app.coach_invite_token_hash, set by the API in the accept transaction.
-- The invite page reads the School/branch name through coach_invite_by_token(),
-- since the invitee has no grant at the School yet.

CREATE TABLE "StaffPermission" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canInviteCoaches" BOOLEAN NOT NULL DEFAULT false,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffPermission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StaffPermission_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StaffPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StaffPermission_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StaffPermission_schoolId_userId_key" ON "StaffPermission"("schoolId", "userId");
CREATE INDEX "StaffPermission_userId_idx" ON "StaffPermission"("userId");

CREATE TABLE "CoachInvite" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoachInvite_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CoachInvite_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CoachInvite_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CoachInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CoachInvite_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CoachInvite_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    -- Accepted and cancelled are final and exclusive.
    CONSTRAINT "CoachInvite_one_outcome" CHECK ("acceptedAt" IS NULL OR "cancelledAt" IS NULL)
);
CREATE UNIQUE INDEX "CoachInvite_tokenHash_key" ON "CoachInvite"("tokenHash");
CREATE INDEX "CoachInvite_schoolId_email_idx" ON "CoachInvite"("schoolId", "email");
CREATE INDEX "CoachInvite_branchId_idx" ON "CoachInvite"("branchId");

-- No DELETE for the app: invites are cancelled, never removed.
GRANT SELECT, INSERT, UPDATE ON "StaffPermission" TO ultm8_app;
GRANT SELECT, INSERT, UPDATE ON "CoachInvite" TO ultm8_app;
GRANT SELECT ON "StaffPermission" TO ultm8_rls_helper;
GRANT SELECT ON "CoachInvite" TO ultm8_rls_helper;

ALTER TABLE "StaffPermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffPermission" FORCE ROW LEVEL SECURITY;
CREATE POLICY "staff_permission_owner_manage" ON "StaffPermission"
  USING (is_active_school_owner_manager("StaffPermission"."schoolId"));
CREATE POLICY "staff_permission_self_read" ON "StaffPermission"
  FOR SELECT
  USING ("StaffPermission"."userId" = current_setting('app.current_user_id', true));

-- True when the caller is active Branch Staff at this School with "Can invite
-- coaches", at this branch (or, for a School without branches, at the School).
-- SECURITY DEFINER so CoachInvite's policy can read StaffPermission/RoleGrant
-- without their own RLS (same pattern as is_active_school_owner_manager).
CREATE FUNCTION "can_invite_coaches_at"(p_school_id text, p_branch_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."StaffPermission" sp
    WHERE sp."userId" = current_setting('app.current_user_id', true)
      AND sp."schoolId" = p_school_id
      AND sp."canInviteCoaches"
  )
  AND EXISTS (
    SELECT 1 FROM public."RoleGrant" rg
    WHERE rg."userId" = current_setting('app.current_user_id', true)
      AND rg."schoolId" = p_school_id
      AND rg."role" = 'BRANCH_STAFF'
      AND rg."revokedAt" IS NULL
      AND rg."branchId" IS NOT DISTINCT FROM p_branch_id
  )
  AND (
    current_setting('app.impersonation_school_id', true) IS NULL
    OR current_setting('app.impersonation_school_id', true) = ''
    OR current_setting('app.impersonation_school_id', true) = p_school_id
  );
$$;
ALTER FUNCTION "can_invite_coaches_at"(text, text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "can_invite_coaches_at"(text, text) TO ultm8_app;

ALTER TABLE "CoachInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CoachInvite" FORCE ROW LEVEL SECURITY;
CREATE POLICY "coach_invite_owner_manage" ON "CoachInvite"
  USING (is_active_school_owner_manager("CoachInvite"."schoolId"));
CREATE POLICY "coach_invite_staff_manage" ON "CoachInvite"
  USING (can_invite_coaches_at("CoachInvite"."schoolId", "CoachInvite"."branchId"));
-- The invitee, holding the link: read and accept that one invite.
CREATE POLICY "coach_invite_token_holder" ON "CoachInvite"
  FOR SELECT
  USING (
    coalesce(current_setting('app.coach_invite_token_hash', true), '') <> ''
    AND "CoachInvite"."tokenHash" = current_setting('app.coach_invite_token_hash', true)
  );
CREATE POLICY "coach_invite_token_holder_accept" ON "CoachInvite"
  FOR UPDATE
  USING (
    coalesce(current_setting('app.coach_invite_token_hash', true), '') <> ''
    AND "CoachInvite"."tokenHash" = current_setting('app.coach_invite_token_hash', true)
  )
  WITH CHECK ("CoachInvite"."acceptedById" = current_setting('app.current_user_id', true));

-- The invite page, before the invitee belongs to the School: the invite's
-- state plus the School and branch names, for the holder of the token only.
CREATE FUNCTION "coach_invite_by_token"(p_token_hash text)
RETURNS TABLE (
  "id" text, "schoolId" text, "schoolName" text, "branchId" text, "branchName" text,
  "email" text, "invitedById" text, "expiresAt" timestamp(3), "acceptedAt" timestamp(3), "cancelledAt" timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT ci."id", ci."schoolId", s."name", ci."branchId", b."name",
         ci."email", ci."invitedById", ci."expiresAt", ci."acceptedAt", ci."cancelledAt"
  FROM public."CoachInvite" ci
  JOIN public."School" s ON s."id" = ci."schoolId"
  LEFT JOIN public."Branch" b ON b."id" = ci."branchId"
  WHERE p_token_hash IS NOT NULL AND p_token_hash <> '' AND ci."tokenHash" = p_token_hash;
$$;
ALTER FUNCTION "coach_invite_by_token"(text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "coach_invite_by_token"(text) TO ultm8_app;
