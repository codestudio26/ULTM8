-- Decision 319 item 4: two schedule settings the School can choose.
--  1. Staff see their classes in Google Calendar: each staff member gets a
--     private calendar link (an iCal feed of the classes they teach), which
--     Google Calendar subscribes to ("From URL"). No Google account is
--     connected and no secret is needed.
--  2. A schedule embed for the School's own website: a public link showing
--     the School's upcoming classes (title, times, Branch, cancelled), no
--     personal data.
-- Both are read without signing in, so both go through narrow SECURITY
-- DEFINER functions keyed by the link's token, never a broad policy.

-- The School's settings. School's existing grants and policies apply.
ALTER TABLE "School" ADD COLUMN "staffCalendarFeedsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "School" ADD COLUMN "scheduleEmbedKey" TEXT;
CREATE UNIQUE INDEX "School_scheduleEmbedKey_key" ON "School"("scheduleEmbedKey");

CREATE TABLE "StaffCalendarFeed" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffCalendarFeed_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffCalendarFeed_tokenHash_key" ON "StaffCalendarFeed"("tokenHash");
CREATE INDEX "StaffCalendarFeed_userId_idx" ON "StaffCalendarFeed"("userId");
CREATE UNIQUE INDEX "StaffCalendarFeed_schoolId_userId_key" ON "StaffCalendarFeed"("schoolId", "userId");

-- A link means nothing without its School or person (and must never block a
-- purge or erasure).
ALTER TABLE "StaffCalendarFeed" ADD CONSTRAINT "StaffCalendarFeed_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffCalendarFeed" ADD CONSTRAINT "StaffCalendarFeed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Each person sees, makes and removes only their own link.
GRANT SELECT, INSERT, DELETE ON "StaffCalendarFeed" TO ultm8_app;
ALTER TABLE "StaffCalendarFeed" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffCalendarFeed" FORCE ROW LEVEL SECURITY;
CREATE POLICY "staff_calendar_feed_self" ON "StaffCalendarFeed"
  USING ("StaffCalendarFeed"."userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("StaffCalendarFeed"."userId" = current_setting('app.current_user_id', true));

-- The functions below run as ultm8_rls_helper (BYPASSRLS), which reads
-- this table only through them.
GRANT SELECT ON "StaffCalendarFeed" TO ultm8_rls_helper;

-- The holder of a calendar link: whose link it is and at which School, while
-- the School is open, has the setting on, and the person still holds a staff
-- role there (owner, Branch Staff or coach). Not granted to anyone: only the
-- two functions below call it.
CREATE FUNCTION "staff_calendar_feed_holder"(p_token_hash text)
RETURNS TABLE ("userId" text, "schoolId" text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT f."userId", f."schoolId"
  FROM public."StaffCalendarFeed" f
  JOIN public."School" s ON s."id" = f."schoolId"
  WHERE p_token_hash IS NOT NULL AND p_token_hash <> ''
    AND f."tokenHash" = p_token_hash
    AND s."staffCalendarFeedsEnabled" = true
    AND s."archivedAt" IS NULL
    AND EXISTS (
      SELECT 1 FROM public."RoleGrant" rg
      WHERE rg."userId" = f."userId" AND rg."schoolId" = f."schoolId" AND rg."revokedAt" IS NULL
        AND rg."role" IN ('SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF', 'INSTRUCTOR')
    );
$$;
ALTER FUNCTION "staff_calendar_feed_holder"(text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "staff_calendar_feed_holder"(text) FROM PUBLIC;

-- The calendar's name (the School's), for a valid link only.
CREATE FUNCTION "staff_calendar_feed"(p_token_hash text)
RETURNS TABLE ("schoolName" text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT s."name"
  FROM public."staff_calendar_feed_holder"(p_token_hash) h
  JOIN public."School" s ON s."id" = h."schoolId";
$$;
ALTER FUNCTION "staff_calendar_feed"(text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "staff_calendar_feed"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "staff_calendar_feed"(text) TO ultm8_app;

-- The classes the link's holder teaches at that School: from 30 days back to
-- 180 days ahead, at most 1,000. A cancelled class stays, marked cancelled,
-- so calendars remove it.
CREATE FUNCTION "staff_calendar_feed_classes"(p_token_hash text)
RETURNS TABLE (
  "id" text, "title" text, "description" text, "startDate" timestamp(3), "endDate" timestamp(3),
  "cancelledAt" timestamp(3), "updatedAt" timestamp(3), "branchName" text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT c."id", c."title", c."description", c."startDate", c."endDate", c."cancelledAt", c."updatedAt", b."name"
  FROM public."staff_calendar_feed_holder"(p_token_hash) h
  JOIN public."Class" c ON c."schoolId" = h."schoolId" AND c."instructorId" = h."userId"
  LEFT JOIN public."Branch" b ON b."id" = c."branchId"
  WHERE c."archivedAt" IS NULL
    AND c."startDate" >= (now() AT TIME ZONE 'UTC') - interval '30 days'
    AND c."startDate" < (now() AT TIME ZONE 'UTC') + interval '180 days'
  ORDER BY c."startDate", c."id"
  LIMIT 1000;
$$;
ALTER FUNCTION "staff_calendar_feed_classes"(text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "staff_calendar_feed_classes"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "staff_calendar_feed_classes"(text) TO ultm8_app;

-- The schedule embed: the School's name and clock, for a valid key of an
-- open School only.
CREATE FUNCTION "schedule_embed"(p_key text)
RETURNS TABLE ("schoolName" text, "timezone" text, "weekStartsOn" text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT s."name", s."timezone", s."weekStartsOn"::text
  FROM public."School" s
  WHERE p_key IS NOT NULL AND p_key <> '' AND s."scheduleEmbedKey" = p_key AND s."archivedAt" IS NULL;
$$;
ALTER FUNCTION "schedule_embed"(text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "schedule_embed"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "schedule_embed"(text) TO ultm8_app;

-- The embed's classes: the School's public schedule for the next 28 days (the
-- weeks the timetable has made), at most 500. Only what the app's own School
-- page already shows anyone: title, times, Branch name and whether it is
-- cancelled. No coach, no bookings, no members, no ids.
CREATE FUNCTION "schedule_embed_classes"(p_key text)
RETURNS TABLE (
  "title" text, "startDate" timestamp(3), "endDate" timestamp(3), "cancelled" boolean,
  "branchName" text, "branchTimezone" text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT c."title", c."startDate", c."endDate", c."cancelledAt" IS NOT NULL, b."name", b."timezone"
  FROM public."School" s
  JOIN public."Class" c ON c."schoolId" = s."id"
  LEFT JOIN public."Branch" b ON b."id" = c."branchId"
  WHERE p_key IS NOT NULL AND p_key <> '' AND s."scheduleEmbedKey" = p_key AND s."archivedAt" IS NULL
    AND c."archivedAt" IS NULL
    AND (b."id" IS NULL OR b."archivedAt" IS NULL)
    AND c."endDate" >= (now() AT TIME ZONE 'UTC')
    AND c."startDate" < (now() AT TIME ZONE 'UTC') + interval '28 days'
  ORDER BY c."startDate", c."title"
  LIMIT 500;
$$;
ALTER FUNCTION "schedule_embed_classes"(text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "schedule_embed_classes"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "schedule_embed_classes"(text) TO ultm8_app;
