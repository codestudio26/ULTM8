-- Decision 276 — structured, country-aware postal addresses.
--
-- Adds six nullable columns next to the existing free-text "address" on every
-- table that has one. Nothing is rewritten: existing "address" text is left
-- exactly as it is and stays what every screen shows. A row with
-- "addressCountry" NULL simply has no structured address yet; the School Portal
-- pre-fills the old text into line 1 and asks for a country the next time
-- someone edits it. Once structured fields are saved, the API rebuilds
-- "address" from them, so the two never disagree.
--
-- Purely additive (ADD COLUMN, all nullable, no default) — no table rewrite,
-- no RLS change: these columns sit on rows each table's existing policies
-- already govern, and ultm8_app's table-level grants cover new columns.

ALTER TABLE "User"
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "addressCity" TEXT,
  ADD COLUMN "addressRegion" TEXT,
  ADD COLUMN "addressPostalCode" TEXT,
  ADD COLUMN "addressCountry" TEXT;

ALTER TABLE "Franchise"
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "addressCity" TEXT,
  ADD COLUMN "addressRegion" TEXT,
  ADD COLUMN "addressPostalCode" TEXT,
  ADD COLUMN "addressCountry" TEXT;

ALTER TABLE "School"
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "addressCity" TEXT,
  ADD COLUMN "addressRegion" TEXT,
  ADD COLUMN "addressPostalCode" TEXT,
  ADD COLUMN "addressCountry" TEXT;

ALTER TABLE "Branch"
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "addressCity" TEXT,
  ADD COLUMN "addressRegion" TEXT,
  ADD COLUMN "addressPostalCode" TEXT,
  ADD COLUMN "addressCountry" TEXT;

ALTER TABLE "Instructor"
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "addressCity" TEXT,
  ADD COLUMN "addressRegion" TEXT,
  ADD COLUMN "addressPostalCode" TEXT,
  ADD COLUMN "addressCountry" TEXT;

-- tenant-lifecycle-purge's Franchise anonymisation fallback redacts the
-- address; ultm8_jobs only has column-level UPDATE on "Franchise"
-- (20261006000000_tenant_lifecycle_module), so the new columns need it too.
-- (It has table-level UPDATE on "School" already.)
GRANT UPDATE ("addressLine1", "addressLine2", "addressCity", "addressRegion", "addressPostalCode", "addressCountry") ON "Franchise" TO ultm8_jobs;
