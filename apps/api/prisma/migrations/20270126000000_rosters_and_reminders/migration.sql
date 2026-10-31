-- Decision 317 items 6 and 7: rosters (named lists of members for staff) and
-- reminders (a membership expiry reminder to the member, an absence alert to
-- staff).

-- Rosters. Each School manages its own; members never see them.
CREATE TABLE "Roster" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Roster_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RosterMember" (
    "rosterId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterMember_pkey" PRIMARY KEY ("rosterId","studentId")
);

CREATE UNIQUE INDEX "Roster_schoolId_name_key" ON "Roster"("schoolId", "name");
CREATE UNIQUE INDEX "Roster_id_schoolId_key" ON "Roster"("id", "schoolId");
CREATE INDEX "RosterMember_schoolId_studentId_idx" ON "RosterMember"("schoolId", "studentId");

ALTER TABLE "Roster" ADD CONSTRAINT "Roster_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- (rosterId, schoolId) together: a roster can only hold a student under the
-- roster's own School, whatever the API sends.
ALTER TABLE "RosterMember" ADD CONSTRAINT "RosterMember_rosterId_schoolId_fkey" FOREIGN KEY ("rosterId", "schoolId") REFERENCES "Roster"("id", "schoolId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RosterMember" ADD CONSTRAINT "RosterMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Read and written only on the jobs connection, after the API's own staff
-- checks (RostersService). ultm8_app gets nothing, so no member-facing query
-- can reach them.
ALTER TABLE "Roster" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Roster" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Roster" TO ultm8_jobs;
CREATE POLICY "roster_jobs_all" ON "Roster" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);

ALTER TABLE "RosterMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RosterMember" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "RosterMember" TO ultm8_jobs;
CREATE POLICY "roster_member_jobs_all" ON "RosterMember" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);

-- The absence alert's period, in weeks (1-52). Null (the default): off.
ALTER TABLE "School" ADD COLUMN "absenceAlertWeeks" INTEGER;

-- One row per expiry reminder sent: once per membership end date.
CREATE TABLE "MembershipExpiryReminder" (
    "membershipId" TEXT NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipExpiryReminder_pkey" PRIMARY KEY ("membershipId","endsAt")
);
ALTER TABLE "MembershipExpiryReminder" ADD CONSTRAINT "MembershipExpiryReminder_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One row per absence alert sent: once per absence spell.
CREATE TABLE "StudentAbsenceAlert" (
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "absentSince" DATE NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentAbsenceAlert_pkey" PRIMARY KEY ("schoolId","studentId","absentSince")
);
ALTER TABLE "StudentAbsenceAlert" ADD CONSTRAINT "StudentAbsenceAlert_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentAbsenceAlert" ADD CONSTRAINT "StudentAbsenceAlert_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Both written only by their daily jobs (ultm8_jobs).
ALTER TABLE "MembershipExpiryReminder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MembershipExpiryReminder" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON "MembershipExpiryReminder" TO ultm8_jobs;
CREATE POLICY "membership_expiry_reminder_jobs_all" ON "MembershipExpiryReminder" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);

ALTER TABLE "StudentAbsenceAlert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudentAbsenceAlert" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON "StudentAbsenceAlert" TO ultm8_jobs;
CREATE POLICY "student_absence_alert_jobs_all" ON "StudentAbsenceAlert" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);
