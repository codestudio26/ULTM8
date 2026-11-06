-- Decision 316 item 4, as answered by Decision 435 items 7-9: when a plan's
-- membership starts and ends, and what happens at its end.
--   7. A Class Pack, Weekly Pass or Trial can start on the member's first
--      check-in with it (no end date until then).
--   8. A one-off plan can run on fixed dates (a 6-week camp): bought before
--      or after it starts, at full price, never once it is over.
--   9. A plan can switch to another one when it ends, if the member agreed
--      when buying: told before, charged to their saved card, else it ends.
-- MembershipPlan's, Membership's and Transaction's existing grants and
-- policies apply to the new columns.

CREATE TYPE "PlanSwitchOutcome" AS ENUM ('SWITCHED', 'NO_CARD', 'DECLINED', 'NOT_SOLD');

ALTER TABLE "MembershipPlan" ADD COLUMN "startsOnFirstCheckIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "fixedStartDate" DATE,
ADD COLUMN "fixedEndDate" DATE,
ADD COLUMN "switchToPlanId" TEXT;

ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_fixedDates_valid" CHECK (
  ("fixedStartDate" IS NULL) = ("fixedEndDate" IS NULL)
  AND ("fixedEndDate" IS NULL OR "fixedEndDate" >= "fixedStartDate")
);
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_switchToPlanId_not_itself" CHECK ("switchToPlanId" IS NULL OR "switchToPlanId" <> "id");
-- Deleting the next plan (only an unused plan can be) leaves this one ending.
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_switchToPlanId_fkey" FOREIGN KEY ("switchToPlanId") REFERENCES "MembershipPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Membership" ADD COLUMN "awaitingFirstCheckIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "switchToPlanId" TEXT,
ADD COLUMN "switchAgreedAt" TIMESTAMP(3),
ADD COLUMN "switchNoticeSentAt" TIMESTAMP(3),
ADD COLUMN "switchedAt" TIMESTAMP(3),
ADD COLUMN "switchOutcome" "PlanSwitchOutcome",
ADD COLUMN "switchedToMembershipId" TEXT;

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_switchToPlanId_fkey" FOREIGN KEY ("switchToPlanId") REFERENCES "MembershipPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- The hourly switch job looks for memberships the member agreed to switch.
CREATE INDEX "Membership_switch_due_idx" ON "Membership"("expiryDate") WHERE "switchToPlanId" IS NOT NULL AND "switchedAt" IS NULL;

-- The switch a member agreed to with a pending payment, copied onto the
-- Membership the payment creates.
ALTER TABLE "Transaction" ADD COLUMN "planSwitchToPlanId" TEXT;

-- The app's list of a School's plans shows a plan's start and end, and the
-- plan it can switch to.
GRANT SELECT ("startsOnFirstCheckIn", "fixedStartDate", "fixedEndDate", "switchToPlanId") ON "MembershipPlan" TO ultm8_discovery;
