-- ULTM8 Phase 2 — TenantsModule RLS additions.
--
-- Same provenance caveat as Phase 1's initial migration: hand-authored, not generated
-- by `prisma migrate dev` (no reachable Postgres in this environment) — verify with a
-- real `prisma migrate diff`/`migrate dev` run before this is trusted past a walking
-- skeleton, same as the 20260902000000_init migration this follows. Additive-only, per
-- the expand/contract convention (Decision 32, ultm8-nestjs-module §4) — no existing
-- policy is dropped, only ALTERed (WITH CHECK only) or added alongside.
--
-- Two gaps closed here, both required for Phase 2's School/Branch CRUD + RoleGrant
-- assignment endpoints to function at all against Phase 1's RLS policies:
--
-- 1. School had no way to ever be INSERTed. school_tenant_isolation (Phase 1) has no
--    explicit WITH CHECK, so Postgres reuses its USING clause for INSERT too — which
--    requires an EXISTING RoleGrant referencing the School row being inserted. That
--    RoleGrant cannot exist before the School itself does, so every School INSERT was
--    unconditionally rejected. Resolved per the product owner's explicit Phase 2
--    direction (self-service School creation — see the Phase 2 summary): any caller
--    with an established tenant context may create a School; SchoolsService then
--    creates their SCHOOL_OWNER_MANAGER RoleGrant in the same transaction, mirroring
--    User's own self-registration bootstrap pattern (user_self_or_shared_school,
--    Phase 1).
--
-- 2. RoleGrant's only Phase 1 policy (rolegrant_self_only) was deliberately scoped to
--    "a caller sees/writes only their own grants" — correct for a phase with no
--    RoleGrant-issuing endpoint, explicitly flagged there as needing deliberate
--    widening once TenantsModule ships. RoleGrantsService needs a School Owner/Manager
--    to see and write OTHER users' grants scoped to their own School (to invite an
--    Instructor/Branch Staff member and later revoke them) — added below as a second,
--    additive PERMISSIVE policy (Postgres OR-combines multiple permissive policies for
--    the same command), not a replacement of rolegrant_self_only.
--
-- Both additions are deliberately scoped to tenant-boundary enforcement only (which
-- School's RoleGrant rows a caller may touch at all) — the finer business rule of
-- WHICH roles a School Owner/Manager may actually grant (INSTRUCTOR/BRANCH_STAFF only,
-- never SCHOOL_OWNER_MANAGER/FRANCHISE_OWNER/STUDENT/GUARDIAN) is enforced in
-- RoleGrantsService, not here — see TenantAuthorizationService's header comment for why
-- that split mirrors School/Branch's own existing RLS design.

-- ============================================================================
-- 1. School — allow INSERT for any caller with an established tenant context.
--    SELECT/UPDATE/DELETE remain governed by the unchanged USING clause (an existing
--    RoleGrant on that School) — this ALTER touches WITH CHECK only.
-- ============================================================================

ALTER POLICY "school_tenant_isolation" ON "School"
  WITH CHECK (current_setting('app.current_user_id', true) IS NOT NULL);

-- ============================================================================
-- 2. RoleGrant — additional PERMISSIVE policy: a School Owner/Manager may see and
--    write any RoleGrant scoped to a School they hold an active SCHOOL_OWNER_MANAGER
--    grant on. Safe against recursion: the inner EXISTS subquery's own visibility into
--    RoleGrant is satisfied by the existing rolegrant_self_only policy (the caller's
--    own SCHOOL_OWNER_MANAGER row has userId = current_setting(...)), which does not
--    itself recurse into this policy.
-- ============================================================================

CREATE POLICY "rolegrant_school_manager_scope" ON "RoleGrant"
  USING (
    "schoolId" IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "RoleGrant" mgr
      WHERE mgr."userId" = current_setting('app.current_user_id', true)
        AND mgr."role" = 'SCHOOL_OWNER_MANAGER'
        AND mgr."schoolId" = "RoleGrant"."schoolId"
        AND mgr."revokedAt" IS NULL
    )
  )
  WITH CHECK (
    "schoolId" IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "RoleGrant" mgr
      WHERE mgr."userId" = current_setting('app.current_user_id', true)
        AND mgr."role" = 'SCHOOL_OWNER_MANAGER'
        AND mgr."schoolId" = "RoleGrant"."schoolId"
        AND mgr."revokedAt" IS NULL
    )
  );
