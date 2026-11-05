-- Decision 316 item 3, as answered by Decision 435 items 1-6: a joining fee
-- on a plan. The School switches joining fees on or off for itself (off by
-- default; off keeps the amounts on the plans but charges none). A paid plan
-- can carry a one-off fee, added to a member's first-ever plan at the School
-- (never a rejoin or a renewal), with the plan's tax and card surcharge. The
-- owner sets whether the fee is refunded with the membership payment.

ALTER TABLE "School" ADD COLUMN "joiningFeesEnabled" BOOLEAN NOT NULL DEFAULT false;

-- MembershipPlan's existing grants and policies apply.
ALTER TABLE "MembershipPlan" ADD COLUMN "joiningFee" INTEGER,
ADD COLUMN "joiningFeeRefundable" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_joiningFee_positive" CHECK ("joiningFee" IS NULL OR "joiningFee" > 0);

-- The joining fee a first payment included, as part of its amount, and whether
-- it is refunded with the payment (copied from the plan when sold).
-- Transaction's existing grants and policies apply.
ALTER TABLE "Transaction" ADD COLUMN "joiningFeeAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "joiningFeeRefundable" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_joiningFeeAmount_valid" CHECK ("joiningFeeAmount" >= 0 AND "joiningFeeAmount" <= "amount");

-- The app's list of a School's plans shows the fee before the member buys.
GRANT SELECT ("joiningFee", "joiningFeeRefundable") ON "MembershipPlan" TO ultm8_discovery;
GRANT SELECT ("joiningFeesEnabled") ON "School" TO ultm8_discovery;
