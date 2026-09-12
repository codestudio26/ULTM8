-- ULTM8 Phase 26 — PlatformAdminModule Slice 2: AuditLogEntry + first real
-- cross-tenant admin read (GET /platform-admin/schools/:id).
--
-- See ultm8-tenant-isolation SKILL.md §6 for the confirmed requirements this
-- migration implements: "who, when, what, on which tenant," immutable at the
-- database layer (UPDATE/DELETE revoked for every role, including the
-- break-glass credential once it exists — not built yet, correctly out of
-- scope here), range-partitioned by month on createdAt from the start. Exact
-- retention period is a compliance/legal input explicitly left open by the
-- spec (§12.2) — no deletion path exists on this table at all, which is the
-- correct default for "not yet decided," not a gap.
--
-- ============================================================================
-- WHY THIS TABLE IS HAND-WRITTEN, NOT `prisma migrate dev`-GENERATED
--
-- Prisma's schema language has no concept of PostgreSQL declarative
-- partitioning. schema.prisma's own AuditLogEntry model comment already flags
-- the practical consequence: `prisma migrate dev`'s own diffing (local dev
-- only — CI's `prisma migrate deploy` just applies migration folders in
-- order, it does not diff schema.prisma against the live DB, so this is safe
-- there) would see this hand-written partitioned table as "drifted" against
-- a naive plain-table reading of the schema. Accepted, not silently papered
-- over: any FUTURE change to AuditLogEntry's own columns must be its own
-- hand-written migration too, the same way every RLS-policy-touching
-- migration in this codebase already is — never let `prisma migrate dev`
-- generate a fresh migration for this specific table.
--
-- A partitioned table's PRIMARY KEY must include the partition key column
-- (a hard PostgreSQL requirement, not a stylistic choice) — hence the
-- composite (id, "createdAt") key below, matching schema.prisma's own
-- `@@id([id, createdAt])`. `id` itself is NOT independently unique at the
-- database level as a result; acceptable here since a UUID's own collision
-- probability makes it unique in practice, and every real access pattern
-- this table has is a filtered `findMany` (by actor/target/time-range), never
-- `findUnique` by bare id — see the schema comment for the full account.
-- ============================================================================

CREATE TABLE "AuditLogEntry" (
  -- DB-level DEFAULT, matching every other table's own id column in this schema
  -- (e.g. User/School/Franchise in the init migration) — belt-and-suspenders for
  -- any insert path that doesn't go through Prisma Client (Prisma always supplies
  -- `id` explicitly today via schema.prisma's own `@default(uuid())`, so this
  -- isn't exercised by AuditLogService.record() itself, but a future raw-SQL
  -- insert — a manual backfill, or the break-glass path once it exists — matches
  -- the same convention every other table already gets).
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "adminUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "schoolId" TEXT,
  "franchiseId" TEXT,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLogEntry_pkey" PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");

-- Outward FK to AdminUser only — no FK on targetType/targetId (a deliberate
-- polymorphic reference, not expressible as a single-column FK — see the
-- schema comment) and no FK on schoolId/franchiseId either, for the same
-- "must remain readable even after the target/tenant row is later deleted"
-- reasoning. PostgreSQL propagates a FK declared on the partitioned parent to
-- every partition automatically.
ALTER TABLE "AuditLogEntry" ADD CONSTRAINT "AuditLogEntry_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id");

-- Indexes on the partitioned parent propagate to every existing AND future
-- partition automatically (PostgreSQL 11+, as long as CREATE INDEX omits
-- ONLY) — matches schema.prisma's own @@index declarations exactly.
CREATE INDEX "AuditLogEntry_adminUserId_createdAt_idx" ON "AuditLogEntry"("adminUserId", "createdAt");
CREATE INDEX "AuditLogEntry_schoolId_createdAt_idx" ON "AuditLogEntry"("schoolId", "createdAt");
CREATE INDEX "AuditLogEntry_franchiseId_createdAt_idx" ON "AuditLogEntry"("franchiseId", "createdAt");
CREATE INDEX "AuditLogEntry_targetType_targetId_createdAt_idx" ON "AuditLogEntry"("targetType", "targetId", "createdAt");

