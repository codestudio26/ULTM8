-- Phase 16b-ii — FranchiseFeeCharge (Decision 99): self-service Franchise fee-rate
-- fields, the FranchiseFeeCharge ledger table, the standing Stripe Subscription
-- correlator on School, and the ultm8_jobs grants the new
-- franchise-fee-usage-reporting job and stripe-webhook-processing's own new
-- invoice.paid/invoice.payment_failed handlers both need.
--
-- See docs/decisions/POST-SPEC-55-DECISION-LOG.md, Decision 99, for the full
-- reasoning — most notably why the Franchise fee-rate fields are back after
-- being reverted in Phase 16b-i's own review (resolved directly with the user:
-- self-service, same pattern MembershipPlan.price already uses).

-- ============================================================================
-- 1. Franchise — fee-rate fields + lazily-created Per-Headcount Meter/Price ids.
-- ============================================================================

ALTER TABLE "Franchise" ADD COLUMN "flatFeeAmount" INTEGER;
ALTER TABLE "Franchise" ADD COLUMN "perHeadcountRate" INTEGER;
ALTER TABLE "Franchise" ADD COLUMN "stripeMeterId" TEXT;
ALTER TABLE "Franchise" ADD COLUMN "stripeUsagePriceId" TEXT;

-- ============================================================================
-- 2. School — the standing franchise-fee Stripe Subscription correlator, paired
--    with the existing franchiseFeeSubscriptionStatus column (Phase 1).
-- ============================================================================

ALTER TABLE "School" ADD COLUMN "stripeFranchiseFeeSubscriptionId" TEXT;
CREATE UNIQUE INDEX "School_stripeFranchiseFeeSubscriptionId_key" ON "School"("stripeFranchiseFeeSubscriptionId");

-- ultm8_jobs already holds SELECT on School (20260915000000_booking_waitlist_
-- module, school_jobs_read) but never UPDATE — the franchise-fee-usage-reporting
-- job (this phase) needs to write stripeFranchiseFeeSubscriptionId once it
-- creates the standing Subscription, and stripe-webhook-processing's new
-- invoice.paid/invoice.payment_failed/customer.subscription.deleted handling
-- needs to write franchiseFeeSubscriptionStatus. Additive, same "add the
-- specific grant a new use actually needs" discipline every prior ultm8_jobs
-- grant in this schema already follows — not a whole-table rewrite of the
-- existing read-only policy.
GRANT UPDATE ON "School" TO ultm8_jobs;
CREATE POLICY "school_jobs_update" ON "School"
  FOR UPDATE
  TO ultm8_jobs
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 3. FranchiseFeeCharge — new table.
-- ============================================================================

