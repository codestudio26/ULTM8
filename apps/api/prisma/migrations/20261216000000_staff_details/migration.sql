-- Decision 381: the School's own display name and work phone for a staff
-- member, set by the owner. The person's account (real name, login email,
-- personal phone) stays theirs alone. Kept on StaffPermission, the School's
-- per-person staff row: its RLS already lets the School's owners manage it
-- and the person read their own.
ALTER TABLE "StaffPermission" ADD COLUMN "displayName" TEXT;
ALTER TABLE "StaffPermission" ADD COLUMN "workPhone" TEXT;
