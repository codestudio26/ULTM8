import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaDiscoveryService } from '../common/prisma/prisma-discovery.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { shapeTimetableSlotResponse } from '../timetable/timetable.service';

// These four `select` shapes MUST match the column-level Postgres GRANTs the Phase 14
// migration (20260917000000_academies_discovery_module) gives the `ultm8_discovery`
// role, field-for-field — that's not a convention, it's enforced: PrismaDiscoveryService
// connects AS that role, so a `select` naming any column outside its GRANT fails the
// query with a Postgres permission error rather than silently returning less than
// expected. Deliberately excludes every operational/internal/identity-linkable field —
// see academy-response.dto.ts's header comment for the full excluded-field list and the
// reasoning per entity.
const SCHOOL_SUMMARY_SELECT = {
  id: true,
  franchiseId: true,
  name: true,
  address: true,
  activities: true,
  facilities: true,
  defaultLanguage: true,
  defaultCurrency: true,
  description: true,
  logoUrl: true,
  bannerUrl: true,
} as const;

const MEMBERSHIP_PLAN_DISCOVERY_SELECT = {
  id: true,
  schoolId: true,
  type: true,
  title: true,
  price: true,
  currency: true,
  expiryDurationDays: true,
  classesIncluded: true,
  visible: true,
} as const;

const CLASS_DISCOVERY_SELECT = {
  id: true,
  schoolId: true,
  title: true,
  activities: true,
  bannerUrl: true,
  description: true,
  startDate: true,
  endDate: true,
  capacity: true,
} as const;

const TIMETABLE_SLOT_DISCOVERY_SELECT = {
  id: true,
  schoolId: true,
  weekday: true,
  startTime: true,
  endTime: true,
  breakStart: true,
  breakEnd: true,
  status: true,
  title: true,
  activities: true,
  capacity: true,
  description: true,
  bannerUrl: true,
} as const;

// Upcoming-Classes/visible-MembershipPlans windows for GET /academies/:id — a
// Developer-level bound (see the Phase 14 kickoff prompt §3), not a spec-confirmed
// figure: a discovery profile needs "what's coming up / on offer right now," not a
// School's full historical/future catalog. Reuses the `startDate` filtering
// AttendanceModule/BookingsModule already established, not a new pagination concept —
// both are capped rather than cursor-paginated since they're one bounded slice of a
// detail response, not their own list endpoints.
const UPCOMING_CLASSES_LIMIT = 20;
const MEMBERSHIP_PLANS_LIMIT = 50;

/**
 * Phase 14 — AcademiesModule (mobile-facing discovery). See the Phase 14 kickoff
 * prompt and docs/decisions/POST-SPEC-55-DECISION-LOG.md Decision 94 (including its
 * "FOUND ON REVIEW" follow-up) for the full scoping rationale: this module
 * deliberately reads School/Class/MembershipPlan/TimetableSlot rows OUTSIDE the
 * caller's own RoleGrant footprint.
 *
 * Every read here runs through `PrismaDiscoveryService` — a connection authenticated
 * as the dedicated `ultm8_discovery` Postgres role (Phase 14 migration), NOT
 * `PrismaAppService`/`ultm8_app` (the role every other interactive query in this
 * codebase runs under) and NOT `PrismaJobsService`/`ultm8_jobs` (background jobs and
 * narrow same-School aggregate reads). An earlier draft of this service used
 * `PrismaAppService.withTenantContext` with a policy scoped `TO ultm8_app` — caught on
 * this PR's own code review as a severe mistake: Postgres OR-combines permissive
 * policies for the same role+command, so that draft silently widened SELECT
 * visibility on these four tables for every OTHER module's existing queries too, not
 * just this one's. Using a genuinely separate, dedicated role (the same shape
 * `ultm8_jobs` already established) means widening what THIS connection can see has
 * zero effect on any other module's isolation guarantees, by construction.
 *
 * Authentication (that the caller holds a valid JWT at all) is still enforced by
 * `JwtAuthGuard` on the controller — `ultm8_discovery`'s own RLS policies don't
 * re-check that, the same way `ultm8_jobs`'s policies don't (that role has no HTTP
 * caller at all). No audit trail of which caller browsed which School exists yet —
 * flagged as not built this phase, same treatment as every other deliberately-deferred
 * item in this codebase.
 *
 * Column-level curation happens twice: the `select` shapes above (app layer) AND the
 * migration's own column-level GRANTs (database layer, the actual backstop — see this
 * file's other header comments for why that matters).
 */
