-- Backlog 5.4 (Decision 315 item 7): tags on students. Each School manages its
-- own list; staff can add a new tag while tagging; members never see their
-- tags. A tag on a student is kept while the student's account exists and
-- erased with it, like staff notes.
CREATE TABLE "SchoolTag" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentTag" (
    "tagId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentTag_pkey" PRIMARY KEY ("tagId","studentId")
);

CREATE UNIQUE INDEX "SchoolTag_schoolId_name_key" ON "SchoolTag"("schoolId", "name");
CREATE UNIQUE INDEX "SchoolTag_id_schoolId_key" ON "SchoolTag"("id", "schoolId");
CREATE INDEX "StudentTag_schoolId_studentId_idx" ON "StudentTag"("schoolId", "studentId");

ALTER TABLE "SchoolTag" ADD CONSTRAINT "SchoolTag_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- (tagId, schoolId) together: a tag can only sit on a student under the
-- tag's own School, whatever the API sends.
ALTER TABLE "StudentTag" ADD CONSTRAINT "StudentTag_tagId_schoolId_fkey" FOREIGN KEY ("tagId", "schoolId") REFERENCES "SchoolTag"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentTag" ADD CONSTRAINT "StudentTag_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Read and written only on the jobs connection, after the API's own staff
-- checks (StudentTagsService). ultm8_app gets nothing, so no member-facing
-- query can reach them.
ALTER TABLE "SchoolTag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SchoolTag" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "SchoolTag" TO ultm8_jobs;
CREATE POLICY "school_tag_jobs_all" ON "SchoolTag" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);

ALTER TABLE "StudentTag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudentTag" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "StudentTag" TO ultm8_jobs;
CREATE POLICY "student_tag_jobs_all" ON "StudentTag" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
