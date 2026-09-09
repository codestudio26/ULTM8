-- Self-service Student enrollment (Decision 96) — POST /schools/:id/join.
--
-- FOUND ON REVIEW, BEFORE THIS EVER SHIPPED — the first draft's mechanism was
-- a real mistake, not a style nit: it reused PrismaDiscoveryService (Phase
-- 14, provisioned specifically and exclusively for AcademiesModule) for its
-- own School-existence check. That service's own header comment is explicit:
-- "ONLY AcademiesService may inject this... add that module's own narrowly-
-- scoped role/policy, the same way this one and ultm8_jobs each did, rather
-- than reusing this connection for an unrelated purpose." Four independent
-- review angles flagged the same thing: coupling TenantsModule's own
-- correctness to a connection/policy set shaped for a different module's
-- needs, with no dedicated audit trail marking it as a second reviewed
-- consumer.
--
-- THE FIX: this schema already has an established, purpose-built pattern for
-- exactly this problem — "does a row exist that the caller's own RLS context
-- can't already see" — school_has_any_role_grant (20260906000000), a
-- SECURITY DEFINER STABLE function owned by the existing ultm8_rls_helper
-- role (created Phase 2, no new role needed), reading unfiltered via
-- BYPASSRLS, called from INSIDE the caller's own ultm8_app policy/query
-- context rather than through a separate connection entirely. school_exists
-- below mirrors that function's exact shape for a plain existence check
-- (not embedded in an RLS policy this time — called directly from
-- SchoolsService.join() via a parameterized tx.$queryRaw, the same raw-query
-- pattern already established in bookings.service.ts/waitlist.service.ts for
-- SELECT ... FOR UPDATE). This needs no new Postgres role, no new grant
-- beyond EXECUTE, and has zero coupling to AcademiesModule's own policies.
CREATE FUNCTION "school_exists"(p_school_id text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public."School" WHERE id = p_school_id);
$$;

ALTER FUNCTION "school_exists"(text) OWNER TO ultm8_rls_helper;
GRANT EXECUTE ON FUNCTION "school_exists"(text) TO ultm8_app;

-- The actual DB-level guarantee behind Decision 96's own stated idempotency
-- rule ("joining a School you already hold an active Student grant at is a
-- 409, not a silent no-op or a duplicate grant"). FOUND ON REVIEW: the first
-- draft only checked-then-inserted across two separate transactions with
-- nothing enforcing it — a genuine TOCTOU race (two concurrent join() calls
-- for the same caller+School) could produce two active STUDENT RoleGrant
-- rows for the same (userId, schoolId), the exact class of bug this schema's
-- own established "atomic constraint over app-layer check" philosophy
-- (Membership_one_active_general_access_per_school, WaitlistEntry_one_
-- active_per_student_per_class, WaiverSignature_one_non_expired_per_student_
-- per_waiver) already exists to prevent. Scoped to STUDENT specifically, not
-- every role — Instructor/Branch Staff grants already have their own
-- application-level duplicate check (RoleGrantsService.create(), Decision
-- 80/81) and a real, confirmed reason a User might hold more than one (a
-- different Branch); a Student join never has that reason.
CREATE UNIQUE INDEX "RoleGrant_one_active_student_per_school" ON "RoleGrant"("userId", "schoolId")
  WHERE "role" = 'STUDENT' AND "revokedAt" IS NULL;
