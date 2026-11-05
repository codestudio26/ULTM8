-- Decision 316 item 6: contracts on plans. The School writes its contract
-- text and terms on a plan (minimum term and early-exit fee, Subscription
-- only); the member (a Guardian for a child) signs it in the app just before
-- buying, like a waiver; cancelling before the minimum term ends puts the
-- School's early-exit fee on the member's balance.

-- The plan's contract. MembershipPlan's existing grants and policies apply.
-- contractVersion NULL = no contract on the plan.
ALTER TABLE "MembershipPlan" ADD COLUMN "contractBody" TEXT,
ADD COLUMN "contractMinimumTermMonths" INTEGER,
ADD COLUMN "contractEarlyExitFee" INTEGER,
ADD COLUMN "contractVersion" INTEGER;

ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_contract_terms_valid" CHECK (
  ("contractVersion" IS NULL AND "contractBody" IS NULL AND "contractMinimumTermMonths" IS NULL AND "contractEarlyExitFee" IS NULL)
  OR ("contractVersion" >= 1 AND "contractBody" IS NOT NULL
      AND ("contractMinimumTermMonths" IS NULL OR "contractMinimumTermMonths" BETWEEN 1 AND 120)
      AND ("contractEarlyExitFee" IS NULL OR ("contractEarlyExitFee" >= 0 AND "contractMinimumTermMonths" IS NOT NULL)))
);

-- The discovery role (the app's list of a School's plans) learns only
-- whether a plan has a contract, and which version. The text is read signed
-- in, by a member of the School (PlanContractsService.getForSigning).
GRANT SELECT ("contractVersion") ON "MembershipPlan" TO ultm8_discovery;

CREATE TABLE "PlanContractSignature" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "membershipPlanId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "signedById" TEXT NOT NULL,
    "signerFullName" TEXT NOT NULL,
    "signatureText" TEXT NOT NULL,
    "signatureImageKey" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "planTitle" TEXT NOT NULL,
    "planType" "MembershipPlanType" NOT NULL,
    "contractBody" TEXT NOT NULL,
    "minimumTermMonths" INTEGER,
    "earlyExitFee" INTEGER,
    "currency" TEXT,
    "contractVersion" INTEGER NOT NULL,
    "contractSha256" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "transactionId" TEXT,
    "membershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanContractSignature_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanContractSignature_transactionId_key" ON "PlanContractSignature"("transactionId");
CREATE UNIQUE INDEX "PlanContractSignature_membershipId_key" ON "PlanContractSignature"("membershipId");
CREATE INDEX "PlanContractSignature_schoolId_idx" ON "PlanContractSignature"("schoolId");
CREATE INDEX "PlanContractSignature_studentId_idx" ON "PlanContractSignature"("studentId");
CREATE INDEX "PlanContractSignature_membershipPlanId_idx" ON "PlanContractSignature"("membershipPlanId");

-- RESTRICT everywhere: a signed contract is a legal record, so deleting its
-- plan, its member or its signer is refused (a closed School with one stays
-- anonymized, as with waivers and payment history).
ALTER TABLE "PlanContractSignature" ADD CONSTRAINT "PlanContractSignature_membershipPlanId_fkey" FOREIGN KEY ("membershipPlanId") REFERENCES "MembershipPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanContractSignature" ADD CONSTRAINT "PlanContractSignature_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanContractSignature" ADD CONSTRAINT "PlanContractSignature_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The early-exit fee's charge: one per signed contract.
ALTER TABLE "Charge" ADD COLUMN "contractSignatureId" TEXT;
CREATE UNIQUE INDEX "Charge_contractSignatureId_key" ON "Charge"("contractSignatureId");
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_contractSignatureId_fkey" FOREIGN KEY ("contractSignatureId") REFERENCES "PlanContractSignature"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Who sees a signed contract: the School's Owner/Manager, or the member
-- themselves (a Guardian signs and buys under their child's context, as for
-- waivers). The member inserts their own signature and marks it used when
-- buying; nobody else writes it, and nobody deletes it.
ALTER TABLE "PlanContractSignature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlanContractSignature" FORCE ROW LEVEL SECURITY;
-- Only the purchase link can change after signing (column grant), so the
-- signed copy itself can't be rewritten through the app connection.
GRANT SELECT, INSERT ON "PlanContractSignature" TO ultm8_app;
GRANT UPDATE ("usedAt", "transactionId", "membershipId") ON "PlanContractSignature" TO ultm8_app;

CREATE POLICY "plan_contract_signature_owner_or_self_read" ON "PlanContractSignature"
  FOR SELECT
  USING (
    is_active_school_owner_manager("PlanContractSignature"."schoolId")
    OR "PlanContractSignature"."studentId" = current_setting('app.current_user_id', true)
  );
CREATE POLICY "plan_contract_signature_self_insert" ON "PlanContractSignature"
  FOR INSERT
  WITH CHECK ("PlanContractSignature"."studentId" = current_setting('app.current_user_id', true));
CREATE POLICY "plan_contract_signature_self_update" ON "PlanContractSignature"
  FOR UPDATE
  USING ("PlanContractSignature"."studentId" = current_setting('app.current_user_id', true))
  WITH CHECK ("PlanContractSignature"."studentId" = current_setting('app.current_user_id', true));

-- Jobs connection: the member merge (Decision 315 item 13) moves a
-- duplicate's signed contracts to the kept member, and the early-exit fee is
-- charged there (as late fees and promotion fees are).
GRANT SELECT ON "PlanContractSignature" TO ultm8_jobs;
GRANT UPDATE ("studentId") ON "PlanContractSignature" TO ultm8_jobs;
CREATE POLICY "plan_contract_signature_jobs_read" ON "PlanContractSignature"
  FOR SELECT TO ultm8_jobs USING (true);
CREATE POLICY "plan_contract_signature_jobs_update" ON "PlanContractSignature"
  FOR UPDATE TO ultm8_jobs USING (true) WITH CHECK (true);
