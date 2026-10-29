-- Backlog 3.10 (Decision 315 item 8, Decision 400): staff notes on a student,
-- each either staff-only or shown to the member (a child's to their Guardian).
-- Kept while the student's account exists and erased with it.
CREATE TABLE "StudentNote" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "showToMember" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "StudentNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StudentNote_schoolId_studentId_createdAt_idx" ON "StudentNote"("schoolId", "studentId", "createdAt");
CREATE INDEX "StudentNote_studentId_showToMember_idx" ON "StudentNote"("studentId", "showToMember");

ALTER TABLE "StudentNote" ADD CONSTRAINT "StudentNote_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentNote" ADD CONSTRAINT "StudentNote_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentNote" ADD CONSTRAINT "StudentNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Read and written only on the jobs connection, after the API's own checks
-- (StudentNotesService): staff who cover the student, the student, or their
-- Guardian. ultm8_app gets nothing.
ALTER TABLE "StudentNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudentNote" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "StudentNote" TO ultm8_jobs;
CREATE POLICY "student_note_jobs_all" ON "StudentNote" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
