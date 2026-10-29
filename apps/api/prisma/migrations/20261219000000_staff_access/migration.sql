-- Decision 387: the owner's access switches for each Branch Staff member, on
-- the School's per-person StaffPermission row (beside "Can invite coaches").
-- Defaults keep what Branch Staff could already do (bookings and check-in,
-- their branch's students, cancelling classes with credit) and leave the new
-- powers off (managing classes and the timetable, seeing the staff list).
-- A Branch Staff member with no row yet has these same defaults.
ALTER TABLE "StaffPermission" ADD COLUMN "canManageClasses" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StaffPermission" ADD COLUMN "canManageBookings" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StaffPermission" ADD COLUMN "canManageStudents" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StaffPermission" ADD COLUMN "canCancelClasses" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StaffPermission" ADD COLUMN "canSeeStaffList" BOOLEAN NOT NULL DEFAULT false;

-- Branch Staff with "See the staff list" see their branches' staff with the
-- School's display name and work phone (Decision 381). The API checks the
-- switch, then reads through ultm8_jobs, as it already does for RoleGrant
-- (role_grant_jobs_read). Only the id and these four columns; never the
-- switches. (Prisma always reads the id.)
GRANT SELECT ("id", "schoolId", "userId", "displayName", "workPhone") ON "StaffPermission" TO ultm8_jobs;
CREATE POLICY "staff_permission_jobs_read" ON "StaffPermission" FOR SELECT TO ultm8_jobs USING (true);
