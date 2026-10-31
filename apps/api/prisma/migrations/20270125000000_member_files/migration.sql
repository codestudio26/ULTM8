-- Backlog 5.11 (Decision 315 item 9): files on a member. PDF, JPG and PNG, up
-- to 10 MB each, in the private R2 bucket; seen by the School's owners and
-- the Branch Staff they let manage member files; never by the member; erased
-- with the account.

-- Who may see and manage member files besides the owners: Branch Staff the
-- owner switches on. StaffPermission's existing grants and policies apply.
ALTER TABLE "StaffPermission" ADD COLUMN "canManageMemberFiles" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "MemberFile" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT,
    "uploadedById" TEXT,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MemberFile_objectKey_key" ON "MemberFile"("objectKey");
CREATE INDEX "MemberFile_schoolId_studentId_createdAt_idx" ON "MemberFile"("schoolId", "studentId", "createdAt");
CREATE INDEX "MemberFile_studentId_idx" ON "MemberFile"("studentId");

ALTER TABLE "MemberFile" ADD CONSTRAINT "MemberFile_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL, not CASCADE: the row has to outlive the account until the daily
-- purge has deleted the stored file it points to; then the row goes too.
ALTER TABLE "MemberFile" ADD CONSTRAINT "MemberFile_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MemberFile" ADD CONSTRAINT "MemberFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Read and written only on the jobs connection, after the API's own checks
-- (MemberFilesService), and by the purge jobs. ultm8_app gets nothing, so no
-- member-facing read can reach these rows.
ALTER TABLE "MemberFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MemberFile" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "MemberFile" TO ultm8_jobs;
CREATE POLICY "member_file_jobs_all" ON "MemberFile" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
