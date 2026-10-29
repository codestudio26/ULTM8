-- Backlog 3.13 (Decisions 286, 299): a student asks the School to correct
-- their belt; the owner or a coach with "Verify ranks" approves or rejects.
CREATE TYPE "RankCorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "RankCorrectionRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "fromRankId" TEXT NOT NULL,
    "fromStripeTierId" TEXT,
    "requestedRankId" TEXT NOT NULL,
    "requestedStripeTierId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "status" "RankCorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankCorrectionRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RankCorrectionRequest_schoolId_status_idx" ON "RankCorrectionRequest"("schoolId", "status");
CREATE INDEX "RankCorrectionRequest_studentId_disciplineId_idx" ON "RankCorrectionRequest"("studentId", "disciplineId");
-- One waiting request per student and style.
CREATE UNIQUE INDEX "RankCorrectionRequest_one_pending" ON "RankCorrectionRequest"("studentId", "disciplineId") WHERE "status" = 'PENDING';

ALTER TABLE "RankCorrectionRequest" ADD CONSTRAINT "RankCorrectionRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RankCorrectionRequest" ADD CONSTRAINT "RankCorrectionRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RankCorrectionRequest" ADD CONSTRAINT "RankCorrectionRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Read and written only on the jobs connection, after the API's own checks
-- (RankCorrectionsService): the student for their own requests; reviewers
-- through the grading permission checks. ultm8_app gets nothing.
ALTER TABLE "RankCorrectionRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RankCorrectionRequest" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "RankCorrectionRequest" TO ultm8_jobs;
CREATE POLICY "rank_correction_request_jobs_all" ON "RankCorrectionRequest" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
