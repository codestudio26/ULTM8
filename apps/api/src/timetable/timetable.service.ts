import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { resolveClassStyles, styleIdsOf } from '../classes/class-styles';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { CreateTimetableSlotDto } from './dto/create-timetable-slot.dto';
import { UpdateTimetableSlotDto } from './dto/update-timetable-slot.dto';

const RETENTION_WINDOW_DAYS = 90;

/**
 * `@db.Time(0)` columns round-trip through Prisma as a `Date` whose time-of-day
 * component is meaningful and whose date component is a fixed epoch (1970-01-01 UTC,
 * per Prisma's own convention for a bare TIME column) — never meant to be read as a
 * real calendar date. `parseHHmm`/`formatHHmm`/`shapeTimetableSlotResponse` are the
 * only places that epoch detail is allowed to leak; every DTO and response stays in
 * plain `HH:mm` strings.
 *
 * `parseHHmm` stays module-private — its only callers are `create`/`update` below,
 * whose input already passed through CreateTimetableSlotDto/UpdateTimetableSlotDto's
 * class-validator rules; it does no validation of its own (a malformed string silently
 * produces an Invalid Date), so it shouldn't be reachable by anything that hasn't
 * already validated its input the same way.
 */
function parseHHmm(value: string): Date {
  const [hours, minutes] = value.split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0));
}

