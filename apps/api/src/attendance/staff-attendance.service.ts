import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { MembershipPlanType } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SubscriptionGateService } from '../subscription-plans/subscription-gate.service';
import { BookingsService } from '../bookings/bookings.service';
import { randomUUID } from 'crypto';
import { assertNotAlreadyAttended, BOOKING_TX_OPTIONS, lockClassShared, lockStudentClass, withSeatLockRetry } from '../bookings/booking-gates';
import { safeZone } from '../bookings/booking-week';
import { lockSchoolOpen } from '../tenants/lock-school-open';
import { localDay } from '../ranks/engine';
import { AttendanceService } from './attendance.service';
import {
  AttendanceStatsResponseDto,
  CheckInsTodayResponseDto,
  LogClassesResponseDto,
  LoggedAttendanceResponseDto,
} from './dto/staff-attendance.dto';

/** Decision 317 item 4: attendance can be logged up to 30 days back. */
export const LOG_ATTENDANCE_MAX_DAYS_BACK = 30;
/** Decision 317 item 3 / backlog 5.6: statistics cover the last 30 days. */
export const ATTENDANCE_STATS_DAYS = 30;

/** Decision 317 item 3: these check-ins count, with a filter to leave them out. */
const PASS_PLAN_TYPES: MembershipPlanType[] = ['TRIAL_MEMBERSHIP', 'VISIT_PASS', 'FRIEND_PASS'];

function roundOne(n: number): number {
  return Math.round(n * 10) / 10;
}

/** `day` moved by `days` (YYYY-MM-DD; calendar arithmetic, no time zone involved). */
function addDays(day: string, days: number): string {
  return DateTime.fromISO(day, { zone: 'UTC' }).plus({ days }).toISODate() as string;
}

/** The instant a local day starts in `zone`. */
function dayStart(day: string, zone: string): Date {
  const dt = DateTime.fromISO(day, { zone }).startOf('day');
  if (!dt.isValid) throw new BadRequestException({ code: 'INVALID_DATE', message: 'This date is not valid.' });
  return dt.toJSDate();
}

/**
 * Students → Attendance (Decision 317 items 3 and 4; backlog 5.6, 5.7).
 *
 * - **Statistics** (item 3): the owner sees the whole School, Branch Staff
 *   with "See attendance statistics" their own Branches. Trial, Visitor and
 *   Friend Pass check-ins count, with a filter to leave them out.
 * - **Logging past attendance** (item 4): staff log a class a student came to,
 *   up to 30 days back. It counts like a normal check-in: the booking is made
 *   and paid for exactly as a staff booking (bookInTx, so a Class Pack credit
 *   is used), then checked in through the same completeInTx every other way
 *   in ends with (grading count, hours trained, the School's check-in rules
 *   about the person, Decision 394 item 1). Recorded as STAFF_LOGGED with the
 *   staff member as checkedInById, so it is told apart and says who logged it.
 *   A student already checked in to that class is refused (ALREADY_ATTENDED).
 *
 * Days are in the School's time zone (UTC when it has none).
 */
