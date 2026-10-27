import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { Prisma, TimetableSlot } from '@prisma/client';
import { BookingsService } from '../bookings/bookings.service';
import { NOTIFICATION_FANOUT_QUEUE, WAITLIST_CASCADE_PROCESSING_QUEUE } from '../jobs/queue.constants';
import { NotificationFanoutJobData } from '../jobs/notification-fanout.types';
import { buildSlotOccurrences, occurrenceFields, weekdayNumber } from './slot-occurrences';
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

type OccurrenceField = keyof ReturnType<typeof occurrenceFields>;

/** Slot fields that change a booking's rules or money (Decision 332, T6). Booked
 * upcoming Classes take them only when the owner chooses MOVE ("apply to booked
 * classes too"); unbooked ones always do. */
const BOOKING_RULE_FIELDS = [
  'termsWaiverRequired',
  'membershipInclusion',
  'bookingCutoffMinutesBeforeStart',
  'qrAttendanceWindowMinutes',
  'refundCutoffHoursBeforeStart',
  'cancellationCharge',
] as const;

/** Class fields that reach every upcoming Class whatever the owner chose for booked
 * ones, since they change nobody's booking or money (Decision 332, T6). Capacity has
 * its own rule: it reaches each Class whose booked seats fit (T5). */
const ALWAYS_FOLLOW: ReadonlySet<OccurrenceField> = new Set<OccurrenceField>(['title', 'description', 'bannerUrl', 'instructorId', 'activities', 'styles']);

/** Checks a slot's times once the edit is applied (Decision 332, T8): the class ends
 * after it starts, and a break has both ends, in order, inside the class. HH:mm
 * strings compare correctly as text. */
function assertValidTimes(start: string, end: string, breakStart: string | null, breakEnd: string | null): void {
  if (end <= start) {
    throw new BadRequestException('The end time must be after the start time.');
  }
  if ((breakStart === null) !== (breakEnd === null)) {
    throw new BadRequestException('Give the break both a start and an end time, or neither.');
  }
  if (breakStart !== null && breakEnd !== null) {
    if (breakEnd <= breakStart) {
      throw new BadRequestException('The break must end after it starts.');
    }
    if (breakStart < start || breakEnd > end) {
      throw new BadRequestException('The break must fall inside the class times.');
    }
  }
}

/** The Class fields a slot edit touches, from the edit's own keys (Decision 322).
 * A new day or time re-times the Class and its cut-offs. */
function classFieldsFor(changedKeys: string[]): Set<OccurrenceField> {
  const map: Record<string, OccurrenceField[]> = {
    weekday: ['occurrenceDate', 'startDate', 'endDate', 'bookingEndAt', 'qrAttendanceEndAt', 'refundFeeDate'],
    startTime: ['startDate', 'endDate', 'bookingEndAt', 'qrAttendanceEndAt', 'refundFeeDate'],
    endTime: ['startDate', 'endDate', 'bookingEndAt', 'qrAttendanceEndAt', 'refundFeeDate'],
    bookingCutoffMinutesBeforeStart: ['bookingEndAt'],
    qrAttendanceWindowMinutes: ['qrAttendanceEndAt'],
    refundCutoffHoursBeforeStart: ['refundFeeDate'],
    branchId: ['branchId'],
    instructorId: ['instructorId'],
    title: ['title'],
    activities: ['activities', 'styles'],
    styles: ['activities', 'styles'],
    description: ['description'],
    bannerUrl: ['bannerUrl'],
    capacity: ['capacity'],
    cancellationCharge: ['cancellationCharge'],
    termsWaiverRequired: ['termsWaiverRequired'],
    membershipInclusion: ['membershipInclusion'],
  };
  return new Set(changedKeys.flatMap((k) => map[k] ?? []));
}

