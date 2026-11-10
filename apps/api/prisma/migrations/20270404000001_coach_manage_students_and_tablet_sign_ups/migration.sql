-- Decision 449 item 7: the School's main owner can give a coach "Manage
-- students" (off by default), letting them edit the profiles of their own
-- branches' students (Decision 448 item 11). Kept apart from
-- canManageStudents, whose default is on for Branch Staff: a coach with a
-- StaffPermission row for another switch must not get it by default.
ALTER TABLE "StaffPermission" ADD COLUMN "canManageStudentsAsCoach" BOOLEAN NOT NULL DEFAULT false;

-- Decision 449 item 13: an account made by approving a front-desk tablet
-- sign-up (Decision 392) counts as "signed up themselves" for the
-- 18th-birthday rule (Decision 446 item 8), like one made in the app. The
-- tablet already checks the 18th birthday as sign-up does (Decision 448
-- item 14). Set once, when staff approve the sign-up and the account is made.
ALTER TABLE "User" ADD COLUMN "signedUpOnTabletAt" TIMESTAMP(3);

-- self_signed_up_users (20270332000002, 20270403000001) answers for the
-- waiver-renewal sweep too. Same signature, owner and grants; only the body
-- grows, so ultm8_jobs keeps exactly its EXECUTE and learns nothing more
-- than which of the given ids signed up themselves. ultm8_rls_helper (the
-- owner) already reads "User" (20261027000000_grading_board_staff_rows).
CREATE OR REPLACE FUNCTION "self_signed_up_users"(p_user_ids text[])
RETURNS SETOF text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT la."userId"
  FROM public."LegalAcceptance" la
  WHERE la."userId" = ANY (p_user_ids)
    AND la."documentSlug" = 'terms-and-conditions'
    AND la."schoolId" IS NULL
    AND la."franchiseId" IS NULL
    AND NOT la."atFirstSignIn"
  UNION
  SELECT u."id"
  FROM public."User" u
  WHERE u."id" = ANY (p_user_ids)
    AND u."signedUpOnTabletAt" IS NOT NULL;
$$;
