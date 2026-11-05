-- Decision 430 (stress test round 5, MON-8): refunding a membership sold at
-- the desk (cash, Pix, bank transfer or the card terminal). Owner only, part
-- or full, with a note; the money is given back by hand, so only the records
-- change. Each refund is a row here; the payment's Transaction.refundedAmount
-- goes up by the same amount (Refunded once all of it is back), and the
-- owner chooses whether the membership ends (endedMembership).
--
-- No studentId column on purpose: the member is the Transaction's, so merging
-- a duplicate member (MemberMergeService) moves it with the Transaction.
--
-- RLS: the owner reads; only the jobs connection writes, append-only, as
-- ChargeRefund (migration 20270114000000_charges_refunds_reports). The notes
-- are for staff only.

CREATE TABLE IF NOT EXISTS "DeskSaleRefund" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "endedMembership" BOOLEAN NOT NULL DEFAULT false,
    "refundedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeskSaleRefund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DeskSaleRefund_amount_positive" CHECK ("amount" > 0)
);

CREATE INDEX IF NOT EXISTS "DeskSaleRefund_schoolId_idx" ON "DeskSaleRefund"("schoolId");
CREATE INDEX IF NOT EXISTS "DeskSaleRefund_transactionId_idx" ON "DeskSaleRefund"("transactionId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeskSaleRefund_schoolId_fkey') THEN
    ALTER TABLE "DeskSaleRefund" ADD CONSTRAINT "DeskSaleRefund_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeskSaleRefund_transactionId_fkey') THEN
    ALTER TABLE "DeskSaleRefund" ADD CONSTRAINT "DeskSaleRefund_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeskSaleRefund_refundedById_fkey') THEN
    ALTER TABLE "DeskSaleRefund" ADD CONSTRAINT "DeskSaleRefund_refundedById_fkey" FOREIGN KEY ("refundedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "DeskSaleRefund" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeskSaleRefund" FORCE ROW LEVEL SECURITY;

GRANT SELECT ON "DeskSaleRefund" TO ultm8_app;
DROP POLICY IF EXISTS "desk_sale_refund_owner_read" ON "DeskSaleRefund";
CREATE POLICY "desk_sale_refund_owner_read" ON "DeskSaleRefund" FOR SELECT TO ultm8_app
  USING (is_active_school_owner_manager("DeskSaleRefund"."schoolId"));

-- Append-only: no UPDATE or DELETE for anyone.
GRANT SELECT, INSERT ON "DeskSaleRefund" TO ultm8_jobs;
DROP POLICY IF EXISTS "desk_sale_refund_jobs_all" ON "DeskSaleRefund";
CREATE POLICY "desk_sale_refund_jobs_all" ON "DeskSaleRefund" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
