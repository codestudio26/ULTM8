-- Guests on a booking sign the School's waivers by a shared link (Waivers Q9).
--
-- Each guest seat (BookingAttendee) gets a link token. Only the token's SHA-256
-- is stored; the API derives the token itself from the seat id, so the booker
-- can share the same link again. A guest has no account, so:
--   * the signing page reads the link, class, School and waivers through the
--     SECURITY DEFINER functions below, for the holder of the token only;
--   * signing inserts GuestWaiverSignature rows in a transaction that sets
--     app.guest_waiver_token_hash, and the token-holder policies let that
--     transaction write and read back rows for that one seat only.
-- The School Owner/Manager and the booker read guest signatures.

ALTER TABLE "BookingAttendee" ADD COLUMN "guestTokenHash" TEXT;
CREATE UNIQUE INDEX "BookingAttendee_guestTokenHash_key" ON "BookingAttendee"("guestTokenHash");

CREATE TABLE "GuestWaiverSignature" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "schoolId" TEXT NOT NULL,
    "branchId" TEXT,
    "bookingAttendeeId" TEXT,
    "bookingId" TEXT,
    "bookedById" TEXT,
    "waiverId" TEXT NOT NULL,
    "classId" TEXT,
    "classTitle" TEXT NOT NULL,
    "classStartsAt" TIMESTAMP(3) NOT NULL,
    "guestFullName" TEXT NOT NULL,
    "guestDateOfBirth" DATE NOT NULL,
    "signerFullName" TEXT NOT NULL,
    "signatureText" TEXT NOT NULL,
    "signedByGuardian" BOOLEAN NOT NULL,
    "signedWaiverTitle" TEXT NOT NULL,
    "signedWaiverBody" TEXT NOT NULL,
    "signedWaiverSha256" TEXT NOT NULL,
    "signedWaiverVersion" INTEGER NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuestWaiverSignature_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GuestWaiverSignature_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- A signature is a legal record: it outlives the seat, booking and class
    -- it was signed for (each keeps a copy of what it needs), and is removed
    -- only by the retention purge.
    CONSTRAINT "GuestWaiverSignature_bookingAttendeeId_fkey" FOREIGN KEY ("bookingAttendeeId") REFERENCES "BookingAttendee"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GuestWaiverSignature_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GuestWaiverSignature_bookedById_fkey" FOREIGN KEY ("bookedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GuestWaiverSignature_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GuestWaiverSignature_waiverId_fkey" FOREIGN KEY ("waiverId") REFERENCES "Waiver"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GuestWaiverSignature_bookingAttendeeId_waiverId_key" ON "GuestWaiverSignature"("bookingAttendeeId", "waiverId");
CREATE INDEX "GuestWaiverSignature_schoolId_idx" ON "GuestWaiverSignature"("schoolId");
CREATE INDEX "GuestWaiverSignature_waiverId_idx" ON "GuestWaiverSignature"("waiverId");
CREATE INDEX "GuestWaiverSignature_bookingId_idx" ON "GuestWaiverSignature"("bookingId");
CREATE INDEX "GuestWaiverSignature_classId_idx" ON "GuestWaiverSignature"("classId");

GRANT SELECT, INSERT ON "GuestWaiverSignature" TO ultm8_app;

ALTER TABLE "GuestWaiverSignature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuestWaiverSignature" FORCE ROW LEVEL SECURITY;

-- School Owner/Manager: every guest signature at the School. Same narrow shape
-- as WaiverSignature (waiver_signature_school_staff_or_self): a signature holds
-- a person's name and date of birth. Branch Staff and Instructors see only
-- whether a guest has signed, on the class page, which the API reads through
-- ultm8_jobs after checking they are staff for that class.
CREATE POLICY "guest_waiver_signature_owner_read" ON "GuestWaiverSignature"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "RoleGrant" rg
      WHERE rg."schoolId" = "GuestWaiverSignature"."schoolId"
        AND rg."role" = 'SCHOOL_OWNER_MANAGER'
        AND rg."userId" = current_setting('app.current_user_id', true)
        AND rg."revokedAt" IS NULL
    )
  );

-- The booker: their own guests' signatures.
CREATE POLICY "guest_waiver_signature_booker_read" ON "GuestWaiverSignature"
  FOR SELECT
  USING ("GuestWaiverSignature"."bookedById" = current_setting('app.current_user_id', true));

