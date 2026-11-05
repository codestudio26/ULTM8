-- Decision 432 item 14 (stress test round 5, AE-6): an optional "Who can book"
-- on a one-off Class and on a weekly TimetableSlot (copied onto the Classes it
-- makes): everyone, women only or men only, plus an optional age range in whole
-- years. Enforced at booking, waitlist join and claim, Kid Mode and the front
-- desk; staff can still book with the existing override reason.
-- Every existing row stays open to everyone (EVERYONE, no ages).
DO $$ BEGIN
  CREATE TYPE "ClassAudience" AS ENUM ('EVERYONE', 'WOMEN', 'MEN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Class" ADD COLUMN IF NOT EXISTS "audience" "ClassAudience" NOT NULL DEFAULT 'EVERYONE';
ALTER TABLE "Class" ADD COLUMN IF NOT EXISTS "minAge" INTEGER;
ALTER TABLE "Class" ADD COLUMN IF NOT EXISTS "maxAge" INTEGER;

ALTER TABLE "TimetableSlot" ADD COLUMN IF NOT EXISTS "audience" "ClassAudience" NOT NULL DEFAULT 'EVERYONE';
ALTER TABLE "TimetableSlot" ADD COLUMN IF NOT EXISTS "minAge" INTEGER;
ALTER TABLE "TimetableSlot" ADD COLUMN IF NOT EXISTS "maxAge" INTEGER;

-- Whole years 0-120, and a range in order (the API checks the same).
DO $$ BEGIN
  ALTER TABLE "Class" ADD CONSTRAINT "Class_age_range_check"
    CHECK (("minAge" IS NULL OR "minAge" BETWEEN 0 AND 120) AND ("maxAge" IS NULL OR "maxAge" BETWEEN 0 AND 120) AND ("minAge" IS NULL OR "maxAge" IS NULL OR "minAge" <= "maxAge"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_age_range_check"
    CHECK (("minAge" IS NULL OR "minAge" BETWEEN 0 AND 120) AND ("maxAge" IS NULL OR "maxAge" BETWEEN 0 AND 120) AND ("minAge" IS NULL OR "maxAge" IS NULL OR "minAge" <= "maxAge"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS is per row and unchanged; the app, jobs and owner roles already hold
-- table-level grants on both tables. The student-facing class list reads by
-- column through ultm8_discovery, so it can show "Women only" or the ages.
GRANT SELECT ("audience", "minAge", "maxAge") ON "Class" TO ultm8_discovery;
GRANT SELECT ("audience", "minAge", "maxAge") ON "TimetableSlot" TO ultm8_discovery;