-- ============================================================================
-- Initial partitions — this migration's own anchor month (Sep 2026) through
-- 12 months forward, plus a DEFAULT partition as a required safety net
-- (PostgreSQL rejects an INSERT with no matching partition and no DEFAULT —
-- this is not optional to skip). Rolling the window forward indefinitely
-- needs a scheduled job creating the next month's partition ahead of time —
-- explicitly NOT built here, same "flagged, not invented" treatment the
-- spec's own retention-period gap already gets above. A 13-month runway from
-- today is enough to not need that job on day one, not a claim that this is
-- solved long-term.
-- ============================================================================
DO $$
DECLARE
  partition_start date := date_trunc('month', TIMESTAMP '2026-09-01');
  partition_end date;
  partition_name text;
  i integer;
BEGIN
  FOR i IN 0..12 LOOP
    partition_end := partition_start + INTERVAL '1 month';
    partition_name := 'AuditLogEntry_' || to_char(partition_start, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF "AuditLogEntry" FOR VALUES FROM (%L) TO (%L)',
      partition_name, partition_start, partition_end
    );
    partition_start := partition_end;
  END LOOP;
END
$$;

CREATE TABLE "AuditLogEntry_default" PARTITION OF "AuditLogEntry" DEFAULT;

-- ============================================================================
-- Immutability, enforced at the database layer, not just application
-- convention (§6: "UPDATE and DELETE are revoked... for every role"). Explicit
-- REVOKE rather than relying on "never granted" — clearer intent, and it
-- protects against a role that was already granted broader privileges before
-- this migration ran (there is no such role today, but this doesn't assume
-- there never will be).
--
-- CORRECTED ON REVIEW: an earlier version of this comment claimed a future
-- migration "accidentally GRANT ALL-ing some role... can't undo an explicit
-- REVOKE silently." That's wrong — PostgreSQL REVOKE/GRANT simply toggle a
-- privilege bit; there is no "sticky" revoke that survives a later GRANT
-- (short of ownership changes or ACL tricks well beyond this migration's
-- scope). This REVOKE is a real, correct guarantee AS OF RIGHT NOW, not a
-- permanent one — the e2e suite's own
-- "no role ever holds UPDATE/DELETE on AuditLogEntry" test (see
-- platform-admin-schools.e2e-spec.ts) is what actually catches a future
-- migration silently re-granting it, not this REVOKE by itself. Applied to
-- every role that exists in this schema today; when the break-glass
-- credential (§4, not built yet) is eventually added, its own role must get
-- the same treatment, and that same e2e assertion will already cover it
-- automatically (it queries information_schema, not a hardcoded role list).
-- ============================================================================
REVOKE UPDATE, DELETE ON "AuditLogEntry" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ultm8_app') THEN
    REVOKE UPDATE, DELETE ON "AuditLogEntry" FROM ultm8_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ultm8_auth') THEN
    REVOKE UPDATE, DELETE ON "AuditLogEntry" FROM ultm8_auth;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ultm8_jobs') THEN
    REVOKE UPDATE, DELETE ON "AuditLogEntry" FROM ultm8_jobs;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ultm8_discovery') THEN
    REVOKE UPDATE, DELETE ON "AuditLogEntry" FROM ultm8_discovery;
  END IF;
END
$$;

