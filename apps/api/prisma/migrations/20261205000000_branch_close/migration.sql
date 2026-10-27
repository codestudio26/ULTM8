-- Closing a Branch (Decision 330).

-- 1. "Close branch" may leave a Student with no home Branch (the owner picks
-- "Whole School" for them). Only the School's owner may do it: the existing
-- student_home_branch_owner_manage policy (every command, owner only) already
-- covers DELETE; the table grant was missing.
GRANT DELETE ON "StudentHomeBranch" TO ultm8_app;

-- 2. A closed Branch that has history is never purged. The purge job clears
-- its purgeAt when it finds one, so it stops coming back every night. It may
-- change that column (and updatedAt, which Prisma sets on every update) and
-- nothing else.
GRANT UPDATE ("purgeAt", "updatedAt") ON "Branch" TO ultm8_jobs;
CREATE POLICY "branch_jobs_keep" ON "Branch"
  FOR UPDATE
  TO ultm8_jobs
  USING ("archivedAt" IS NOT NULL AND "purgedAt" IS NULL)
  WITH CHECK ("purgeAt" IS NULL);