@Injectable()
export class StaffAttendanceService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly subscriptionGate: SubscriptionGateService,
    private readonly bookings: BookingsService,
    private readonly attendance: AttendanceService,
  ) {}

  private async schoolZone(schoolId: string): Promise<string> {
    // Read via ultm8_jobs, after the caller's access check: a School setting.
    const school = await this.prismaJobs.school.findUnique({ where: { id: schoolId }, select: { timezone: true } });
    if (!school) throw new NotFoundException('School not found');
    return safeZone(school.timezone);
  }

  /** Which Branches the caller's statistics cover (null: the whole School):
   * the owner every Branch, Branch Staff with "See attendance statistics"
   * their own; `branchId` narrows it to one of those. */
  private async statsBranches(callerId: string, schoolId: string, branchId: string | undefined): Promise<string[] | null> {
    const scope = await this.tenantAuth.attendanceStatsScope(callerId, schoolId);
    if (!branchId) return scope.branchIds;
    if (scope.branchIds && !scope.branchIds.includes(branchId)) {
      throw new ForbiddenException({ code: 'OTHER_BRANCH', message: "You can only see your own Branches' attendance." });
    }
    await this.tenantAuth.assertBranchBelongsToSchool(callerId, branchId, schoolId);
    return [branchId];
  }

  /** GET /schools/{schoolId}/attendance/stats */
  async stats(callerId: string, schoolId: string, query: { branchId?: string; excludePasses?: boolean }): Promise<AttendanceStatsResponseDto> {
    const branchIds = await this.statsBranches(callerId, schoolId, query.branchId);
    const excludePasses = !!query.excludePasses;

    const zone = await this.schoolZone(schoolId);
    const now = new Date();
    const to = localDay(now, zone);
    const from = addDays(to, -(ATTENDANCE_STATS_DAYS - 1));
    // Classes that started from the first day up to now: a class counts once it has started.
    const { memberCheckIns, guestCheckIns } = await this.checkInsOf(schoolId, branchIds, { gte: dayStart(from, zone), lte: now }, excludePasses);

    const checkIns = memberCheckIns.length + guestCheckIns.length;
    const classes = new Set([...memberCheckIns.map((b) => b.classId), ...guestCheckIns.map((g) => g.booking.classId)]).size;
    const students = new Set(memberCheckIns.map((b) => b.studentId)).size;
    return {
      from,
      to,
      timeZone: zone,
      branchIds,
      excludePasses,
      checkIns,
      guestCheckIns: guestCheckIns.length,
      loggedCheckIns: memberCheckIns.filter((b) => b.checkInMethod === 'STAFF_LOGGED').length,
      classes,
      students,
      studentsPerClass: classes ? roundOne(checkIns / classes) : 0,
      classesPerStudent: students ? roundOne(memberCheckIns.length / students) : 0,
    };
  }

  /**
   * The check-ins of the classes that start in `classStart`, as the statistics
   * count them (Decision 317 item 3): members' bookings checked in (or logged
   * afterwards), and guests checked in on a Friend Pass (Decision 377). Trial,
   * Visitor and Friend Pass check-ins count unless `excludePasses`.
   *
   * Read via ultm8_jobs, only after the caller's access check, with the School
   * and Branches named explicitly (Membership rows are never readable by
   * Branch Staff in their own context).
   */
  private async checkInsOf(schoolId: string, branchIds: string[] | null, classStart: { gte: Date; lte?: Date; lt?: Date }, excludePasses: boolean) {
    const classWindow = { startDate: classStart };
    const branchWhere = branchIds ? { branchId: { in: branchIds } } : {};
    // Imported past attendance has no Membership (Decision 422 item 6) and is no pass.
    const passWhere = excludePasses ? { OR: [{ sourceMembershipId: null }, { sourceMembership: { membershipPlan: { type: { notIn: PASS_PLAN_TYPES } } } }] } : {};
    const memberCheckIns = await this.prismaJobs.booking.findMany({
      where: { schoolId, status: 'COMPLETED', ...branchWhere, class: classWindow, ...passWhere },
      select: { studentId: true, classId: true, checkInMethod: true },
    });
    // Guests are checked in on a Friend Pass (Decision 377): left out with the filter.
    const guestCheckIns = excludePasses
      ? []
      : await this.prismaJobs.bookingAttendee.findMany({
          where: { schoolId, checkedInAt: { not: null }, booking: { status: 'COMPLETED', ...branchWhere, class: classWindow } },
          select: { booking: { select: { classId: true } } },
        });
    return { memberCheckIns, guestCheckIns };
  }

  /**
   * GET /schools/{schoolId}/attendance/today: the Dashboard's "Check-ins
   * today" (Decision 454 item 8). The statistics' own count and scope
   * (Decision 317 item 3), for the classes that start today in the School's
   * time zone (UTC when it has none): the owner sees the whole School, Branch
   * Staff with "See attendance statistics" their own Branches. A `branchId`
   * narrows it to the classes held at that Branch, as the Dashboard's Branch
   * filter does for Bookings (Decision 367 item 5).
   */
  async today(callerId: string, schoolId: string, query: { branchId?: string }): Promise<CheckInsTodayResponseDto> {
    const branchIds = await this.statsBranches(callerId, schoolId, query.branchId);
    const zone = await this.schoolZone(schoolId);
    const date = localDay(new Date(), zone);
    const { memberCheckIns, guestCheckIns } = await this.checkInsOf(schoolId, branchIds, { gte: dayStart(date, zone), lt: dayStart(addDays(date, 1), zone) }, false);
    return {
      date,
      timeZone: zone,
      branchIds,
      checkIns: memberCheckIns.length + guestCheckIns.length,
      classes: new Set([...memberCheckIns.map((b) => b.classId), ...guestCheckIns.map((g) => g.booking.classId)]).size,
    };
  }

  /** The earliest day and today for logging, in the School's time zone. */
  private logWindow(zone: string, now: Date) {
    const today = localDay(now, zone);
    const earliestDay = addDays(today, -LOG_ATTENDANCE_MAX_DAYS_BACK);
    return { today, earliestDay, earliest: dayStart(earliestDay, zone) };
  }

  /** GET /schools/{schoolId}/attendance/log-classes: the classes on one day
   * that attendance can be logged for, at the caller's Branches. */
  async logClasses(callerId: string, schoolId: string, requested: string | undefined, studentId?: string): Promise<LogClassesResponseDto> {
    await this.tenantAuth.assertStaffAtSchoolOrNotFound(callerId, schoolId);
    await this.tenantAuth.assertStaffMay(callerId, schoolId, 'bookings');
    const zone = await this.schoolZone(schoolId);
    const now = new Date();
    const { today, earliestDay } = this.logWindow(zone, now);
    const date = requested ?? today;
    if (date < earliestDay || date > today) {
      throw new BadRequestException({ code: 'LOG_OUT_OF_RANGE', message: `Attendance can only be logged from ${earliestDay} to ${today}.` });
    }
    const gte = dayStart(date, zone);
    const lt = dayStart(addDays(date, 1), zone);
    // In the caller's own context: only Classes they can see.
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.class.findMany({
        where: { schoolId, cancelledAt: null, archivedAt: null, startDate: { gte, lt, lte: now } },
        orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
        select: { id: true, title: true, startDate: true, endDate: true, branchId: true },
      }),
    );
    // Only Classes at Branches where the caller may check people in.
    const allowed = new Map<string | null, boolean>();
    for (const branchId of new Set(found.map((c) => c.branchId))) {
      allowed.set(branchId, await this.tenantAuth.staffMay(callerId, schoolId, 'bookings', branchId));
    }
    const classes = found.filter((c) => allowed.get(c.branchId));
    let attended = new Set<string>();
    if (studentId && classes.length) {
      const done = await this.prismaApp.withTenantContext(studentId, (tx) =>
        tx.booking.findMany({ where: { studentId, schoolId, status: 'COMPLETED', classId: { in: classes.map((c) => c.id) } }, select: { classId: true } }),
      );
      attended = new Set(done.map((b) => b.classId));
    }
    return {
      earliestDay,
      today,
      date,
      timeZone: zone,
      items: classes.map((c) => ({
        id: c.id,
        title: c.title,
        startDate: c.startDate.toISOString(),
        endDate: c.endDate.toISOString(),
        branchId: c.branchId,
        attended: attended.has(c.id),
      })),
    };
  }

  /** POST /schools/{schoolId}/attendance/logs */
  async log(callerId: string, schoolId: string, dto: { studentId: string; classId: string }): Promise<LoggedAttendanceResponseDto> {
    const { studentId, classId } = dto;
    await this.tenantAuth.assertStaffAtSchoolOrNotFound(callerId, schoolId);
    const cls = await this.prismaApp.withTenantContext(callerId, (tx) => tx.class.findFirst({ where: { id: classId, schoolId } }));
    if (!cls) {
      throw new NotFoundException('Class not found');
    }
    // The same right as checking someone in at that class's Branch.
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId, cls.branchId);
    await this.tenantAuth.assertStaffMay(callerId, schoolId, 'bookings', cls.branchId);
    // Read via ultm8_jobs: Branch Staff and coaches can't see every RoleGrant.
    const enrolled = await this.prismaJobs.roleGrant.findFirst({ where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } });
    if (!enrolled) {
      throw new NotFoundException({ code: 'NOT_A_STUDENT_HERE', message: "This person isn't a Student at this School." });
    }
    if (cls.cancelledAt) {
      throw new ConflictException('This class has been cancelled by the school.');
    }
    if (cls.archivedAt) {
      throw new BadRequestException('This Class is archived and can no longer be booked.');
    }
    const zone = await this.schoolZone(schoolId);
    const now = new Date();
    const { earliest, earliestDay, today } = this.logWindow(zone, now);
    if (cls.startDate > now) {
      throw new BadRequestException({ code: 'LOG_NOT_STARTED', message: "This class hasn't started yet. Check them in instead." });
    }
    if (cls.startDate < earliest) {
      throw new BadRequestException({ code: 'LOG_OUT_OF_RANGE', message: `Attendance can only be logged from ${earliestDay} to ${today}.` });
    }

    // The gates a staff booking passes before its transaction (bookClass).
    await this.subscriptionGate.assertNotDegraded(studentId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(studentId, schoolId);

    const result = await withSeatLockRetry(() =>
      this.prismaApp.withTenantContext(
        studentId,
        async (tx) => {
          // First, before any row lock (see lockStudentClass): this also holds
          // every other booking or check-in of this student into this class.
          await lockStudentClass(tx, studentId, classId);
          await lockSchoolOpen(tx, schoolId);
          // Never twice: a student already checked in (or logged) is refused.
          await assertNotAlreadyAttended(tx, studentId, classId);
          let from: LoggedAttendanceResponseDto['from'];
          let booking = await tx.booking.findFirst({ where: { studentId, classId, status: 'UPCOMING' }, select: { id: true, classId: true } });
          if (booking) {
            from = 'UPCOMING';
          } else {
            // Booked and marked No-Show: that booking was paid for when it was
            // made (a No-Show keeps the credit spent), so it is checked in
            // rather than paid for twice.
            const noShow = await tx.booking.findFirst({
              where: { studentId, classId, status: 'NO_SHOW' },
              orderBy: { createdAt: 'desc' },
              select: { id: true, classId: true },
            });
            if (noShow) {
              await tx.booking.updateMany({ where: { id: noShow.id, status: 'NO_SHOW' }, data: { status: 'UPCOMING' } });
              booking = noShow;
              from = 'NO_SHOW';
            } else {
              // Not booked: booked now, paid for exactly as a staff booking is.
              booking = await this.bookings.bookInTx(tx, { callerId, studentId, cls, dto: { studentId }, isStaffAction: true, viaKidMode: false });
              from = 'BOOKED';
            }
          }
          await this.attendance.completeInTx(tx, studentId, booking, 'STAFF_LOGGED', callerId);
          return { bookingId: booking.id, from };
        },
        BOOKING_TX_OPTIONS,
      ),
    );
    await this.attendance.afterCheckIn(studentId);
    return { bookingId: result.bookingId, classId, studentId, checkInMethod: 'STAFF_LOGGED', checkedInById: callerId, from: result.from };
  }

  /**
   * Past attendance imported from a spreadsheet (Decision 422 item 6), of any
   * age. The caller (DataImportsService) has already checked the row: the
   * student is a current student of this School it may reach, the class is
   * this School's, has started, isn't cancelled or archived, and the caller
   * may check people in at its Branch. As log(), but:
   *
   * - **Any age:** no 30-day window.
   * - **No credits:** it was paid for elsewhere. A booking already made for
   *   the class (Upcoming, or marked No-Show) is checked in, as log() does;
   *   it was paid for when it was made, not by the import. Otherwise the
   *   booking is made with no Membership behind it (sourceMembershipId null),
   *   so no pack or class credit is used and no membership is needed. A new
   *   booking's seat rules (capacity, the waitlist, the belt needed to book,
   *   the class's waiver to book) are about taking a place in a class to come,
   *   so they don't apply to a visit that already happened.
   * - **Belt progress:** checked in through the same completeInTx as every
   *   other way in (the School's check-in rules about the person except
   *   "Waiver must be signed before booking or check-in", which an imported
   *   visit skips because it already happened (Decision 442 item 1); the grading
   *   count with its class types and weekly cap, hours trained), except that
   *   only a class on or after the day the current belt was awarded counts
   *   toward the next one (StudentRank.dateOfCurrentRank, Decision 423); an
   *   earlier class counts toward nothing.
   *
   * Recorded as STAFF_LOGGED by the importer, as before. The ready-to-grade
   * check is the caller's, once per student after the batch (afterCheckIn).
   */
  async importPast(callerId: string, schoolId: string, dto: { studentId: string; classId: string }): Promise<{ bookingId: string }> {
    const { studentId, classId } = dto;
    // In the importer's own context: only a Class of this School they can see.
    const cls = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.class.findFirst({ where: { id: classId, schoolId }, select: { id: true, branchId: true, startDate: true, cancelledAt: true, archivedAt: true } }),
    );
    if (!cls) throw new NotFoundException('Class not found');
    if (cls.cancelledAt) throw new ConflictException('This class has been cancelled by the school.');
    if (cls.archivedAt) throw new BadRequestException('This Class is archived and can no longer be booked.');
    if (cls.startDate > new Date()) {
      throw new BadRequestException({ code: 'LOG_NOT_STARTED', message: "This class hasn't started yet. Check them in instead." });
    }
    return withSeatLockRetry(() => this.prismaApp.withTenantContext(
      studentId,
      async (tx) => {
        await lockStudentClass(tx, studentId, classId);
        await lockSchoolOpen(tx, schoolId);
        // Re-checked under the lock a whole-class cancel also takes (as bookInTx).
        const locked = await lockClassShared(tx, classId);
        await assertNotAlreadyAttended(tx, studentId, classId);
        let booking = await tx.booking.findFirst({ where: { studentId, classId, status: 'UPCOMING' }, select: { id: true, classId: true } });
        if (!booking) {
          const noShow = await tx.booking.findFirst({ where: { studentId, classId, status: 'NO_SHOW' }, orderBy: { createdAt: 'desc' }, select: { id: true, classId: true } });
          if (noShow) {
            await tx.booking.updateMany({ where: { id: noShow.id, status: 'NO_SHOW' }, data: { status: 'UPCOMING' } });
            booking = noShow;
          } else {
            booking = await tx.booking.create({
              data: { id: randomUUID(), studentId, classId, schoolId, branchId: locked ? locked.branchId : cls.branchId, sourceMembershipId: null },
              select: { id: true, classId: true },
            });
          }
        }
        await this.attendance.completeInTx(tx, studentId, booking, 'STAFF_LOGGED', callerId, { onlySinceRankDate: true });
        return { bookingId: booking.id };
      },
      BOOKING_TX_OPTIONS,
    ));
  }

  /** After importPast commits, once per student: the classes may have made
   * them ready to grade (Decision 178). */
  async afterImport(studentId: string): Promise<void> {
    await this.attendance.afterCheckIn(studentId);
  }
}
