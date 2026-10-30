-- Charges and the member balance, step 2 of 6: paying in the app (v1.3
-- backlog §3.6; Decision 303 item 4, Decision 338 item 8).
--
-- 1. Transaction.chargePaymentChannel: how a CHARGE_PAYMENT was paid. DESK
--    (taken by staff, step 1), APP (the member or Guardian paid by card on a
--    hosted Stripe Checkout) or AUTOMATIC (the member's saved card, charged by
--    the daily charge-auto-pay job on the due date). Desk rows from step 1 are
--    set to DESK.
-- 2. One automatic attempt per charge: a partial unique index, so two runs of
--    the job (or two API instances) can never charge the same charge twice.
-- 3. StudentPaymentMethod.autoPayCharges: the member's "Pay charges
--    automatically with my saved card" switch, off by default. It lives on the
--    saved card itself, so removing the card turns it off. The table's
--    existing self-only RLS covers it (only the member reads and changes it;
--    the job reads it on the jobs connection).

-- CreateEnum
CREATE TYPE "ChargePaymentChannel" AS ENUM ('DESK', 'APP', 'AUTOMATIC');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "chargePaymentChannel" "ChargePaymentChannel";

-- AlterTable
ALTER TABLE "StudentPaymentMethod" ADD COLUMN "autoPayCharges" BOOLEAN NOT NULL DEFAULT false;

-- Step 1's desk payments.
UPDATE "Transaction" SET "chargePaymentChannel" = 'DESK' WHERE "kind" = 'CHARGE_PAYMENT';

-- One automatic attempt per charge, ever (the job never retries a charge it
-- has tried; the member pays it in the app or at the desk instead).
CREATE UNIQUE INDEX "Transaction_one_auto_pay_attempt_per_charge"
  ON "Transaction"("chargeId") WHERE "chargePaymentChannel" = 'AUTOMATIC';
