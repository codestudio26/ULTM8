-- Decision 266 — Apple 4.2.6/4.3 compliance (Decision 247's "one shared app,
-- School picked after install"). School.joinCode is the human-enterable code
-- a prospective Student types into apps/student's new pre-auth School-pick
-- screen; School.accentColor is the School-side half of "light theming
-- post-login". See schema.prisma's own comments on both fields for the full
-- reasoning.

-- 8 characters from a 32-character unambiguous alphabet (no 0/O/1/I, so a
-- Student reading it off a front-desk sign can't confuse characters).
-- 32^8 ≈ 1.1e12 combinations — the retry loop is belt-and-suspenders, not
-- the primary defense against collision.
CREATE OR REPLACE FUNCTION generate_school_join_code() RETURNS TEXT AS $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate TEXT;
  attempt INT := 0;
  i INT;
BEGIN
  LOOP
    candidate := '';
    FOR i IN 1..8 LOOP
      candidate := candidate || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
    END LOOP;
    attempt := attempt + 1;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM "School" WHERE "joinCode" = candidate) OR attempt > 20;
  END LOOP;
  RETURN candidate;
END;
$$ LANGUAGE plpgsql;

-- A function-based DEFAULT (not a constant) — deliberately, so Prisma marks
-- joinCode OPTIONAL on the generated SchoolCreateInput type (schema.prisma's
-- own comment on this field explains why that matters: dozens of e2e test
-- fixtures create a School directly via a raw superuser PrismaClient,
-- bypassing SchoolsService, and shouldn't need updating for a field they
-- don't care about). This single ADD COLUMN also backfills every
-- pre-existing School — Postgres evaluates a non-constant DEFAULT once per
-- row as part of the implied table rewrite, same as a real UPDATE would.
ALTER TABLE "School" ADD COLUMN "joinCode" TEXT NOT NULL DEFAULT generate_school_join_code();
ALTER TABLE "School" ADD CONSTRAINT "School_joinCode_key" UNIQUE ("joinCode");

ALTER TABLE "School" ADD COLUMN "accentColor" TEXT;

-- The pre-auth School-pick screen's "enter a join code" mode looks the code
-- up through the SAME public, cross-tenant, curated-column mechanism the
-- existing discovery endpoints already use (Decision 94's ultm8_discovery
-- role, Phase 14 migration 20260917000000_academies_discovery_module) — not
-- a new role. That migration's own column-level GRANT on School didn't name
-- joinCode (it didn't exist yet); widen it here so AcademiesService.findByJoinCode()
-- can WHERE-filter on it (confirmed empirically elsewhere in this codebase —
-- see 20261115000000_grading_erasure_jobs_grant's own comment — that a
-- read needs SELECT on any column its WHERE clause references, same as a
-- DELETE does). accentColor is deliberately NOT granted here — it's only
-- read post-login, via the already-unrestricted ultm8_app/RLS path, never
-- through the pre-auth discovery role.
--
-- archivedAt is granted for the identical reason, FOUND ON REVIEW: every
-- discovery method in AcademiesService (findAll/findOne/search/
-- findByJoinCode) now filters `archivedAt: null` — without it, a School
-- closed via Decision 110's close-account flow stayed fully discoverable
-- and joinable (via the existing JoinSchoolScreen -> POST /schools/:id/join)
-- for its whole 90-day pending-purge window, pre-auth or not.
GRANT SELECT ("joinCode", "archivedAt") ON "School" TO ultm8_discovery;
