-- Decision 448 (stress test round 6 answers), items 8 and 10.
--
-- Item 8: people the School creates (added manually, approved tablet
-- sign-ups, imports, Guardians added by staff) tick the Terms and Privacy
-- "I agree" the first time they sign in, recorded as a LegalAcceptance like
-- sign-up's (Decision 444). Those rows are marked "atFirstSignIn", so they
-- never count as signing up themselves for the 18th-birthday rule (Decision
-- 446 item 8): the School still counts the birthday on its own date for
-- people it created. self_signed_up_users (20270332000002) leaves them out.
--
-- Item 10: "Delete my account" (erase_due_account) also clears an erased
-- coach's postal address and certification file on every coach profile.
-- Same function, same signature and owner; only the body grows, so
-- ultm8_jobs keeps exactly its EXECUTE and nothing more.

ALTER TABLE "LegalAcceptance" ADD COLUMN "atFirstSignIn" BOOLEAN NOT NULL DEFAULT false;

GRANT SELECT ("atFirstSignIn") ON "LegalAcceptance" TO ultm8_rls_helper;

CREATE OR REPLACE FUNCTION "self_signed_up_users"(p_user_ids text[])
RETURNS SETOF text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT DISTINCT la."userId"
  FROM public."LegalAcceptance" la
  WHERE la."userId" = ANY (p_user_ids)
    AND la."documentSlug" = 'terms-and-conditions'
    AND la."schoolId" IS NULL
    AND la."franchiseId" IS NULL
    AND NOT la."atFirstSignIn";
$$;

GRANT UPDATE ("address", "addressLine1", "addressLine2", "addressCity", "addressRegion",
              "addressPostalCode", "addressCountry", "certificationKey") ON "Instructor" TO ultm8_rls_helper;

CREATE OR REPLACE FUNCTION "erase_due_account"(p_user_id text, p_passcode_hash text)
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

  -- Decision 445 item 1 (round 6, P-1): their coach profile at each School
  -- loses its phone, bio and photo (the account-erasure job read the photo
  -- addresses first and deletes the files) and is archived, so members no
  -- longer see it; its 90 days then run as for any archived profile
  -- (Decision 226). A profile already archived keeps its own purge date.
  -- Decision 448 item 10: their postal address and certification file go
  -- too (the account-erasure job read the file keys first and deletes the
  -- stored files after).
  UPDATE "Instructor" SET
    "phone" = NULL, "bio" = NULL, "photoUrl" = NULL,
    "address" = NULL, "addressLine1" = NULL, "addressLine2" = NULL, "addressCity" = NULL,
    "addressRegion" = NULL, "addressPostalCode" = NULL, "addressCountry" = NULL,
    "certificationKey" = NULL,
    "purgeAt" = CASE WHEN "archivedAt" IS NULL THEN v_now + interval '90 days' ELSE "purgeAt" END,
    "archivedAt" = coalesce("archivedAt", v_now),
    "updatedAt" = v_now
   WHERE "userId" = p_user_id AND "purgedAt" IS NULL;

  -- Decision 445 item 4 (P-4): the School's own name and work phone for them
  -- as staff, and the work phone in older "details changed" staff activity
  -- lines about them (the display name there becomes "Erased User", as their
  -- name does elsewhere in the log).
  UPDATE "StaffPermission" SET "displayName" = NULL, "workPhone" = NULL, "updatedAt" = v_now
   WHERE "userId" = p_user_id AND ("displayName" IS NOT NULL OR "workPhone" IS NOT NULL);
  UPDATE "StaffActivity" SET "details" =
      CASE WHEN jsonb_typeof("details" -> 'displayName') = 'string'
           THEN jsonb_set("details" - 'workPhone', '{displayName}', '"Erased User"'::jsonb)
           ELSE "details" - 'workPhone' END
   WHERE "targetUserId" = p_user_id
     AND "action" = 'DETAILS_CHANGED'
     AND jsonb_typeof("details") = 'object'
     AND ("details" ? 'workPhone' OR jsonb_typeof("details" -> 'displayName') = 'string');

  INSERT INTO "AccountErasureLog" ("id", "userId", "event", "requestedById", "at")
  VALUES (gen_random_uuid()::text, p_user_id, 'ERASED', v_by, v_now);

  RETURN QUERY SELECT true, v_photo;
END;
$$;
ALTER FUNCTION "erase_due_account"(text, text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "erase_due_account"(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "erase_due_account"(text, text) TO ultm8_jobs;
