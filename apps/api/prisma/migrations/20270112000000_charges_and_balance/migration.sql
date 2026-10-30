-- Staff-created charges and the member balance, step 1 of 6 (v1.3 backlog
-- §3.6; Decisions 303, 338, 411).
--
-- 1. The School's tax settings (Decision 411): its country, one rate in
--    hundredths of a percent, and whether its prices include tax; its tax ID
--    for receipts (Decision 338 item 6); and whether a reason is required
--    when cancelling a charge (Decision 338 item 1, on by default).
-- 2. Two per-person switches on StaffPermission: "Can create charges" (null
--    = the role's default: on for Branch Staff, off for Instructors, Decision
--    303 item 3) and "Can cancel charges" (off, Decision 338 item 1).
-- 3. Charge: one row per charge, with its invoice number (per School, no
--    gaps, Decision 338 item 4) and a copy of the tax it was created with.
--    Never deleted.
-- 4. BalanceEntry: the balance as a ledger (Decision 303 item 2). Its sum is
--    the balance: positive = owes, negative = in credit.
-- 5. ChargeAllocation: which money (a desk payment, or credit) went toward
--    which charge.
-- 6. Desk payments are Transaction rows of the new kind CHARGE_PAYMENT, so
--    the Transactions page, its CSV and its revenue tiles include them.
--
-- RLS: the three new tables are written only on the jobs connection, after
-- the API's own checks (as MembershipFreeze and PackRecharge are): a desk
-- payment also writes a Transaction, which Branch Staff can't write under
-- their own context (Spec 55 §8.2), and every write updates the ledger and the
-- charge together. ultm8_app only reads them: the School owner, staff who
-- cover the student (the grading board's rule, as
-- promotion_fee_request_staff_read), the student, and an active Guardian.

-- CreateEnum
CREATE TYPE "ChargeDiscountType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "BalanceEntryKind" AS ENUM ('CHARGE', 'CHARGE_CANCELLED', 'PAYMENT');

-- AlterEnum
ALTER TYPE "TransactionKind" ADD VALUE 'CHARGE_PAYMENT';

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "chargeCancelReasonRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "taxCountry" TEXT,
ADD COLUMN     "taxId" TEXT,
ADD COLUMN     "taxInclusive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "taxRateBasisPoints" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "School" ADD CONSTRAINT "School_taxRateBasisPoints_check" CHECK ("taxRateBasisPoints" BETWEEN 0 AND 10000);

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "chargeId" TEXT;

-- AlterTable
ALTER TABLE "StaffPermission" ADD COLUMN     "canCancelCharges" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canCreateCharges" BOOLEAN;

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "invoiceNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "unitAmount" INTEGER NOT NULL,
    "discountType" "ChargeDiscountType",
    "discountValue" INTEGER,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "taxCountry" TEXT,
    "taxRateBasisPoints" INTEGER NOT NULL,
    "taxInclusive" BOOLEAN NOT NULL,
    "netAmount" INTEGER NOT NULL,
    "taxAmount" INTEGER NOT NULL,
    "grossAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "createdById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Charge_invoiceNumber_positive" CHECK ("invoiceNumber" > 0),
    CONSTRAINT "Charge_amounts_check" CHECK (
      "unitAmount" > 0 AND "discountAmount" >= 0 AND "discountAmount" < "unitAmount"
      AND "taxAmount" >= 0 AND "netAmount" > 0 AND "grossAmount" = "netAmount" + "taxAmount"
    ),
    CONSTRAINT "Charge_tax_rate_check" CHECK ("taxRateBasisPoints" BETWEEN 0 AND 10000)
);

-- CreateTable
CREATE TABLE "ChargeAllocation" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargeAllocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChargeAllocation_amount_positive" CHECK ("amount" > 0)
);

