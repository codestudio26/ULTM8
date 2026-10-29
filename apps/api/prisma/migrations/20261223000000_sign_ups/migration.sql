-- Decision 392: sign-ups from the front-desk tablet, waiting for staff approval
-- (handover F5; Decisions 351, 362, 365), and each School's "How did you hear
-- about us?" list (Decision 315 item 6).
CREATE TYPE "SignUpKind" AS ENUM ('VISITOR', 'MEMBER');
CREATE TYPE "SignUpStatus" AS ENUM ('PENDING', 'INVITED', 'APPROVED', 'REJECTED', 'DECLINED');

ALTER TABLE "School" ADD COLUMN "heardFromOptions" JSONB;

CREATE TABLE "SignUp" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT,
    "kind" "SignUpKind" NOT NULL,
    "status" "SignUpStatus" NOT NULL DEFAULT 'PENDING',
    "firstName" TEXT NOT NULL,
    "surname" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "gender" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "heardFrom" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "emergencyRelationship" TEXT,
    "userId" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignUp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SignUp_schoolId_status_idx" ON "SignUp"("schoolId", "status");
CREATE INDEX "SignUp_userId_idx" ON "SignUp"("userId");

ALTER TABLE "SignUp" ADD CONSTRAINT "SignUp_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SignUp" ADD CONSTRAINT "SignUp_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SignUp" ADD CONSTRAINT "SignUp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SignUp" ADD CONSTRAINT "SignUp_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SignUp" ADD CONSTRAINT "SignUp_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Read and written only on the jobs connection, after the API's own checks
-- (SignUpsService): the tablet runs as the staff member who started it, and a
-- sign-up is someone who isn't in the School yet, so no tenant policy fits.
-- ultm8_app gets nothing: a request context can never read a sign-up.
ALTER TABLE "SignUp" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SignUp" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "SignUp" TO ultm8_jobs;
CREATE POLICY "sign_up_jobs_all" ON "SignUp" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
