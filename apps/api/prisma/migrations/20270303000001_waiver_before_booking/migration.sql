-- Decision 441 item 5: "Waiver must be signed before booking or check-in", a
-- School setting, on by default. It reuses the check-in rule that already
-- asked for a signed waiver at check-in (Decision 394): the same column now
-- also stops booking a class, joining its waiting list and claiming an
-- offered place. A School with no waiver in use blocks nobody.
--
-- "On by default" covers every School, including those that already exist:
-- they are all switched on here. The owner can switch it off again on
-- Check-in rules.
ALTER TABLE "School" ALTER COLUMN "checkInRequireWaiver" SET DEFAULT true;
UPDATE "School" SET "checkInRequireWaiver" = true WHERE "checkInRequireWaiver" = false;
