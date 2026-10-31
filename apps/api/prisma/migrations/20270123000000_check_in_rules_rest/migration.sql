-- The rest of the check-in rules (v1.3 backlog §3.5; Decisions 317, 394).
-- Every default is what check-in did before, so nothing changes until a
-- School changes a rule.
-- "Show belt progress on the check-in screen": on, as the welcome card always did.
-- "Block check-in for overdue payments": null = No (never refused), else 7 or 14 days.
ALTER TABLE "School"
  ADD COLUMN "checkInShowBeltProgress" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "checkInBlockOverdueDays" INTEGER;

ALTER TABLE "School"
  ADD CONSTRAINT "School_checkInBlockOverdueDays_check"
  CHECK ("checkInBlockOverdueDays" IS NULL OR "checkInBlockOverdueDays" IN (7, 14));