@Injectable()
export class TimetableService {
  private readonly logger = new Logger(TimetableService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    private readonly bookingsService: BookingsService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly notificationFanoutQueue: Queue,
    @InjectQueue(WAITLIST_CASCADE_PROCESSING_QUEUE) private readonly waitlistCascadeQueue: Queue,
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

    assertValidTimes(dto.startTime, dto.endTime, dto.breakStart ?? null, dto.breakEnd ?? null);
    if (dto.branchId) {
      await this.tenantAuth.assertBranchBelongsToSchool(callerId, dto.branchId, schoolId);
      await this.assertBranchNotArchived(callerId, dto.branchId);
    }
    if (dto.instructorId) {
      await this.tenantAuth.assertInstructorAssignable(callerId, dto.instructorId, schoolId, dto.branchId ?? null);
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
    // A new slot is bookable straight away: its next 4 weeks are made now, not at
    // the nightly run (Decision 332, T3).
    await this.syncUpcomingClasses(callerId, created, created, 'KEEP', []);
    return this.toResponse(created);
  }

  /** A slot can't be put on an archived Branch (Decision 332, T17): the nightly job
   * would keep adding Classes to a Branch that's closed. */
  private async assertBranchNotArchived(callerId: string, branchId: string): Promise<void> {
    const branch = await this.prismaApp.withTenantContext(callerId, (tx) => tx.branch.findUnique({ where: { id: branchId }, select: { archivedAt: true } }));
    if (branch?.archivedAt) {
      throw new BadRequestException('This branch has been archived. Choose another branch.');
    }
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
    // An archived slot is changed only after unarchiving it (Decision 332, T1).
    if (existing.archivedAt) {
      throw new ConflictException('This slot is archived. Unarchive it first to change it.');
    }

    const nextBranchId = dto.branchId !== undefined ? dto.branchId : existing.branchId;
    const nextInstructorId = dto.instructorId !== undefined ? dto.instructorId : existing.instructorId;

    // The times as they will be after this edit (Decision 332, T8, T9): null clears
    // a break, undefined keeps it.
    const keepOrSet = (sent: string | null | undefined, current: Date | null) => (sent !== undefined ? sent : current ? formatHHmm(current) : null);
    assertValidTimes(
      dto.startTime ?? formatHHmm(existing.startTime),
      dto.endTime ?? formatHHmm(existing.endTime),
      keepOrSet(dto.breakStart, existing.breakStart),
      keepOrSet(dto.breakEnd, existing.breakEnd),
    );

    if (dto.branchId) {
      await this.tenantAuth.assertBranchBelongsToSchool(callerId, dto.branchId, existing.schoolId);
      if (dto.branchId !== existing.branchId) {
        await this.assertBranchNotArchived(callerId, dto.branchId);
      }
    }
    // Same "revalidate whenever the row still has an instructor after this patch, not
    // only when instructorId is itself in the body" fix Phase 4's code review caught
    // for ClassesService.update() — applied here from the start rather than being
    // rediscovered a second time.
    // Decision 311 (I5): only when the instructor or the branch actually changes.
    if (nextInstructorId && nextInstructorId !== existing.instructorId) {
      await this.tenantAuth.assertInstructorAssignable(callerId, nextInstructorId, existing.schoolId, nextBranchId);
    } else if (nextInstructorId && nextBranchId !== existing.branchId) {
      await this.tenantAuth.assertValidInstructor(callerId, nextInstructorId, existing.schoolId, nextBranchId);
    }

    if ((dto as { styles?: unknown }).styles === null) {
      throw new BadRequestException('styles cannot be null; omit it to leave the styles unchanged.');
    }

    // Decision 322: a change that moves this slot's Classes (day, times, branch) or
    // switches it off needs the owner's choice for upcoming Classes that already
    // have bookings. So does a change to their booking rules (Decision 332, T6):
    // MOVE applies it to booked Classes too, KEEP leaves them. Asked before
    // anything is written.
    const moves = this.movesClasses(existing, dto);
    const changesRules = this.changesBookingRules(existing, dto);
    const impact = await this.upcomingImpact(callerId, slotId);
    if ((moves || changesRules) && impact.bookedClasses > 0 && !dto.bookedClasses) {
      throw new ConflictException({
        code: 'BOOKED_CLASSES_CHOICE_REQUIRED',
        message: `${impact.bookedClasses} upcoming ${impact.bookedClasses === 1 ? 'class' : 'classes'} from this slot ${impact.bookedClasses === 1 ? 'has' : 'have'} ${impact.bookedStudents} booked ${impact.bookedStudents === 1 ? 'student' : 'students'}. ` +
          (moves ? 'Choose what happens to them: bookedClasses MOVE, CANCEL or KEEP.' : 'Choose whether the new rules apply to them: bookedClasses MOVE (apply) or KEEP.'),
      });
    }
    const switchingOff = dto.status === 'OFF' && existing.status === 'ON';
    if (switchingOff && dto.bookedClasses === 'MOVE') {
      throw new BadRequestException('A slot that is switched off has nowhere to move its classes to. Use CANCEL or KEEP.');
    }
    if (!moves && dto.bookedClasses === 'CANCEL') {
      throw new BadRequestException('CANCEL is only for a change that moves classes or switches the slot off. Use MOVE or KEEP.');
    }
    // Decision 332, T5 (Decision 322 §6): capacity is never cut below the seats
    // already booked. Without a choice the cut is refused with the count; with one,
    // Classes fuller than the new capacity keep their current size and the rest
    // take it.
    if (dto.capacity !== undefined && dto.capacity !== null && impact.mostTaken > dto.capacity && !dto.bookedClasses) {
      throw new ConflictException({
        code: 'CAPACITY_BELOW_BOOKED',
        message: `An upcoming class from this slot has ${impact.mostTaken} students booked. Set the capacity to ${impact.mostTaken} or more, ` +
          'or confirm with bookedClasses KEEP: classes fuller than the new capacity keep their current size.',
      });
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
          // null removes the break (Decision 332, T9).
          breakStart: dto.breakStart === null ? null : dto.breakStart ? parseHHmm(dto.breakStart) : undefined,
          breakEnd: dto.breakEnd === null ? null : dto.breakEnd ? parseHHmm(dto.breakEnd) : undefined,
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
    // Upcoming Classes follow the change: unbooked ones always, booked ones as the
    // owner chose (Decision 322).
    await this.syncUpcomingClasses(callerId, existing, updated, dto.bookedClasses ?? (moves || changesRules ? 'KEEP' : 'MOVE'), Object.keys(dto));
    return this.toResponse(updated);
  }

  /** Whether an edit changes a booking rule the slot's Classes carry (T6). */
  private changesBookingRules(existing: TimetableSlot, dto: UpdateTimetableSlotDto): boolean {
    return BOOKING_RULE_FIELDS.some((key) => dto[key] !== undefined && dto[key] !== existing[key]);
  }

  /** GET /timetable/:id/upcoming-impact (Decision 322): how many upcoming Classes
   * from this slot there are, and how many have bookings, so the owner can choose
   * MOVE, CANCEL or KEEP before saving a change that moves them. */
  async getUpcomingImpact(callerId: string, slotId: string) {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.timetableSlot.findUnique({ where: { id: slotId } }));
    if (!existing) {
      throw new NotFoundException('TimetableSlot not found');
    }
    await this.tenantAuth.assertSchoolOwner(callerId, existing.schoolId);
    return this.upcomingImpact(callerId, slotId);
  }

  /** Whether a slot change moves its Classes in time or place, or switches it off. */
  private movesClasses(existing: TimetableSlot, dto: UpdateTimetableSlotDto): boolean {
    const t = (v: Date | null) => (v ? v.toISOString().slice(11, 16) : null);
    return (
      (dto.weekday !== undefined && dto.weekday !== existing.weekday) ||
      (dto.startTime !== undefined && dto.startTime !== t(existing.startTime)) ||
      (dto.endTime !== undefined && dto.endTime !== t(existing.endTime)) ||
      (dto.branchId !== undefined && dto.branchId !== existing.branchId) ||
      (dto.status === 'OFF' && existing.status === 'ON')
    );
  }

  private async upcomingImpact(callerId: string, slotId: string) {
    const classes = await this.upcomingClassesOf(callerId, slotId);
    const booked = classes.filter((c) => c.taken > 0 || c.queued > 0);
    return {
      upcomingClasses: classes.length,
      bookedClasses: booked.length,
      bookedStudents: booked.reduce((n, c) => n + c.taken, 0),
      mostTaken: classes.reduce((m, c) => Math.max(m, c.taken), 0),
    };
  }

  private async upcomingClassesOf(callerId: string, slotId: string) {
    const rows = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.class.findMany({
        where: { timetableSlotId: slotId, archivedAt: null, startDate: { gt: new Date() } },
        include: {
          bookings: { where: { status: 'UPCOMING' }, select: { id: true, studentId: true, _count: { select: { attendees: true } } } },
          waitlistEntries: { where: { status: { in: ['WAITING', 'NOTIFIED'] } }, select: { studentId: true } },
        },
      }),
    );
    return rows.map((c) => ({
      cls: c,
      bookings: c.bookings,
      taken: c.bookings.reduce((n, b) => n + 1 + b._count.attendees, 0),
      queued: c.waitlistEntries.length,
      waitingStudentIds: c.waitlistEntries.map((e) => e.studentId),
    }));
  }