function formatHHmm(value: Date): string {
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Exported (not module-private) since Phase 14 — AcademiesService needs the exact
 * same TimetableSlot -> HH:mm response shaping for its own read-only discovery
 * timetable endpoint and must reuse this one function, not re-implement the same
 * object-literal shaping a second time (a duplication the Phase 14 code review
 * caught in an earlier draft of that service).
 */
export function shapeTimetableSlotResponse<
  T extends { startTime: Date; endTime: Date; breakStart: Date | null; breakEnd: Date | null },
>(slot: T) {
  return {
    ...slot,
    startTime: formatHHmm(slot.startTime),
    endTime: formatHHmm(slot.endTime),
    breakStart: slot.breakStart ? formatHHmm(slot.breakStart) : null,
    breakEnd: slot.breakEnd ? formatHHmm(slot.breakEnd) : null,
  };
}

@Injectable()
export class TimetableService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
  ) {}

  /**
   * School Owner/Manager only (Spec §8.2) — same gate as Class CRUD (Phase 4);
   * Instructor's confirmed permissions don't include School settings/schedule
   * management.
   */
  async create(callerId: string, schoolId: string, dto: CreateTimetableSlotDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);

    if (dto.branchId) {
      await this.tenantAuth.assertBranchBelongsToSchool(callerId, dto.branchId, schoolId);
    }
    if (dto.instructorId) {
      await this.tenantAuth.assertValidInstructor(callerId, dto.instructorId, schoolId, dto.branchId ?? null);
    }

    const slotId = randomUUID();
    const created = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const { styles, activities } = await resolveClassStyles(tx, schoolId, dto.styles, dto.activities);
      return tx.timetableSlot.create({
        data: {
          id: slotId,
          schoolId,
          branchId: dto.branchId,
          instructorId: dto.instructorId,
          weekday: dto.weekday,
          startTime: parseHHmm(dto.startTime),
          endTime: parseHHmm(dto.endTime),
          breakStart: dto.breakStart ? parseHHmm(dto.breakStart) : undefined,
          breakEnd: dto.breakEnd ? parseHHmm(dto.breakEnd) : undefined,
          status: dto.status ?? 'ON',
          title: dto.title,
          activities,
          styles,
          capacity: dto.capacity,
          description: dto.description,
          bannerUrl: dto.bannerUrl,
          termsWaiverRequired: dto.termsWaiverRequired ?? false,
          membershipInclusion: dto.membershipInclusion ?? false,
          bookingCutoffMinutesBeforeStart: dto.bookingCutoffMinutesBeforeStart,
          qrAttendanceWindowMinutes: dto.qrAttendanceWindowMinutes,
          refundCutoffHoursBeforeStart: dto.refundCutoffHoursBeforeStart,
          cancellationCharge: dto.cancellationCharge,
        },
      });
    });
    return this.toResponse(created);
  }

  /** Slots visible to the caller under one School — RLS restricts this to a School-
   * level grant (sees every slot, any Branch) or a Branch-scoped grant (their own
   * Branch's slots plus School-wide ones — timetable_slot_tenant_isolation, this
   * phase's migration; same three-way structure as class_tenant_isolation). */
  /** Decision 226 — `includeArchived` (default false) excludes archived
   * slots from the default view. */
  async findAllForSchool(
    callerId: string,
    schoolId: string,
    cursor?: string,
    limit?: number,
    includeArchived?: boolean,
  ): Promise<CursorPage<ReturnType<TimetableService['toResponse']>>> {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    const page = await this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate(
        (args) => tx.timetableSlot.findMany({ ...args, where: { schoolId, ...(includeArchived ? {} : { archivedAt: null }) } }),
        cursor,
        limit,
      ),
    );
    return { ...page, items: page.items.map((slot) => this.toResponse(slot)) };
  }

  async findOne(callerId: string, slotId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.timetableSlot.findUnique({ where: { id: slotId } }),
    );
    // RLS returns null (not another tenant's row) for a slot outside the caller's
    // scope — a genuine 404 and a cross-tenant-blocked read are indistinguishable at
    // this layer by design (ultm8-tenant-isolation §2).
    if (!found) {
      throw new NotFoundException('TimetableSlot not found');
    }
    return this.toResponse(found);
  }

  /** School Owner/Manager only — resolved via the slot's own schoolId, not a route param. */
  async update(callerId: string, slotId: string, dto: UpdateTimetableSlotDto) {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.timetableSlot.findUnique({ where: { id: slotId } }),
    );
    if (!existing) {
      throw new NotFoundException('TimetableSlot not found');
    }
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    // Decision 110 (Phase 56) — a closed School accepts no further writes.
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);

    const nextBranchId = dto.branchId !== undefined ? dto.branchId : existing.branchId;
    const nextInstructorId = dto.instructorId !== undefined ? dto.instructorId : existing.instructorId;

    if (dto.branchId) {
      await this.tenantAuth.assertBranchBelongsToSchool(callerId, dto.branchId, existing.schoolId);
    }
    // Same "revalidate whenever the row still has an instructor after this patch, not
    // only when instructorId is itself in the body" fix Phase 4's code review caught
    // for ClassesService.update() — applied here from the start rather than being
    // rediscovered a second time.
    if (nextInstructorId) {
      await this.tenantAuth.assertValidInstructor(callerId, nextInstructorId, existing.schoolId, nextBranchId);
    }

    if ((dto as { styles?: unknown }).styles === null) {
      throw new BadRequestException('styles cannot be null; omit it to leave the styles unchanged.');
    }

    const updated = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      // Styles are replaced when sent and kept when omitted (Decision 170).
      const resolved = dto.styles !== undefined ? await resolveClassStyles(tx, existing.schoolId, dto.styles, dto.activities, styleIdsOf(existing.styles)) : null;
      return tx.timetableSlot.update({
        where: { id: slotId },
        data: {
          branchId: dto.branchId,
          instructorId: dto.instructorId,
          weekday: dto.weekday,
          startTime: dto.startTime ? parseHHmm(dto.startTime) : undefined,
          endTime: dto.endTime ? parseHHmm(dto.endTime) : undefined,
          breakStart: dto.breakStart ? parseHHmm(dto.breakStart) : undefined,
          breakEnd: dto.breakEnd ? parseHHmm(dto.breakEnd) : undefined,
          status: dto.status,
          title: dto.title,
          activities: resolved ? resolved.activities : dto.activities,
          styles: resolved ? resolved.styles : undefined,
          capacity: dto.capacity,
          description: dto.description,
          bannerUrl: dto.bannerUrl,
          termsWaiverRequired: dto.termsWaiverRequired,
          membershipInclusion: dto.membershipInclusion,
          bookingCutoffMinutesBeforeStart: dto.bookingCutoffMinutesBeforeStart,
          qrAttendanceWindowMinutes: dto.qrAttendanceWindowMinutes,
          refundCutoffHoursBeforeStart: dto.refundCutoffHoursBeforeStart,
          cancellationCharge: dto.cancellationCharge,
        },
      });
    });
    // Deliberately NOT touching Classes already materialized from this slot — Spec 55
    // doesn't say what should happen to them on an edit (status flip, instructor
    // change, time change), and retroactively cancelling/mutating rows a Student may
    // already hold real Bookings against is the wrong default to guess at. Flagged,
    // not resolved — see the Phase 5 kickoff prompt.
    return this.toResponse(updated);
  }

  /**
   * GET /timetable/:id/occurrence?date=YYYY-MM-DD — Timetable page redesign
   * (click-to-book). Resolves a specific weekday occurrence of this recurring
   * slot to its materialized, bookable `Class` row, per
   * `skills/ultm8-domain-rules/SKILL.md` §9 (`[CONFIRMED]`, resolved 24 Aug
   * 2026): a bookable Class is either materialized ahead of time from an
   * active, recurring TimetableSlot (the class-occurrence-generation job,
   * WEEKS_AHEAD) or created as an independent one-off event — never on
   * demand. `Class`'s own `@@unique([timetableSlotId, occurrenceDate])`
   * guarantees at most one match.
   *
   * Staff-only (School Owner/Manager, Branch Staff, or Instructor) — unlike
   * `findOne` above, which any RoleGrant holder at the School may read (the
   * slot TEMPLATE is visible School-wide), this resolves toward an actual
   * booking action, which SKILL.md §9/§10 reserve to Staff (a Student books
   * through the mobile app's own class-browsing flow, not this endpoint).
   * The slot lookup itself still runs under the caller's own tenant context
   * first, so a slot genuinely outside the caller's visibility (wrong
   * School/Branch) 404s before the Staff check ever runs — same
   * RLS-blocked-and-genuinely-missing-are-indistinguishable convention as
   * every other lookup in this service.
   *
   * No Class materialized yet for this date (e.g. beyond the 4-week
   * generation horizon, or the slot was only just turned on and the job
   * hasn't run) is a clear, expected 404 — never created on demand, which
   * would re-litigate the already-resolved "materialize ahead of time vs.
   * on-demand" question, and never an unhandled 500.
   */
  async findOccurrence(callerId: string, slotId: string, date: string) {
    const slot = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.timetableSlot.findUnique({ where: { id: slotId } }),
    );
    if (!slot) {
      throw new NotFoundException('TimetableSlot not found');
    }
    await this.tenantAuth.assertStaffAtSchool(callerId, slot.schoolId, slot.branchId);

    // Matches class-occurrence-generation.processor.ts's own construction of
    // Class.occurrenceDate: a UTC midnight instant built directly from the
    // calendar date's year/month/day, never a locally-parsed Date (which
    // would silently shift a day for a timezone offset from UTC).
    const occurrenceDate = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(occurrenceDate.getTime())) {
      throw new BadRequestException('date must be a valid calendar date.');
    }

    const occurrence = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.class.findUnique({
        where: { timetableSlotId_occurrenceDate: { timetableSlotId: slotId, occurrenceDate } },
      }),
    );
    if (!occurrence) {
      throw new NotFoundException(
        'No bookable Class has been generated yet for this occurrence — it may be beyond the 4-week ' +
          'generation horizon, or this slot was only just turned on and the daily job has not run yet.',
      );
    }
    return occurrence;
  }

  // ---------------------------------------------------------------------------
  // Decision 226 — entity-level tenant offboarding. Same shape/reasoning as
  // BranchesService's own archive()/unarchive() pair.
  // ---------------------------------------------------------------------------

  /** Active dependents that block archiving a TimetableSlot — the task's own
   * hint: "any upcoming Booking referencing it," resolved via Class (Booking
   * belongs to Class, never to TimetableSlot directly — Class.timetableSlotId
   * is the link the class-occurrence-generation job maintains, reconfirmed by
   * Decision 230). */
  private async assertNoActiveDependents(callerId: string, slotId: string): Promise<void> {
    const upcomingBookings = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.booking.count({ where: { status: 'UPCOMING', class: { timetableSlotId: slotId } } }),
    );
    if (upcomingBookings > 0) {
      throw new ConflictException(
        `This TimetableSlot can't be archived while it still has ${upcomingBookings} upcoming booking${upcomingBookings === 1 ? '' : 's'} against its generated Classes.`,
      );
    }
  }

  async archive(callerId: string, slotId: string) {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.timetableSlot.findUnique({ where: { id: slotId } }));
    if (!existing) {
      throw new NotFoundException('TimetableSlot not found');
    }
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    if (existing.archivedAt) {
      return this.toResponse(existing);
    }
    await this.assertNoActiveDependents(callerId, slotId);

    const now = new Date();
    const purgeAt = new Date(now.getTime() + RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const updated = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      await tx.timetableSlot.updateMany({ where: { id: slotId, archivedAt: null }, data: { archivedAt: now, purgeAt } });
      return tx.timetableSlot.findUniqueOrThrow({ where: { id: slotId } });
    });
    return this.toResponse(updated);
  }

  async unarchive(callerId: string, slotId: string) {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.timetableSlot.findUnique({ where: { id: slotId } }));
    if (!existing) {
      throw new NotFoundException('TimetableSlot not found');
    }
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, existing.schoolId);
    if (!existing.archivedAt) {
      return this.toResponse(existing);
    }
    if (existing.purgedAt) {
      throw new ConflictException('This TimetableSlot has already been purged and cannot be unarchived.');
    }
    const updated = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      await tx.timetableSlot.updateMany({
        where: { id: slotId, archivedAt: { not: null }, purgedAt: null },
        data: { archivedAt: null, purgeAt: null },
      });
      return tx.timetableSlot.findUniqueOrThrow({ where: { id: slotId } });
    });
    // Re-checked against the fresh row rather than only on the TOCTOU-race
    // branch (Branch/Instructor/Rank/Lesson/Class's own pattern) — covers the
    // same race either way, since a lost updateMany (another caller purged it
    // first) and a won one both land here with the row's real current state.
    if (updated.purgedAt) {
      throw new ConflictException('This TimetableSlot has already been purged and cannot be unarchived.');
    }
    return this.toResponse(updated);
  }

  // No hard-delete endpoint — stale comment fixed: TimetableSlot DOES have a
  // real, reversible archive()/unarchive() pair above (Decision 226/252), not
  // "no mechanism" the way this comment used to claim.

  // Whether two TimetableSlots may overlap for the same Instructor (or the same
  // Branch/room) in time is not addressed anywhere in Spec 55 — no confirmed rule
  // requires detecting or blocking it, so no conflict-detection is built here. A
  // deliberate gap, not a missed one.

  // Delegates to the module-level, exported shapeTimetableSlotResponse (see the file
  // header comment) — kept as a thin instance method so every existing call site
  // above (this.toResponse(...)) needs no change.
  private toResponse<T extends { startTime: Date; endTime: Date; breakStart: Date | null; breakEnd: Date | null }>(
    slot: T,
  ) {
    return shapeTimetableSlotResponse(slot);
  }
}
