-- Decision 408: the Staff page's activity log ("who changed what").
--
-- One row per change, written by the API in the same transaction as the
-- change, as the person making it. Rows are never updated or deleted by the
-- app; they go when their School is purged (cascade).
--
-- Who reads and writes:
--   * the School's owners and co-owners read every row of their School;
--   * a row is written by its actor only (actorId = the caller), and only by
--     an owner of that School, except: Branch Staff with "Can invite coaches"
--     write the invites they send or cancel, and the invited person writes
--     "INVITE_ACCEPTED" about themselves when they accept.
CREATE TABLE "StaffActivity" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "schoolId" TEXT NOT NULL,
    "actorId" TEXT,
    "targetUserId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffActivity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StaffActivity_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StaffActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StaffActivity_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "StaffActivity_schoolId_createdAt_idx" ON "StaffActivity"("schoolId", "createdAt");
CREATE INDEX "StaffActivity_schoolId_targetUserId_createdAt_idx" ON "StaffActivity"("schoolId", "targetUserId", "createdAt");

GRANT SELECT, INSERT ON "StaffActivity" TO ultm8_app;

ALTER TABLE "StaffActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffActivity" FORCE ROW LEVEL SECURITY;
CREATE POLICY "staff_activity_owner_read" ON "StaffActivity"
  FOR SELECT
  USING (is_active_school_owner_manager("StaffActivity"."schoolId"));
CREATE POLICY "staff_activity_actor_insert" ON "StaffActivity"
  FOR INSERT
  WITH CHECK (
    "StaffActivity"."actorId" = current_setting('app.current_user_id', true)
    AND (
      is_active_school_owner_manager("StaffActivity"."schoolId")
      OR (
        "StaffActivity"."action" IN ('INVITE_SENT', 'INVITE_CANCELLED')
        AND EXISTS (
          SELECT 1 FROM "StaffPermission" sp
          WHERE sp."userId" = current_setting('app.current_user_id', true)
            AND sp."schoolId" = "StaffActivity"."schoolId"
            AND sp."canInviteCoaches"
        )
      )
      OR (
        "StaffActivity"."action" = 'INVITE_ACCEPTED'
        AND "StaffActivity"."targetUserId" = current_setting('app.current_user_id', true)
      )
    )
  );
