-- Decision 353 (Q6): a Class carries its slot's break for that date, shown on
-- the class details only. No effect on bookings.
ALTER TABLE "Class" ADD COLUMN "breakStartAt" TIMESTAMP(3);
ALTER TABLE "Class" ADD COLUMN "breakEndAt" TIMESTAMP(3);

-- Upcoming Classes that still sit at their slot's times take the slot's break,
-- in the slot's zone (Branch, then School, then UTC; Decision 172). A Class kept
-- at old times after a slot move is left without one.
UPDATE "Class" c
SET "breakStartAt" = ((c."occurrenceDate" + s."breakStart") AT TIME ZONE z.zone) AT TIME ZONE 'UTC',
    "breakEndAt"   = ((c."occurrenceDate" + s."breakEnd") AT TIME ZONE z.zone) AT TIME ZONE 'UTC'
FROM "TimetableSlot" s
CROSS JOIN LATERAL (
  SELECT COALESCE(
    (SELECT b."timezone" FROM "Branch" b WHERE b."id" = s."branchId"),
    (SELECT sc."timezone" FROM "School" sc WHERE sc."id" = s."schoolId"),
    'UTC'
  ) AS zone
) z
WHERE c."timetableSlotId" = s."id"
  AND c."occurrenceDate" IS NOT NULL
  AND c."endDate" > now()
  AND s."breakStart" IS NOT NULL
  AND s."breakEnd" IS NOT NULL
  AND c."startDate" = ((c."occurrenceDate" + s."startTime") AT TIME ZONE z.zone) AT TIME ZONE 'UTC';

-- The student-facing class card shows the break (ultm8_discovery reads Class by column).
GRANT SELECT ("breakStartAt", "breakEndAt") ON "Class" TO ultm8_discovery;
