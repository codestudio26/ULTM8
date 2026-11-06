-- "Delete my account" (Decision 427 item 5; the product owner's six rules of
-- 6 Nov 2026). A member asks; the account is locked at once; signing in again
-- within 30 days cancels; after 30 days the account-erasure job anonymises it
-- in place ("Erased User", Decision 245's anonymise-in-place design).

-- 1. The request on the User row.
ALTER TABLE "User"
  ADD COLUMN "deletionRequestedAt" TIMESTAMP(3),
  ADD COLUMN "deletionDueAt" TIMESTAMP(3),
  ADD COLUMN "deletionRequestedById" TEXT,
  ADD COLUMN "erasedAt" TIMESTAMP(3);
CREATE INDEX "User_deletionDueAt_idx" ON "User"("deletionDueAt");

-- The member writes their own row (and a child's, as the child) through the
-- existing table-level grant and user_self_or_shared_school policy. The jobs
-- role reads the new columns to find accounts that are due and to lock out
-- bookings, check-ins and purchases (it already reads id, email and names),
-- and may clear a child's request when the child gained another parent.
GRANT SELECT ("deletionRequestedAt", "deletionDueAt", "deletionRequestedById", "erasedAt") ON "User" TO ultm8_jobs;
GRANT UPDATE ("deletionRequestedAt", "deletionDueAt", "deletionRequestedById") ON "User" TO ultm8_jobs;

-- 2. The permanent internal record: ids and dates only, no personal details.
-- Only the jobs role may add to it; no app role may read it.
CREATE TYPE "AccountErasureEvent" AS ENUM ('REQUESTED', 'CANCELLED', 'ERASED', 'KEPT');
CREATE TABLE "AccountErasureLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "event" "AccountErasureEvent" NOT NULL,
    "requestedById" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountErasureLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AccountErasureLog_userId_idx" ON "AccountErasureLog"("userId");
ALTER TABLE "AccountErasureLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountErasureLog" FORCE ROW LEVEL SECURITY;
GRANT INSERT ON "AccountErasureLog" TO ultm8_jobs;
CREATE POLICY "account_erasure_log_jobs_insert" ON "AccountErasureLog"
  FOR INSERT
  TO ultm8_jobs
  WITH CHECK (true);

-- 3. The erasure itself: one narrow SECURITY DEFINER function owned by the
-- NOLOGIN ultm8_rls_helper (BYPASSRLS), so the shared ultm8_jobs role gets no
-- new write access to names, emails or passcodes — only EXECUTE on this, and
-- the function refuses any account whose 30 days are not over. It returns the
-- old photo URL so the job can delete the image from storage.
GRANT UPDATE (
  "email", "phone", "firstName", "surname", "username", "passcodeHash", "mustChangePasscode",
  "temporaryPasscodeExpiresAt", "temporaryPasscodeSchoolId", "phoneVerifiedAt", "dateOfBirth",
  "gender", "nationality", "language", "currency", "address", "addressLine1", "addressLine2",
  "addressCity", "addressRegion", "addressPostalCode", "addressCountry", "profilePhotoUrl",
  "weightCategory", "kimonoSize", "beltSize", "secondaryPhone", "secondaryEmail",
  "emergencyContactName", "emergencyContactPhone", "emergencyContactRelationship",
  "rolesChangedAt", "erasedAt", "updatedAt"
) ON "User" TO ultm8_rls_helper;
GRANT SELECT ("userId"), DELETE ON "RefreshToken" TO ultm8_rls_helper;
GRANT SELECT ("userId"), DELETE ON "DeviceToken" TO ultm8_rls_helper;
GRANT SELECT ("studentId"), DELETE ON "StudentMedicalInfo" TO ultm8_rls_helper;
GRANT SELECT ("studentId"), DELETE ON "StudentPaymentMethod" TO ultm8_rls_helper;
GRANT SELECT ("userId"), DELETE ON "Notification" TO ultm8_rls_helper;
GRANT SELECT ("studentId"), DELETE ON "StudentCheckInCode" TO ultm8_rls_helper;
GRANT DELETE ON "StudentHomeBranch" TO ultm8_rls_helper;
GRANT SELECT ("userId"), DELETE ON "SignUp" TO ultm8_rls_helper;
GRANT SELECT ("guardianId", "studentId", "revokedAt"), UPDATE ("revokedAt") ON "GuardianLink" TO ultm8_rls_helper;
GRANT UPDATE ("revokedAt", "pausedAt", "pausedById", "updatedAt") ON "RoleGrant" TO ultm8_rls_helper;
GRANT SELECT ("studentId", "signedById", "signerFullName", "signatureText"), UPDATE ("signerFullName", "signatureText", "updatedAt") ON "WaiverSignature" TO ultm8_rls_helper;
GRANT SELECT ("signedById"), UPDATE ("signerFullName", "signatureText") ON "PlanContractSignature" TO ultm8_rls_helper;
GRANT INSERT ON "AccountErasureLog" TO ultm8_rls_helper;
-- The rest of their personal data at each School (owner's answers on #497,
-- 6 Nov 2026): staff notes, custom fields and statuses, tags, import rows,
-- invites, and their name copied into older staff activity lines and notices.
-- Member files are unlinked here and deleted (stored copy first) by the job.
GRANT SELECT ("studentId"), DELETE ON "StudentNote" TO ultm8_rls_helper;
GRANT SELECT ("studentId"), DELETE ON "CustomMemberFieldValue" TO ultm8_rls_helper;
GRANT SELECT ("studentId"), DELETE ON "StudentCustomStatus" TO ultm8_rls_helper;
GRANT SELECT ("studentId"), DELETE ON "StudentTag" TO ultm8_rls_helper;
GRANT SELECT ("studentId"), DELETE ON "DataImportRow" TO ultm8_rls_helper;
GRANT SELECT ("guardianId", "studentId"), DELETE ON "ChildInvite" TO ultm8_rls_helper;
GRANT SELECT ("email", "acceptedById"), DELETE ON "CoachInvite" TO ultm8_rls_helper;
GRANT SELECT ("studentId"), UPDATE ("studentId") ON "MemberFile" TO ultm8_rls_helper;
GRANT SELECT ("actorId", "targetUserId", "details"), UPDATE ("details") ON "StaffActivity" TO ultm8_rls_helper;
GRANT SELECT ("schoolId", "title", "body"), UPDATE ("title", "body") ON "Notification" TO ultm8_rls_helper;

CREATE FUNCTION "erase_due_account"(p_user_id text, p_passcode_hash text)
RETURNS TABLE (erased boolean, old_photo_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_photo text;
  v_by text;
  v_first text;
  v_surname text;
  v_email text;
  v_name text;
  v_json_name text;
  v_now timestamp(3) := (now() AT TIME ZONE 'UTC');
BEGIN
  SELECT u."profilePhotoUrl", u."deletionRequestedById", u."firstName", u."surname", u."email"
    INTO v_photo, v_by, v_first, v_surname, v_email
    FROM "User" u
   WHERE u."id" = p_user_id
     AND u."erasedAt" IS NULL
     AND u."deletionRequestedAt" IS NOT NULL
     AND u."deletionDueAt" <= v_now
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text;
    RETURN;
  END IF;

  -- Their name as other rows copied it ("First Surname", or the first name
  -- alone when there is no real surname), and as it reads inside JSON.
  v_name := btrim(CASE WHEN btrim(coalesce(v_surname, '')) IN ('', '.', '-', '_') THEN v_first ELSE v_first || ' ' || v_surname END);
  v_json_name := substr(to_jsonb(v_name)::text, 2, length(to_jsonb(v_name)::text) - 2);

  -- The person: name, contact details, date of birth, photo, passcode and
  -- the rest of the profile go for good. The row stays (with its id) so
  -- payments, waivers, contracts and grading history keep their link.
  UPDATE "User" SET
    "email" = 'erased+' || p_user_id || '@erased.ultm8.internal',
    "phone" = NULL, "firstName" = 'Erased', "surname" = 'User', "username" = NULL,
    "passcodeHash" = p_passcode_hash, "mustChangePasscode" = false,
    "temporaryPasscodeExpiresAt" = NULL, "temporaryPasscodeSchoolId" = NULL, "phoneVerifiedAt" = NULL,
    "dateOfBirth" = NULL, "gender" = NULL, "nationality" = NULL, "language" = NULL, "currency" = NULL,
    "address" = NULL, "addressLine1" = NULL, "addressLine2" = NULL, "addressCity" = NULL,
    "addressRegion" = NULL, "addressPostalCode" = NULL, "addressCountry" = NULL, "profilePhotoUrl" = NULL,
    "weightCategory" = NULL, "kimonoSize" = NULL, "beltSize" = NULL, "secondaryPhone" = NULL,
    "secondaryEmail" = NULL, "emergencyContactName" = NULL, "emergencyContactPhone" = NULL,
    "emergencyContactRelationship" = NULL, "rolesChangedAt" = v_now, "erasedAt" = v_now, "updatedAt" = v_now
  WHERE "id" = p_user_id;

  -- Sign-ins, devices, medical notes, saved cards, their inbox, check-in
  -- codes and the sign-up forms that copied their details.
  DELETE FROM "RefreshToken" WHERE "userId" = p_user_id;
  DELETE FROM "DeviceToken" WHERE "userId" = p_user_id;
  DELETE FROM "StudentMedicalInfo" WHERE "studentId" = p_user_id;
  DELETE FROM "StudentPaymentMethod" WHERE "studentId" = p_user_id;
  DELETE FROM "Notification" WHERE "userId" = p_user_id;
  DELETE FROM "StudentCheckInCode" WHERE "studentId" = p_user_id;
  DELETE FROM "StudentHomeBranch" WHERE "studentId" = p_user_id;
  DELETE FROM "SignUp" WHERE "userId" = p_user_id;

  -- They leave every School and every family link: each role ends today
  -- (which also starts the signed-waiver retention clock, Decision 426).
  UPDATE "GuardianLink" SET "revokedAt" = v_now
   WHERE ("guardianId" = p_user_id OR "studentId" = p_user_id) AND "revokedAt" IS NULL;
  UPDATE "RoleGrant" SET "revokedAt" = v_now, "updatedAt" = v_now
   WHERE "userId" = p_user_id AND "revokedAt" IS NULL;
  UPDATE "RoleGrant" SET "pausedAt" = NULL, "pausedById" = NULL, "updatedAt" = v_now
   WHERE "userId" = p_user_id AND "pausedAt" IS NOT NULL;

  -- Signed waivers and contracts stay with the School but no longer name
  -- them: the typed name on what they signed (themselves, or for a child),
  -- and on their own waivers signed on paper or with no signer recorded.
  UPDATE "WaiverSignature" SET "signerFullName" = 'Erased User', "signatureText" = 'Erased User', "updatedAt" = v_now
   WHERE ("signedById" = p_user_id OR ("studentId" = p_user_id AND "signedById" IS NULL))
     AND ("signerFullName" IS NOT NULL OR "signatureText" IS NOT NULL);
  UPDATE "PlanContractSignature" SET "signerFullName" = 'Erased User', "signatureText" = 'Erased User'
   WHERE "signedById" = p_user_id;

  -- The rest of their personal data at each School. Attendance and check-in
  -- history stay (they show the person as "Erased User").
  DELETE FROM "StudentNote" WHERE "studentId" = p_user_id;
  DELETE FROM "CustomMemberFieldValue" WHERE "studentId" = p_user_id;
  DELETE FROM "StudentCustomStatus" WHERE "studentId" = p_user_id;
  DELETE FROM "StudentTag" WHERE "studentId" = p_user_id;
  DELETE FROM "DataImportRow" WHERE "studentId" = p_user_id;
  DELETE FROM "ChildInvite" WHERE "guardianId" = p_user_id OR "studentId" = p_user_id;
  DELETE FROM "CoachInvite" WHERE "acceptedById" = p_user_id OR lower("email") = lower(v_email);
  -- Unlinked: the account-erasure job (or the daily offboarding sweep, which
  -- takes every file with no member) deletes the stored copy, then the row.
  UPDATE "MemberFile" SET "studentId" = NULL WHERE "studentId" = p_user_id;
  -- Their name, copied into older staff activity lines about them and into
  -- notices at their Schools or to their family, becomes "Erased User". A
  -- name under three characters is too short to replace safely and is left.
  IF length(v_name) >= 3 THEN
    UPDATE "StaffActivity" SET "details" = replace("details"::text, v_json_name, 'Erased User')::jsonb
     WHERE "details" IS NOT NULL
       AND ("actorId" = p_user_id OR "targetUserId" = p_user_id OR strpos("details"::text, p_user_id) > 0)
       AND strpos("details"::text, v_json_name) > 0;
    UPDATE "Notification" SET "title" = replace("title", v_name, 'Erased User'), "body" = replace("body", v_name, 'Erased User')
     WHERE (strpos("title", v_name) > 0 OR strpos("body", v_name) > 0)
       AND ("schoolId" IN (SELECT rg."schoolId" FROM "RoleGrant" rg WHERE rg."userId" = p_user_id AND rg."schoolId" IS NOT NULL)
            OR "userId" IN (SELECT gl."guardianId" FROM "GuardianLink" gl WHERE gl."studentId" = p_user_id
                            UNION SELECT gl."studentId" FROM "GuardianLink" gl WHERE gl."guardianId" = p_user_id));
  END IF;

  INSERT INTO "AccountErasureLog" ("id", "userId", "event", "requestedById", "at")
  VALUES (gen_random_uuid()::text, p_user_id, 'ERASED', v_by, v_now);

  RETURN QUERY SELECT true, v_photo;
END;
$$;
ALTER FUNCTION "erase_due_account"(text, text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "erase_due_account"(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "erase_due_account"(text, text) TO ultm8_jobs;
