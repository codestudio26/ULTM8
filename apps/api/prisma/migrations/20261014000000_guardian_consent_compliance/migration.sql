-- Guardian consent compliance fixes (Decisions 170–173), from the Guardian
-- consent legal review of 16 Oct 2026:
--   170: append-only consent history (ConsentEvent)
--   171: versioned legal documents published by a Platform Admin
--   172: GuardianLink confirmation by a School, and who may confirm
--   173: erasing a minor's data when the last baseline consent is withdrawn
-- Additive (Decision 32), except two narrowings of ultm8_app's own rights on
-- GuardianLink, explained below.

-- ============================================================================
-- Decision 170 — ConsentEvent
-- ============================================================================

CREATE TYPE "ConsentEventType" AS ENUM ('GRANTED', 'WITHDRAWN');

-- RESTRICT on every FK, same audit-trail reasoning as ConsentRecord's own
-- (20260916000000): this table is the evidence, so nothing may delete it from
-- underneath. Decision 173 keeps the erased minor's User row for this reason.
CREATE TABLE "ConsentEvent" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "consentRecordId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "tier" "ConsentTier" NOT NULL,
    "type" "ConsentEventType" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "parentalResponsibilityDeclared" BOOLEAN NOT NULL DEFAULT false,
    "backfilled" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsentEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ConsentEvent_consentRecordId_fkey" FOREIGN KEY ("consentRecordId") REFERENCES "ConsentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ConsentEvent_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ConsentEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ConsentEvent_consentRecordId_occurredAt_idx" ON "ConsentEvent"("consentRecordId", "occurredAt");
CREATE INDEX "ConsentEvent_guardianId_occurredAt_idx" ON "ConsentEvent"("guardianId", "occurredAt");
CREATE INDEX "ConsentEvent_studentId_idx" ON "ConsentEvent"("studentId");

-- Append-only: SELECT and INSERT only, for every role. No UPDATE or DELETE grant
-- exists anywhere, so the database itself refuses to change history.
GRANT SELECT, INSERT ON "ConsentEvent" TO ultm8_app;

ALTER TABLE "ConsentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsentEvent" FORCE ROW LEVEL SECURITY;
-- Same narrow self-only shape as ConsentRecord (Decision 92): the Guardian reads
-- and writes only their own events.
CREATE POLICY "consent_event_self_only" ON "ConsentEvent"
  USING ("ConsentEvent"."guardianId" = current_setting('app.current_user_id', true));

-- Backfill (Decision 170, point 4): one GRANTED event per existing record, plus a
-- WITHDRAWN event for withdrawn ones. Marked backfilled — the real earlier history
-- was overwritten before this table existed and cannot be recovered.
INSERT INTO "ConsentEvent" ("consentRecordId", "guardianId", "studentId", "tier", "type", "policyVersion", "backfilled", "occurredAt")
SELECT "id", "guardianId", "studentId", "tier", 'GRANTED', "policyVersion", true, "consentedAt"
FROM "ConsentRecord";

INSERT INTO "ConsentEvent" ("consentRecordId", "guardianId", "studentId", "tier", "type", "policyVersion", "backfilled", "occurredAt")
SELECT "id", "guardianId", "studentId", "tier", 'WITHDRAWN', "policyVersion", true, "withdrawnAt"
FROM "ConsentRecord"
WHERE "status" = 'WITHDRAWN' AND "withdrawnAt" IS NOT NULL;

-- ============================================================================
-- Decision 171 — LegalDocument versions
-- ============================================================================

ALTER TABLE "LegalDocument" ADD COLUMN "currentVersion" INTEGER;

CREATE TABLE "LegalDocumentVersion" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "publishedByAdminId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegalDocumentVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LegalDocumentVersion_slug_fkey" FOREIGN KEY ("slug") REFERENCES "LegalDocument"("slug") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LegalDocumentVersion_publishedByAdminId_fkey" FOREIGN KEY ("publishedByAdminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LegalDocumentVersion_slug_version_key" ON "LegalDocumentVersion"("slug", "version");

-- No RLS, same as LegalDocument: global, platform-level content. Published
-- versions are never changed, so no UPDATE or DELETE.
GRANT SELECT, INSERT ON "LegalDocumentVersion" TO ultm8_app;

-- ============================================================================
-- Decision 172 — GuardianLink confirmation
-- ============================================================================

