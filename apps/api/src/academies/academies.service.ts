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

  /** FOUND ON REVIEW (Decision 266 — see search()'s own comment below): a
   * closed School stays in this browse listing for up to 90 days pending
   * purge without this filter. Same fix applied to search()/findOne()/
   * findByJoinCode() below. */
  async findAll(cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    return cursorPaginate(
      (args) => this.prismaDiscovery.school.findMany({ ...args, where: { archivedAt: null }, select: SCHOOL_SUMMARY_SELECT }),
      cursor,
      limit,
    );
  }

  /**
   * Decision 266 — the pre-auth School-pick screen's "search by name" mode
   * (apps/student, no `/public/schools/*` route requires JwtAuthGuard — see
   * PublicAcademiesController's own header comment for why this is a
   * separate controller rather than relaxing the guard on the one above).
   * Same `ultm8_discovery`/SCHOOL_SUMMARY_SELECT mechanism as findAll(), just
   * with a name filter — no new DB grant needed (`name` was already
   * column-level granted, Phase 14).
   *
   * FOUND ON REVIEW: `archivedAt: null` is required here, not optional — a
   * School that's been closed (Decision 110's close-account flow) still
   * exists for up to 90 days pending purge, and without this filter a
   * brand-new, pre-auth installer could find and then actually join (via the
   * existing JoinSchoolScreen → `POST /schools/:id/join`) a School the
   * business already shut down. `findOne`/`findByJoinCode` below get the
   * same filter for the same reason.
   */
  async search(query: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    return cursorPaginate(
      (args) =>
        this.prismaDiscovery.school.findMany({
          ...args,
          where: { name: { contains: query, mode: 'insensitive' }, archivedAt: null },
          select: SCHOOL_SUMMARY_SELECT,
        }),
      cursor,
      limit,
    );
  }

  /**
   * Decision 266 — the pre-auth School-pick screen's "enter a join code"
   * mode. Same detail shape as findOne() (branches, for picking a home
   * branch before joining, Decision 209) — deliberately looked up by
   * `joinCode`, never by exposing `id` as a guessable path, which is the
   * whole reason a join code exists instead of just telling people to type
   * in a School's UUID.
   */
  async findByJoinCode(joinCode: string) {
    const school = await this.prismaDiscovery.school.findFirst({
      where: { joinCode, archivedAt: null },
      select: {
        ...SCHOOL_SUMMARY_SELECT,
        membershipPlans: {
          where: { visible: true, archivedAt: null },
          orderBy: { id: 'asc' },
          take: MEMBERSHIP_PLANS_LIMIT,
          select: MEMBERSHIP_PLAN_DISCOVERY_SELECT,
        },
        branches: { orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true } },
        classes: {
          where: { startDate: { gte: new Date() } },
          orderBy: { startDate: 'asc' },
          take: UPCOMING_CLASSES_LIMIT,
          select: CLASS_DISCOVERY_SELECT,
        },
      },
    });
    if (!school) {
      // Deliberately the same generic message as findOne()'s id-not-found —
      // this endpoint has no auth boundary to protect by distinguishing
      // "wrong code" from "right code, something else failed", but a
      // code-specific message would help someone fishing for valid codes.
      throw new NotFoundException('Academy not found');
    }
    const { classes: upcomingClasses, ...summary } = school;
    return { ...summary, upcomingClasses };
  }

  /** One nested query, not three sequential ones — membershipPlans/classes are fetched
   * as relations on the same School read rather than as separate round trips (an
   * earlier draft did three; caught on code review as unnecessary latency for what's
   * conceptually one "detail" read).
   *
   * FOUND ON REVIEW (Decision 266 — see search()'s own comment for the full
   * account): `archivedAt: null` added here too — this method predates
   * Decision 266 but had the identical gap, just reachable only by an
   * already-authenticated caller rather than a pre-auth one. `findUnique`
   * can't take an extra filter alongside a unique field in the same `where`,
   * hence `findFirst` (id is still effectively unique). */
  async findOne(schoolId: string) {
    const school = await this.prismaDiscovery.school.findFirst({
      where: { id: schoolId, archivedAt: null },
      select: {
        ...SCHOOL_SUMMARY_SELECT,
        membershipPlans: {
          // v1.2 backend backlog "Archive action" — an archived plan must
          // never appear in the Student-facing purchase list, same
          // discipline `visible: true` already enforces here. Belt-and-
          // suspenders with the row-level policy (membership_plan_discovery_read,
          // widened in this same PR) — see that migration's own comment.
          where: { visible: true, archivedAt: null },
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
        // Branch names only (Decision 209), so a student can choose a home
        // branch when joining. Ordered by name: createdAt isn't granted.
        branches: { orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { id: true, name: true } },
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
