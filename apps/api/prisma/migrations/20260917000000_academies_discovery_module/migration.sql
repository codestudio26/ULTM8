-- ULTM8 Phase 14 — AcademiesModule (mobile-facing discovery)
--
-- See docs/decisions/POST-SPEC-55-DECISION-LOG.md, Decision 94 (including its
-- "FOUND ON REVIEW, BEFORE THIS EVER SHIPPED" follow-up), for the full
-- reasoning. Summary: "discovery" (nestjs-module SKILL.md §5 — "read-optimized
-- view over Tenants/Classes/Memberships") is definitionally about a caller
-- browsing Schools they hold NO RoleGrant at — a genuine tenant-boundary
-- crossing, distinct from the narrower same-School RLS-visibility gaps Booking
-- (Decision 89) and ConsentRecord (Decision 92/93) each closed via the
-- `ultm8_jobs` bypass role.
--
-- ============================================================================
-- THIS MIGRATION WAS REWRITTEN BEFORE EVER SHIPPING, on the strength of a
-- high-effort multi-angle code review that caught a severe design mistake in
-- the first draft: that draft scoped its four new SELECT policies `TO
-- ultm8_app` — the SAME Postgres role every other interactive query in this
-- entire codebase already runs under via PrismaAppService.withTenantContext,
-- not a role unique to AcademiesModule. Postgres combines multiple PERMISSIVE
-- policies for the same role+command with OR, so that draft didn't just widen
-- visibility for the new `/academies` routes — it silently widened SELECT
-- visibility on School/Class/MembershipPlan/TimetableSlot for EVERY existing
-- endpoint that queries those tables as ultm8_app (SchoolsService,
-- ClassesService, TimetableService, MembershipsService), breaking their own
-- RLS-enforced tenant isolation platform-wide and contradicting multiple
-- existing e2e assertions (classes.e2e-spec.ts, timetable.e2e-spec.ts) that a
-- caller with no RoleGrant gets a 404, not another tenant's row. Caught before
-- commit, not after — see the code-review skill's findings for this PR.
--
-- THE FIX: follow the SAME precedent `ultm8_jobs` itself already established
-- for "a caller population that legitimately needs to read outside the normal
-- per-caller RLS shape" — a genuinely NEW, DEDICATED, narrowly-scoped Postgres
-- LOGIN role (own connection string DATABASE_URL_DISCOVERY, own
-- PrismaDiscoveryService, exactly the ultm8_auth/ultm8_jobs pattern), not a
-- policy attached to the shared ultm8_app role. `ultm8_discovery` is used
-- ONLY by AcademiesService — no other module ever connects as this role, so
-- widening what it can see has zero blast radius on any other endpoint's
-- isolation guarantees, by construction rather than by care.
--
-- A SECOND layer of rigor added on this rewrite, beyond the first draft: each
-- table also gets an explicit Postgres COLUMN-level GRANT restricting
-- `ultm8_discovery` to exactly the curated, discovery-appropriate columns
-- AcademiesService actually needs — not just an application-layer `select`
-- (which a future edit could accidentally omit). If a future change to
-- AcademiesService ever queries a column outside this list (e.g. `SELECT *`,
-- or a forgotten `select` clause), Postgres itself rejects the query with a
-- permission error rather than silently returning the extra column — the
-- database enforces the curation contract, not just code review. This mirrors
-- the chargeback-pattern-restriction job's own governing principle (SKILL.md
-- §7) more faithfully than the first draft did: a party outside the normal
-- isolation boundary sees only a curated, deliberately narrow result, enforced
-- at the layer closest to the data, not merely a service-layer convention.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ultm8_discovery') THEN
    CREATE ROLE ultm8_discovery LOGIN PASSWORD 'changeme';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO ultm8_discovery;

