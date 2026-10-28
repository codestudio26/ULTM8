-- Memberships follow-ups (Decision 348): a Subscription cancelled by the
-- Student or the owner runs to the end of its paid period. These record when
-- it ends and who asked. Additive only.
ALTER TABLE "Membership" ADD COLUMN "cancelAt" TIMESTAMP(3);
ALTER TABLE "Membership" ADD COLUMN "cancelledById" TEXT;

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A desk sale can also be paid by Pix or on the School's own card terminal
-- (Decision 338 lists both for desk payments; product owner's yes, 26 Oct).
ALTER TYPE "PaymentAccountProvider" ADD VALUE 'PIX';
ALTER TYPE "PaymentAccountProvider" ADD VALUE 'CARD_TERMINAL';

-- Who recorded a payment taken at the desk. Same column as the Transactions
-- follow-ups use; whichever lands second drops its own copy.
ALTER TABLE "Transaction" ADD COLUMN "recordedById" TEXT;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
