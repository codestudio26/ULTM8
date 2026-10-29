import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { CheckInMethod } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SubscriptionGateService } from '../subscription-plans/subscription-gate.service';
import { BookingsService } from '../bookings/bookings.service';
import { assertClassBookable, BOOKING_TX_OPTIONS, lockStudentClass, withSeatLockRetry } from '../bookings/booking-gates';
import { lockSchoolOpen } from '../tenants/lock-school-open';
import { AttendanceService } from './attendance.service';
import { QrTokenService } from './qr-token.service';
import { DeskCheckInClassResultDto, DeskCheckInDto, DeskCheckInGuestResultDto, DeskCheckInResponseDto } from './dto/desk-check-in.dto';

type Reason = { code: string; message: string };

/** The code and message an HttpException would send, for a result row. */
function reasonOf(err: HttpException): Reason {
  const body = err.getResponse();
  const fields = body && typeof body === 'object' ? (body as { code?: unknown; message?: unknown }) : {};
  const message = typeof body === 'string' ? body : typeof fields.message === 'string' ? fields.message : Array.isArray(fields.message) ? fields.message.join('; ') : err.message;
  return { code: typeof fields.code === 'string' ? fields.code : err.name.replace(/Exception$/, '').replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase(), message };
}

/** Who a QR lookup made on a locked tablet belongs to: the session, not the
 * staff member who started it (Decision 380). */
export function frontDeskLookupOwner(sessionId: string): string {
  return `front-desk:${sessionId}`;
}

/** A locked tablet only checks people in to its own Branch's Classes, and the
 * whole School's (Decision 380). */
function assertAtKioskBranch(kiosk: { branchId: string | null } | undefined, classBranchId: string | null) {
  if (kiosk?.branchId && classBranchId && classBranchId !== kiosk.branchId) {
    throw new ForbiddenException({ code: 'OTHER_BRANCH', message: 'This class is at another Branch.' });
  }
}

/** Thrown inside the transaction to roll it back while saying which item failed. */
class ItemFailed extends Error {
  constructor(
    readonly item: { classId: string } | { attendeeId: string },
    readonly reason: Reason,
  ) {
    super(reason.message);
  }
}

/**
 * The front desk's one-step check-in (Decision 378, handover F7). The welcome
 * card's confirm used to call book and attendance-scan once per Class, so a
 * failure part-way left some Classes done. Here everything is checked first,
 * then booked and checked in in one transaction in the Student's own context:
 * either all of it happens or none of it, and the reply says which item
 * stopped it.
 */
