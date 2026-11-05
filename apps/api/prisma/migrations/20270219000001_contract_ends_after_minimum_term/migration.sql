-- Decision 435 item 16 (builds Decision 316 item 6): a plan's contract can
-- say the Subscription ends after the minimum term instead of renewing.
-- Part of the contract's terms, so changing it is a new contract version,
-- and each signature keeps the value it was signed with.

ALTER TABLE "MembershipPlan" ADD COLUMN "contractEndsAfterMinimumTerm" BOOLEAN NOT NULL DEFAULT false;
-- Only with a contract that has a minimum term (Subscription only, as the
-- term already is).
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_contract_ends_after_term_valid" CHECK (
  NOT "contractEndsAfterMinimumTerm" OR "contractMinimumTermMonths" IS NOT NULL
);

ALTER TABLE "PlanContractSignature" ADD COLUMN "endsAfterMinimumTerm" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlanContractSignature" ADD CONSTRAINT "PlanContractSignature_ends_after_term_valid" CHECK (
  NOT "endsAfterMinimumTerm" OR "minimumTermMonths" IS NOT NULL
);

-- The 15-minute membership sweep's own bookkeeping: when it set the
-- Subscription to stop at the end of the minimum term, or found nothing left
-- to stop (the membership had already ended or been cancelled). Null = still
-- to do.
ALTER TABLE "PlanContractSignature" ADD COLUMN "termEndHandledAt" TIMESTAMP(3);
CREATE INDEX "PlanContractSignature_term_end_due_idx" ON "PlanContractSignature"("id")
  WHERE "endsAfterMinimumTerm" AND "termEndHandledAt" IS NULL;

-- The sweep runs on the jobs connection, which already reads every signature
-- (plan_contract_signature_jobs_read) and may update rows through
-- plan_contract_signature_jobs_update. It writes only this column.
GRANT UPDATE ("termEndHandledAt") ON "PlanContractSignature" TO ultm8_jobs;
