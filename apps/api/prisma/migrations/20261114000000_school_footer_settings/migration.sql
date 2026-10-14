-- Decision 257 (POST-SPEC-55-DECISION-LOG.md) — per-School footer content for
-- apps/school-portal's own richer footer (Programs/Company/Support columns,
-- social links). Pure additive columns on the already-RLS-protected `School`
-- table (same "ALTER TABLE ... ADD COLUMN, no new RLS policy" shape as
-- 20261107000000_branch_settings_fields) — the existing school_tenant_isolation
-- policy (20260902000000_init) already governs read/write for every column on
-- this table, including these.

ALTER TABLE "School"
  ADD COLUMN "footerAboutUs" TEXT,
  ADD COLUMN "footerContactEmail" TEXT,
  ADD COLUMN "footerContactPhone" TEXT,
  ADD COLUMN "footerFacebookUrl" TEXT,
  ADD COLUMN "footerInstagramUrl" TEXT,
  ADD COLUMN "footerTiktokUrl" TEXT,
  ADD COLUMN "footerYoutubeUrl" TEXT,
  ADD COLUMN "footerTwitterUrl" TEXT;
