-- Decision 352: each Notification can carry the School it came from (shown as
-- a label) and the thing it is about (opened when the notification is
-- clicked). All four are nullable: older rows, and notifications with no
-- School or nothing to open, simply have none. `schoolName` is written by the
-- notification-fanout job at send time, because the reader cannot always see
-- the School row under RLS (a parent reading a child's notice, a Student whose
-- enrolment has ended). No foreign key: the label must outlive a School's
-- purge. No grant change: ultm8_app (SELECT, UPDATE) and ultm8_jobs (INSERT,
-- SELECT, UPDATE) already hold table-level grants on "Notification".

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "schoolId" TEXT,
ADD COLUMN "schoolName" TEXT,
ADD COLUMN "targetType" TEXT,
ADD COLUMN "targetId" TEXT;
