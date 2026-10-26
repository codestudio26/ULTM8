-- Decision 292 — each Branch may override its School's "Class cancellations"
-- settings (Decision 291), and every owner chooses their own policy.

ALTER TABLE "Branch"
  ADD COLUMN "cancellationSettingsOverride" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "classCancellationPolicy" "ClassCancellationPolicy" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "classCancellationPolicyWindow" "ClassCancellationPolicyWindow" NOT NULL DEFAULT 'BEFORE_CUTOFF',
  ADD COLUMN "chargeLateCancellationFee" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "schoolCancelledClassResolution" "SchoolCancelledClassResolution" NOT NULL DEFAULT 'CREDIT_ALL',
  ADD COLUMN "defaultRefundCutoffHours" INTEGER,
  ADD COLUMN "noShowFee" INTEGER;

ALTER TABLE "School" ADD COLUMN "cancellationPolicyChosenAt" TIMESTAMP(3);

-- Existing Schools: until now every cancellation before the cutoff gave the
-- class credit back, whatever the stored policy said (it was never applied).
-- Auto-credit is exactly that, so nothing changes for their students until
-- the owner picks a policy themselves (cancellationPolicyChosenAt stays null,
-- so the portal keeps asking them to).
UPDATE "School" SET "classCancellationPolicy" = 'AUTO_CREDIT';
