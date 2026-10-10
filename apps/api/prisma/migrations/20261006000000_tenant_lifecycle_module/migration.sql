-- Phase 56 — Decision 110 (POST-SPEC-55-DECISION-LOG.md): general tenant/content
-- offboarding. Soft-archive immediately on an explicit, Platform-Admin-mediated
-- close-account action; hard-delete (or, where a RESTRICT constraint or the
-- flagged Waiver exception applies, anonymize in place) after a 90-day
-- retention window with no reversal. This migration adds the three columns
-- that drive the whole lifecycle plus the exact new grants each of the three
-- roles that touch them needs — the same "add only the specific grant a new
-- use actually needs" discipline every prior migration in this schema follows
-- (grepped every one of them before writing this).
--
-- Hand-authored, not `prisma migrate dev`-generated (this repo's established
-- convention) — unverified against real Postgres until this phase's own
-- verification step runs it.

-- ============================================================================
-- 1. Franchise — archivedAt/purgeAt/purgedAt.
-- ============================================================================

ALTER TABLE "Franchise" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Franchise" ADD COLUMN "purgeAt" TIMESTAMP(3);
ALTER TABLE "Franchise" ADD COLUMN "purgedAt" TIMESTAMP(3);
CREATE INDEX "Franchise_purgeAt_idx" ON "Franchise"("purgeAt");

-- ============================================================================
-- 2. School — archivedAt/purgeAt/purgedAt.
-- ============================================================================

ALTER TABLE "School" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "School" ADD COLUMN "purgeAt" TIMESTAMP(3);
ALTER TABLE "School" ADD COLUMN "purgedAt" TIMESTAMP(3);
CREATE INDEX "School_purgeAt_idx" ON "School"("purgeAt");

-- ============================================================================
-- 3. ultm8_platform_admin — the close-account/reactivate write path
--    (TenantLifecycleService, PlatformAdminModule). ultm8_app already holds
--    whole-table SELECT/INSERT/UPDATE/DELETE on both tables (init migration),
--    so the new columns need no new grant there — TenantAuthorizationService's
--    own assertSchoolNotArchived/assertFranchiseNotArchived gate (Phase 56,
--    tenant-authorization.service.ts) reads them through the ordinary
--    ultm8_app/RLS path a caller's own request already uses, same as every
--    other business-rule check that service makes.
--
--    ultm8_platform_admin's existing SELECT grants on School/Franchise
--    (20260925000000_platform_admin_audit_log, 20260926000000_platform_admin_
--    franchise_read) are column-curated, not whole-table, so the three new
--    columns need an explicit additive grant here to be visible to the admin
--    read path at all. purgedAt is read-only for this role (set only by the
--    purge job) — granted SELECT so the admin UI can show "purged" state, not
--    UPDATE, since ultm8_platform_admin never writes it.
-- ============================================================================

-- `updatedAt` is granted alongside archivedAt/purgeAt, not omitted — FOUND ON
-- REVIEW (caught by this phase's own e2e run failing with "permission denied
-- for table School", the exact same class of bug
-- 20260923000000_franchise_jobs_grant_updatedat_fix already fixed once for
-- ultm8_jobs): Prisma's `@updatedAt` silently adds `updatedAt` to every
-- `update()`'s SET clause, so a role's first-ever UPDATE grant on a table
-- needs that column too, not just the fields the code explicitly sets.
GRANT SELECT ("archivedAt", "purgeAt", "purgedAt") ON "School" TO ultm8_platform_admin;
GRANT UPDATE ("archivedAt", "purgeAt", "updatedAt") ON "School" TO ultm8_platform_admin;

GRANT SELECT ("archivedAt", "purgeAt", "purgedAt") ON "Franchise" TO ultm8_platform_admin;
GRANT UPDATE ("archivedAt", "purgeAt", "updatedAt") ON "Franchise" TO ultm8_platform_admin;

-- A column-level GRANT is necessary but not sufficient here — School/Franchise
-- both have FORCE ROW LEVEL SECURITY (init migration), and
-- platform_admin_school_read/platform_admin_franchise_read (20260925000000/
-- 20260926000000) are FOR SELECT only. Without a matching FOR UPDATE policy,
-- ultm8_platform_admin's UPDATE grant above is silently unusable — Postgres
-- RLS makes every row invisible to the UPDATE command, and Prisma reports that
-- as "record not found" (P2025), indistinguishable from the row genuinely not
-- existing. FOUND ON REVIEW, by this phase's own e2e run failing that exact
-- way (a 404 for a freshly-created School the SELECT path had just read
-- successfully moments earlier) — fixed here, not worked around in
-- application code.
CREATE POLICY "platform_admin_school_update" ON "School"
  FOR UPDATE
  TO ultm8_platform_admin
  USING (true)
  WITH CHECK (true);

CREATE POLICY "platform_admin_franchise_update" ON "Franchise"
  FOR UPDATE
  TO ultm8_platform_admin
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 4. ultm8_jobs — the scheduled purge job (tenant-lifecycle-purge.processor.ts,
--    this phase). Needs DELETE on both tables (never granted before now —
--    grepped every prior migration to confirm) for the full-cascade purge path,
--    and UPDATE for the anonymize-in-place fallback path (School already holds
--    whole-table UPDATE via 20260922000000_franchise_fee_charge_module;
--    Franchise's own UPDATE grant is deliberately column-scoped per that same
--    migration's own "column-scope the grant when the table holds something a
--    whole-table grant doesn't need to touch" reasoning for Franchise
--    specifically — followed here rather than widened). SELECT is already
--    whole-table on both (school_jobs_read/franchise_jobs_read), so the three
--    new columns are already visible to the scheduler's own "find rows past
--    purgeAt" query with no new grant.
--
--    No new grant needed for Waiver — ultm8_jobs already holds
--    `GRANT SELECT ON "Waiver" TO ultm8_jobs` (20260918000000_notifications_
--    module), which is exactly what the purge job's own Waiver-retention guard
--    (a `count()` before attempting a School delete) needs.
-- ============================================================================

GRANT DELETE ON "School" TO ultm8_jobs;
CREATE POLICY "school_jobs_delete" ON "School"
  FOR DELETE
  TO ultm8_jobs
  USING (true);

GRANT DELETE ON "Franchise" TO ultm8_jobs;
CREATE POLICY "franchise_jobs_delete" ON "Franchise"
  FOR DELETE
  TO ultm8_jobs
  USING (true);

-- Franchise UPDATE: additive to the existing (stripeMeterId, stripeUsagePriceId,
-- platformSubscriptionStatus, updatedAt) column grant — adds exactly the columns
-- the anonymize-fallback path writes (archivedAt/purgeAt are never touched by
-- the job itself post-close-account, but purgedAt is; name/mobileNumber/address/
-- description/logoUrl/bannerUrl are the PII-bearing fields the fallback redacts).
GRANT UPDATE (
  "purgedAt", "name", "mobileNumber", "address", "description", "logoUrl", "bannerUrl"
) ON "Franchise" TO ultm8_jobs;
