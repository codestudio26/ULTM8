-- Decision 220/246 (POST-SPEC-55-DECISION-LOG.md) — Student Detail's Measurements
-- fields (Weight Category, Kimono Size, Belt Size), approved by the product owner
-- for build as real fields, overriding the Developer recommendation to drop them
-- for lack of grounding anywhere in Spec 55, the domain-rules skill, or this schema
-- (docs/v1.2-backend-backlog.md had flagged them Fully Proposed).
--
-- Placed on `User`, not `StudentRank` — person-level physical attributes that don't
-- vary by Discipline, unlike StudentRank's per-Student-per-Discipline grading data.
-- Free-text nullable `String?`, same shape as this model's existing
-- gender/nationality/language/currency columns: no enum, unit, or canonical code
-- list is confirmed anywhere for any of the three, so (per Decision 220/246's own
-- recorded reasoning) this is a developer-level presentation choice, not an
-- invented business rule.
--
-- No ultm8_app GRANT change needed — User already has a table-level grant
-- (20260902000000_init); adding nullable columns needs no GRANT of its own, same
-- reasoning 20261107000000_branch_settings_fields's own comment gives for adding
-- columns to Branch.

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "weightCategory" TEXT,
  ADD COLUMN "kimonoSize" TEXT,
  ADD COLUMN "beltSize" TEXT;
