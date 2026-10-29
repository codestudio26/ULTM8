-- Decision 403 (backlog 3.3): temporary passcodes expire after 7 days, and
-- only the School that made one can make a new one.
ALTER TABLE "User" ADD COLUMN "temporaryPasscodeExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "temporaryPasscodeSchoolId" TEXT;

-- A child added by the owner whose Guardian already has an account.
CREATE TYPE "ChildInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

CREATE TABLE "ChildInvite" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT,
    "guardianId" TEXT NOT NULL,
    "childFirstName" TEXT NOT NULL,
    "childSurname" TEXT NOT NULL,
    "childDateOfBirth" TIMESTAMP(3) NOT NULL,
    "childGender" TEXT,
    "status" "ChildInviteStatus" NOT NULL DEFAULT 'PENDING',
    "studentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ChildInvite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChildInvite_guardianId_status_idx" ON "ChildInvite"("guardianId", "status");
CREATE INDEX "ChildInvite_schoolId_status_idx" ON "ChildInvite"("schoolId", "status");

ALTER TABLE "ChildInvite" ADD CONSTRAINT "ChildInvite_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChildInvite" ADD CONSTRAINT "ChildInvite_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChildInvite" ADD CONSTRAINT "ChildInvite_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChildInvite" ADD CONSTRAINT "ChildInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Read and written only on the jobs connection, after the API's own checks.
ALTER TABLE "ChildInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChildInvite" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ChildInvite" TO ultm8_jobs;
CREATE POLICY "child_invite_jobs_all" ON "ChildInvite" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
