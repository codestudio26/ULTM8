-- Decision 317 items 3 and 4 (backlog 5.6, 5.7).
-- Attendance staff log afterwards (up to 30 days back) is recorded with its
-- own check-in method, so it can be told apart from a check-in on the day.
ALTER TYPE "CheckInMethod" ADD VALUE 'STAFF_LOGGED';

-- "See attendance statistics": Branch Staff the owner switches on see their
-- own Branches' statistics. StaffPermission's existing grants and policies apply.
ALTER TABLE "StaffPermission" ADD COLUMN "canSeeAttendanceStats" BOOLEAN NOT NULL DEFAULT false;
