-- How many minutes before a Class starts its check-in opens (product owner,
-- 26 Oct 2026). Found by the booking/schedule stress test: check-in had a closing
-- time but no opening time, so a Student could be checked into a Class a week
-- early and the attendance counted toward grading. Set per School; 30 by default.
ALTER TABLE "School" ADD COLUMN "checkInOpensMinutesBeforeStart" INTEGER NOT NULL DEFAULT 30;

-- What a Student gets back when cancelling after the Class has started, when the
-- Class has no refund cut-off of its own (product owner, 26 Oct 2026: a School
-- setting, default "no refund once started"). Before this, credit always came back,
-- even after the Class ended, until the no-show sweep ran.
CREATE TYPE "LateCancelRefundPolicy" AS ENUM ('NO_REFUND_ONCE_STARTED', 'REFUND_UNTIL_END', 'ALWAYS_REFUND');
ALTER TABLE "School" ADD COLUMN "lateCancelRefundPolicy" "LateCancelRefundPolicy" NOT NULL DEFAULT 'NO_REFUND_ONCE_STARTED';
