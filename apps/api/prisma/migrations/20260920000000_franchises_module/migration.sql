-- Phase 16 — FranchisesModule: self-service Franchise CRUD (Decision 79, extended to
-- Franchise directly with the product owner this phase — "Same as School:
-- self-service") + the Franchise Owner School-roster read
-- (GET /franchises/{id}/schools, ultm8-nestjs-module §5).

-- ============================================================================
-- 1. Franchise — allow INSERT for any caller with an established tenant context,
--    and let a freshly-inserted Franchise satisfy its own RETURNING clause.
-- ============================================================================
--
-- Part A (mirrors 20260903000000's School fix): franchise_tenant_isolation
-- (20260902000000_init) has no explicit WITH CHECK, so Postgres reuses its USING
-- clause for INSERT too — which requires an EXISTING RoleGrant referencing the
-- Franchise row being inserted. That RoleGrant cannot exist before the Franchise
-- itself does, so every Franchise INSERT would be unconditionally rejected without
-- this.
ALTER POLICY "franchise_tenant_isolation" ON "Franchise"
  WITH CHECK (current_setting('app.current_user_id', true) IS NOT NULL);

-- Part B — FOUND ON REVIEW before this ever shipped: the first draft of this widening
-- copied 20260905000000's School fix ONLY (the WITH CHECK + inline "OR NOT EXISTS"
-- USING widening), missing that School's own history didn't stop there.
-- 20260905000000's inline `OR NOT EXISTS (SELECT 1 FROM "RoleGrant" rg WHERE
-- rg."schoolId" = "School"."id")` was itself a real, shipped, then-CI-caught bug —
-- 20260906000000_fix_school_notexists_rls_blindspot fixed it — and three independent
-- review angles (line-by-line, cross-file tracer, altitude) on this same diff
-- independently caught that the first draft reintroduced that exact, already-solved
-- bug for Franchise, verbatim, rather than mirroring the corrected shape.
--
-- THE ROOT CAUSE (restated from 20260906000000, since it applies identically here): a
-- negated existence check against an RLS-protected table, run as ultm8_app (not
-- BYPASSRLS), is itself filtered by that table's own policies — RoleGrant's
-- rolegrant_self_only restricts what the CALLING user's own session can see. So
-- "NOT EXISTS (any RoleGrant referencing this Franchise)" silently degraded to
-- "NOT EXISTS (any RoleGrant referencing this Franchise THAT I CAN ALREADY SEE)" —
-- which is unconditionally true for every OTHER tenant's Franchise (a caller never
-- sees another user's RoleGrant row under rolegrant_self_only, and Franchise has no
-- rolegrant_school_manager_scope-equivalent widening the way School does). The first
-- draft's own comment claiming this disjunct was "true only in the brief bootstrap
-- window" was the same false claim 20260905000000 made about School, before
-- 20260906000000 disproved it — not a narrow race, a standing, always-true-for-
-- everyone-else's-Franchise condition. Left as originally drafted, this would have
-- let ANY authenticated caller read (GET /franchises/{id}) or list (GET /franchises)
-- every Franchise in the system, not just their own.
--
-- THE FIX: the exact same SECURITY DEFINER pattern 20260906000000 already
-- established for School (school_has_any_role_grant) — reusing the SAME
-- ultm8_rls_helper role (already exists, already holds BYPASSRLS + SELECT on
-- RoleGrant from 20260905000000 — no new role or grant needed). The function's
-- internal query is a plain, unqualified read of the whole RoleGrant table via
-- BYPASSRLS, so "no row exists for this Franchise" means exactly that — not "none
-- that this caller can already see".
CREATE FUNCTION "franchise_has_any_role_grant"(p_franchise_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."RoleGrant" WHERE "franchiseId" = p_franchise_id
  );
$$;

ALTER FUNCTION "franchise_has_any_role_grant"(text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "franchise_has_any_role_grant"(text) TO ultm8_app;

ALTER POLICY "franchise_tenant_isolation" ON "Franchise"
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."franchiseId" = "Franchise"."id"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
    )
    OR NOT franchise_has_any_role_grant("Franchise"."id")
  );

-- Note: the first disjunct above is NOT vulnerable to this bug class, and is
-- deliberately left as an inline subquery rather than also wrapped in a function —
-- same reasoning 20260906000000 gives for school_tenant_isolation's identically-shaped
-- first disjunct: it filters to rows where rg.userId equals the CALLER's own
-- current_setting value, and rolegrant_self_only guarantees a caller's own RoleGrant
-- rows are always visible to them regardless of any other policy, so this subquery's
-- restricted view is already exactly the view it needs. The bug class only applies to
-- a check that needs to see rows belonging to someone OTHER than the calling session.

-- ============================================================================
-- 2. schools_for_franchise() — the mechanism behind GET /franchises/{id}/schools.
-- ============================================================================
--
-- A Franchise Owner's own RoleGrant is scoped to franchiseId, never schoolId (only
-- FRANCHISE_OWNER is ever scoped to franchiseId at all — every other Role value
-- scopes to schoolId/branchId) — so their own ultm8_app tenant context genuinely
-- cannot see child School rows via school_tenant_isolation's RLS policy. This is the
-- exact gap school_tenant_isolation's own Phase 1 comment calls out by name:
-- "Deliberately NOT extended to 'Franchise Owner sees every School under their
-- Franchise'... that's confirmed to be a purpose-built, ownership-validated endpoint
-- (GET /franchises/{id}/schools), explicitly NOT an RLS escalation into School-
-- scoped tables."
--
-- FOUND ON REVIEW: the first draft took school_exists()'s "existence is
-- BYPASSRLS-readable; authorization is a separate application-layer check" split
-- literally, trusting FranchisesService alone to check ownership before ever calling
-- this function. The altitude-angle review flagged that split as right-sized for
-- school_exists() (which returns nothing but a boolean — there is no row data to
-- leak) but wrong-sized here: this function returns full School rows via `SELECT *`,
-- granted EXECUTE to the same general-purpose ultm8_app role every module's
-- PrismaAppService already runs under, with no authorization logic of its own — any
-- future caller of this function (a job, another service, a copy-pasted raw query)
-- would get back full cross-tenant School data for whatever franchiseId it's given,
-- protected only by "the one call site we wrote today remembers to check first".
-- AcademiesModule's own genuinely-analogous cross-tenant-read mechanism
-- (PrismaDiscoveryService) doesn't rely on caller discipline alone either — it layers
-- a dedicated role, curated column grants, AND its own RLS predicates.
--
-- Fixed by folding the ownership check INTO the function itself (p_caller_id, checked
-- via the same unfiltered BYPASSRLS read this function already needs for
-- p_franchise_id) rather than trusting the caller alone — the function is now safe to
-- call from anywhere, not just from a call site that happens to gate it correctly
-- first. FranchisesService.findSchoolsForFranchise() still calls findOne() before this
-- (for the 404-vs-empty-result distinction a real "Franchise doesn't exist" case
-- needs), but no longer needs a separate assertFranchiseOwner() call — this function's
-- own WHERE clause is the authorization enforcement now, at the layer closest to the
-- data, the same guarantee an RLS policy would give if Franchise Owner visibility into
-- child Schools were ever promoted to a real RLS policy instead of a purpose-built
-- endpoint.
--
-- LIMIT 1000 — a hard safety cap, not real pagination. FranchisesService.
-- findSchoolsForFranchise()'s own comment documents why this phase doesn't build full
-- cursor pagination for this endpoint (a bounded administrative roster view) and flags
-- the "small number of member Schools" assumption for Architect review if it ever
-- turns out false; this cap is the concrete backstop for that flagged assumption, not
-- a substitute for actually building pagination if the assumption breaks.
--
-- No new grant needed beyond EXECUTE — ultm8_rls_helper already holds
-- `GRANT SELECT ON "School"` from 20260919000000 (school_exists's own first-use grant
-- for that table) and `GRANT SELECT ON "RoleGrant"` from 20260905000000; this function
-- is a new consumer of both existing grants, not a new grant.
CREATE FUNCTION "schools_for_franchise"(p_franchise_id text, p_caller_id text)
RETURNS SETOF "School"
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT s.* FROM public."School" s
  WHERE s."franchiseId" = p_franchise_id
    AND EXISTS (
      SELECT 1 FROM public."RoleGrant" rg
      WHERE rg."franchiseId" = p_franchise_id
        AND rg."userId" = p_caller_id
        AND rg."role" = 'FRANCHISE_OWNER'
        AND rg."revokedAt" IS NULL
    )
  LIMIT 1000;
$$;

ALTER FUNCTION "schools_for_franchise"(text, text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "schools_for_franchise"(text, text) TO ultm8_app;