-- ============================================================================
-- ultm8_platform_admin — a genuinely NEW, dedicated Postgres LOGIN role for
-- PlatformAdminModule's cross-tenant business-logic reads (NOT for AdminUser
-- lookups themselves — those stay on the existing bare `ultm8_app` connection,
-- unchanged from Phase 25's Slice 1, since AdminUser has no RLS policy at all
-- and ultm8_app already has full CRUD on it per the Phase 1 migration's own
-- comment). Exactly the same precedent ultm8_discovery/ultm8_jobs already
-- established for "a caller population that legitimately needs to read
-- outside the normal per-caller RLS shape": a dedicated role with its own
-- connection string (DATABASE_URL_PLATFORM_ADMIN), so widening what it can
-- see has zero blast radius on any other endpoint's isolation guarantees, by
-- construction rather than by care — NOT a policy attached to ultm8_app,
-- which the academies_discovery_module migration's own header comment
-- documents as a severe mistake caught on that phase's own review before it
-- shipped (a shared-role policy silently widens visibility for every OTHER
-- endpoint using that role too, since PostgreSQL combines multiple
-- PERMISSIVE policies for the same role+command with OR).
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ultm8_platform_admin') THEN
    CREATE ROLE ultm8_platform_admin LOGIN PASSWORD 'changeme';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO ultm8_platform_admin;

-- AuditLogEntry — SELECT + INSERT only, matching the immutability posture
-- above (this role never gets UPDATE/DELETE granted in the first place, on
-- top of the explicit REVOKE FROM PUBLIC already covering it).
GRANT SELECT, INSERT ON "AuditLogEntry" TO ultm8_platform_admin;
-- FK-check requirement: PostgreSQL requires the inserting role to hold
-- SELECT on a referenced table's referenced column to satisfy a FK
-- constraint at insert time (unless running as owner/superuser) — narrowed
-- to exactly the one column the FK above actually references.
GRANT SELECT ("id") ON "AdminUser" TO ultm8_platform_admin;

-- School — full curated column set (excludes stripeFranchiseFeeSubscriptionId,
-- an internal Stripe correlator id with no direct caller action tied to it —
-- same "deliberately not exposed" convention FranchiseResponseDto's own
-- header comment already established for the equivalent Franchise fields).
-- Platform Admin support staff need genuinely fuller visibility than
-- AcademiesModule's own public-discovery curation (Decision 94) — there is no
-- raw payment credential stored on School itself to worry about either way
-- (Stripe Connect account ids/secrets-manager references only, confirmed
-- platform-wide invariant, ultm8-domain-rules §14).
GRANT SELECT (
  "id", "franchiseId", "name", "mobileNumber", "address", "businessType",
  "activities", "facilities", "ranksToggle", "defaultLanguage", "defaultCurrency",
  "description", "logoUrl", "bannerUrl", "classCancellationPolicy",
  "waitlistClaimWindowMinutes", "franchiseFeeSubscriptionStatus",
  "createdAt", "updatedAt"
) ON "School" TO ultm8_platform_admin;

-- FOUND ON REVIEW OF THE PRIOR ultm8_discovery MIGRATION, applied proactively
-- here rather than rediscovered via a second CI failure: school_tenant_isolation
-- (the init migration) has no explicit `TO ultm8_app`, so PostgreSQL's default
-- (`TO PUBLIC`) means it applies to ultm8_platform_admin too — and because
-- PostgreSQL combines multiple PERMISSIVE policies for a table+command with OR,
-- evaluating that OR at query-rewrite time requires ultm8_platform_admin to
-- hold SELECT on every column ANY combined policy's expression references,
-- regardless of which policy's branch actually ends up true for a given row.
-- school_tenant_isolation's own inline EXISTS subquery reads
-- RoleGrant.schoolId/userId/revokedAt — narrowed to exactly those three
-- columns, the same column-level discipline as every grant in this migration.
GRANT SELECT ("schoolId", "userId", "revokedAt") ON "RoleGrant" TO ultm8_platform_admin;

-- The actual bypass — mirrors ultm8_discovery's own `USING (true)` shape
-- exactly (an unconditional, additive PERMISSIVE policy scoped ONLY to this
-- one dedicated role, OR'd with school_tenant_isolation's own always-false-
-- for-this-role evaluation above, not replacing it).
CREATE POLICY "platform_admin_school_read" ON "School"
  FOR SELECT
  TO ultm8_platform_admin
  USING (true);
