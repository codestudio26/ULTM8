-- Decision 346: Transactions rows for Subscription renewals, late-cancellation
-- fees. (Who recorded a desk payment, Transaction.recordedById, came with
-- Decision 348's migration.)

CREATE TYPE "TransactionKind" AS ENUM ('MEMBERSHIP', 'RENEWAL', 'LATE_CANCEL_FEE');

-- A late-cancellation fee belongs to a Booking, not a plan.
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_membershipPlanId_fkey";
ALTER TABLE "Transaction" ADD COLUMN     "bookingId" TEXT,
ADD COLUMN     "kind" "TransactionKind" NOT NULL DEFAULT 'MEMBERSHIP',
ADD COLUMN     "stripeInvoiceId" TEXT,
ALTER COLUMN "membershipPlanId" DROP NOT NULL;

CREATE UNIQUE INDEX "Transaction_bookingId_key" ON "Transaction"("bookingId");
CREATE UNIQUE INDEX "Transaction_stripeInvoiceId_key" ON "Transaction"("stripeInvoiceId");

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_membershipPlanId_fkey" FOREIGN KEY ("membershipPlanId") REFERENCES "MembershipPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The stripe-webhook-processing job now writes a row for each renewal invoice.
GRANT INSERT ON "Transaction" TO ultm8_jobs;
CREATE POLICY "transaction_jobs_insert" ON "Transaction"
  FOR INSERT
  TO ultm8_jobs
  WITH CHECK (true);

-- Late-cancellation fees already charged before this change get their row now,
-- so the ledger matches the money the School received. A fee with no saved card
-- was never charged and gets no row.
INSERT INTO "Transaction" (
  "id", "schoolId", "studentId", "paymentAccountId", "membershipPlanId", "kind", "bookingId",
  "billingDate", "amount", "currency", "status", "paymentMethod", "stripePaymentIntentId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, b."schoolId", b."studentId", pa."id", NULL, 'LATE_CANCEL_FEE', b."id",
  b."updatedAt", b."cancellationChargeAmount", UPPER(COALESCE(mp."currency", 'USD')),
  CASE WHEN b."cancellationChargeOutcome" = 'CHARGED' THEN 'SUCCESSFUL'::"TransactionStatus" ELSE 'FAILED'::"TransactionStatus" END,
  'STRIPE', b."stripeCancellationPaymentIntentId", NOW(), NOW()
FROM "Booking" b
JOIN "PaymentAccount" pa ON pa."schoolId" = b."schoolId"
LEFT JOIN "Membership" m ON m."id" = b."sourceMembershipId"
LEFT JOIN "MembershipPlan" mp ON mp."id" = m."membershipPlanId"
WHERE b."cancellationChargeOutcome" IN ('CHARGED', 'FAILED')
  AND b."cancellationChargeAmount" IS NOT NULL
  AND (b."stripeCancellationPaymentIntentId" IS NULL
       OR NOT EXISTS (SELECT 1 FROM "Transaction" t WHERE t."stripePaymentIntentId" = b."stripeCancellationPaymentIntentId"));
