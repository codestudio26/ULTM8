-- Paying a promotion fee as a charge (v1.3 backlog §3.6 step 6; Decision 303
-- item 5: "An accepted promotion fee (Decision 300) is one of these charges,
-- paid the same way").
--
-- 1. A Charge can be the charge of one promotion fee request. The link is
--    unique, so a request never gets two charges (accepting twice, or the
--    daily catch-up running alongside an accept, can't double it). Written on
--    the jobs connection only, like every other Charge column; Charge's
--    existing grants and RLS cover it.
-- 2. A promotion fee charge is never a late fee or a recurring occurrence, and
--    always belongs to the same School and student as its request (a trigger,
--    since a CHECK can't look at another row).
--
-- Existing ACCEPTED requests (accepted before this change, with no way to pay)
-- are NOT given their charges here. A charge needs the shared insertCharge()
-- (the per-School invoice-number lock, the tax maths of charge-maths.ts, the
-- member's credit put on it at once) and, when credit pays it in full, the
-- waiting promotion applied through the grading code, none of which SQL can do
-- the same way. The deploy runs only `prisma migrate deploy`, so there is no
-- one-off script step either. Instead the daily charge-auto-pay job starts by
-- catching up promotion fees (PromotionFeeService.reconcile()): it makes the
-- missing charge of every ACCEPTED request, through the same code as an
-- accept. The first run after this deploy makes them; later runs find none.

-- AlterTable
ALTER TABLE "Charge" ADD COLUMN "promotionFeeRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Charge_promotionFeeRequestId_key" ON "Charge"("promotionFeeRequestId");

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_promotionFeeRequestId_fkey" FOREIGN KEY ("promotionFeeRequestId") REFERENCES "PromotionFeeRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Charge" ADD CONSTRAINT "Charge_promotionFee_check" CHECK (
  "promotionFeeRequestId" IS NULL
  OR ("lateFeeForChargeId" IS NULL AND "lateFeeForTransactionId" IS NULL AND "recurringChargeId" IS NULL)
);

CREATE FUNCTION "charge_promotion_fee_same_owner"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW."promotionFeeRequestId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public."PromotionFeeRequest" r
    WHERE r."id" = NEW."promotionFeeRequestId"
      AND r."schoolId" = NEW."schoolId"
      AND r."studentId" = NEW."studentId"
  ) THEN
    RAISE EXCEPTION 'A promotion fee charge belongs to the School and student of its request' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Charge_promotion_fee_same_owner"
  BEFORE INSERT OR UPDATE OF "promotionFeeRequestId", "schoolId", "studentId" ON "Charge"
  FOR EACH ROW EXECUTE FUNCTION "charge_promotion_fee_same_owner"();
