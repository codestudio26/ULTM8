-- Phase 17 fix-forward — found while interactively verifying the Instructor roster
-- endpoint (GET /classes/{id}/roster) against a real Postgres instance for the first
-- time this project has had one available. Additive fix-forward per the expand/
-- contract convention (Decision 32) already established by
-- 20260904000000_fix_rolegrant_rls_recursion — the prior migration is not edited.
--
-- ROOT CAUSE: "user_self_or_shared_school" (20260902000000_init) checks whether the
-- caller and the target User share an active School-scoped RoleGrant by querying
-- "RoleGrant" TWICE inline — once for "mine" (the caller's own grant), once for
-- "theirs" (the target User's grant). "RoleGrant" has its own RLS
-- (rolegrant_self_only OR rolegrant_school_manager_scope), which means the "theirs"
-- half of that subquery is itself subject to RLS: an ordinary caller (Instructor,
-- Branch Staff — anyone who isn't a SCHOOL_OWNER_MANAGER at that School) can only
-- ever see their OWN RoleGrant row, never another person's, even inside this
-- policy's own subquery. So for every caller EXCEPT a School Owner/Manager, the
-- "theirs" lookup silently returns nothing and the whole policy collapses to just
-- "id = self" — "shared School" visibility has never actually worked for an
-- Instructor or Branch Staff caller, confirmed directly: an Instructor could see
-- Booking rows for Students at their own School (Booking's own broad Staff-read
-- policy, unaffected by this), but resolving those same Students' NAMES via a
-- User-table join came back null, not merely missing — Prisma's own non-nullable-
-- relation check (the Booking -> User relation is required) turned the RLS gap into
-- a hard PrismaClientUnknownRequestError rather than a silent empty result, which is
-- what actually surfaced this on the very first real end-to-end call.
--
-- This is the exact same root-cause SHAPE 20260904000000 already fixed for
-- "rolegrant_school_manager_scope" (a policy's own subquery into the SAME or a
-- co-dependent RLS-protected table can't see rows RLS wouldn't otherwise show this
-- caller) — just newly discovered on a different policy, because this is the first
-- time anything in this codebase has actually exercised the "shared School, not
-- Owner/Manager" branch of user_self_or_shared_school end-to-end.
--
-- THE FIX: same established pattern, reusing the ALREADY-EXISTING ultm8_rls_helper
-- role (NOLOGIN, BYPASSRLS, created by 20260904000000) rather than creating a second
-- one — a new SECURITY DEFINER function whose internal query bypasses RLS on
-- RoleGrant entirely (deterministically, not relying on evaluation-order
-- short-circuiting — see 20260904000000's own comment for why that distinction
-- matters), so it can see BOTH "mine" and "theirs" regardless of the calling role.

CREATE FUNCTION "shares_active_school_with"(p_other_user_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."RoleGrant" mine
    JOIN public."RoleGrant" theirs ON theirs."schoolId" = mine."schoolId"
    WHERE mine."userId" = current_setting('app.current_user_id', true)
      AND mine."revokedAt" IS NULL
      AND mine."schoolId" IS NOT NULL
      AND theirs."userId" = p_other_user_id
      AND theirs."revokedAt" IS NULL
  );
$$;

ALTER FUNCTION "shares_active_school_with"(text) OWNER TO ultm8_rls_helper;

-- Functions default to EXECUTE granted to PUBLIC, so ultm8_app could already call
-- this without this line — granted explicitly anyway, matching
-- 20260904000000's own stated preference for explicit grants over relying on
-- Postgres defaults.
GRANT EXECUTE ON FUNCTION "shares_active_school_with"(text) TO ultm8_app;

-- Same policy name, same intent (a User is visible to themself, or to anyone who
-- shares an active School-scoped RoleGrant with them) — only the second disjunct's
-- expression changes, via ALTER POLICY rather than DROP/CREATE. WITH CHECK is
-- intentionally omitted here (unchanged) — ALTER POLICY leaves a clause alone when
-- it isn't specified.
ALTER POLICY "user_self_or_shared_school" ON "User"
  USING (
    "id" = current_setting('app.current_user_id', true)
    OR shares_active_school_with("id")
  );
