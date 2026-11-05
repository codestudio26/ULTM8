-- Decision 430 item 9 (FAM-9): a Guardian-linked child is "consent pending"
-- (no booking, no check-in) until a parent records BASELINE consent. Links
-- that already exist when this ships are marked as made before the rule, so
-- no child already training is locked out on deploy; their parents are asked
-- for consent in the app, and the mark is cleared for good once any parent
-- withdraws BASELINE consent (re-enrolling then needs fresh consent). No
-- consent is invented for them: the mark records only that the link predates
-- the rule.
--
-- Run once and guarded: the back-fill happens only in the same step that
-- adds the column, so a re-run never marks links made after the rule.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'GuardianLink' AND column_name = 'consentGrandfathered'
  ) THEN
    ALTER TABLE "GuardianLink" ADD COLUMN "consentGrandfathered" BOOLEAN NOT NULL DEFAULT false;
    UPDATE "GuardianLink" SET "consentGrandfathered" = true;
  END IF;
END
$$;

-- Decision 430 item 8 (FAM-8): the owner's "Remove Guardian" ends another
-- person's link, and a BASELINE withdrawal clears the mark above on every
-- parent's link to the child. Both run on the jobs connection after the
-- service's own checks (GuardianLink's app policy is the Guardian's own rows
-- only). Only these two columns, never the people on the link.
GRANT UPDATE ("revokedAt", "consentGrandfathered") ON "GuardianLink" TO ultm8_jobs;
DROP POLICY IF EXISTS "guardian_link_jobs_update" ON "GuardianLink";
CREATE POLICY "guardian_link_jobs_update" ON "GuardianLink" FOR UPDATE TO ultm8_jobs USING (true) WITH CHECK (true);
