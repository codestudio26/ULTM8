-- Cancelling a membership's Pending cash or bank-transfer payment follows the
-- same rule as cancelling a charge (Decision 338 item 1, last point).
--
-- The status stays FAILED: Spec 55's five Transaction statuses are kept
-- (Decision 414 item 7). A row with "cancelledAt" set is shown as
-- Cancelled everywhere, with who cancelled it and the staff-only reason.
--
-- Written on the jobs connection only, after the caller's access was checked
-- (Branch Staff can't see Transaction rows under their own context);
-- Transaction's existing grants and RLS policies cover the new columns.
-- Rows cancelled before this change (Decision 339 set them FAILED with no
-- record of who or when) are left as they are: nothing says which FAILED
-- cash rows were cancelled rather than failed.

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelledById" TEXT,
ADD COLUMN "cancelReason" TEXT;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A cancelled payment is always a FAILED one, and only a cancelled one has a
-- canceller or a reason.
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_cancelled_check" CHECK (
  ("cancelledAt" IS NULL AND "cancelledById" IS NULL AND "cancelReason" IS NULL)
  OR ("cancelledAt" IS NOT NULL AND "status" = 'FAILED')
);