-- The seat a link token belongs to, for the token-holder policies below. Only
-- a seat on an Upcoming booking matches.
CREATE FUNCTION "guest_waiver_attendee_id"(p_token_hash text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT ba."id"
  FROM public."BookingAttendee" ba
  JOIN public."Booking" b ON b."id" = ba."bookingId"
  WHERE p_token_hash IS NOT NULL AND p_token_hash <> ''
    AND ba."guestTokenHash" = p_token_hash
    AND b."status" = 'UPCOMING';
$$;

CREATE POLICY "guest_waiver_signature_token_holder_read" ON "GuestWaiverSignature"
  FOR SELECT
  USING (
    coalesce(current_setting('app.guest_waiver_token_hash', true), '') <> ''
    AND "GuestWaiverSignature"."bookingAttendeeId" = "guest_waiver_attendee_id"(current_setting('app.guest_waiver_token_hash', true))
  );

CREATE POLICY "guest_waiver_signature_token_holder_insert" ON "GuestWaiverSignature"
  FOR INSERT
  WITH CHECK (
    coalesce(current_setting('app.guest_waiver_token_hash', true), '') <> ''
    AND "GuestWaiverSignature"."bookingAttendeeId" = "guest_waiver_attendee_id"(current_setting('app.guest_waiver_token_hash', true))
  );

-- The signing page: the seat, its booking and class, and the School, for the
-- holder of the token only.
CREATE FUNCTION "guest_waiver_link"(p_token_hash text)
RETURNS TABLE (
  "attendeeId" text, "bookingId" text, "bookingStatus" text, "bookedById" text,
  "schoolId" text, "schoolName" text, "schoolArchivedAt" timestamp(3), "branchId" text,
  "classId" text, "classTitle" text, "classStartsAt" timestamp(3), "classEndsAt" timestamp(3)
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT ba."id", b."id", b."status"::text, b."studentId",
         s."id", s."name", s."archivedAt", b."branchId",
         c."id", c."title", c."startDate", c."endDate"
  FROM public."BookingAttendee" ba
  JOIN public."Booking" b ON b."id" = ba."bookingId"
  JOIN public."Class" c ON c."id" = b."classId"
  JOIN public."School" s ON s."id" = b."schoolId"
  WHERE p_token_hash IS NOT NULL AND p_token_hash <> '' AND ba."guestTokenHash" = p_token_hash;
$$;

-- The School's current waivers for the signing page, each with whether this
-- seat's guest has signed it.
CREATE FUNCTION "guest_waiver_link_waivers"(p_token_hash text)
RETURNS TABLE ("id" text, "title" text, "body" text, "version" integer, "signed" boolean)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT w."id", w."title", w."body", w."version",
         EXISTS (SELECT 1 FROM public."GuestWaiverSignature" g WHERE g."bookingAttendeeId" = ba."id" AND g."waiverId" = w."id")
  FROM public."BookingAttendee" ba
  JOIN public."Waiver" w ON w."schoolId" = ba."schoolId" AND w."archivedAt" IS NULL
  WHERE p_token_hash IS NOT NULL AND p_token_hash <> '' AND ba."guestTokenHash" = p_token_hash
  ORDER BY w."createdAt", w."id";
$$;

GRANT SELECT ON "BookingAttendee", "Booking", "Class", "School", "Waiver", "GuestWaiverSignature" TO ultm8_rls_helper;
ALTER FUNCTION "guest_waiver_attendee_id"(text) OWNER TO ultm8_rls_helper;
ALTER FUNCTION "guest_waiver_link"(text) OWNER TO ultm8_rls_helper;
ALTER FUNCTION "guest_waiver_link_waivers"(text) OWNER TO ultm8_rls_helper;
REVOKE ALL ON FUNCTION "guest_waiver_attendee_id"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "guest_waiver_link"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "guest_waiver_link_waivers"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "guest_waiver_attendee_id"(text) TO ultm8_app;
GRANT EXECUTE ON FUNCTION "guest_waiver_link"(text) TO ultm8_app;
GRANT EXECUTE ON FUNCTION "guest_waiver_link_waivers"(text) TO ultm8_app;

-- Retention purge (entity-offboarding-purge, ultm8_jobs): reads and deletes
-- guest signatures past their keep-until date.
GRANT SELECT, DELETE ON "GuestWaiverSignature" TO ultm8_jobs;
CREATE POLICY "guest_waiver_signature_jobs_read" ON "GuestWaiverSignature"
  FOR SELECT
  TO ultm8_jobs
  USING (true);
CREATE POLICY "guest_waiver_signature_jobs_delete" ON "GuestWaiverSignature"
  FOR DELETE
  TO ultm8_jobs
  USING (true);