CREATE TABLE "FranchiseFeeCharge" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "franchiseId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "franchisePaymentAccountId" TEXT NOT NULL,
    "billingPeriodStart" TIMESTAMP(3) NOT NULL,
    "billingPeriodEnd" TIMESTAMP(3) NOT NULL,
    "feeBasisSnapshot" "FeeModel" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT,
    "activeStudentCountSnapshot" INTEGER,
    "status" "TransactionStatus" NOT NULL,
    "stripeInvoiceId" TEXT,
    "stripeSubscriptionId" TEXT,
    "refundedAmount" INTEGER,
    "disputedAmount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FranchiseFeeCharge_pkey" PRIMARY KEY ("id"),
    -- RESTRICT, not CASCADE — same audit-trail-preservation precedent every other
    -- financial ledger table in this schema already follows (Transaction,
    -- PlatformCharge's own eventual shape); a Franchise/School/PaymentAccount row
    -- with billing history behind it should never silently take that history with
    -- it on delete (none of the three actually has a delete path built yet either
    -- — flagged for completeness, not a live concern today).
    CONSTRAINT "FranchiseFeeCharge_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "Franchise"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FranchiseFeeCharge_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FranchiseFeeCharge_franchisePaymentAccountId_fkey" FOREIGN KEY ("franchisePaymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FranchiseFeeCharge_stripeInvoiceId_key" ON "FranchiseFeeCharge"("stripeInvoiceId");
-- Composite indexes leading with the tenant column (Decision 30) — two tenant
-- sides on this entity, so both get one, same as the RLS policy below.
CREATE INDEX "FranchiseFeeCharge_franchiseId_idx" ON "FranchiseFeeCharge"("franchiseId");
CREATE INDEX "FranchiseFeeCharge_schoolId_idx" ON "FranchiseFeeCharge"("schoolId");
-- franchise-fee-usage-reporting.processor.ts's own "does a charge row already
-- exist for this subscription's current billing period" idempotency check, and
-- stripe-webhook-processing's invoice.paid/invoice.payment_failed handlers' own
-- "find the most recent PENDING row for this subscription" lookup (see that
-- file's own comment) both filter on (stripeSubscriptionId, status), ordered
-- by createdAt — this index matches that query shape directly, the same
-- "index the actual query, not a guess" discipline the notification/timetable
-- migrations already established.
CREATE INDEX "FranchiseFeeCharge_stripeSubscriptionId_status_idx" ON "FranchiseFeeCharge"("stripeSubscriptionId", "status");

-- FOUND ON REVIEW, before this ever shipped: the "one charge row per
-- (subscription, billing period)" invariant the usage-reporting job's own
-- comment describes as idempotent was enforced only in application code (a
-- findFirst-then-create check, no DB constraint behind it) — the exact
-- check-then-insert TOCTOU shape this codebase's own established convention
-- (RoleGrant_one_active_student_per_school, Membership_one_active_general_
-- access_per_school, WaitlistEntry_one_active_per_student_per_class,
-- WaiverSignature_one_non_expired_per_student_per_waiver) already prefers a
-- real partial unique index over. If the monthly job is ever triggered twice
-- concurrently for the same period (a manual re-trigger racing the cron, or a
-- retried/duplicated BullMQ job), both could pass the application-level check
-- before either create() commits. Closed the same way every prior instance of
-- this exact problem was: a real DB constraint, not a stronger app-layer
-- check. `WHERE "stripeSubscriptionId" IS NOT NULL` — a Flat-fee row (created
-- directly by stripe-webhook-processing's invoice.paid handler, not this job)
-- also carries a non-null stripeSubscriptionId but is created once per
-- INVOICE, not once per computed period the way a Per-Headcount PENDING row
-- is — excluding null-subscription rows (there are none today, but schema
-- completeness) from this specific constraint is the right scope; a genuine
-- second Flat invoice.paid for a real new billing period is supposed to
-- create a second row with a different billingPeriodStart, which this index
-- still permits.
CREATE UNIQUE INDEX "FranchiseFeeCharge_one_per_subscription_per_period" ON "FranchiseFeeCharge"("stripeSubscriptionId", "billingPeriodStart")
  WHERE "stripeSubscriptionId" IS NOT NULL;

GRANT SELECT, UPDATE ON "FranchiseFeeCharge" TO ultm8_app;
GRANT SELECT, INSERT, UPDATE ON "FranchiseFeeCharge" TO ultm8_jobs;

ALTER TABLE "FranchiseFeeCharge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FranchiseFeeCharge" FORCE ROW LEVEL SECURITY;

-- Read: either tenant side, any active role — mirrors payment_account_tenant_
-- isolation's exact two-sided-OR shape (this entity has the same two-tenant-
-- sides structure PaymentAccount does). The finer "only Franchise Owner may
-- actually see/act on a refund control" narrowing is a UI/business-layer
-- concern (FranchiseFeesController never exposes a refund action to a School-
-- side caller), matching this codebase's established "RLS enforces the tenant
-- boundary, the business layer narrows further" split (TenantAuthorizationService's
-- own header comment) — same open-question status PaymentAccount's own reads
-- carry (Phase 8's still-unresolved "should PaymentAccount reads be Owner-only"
-- note), not decided differently here without a reason to.
CREATE POLICY "franchise_fee_charge_read" ON "FranchiseFeeCharge"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."franchiseId" = "FranchiseFeeCharge"."franchiseId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."schoolId" = "FranchiseFeeCharge"."schoolId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
    )
  );

