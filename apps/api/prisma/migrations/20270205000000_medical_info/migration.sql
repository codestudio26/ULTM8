-- Decision 315 item 10: medical information at sign-up. Optional per School
-- (off by default, so nothing changes until an owner turns it on), given with
-- explicit consent from the member (the Guardian for a child), seen only by
-- the owner and staff the owner switches on, erased with the account.

-- The School's setting. School's existing grants and policies apply.
ALTER TABLE "School" ADD COLUMN "medicalInfoEnabled" BOOLEAN NOT NULL DEFAULT false;

-- "See medical information": Branch Staff the owner switches on. Off by
-- default. StaffPermission's existing grants and policies apply.
ALTER TABLE "StaffPermission" ADD COLUMN "canSeeMedicalInfo" BOOLEAN NOT NULL DEFAULT false;

-- What the tablet's sign-up form took, until staff approve it. SignUp is
-- already jobs-only (RLS on, no ultm8_app grant).
ALTER TABLE "SignUp" ADD COLUMN "medicalInfo" TEXT;
ALTER TABLE "SignUp" ADD COLUMN "medicalConsentAt" TIMESTAMP(3);

CREATE TABLE "StudentMedicalInfo" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "consentedById" TEXT,
    "consentedByGuardian" BOOLEAN NOT NULL DEFAULT false,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentMedicalInfo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentMedicalInfo_schoolId_studentId_key" ON "StudentMedicalInfo"("schoolId", "studentId");
CREATE INDEX "StudentMedicalInfo_studentId_idx" ON "StudentMedicalInfo"("studentId");

-- Erased with the student's account and with the School.
ALTER TABLE "StudentMedicalInfo" ADD CONSTRAINT "StudentMedicalInfo_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentMedicalInfo" ADD CONSTRAINT "StudentMedicalInfo_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentMedicalInfo" ADD CONSTRAINT "StudentMedicalInfo_consentedById_fkey" FOREIGN KEY ("consentedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Special-category health data: read and written only on the jobs connection,
-- after the API's own checks (MedicalInfoService). ultm8_app gets nothing.
ALTER TABLE "StudentMedicalInfo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudentMedicalInfo" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "StudentMedicalInfo" TO ultm8_jobs;
CREATE POLICY "student_medical_info_jobs_all" ON "StudentMedicalInfo" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);

-- The student app shows the medical information step when joining only when
-- the School asks for it: the setting itself (not any medical data) joins the
-- discovery role's column grant on School.
GRANT SELECT ("medicalInfoEnabled") ON "School" TO ultm8_discovery;
