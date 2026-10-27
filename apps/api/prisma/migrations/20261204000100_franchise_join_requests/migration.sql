-- Decision 352 — a School asks to join a Franchise and the Franchise Owner
-- accepts or declines (product owner, 27 Oct 2026). Replaces joining instantly
-- with the Franchise ID.

CREATE TYPE "FranchiseJoinRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

CREATE TABLE "FranchiseJoinRequest" (
    "id" TEXT NOT NULL,
    "franchiseId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "schoolName" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "FranchiseJoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FranchiseJoinRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FranchiseJoinRequest_franchiseId_status_idx" ON "FranchiseJoinRequest"("franchiseId", "status");
CREATE INDEX "FranchiseJoinRequest_schoolId_createdAt_idx" ON "FranchiseJoinRequest"("schoolId", "createdAt");

-- One open request per School at a time.
CREATE UNIQUE INDEX "FranchiseJoinRequest_one_pending_per_school" ON "FranchiseJoinRequest"("schoolId") WHERE "status" = 'PENDING';

-- Cascade with the School or Franchise, so the 90-day purge of a closed tenant
-- isn't blocked by its old requests.
ALTER TABLE "FranchiseJoinRequest" ADD CONSTRAINT "FranchiseJoinRequest_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "Franchise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FranchiseJoinRequest" ADD CONSTRAINT "FranchiseJoinRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FranchiseJoinRequest" ADD CONSTRAINT "FranchiseJoinRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FranchiseJoinRequest" ADD CONSTRAINT "FranchiseJoinRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON "FranchiseJoinRequest" TO ultm8_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "FranchiseJoinRequest" TO ultm8_jobs;

ALTER TABLE "FranchiseJoinRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FranchiseJoinRequest" FORCE ROW LEVEL SECURITY;

-- The Franchise's Owner, or the asking School's Owner/Manager.
CREATE POLICY "franchise_join_request_tenant_isolation" ON "FranchiseJoinRequest"
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
        AND (
          (rg."role" = 'FRANCHISE_OWNER' AND rg."franchiseId" = "FranchiseJoinRequest"."franchiseId")
          OR (rg."role" = 'SCHOOL_OWNER_MANAGER' AND rg."schoolId" = "FranchiseJoinRequest"."schoolId")
        )
    )
  );

CREATE POLICY "franchise_join_request_jobs_all" ON "FranchiseJoinRequest"
  TO ultm8_jobs
  USING (true)
  WITH CHECK (true);
