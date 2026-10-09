-- FOUND ON REVIEW (deep-dive pass before merge): an earlier draft of
-- membership-expiry-sweep.processor.ts persisted Membership.status = EXPIRED
-- for the date-based expiry path. Decision 26 explicitly confirms that path is
-- "a live-computed predicate evaluated at every access/booking check against
-- the stored expiry date, not a scheduled batch flip" — the earlier draft
-- built exactly the scheduled batch flip that decision prohibits, and it
-- silently changed what franchise-fee-usage-reporting's countActiveStudents()
-- (status: 'ACTIVE' read directly) bills Franchises for every month.
--
-- This column is the fix: a narrow, job-private bookkeeping timestamp that
-- carries no ACTIVE/EXPIRED meaning at all — Membership.status is never
-- touched by the sweep now. See that column's own Prisma schema comment.

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN "bookingCancellationSweptAt" TIMESTAMP(3);