-- Write (ultm8_app side — only the refund action, FranchiseFeesService.refund()):
-- Franchise-side only, NOT the two-sided OR reads use above — a School-side
-- caller should never be able to write to this table at all, only read it. The
-- narrower "must specifically be FRANCHISE_OWNER, not just any Franchise-scoped
-- role" check (Spec 55 §10.2: "only by the Franchise Owner") is enforced in
-- FranchiseFeesService.refund() via TenantAuthorizationService.assertFranchiseOwner,
-- same split as every other Owner-gated write in this codebase.
CREATE POLICY "franchise_fee_charge_franchise_update" ON "FranchiseFeeCharge"
  FOR UPDATE
  TO ultm8_app
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."franchiseId" = "FranchiseFeeCharge"."franchiseId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."franchiseId" = "FranchiseFeeCharge"."franchiseId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
    )
  );

-- ultm8_jobs: franchise-fee-usage-reporting (this phase) creates PENDING rows at
-- usage-report time (Per-Headcount) and reads them back to check idempotency;
-- stripe-webhook-processing's new invoice.paid/invoice.payment_failed handlers
-- create rows directly (Flat case) or flip an existing PENDING row to
-- Successful/Failed (Per-Headcount case) — see FranchiseFeeCharge's own
-- schema.prisma comment for the full creation-timing account. No DELETE grant —
-- neither job ever removes a row.
CREATE POLICY "franchise_fee_charge_jobs_all" ON "FranchiseFeeCharge"
  TO ultm8_jobs
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 4. ultm8_jobs grants on Franchise/PaymentAccount — never granted before now
--    (grepped every prior migration to confirm neither table was ever readable
--    by ultm8_jobs).
-- ============================================================================

-- SELECT: franchise-fee-usage-reporting reads feeModel/flatFeeAmount/
-- perHeadcountRate/stripeMeterId/stripeUsagePriceId to decide what to bill and
-- whether a Meter/Price still needs creating — whole-table, since none of
-- those columns are more sensitive than any other Franchise profile field.
--
-- UPDATE: column-scoped to ONLY stripeMeterId/stripeUsagePriceId — FOUND ON
-- REVIEW: a first draft granted whole-table UPDATE, the same shape most other
-- ultm8_jobs grants in this schema use. Flagged as a real, if narrow, gap on
-- this specific table: Franchise now also carries flatFeeAmount/
-- perHeadcountRate, a self-service Franchise Owner-set billing rate whose only
-- validation (the DTO's own @Min/@Max, and FranchisesService.update()'s own
-- rate-change-after-billing-starts guard) lives entirely in the ultm8_app
-- write path — a whole-table grant would let a bug in ANY future
-- ultm8_jobs-connected code silently rewrite a Franchise's billing rate with
-- none of that validation. Same "column-scope the grant when the table holds
-- something a whole-table grant doesn't need to touch" discipline the User
-- table's own `GRANT SELECT ("id", "email")` (20260918000000) already
-- established for `passcodeHash`, applied here on the write side instead of
-- the read side.
GRANT SELECT ON "Franchise" TO ultm8_jobs;
GRANT UPDATE ("stripeMeterId", "stripeUsagePriceId") ON "Franchise" TO ultm8_jobs;
CREATE POLICY "franchise_jobs_read" ON "Franchise"
  FOR SELECT
  TO ultm8_jobs
  USING (true);
CREATE POLICY "franchise_jobs_update" ON "Franchise"
  FOR UPDATE
  TO ultm8_jobs
  USING (true)
  WITH CHECK (true);

-- SELECT only — franchise-fee-usage-reporting needs a Franchise's own
-- PaymentAccount.stripeConnectedAccountId to construct the Stripe scoped client
-- (StripeClientService.scopedClient) it creates the standing Subscription
-- against. Never writes PaymentAccount itself (onboarding stays a caller-
-- initiated flow under ultm8_app, Phase 8, untouched by this grant).
GRANT SELECT ON "PaymentAccount" TO ultm8_jobs;
CREATE POLICY "payment_account_jobs_read" ON "PaymentAccount"
  FOR SELECT
  TO ultm8_jobs
  USING (true);
