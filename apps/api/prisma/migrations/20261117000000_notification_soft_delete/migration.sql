-- Decision 274: a User can hide (soft-delete) their own Notifications, one at
-- a time or "Clear all read". The row stays on record; only `deletedAt` is
-- set. Hand-written for the same reason as
-- 20261111000000_notification_snooze_and_read_at. No grant change: ultm8_app
-- already has table-level SELECT, UPDATE on "Notification" (and deliberately
-- no DELETE).

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "deletedAt" TIMESTAMP(3);