@Injectable()
export class AcademiesService {
  constructor(private readonly prismaDiscovery: PrismaDiscoveryService) {}

  async findAll(cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    return cursorPaginate(
      (args) => this.prismaDiscovery.school.findMany({ ...args, select: SCHOOL_SUMMARY_SELECT }),
      cursor,
      limit,
    );
  }

  /** One nested query, not three sequential ones — membershipPlans/classes are fetched
   * as relations on the same School read rather than as separate round trips (an
   * earlier draft did three; caught on code review as unnecessary latency for what's
   * conceptually one "detail" read). */
  async findOne(schoolId: string) {
    const school = await this.prismaDiscovery.school.findUnique({
      where: { id: schoolId },
      select: {
        ...SCHOOL_SUMMARY_SELECT,
        membershipPlans: {
          where: { visible: true },
          // Ordered by id, NOT createdAt — createdAt is deliberately excluded from
          // both this select and the migration's own column-level GRANT (an
          // internal/audit field, not discovery-appropriate), and Postgres requires
          // SELECT privilege on a column to ORDER BY it even when it isn't returned.
          // Found on review: an earlier draft ordered by createdAt here and would
          // have failed every call with a permission-denied error.
          orderBy: { id: 'asc' },
          take: MEMBERSHIP_PLANS_LIMIT,
          select: MEMBERSHIP_PLAN_DISCOVERY_SELECT,
        },
        classes: {
          where: { startDate: { gte: new Date() } },
          orderBy: { startDate: 'asc' },
          take: UPCOMING_CLASSES_LIMIT,
          select: CLASS_DISCOVERY_SELECT,
        },
      },
    });
    // RLS/GRANT returns null (not another tenant's row) only for a School that
    // genuinely doesn't exist — under the discovery-read policy every authenticated
    // caller can see every real School's summary fields (ultm8-tenant-isolation §2's
    // usual "404 and isolation-blocked read are indistinguishable" framing doesn't
    // apply the same way here, by design — see Decision 94).
    if (!school) {
      throw new NotFoundException('Academy not found');
    }
    const { classes: upcomingClasses, ...summary } = school;
    return { ...summary, upcomingClasses };
  }

  /**
   * Active (`status: ON`) TimetableSlots for one School — enforced at the row level
   * by the migration's own timetable_slot_discovery_read policy (not just this
   * `where` clause, which is belt-and-suspenders). Reuses TimetableService's own
   * exported response-shaping (shapeTimetableSlotResponse) rather than
   * re-implementing it.
   *
   * The ON-only filter itself is a Developer-level inference, not spec-confirmed —
   * flagged here explicitly (found missing this flag on code review), same
   * treatment as the curated-field-list/authentication-scope/upcoming-classes-window
   * inferences elsewhere in this module. Nothing in the confirmed scope says whether
   * a paused/OFF slot should be hidden from discovery entirely or shown with its OFF
   * status visible; hiding it was chosen as the more conservative reading (an OFF
   * slot isn't bookable, so showing it in a "what can I join" browse view seemed more
   * likely to mislead than help) — but this is this developer's judgment call, not a
   * confirmed rule, and should be revisited if Architect/product input says otherwise.
   */
  async findTimetable(schoolId: string, cursor?: string, limit?: number) {
    const school = await this.prismaDiscovery.school.findUnique({ where: { id: schoolId }, select: { id: true } });
    if (!school) {
      throw new NotFoundException('Academy not found');
    }
    const page = await cursorPaginate(
      (args) =>
        this.prismaDiscovery.timetableSlot.findMany({
          ...args,
          where: { schoolId, status: 'ON' },
          select: TIMETABLE_SLOT_DISCOVERY_SELECT,
        }),
      cursor,
      limit,
    );
    return { ...page, items: page.items.map((slot) => shapeTimetableSlotResponse(slot)) };
  }
}
