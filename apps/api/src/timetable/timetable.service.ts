import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { CreateTimetableSlotDto } from './dto/create-timetable-slot.dto';
import { UpdateTimetableSlotDto } from './dto/update-timetable-slot.dto';

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
    const created = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.timetableSlot.create({
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
          activities: dto.activities,
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
      }),
    );
    return this.toResponse(created);
  }

  /** Slots visible to the caller under one School — RLS restricts this to a School-
   * level grant (sees every slot, any Branch) or a Branch-scoped grant (their own
   * Branch's slots plus School-wide ones — timetable_slot_tenant_isolation, this
   * phase's migration; same three-way structure as class_tenant_isolation). */
  async findAllForSchool(
    callerId: string,
    schoolId: string,
    cursor?: string,
    limit?: number,
  ): Promise<CursorPage<ReturnType<TimetableService['toResponse']>>> {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    const page = await this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.timetableSlot.findMany({ ...args, where: { schoolId } }), cursor, limit),
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

    const updated = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.timetableSlot.update({
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
          activities: dto.activities,
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
      }),
    );
    // Deliberately NOT touching Classes already materialized from this slot — Spec 55
    // doesn't say what should happen to them on an edit (status flip, instructor
    // change, time change), and retroactively cancelling/mutating rows a Student may
    // already hold real Bookings against is the wrong default to guess at. Flagged,
    // not resolved — see the Phase 5 kickoff prompt.
    return this.toResponse(updated);
  }

  // No delete method — general tenant offboarding is [UNRESOLVED]
  // (ultm8-app-publishing §4 — not ultm8-domain-rules §2, which covers Franchise/
  // School/Branch structure, not offboarding), same reasoning as School/Branch/Class.

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
