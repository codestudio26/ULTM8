-- Phase 17 — Instructor roll-call check-in (Decision 71's named concept, built as a
-- plain per-Student roster tap rather than a literal QR scan, per the product-owner
-- decision this phase's kickoff resolved). Adds the one new column this needs:
-- attribution for which Instructor/Staff member marked a Booking checked-in this way,
-- so it's distinguishable from a Student's own self-service scan (POST
-- /attendance/scan, which leaves this column null) and auditable after the fact —
-- same "record who did it, no extra friction" shape as the existing
-- overriddenById/resolvedById columns on this same table.
--
-- Hand-written, not `prisma migrate dev`-generated as-is: this schema has a
-- pre-existing, unrelated drift from `schema.prisma` (every table's "id" column has
-- a DB-level `DEFAULT gen_random_uuid()::text` here that `@default(uuid())` alone
-- doesn't ask Prisma's migration engine to expect) that a now-available real
-- Postgres instance surfaced for the first time. Prisma's auto-generated diff wanted
-- to strip that default from every single table as a side effect of this one-column
-- addition — a real, unrelated behavior change, not something to ship silently
-- riding along with an unrelated feature. This migration contains only the actual
-- intended change; the id-default drift is a separate, pre-existing issue flagged
-- for its own deliberate fix, not bundled in here.

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "checkedInById" TEXT;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
