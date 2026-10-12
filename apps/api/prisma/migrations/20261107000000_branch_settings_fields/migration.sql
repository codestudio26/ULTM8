-- Decision 231 (POST-SPEC-55-DECISION-LOG.md) — Branch field-level settings
-- screen: four new columns to back fields already drawn in the Branch
-- mockups as display-only mirrors of Franchise's own. Mirrors Franchise's
-- identically-named/typed columns field-for-field (schema.prisma).

-- AlterTable
ALTER TABLE "Branch"
  ADD COLUMN "type" TEXT,
  ADD COLUMN "activities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "facilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "defaultLanguage" TEXT,
  ADD COLUMN "description" TEXT;
