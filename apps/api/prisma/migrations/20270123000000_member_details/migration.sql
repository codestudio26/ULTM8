-- Decision 315 items 4 and 5 (v1.3 backlog 5.1 and 5.2): member details.
--
-- 1. Contacts (item 5): one secondary phone, one secondary email, and an
--    emergency contact (name, phone, relationship) who is not a Guardian and
--    has no account. Person-level columns on "User", next to the address and
--    measurements, edited through the same two doors (PATCH /users/me and the
--    staff profile PATCH). Nullable, no default: no table rewrite. The
--    existing table-level grants and RLS on "User" cover them, and they go
--    with the User row when an account is deleted.
ALTER TABLE "User"
  ADD COLUMN "secondaryPhone" TEXT,
  ADD COLUMN "secondaryEmail" TEXT,
  ADD COLUMN "emergencyContactName" TEXT,
  ADD COLUMN "emergencyContactPhone" TEXT,
  ADD COLUMN "emergencyContactRelationship" TEXT;

-- 2. Join date (item 4): per School, since a person can be a student at more
--    than one. One row per student per School, kept when they leave and come
--    back (it is when they first joined).
CREATE TABLE "StudentJoinDate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "joinedOn" DATE NOT NULL,
    "setById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudentJoinDate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StudentJoinDate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentJoinDate_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentJoinDate_setById_fkey" FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StudentJoinDate_schoolId_studentId_key" ON "StudentJoinDate"("schoolId", "studentId");
CREATE INDEX "StudentJoinDate_studentId_idx" ON "StudentJoinDate"("studentId");

-- Read and written only on the jobs connection, after the API's own checks
-- (staff who cover the student). ultm8_app gets nothing.
ALTER TABLE "StudentJoinDate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudentJoinDate" FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON "StudentJoinDate" TO ultm8_jobs;
CREATE POLICY "student_join_date_jobs_all" ON "StudentJoinDate" FOR ALL TO ultm8_jobs USING (true) WITH CHECK (true);

-- The day a School's local calendar shows at a moment (UTC when the School
-- has no timezone, or one Postgres doesn't know).
CREATE FUNCTION "school_local_date"(p_school_id TEXT, p_at TIMESTAMP)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  tz TEXT;
BEGIN
  SELECT s."timezone" INTO tz FROM public."School" s WHERE s."id" = p_school_id;
  -- RoleGrant."grantedAt" is TIMESTAMP(3) holding UTC (Prisma's convention).
  RETURN ((p_at AT TIME ZONE 'UTC') AT TIME ZONE COALESCE(tz, 'UTC'))::DATE;
EXCEPTION WHEN invalid_parameter_value THEN
  -- A timezone name Postgres doesn't know.
  RETURN p_at::DATE;
END;
$$;
ALTER FUNCTION "school_local_date"(TEXT, TIMESTAMP) OWNER TO ultm8_rls_helper;
GRANT SELECT ("id", "timezone") ON "School" TO ultm8_rls_helper;

-- Every path that enrols a student (join, Add manually, a child's Guardian,
-- a tablet sign-up, invites, raw SQL) gives a STUDENT RoleGrant, so the
-- default join date is made here, once: a returning student keeps theirs.
-- SECURITY DEFINER, owned by the BYPASSRLS helper role, like
-- stamp_user_roles_changed_at: the caller has no grant on this table.
CREATE FUNCTION "make_student_join_date"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW."role" = 'STUDENT' AND NEW."schoolId" IS NOT NULL THEN
    INSERT INTO public."StudentJoinDate" ("id", "schoolId", "studentId", "joinedOn", "createdAt", "updatedAt")
    VALUES (
      pg_catalog.gen_random_uuid()::TEXT,
      NEW."schoolId",
      NEW."userId",
      public."school_local_date"(NEW."schoolId", NEW."grantedAt"),
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    )
    ON CONFLICT ("schoolId", "studentId") DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
ALTER FUNCTION "make_student_join_date"() OWNER TO ultm8_rls_helper;
GRANT SELECT, INSERT ON "StudentJoinDate" TO ultm8_rls_helper;

CREATE TRIGGER "RoleGrant_make_student_join_date"
AFTER INSERT ON "RoleGrant"
FOR EACH ROW EXECUTE FUNCTION "make_student_join_date"();

-- Backfill: every student, current or former, joined their School on the day
-- of their first STUDENT grant there (in the School's timezone). Not
-- User."createdAt": that is when the account was made, and one account can
-- join several Schools.
INSERT INTO "StudentJoinDate" ("id", "schoolId", "studentId", "joinedOn", "createdAt", "updatedAt")
SELECT gen_random_uuid()::TEXT, g."schoolId", g."userId", "school_local_date"(g."schoolId", min(g."grantedAt")), now(), now()
FROM "RoleGrant" g
WHERE g."role" = 'STUDENT' AND g."schoolId" IS NOT NULL
GROUP BY g."schoolId", g."userId"
ON CONFLICT ("schoolId", "studentId") DO NOTHING;

-- 3. A child added by the owner whose Guardian already has an account is
--    enrolled when the Guardian accepts; the owner's chosen join date waits on
--    the invite until then.
ALTER TABLE "ChildInvite" ADD COLUMN "joinedOn" DATE;