-- CreateTable
CREATE TABLE "BalanceEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "kind" "BalanceEntryKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "chargeId" TEXT,
    "transactionId" TEXT,
    "paymentMethod" "PaymentAccountProvider",
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BalanceEntry_sign_check" CHECK (
      ("kind" = 'CHARGE' AND "amount" > 0 AND "chargeId" IS NOT NULL)
      OR ("kind" = 'CHARGE_CANCELLED' AND "amount" < 0 AND "chargeId" IS NOT NULL)
      OR ("kind" = 'PAYMENT' AND "amount" < 0 AND "transactionId" IS NOT NULL)
    )
);

-- CreateIndex
CREATE INDEX "Charge_schoolId_studentId_idx" ON "Charge"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "Charge_studentId_idx" ON "Charge"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_schoolId_invoiceNumber_key" ON "Charge"("schoolId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "ChargeAllocation_schoolId_studentId_idx" ON "ChargeAllocation"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "ChargeAllocation_chargeId_idx" ON "ChargeAllocation"("chargeId");

-- CreateIndex
CREATE INDEX "ChargeAllocation_transactionId_idx" ON "ChargeAllocation"("transactionId");

-- CreateIndex
CREATE INDEX "BalanceEntry_schoolId_studentId_idx" ON "BalanceEntry"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "BalanceEntry_chargeId_idx" ON "BalanceEntry"("chargeId");

-- CreateIndex
CREATE INDEX "Transaction_chargeId_idx" ON "Transaction"("chargeId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeAllocation" ADD CONSTRAINT "ChargeAllocation_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeAllocation" ADD CONSTRAINT "ChargeAllocation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeAllocation" ADD CONSTRAINT "ChargeAllocation_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeAllocation" ADD CONSTRAINT "ChargeAllocation_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceEntry" ADD CONSTRAINT "BalanceEntry_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceEntry" ADD CONSTRAINT "BalanceEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceEntry" ADD CONSTRAINT "BalanceEntry_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceEntry" ADD CONSTRAINT "BalanceEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceEntry" ADD CONSTRAINT "BalanceEntry_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE "Charge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Charge" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ChargeAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChargeAllocation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "BalanceEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BalanceEntry" FORCE ROW LEVEL SECURITY;

-- ultm8_app reads only. No INSERT, UPDATE or DELETE: every write goes through
-- the jobs connection after the API's checks, and nothing is ever deleted.
GRANT SELECT ON "Charge" TO ultm8_app;
GRANT SELECT ON "ChargeAllocation" TO ultm8_app;
GRANT SELECT ON "BalanceEntry" TO ultm8_app;

-- The School owner/manager: every row of their School.
CREATE POLICY "charge_owner_read" ON "Charge" FOR SELECT TO ultm8_app
  USING (is_active_school_owner_manager("Charge"."schoolId"));
CREATE POLICY "charge_allocation_owner_read" ON "ChargeAllocation" FOR SELECT TO ultm8_app
  USING (is_active_school_owner_manager("ChargeAllocation"."schoolId"));
CREATE POLICY "balance_entry_owner_read" ON "BalanceEntry" FOR SELECT TO ultm8_app
  USING (is_active_school_owner_manager("BalanceEntry"."schoolId"));

-- The student: their own rows.
CREATE POLICY "charge_student_self_read" ON "Charge" FOR SELECT TO ultm8_app
  USING ("Charge"."studentId" = current_setting('app.current_user_id', true));
CREATE POLICY "charge_allocation_student_self_read" ON "ChargeAllocation" FOR SELECT TO ultm8_app
  USING ("ChargeAllocation"."studentId" = current_setting('app.current_user_id', true));
CREATE POLICY "balance_entry_student_self_read" ON "BalanceEntry" FOR SELECT TO ultm8_app
  USING ("BalanceEntry"."studentId" = current_setting('app.current_user_id', true));

-- An active Guardian: their linked child's rows (Decision 303 item 4: the
-- Guardian pays for a child).
CREATE POLICY "charge_guardian_read" ON "Charge" FOR SELECT TO ultm8_app
  USING (EXISTS (
    SELECT 1 FROM "GuardianLink" gl
    WHERE gl."guardianId" = current_setting('app.current_user_id', true)
      AND gl."studentId" = "Charge"."studentId"
      AND gl."revokedAt" IS NULL
  ));
