-- Backlog 3.9 (Decision 315 item 11, Decision 399): export the student list.
-- Who may export besides the owners: Branch Staff the owner switches on.
-- StaffPermission's existing grants and policies apply.
ALTER TABLE "StaffPermission" ADD COLUMN "canExportStudents" BOOLEAN NOT NULL DEFAULT false;

-- Every export is logged: who, when, which filter and how many rows. Written
-- and read on the jobs connection only, after the API's own checks.
CREATE TABLE "StudentExportLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "exportedById" TEXT NOT NULL,
    "filter" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentExportLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudentExportLog_schoolId_createdAt_idx" ON "StudentExportLog"("schoolId", "createdAt");

ALTER TABLE "StudentExportLog" ADD CONSTRAINT "StudentExportLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentExportLog" ADD CONSTRAINT "StudentExportLog_exportedById_fkey" FOREIGN KEY ("exportedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudentExportLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudentExportLog" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "StudentExportLog" TO ultm8_jobs;
CREATE POLICY "student_export_log_jobs_all" ON "StudentExportLog" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
