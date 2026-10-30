-- Large Schools' check-in codes (Decision 418, stress test round 4 Q1). A
-- School with more than 500 current Students is moved to 6-digit codes, and
-- its shorter member and staff codes are replaced. A front-desk tablet counts
-- wrong member codes in a row and locks at 10 until a staff code is typed.

ALTER TABLE "FrontDeskSession" ADD COLUMN "wrongMemberCodeCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FrontDeskSession" ADD COLUMN "lockedAt" TIMESTAMP(3);

-- The switch runs with no user (a sweep, or whoever's request noticed it):
-- ultm8_jobs replaces the codes.
GRANT UPDATE ON "StudentCheckInCode" TO ultm8_jobs;
GRANT UPDATE ON "StaffKioskCode" TO ultm8_jobs;

CREATE POLICY "student_check_in_code_jobs_update" ON "StudentCheckInCode"
  FOR UPDATE
  TO ultm8_jobs
  USING (true)
  WITH CHECK (true);

CREATE POLICY "staff_kiosk_code_jobs_update" ON "StaffKioskCode"
  FOR UPDATE
  TO ultm8_jobs
  USING (true)
  WITH CHECK (true);
