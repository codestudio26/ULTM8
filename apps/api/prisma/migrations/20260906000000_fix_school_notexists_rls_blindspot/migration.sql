-- ULTM8 Phase 2 fix-forward #3 — closes a real cross-tenant read/write hole
-- 20260905000000 introduced. Additive-only (Decision 32); 20260902000000/
-- 20260903000000/20260904000000/20260905000000 are all untouched.
--
-- ROOT CAUSE (confirmed against CI, not re-diagnosed here): 20260905000000's fix for
-- Bug 2 added `OR NOT EXISTS (SELECT 1 FROM "RoleGrant" rg WHERE rg."schoolId" =
-- "School"."id")` to school_tenant_isolation's USING clause, intending "this School has
-- no RoleGrant at all yet (mid-creation bootstrap window)". The subquery is itself an
-- ordinary query against RoleGrant, executed as ultm8_app (not BYPASSRLS) — so it is
-- ITSELF filtered by RoleGrant's own policies (rolegrant_self_only /
-- rolegrant_school_manager_scope), which restrict it to rows the CALLING user is
-- already allowed to see. "NOT EXISTS (any row)" silently became "NOT EXISTS (any row
-- I'm already allowed to see)" — a fundamentally weaker condition: from Tenant A's own
-- session, Tenant B's real, active RoleGrant row is invisible (A holds no grant at
-- School B and isn't a School Owner/Manager there), so the subquery found nothing and
-- the disjunct read as "true" — treating School B as if it had never been granted to
-- anyone, when it plainly had been. This let Tenant A both read and write School B, and
-- made a zero-context caller (current_setting returns NULL, so rolegrant_self_only
-- matches nothing for ANYONE) see every School regardless of owner, for the identical
-- reason.
--
-- This is the exact same bug CLASS 20260904000000 already fixed once for RoleGrant's
-- own self-referential check (rolegrant_school_manager_scope) — a check for "does X
-- exist" that itself queries an RLS-protected table needs to read that table
-- unfiltered by the calling session's own restricted view, or the check silently
-- inverts. 20260904000000 fixed it for a positive EXISTS inside RoleGrant's own policy;
-- 20260905000000 then reintroduced the identical class of bug as a NEGATED existence
-- check inside a DIFFERENT table's (School's) policy — same root cause, not yet
-- recognized as the same pattern at the time.
--
-- AUDITED FOR OTHER INSTANCES (grepped every EXISTS/CREATE POLICY/ALTER POLICY/CREATE
-- FUNCTION across all five migration files, not just this one) — the ONLY inline
-- NOT-EXISTS-into-an-RLS-protected-table anywhere in this schema was the one just
-- described; there is no second copy to patch.
--
-- A DIFFERENT, PRE-EXISTING, LOWER-SEVERITY ISSUE WAS ALSO FOUND WHILE AUDITING, NOT
-- FIXED HERE — flagged separately, not silently folded into this migration: User's own
-- Phase 1 policy (user_self_or_shared_school, 20260902000000) has a positive (not
-- negated) EXISTS that joins RoleGrant twice — "mine" (the caller's own rows, always
-- correctly visible via rolegrant_self_only) and "theirs" (the TARGET user's rows,
-- generally NOT visible to the caller under either RoleGrant policy unless the caller
-- happens to also be a SCHOOL_OWNER_MANAGER at that School). Because "theirs" is
-- filtered by the caller's restricted view rather than an unfiltered read, this fails
-- CLOSED, not open — two ordinary same-School Instructors currently can't see each
-- other's User profile through this clause at all, a functional gap, not a
-- cross-tenant exposure. Pre-existing since Phase 1's very first migration,
-- independent of anything touched since — reported back for a decision on whether to
-- fix it, not fixed unasked.
--
-- THE FIX: same SECURITY DEFINER pattern as is_active_school_owner_manager
-- (20260904000000), reusing the SAME ultm8_rls_helper role (already exists, already has
-- BYPASSRLS + SELECT on RoleGrant from 20260905000000 — no new role needed). The new
-- function's internal query is a plain, unqualified read of the whole RoleGrant table
-- via BYPASSRLS, so "no row exists for this School" means exactly that — not "none that
-- this caller can already see".

CREATE FUNCTION "school_has_any_role_grant"(p_school_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."RoleGrant" WHERE "schoolId" = p_school_id
  );
$$;

ALTER FUNCTION "school_has_any_role_grant"(text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "school_has_any_role_grant"(text) TO ultm8_app;

ALTER POLICY "school_tenant_isolation" ON "School"
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."schoolId" = "School"."id"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
    )
    OR NOT school_has_any_role_grant("School"."id")
  );

-- Note: the first disjunct above (EXISTS ... rg."userId" = current_setting(...)) is NOT
-- vulnerable to this same bug, and is deliberately left as an inline subquery rather
-- than also being wrapped in a function: it filters to rows where rg.userId equals the
-- CALLER's own current_setting value, and rolegrant_self_only guarantees a caller's own
-- RoleGrant rows are always visible to them regardless of any other policy — so this
-- particular subquery's restricted view is already exactly the view it needs. The bug
-- class only applies to a check that needs to see rows belonging to someone OTHER than
-- the calling session (a negated whole-table check, or — per the flagged-not-fixed
-- finding above — a positive check against another party's rows).
