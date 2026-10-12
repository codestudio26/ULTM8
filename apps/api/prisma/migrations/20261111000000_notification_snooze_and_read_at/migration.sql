-- v1.2 backend backlog ("Notifications page" — Snooze + "Read within 24h"
-- metric, both approved by the product owner): adds the two Developer-level
-- columns Notification's own schema.prisma header comment documents.
-- Hand-written rather than `prisma migrate diff`'s raw output — this
-- environment's migration history vs. schema.prisma already has pre-existing,
-- unrelated drift on every table's `id` DEFAULT (gen_random_uuid() in the DB,
-- not reflected by @default(uuid()) in a diff run fresh against this Prisma
-- CLI version); this migration only touches what this change actually needs.

-- AlterTable
ALTER TABLE "Notification"
  ADD COLUMN "snoozedUntil" TIMESTAMP(3),
  ADD COLUMN "readAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Notification_snoozedUntil_idx" ON "Notification"("snoozedUntil");
