-- Decision 315 item 13 (data tools): export every signed document at a School
-- as a ZIP, and merge a duplicate member into the member who is kept.

-- 1. Signed-document exports. Read and written only on the jobs connection,
-- after the API's own owner check (SignedDocumentsExportService) and by the
-- signed-documents-export job and the purge jobs. ultm8_app gets nothing.
CREATE TYPE "SignedDocumentExportStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED', 'EXPIRED');

CREATE TABLE "SignedDocumentExport" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" "SignedDocumentExportStatus" NOT NULL DEFAULT 'PENDING',
    "labels" JSONB NOT NULL,
    "documentCount" INTEGER,
    "sizeBytes" INTEGER,
    "objectKey" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "SignedDocumentExport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignedDocumentExport_objectKey_key" ON "SignedDocumentExport"("objectKey");
CREATE INDEX "SignedDocumentExport_schoolId_createdAt_idx" ON "SignedDocumentExport"("schoolId", "createdAt");
CREATE INDEX "SignedDocumentExport_status_expiresAt_idx" ON "SignedDocumentExport"("status", "expiresAt");

ALTER TABLE "SignedDocumentExport" ADD CONSTRAINT "SignedDocumentExport_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SignedDocumentExport" ADD CONSTRAINT "SignedDocumentExport_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SignedDocumentExport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SignedDocumentExport" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "SignedDocumentExport" TO ultm8_jobs;
CREATE POLICY "signed_document_export_jobs_all" ON "SignedDocumentExport" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);

-- 2. Merging a duplicate member (MemberMergeService). The merge runs in one
-- transaction on the jobs connection, after the API has checked that the
-- caller owns the School and that both people are current Students there.
-- Every statement it runs names that School and the duplicate's id, so it
-- only ever moves rows of that School from the duplicate to the kept member.
-- The jobs role gets the columns it reads and the one column it changes (the
-- member's id), table by table. The User row (the login) is never written.

-- Moved by "studentId", within the School.
GRANT SELECT ("id", "schoolId", "studentId"), UPDATE ("studentId") ON
  "Membership", "Transaction", "Booking", "WaitlistEntry", "StudentRank", "StudentRankSkillStatus",
  "PromotionEvent", "PromotionEventNoteLog", "SkillSignOffLog", "TrainingLog", "PromotionFeeRequest",
  "Charge", "ChargeAllocation", "BalanceEntry", "ChargeRefund", "RecurringCharge", "MembershipFreeze",
  "PackRecharge", "RankCorrectionRequest", "StudentNote", "MemberFile", "ChildInvite",
  "StudentHomeBranch", "StudentCheckInCode", "StudentJoinDate", "WaiverSignature"
  TO ultm8_jobs;
-- Moved by "userId" (the account a sign-up made or used).
GRANT SELECT ("id", "schoolId", "userId"), UPDATE ("userId") ON "SignUp" TO ultm8_jobs;
-- Learner data, one row per lesson: the duplicate's row for a lesson the
-- kept member already has is deleted.
GRANT SELECT ("id", "schoolId", "studentId", "lessonId"), UPDATE ("studentId"), DELETE ON "Favorite", "WatchHistory" TO ultm8_jobs;
-- Rosters and absence alerts (Decision 317): the jobs role already reads and
-- deletes them; it may now move an absence alert to the kept member.
GRANT UPDATE ("studentId") ON "StudentAbsenceAlert" TO ultm8_jobs;
-- One per School and member: the kept member's stays, the duplicate's goes.
GRANT DELETE ON "StudentCheckInCode", "StudentJoinDate", "StudentHomeBranch" TO ultm8_jobs;
GRANT SELECT ("joinedOn"), UPDATE ("joinedOn", "updatedAt") ON "StudentJoinDate" TO ultm8_jobs;
-- A signature the member signed themselves stays self-signed.
GRANT SELECT ("signedById", "status", "waiverId", "signedDate", "signerFullName", "signatureImageKey"), UPDATE ("signedById") ON "WaiverSignature" TO ultm8_jobs;
-- The merge's line in the Staff page's activity log (Decision 408).
GRANT INSERT ON "StaffActivity" TO ultm8_jobs;

-- Row policies the jobs role didn't have yet on these tables.
CREATE POLICY "promotion_event_jobs_merge" ON "PromotionEvent" FOR UPDATE TO ultm8_jobs USING (true) WITH CHECK (true);
CREATE POLICY "student_rank_skill_status_jobs_merge" ON "StudentRankSkillStatus" FOR UPDATE TO ultm8_jobs USING (true) WITH CHECK (true);
CREATE POLICY "student_home_branch_jobs_merge" ON "StudentHomeBranch" FOR UPDATE TO ultm8_jobs USING (true) WITH CHECK (true);
CREATE POLICY "student_check_in_code_jobs_merge" ON "StudentCheckInCode" FOR DELETE TO ultm8_jobs USING (true);
CREATE POLICY "promotion_event_note_log_jobs_read" ON "PromotionEventNoteLog" FOR SELECT TO ultm8_jobs USING (true);
CREATE POLICY "promotion_event_note_log_jobs_merge" ON "PromotionEventNoteLog" FOR UPDATE TO ultm8_jobs USING (true) WITH CHECK (true);
CREATE POLICY "skill_sign_off_log_jobs_read" ON "SkillSignOffLog" FOR SELECT TO ultm8_jobs USING (true);
CREATE POLICY "skill_sign_off_log_jobs_merge" ON "SkillSignOffLog" FOR UPDATE TO ultm8_jobs USING (true) WITH CHECK (true);
CREATE POLICY "training_log_jobs_read" ON "TrainingLog" FOR SELECT TO ultm8_jobs USING (true);
CREATE POLICY "training_log_jobs_merge" ON "TrainingLog" FOR UPDATE TO ultm8_jobs USING (true) WITH CHECK (true);
CREATE POLICY "favorite_jobs_read" ON "Favorite" FOR SELECT TO ultm8_jobs USING (true);
CREATE POLICY "favorite_jobs_merge" ON "Favorite" FOR UPDATE TO ultm8_jobs USING (true) WITH CHECK (true);
CREATE POLICY "favorite_jobs_merge_delete" ON "Favorite" FOR DELETE TO ultm8_jobs USING (true);
CREATE POLICY "watch_history_jobs_read" ON "WatchHistory" FOR SELECT TO ultm8_jobs USING (true);
CREATE POLICY "watch_history_jobs_merge" ON "WatchHistory" FOR UPDATE TO ultm8_jobs USING (true) WITH CHECK (true);
CREATE POLICY "watch_history_jobs_merge_delete" ON "WatchHistory" FOR DELETE TO ultm8_jobs USING (true);
CREATE POLICY "staff_activity_jobs_insert" ON "StaffActivity" FOR INSERT TO ultm8_jobs WITH CHECK (true);
