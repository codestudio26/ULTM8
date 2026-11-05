-- Decision 318 item 7: member app switches each School turns on or off.
-- The four that gate features the app already has are on by default, so
-- nothing changes for a School until its owner turns one off.
ALTER TABLE "School" ADD COLUMN "memberAppEditProfile" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "School" ADD COLUMN "memberAppCancelMembership" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "School" ADD COLUMN "memberAppAddFamily" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "School" ADD COLUMN "memberAppPaymentHistory" BOOLEAN NOT NULL DEFAULT true;
-- The grading countdown is new: off by default. The next grading day is a
-- plain date the School sets (not a grading event, Decision 158).
ALTER TABLE "School" ADD COLUMN "memberAppGradingCountdown" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "School" ADD COLUMN "nextGradingDate" DATE;

-- ultm8_app and ultm8_jobs already have table-level access to School. The
-- student app's join screen reads one switch (may a Guardian add a child
-- here?) before the person is a member, so only that setting joins the
-- discovery role's column grant, as medicalInfoEnabled did.
GRANT SELECT ("memberAppAddFamily") ON "School" TO ultm8_discovery;
