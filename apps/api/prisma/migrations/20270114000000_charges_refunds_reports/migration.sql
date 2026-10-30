-- Charges and the member balance, step 4 of 6: refunds, owner-given credit,
-- reports, payment notification switches, invoice resend and receipt details
-- (v1.3 backlog §3.6; Decision 303 item 3, Decision 338 items 3, 5, 6, 10, 11).
--
-- 1. ChargeRefund: one row per refund of a payment toward charges (owner only).
--    Its kind is CARD (back to the card through Stripe), MONEY_BACK (a cash,
--    Pix, bank-transfer or card-terminal payment given back; records only),
--    CREDIT (onto the balance as credit), DISPUTE_LOST (a lost dispute on a
--    card payment) or STRIPE (a refund made in the Stripe dashboard).
-- 2. The ledger rules (charge-ledger.ts):
--    - a refund taken off a charge: a negative ChargeAllocation (the money
--      leaves that charge), Charge.refundedAmount goes up by the same amount
--      and a CHARGE_REDUCED BalanceEntry (−), so the charge is never re-opened;
--    - money given back (CARD, MONEY_BACK, DISPUTE_LOST, STRIPE): also a REFUND
--      BalanceEntry (+ the whole refund);
--    - a refund as CREDIT has no REFUND row: the charge's total goes down and
--      the money stays as credit;
--    - owner-given credit: a CREDIT_GIVEN BalanceEntry (−) with a staff-only note.
--    The new enum values are compared as text in the CHECK below: a value
--    added by ALTER TYPE can't be used as an enum literal in the same
--    transaction.
-- 3. School: "Notes required when refunding" (on by default), the address and
--    payment instructions for receipts, and three payment notification
--    switches, each on by default (receipt; failed or overdue; dispute).
-- 4. Charge.overdueNoticeAt: the daily charge-overdue-notice job's
--    once-per-charge marker; Charge.dueReminderAt and
--    School.chargeNoticeDueReminder: the "Payment due soon" reminder, 3 days
--    before the due date (product owner, 30 Oct 2026), on by default.
--
-- RLS: ChargeRefund is read like Charge (owner, covering staff, the student,
-- an active Guardian) and written only on the jobs connection. Its notes are
-- staff only; the API never sends them to the member.

-- CreateEnum
CREATE TYPE "ChargeRefundKind" AS ENUM ('CARD', 'MONEY_BACK', 'CREDIT', 'DISPUTE_LOST', 'STRIPE');

-- AlterEnum
ALTER TYPE "BalanceEntryKind" ADD VALUE 'REFUND';
ALTER TYPE "BalanceEntryKind" ADD VALUE 'CHARGE_REDUCED';
ALTER TYPE "BalanceEntryKind" ADD VALUE 'CREDIT_GIVEN';

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "chargeNoticeDispute" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "chargeNoticeFailedOverdue" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "chargeNoticeReceipt" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "chargeNoticeDueReminder" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "chargeRefundNotesRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "receiptAddress" TEXT,
ADD COLUMN     "receiptPaymentInstructions" TEXT;

-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "overdueNoticeAt" TIMESTAMP(3),
ADD COLUMN     "dueReminderAt" TIMESTAMP(3),
ADD COLUMN     "refundedAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_refunded_check" CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= "grossAmount");

-- AlterTable
ALTER TABLE "ChargeAllocation" ADD COLUMN     "refundId" TEXT;
ALTER TABLE "ChargeAllocation" DROP CONSTRAINT "ChargeAllocation_amount_positive";
ALTER TABLE "ChargeAllocation" ADD CONSTRAINT "ChargeAllocation_amount_check" CHECK (
  ("refundId" IS NULL AND "amount" > 0) OR ("refundId" IS NOT NULL AND "amount" < 0 AND "transactionId" IS NOT NULL)
);

