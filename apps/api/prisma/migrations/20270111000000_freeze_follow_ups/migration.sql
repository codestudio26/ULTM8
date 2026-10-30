-- Decision 409: who may freeze a membership besides the owners. Branch Staff
-- the owner switches on ("Can freeze memberships"), for the students of
-- their own branches. StaffPermission's existing grants and policies apply;
-- MembershipFreeze stays on the jobs connection only.
ALTER TABLE "StaffPermission" ADD COLUMN "canFreezeMemberships" BOOLEAN NOT NULL DEFAULT false;
