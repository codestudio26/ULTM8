-- Decision 383: the School owner's "Can manage disciplines" switch for Branch
-- Staff, off by default. With it on, they edit the School's styles, belts and
-- skills, and delete styles nobody uses, as the owner can.
--
-- Styles are shared by the whole School, but a Branch Staff member's own row
-- security shows only their branch's classes and slots and none of the
-- students' ranks, so the "still in use" checks and the name carried onto
-- classes would miss the rest of the School. Their Disciplines writes
-- therefore run in the context of the School's main owner (Decision 370),
-- which the API asks this function for. It answers only for the caller
-- themselves: their own id when they own the School, the main owner's id when
-- they are live Branch Staff there with the switch on, and NULL otherwise.
-- SECURITY DEFINER because Branch Staff can't see the owner's RoleGrant (same
-- pattern as can_invite_coaches_at). A Platform Admin impersonating someone
-- is held to the impersonated School.
ALTER TABLE "StaffPermission" ADD COLUMN "canManageDisciplines" BOOLEAN NOT NULL DEFAULT false;

CREATE FUNCTION "discipline_manager_context"(p_school_id text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN NOT (
      current_setting('app.impersonation_school_id', true) IS NULL
      OR current_setting('app.impersonation_school_id', true) = ''
      OR current_setting('app.impersonation_school_id', true) = p_school_id
    ) THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM public."RoleGrant" rg
      WHERE rg."userId" = current_setting('app.current_user_id', true)
        AND rg."schoolId" = p_school_id
        AND rg."role" = 'SCHOOL_OWNER_MANAGER'
        AND rg."revokedAt" IS NULL
    ) THEN current_setting('app.current_user_id', true)
    WHEN EXISTS (
      SELECT 1 FROM public."StaffPermission" sp
      WHERE sp."userId" = current_setting('app.current_user_id', true)
        AND sp."schoolId" = p_school_id
        AND sp."canManageDisciplines"
    ) AND EXISTS (
      SELECT 1 FROM public."RoleGrant" rg
      WHERE rg."userId" = current_setting('app.current_user_id', true)
        AND rg."schoolId" = p_school_id
        AND rg."role" = 'BRANCH_STAFF'
        AND rg."revokedAt" IS NULL
    ) THEN (
      SELECT rg."userId" FROM public."RoleGrant" rg
      WHERE rg."schoolId" = p_school_id
        AND rg."role" = 'SCHOOL_OWNER_MANAGER'
        AND rg."revokedAt" IS NULL
      ORDER BY rg."isMainOwner" DESC, rg."grantedAt" ASC, rg."id" ASC
      LIMIT 1
    )
    ELSE NULL
  END;
$$;
ALTER FUNCTION "discipline_manager_context"(text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "discipline_manager_context"(text) TO ultm8_app;
