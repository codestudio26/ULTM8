-- Decision 426 (builds Decision 423 item 8; amends Decisions 269 and 354 W16):
-- how long signed waivers are kept. The daily entity-offboarding-purge job
-- applies the rule (apps/api/src/waivers/waiver-retention.ts); this migration
-- gives it the data it needs, makes the database refuse to delete a signature
-- any other way, and adds a permanent log of what the job deletes.

-- 1. The Student's 18th birthday, saved on the signature when it is signed,
--    so a later change to the date of birth cannot change whether it was a
--    child's waiver. Age of majority is 18 everywhere for now (Decision 426
--    item 8). A 29 February birthday is reached on 1 March (18 years after a
--    leap year is never a leap year), the same as the API's addYearsUtc.
ALTER TABLE "WaiverSignature"
  ADD COLUMN "studentMajorityDate" DATE,
  -- A signature left on a merged-away duplicate record (both records had
  -- signed the same waiver): the kept record's id. While either record is a
  -- member of the School, the signature is a member's. A plain id, no
  -- foreign key, like PromotionEvent.mergedFromUserId.
  ADD COLUMN "mergedIntoStudentId" TEXT;

CREATE FUNCTION public."waiver_age_of_majority_date"(dob date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN dob IS NULL THEN NULL
    WHEN EXTRACT(MONTH FROM dob) = 2 AND EXTRACT(DAY FROM dob) = 29 THEN (dob + interval '18 years')::date + 1
    ELSE (dob + interval '18 years')::date
  END
$$;

-- Backfill every signature already given from the date of birth on file now.
UPDATE "WaiverSignature" ws
SET "studentMajorityDate" = public."waiver_age_of_majority_date"(u."dateOfBirth")
FROM "User" u
WHERE u."id" = ws."studentId"
  AND ws."status" IN ('SIGNED', 'EXPIRED')
  AND u."dateOfBirth" IS NOT NULL;

-- Set on every path that signs (online, on paper, by a Guardian, or any later
-- one), and on any later write while it is still empty (a date of birth
-- added after signing). Never changed once set. SECURITY DEFINER, owned by
-- the BYPASSRLS helper role, as stamp_user_roles_changed_at: the person
-- signing (a Guardian, or a School owner recording paper) may not be able to
-- read the Student's User row under its own RLS. It reads one column.
CREATE FUNCTION "waiver_signature_save_majority_date"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW."status" IN ('SIGNED', 'EXPIRED') AND NEW."studentMajorityDate" IS NULL THEN
    NEW."studentMajorityDate" := (
      SELECT public."waiver_age_of_majority_date"(u."dateOfBirth") FROM public."User" u WHERE u."id" = NEW."studentId"
    );
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION "waiver_signature_save_majority_date"() OWNER TO ultm8_rls_helper;
GRANT SELECT ("id", "dateOfBirth") ON "User" TO ultm8_rls_helper;

CREATE TRIGGER "WaiverSignature_save_majority_date"
BEFORE INSERT OR UPDATE ON "WaiverSignature"
FOR EACH ROW EXECUTE FUNCTION "waiver_signature_save_majority_date"();

-- 2. Merges already made (Decision 422 item 7, PR #440): a signature left on
--    the duplicate points at the record it was merged into, read from the
--    merge's line in the Staff activity log (the latest merge of that
--    duplicate at that School).
UPDATE "WaiverSignature" ws
SET "mergedIntoStudentId" = m."keptId"
FROM (
  SELECT DISTINCT ON (sa."schoolId", sa."details"->>'duplicateId')
    sa."schoolId", sa."details"->>'duplicateId' AS "duplicateId", sa."targetUserId" AS "keptId"
  FROM "StaffActivity" sa
  WHERE sa."action" = 'MEMBERS_MERGED' AND sa."targetUserId" IS NOT NULL AND sa."details"->>'duplicateId' IS NOT NULL
  ORDER BY sa."schoolId", sa."details"->>'duplicateId', sa."createdAt" DESC
) m
WHERE ws."schoolId" = m."schoolId" AND ws."studentId" = m."duplicateId";

-- 3. Only the retention job deletes a signature. Deleting a Waiver or a User
--    that still has one is refused (before: CASCADE, which the schema and
--    the purge job's own comments already, wrongly, called RESTRICT). The
--    Prisma schema now says onDelete: Restrict, matching.
ALTER TABLE "WaiverSignature"
  DROP CONSTRAINT "WaiverSignature_waiverId_fkey",
  ADD CONSTRAINT "WaiverSignature_waiverId_fkey" FOREIGN KEY ("waiverId") REFERENCES "Waiver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WaiverSignature"
  DROP CONSTRAINT "WaiverSignature_studentId_fkey",
  ADD CONSTRAINT "WaiverSignature_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Decision 426 item 2: once a closed School (past its 90 days, so
--    anonymized and no longer reopenable) has no signature left, member or
--    guest, the tenant-lifecycle purge deletes its Waiver templates and then
--    the School. The jobs role may delete a Waiver only of such a School;
--    WaiverSignature.waiverId (RESTRICT, above) still refuses while any
--    signature remains.
GRANT DELETE ON "Waiver" TO ultm8_jobs;
CREATE POLICY "waiver_jobs_delete_purged_school" ON "Waiver"
  FOR DELETE
  TO ultm8_jobs
  USING (EXISTS (SELECT 1 FROM "School" s WHERE s."id" = "Waiver"."schoolId" AND s."purgedAt" IS NOT NULL));

-- 5. A permanent record of each signature the job deletes: which, whose
--    School, under which rule and until when it was kept. No personal data
--    (no names, dates of birth or text; the SHA-256 of the wording signed is
--    of the School's text, not of the person). schoolId has no foreign key,
--    so the record outlives a deleted School. Only the jobs role writes it,
--    and only by INSERT; nothing reads it through the API, and the app role
--    has no access at all.
CREATE TYPE "WaiverSignaturePurgeKind" AS ENUM ('MEMBER', 'GUEST');
CREATE TYPE "WaiverPurgeRule" AS ENUM (
  'ADULT_LEFT',
  'CHILD_LEFT',
  'ADULT_NEVER_MEMBER',
  'CHILD_NEVER_MEMBER',
  'LEFT_UNSIGNED',
  'GUEST_ADULT',
  'GUEST_CHILD'
);

CREATE TABLE "WaiverSignaturePurgeLog" (
    "id" TEXT NOT NULL,
    "kind" "WaiverSignaturePurgeKind" NOT NULL,
    "schoolId" TEXT NOT NULL,
    "signatureId" TEXT NOT NULL,
    "waiverId" TEXT NOT NULL,
    "signedWaiverSha256" TEXT,
    "rule" "WaiverPurgeRule" NOT NULL,
    "retainUntil" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WaiverSignaturePurgeLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WaiverSignaturePurgeLog_schoolId_purgedAt_idx" ON "WaiverSignaturePurgeLog"("schoolId", "purgedAt");

ALTER TABLE "WaiverSignaturePurgeLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WaiverSignaturePurgeLog" FORCE ROW LEVEL SECURITY;
GRANT INSERT ON "WaiverSignaturePurgeLog" TO ultm8_jobs;
CREATE POLICY "waiver_signature_purge_log_jobs_insert" ON "WaiverSignaturePurgeLog"
  FOR INSERT
  TO ultm8_jobs
  WITH CHECK (true);