  /**
   * Decision 322: brings this slot's upcoming Classes in line with the slot after
   * an edit, a create or an archive. Before this, the 4 weeks already generated
   * never changed: a slot switched off stayed bookable, and a new day left the old
   * Classes and added new ones (stress test, 26 Oct 2026).
   *
   * - Unbooked upcoming Classes always follow: re-timed in place (same week, new
   *   day), or removed when the slot is off or archived, or when the new time has
   *   already passed.
   * - Booked ones follow `bookedChoice` for their day, time, place and booking
   *   rules: MOVE applies the change and tells the booked and waiting Students
   *   when the time moved; CANCEL cancels their bookings with credit back, archives
   *   them and tells the Students; KEEP leaves those as they are.
   * - Title, description, picture, coach and styles reach every Class, and a new
   *   capacity reaches each Class whose booked seats fit in it (Decision 332, T5,
   *   T6). Seats a raise frees go to the waitlist first (T4).
   * - Then the generator fills any week still missing.
   */
  private async syncUpcomingClasses(
    callerId: string,
    before: TimetableSlot,
    slot: TimetableSlot,
    bookedChoice: 'MOVE' | 'CANCEL' | 'KEEP',
    changedKeys: string[],
  ): Promise<void> {
    // Only what the edit changed is carried over, so a change made to one Class
    // on its own (its capacity, its instructor) survives an unrelated slot edit.
    const changedFields = classFieldsFor(changedKeys);
    const zone = await this.zoneOf(callerId, slot);
    const live = slot.status === 'ON' && !slot.archivedAt;
    const dayShift = weekdayNumber(slot.weekday) - weekdayNumber(before.weekday);
    const now = new Date();

    for (const { cls, bookings, queued, taken, waitingStudentIds } of await this.upcomingClassesOf(callerId, slot.id)) {
      const booked = bookings.length > 0 || queued > 0;
      if (booked && bookedChoice === 'CANCEL') {
        await this.cancelClass(callerId, cls, bookings, zone);
        continue;
      }
      // Whether this Class takes the slot's new day, time, place and rules.
      const follows = !booked || bookedChoice === 'MOVE';
      const occurrence = cls.occurrenceDate ?? cls.startDate;
      const localDate = DateTime.fromObject(
        { year: occurrence.getUTCFullYear(), month: occurrence.getUTCMonth() + 1, day: occurrence.getUTCDate() },
        { zone },
      ).plus({ days: follows ? dayShift : 0 });
      const fields = occurrenceFields(slot, localDate);
      if (follows && (!live || fields.startDate <= now)) {
        if (booked) await this.cancelClass(callerId, cls, bookings, zone);
        else await this.removeClass(callerId, cls.id);
        continue;
      }
      const data: Record<string, unknown> = {};
      for (const key of changedFields) {
        if (key === 'capacity') {
          // A Class fuller than the new capacity keeps its current size (T5).
          if (slot.capacity === null || taken <= slot.capacity) data.capacity = slot.capacity;
        } else if (follows || ALWAYS_FOLLOW.has(key)) {
          data[key] = fields[key];
        }
      }
      if (Object.keys(data).length === 0) continue;
      try {
        await this.prismaApp.withTenantContext(callerId, (tx) => tx.class.update({ where: { id: cls.id }, data: data as Prisma.ClassUpdateInput }));
      } catch (err) {
        // Another Class of this slot (an archived one) already holds that date.
        if ((err as { code?: string }).code !== 'P2002') throw err;
        if (booked) await this.cancelClass(callerId, cls, bookings, zone);
        else await this.removeClass(callerId, cls.id);
        continue;
      }
      if ('capacity' in data && queued > 0 && (slot.capacity === null || (cls.capacity !== null && slot.capacity > cls.capacity))) {
        await this.offerRaisedSeats(callerId, cls.id);
      }
      if (booked && 'startDate' in data && cls.startDate.getTime() !== fields.startDate.getTime()) {
        // Waiting Students are told too (Decision 332, T18).
        await this.tell([...bookings.map((b) => b.studentId), ...waitingStudentIds], `class-moved-${cls.id}-${fields.startDate.getTime()}`, 'Class moved',
          `${slot.title} has moved to ${DateTime.fromJSDate(fields.startDate).setZone(zone).toFormat("cccc d LLL 'at' HH:mm")}. ${bookings.length > 0 ? 'Bookings moved with it.' : 'Your waitlist place moved with it.'}`, 'CLASS_MOVED',
          { schoolId: slot.schoolId, classId: cls.id });
      }
    }

    if (live) {
      await this.prismaApp.withTenantContext(callerId, (tx) => tx.class.createMany({ data: buildSlotOccurrences(slot, zone), skipDuplicates: true }));
    }
  }

