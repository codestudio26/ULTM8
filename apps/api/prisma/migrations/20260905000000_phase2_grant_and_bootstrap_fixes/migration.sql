-- ULTM8 Phase 2 fix-forward #2 — two independent bugs CI caught once the 42P17
-- recursion fix (20260904000000) stopped masking everything else. Same provenance
-- caveat as every migration before this one: hand-authored, no reachable Postgres in
-- this environment to run it against. Additive-only (Decision 32) — none of
-- 20260902000000_init / 20260903000000_tenants_module_rls / 20260904000000_fix_
-- rolegrant_rls_recursion are edited; this ALTERs two existing objects in place.
--
-- These are genuinely unrelated root causes (different tables, different failure
-- modes) bundled into one migration file only because both are small and both are
-- needed for Phase 2's endpoints to actually work end to end — each is documented
-- separately below; don't read them as one bug.

-- ============================================================================
-- BUG 1 — "permission denied for table RoleGrant" on tx.roleGrant.create()
--         (role-grants.service.ts, RoleGrantsService.create())
-- ============================================================================
--
-- Investigated, not guessed: re-read 20260902000000_init's GRANT statement directly
-- rather than trusting memory. ultm8_app's own grant on RoleGrant is already complete —
--   GRANT SELECT, INSERT, UPDATE, DELETE ON "User", "AdminUser", "Franchise", "School",
--     "Branch", "RoleGrant" TO ultm8_app;
-- — all four verbs, granted since Phase 1. The suspicion that ultm8_app itself never
-- had INSERT on RoleGrant does not hold up against the actual migration text.
--
-- The real gap: 20260904000000 introduced ultm8_rls_helper (NOLOGIN, BYPASSRLS) to own
-- is_active_school_owner_manager(), specifically so that function's internal query
-- would skip RLS on RoleGrant deterministically. But BYPASSRLS only bypasses Row-Level
-- SECURITY POLICY evaluation — it is a completely separate, orthogonal permission
-- system from ordinary GRANT-based table privileges (SELECT/INSERT/UPDATE/DELETE).
-- ultm8_rls_helper was created with no table grant AT ALL, so the function's own
-- `SELECT 1 FROM public."RoleGrant" WHERE ...` failed outright with "permission denied
-- for table RoleGrant" — a genuine missing base privilege on the NEW role this fix
-- introduced, not anything to do with ultm8_app. This is exactly why the error was a
-- privilege error (42501, "permission denied") rather than an RLS violation message
-- ("new row violates row-level security policy") — those are the two distinct failure
-- modes the task description asked to keep separate, and the error text itself already
-- told us which one this was.

GRANT USAGE ON SCHEMA public TO ultm8_rls_helper;
GRANT SELECT ON "RoleGrant" TO ultm8_rls_helper;

