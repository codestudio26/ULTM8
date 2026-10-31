-- Decision 315 items 12 and 13 (backlog 5.13): import members, memberships
-- and past attendance from a spreadsheet.

-- "Import data": Branch Staff the owner switches on may import, for their
-- own Branches. StaffPermission's existing grants and policies apply.
ALTER TABLE "StaffPermission" ADD COLUMN "canImportData" BOOLEAN NOT NULL DEFAULT false;

-- One row per import: who ran it, when, what kind and how many rows.
CREATE TABLE "DataImport" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdById" TEXT,
    "fileName" TEXT,
    "totalRows" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataImport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataImport_schoolId_createdAt_idx" ON "DataImport"("schoolId", "createdAt");

ALTER TABLE "DataImport" ADD CONSTRAINT "DataImport_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataImport" ADD CONSTRAINT "DataImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Each row's result, kept so a batch sent again returns the same results
-- instead of importing twice. A new member's imported phone is kept here
-- too (it isn't put on the account), and goes with the member's account.
CREATE TABLE "DataImportRow" (
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "code" TEXT,
    "column" TEXT,
    "message" TEXT,
    "warnings" JSONB,
    "studentId" TEXT,
    "membershipId" TEXT,
    "bookingId" TEXT,
    "childInviteId" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataImportRow_pkey" PRIMARY KEY ("importId", "rowNumber")
);

CREATE INDEX "DataImportRow_studentId_idx" ON "DataImportRow"("studentId");

ALTER TABLE "DataImportRow" ADD CONSTRAINT "DataImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DataImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataImportRow" ADD CONSTRAINT "DataImportRow_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Written and read on the jobs connection only, after the API's own checks
-- (the owner, or Branch Staff with "Import data"). ultm8_app gets nothing.
ALTER TABLE "DataImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataImport" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "DataImport" TO ultm8_jobs;
CREATE POLICY "data_import_jobs_all" ON "DataImport" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);

ALTER TABLE "DataImportRow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataImportRow" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "DataImportRow" TO ultm8_jobs;
CREATE POLICY "data_import_row_jobs_all" ON "DataImportRow" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
