-- "Ready to grade" notification (Decisions 145, 178).
--
-- Once per rank: set when grading staff were told the student is ready for
-- their next rung, cleared on every rank change, so the next rung can notify
-- again.
ALTER TABLE "StudentRank" ADD COLUMN "readyNotifiedAt" TIMESTAMP(3);

-- The grading-notifications job runs as ultm8_jobs (no single caller: a daily
-- sweep across every School, and checks queued after a grading action). It
-- READS a student's grading data to run the engine, and who to tell: the
-- owner and the staff with grading permission for that style who cover the
-- student's branch (Decisions 138, 139, 168), or, for a promotion, the
-- guardians of a minor (Decision 145). Approved by Gus (Decision 178). Every
-- grant below is read-only, except the one column this job owns on
-- StudentRank. ultm8_jobs already reads RoleGrant, Branch and School.
GRANT SELECT ON "StudentRank" TO ultm8_jobs;
CREATE POLICY "student_rank_jobs_read" ON "StudentRank" FOR SELECT TO ultm8_jobs USING (true);
-- updatedAt: Prisma sets @updatedAt on every update.
GRANT UPDATE ("readyNotifiedAt", "updatedAt") ON "StudentRank" TO ultm8_jobs;
CREATE POLICY "student_rank_jobs_update" ON "StudentRank" FOR UPDATE TO ultm8_jobs USING (true) WITH CHECK (true);

GRANT SELECT ON "StudentRankSkillStatus" TO ultm8_jobs;
CREATE POLICY "student_rank_skill_status_jobs_read" ON "StudentRankSkillStatus" FOR SELECT TO ultm8_jobs USING (true);

GRANT SELECT ON "Discipline" TO ultm8_jobs;
CREATE POLICY "discipline_jobs_read" ON "Discipline" FOR SELECT TO ultm8_jobs USING (true);

GRANT SELECT ON "Rank" TO ultm8_jobs;
CREATE POLICY "rank_jobs_read" ON "Rank" FOR SELECT TO ultm8_jobs USING (true);

GRANT SELECT ON "RankStripeTier" TO ultm8_jobs;
CREATE POLICY "rank_stripe_tier_jobs_read" ON "RankStripeTier" FOR SELECT TO ultm8_jobs USING (true);

GRANT SELECT ON "RankStripeTierRequiredSkill" TO ultm8_jobs;
CREATE POLICY "rank_stripe_tier_required_skill_jobs_read" ON "RankStripeTierRequiredSkill" FOR SELECT TO ultm8_jobs USING (true);

GRANT SELECT ON "StudentHomeBranch" TO ultm8_jobs;
CREATE POLICY "student_home_branch_jobs_read" ON "StudentHomeBranch" FOR SELECT TO ultm8_jobs USING (true);

GRANT SELECT ON "GradingPermission" TO ultm8_jobs;
CREATE POLICY "grading_permission_jobs_read" ON "GradingPermission" FOR SELECT TO ultm8_jobs USING (true);

GRANT SELECT ON "GuardianLink" TO ultm8_jobs;
CREATE POLICY "guardian_link_jobs_read" ON "GuardianLink" FOR SELECT TO ultm8_jobs USING (true);

-- The student's name, for the notification text ("Sam Lee is ready for Blue
-- Belt"). ultm8_jobs's User grant stays column-scoped (20260918000000):
-- names only, no passcode, phone, date of birth or address.
GRANT SELECT ("firstName", "surname") ON "User" TO ultm8_jobs;