-- ============================================================================
-- BUG 2 — "new row violates row-level security policy for table School" on
--         tx.school.create() (schools.service.ts, SchoolsService.create())
-- ============================================================================
--
-- Investigated the three specific things asked, in order, before landing on the actual
-- cause — none of the three turned out to be it, but ruling each out with evidence
-- (not assumption) is what actually found the real bug:
--
-- 1. "Did the 20260903000000 ALTER actually take effect?" Could not literally query
--    pg_policies (no reachable Postgres here) — but re-read 20260903000000's text
--    directly: `ALTER POLICY "school_tenant_isolation" ON "School" WITH CHECK
--    (current_setting('app.current_user_id', true) IS NOT NULL);` is syntactically
--    correct ALTER POLICY usage (per Postgres's own docs, omitting USING leaves it
--    unchanged; WITH CHECK is set independently). CI reaching this specific test
--    failure at all — rather than a "migrate deploy" step failure — confirms every
--    migration statement including this one applied without a SQL error. So the WITH
--    CHECK half of the fix is real and did take effect; that is not where the bug is.
--
-- 2. "Is there a second, restrictive policy on School?" Re-read 20260902000000_init and
--    20260903000000_tenants_module_rls in full: School has exactly one policy,
--    school_tenant_isolation (PERMISSIVE by default — no RESTRICTIVE keyword anywhere
--    in either file). Ruled out.
--
-- 3. "Does app.current_user_id actually get set before this INSERT?" SchoolsService.
--    create() wraps everything in prismaApp.withTenantContext(callerId, ...), whose
--    implementation runs `SET LOCAL app.current_user_id` and only then invokes the
--    callback on the SAME `tx` — and Prisma's interactive-transaction API ($transaction
--    (async (tx) => ...)) guarantees every tx.* call in that callback runs on the same
--    underlying connection/transaction, which is the documented, supported way to make
--    SET LOCAL visible to later statements. No evidence this is broken. Ruled out.
--
-- THE ACTUAL CAUSE: Prisma's `.create()` always issues `INSERT ... RETURNING *` — it
-- needs the full row back (including server-generated defaults like createdAt) to
-- construct the JS object it returns. Postgres RLS has a specific, documented rule for
-- this exact combination: when an INSERT has a RETURNING clause, the newly-inserted row
-- must ALSO satisfy the table's SELECT-context USING policies for RETURNING to be
-- allowed to hand it back — not just WITH CHECK. If it doesn't, Postgres raises the
-- SAME "new row violates row-level security policy" error WITH CHECK failures use, even
-- though WITH CHECK itself passed.
--
-- 20260903000000 only widened WITH CHECK (permitting the write). It left USING
-- untouched — still the original EXISTS-subquery requiring an ACTIVE RoleGrant that
-- already references this School's id. For a brand-new School, that RoleGrant does not
-- exist yet: SchoolsService.create() inserts the School first and only creates the
-- caller's own SCHOOL_OWNER_MANAGER RoleGrant in the NEXT statement, in the same
-- transaction. So the write was permitted, but Postgres couldn't hand the freshly
-- inserted row back to satisfy RETURNING, and failed the whole statement.
--
-- (This is also why Branch and the RoleGrant self-grant/invite-grant paths do NOT hit
-- this: a new Branch's RETURNING-check passes off the caller's PRE-EXISTING
-- SCHOOL_OWNER_MANAGER grant on the parent School, which already exists; the RoleGrant
-- self-grant's own row has userId = the caller, satisfying rolegrant_self_only directly
-- off the row's own column, the same way User's self-registration bootstrap already
-- works; and the RoleGrant invite-grant path's visibility depends only on the caller's
-- own PRE-EXISTING SCHOOL_OWNER_MANAGER grant, not on the new row itself. School's
-- create path is the only one whose authorization is defined entirely in terms of a
-- row that doesn't exist yet at INSERT time.)
--
-- FIX: widen USING with a second, narrowly-scoped disjunct — "no RoleGrant references
-- this School AT ALL yet" — true only in the brief bootstrap window between a School's
-- own INSERT and its owner RoleGrant's INSERT, in the SAME transaction. It closes back
-- to FALSE the instant that RoleGrant is created (this checks for ANY RoleGrant row
-- referencing the School, active or revoked, not just active ones), and since both
-- inserts happen in one atomic transaction, a School with zero RoleGrants ever should
-- never exist in committed data — SchoolsService.create() either creates both rows or
-- neither. (Flagged, not silently ignored: this reasoning assumes RoleGrant rows are
-- only ever soft-revoked, never hard-deleted, matching this codebase's stated
-- convention everywhere else — a future hard-delete path for RoleGrant would need to
-- revisit this.) The parallel to School querying RoleGrant already existed safely in
-- the original 20260902000000 policy (that's not the self-referential pattern that
-- caused the 42P17 recursion bug — that was RoleGrant's own policy querying RoleGrant;
-- this is a different table's policy querying RoleGrant once, same as it always has).

ALTER POLICY "school_tenant_isolation" ON "School"
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."schoolId" = "School"."id"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
    )
    OR NOT EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."schoolId" = "School"."id"
    )
  );
