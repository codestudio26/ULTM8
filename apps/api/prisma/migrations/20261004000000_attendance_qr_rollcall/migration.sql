-- Phase 51 (Decision 107, docs/decisions/POST-SPEC-55-DECISION-LOG.md) — the
-- rotating-QR self-service check-in redesign and the new Instructor roll-call
-- scan / manual-confirm paths. Hand-authored, not `prisma migrate dev`-generated
-- — additive only, verified against a real Postgres before trusting it (every
-- prior migration in this repo carries the same disclosure).
--
-- Additive-only: one new enum, two new nullable columns on the existing
-- "Booking" table. No RLS policy change needed — "booking_school_staff_or_self"
-- and "booking_staff_read" (20260915000000_booking_waitlist_module) are both
-- row-level predicates over schoolId/studentId, not column-scoped, so the two
-- new columns are automatically covered by Booking's own existing
-- `GRANT SELECT, INSERT, UPDATE, DELETE ON "Booking" TO ultm8_app` and the
-- existing `ultm8_jobs` read/update grants — nothing to re-grant here.

CREATE TYPE "CheckInMethod" AS ENUM ('SELF_SERVICE', 'INSTRUCTOR_SCAN', 'INSTRUCTOR_MANUAL');

ALTER TABLE "Booking" ADD COLUMN "checkInMethod" "CheckInMethod";
ALTER TABLE "Booking" ADD COLUMN "checkedInById" TEXT;

-- Same ON DELETE SET NULL as Booking_overriddenById_fkey/Booking_resolvedById_fkey
-- (20260915000000_booking_waitlist_module) — an Instructor's own User row has no
-- delete endpoint in this codebase (general tenant/content offboarding is
-- [UNRESOLVED]), so this is unreachable today; kept consistent with its two
-- sibling actor-reference columns on the same table regardless.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
