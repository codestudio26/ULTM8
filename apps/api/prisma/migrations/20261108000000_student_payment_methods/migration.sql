-- Decision 234 (POST-SPEC-55-DECISION-LOG.md) — late-cancellation fee collection,
-- plus the saved-payment-method infrastructure it depends on (a real,
-- previously-nonexistent gap — see StudentPaymentMethod's own schema.prisma
-- comment for the full account).

-- CreateEnum
CREATE TYPE "CancellationChargeOutcome" AS ENUM ('CHARGED', 'FAILED', 'NO_SAVED_PAYMENT_METHOD');

-- AlterTable
ALTER TABLE "Booking"
  ADD COLUMN "cancellationChargeOutcome" "CancellationChargeOutcome",
  ADD COLUMN "cancellationChargeAmount" INTEGER,
  ADD COLUMN "stripeCancellationPaymentIntentId" TEXT;

-- CreateTable
CREATE TABLE "StudentPaymentMethod" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "studentId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentPaymentMethod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentPaymentMethod_studentId_schoolId_key" ON "StudentPaymentMethod"("studentId", "schoolId");
CREATE INDEX "StudentPaymentMethod_schoolId_idx" ON "StudentPaymentMethod"("schoolId");

ALTER TABLE "StudentPaymentMethod" ADD CONSTRAINT "StudentPaymentMethod_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentPaymentMethod" ADD CONSTRAINT "StudentPaymentMethod_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ultm8_app — same per-table GRANT every table in this schema needs (no
-- blanket schema-wide grant exists for this role, confirmed against
-- 20260902000000_init's own ultm8_app bootstrap).
GRANT SELECT, INSERT, UPDATE, DELETE ON "StudentPaymentMethod" TO ultm8_app;

-- Self-only, every command — a Student manages their own saved card; no Staff
-- read/write capability is asked for by Decision 234 (the one real consumer,
-- BookingsService.cancelBooking(), runs the lookup under the Student's own
-- tenant context already, same as every other on-behalf-of write in this
-- codebase). Same shape as rolegrant_self_only (20260902000000_init) — a plain
-- column comparison, no bootstrap/self-reference issue an INSERT could trip on.
ALTER TABLE "StudentPaymentMethod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudentPaymentMethod" FORCE ROW LEVEL SECURITY;
CREATE POLICY "student_payment_method_self_only" ON "StudentPaymentMethod"
  USING ("studentId" = current_setting('app.current_user_id', true));

-- ultm8_jobs: StripeWebhookProcessingProcessor's new checkout.session.completed
-- handler persists/updates this row from a webhook, which has no caller/tenant
-- context — same "global sweep/event, no single caller" reasoning every other
-- ultm8_jobs grant+policy pair in this schema already uses (e.g. Booking's own
-- booking_jobs_read/booking_jobs_update, 20260915000000_booking_waitlist_module).
GRANT SELECT, INSERT, UPDATE ON "StudentPaymentMethod" TO ultm8_jobs;
CREATE POLICY "student_payment_method_jobs_read" ON "StudentPaymentMethod"
  FOR SELECT
  TO ultm8_jobs
  USING (true);
CREATE POLICY "student_payment_method_jobs_write" ON "StudentPaymentMethod"
  FOR INSERT
  TO ultm8_jobs
  WITH CHECK (true);
CREATE POLICY "student_payment_method_jobs_update" ON "StudentPaymentMethod"
  FOR UPDATE
  TO ultm8_jobs
  USING (true)
  WITH CHECK (true);
