-- Notes in a student's grading history can be edited and hidden; every change
-- is kept (Decision 192).
--
-- PromotionEvent gains when its note was last edited (and by whom) and when it
-- was hidden from the student and guardian. PromotionEventNoteLog keeps every
-- change: edited / hidden / shown, the old text, the new, who and when.
--
-- The API writes both under the student's own context, like every grading
-- write (Decision 88). The log is readable by the School Owner/Manager only:
-- unlike SkillSignOffLog, the student may not read it, or a hidden note's
-- text would show there. The student's context may only insert log rows for
-- themselves (the API's write path), never read them back.

ALTER TABLE "PromotionEvent" ADD COLUMN "noteEditedAt" TIMESTAMP(3);
ALTER TABLE "PromotionEvent" ADD COLUMN "noteEditedById" TEXT;
ALTER TABLE "PromotionEvent" ADD COLUMN "noteHiddenAt" TIMESTAMP(3);
ALTER TABLE "PromotionEvent" ADD CONSTRAINT "PromotionEvent_noteEditedById_fkey"
  FOREIGN KEY ("noteEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "PromotionEventNoteChange" AS ENUM ('EDITED', 'HIDDEN', 'SHOWN');

CREATE TABLE "PromotionEventNoteLog" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "promotionEventId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "change" "PromotionEventNoteChange" NOT NULL,
    "oldNote" TEXT,
    "newNote" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromotionEventNoteLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PromotionEventNoteLog_promotionEventId_fkey" FOREIGN KEY ("promotionEventId") REFERENCES "PromotionEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PromotionEventNoteLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "PromotionEventNoteLog_schoolId_idx" ON "PromotionEventNoteLog"("schoolId");
CREATE INDEX "PromotionEventNoteLog_promotionEventId_idx" ON "PromotionEventNoteLog"("promotionEventId");

-- Append-only from the app: no UPDATE or DELETE grant.
GRANT SELECT, INSERT ON "PromotionEventNoteLog" TO ultm8_app;

ALTER TABLE "PromotionEventNoteLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromotionEventNoteLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "promotion_event_note_log_owner_read" ON "PromotionEventNoteLog"
  FOR SELECT
  USING (is_active_school_owner_manager("PromotionEventNoteLog"."schoolId"));
CREATE POLICY "promotion_event_note_log_written_as_student" ON "PromotionEventNoteLog"
  FOR INSERT
  WITH CHECK ("PromotionEventNoteLog"."studentId" = current_setting('app.current_user_id', true));
