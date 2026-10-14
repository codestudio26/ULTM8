-- Decision 99's own follow-up — see FranchiseFeeRateChange's own schema comment
-- and FranchisesService.update()'s own header comment for the full account of
-- the gap this closes (Stripe Prices are immutable, so a rate change after
-- franchise-fee billing has started needs a real migration mechanism, not a
-- silent accept or an outright rejection forever).
--
-- RLS/GRANT shape mirrors MembershipPlanPriceChange's own single-tenant-side
-- decision-log table (20261111000001_membership_plan_archive_and_price_change)
-- rather than FranchiseFeeCharge's two-sided-OR shape — this table is Franchise
-- Owner-only (a rate-change decision belongs to the Franchise side alone, never
-- read/written by a School-side caller), same reasoning MembershipPlanPriceChange's
-- own comment gives for why it isn't modeled on PaymentAccount's two-sided shape
-- either.

-- CreateEnum
CREATE TYPE "FranchiseFeeRateChangeStrategy" AS ENUM ('MIGRATE_NEXT_CYCLE', 'MIGRATE_IMMEDIATE');

-- CreateEnum
CREATE TYPE "FranchiseFeeRateChangeStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "FranchiseFeeRateChange" (
    "id" TEXT NOT NULL,
    "franchiseId" TEXT NOT NULL,
    "feeModel" "FeeModel" NOT NULL,
    "oldFlatFeeAmount" INTEGER,
    "newFlatFeeAmount" INTEGER,
    "oldPerHeadcountRate" INTEGER,
    "newPerHeadcountRate" INTEGER,
    "strategy" "FranchiseFeeRateChangeStrategy" NOT NULL,
    "decidedById" TEXT NOT NULL,
    "status" "FranchiseFeeRateChangeStatus" NOT NULL DEFAULT 'PENDING',
    "affectedSchoolCount" INTEGER NOT NULL DEFAULT 0,
    "migratedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "FranchiseFeeRateChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FranchiseFeeRateChange_franchiseId_idx" ON "FranchiseFeeRateChange"("franchiseId");

-- AddForeignKey
ALTER TABLE "FranchiseFeeRateChange" ADD CONSTRAINT "FranchiseFeeRateChange_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "Franchise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseFeeRateChange" ADD CONSTRAINT "FranchiseFeeRateChange_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- No DELETE grant on either role — this row is never removed, same convention
-- as MembershipPlanPriceChange.
GRANT SELECT, INSERT, UPDATE ON "FranchiseFeeRateChange" TO ultm8_app;
GRANT SELECT, INSERT, UPDATE ON "FranchiseFeeRateChange" TO ultm8_jobs;

ALTER TABLE "FranchiseFeeRateChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FranchiseFeeRateChange" FORCE ROW LEVEL SECURITY;

-- ultm8_app side — Franchise Owner only (FranchisesService.update() is the only
-- writer, already gated on assertFranchiseOwner at the app layer; this is the
-- data-layer mirror of that same gate, same "RLS enforces the tenant boundary"
-- discipline every other Owner-gated table in this schema follows). No FOR
-- clause — applies to every command (SELECT/INSERT/UPDATE), and with no
-- separate WITH CHECK, Postgres uses this same USING expression for both reads
-- and writes, identical to membership_plan_price_change_tenant_isolation's own
-- shape.
CREATE POLICY "franchise_fee_rate_change_tenant_isolation" ON "FranchiseFeeRateChange"
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."franchiseId" = "FranchiseFeeRateChange"."franchiseId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."role" = 'FRANCHISE_OWNER'
        AND rg."revokedAt" IS NULL
    )
  );

-- ultm8_jobs needs full read/write — franchise-fee-rate-migration.processor.ts
-- is the only writer that ever advances status PENDING -> PROCESSING ->
-- COMPLETED/FAILED and sets migratedCount/failedCount/completedAt, and it has
-- no single caller to run under (same class of job as
-- membership-plan-price-migration.processor.ts). Same unrestricted-USING(true)
-- shape membership_plan_price_change_jobs_all already established.
CREATE POLICY "franchise_fee_rate_change_jobs_all" ON "FranchiseFeeRateChange"
  TO ultm8_jobs
  USING (true)
  WITH CHECK (true);
