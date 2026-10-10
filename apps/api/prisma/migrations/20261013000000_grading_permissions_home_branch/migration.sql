-- Grading foundation PR 4 — grading permission per discipline and each
-- student's home branch (Decisions 138, 139, 148, 168). Additive.

-- StudentHomeBranch ---------------------------------------------------------

CREATE TABLE "StudentHomeBranch" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudentHomeBranch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StudentHomeBranch_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentHomeBranch_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentHomeBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentHomeBranch_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StudentHomeBranch_schoolId_studentId_key" ON "StudentHomeBranch"("schoolId", "studentId");
CREATE INDEX "StudentHomeBranch_branchId_idx" ON "StudentHomeBranch"("branchId");
CREATE INDEX "StudentHomeBranch_studentId_idx" ON "StudentHomeBranch"("studentId");
GRANT SELECT, INSERT, UPDATE ON "StudentHomeBranch" TO ultm8_app;

ALTER TABLE "StudentHomeBranch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudentHomeBranch" FORCE ROW LEVEL SECURITY;
-- The School Owner/Manager (impersonation-scoped helper, 20261002000000), or
-- the Student. The Student inserts their own row when joining a School.
CREATE POLICY "student_home_branch_owner_or_self" ON "StudentHomeBranch"
  USING (
    is_active_school_owner_manager("StudentHomeBranch"."schoolId")
    OR "StudentHomeBranch"."studentId" = current_setting('app.current_user_id', true)
  );

-- GradingPermission ---------------------------------------------------------

CREATE TABLE "GradingPermission" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GradingPermission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GradingPermission_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GradingPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GradingPermission_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GradingPermission_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GradingPermission_userId_disciplineId_key" ON "GradingPermission"("userId", "disciplineId");
CREATE INDEX "GradingPermission_schoolId_idx" ON "GradingPermission"("schoolId");
CREATE INDEX "GradingPermission_disciplineId_idx" ON "GradingPermission"("disciplineId");
GRANT SELECT, INSERT, DELETE ON "GradingPermission" TO ultm8_app;

ALTER TABLE "GradingPermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GradingPermission" FORCE ROW LEVEL SECURITY;
-- Only the School Owner/Manager manages these; a user can read their own.
CREATE POLICY "grading_permission_owner_manage" ON "GradingPermission"
  USING (is_active_school_owner_manager("GradingPermission"."schoolId"));
CREATE POLICY "grading_permission_self_read" ON "GradingPermission"
  FOR SELECT
  USING ("GradingPermission"."userId" = current_setting('app.current_user_id', true));
