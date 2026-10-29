-- Check-in rules per School (Decision 394; Decision 317 item 1; front-desk
-- handover F9). Every default is what check-in did before, so nothing changes
-- until a School changes a rule.
ALTER TABLE "School"
  ADD COLUMN "checkInRequireWaiver" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "checkInOtherBranches" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "checkInVisitors" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "checkInSeveralClasses" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "checkInClosesMinutesAfterStart" INTEGER;

-- Who may change them besides the owners: Branch Staff the owner switches on.
-- StaffPermission's existing grants and policies apply.
ALTER TABLE "StaffPermission" ADD COLUMN "canManageCheckInRules" BOOLEAN NOT NULL DEFAULT false;
