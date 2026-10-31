-- Decision 315 item 14: custom member fields and statuses. Each School adds
-- its own member fields (text, number, date, drop-down, yes/no) and its own
-- member statuses (up to 50 characters), shown on the student's page and as
-- Students list filters. Staff-only, like tags: the tables have no grant to
-- the app connection. A student's values and status are kept while the
-- account exists and erased with it; the School's purge takes the lot.
CREATE TYPE "CustomMemberFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'DROPDOWN', 'YES_NO');

CREATE TABLE "CustomMemberField" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CustomMemberFieldType" NOT NULL,
    "options" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomMemberField_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomMemberField_name_length" CHECK (char_length("name") BETWEEN 1 AND 50)
);

CREATE TABLE "CustomMemberFieldValue" (
    "fieldId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomMemberFieldValue_pkey" PRIMARY KEY ("fieldId","studentId")
);

CREATE TABLE "CustomMemberStatus" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomMemberStatus_pkey" PRIMARY KEY ("id"),
    -- Decision 315 item 14: a status is up to 50 characters.
    CONSTRAINT "CustomMemberStatus_name_length" CHECK (char_length("name") BETWEEN 1 AND 50)
);

CREATE TABLE "StudentCustomStatus" (
    "schoolId" TEXT NOT NULL,
    "statusId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentCustomStatus_pkey" PRIMARY KEY ("schoolId","studentId")
);

CREATE UNIQUE INDEX "CustomMemberField_schoolId_name_key" ON "CustomMemberField"("schoolId", "name");
CREATE UNIQUE INDEX "CustomMemberField_id_schoolId_key" ON "CustomMemberField"("id", "schoolId");
CREATE INDEX "CustomMemberFieldValue_schoolId_studentId_idx" ON "CustomMemberFieldValue"("schoolId", "studentId");
CREATE UNIQUE INDEX "CustomMemberStatus_schoolId_name_key" ON "CustomMemberStatus"("schoolId", "name");
CREATE UNIQUE INDEX "CustomMemberStatus_id_schoolId_key" ON "CustomMemberStatus"("id", "schoolId");
CREATE INDEX "StudentCustomStatus_statusId_idx" ON "StudentCustomStatus"("statusId");

ALTER TABLE "CustomMemberField" ADD CONSTRAINT "CustomMemberField_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- (fieldId, schoolId) together: a value can only sit on a student under the
-- field's own School, whatever the API sends. Deleting a field deletes its
-- values.
ALTER TABLE "CustomMemberFieldValue" ADD CONSTRAINT "CustomMemberFieldValue_fieldId_schoolId_fkey" FOREIGN KEY ("fieldId", "schoolId") REFERENCES "CustomMemberField"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomMemberFieldValue" ADD CONSTRAINT "CustomMemberFieldValue_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomMemberStatus" ADD CONSTRAINT "CustomMemberStatus_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- (statusId, schoolId) together, as above. Deleting a status clears it from
-- every student.
ALTER TABLE "StudentCustomStatus" ADD CONSTRAINT "StudentCustomStatus_statusId_schoolId_fkey" FOREIGN KEY ("statusId", "schoolId") REFERENCES "CustomMemberStatus"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentCustomStatus" ADD CONSTRAINT "StudentCustomStatus_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Read and written only on the jobs connection, after the API's own staff
-- checks (CustomMemberFieldsService). ultm8_app gets nothing, so no
-- member-facing query can reach them.
ALTER TABLE "CustomMemberField" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomMemberField" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CustomMemberField" TO ultm8_jobs;
CREATE POLICY "custom_member_field_jobs_all" ON "CustomMemberField" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);

ALTER TABLE "CustomMemberFieldValue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomMemberFieldValue" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CustomMemberFieldValue" TO ultm8_jobs;
CREATE POLICY "custom_member_field_value_jobs_all" ON "CustomMemberFieldValue" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);

ALTER TABLE "CustomMemberStatus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomMemberStatus" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CustomMemberStatus" TO ultm8_jobs;
CREATE POLICY "custom_member_status_jobs_all" ON "CustomMemberStatus" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);

ALTER TABLE "StudentCustomStatus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudentCustomStatus" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "StudentCustomStatus" TO ultm8_jobs;
CREATE POLICY "student_custom_status_jobs_all" ON "StudentCustomStatus" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
