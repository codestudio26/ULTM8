-- An instructor's own belt per style (Decisions 108, 188): the instructor
-- chooses a belt and stripe from the style's ladder at their School; it is
-- unverified until the School Owner verifies it or corrects it.
--
-- Belongs to the person at the School (an active INSTRUCTOR grant), not to an
-- Instructor profile: coaches who joined by invite have no profile.
--
-- Who reads and writes:
--   * the School Owner/Manager — every row of their School, including
--     verifying and correcting;
--   * the instructor — reads their own rows, and may declare or change their
--     own belt only while they hold an active INSTRUCTOR grant there, and
--     only as unverified (they can't verify themselves).

CREATE TABLE "InstructorBelt" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "rankId" TEXT NOT NULL,
    "stripeTierId" TEXT NOT NULL,
    "verificationStatus" "RankVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InstructorBelt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InstructorBelt_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InstructorBelt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InstructorBelt_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InstructorBelt_rankId_fkey" FOREIGN KEY ("rankId") REFERENCES "Rank"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InstructorBelt_stripeTierId_fkey" FOREIGN KEY ("stripeTierId") REFERENCES "RankStripeTier"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InstructorBelt_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    -- Verified rows say who verified and when; unverified rows say neither.
    CONSTRAINT "InstructorBelt_verified_by_when" CHECK (
      ("verificationStatus" = 'VERIFIED') = ("verifiedAt" IS NOT NULL)
    )
);
CREATE UNIQUE INDEX "InstructorBelt_userId_disciplineId_key" ON "InstructorBelt"("userId", "disciplineId");
CREATE INDEX "InstructorBelt_schoolId_idx" ON "InstructorBelt"("schoolId");
CREATE INDEX "InstructorBelt_disciplineId_idx" ON "InstructorBelt"("disciplineId");

-- No DELETE for the app: a belt is changed, not removed.
GRANT SELECT, INSERT, UPDATE ON "InstructorBelt" TO ultm8_app;

ALTER TABLE "InstructorBelt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InstructorBelt" FORCE ROW LEVEL SECURITY;
CREATE POLICY "instructor_belt_owner_manage" ON "InstructorBelt"
  USING (is_active_school_owner_manager("InstructorBelt"."schoolId"));
CREATE POLICY "instructor_belt_self_read" ON "InstructorBelt"
  FOR SELECT
  USING ("InstructorBelt"."userId" = current_setting('app.current_user_id', true));
-- The instructor's own declaration: theirs, while an active instructor
-- there, and never verified by themselves.
CREATE POLICY "instructor_belt_self_declare" ON "InstructorBelt"
  FOR INSERT
  WITH CHECK (
    "InstructorBelt"."userId" = current_setting('app.current_user_id', true)
    AND "InstructorBelt"."verificationStatus" = 'UNVERIFIED'
    AND "InstructorBelt"."verifiedById" IS NULL
    AND EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."userId" = "InstructorBelt"."userId" AND rg."schoolId" = "InstructorBelt"."schoolId"
        AND rg."role" = 'INSTRUCTOR' AND rg."revokedAt" IS NULL
    )
  );
CREATE POLICY "instructor_belt_self_change" ON "InstructorBelt"
  FOR UPDATE
  USING ("InstructorBelt"."userId" = current_setting('app.current_user_id', true))
  WITH CHECK (
    "InstructorBelt"."userId" = current_setting('app.current_user_id', true)
    AND "InstructorBelt"."verificationStatus" = 'UNVERIFIED'
    AND "InstructorBelt"."verifiedById" IS NULL
    AND EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."userId" = "InstructorBelt"."userId" AND rg."schoolId" = "InstructorBelt"."schoolId"
        AND rg."role" = 'INSTRUCTOR' AND rg."revokedAt" IS NULL
    )
  );
