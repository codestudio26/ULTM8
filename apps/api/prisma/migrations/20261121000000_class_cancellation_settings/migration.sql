-- Decision 279 — the School's "Class cancellations" settings, the
-- cancel-whole-class action, the money side of a refund, and the no-show fee.
-- See schema.prisma's own comments on each field.
--
-- No RLS change: every new column sits on a table whose existing policies
-- already cover it (School, Class, Booking, BookingAttendee). One column grant:
-- ultm8_discovery reads Class by column (20260917000000_academies_discovery_
-- module), and the academy page's upcoming classes now leave out a class the
-- School cancelled. Postgres can't
-- add an enum value inside a transaction that then uses it, but nothing below
-- uses the new RefundResolution values, so ADD VALUE is safe here.

CREATE TYPE "ClassCancellationPolicyWindow" AS ENUM ('BEFORE_CUTOFF', 'ANY_TIME');
CREATE TYPE "SchoolCancelledClassResolution" AS ENUM ('REFUND_ALL', 'CREDIT_ALL', 'FOLLOW_POLICY');

ALTER TYPE "RefundResolution" ADD VALUE 'PENDING';
ALTER TYPE "RefundResolution" ADD VALUE 'MONEY_REFUNDED';
ALTER TYPE "RefundResolution" ADD VALUE 'REFUND_OWED';

ALTER TABLE "School"
  ADD COLUMN "classCancellationPolicyWindow" "ClassCancellationPolicyWindow" NOT NULL DEFAULT 'BEFORE_CUTOFF',
  ADD COLUMN "chargeLateCancellationFee" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "schoolCancelledClassResolution" "SchoolCancelledClassResolution" NOT NULL DEFAULT 'CREDIT_ALL',
  ADD COLUMN "defaultRefundCutoffHours" INTEGER,
  ADD COLUMN "noShowFee" INTEGER;

ALTER TABLE "Class"
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledById" TEXT,
  ADD COLUMN "cancellationReason" TEXT;

ALTER TABLE "Booking"
  ADD COLUMN "refundAmount" INTEGER,
  ADD COLUMN "stripeRefundId" TEXT,
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "noShowFeeOutcome" "CancellationChargeOutcome",
  ADD COLUMN "noShowFeeAmount" INTEGER,
  ADD COLUMN "stripeNoShowPaymentIntentId" TEXT;

ALTER TABLE "BookingAttendee"
  ADD COLUMN "refundAmount" INTEGER,
  ADD COLUMN "stripeRefundId" TEXT,
  ADD COLUMN "resolvedAt" TIMESTAMP(3);

-- The staff "to resolve" list reads by School + resolution.
CREATE INDEX "Booking_schoolId_refundResolution_idx" ON "Booking"("schoolId", "refundResolution");
CREATE INDEX "BookingAttendee_schoolId_refundResolution_idx" ON "BookingAttendee"("schoolId", "refundResolution");

GRANT SELECT ("cancelledAt") ON "Class" TO ultm8_discovery;
