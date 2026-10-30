-- Late fees (v1.3 backlog §3.7; Decision 413, which changes Decision 405 item 4).
--
-- 1. The School's setting. Off by default. Switching it on needs the owner's
--    tick "I confirm late fees are legal where my School operates" (no
--    Platform Admin limit). A fixed amount or a % of what is still owed, and
--    the grace days after the due date (0-30, default 3). ultm8_app already
--    has table-wide School grants under School's RLS; owner-only writes are
--    checked in LateFeesService, as for the card surcharge.
-- 2. A late fee is an ordinary Charge, linked to the one payment it is for:
--    an overdue charge, or a card renewal Stripe could not collect (a RENEWAL
--    Transaction). One per payment, ever: each link is unique, so the daily
--    late-fee job's reruns never double. Charge's existing grants and RLS
--    cover the new columns (written on the jobs connection only).

-- CreateEnum
CREATE TYPE "LateFeeType" AS ENUM ('FIXED', 'PERCENT');

-- AlterTable
ALTER TABLE "School" ADD COLUMN "lateFeeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lateFeeType" "LateFeeType" NOT NULL DEFAULT 'FIXED',
ADD COLUMN "lateFeeFixedAmount" INTEGER,
ADD COLUMN "lateFeePercentBps" INTEGER,
ADD COLUMN "lateFeeGraceDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "lateFeeEnabledAt" TIMESTAMP(3),
ADD COLUMN "lateFeeConfirmedAt" TIMESTAMP(3),
ADD COLUMN "lateFeeConfirmedById" TEXT;

ALTER TABLE "School" ADD CONSTRAINT "School_lateFee_check" CHECK (
  "lateFeeGraceDays" BETWEEN 0 AND 30
  AND ("lateFeeFixedAmount" IS NULL OR "lateFeeFixedAmount" BETWEEN 1 AND 99999999)
  AND ("lateFeePercentBps" IS NULL OR "lateFeePercentBps" BETWEEN 1 AND 10000)
  AND (
    NOT "lateFeeEnabled"
    OR (
      "lateFeeConfirmedAt" IS NOT NULL
      AND "lateFeeEnabledAt" IS NOT NULL
      AND CASE "lateFeeType" WHEN 'FIXED' THEN "lateFeeFixedAmount" IS NOT NULL ELSE "lateFeePercentBps" IS NOT NULL END
    )
  )
);

-- AlterTable
ALTER TABLE "Charge" ADD COLUMN "lateFeeForChargeId" TEXT,
ADD COLUMN "lateFeeForTransactionId" TEXT,
ADD COLUMN "lateFeeOverdueAmount" INTEGER,
ADD COLUMN "lateFeePercentBps" INTEGER,
ADD COLUMN "lateFeeWaived" BOOLEAN NOT NULL DEFAULT false;

-- A late fee is for one charge or one renewal, never both, never itself; it
-- records what was owed when it was worked out; only a cancelled late fee can
-- be marked waived.
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_lateFee_check" CHECK (
  NOT ("lateFeeForChargeId" IS NOT NULL AND "lateFeeForTransactionId" IS NOT NULL)
  AND ("lateFeeForChargeId" IS NULL OR "lateFeeForChargeId" <> "id")
  AND (("lateFeeForChargeId" IS NULL AND "lateFeeForTransactionId" IS NULL) = ("lateFeeOverdueAmount" IS NULL))
  AND ("lateFeeOverdueAmount" IS NULL OR "lateFeeOverdueAmount" > 0)
  AND ("lateFeePercentBps" IS NULL OR ("lateFeeOverdueAmount" IS NOT NULL AND "lateFeePercentBps" BETWEEN 1 AND 10000))
  AND (NOT "lateFeeWaived" OR ("lateFeeOverdueAmount" IS NOT NULL AND "cancelledAt" IS NOT NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "Charge_lateFeeForChargeId_key" ON "Charge"("lateFeeForChargeId");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_lateFeeForTransactionId_key" ON "Charge"("lateFeeForTransactionId");

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_lateFeeForChargeId_fkey" FOREIGN KEY ("lateFeeForChargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_lateFeeForTransactionId_fkey" FOREIGN KEY ("lateFeeForTransactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A late fee never gets its own late fee: a charge that is a late fee can't
-- be the payment another late fee is for. Enforced here as well as in the
-- job, since a CHECK can't look at another row.
CREATE FUNCTION "charge_late_fee_not_on_late_fee"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW."lateFeeForChargeId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."Charge" c
    WHERE c."id" = NEW."lateFeeForChargeId"
      AND (c."lateFeeForChargeId" IS NOT NULL OR c."lateFeeForTransactionId" IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'A late fee never gets its own late fee' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Charge_late_fee_not_on_late_fee"
  BEFORE INSERT OR UPDATE OF "lateFeeForChargeId" ON "Charge"
  FOR EACH ROW EXECUTE FUNCTION "charge_late_fee_not_on_late_fee"();
