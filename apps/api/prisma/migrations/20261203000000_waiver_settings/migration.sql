-- Decision 354: Waiver settings per School, paper signatures and reminders.
CREATE TYPE "WaiverSignatureMethod" AS ENUM ('ONLINE', 'PAPER');

ALTER TABLE "School"
  ADD COLUMN "waiverArchivedSignaturesCount" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "waiverRenewalMonths" INTEGER,
  ADD COLUMN "waiverMinorsSignAgainAt18" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "waiverPaperSignaturesAllowed" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "waiverNoticeOnJoin" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "waiverReminderDays" INTEGER;

ALTER TABLE "WaiverSignature"
  ADD COLUMN "method" "WaiverSignatureMethod" NOT NULL DEFAULT 'ONLINE',
  ADD COLUMN "recordedById" TEXT,
  ADD COLUMN "lastRemindedAt" TIMESTAMP(3);

-- The daily waiver-renewal-sweep job (ultm8_jobs) expires old signatures,
-- writes the new unsigned entries and records reminders.
GRANT INSERT, UPDATE ON "WaiverSignature" TO ultm8_jobs;

CREATE POLICY "waiver_signature_jobs_insert" ON "WaiverSignature"
  FOR INSERT
  TO ultm8_jobs
  WITH CHECK (true);

CREATE POLICY "waiver_signature_jobs_update" ON "WaiverSignature"
  FOR UPDATE
  TO ultm8_jobs
  USING (true)
  WITH CHECK (true);
