-- Decision 345 (Classes review C1): a one-off Class (not made by the Timetable)
-- now needs its own ticket unless "Included in membership" is ticked. The flag
-- was never read before, so every existing one-off Class was in effect covered
-- by general access. Turning the flag on for them keeps today's bookings working;
-- an owner can untick it on any of them. New one-off Classes still start unticked
-- (the column default, SKILL.md §6).
UPDATE "Class"
SET "membershipInclusion" = true
WHERE "timetableSlotId" IS NULL
  AND "occurrenceDate" IS NULL
  AND "membershipInclusion" = false;
