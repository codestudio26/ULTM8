-- Decision 259 — see MembershipPlan.newMemberBillingStrategy's own schema comment.
-- CreateEnum
CREATE TYPE "NewMemberBillingStrategy" AS ENUM ('FRESH_CYCLE', 'PRORATED_TO_SHARED_CYCLE');

-- AlterTable
ALTER TABLE "MembershipPlan" ADD COLUMN     "billingCycleAnchorDay" INTEGER,
ADD COLUMN     "newMemberBillingStrategy" "NewMemberBillingStrategy" NOT NULL DEFAULT 'FRESH_CYCLE';