@Injectable()
export class FrontDeskCheckInService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly subscriptionGate: SubscriptionGateService,
    private readonly bookings: BookingsService,
    private readonly attendance: AttendanceService,
    private readonly qrTokens: QrTokenService,
  ) {}

  /** `kiosk`: a locked front-desk tablet (Decision 380) checks in as the staff
   * member who started it, only for Classes at its Branch (or the whole
   * School's), with QR lookups made on that tablet. */
  async checkIn(callerId: string, schoolId: string, dto: DeskCheckInDto, kiosk?: { sessionId: string; branchId: string | null }): Promise<DeskCheckInResponseDto> {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    const { studentId } = dto;
    const guestRefs = dto.guests ?? [];
    if (dto.classIds.length === 0 && guestRefs.length === 0) {
      throw new BadRequestException('Pick at least one class or guest to check in.');
    }
    if (new Set(guestRefs.map((g) => g.attendeeId)).size !== guestRefs.length) {
      throw new BadRequestException('The same guest was listed more than once.');
    }
    // Read via ultm8_jobs: Branch Staff and coaches can't see every RoleGrant.
    const enrolled = await this.prismaJobs.roleGrant.findFirst({ where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } });
    if (!enrolled) {
      throw new NotFoundException({ code: 'NOT_A_STUDENT_HERE', message: "This person isn't a Student at this School." });
    }

    let method: CheckInMethod = 'INSTRUCTOR_MANUAL';
    if (dto.lookupToken) {
      // The app QR or personal code was checked when it was looked up.
      const lookup = this.qrTokens.verifyDeskLookup(dto.lookupToken);
      const lookupOwner = kiosk ? frontDeskLookupOwner(kiosk.sessionId) : callerId;
      if (lookup.deskStudentId !== studentId || lookup.schoolId !== schoolId || lookup.staffId !== lookupOwner) {
        throw new BadRequestException('This scan belongs to a different Student.');
      }
      if (lookup.via === 'CODE') {
        // A typed code uses no camera (Decision 384).
        method = 'PERSONAL_CODE';
      } else {
        await this.attendance.assertCameraConsentNotWithdrawn(studentId);
        method = 'INSTRUCTOR_SCAN';
      }
    }

    const classResults: DeskCheckInClassResultDto[] = dto.classIds.map((classId) => ({ classId, ok: true }));
    const guestResults: DeskCheckInGuestResultDto[] = guestRefs.map((g) => ({ attendeeId: g.attendeeId, ok: true }));
    const failClass = (classId: string, reason: Reason) => Object.assign(classResults.find((r) => r.classId === classId)!, { ok: false, ...reason });
    const failGuest = (attendeeId: string, reason: Reason) => Object.assign(guestResults.find((r) => r.attendeeId === attendeeId)!, { ok: false, ...reason });
    const outcome = (done: boolean): DeskCheckInResponseDto => ({ done, classes: classResults, guests: guestResults });

    // 1. Everything that can be checked before the transaction, so the reply
    // can name every item that can't be done, not just the first.
    const classes = await this.prismaApp.withTenantContext(callerId, (tx) => tx.class.findMany({ where: { id: { in: dto.classIds }, schoolId } }));
    for (const classId of dto.classIds) {
      const cls = classes.find((c) => c.id === classId);
      if (!cls) {
        failClass(classId, { code: 'NOT_FOUND', message: 'Class not found' });
        continue;
      }
      try {
        await this.tenantAuth.assertStaffAtSchool(callerId, schoolId, cls.branchId);
        assertAtKioskBranch(kiosk, cls.branchId);
        if (cls.cancelledAt) throw new ConflictException('This class has been cancelled by the school.');
        await this.attendance.assertWithinWindow(cls);
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
        failClass(classId, reasonOf(err));
      }
    }

    const guestBookingIds = [...new Set(guestRefs.map((g) => g.bookingId))];
    const guestBookings = guestBookingIds.length
      ? await this.prismaApp.withTenantContext(studentId, (tx) =>
          tx.booking.findMany({ where: { id: { in: guestBookingIds }, studentId, schoolId }, include: { class: true, attendees: { select: { id: true, checkedInAt: true } } } }),
        )
      : [];
    for (const ref of guestRefs) {
      const booking = guestBookings.find((b) => b.id === ref.bookingId);
      const seat = booking?.attendees.find((a) => a.id === ref.attendeeId);
      if (!booking || !seat) {
        failGuest(ref.attendeeId, { code: 'NOT_FOUND', message: 'Guest not found on this booking' });
        continue;
      }
      try {
        await this.tenantAuth.assertStaffAtSchool(callerId, schoolId, booking.branchId);
        assertAtKioskBranch(kiosk, booking.class.branchId);
        if (seat.checkedInAt) throw new ConflictException('This guest is already checked in.');
        // The member's booking is either already in, or checked in by this call.
        const memberInNow = dto.classIds.includes(booking.classId) && booking.status === 'UPCOMING';
        if (booking.status !== 'COMPLETED' && !memberInNow) {
          throw new ConflictException('This booking was cancelled, so its guests can no longer be checked in.');
        }
        await this.attendance.assertWithinWindow(booking.class);
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
        failGuest(ref.attendeeId, reasonOf(err));
      }
    }
    if (classResults.some((r) => !r.ok) || guestResults.some((r) => !r.ok)) {
      return outcome(false);
    }

    // The gates a staff booking passes before its transaction (bookClass).
    await this.subscriptionGate.assertNotDegraded(studentId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(studentId, schoolId);

    // 2. One transaction: book where needed, check in, then the guests.
    const ordered = [...classes].sort((a, b) => a.startDate.getTime() - b.startDate.getTime() || a.id.localeCompare(b.id));
    const checkedInAt = new Date();
    try {
      const bookingIds = await withSeatLockRetry(() =>
        this.prismaApp.withTenantContext(
          studentId,
          async (tx) => {
            // Every Student-and-Class lock first, in one order (see lockStudentClass), then the School.
            for (const id of [...dto.classIds].sort()) await lockStudentClass(tx, studentId, id);
            await lockSchoolOpen(tx, schoolId);
            const ids = new Map<string, string>();
            for (const cls of ordered) {
              try {
                let booking = await tx.booking.findFirst({ where: { studentId, classId: cls.id, status: 'UPCOMING' }, select: { id: true, classId: true } });
                if (!booking) {
                  assertClassBookable(cls, { byStaff: true });
                  booking = await this.bookings.bookInTx(tx, { callerId, studentId, cls, dto: { studentId }, isStaffAction: true, viaKidMode: false });
                }
                await this.attendance.completeInTx(tx, studentId, booking, method, callerId);
                ids.set(cls.id, booking.id);
              } catch (err) {
                if (err instanceof HttpException) throw new ItemFailed({ classId: cls.id }, reasonOf(err));
                throw err;
              }
            }
            for (const ref of guestRefs) {
              const result = await tx.bookingAttendee.updateMany({
                where: { id: ref.attendeeId, bookingId: ref.bookingId, checkedInAt: null },
                data: { checkedInAt, checkedInById: callerId },
              });
              if (result.count === 0) throw new ItemFailed({ attendeeId: ref.attendeeId }, { code: 'CONFLICT', message: 'This guest is already checked in.' });
            }
            return ids;
          },
          BOOKING_TX_OPTIONS,
        ),
      );
      for (const r of classResults) r.bookingId = bookingIds.get(r.classId);
      for (const r of guestResults) r.checkedInAt = checkedInAt.toISOString();
    } catch (err) {
      if (!(err instanceof ItemFailed)) throw err;
      if ('classId' in err.item) failClass(err.item.classId, err.reason);
      else failGuest(err.item.attendeeId, err.reason);
      return outcome(false);
    }
    if (dto.classIds.length > 0) await this.attendance.afterCheckIn(studentId);
    return outcome(true);
  }
}