ALTER TABLE "GuardianLink" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "GuardianLink" ADD COLUMN "confirmedById" TEXT;
ALTER TABLE "GuardianLink" ADD COLUMN "confirmedSchoolId" TEXT;
ALTER TABLE "GuardianLink" ADD CONSTRAINT "GuardianLink_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GuardianLink" ADD CONSTRAINT "GuardianLink_confirmedSchoolId_fkey" FOREIGN KEY ("confirmedSchoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- No backfill: existing links start unconfirmed (Decision 172, point 3).

-- Narrowing ultm8_app's rights on GuardianLink to the columns its code actually
-- writes. Without this, a Guardian's own self-only policy would let the Guardian's
-- context set confirmedAt on their own link. Only GuardianLinkConfirmationsService
-- writes the confirmation columns, through ultm8_jobs, after its own authorization.
-- (Grepped: GuardiansService.createMinor() inserts id/guardianId/studentId; the
-- only UPDATE is setting revokedAt.)
REVOKE INSERT, UPDATE ON "GuardianLink" FROM ultm8_app;
GRANT INSERT ("id", "guardianId", "studentId", "createdAt", "revokedAt") ON "GuardianLink" TO ultm8_app;
GRANT UPDATE ("revokedAt") ON "GuardianLink" TO ultm8_app;

GRANT SELECT, UPDATE ("confirmedAt", "confirmedById", "confirmedSchoolId") ON "GuardianLink" TO ultm8_jobs;
CREATE POLICY "guardian_link_jobs_read" ON "GuardianLink"
  FOR SELECT
  TO ultm8_jobs
  USING (true);
CREATE POLICY "guardian_link_jobs_confirm" ON "GuardianLink"
  FOR UPDATE
  TO ultm8_jobs
  USING (true)
  WITH CHECK (true);

-- GuardianLinkConfirmationEvent: append-only history of confirmations and
-- un-confirmations, so un-confirming never erases who confirmed a link and when.
-- RESTRICT FKs for the same audit reason as ConsentEvent.
CREATE TYPE "GuardianLinkConfirmationEventType" AS ENUM ('CONFIRMED', 'UNCONFIRMED');
CREATE TABLE "GuardianLinkConfirmationEvent" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "guardianLinkId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "type" "GuardianLinkConfirmationEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuardianLinkConfirmationEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GuardianLinkConfirmationEvent_guardianLinkId_fkey" FOREIGN KEY ("guardianLinkId") REFERENCES "GuardianLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GuardianLinkConfirmationEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GuardianLinkConfirmationEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "GuardianLinkConfirmationEvent_guardianLinkId_occurredAt_idx" ON "GuardianLinkConfirmationEvent"("guardianLinkId", "occurredAt");
CREATE INDEX "GuardianLinkConfirmationEvent_schoolId_idx" ON "GuardianLinkConfirmationEvent"("schoolId");
-- ultm8_jobs only, SELECT and INSERT only: append-only, and no app-role access.
GRANT SELECT, INSERT ON "GuardianLinkConfirmationEvent" TO ultm8_jobs;
ALTER TABLE "GuardianLinkConfirmationEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuardianLinkConfirmationEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "guardian_link_confirmation_event_jobs_read" ON "GuardianLinkConfirmationEvent" FOR SELECT TO ultm8_jobs USING (true);
CREATE POLICY "guardian_link_confirmation_event_jobs_insert" ON "GuardianLinkConfirmationEvent" FOR INSERT TO ultm8_jobs WITH CHECK (true);

-- GuardianLinkConfirmer: same shape as GradingPermission (20261013000000).
CREATE TABLE "GuardianLinkConfirmer" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuardianLinkConfirmer_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GuardianLinkConfirmer_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GuardianLinkConfirmer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GuardianLinkConfirmer_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GuardianLinkConfirmer_schoolId_userId_key" ON "GuardianLinkConfirmer"("schoolId", "userId");
CREATE INDEX "GuardianLinkConfirmer_userId_idx" ON "GuardianLinkConfirmer"("userId");
GRANT SELECT, INSERT, DELETE ON "GuardianLinkConfirmer" TO ultm8_app;

ALTER TABLE "GuardianLinkConfirmer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuardianLinkConfirmer" FORCE ROW LEVEL SECURITY;
-- Only the School Owner/Manager manages these; a staff member can read their own.
CREATE POLICY "guardian_link_confirmer_owner_manage" ON "GuardianLinkConfirmer"
  USING (is_active_school_owner_manager("GuardianLinkConfirmer"."schoolId"));
CREATE POLICY "guardian_link_confirmer_self_read" ON "GuardianLinkConfirmer"
  FOR SELECT
  USING ("GuardianLinkConfirmer"."userId" = current_setting('app.current_user_id', true));

-- Decision 173's column, added here because the grant just below names it.
ALTER TABLE "User" ADD COLUMN "erasedAt" TIMESTAMP(3);

-- The confirmation list shows staff who the Guardian and the minor are. ultm8_jobs
-- already reads User (user_jobs_read, USING true) but only specific columns.
GRANT SELECT ("firstName", "surname", "dateOfBirth", "phone", "erasedAt") ON "User" TO ultm8_jobs;

-- ============================================================================
-- Decision 173 — erasing a minor's data
-- ============================================================================

-- MinorErasureService runs as ultm8_jobs: the withdrawing Guardian's own context
-- cannot see the minor's School-scoped rows. User stays (anonymised): the kept
-- Transaction and WaiverSignature rows have ON DELETE CASCADE FKs to User, so
-- deleting the row would delete exactly the records Decision 173 keeps.
GRANT UPDATE (
  "email", "phone", "firstName", "surname", "username", "passcodeHash",
  "dateOfBirth", "gender", "nationality", "language", "currency", "address",
  "profilePhotoUrl", "erasedAt", "updatedAt"
) ON "User" TO ultm8_jobs;
-- user_jobs_update (existing) already admits ultm8_jobs UPDATEs on any row.

-- DELETE needs SELECT on the rows too (the WHERE clause reads them), so each
-- table gets both, unless an existing ultm8_jobs SELECT policy already covers it
-- (Booking, WaitlistEntry, Notification). Child rows of StudentRank
-- (StudentRankSkillStatus, PromotionEvent, SkillSignOffLog) and of Booking
-- (BookingAttendee) go by their own ON DELETE CASCADE FKs, which need no grant.

GRANT SELECT, DELETE ON "StudentRank" TO ultm8_jobs;
CREATE POLICY "student_rank_jobs_erasure_read" ON "StudentRank" FOR SELECT TO ultm8_jobs USING (true);
CREATE POLICY "student_rank_jobs_erasure_delete" ON "StudentRank" FOR DELETE TO ultm8_jobs USING (true);

GRANT SELECT, DELETE ON "StudentHomeBranch" TO ultm8_jobs;
CREATE POLICY "student_home_branch_jobs_erasure_read" ON "StudentHomeBranch" FOR SELECT TO ultm8_jobs USING (true);
CREATE POLICY "student_home_branch_jobs_erasure_delete" ON "StudentHomeBranch" FOR DELETE TO ultm8_jobs USING (true);

GRANT DELETE ON "Booking" TO ultm8_jobs;
CREATE POLICY "booking_jobs_erasure_delete" ON "Booking" FOR DELETE TO ultm8_jobs USING (true);

GRANT DELETE ON "WaitlistEntry" TO ultm8_jobs;
CREATE POLICY "waitlist_entry_jobs_erasure_delete" ON "WaitlistEntry" FOR DELETE TO ultm8_jobs USING (true);

GRANT DELETE ON "Notification" TO ultm8_jobs;
CREATE POLICY "notification_jobs_erasure_delete" ON "Notification" FOR DELETE TO ultm8_jobs USING (true);

GRANT SELECT, DELETE ON "DeviceToken" TO ultm8_jobs;
CREATE POLICY "device_token_jobs_erasure_read" ON "DeviceToken" FOR SELECT TO ultm8_jobs USING (true);
CREATE POLICY "device_token_jobs_erasure_delete" ON "DeviceToken" FOR DELETE TO ultm8_jobs USING (true);

GRANT SELECT, DELETE ON "BookingDelegation" TO ultm8_jobs;
CREATE POLICY "booking_delegation_jobs_erasure_read" ON "BookingDelegation" FOR SELECT TO ultm8_jobs USING (true);
CREATE POLICY "booking_delegation_jobs_erasure_delete" ON "BookingDelegation" FOR DELETE TO ultm8_jobs USING (true);
