-- ULTM8 Decision 123 — Guardian "Kid Mode" booking delegation: a Guardian-
-- controlled, per-minor, revocable grant letting a linked minor book a Class
-- themselves (against an existing paid Membership/class-pack credit only), from
-- inside the Guardian's own already-authenticated session.
--
-- Additive-only (Decision 32) — no existing table/policy from any prior
-- migration is touched or dropped.
--
-- Hand-authored against a real local Postgres 16 (not blind) — written, then
-- verified with `prisma migrate diff` against the live `ultm8` database to
-- confirm it produces exactly this delta and nothing else. NOTE: that diff also
-- surfaced real, pre-existing, project-wide drift unrelated to this feature —
-- every table's "id" column has a live SQL-level DEFAULT gen_random_uuid()::text
-- (set by every prior hand-authored migration) that schema.prisma itself never
-- declares (`@default(uuid())` there is a Prisma-client-side default, not a SQL
-- one) — `prisma migrate dev`'s auto-generated diff tried to DROP DEFAULT on
-- every single table's "id" column to reconcile it. Deliberately NOT fixed here
-- — flagged to the user separately, since "fixing" 30+ unrelated tables inside a
-- Guardian-delegation migration would be exactly the kind of silent, oversized
-- side effect this codebase's own conventions warn against.

-- ============================================================================
-- BookingDelegation — same narrow self-only RLS shape as GuardianLink/
-- ConsentRecord (Decision 92): only the Guardian who owns the row can see/write
-- it. No ultm8_jobs bypass needed (unlike ConsentRecord's own camera-tier
-- check) — the only consumer, BookingsController's live pre-booking check,
-- always runs under the Guardian's own already-authenticated context.
-- ============================================================================

CREATE TYPE "BookingDelegationStatus" AS ENUM ('ACTIVE', 'WITHDRAWN');

-- RESTRICT, not CASCADE — same audit-trail reasoning as GuardianLink/
-- ConsentRecord's own FKs (a WITHDRAWN BookingDelegation is the evidence a
-- revocation happened; a future User-deletion cascade must never silently
-- erase it).
CREATE TABLE "BookingDelegation" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "guardianId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "BookingDelegationStatus" NOT NULL DEFAULT 'ACTIVE',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    CONSTRAINT "BookingDelegation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BookingDelegation_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BookingDelegation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BookingDelegation_guardianId_studentId_key" ON "BookingDelegation"("guardianId", "studentId");
CREATE INDEX "BookingDelegation_studentId_idx" ON "BookingDelegation"("studentId");

GRANT SELECT, INSERT, UPDATE, DELETE ON "BookingDelegation" TO ultm8_app;

ALTER TABLE "BookingDelegation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BookingDelegation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "booking_delegation_self_only" ON "BookingDelegation"
  USING (
    "BookingDelegation"."guardianId" = current_setting('app.current_user_id', true)
  );

-- ============================================================================
-- Booking: two new columns (Decision 123). bookedViaKidMode marks a Booking
-- created via a Kid-Mode-scoped token, so withdrawing a BookingDelegation knows
-- which of a minor's UPCOMING Bookings to flag. pendingGuardianReview is set
-- true only by that flagging (never at creation) — surfaced in the Guardian's
-- app as a Confirm/Cancel action. No new RLS policy needed: both columns live
-- on a table a Guardian never reads/writes under their OWN context anyway —
-- every existing Guardian-on-behalf-of consumer (bookClass, cancelBooking)
-- already switches into the MINOR's own tenant context first
-- (assertGuardianOfStudent(), then withTenantContext(studentId, ...)) — the
-- same pattern the new review-queue reads/writes will reuse, so Booking's
-- existing self-context-row-access policy already covers these two columns
-- exactly as it covers every other Booking field.
-- ============================================================================

ALTER TABLE "Booking" ADD COLUMN "bookedViaKidMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Booking" ADD COLUMN "pendingGuardianReview" BOOLEAN NOT NULL DEFAULT false;
