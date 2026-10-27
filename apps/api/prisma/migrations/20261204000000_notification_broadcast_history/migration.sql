-- Decision 363 — the sent-broadcast history. See NotificationBroadcast's own
-- schema comment and NotificationBroadcastService.broadcast's header comment.
--
-- RLS/GRANT shape mirrors MembershipPlanPriceChange
-- (20261111000001_membership_plan_archive_and_price_change): a School-Owner-only
-- record of something an Owner did, keyed on schoolId, checked against an
-- active SCHOOL_OWNER_MANAGER RoleGrant. No ultm8_jobs grant or policy — no job
-- reads or writes it; tenant-lifecycle-purge's School delete still cascades it
-- (a referential action needs no grant on the child table, see
-- TenantLifecyclePurgeProcessor's own header comment).

-- CreateTable
CREATE TABLE "NotificationBroadcast" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sentById" TEXT NOT NULL,
    "sentByName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "branchId" TEXT,
    "branchName" TEXT,
    "classId" TEXT,
    "classTitle" TEXT,
    "classStartDate" TIMESTAMP(3),
    "classAudience" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recipientCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationBroadcast_schoolId_createdAt_id_idx" ON "NotificationBroadcast"("schoolId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "NotificationBroadcast" ADD CONSTRAINT "NotificationBroadcast_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationBroadcast" ADD CONSTRAINT "NotificationBroadcast_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationBroadcast" ADD CONSTRAINT "NotificationBroadcast_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationBroadcast" ADD CONSTRAINT "NotificationBroadcast_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Read and add only: a sent broadcast is never edited or removed by the app.
GRANT SELECT, INSERT ON "NotificationBroadcast" TO ultm8_app;

ALTER TABLE "NotificationBroadcast" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationBroadcast" FORCE ROW LEVEL SECURITY;

-- Owner of that School only, for reads and inserts alike (no FOR clause, no
-- separate WITH CHECK) — the data-layer mirror of assertSchoolOwner, which
-- both sending and listing already apply.
CREATE POLICY "notification_broadcast_tenant_isolation" ON "NotificationBroadcast"
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."schoolId" = "NotificationBroadcast"."schoolId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."role" = 'SCHOOL_OWNER_MANAGER'
        AND rg."revokedAt" IS NULL
    )
  );
