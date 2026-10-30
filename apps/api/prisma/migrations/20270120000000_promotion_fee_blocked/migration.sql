-- A paid promotion fee whose waiting promotion can no longer apply (Decision
-- 414 item 1): the fee's charge is paid in full, but the student's rank or the
-- belt ladder changed since the grade, so the grading code refuses the
-- promotion. Recorded once, so the owner is told once and the daily catch-up
-- (PromotionFeeService.reconcile()) doesn't try it again every day. The owner
-- then cancels the fee (what was paid becomes credit) or grades the student
-- again. Written under the student's context like every other change to the
-- request (the existing grants and RLS cover it).

-- AlterTable
ALTER TABLE "PromotionFeeRequest" ADD COLUMN "promotionBlockedAt" TIMESTAMP(3);
