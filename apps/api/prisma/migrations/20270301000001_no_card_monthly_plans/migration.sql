-- Decision 441 item 1: a monthly plan (SUBSCRIPTION) at a School that takes no
-- cards (Decisions 437/439) is billed to the member's balance each month. The
-- first month is a cash or bank-transfer payment staff confirm, as for any
-- plan there; each month after that is a normal charge made by a recurring
-- charge (Decision 412) tied to the membership.
--
-- No new grant or policy: Membership keeps its existing grants (the new column
-- is written where a Membership is created, under the same contexts as
-- today), and RecurringCharge is still written only on the jobs connection.

-- 1. The membership is billed to the balance (no Stripe Subscription).
ALTER TABLE "Membership" ADD COLUMN "billedToBalance" BOOLEAN NOT NULL DEFAULT false;
-- A balance-billed membership is never also a card Subscription.
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_billed_to_balance_check"
  CHECK (NOT ("billedToBalance" AND "stripeSubscriptionId" IS NOT NULL));
-- The charge-recurring job looks for balance-billed memberships whose series
-- is missing (a failure right after the sale): only those rows are indexed.
CREATE INDEX "Membership_billedToBalance_idx" ON "Membership"("schoolId") WHERE "billedToBalance";

-- 2. The series that bills it: at most one per membership.
ALTER TABLE "RecurringCharge" ADD COLUMN "membershipId" TEXT;
CREATE UNIQUE INDEX "RecurringCharge_membershipId_key" ON "RecurringCharge"("membershipId");
ALTER TABLE "RecurringCharge" ADD CONSTRAINT "RecurringCharge_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