-- School — same curated field list as AcademySummaryDto/AcademyDetailDto
-- (apps/api/src/academies/dto/academy-response.dto.ts). Deliberately excludes
-- mobileNumber (direct contact-sensitive) and every operational/internal field
-- (businessType, ranksToggle, classCancellationPolicy,
-- waitlistClaimWindowMinutes, franchiseFeeSubscriptionStatus).
GRANT SELECT ("id", "franchiseId", "name", "address", "activities", "facilities", "defaultLanguage", "defaultCurrency", "description", "logoUrl", "bannerUrl") ON "School" TO ultm8_discovery;
CREATE POLICY "school_discovery_read" ON "School"
  FOR SELECT
  TO ultm8_discovery
  USING (true);

-- Class — excludes instructorId (an identity-linkable User id — a stranger
-- browsing a School they've never joined has no legitimate reason to see who
-- teaches a specific Class), bookingEndAt/qrAttendanceEndAt/refundFeeDate/
-- cancellationCharge/termsWaiverRequired/membershipInclusion (operational/
-- booking-mechanics fields, not "what's coming up" discovery content), and
-- branchId/timetableSlotId/occurrenceDate/createdAt/updatedAt (internal
-- linkage/audit fields).
GRANT SELECT ("id", "schoolId", "title", "activities", "bannerUrl", "description", "startDate", "endDate", "capacity") ON "Class" TO ultm8_discovery;
CREATE POLICY "class_discovery_read" ON "Class"
  FOR SELECT
  TO ultm8_discovery
  USING (true);

-- MembershipPlan — excludes refundFeeDate/cancellationCharge/
-- termsWaiverRequired (operational/cancellation-policy mechanics) and
-- scopedClassId (internal linkage). `visible = true` is enforced BOTH here (a
-- defense-in-depth row-level restriction, matching the discipline the first
-- draft already applied only to this one table) AND again in
-- AcademiesService's own `where` clause — belt-and-suspenders, not redundant:
-- the row-level policy is what actually protects a hidden/draft plan if a
-- future query ever forgets the app-layer filter.
GRANT SELECT ("id", "schoolId", "type", "title", "price", "currency", "expiryDurationDays", "classesIncluded", "visible") ON "MembershipPlan" TO ultm8_discovery;
CREATE POLICY "membership_plan_discovery_read" ON "MembershipPlan"
  FOR SELECT
  TO ultm8_discovery
  USING ("MembershipPlan"."visible" = true);

-- TimetableSlot — excludes instructorId/branchId (same reasoning as Class
-- above) and termsWaiverRequired/membershipInclusion/
-- bookingCutoffMinutesBeforeStart/qrAttendanceWindowMinutes/
-- refundCutoffHoursBeforeStart/cancellationCharge (booking-mechanics fields).
-- `status = 'ON'` enforced here at the row level (same belt-and-suspenders
-- reasoning as MembershipPlan.visible above) — the first draft left this
-- filter as an app-layer-only convention with no row-level backstop, flagged
-- on review as inconsistent with how MembershipPlan's own policy was already
-- written in the same migration.
GRANT SELECT ("id", "schoolId", "weekday", "startTime", "endTime", "breakStart", "breakEnd", "status", "title", "activities", "capacity", "description", "bannerUrl") ON "TimetableSlot" TO ultm8_discovery;
CREATE POLICY "timetable_slot_discovery_read" ON "TimetableSlot"
  FOR SELECT
  TO ultm8_discovery
  USING ("TimetableSlot"."status" = 'ON');

-- ============================================================================
-- New composite indexes — this phase introduces the first query patterns in
-- this codebase that range-filter/order Class by startDate (AcademiesService
-- .findOne's "upcoming Classes" read) and filter TimetableSlot by status
-- (AcademiesService.findTimetable's "active slots only" read) at what is now,
-- by this phase's own design, a school-count-unbounded, any-authenticated-
-- caller-reachable surface. Composite, tenant-column-leading (Decision 30),
-- same convention as every other index in this schema.
-- ============================================================================
CREATE INDEX "Class_schoolId_startDate_idx" ON "Class"("schoolId", "startDate");
CREATE INDEX "TimetableSlot_schoolId_status_idx" ON "TimetableSlot"("schoolId", "status");