CREATE POLICY "charge_allocation_guardian_read" ON "ChargeAllocation" FOR SELECT TO ultm8_app
  USING (EXISTS (
    SELECT 1 FROM "GuardianLink" gl
    WHERE gl."guardianId" = current_setting('app.current_user_id', true)
      AND gl."studentId" = "ChargeAllocation"."studentId"
      AND gl."revokedAt" IS NULL
  ));
CREATE POLICY "balance_entry_guardian_read" ON "BalanceEntry" FOR SELECT TO ultm8_app
  USING (EXISTS (
    SELECT 1 FROM "GuardianLink" gl
    WHERE gl."guardianId" = current_setting('app.current_user_id', true)
      AND gl."studentId" = "BalanceEntry"."studentId"
      AND gl."revokedAt" IS NULL
  ));

-- Staff who cover the student (Decisions 168, 169, 303 item 3: "Branch Staff,
-- for students of their own branches"): in a School with no branches every
-- staff member; otherwise staff assigned to the student's home branch. The
-- API narrows this further to those with a charges switch (or the School's
-- desk-payment switch) before it reads anything.
CREATE POLICY "charge_staff_read" ON "Charge" FOR SELECT TO ultm8_app
  USING (
    is_staff_of_school_without_branches("Charge"."schoolId")
    OR EXISTS (
      SELECT 1
      FROM "StudentHomeBranch" h
      JOIN "RoleGrant" rg ON rg."branchId" = h."branchId"
      WHERE h."schoolId" = "Charge"."schoolId"
        AND h."studentId" = "Charge"."studentId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."schoolId" = "Charge"."schoolId"
        AND rg."role" IN ('INSTRUCTOR', 'BRANCH_STAFF')
        AND rg."revokedAt" IS NULL
    )
  );
CREATE POLICY "charge_allocation_staff_read" ON "ChargeAllocation" FOR SELECT TO ultm8_app
  USING (
    is_staff_of_school_without_branches("ChargeAllocation"."schoolId")
    OR EXISTS (
      SELECT 1
      FROM "StudentHomeBranch" h
      JOIN "RoleGrant" rg ON rg."branchId" = h."branchId"
      WHERE h."schoolId" = "ChargeAllocation"."schoolId"
        AND h."studentId" = "ChargeAllocation"."studentId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."schoolId" = "ChargeAllocation"."schoolId"
        AND rg."role" IN ('INSTRUCTOR', 'BRANCH_STAFF')
        AND rg."revokedAt" IS NULL
    )
  );
CREATE POLICY "balance_entry_staff_read" ON "BalanceEntry" FOR SELECT TO ultm8_app
  USING (
    is_staff_of_school_without_branches("BalanceEntry"."schoolId")
    OR EXISTS (
      SELECT 1
      FROM "StudentHomeBranch" h
      JOIN "RoleGrant" rg ON rg."branchId" = h."branchId"
      WHERE h."schoolId" = "BalanceEntry"."schoolId"
        AND h."studentId" = "BalanceEntry"."studentId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."schoolId" = "BalanceEntry"."schoolId"
        AND rg."role" IN ('INSTRUCTOR', 'BRANCH_STAFF')
        AND rg."revokedAt" IS NULL
    )
  );

-- ultm8_jobs writes, after the API's own checks. Charge needs UPDATE only to
-- cancel; the ledger tables are append-only. No DELETE for anyone.
GRANT SELECT, INSERT, UPDATE ON "Charge" TO ultm8_jobs;
GRANT SELECT, INSERT ON "ChargeAllocation" TO ultm8_jobs;
GRANT SELECT, INSERT ON "BalanceEntry" TO ultm8_jobs;
CREATE POLICY "charge_jobs_all" ON "Charge" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
CREATE POLICY "charge_allocation_jobs_all" ON "ChargeAllocation" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
CREATE POLICY "balance_entry_jobs_all" ON "BalanceEntry" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