  /** The slot's time zone: its Branch's, else its School's, else UTC (Decision 172). */
  private async zoneOf(callerId: string, slot: TimetableSlot): Promise<string> {
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const branch = slot.branchId ? await tx.branch.findUnique({ where: { id: slot.branchId }, select: { timezone: true } }) : null;
      const school = await tx.school.findUnique({ where: { id: slot.schoolId }, select: { timezone: true } });
      return branch?.timezone ?? school?.timezone ?? 'UTC';
    });
  }

  /** Seats a slot's capacity raise frees on one Class go to its waitlist first,
   * the same count ClassesService.update() offers (Decision 332, T4): with Students
   * queued, nobody can book them directly (waitlist first, Decision 322 §3). */
  private async offerRaisedSeats(callerId: string, classId: string): Promise<void> {
    const seats = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const cls = await tx.class.findUniqueOrThrow({ where: { id: classId }, select: { capacity: true } });
      const [bookings, guests, waiting, notified] = await Promise.all([
        tx.booking.count({ where: { classId, status: 'UPCOMING' } }),
        tx.bookingAttendee.count({ where: { booking: { classId, status: 'UPCOMING' } } }),
        tx.waitlistEntry.count({ where: { classId, status: 'WAITING' } }),
        tx.waitlistEntry.count({ where: { classId, status: 'NOTIFIED' } }),
      ]);
      return cls.capacity === null ? waiting : Math.max(0, Math.min(waiting, cls.capacity - bookings - guests - notified));
    });
    for (let i = 0; i < seats; i++) {
      try {
        await this.waitlistCascadeQueue.add('seat-freed', { classId });
      } catch (err) {
        this.logger.warn(`Failed to enqueue waitlist-cascade-processing after raising Class ${classId}'s capacity from its slot: ${err}`);
      }
    }
  }

  /** The School cancels one Class: every booking cancelled with credit back, the
   * waitlist closed, the Class archived and unlinked from its slot, and the
   * Students told. Unlinking frees the date, so switching the slot back on makes
   * that date again (Decision 332, T15); the cancelled Class and its booking
   * history stay. */
  private async cancelClass(callerId: string, cls: { id: string; title: string; startDate: Date; schoolId: string }, bookings: Array<{ id: string; studentId: string }>, zone: string): Promise<void> {
    // The waitlist closes first, so the seats the cancellations free aren't
    // offered to anyone.
    const waiting = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const entries = await tx.waitlistEntry.findMany({ where: { classId: cls.id, status: { in: ['WAITING', 'NOTIFIED'] } }, select: { studentId: true } });
      await tx.waitlistEntry.updateMany({ where: { classId: cls.id, status: { in: ['WAITING', 'NOTIFIED'] } }, data: { status: 'CANCELLED' } });
      return entries.map((e) => e.studentId);
    });
    for (const b of bookings) {
      await this.bookingsService.cancelBooking(callerId, b.id, undefined, { schoolCancelled: true });
    }
    await this.prismaApp.withTenantContext(callerId, (tx) => {
      const at = new Date();
      return tx.class.update({ where: { id: cls.id }, data: { archivedAt: at, purgeAt: new Date(at.getTime() + RETENTION_WINDOW_DAYS * 86_400_000), timetableSlotId: null } });
    });
    // The date in the slot's own zone, not UTC (Decision 332, T16).
    await this.tell([...bookings.map((b) => b.studentId), ...waiting], `class-cancelled-${cls.id}`, 'Class cancelled',
      `${cls.title} on ${DateTime.fromJSDate(cls.startDate).setZone(zone).toFormat("cccc d LLL 'at' HH:mm")} was cancelled by your School. Any class credit you used has been given back.`, 'CLASS_CANCELLED',
      { schoolId: cls.schoolId, classId: cls.id });
  }

  /** An unbooked Class leaves the schedule: deleted when nothing points at it,
   * archived and unlinked from its slot otherwise (old cancelled bookings, training
   * logs), so the date is free for the slot again (T15). */
  private async removeClass(callerId: string, classId: string): Promise<void> {
    await this.prismaApp.withTenantContext(callerId, async (tx) => {
      const deleted = await tx.class.deleteMany({ where: { id: classId, bookings: { none: {} }, waitlistEntries: { none: {} }, trainingLogs: { none: {} } } });
      if (deleted.count === 0) {
        const at = new Date();
        await tx.class.updateMany({ where: { id: classId, archivedAt: null }, data: { archivedAt: at, purgeAt: new Date(at.getTime() + RETENTION_WINDOW_DAYS * 86_400_000), timetableSlotId: null } });
      }
    });
  }

  private async tell(userIds: string[], key: string, title: string, body: string, type: string, about: { schoolId: string; classId: string }): Promise<void> {
    for (const userId of new Set(userIds)) {
      try {
        const data: NotificationFanoutJobData = { notificationId: `${key}-${userId}`, userId, title, body, type, schoolId: about.schoolId, targetType: 'CLASS', targetId: about.classId };
        await this.notificationFanoutQueue.add('notify', data, {
          jobId: `${key}-${userId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        });
      } catch (err) {
        this.logger.warn(`Failed to enqueue the "${title}" notification for ${userId}: ${err}`);
      }
    }
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
    // Its unbooked upcoming Classes leave the schedule too (Decision 322); booked
    // ones can't exist here, archive refuses those above.
    await this.syncUpcomingClasses(callerId, existing, updated, 'KEEP', []);
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
    // Bookable again straight away, not from the next nightly run (Decision 332, T3).
    await this.syncUpcomingClasses(callerId, updated, updated, 'KEEP', []);
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