-- AlterTable
ALTER TABLE "BalanceEntry" ADD COLUMN     "note" TEXT,
ADD COLUMN     "refundId" TEXT;
ALTER TABLE "BalanceEntry" DROP CONSTRAINT "BalanceEntry_sign_check";
ALTER TABLE "BalanceEntry" ADD CONSTRAINT "BalanceEntry_sign_check" CHECK (
  ("kind"::text = 'CHARGE' AND "amount" > 0 AND "chargeId" IS NOT NULL)
  OR ("kind"::text = 'CHARGE_CANCELLED' AND "amount" < 0 AND "chargeId" IS NOT NULL)
  OR ("kind"::text = 'PAYMENT' AND "amount" < 0 AND "transactionId" IS NOT NULL)
  OR ("kind"::text = 'REFUND' AND "amount" > 0 AND "transactionId" IS NOT NULL AND "refundId" IS NOT NULL)
  OR ("kind"::text = 'CHARGE_REDUCED' AND "amount" < 0 AND "chargeId" IS NOT NULL AND "refundId" IS NOT NULL)
  OR ("kind"::text = 'CREDIT_GIVEN' AND "amount" < 0 AND "note" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "ChargeRefund" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "kind" "ChargeRefundKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "notes" TEXT,
    "refundedById" TEXT,
    "stripeRefundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargeRefund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChargeRefund_amount_positive" CHECK ("amount" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "ChargeRefund_stripeRefundId_key" ON "ChargeRefund"("stripeRefundId");

-- CreateIndex
CREATE INDEX "ChargeRefund_schoolId_studentId_idx" ON "ChargeRefund"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "ChargeRefund_transactionId_idx" ON "ChargeRefund"("transactionId");

-- AddForeignKey
ALTER TABLE "ChargeAllocation" ADD CONSTRAINT "ChargeAllocation_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "ChargeRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceEntry" ADD CONSTRAINT "BalanceEntry_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "ChargeRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRefund" ADD CONSTRAINT "ChargeRefund_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRefund" ADD CONSTRAINT "ChargeRefund_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRefund" ADD CONSTRAINT "ChargeRefund_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeRefund" ADD CONSTRAINT "ChargeRefund_refundedById_fkey" FOREIGN KEY ("refundedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security: as Charge (migration 20270112000000_charges_and_balance)
-- ---------------------------------------------------------------------------

ALTER TABLE "ChargeRefund" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChargeRefund" FORCE ROW LEVEL SECURITY;

GRANT SELECT ON "ChargeRefund" TO ultm8_app;

CREATE POLICY "charge_refund_owner_read" ON "ChargeRefund" FOR SELECT TO ultm8_app
  USING (is_active_school_owner_manager("ChargeRefund"."schoolId"));

CREATE POLICY "charge_refund_student_self_read" ON "ChargeRefund" FOR SELECT TO ultm8_app
  USING ("ChargeRefund"."studentId" = current_setting('app.current_user_id', true));

CREATE POLICY "charge_refund_guardian_read" ON "ChargeRefund" FOR SELECT TO ultm8_app
  USING (EXISTS (
    SELECT 1 FROM "GuardianLink" gl
    WHERE gl."guardianId" = current_setting('app.current_user_id', true)
      AND gl."studentId" = "ChargeRefund"."studentId"
      AND gl."revokedAt" IS NULL
  ));

CREATE POLICY "charge_refund_staff_read" ON "ChargeRefund" FOR SELECT TO ultm8_app
  USING (
    is_staff_of_school_without_branches("ChargeRefund"."schoolId")
    OR EXISTS (
      SELECT 1
      FROM "StudentHomeBranch" h
      JOIN "RoleGrant" rg ON rg."branchId" = h."branchId"
      WHERE h."schoolId" = "ChargeRefund"."schoolId"
        AND h."studentId" = "ChargeRefund"."studentId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."schoolId" = "ChargeRefund"."schoolId"
        AND rg."role" IN ('INSTRUCTOR', 'BRANCH_STAFF')
        AND rg."revokedAt" IS NULL
    )
  );

-- Append-only: no UPDATE or DELETE for anyone.
GRANT SELECT, INSERT ON "ChargeRefund" TO ultm8_jobs;
CREATE POLICY "charge_refund_jobs_all" ON "ChargeRefund" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
