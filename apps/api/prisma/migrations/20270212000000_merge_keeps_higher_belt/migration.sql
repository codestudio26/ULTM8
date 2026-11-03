-- Decision 422 item 8: merging duplicate members no longer refuses when both
-- records have a belt in the same style. The higher current belt is kept
-- (the kept member's when both are the same rung); the other belt's history
-- moves onto it, marked with the member record it came from, and only the
-- other StudentRank row itself is deleted (MemberMergeService).

-- 1. The mark on a history entry that came from the belt that was not kept.
ALTER TABLE "PromotionEvent" ADD COLUMN "mergedFromUserId" TEXT;

-- 2. What the merge (jobs connection, after the owner check; every statement
-- names the School and one of the two members) may now change.

-- The belt that is kept takes the other belt's history entries and skill
-- sign-off log. (ultm8_jobs already reads PromotionEvent in full.)
GRANT UPDATE ("studentRankId", "mergedFromUserId") ON "PromotionEvent" TO ultm8_jobs;
GRANT SELECT ("studentRankId"), UPDATE ("studentRankId") ON "SkillSignOffLog" TO ultm8_jobs;

-- Skill sign-offs: on the same rung, the further status of the two is kept
-- and the other belt's row for that skill goes; its sign-offs for skills the
-- kept belt has no row for move. On a different rung they go, as on any rank
-- change (Decision 128 item 16); their log stays.
GRANT UPDATE ("studentRankId", "status", "updatedAt"), DELETE ON "StudentRankSkillStatus" TO ultm8_jobs;
CREATE POLICY "student_rank_skill_status_jobs_merge_delete" ON "StudentRankSkillStatus" FOR DELETE TO ultm8_jobs USING (true);

-- On the same rung, the classes the other belt counted toward the next rung
-- are added to the kept belt's. Then the other belt's row is deleted.
GRANT UPDATE ("classesAttendedTowardCheckpoint", "classesAttendedByType") ON "StudentRank" TO ultm8_jobs;
GRANT DELETE ON "StudentRank" TO ultm8_jobs;
CREATE POLICY "student_rank_jobs_merge_delete" ON "StudentRank" FOR DELETE TO ultm8_jobs USING (true);

-- An unanswered promotion fee planned from the belt that was not kept (or a
-- second one waiting in the same style) is cancelled.
GRANT UPDATE ("status", "cancelledAt", "closedById") ON "PromotionFeeRequest" TO ultm8_jobs;
