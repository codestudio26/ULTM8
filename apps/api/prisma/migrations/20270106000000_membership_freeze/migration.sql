-- Decision 404 (backlog 3.4): freezing a membership.
--
-- Staff freeze a membership straight away; a member, or the Guardian for a
-- child, asks for one in the app and staff approve or decline it. Frozen is
-- not a stored status: a membership is frozen on a day an APPROVED freeze
-- covers it, worked out live, as expiry is (Decision 26).
ALTER TYPE "TransactionKind" ADD VALUE 'FREEZE_FEE';

CREATE TYPE "MembershipFreezeStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DECLINED', 'CANCELLED');

-- Each School's freezing settings: frozen members may check in (off by
-- default), the most days in any 12 months (default 90) and an optional fee.
ALTER TABLE "School" ADD COLUMN "checkInFrozenMembers" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "School" ADD COLUMN "freezeMaxDaysPer12Months" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "School" ADD COLUMN "freezeFeeAmount" INTEGER;
ALTER TABLE "School" ADD CONSTRAINT "School_freezeMaxDaysPer12Months_check" CHECK ("freezeMaxDaysPer12Months" BETWEEN 1 AND 365);
ALTER TABLE "School" ADD CONSTRAINT "School_freezeFeeAmount_check" CHECK ("freezeFeeAmount" IS NULL OR "freezeFeeAmount" > 0);

-- startsAt: the first frozen day. endsAt: the day the member is back
-- (exclusive). Both calendar days in the School's time zone.
CREATE TABLE "MembershipFreeze" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "startsAt" DATE NOT NULL,
    "endsAt" DATE NOT NULL,
    "status" "MembershipFreezeStatus" NOT NULL,
    "endedEarlyAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "feeAmount" INTEGER,
    "feeTransactionId" TEXT,
    "shiftedTrialEnd" TIMESTAMP(3),
    "billingShiftAppliedAt" TIMESTAMP(3),
    "restoredTrialEnd" TIMESTAMP(3),
    "billingRestoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipFreeze_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MembershipFreeze_dates_check" CHECK ("endsAt" > "startsAt")
);

CREATE INDEX "MembershipFreeze_membershipId_idx" ON "MembershipFreeze"("membershipId");
CREATE INDEX "MembershipFreeze_schoolId_status_idx" ON "MembershipFreeze"("schoolId", "status");
CREATE INDEX "MembershipFreeze_studentId_idx" ON "MembershipFreeze"("studentId");

ALTER TABLE "MembershipFreeze" ADD CONSTRAINT "MembershipFreeze_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipFreeze" ADD CONSTRAINT "MembershipFreeze_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipFreeze" ADD CONSTRAINT "MembershipFreeze_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipFreeze" ADD CONSTRAINT "MembershipFreeze_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MembershipFreeze" ADD CONSTRAINT "MembershipFreeze_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Read and written only on the jobs connection, after the API's own checks
-- (MembershipFreezesService), like SignUp and PackRecharge: a freeze is
-- decided by the owner, asked for by a member or a Guardian (who holds no
-- grant at the School), and read by booking and check-in in the member's
-- context, so no one tenant policy fits. ultm8_app gets nothing.
ALTER TABLE "MembershipFreeze" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MembershipFreeze" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "MembershipFreeze" TO ultm8_jobs;
CREATE POLICY "membership_freeze_jobs_all" ON "MembershipFreeze" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
