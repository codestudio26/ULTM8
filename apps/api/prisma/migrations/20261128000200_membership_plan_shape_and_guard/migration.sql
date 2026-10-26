-- Decision 334 (Memberships review, 26 Oct 2026).

-- M1/M20: the partial unique index keyed on the stored status, which stays
-- ACTIVE after a Weekly Pass or Trial runs out by date (Decision 26: expiry is
-- live-computed). It kept blocking a Student from buying again after their
-- pass expired, and it counted a Trial as general access, so a live Trial
-- blocked buying a Weekly Pass or Subscription. Replaced by
-- assertCanCreateMembership() (apps/api/src/memberships/
-- membership-creation-guard.ts): an advisory-locked live check of
-- Subscription and Weekly Pass only, run at all three places a Membership is
-- created.
DROP INDEX IF EXISTS "Membership_one_active_general_access_per_school";

-- M2: fields a plan type doesn't use, left behind by earlier type changes.
-- Subscription, Weekly Pass and Trial are general access: no class count and
-- no one-class scope.
UPDATE "MembershipPlan"
SET "classesIncluded" = NULL, "scopedClassId" = NULL
WHERE "type" IN ('SUBSCRIPTION', 'WEEKLY_PASS', 'TRIAL_MEMBERSHIP')
  AND ("classesIncluded" IS NOT NULL OR "scopedClassId" IS NOT NULL);

-- A Subscription renews until cancelled: no expiry.
UPDATE "MembershipPlan"
SET "expiryDurationDays" = NULL
WHERE "type" = 'SUBSCRIPTION' AND "expiryDurationDays" IS NOT NULL;

-- M3: a Trial lasts at most 30 days (Decisions 54/64). Trials with no expiry
-- or a longer one are capped at 30. Memberships already sold keep their dates.
UPDATE "MembershipPlan"
SET "expiryDurationDays" = 30
WHERE "type" = 'TRIAL_MEMBERSHIP' AND ("expiryDurationDays" IS NULL OR "expiryDurationDays" > 30);
