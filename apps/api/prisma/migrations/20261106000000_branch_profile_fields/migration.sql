-- Decision 238: Branch gains type/activities/facilities/defaultLanguage/
-- description, matching the identical, independent fields School and
-- Franchise already each carry (no inheritance/derivation between any of
-- the three — this simply extends an already-twice-used pattern to the
-- third hierarchy level). Additive; nothing is removed. No new GRANT
-- needed — ultm8_app already holds table-wide SELECT/INSERT/UPDATE/DELETE
-- on "Branch" (20260902000000_init), which already covers any new column.

ALTER TABLE "Branch" ADD COLUMN "type" TEXT;
ALTER TABLE "Branch" ADD COLUMN "defaultLanguage" TEXT;
ALTER TABLE "Branch" ADD COLUMN "activities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Branch" ADD COLUMN "facilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Branch" ADD COLUMN "description" TEXT;
