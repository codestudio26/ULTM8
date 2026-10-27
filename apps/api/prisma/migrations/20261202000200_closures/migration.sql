-- Decision 319 §3 / Decision 353 (Q8) — closure dates for a School or one of its
-- Branches. Creating one cancels the classes on those dates (CancellationService
-- .cancelClass, the School's normal rule); the nightly class generation skips them.

CREATE TABLE "Closure" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Closure_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Closure_dates_check" CHECK ("endDate" >= "startDate")
);

CREATE INDEX "Closure_schoolId_startDate_idx" ON "Closure"("schoolId", "startDate");

ALTER TABLE "Closure" ADD CONSTRAINT "Closure_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Closure" ADD CONSTRAINT "Closure_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Closure" ADD CONSTRAINT "Closure_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS — same shape as timetable_slot_tenant_isolation (20260908000000): a
-- School-level grant sees every closure; a Branch-scoped grant sees its own
-- Branch's and School-wide ones. Only the School Owner/Manager writes them
-- (ClosuresService checks it; their grant is always branchId NULL).
GRANT SELECT, INSERT, DELETE ON "Closure" TO ultm8_app;
ALTER TABLE "Closure" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Closure" FORCE ROW LEVEL SECURITY;
CREATE POLICY "closure_tenant_isolation" ON "Closure"
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."schoolId" = "Closure"."schoolId"
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
        AND rg."role" IN ('SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF', 'INSTRUCTOR')
        AND (
          rg."branchId" IS NULL
          OR "Closure"."branchId" IS NULL
          OR rg."branchId" = "Closure"."branchId"
        )
    )
  );

-- The nightly class generation (ultm8_jobs) reads every closure to skip its dates.
GRANT SELECT ON "Closure" TO ultm8_jobs;
CREATE POLICY "closure_jobs_read" ON "Closure"
  FOR SELECT
  TO ultm8_jobs
  USING (true);
