-- "No tax on this item (0% or exempt)" (Decision 414 item 5; v1.3 backlog
-- §3.6): tax applies to every charge unless it doesn't apply to the item
-- (e.g. children's clothing is 0% VAT in the UK). Staff creating a one-off or
-- recurring charge can tick it, off by default; the invoice then shows no tax.
--
-- 1. Charge.taxExempt: the charge was made with the tick. Its tax snapshot is
--    then a rate of 0 and a tax of 0, so the price excluding tax and the price
--    including tax are both the price after any discount, whether the School
--    prices with tax included or added on top. The School's country and its
--    inclusive/added-on-top setting are still kept as they were, as on every
--    charge. Existing charges were all made with tax: false.
-- 2. A late fee or a promotion fee is never tax-exempt: they always take the
--    School's tax settings (Decisions 411, 413, 414 item 5).
-- 3. RecurringCharge.taxExempt: every occurrence of a series set up with the
--    tick is made tax-exempt (written by the occurrence code; a series can't
--    be edited, Decision 412).
--
-- Both columns are written on the jobs connection only, like every other
-- column of these tables; their existing grants and RLS cover them.

-- AlterTable
ALTER TABLE "Charge" ADD COLUMN "taxExempt" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RecurringCharge" ADD COLUMN "taxExempt" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Charge" ADD CONSTRAINT "Charge_taxExempt_check" CHECK (
  NOT "taxExempt"
  OR (
    "taxRateBasisPoints" = 0
    AND "taxAmount" = 0
    AND "netAmount" = "grossAmount"
    AND "lateFeeForChargeId" IS NULL
    AND "lateFeeForTransactionId" IS NULL
    AND "promotionFeeRequestId" IS NULL
  )
);
