import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CheckInMethod, PrismaClient } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { QrTokenService } from './qr-token.service';
import { ScanAttendanceDto } from './dto/scan-attendance.dto';
import { InstructorScanDto } from './dto/instructor-scan.dto';
import { creditAttendance } from '../ranks/grading-attendance';
import { recordCheckInMinutes } from '../ranks/hours-trained';
import { lockStudentClass } from '../bookings/booking-gates';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { GRADING_NOTIFICATIONS_QUEUE } from '../jobs/queue.constants';
import { queueReadyCheck } from '../jobs/grading-notifications.types';

/**
 * Phase 13 built self-service-only QR check-in against a bare `bookingId` — the
 * QR code's own generation mechanism didn't exist yet, and neither did the
 * Instructor roll-call scan (Decision 71, mechanics undesigned at the time).
 * Phase 51 (Decision 107, docs/decisions/POST-SPEC-55-DECISION-LOG.md) closes
 * both gaps as one flagged engineering design, not asserted as SKILL.md-
 * confirmed or product-approved:
 *
 * - Self-service (`scan()`) now verifies a rotating, Class-scoped token
 *   (QrTokenService) instead of trusting a bare bookingId — the actual
 *   mechanism Decision 66's "time-boxed, rotating" constraint required.
 * - The Instructor roll-call scan (`instructorScan()`, `POST /classes/{id}/
 *   attendance-scan`) exists for the first time — either scanning the
 *   Student's own rotating personal token (`INSTRUCTOR_SCAN`) or a camera-free
 *   manual confirmation by name (`INSTRUCTOR_MANUAL`, Decision 107's own
 *   fallback for a Student whose camera-tier consent is Withdrawn or who has
 *   an accessibility need — see instructorScan()'s own comment for why the
 *   consent gate applies to one mode and not the other).
 * - The Staff/accessibility override SKILL.md §14 names as the fallback for a
 *   consent-withdrawn Student is `INSTRUCTOR_MANUAL` above, not `PATCH
 *   /bookings/{id}/override` (Phase 11) — that endpoint remains scoped to
 *   amending an existing rank-gate override's justification text only, never
 *   Booking.status, unchanged by this phase.
 *
 * No dedicated Attendance entity — confirmed as intentional (SKILL.md §11): a
 * successful check-in (any of the three methods) marks the matching Booking
 * Completed, and that Completed status is exactly what credits
 * `StudentRank.classesAttendedTowardCheckpoint`, through the grading engine's
 * counting rules (`creditAttendance`, roadmap Phase 2b). All three methods share the
 * same completeBooking() transition below — the only difference between them
 * is which gates ran first and what gets recorded on `checkInMethod`/
 * `checkedInById`.
 *
 * `qr-attendance-processing` remains a synchronous request handler, not a
 * literal BullMQ job — unchanged from Phase 13's own Decision 93.
 */
// Same shape PrismaAppService#withTenantContext hands its callback.
type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly qrTokenService: QrTokenService,
    @InjectQueue(GRADING_NOTIFICATIONS_QUEUE) private readonly gradingNotificationsQueue: Queue,
  ) {}

  /** GET /classes/{id}/qr-token — Staff-only. Mints the rotating Class-scoped
   * token the School Portal's own QR display screen polls for and renders,
   * plus (Decision 235) the same-window 6-digit fallback code shown as text
   * alongside the QR. No window check here (deliberately) — issuing a token
   * for a Class whose check-in window has already closed is harmless, since
   * scan()/enterCode() enforce the window themselves; duplicating that check
   * here would just be a second copy of the same cutoff logic to keep in
   * sync. */
  async issueClassQrToken(callerId: string, classId: string) {
    const cls = await this.prismaApp.withTenantContext(callerId, (tx) => tx.class.findUnique({ where: { id: classId } }));
    if (!cls) {
      throw new NotFoundException('Class not found');
    }
    await this.tenantAuth.assertStaffAtSchool(callerId, cls.schoolId, cls.branchId);
    await this.tenantAuth.assertStaffMay(callerId, cls.schoolId, 'bookings', cls.branchId);
    const { token, expiresAt } = this.qrTokenService.signClassToken(classId);
    const { code } = this.qrTokenService.deriveClassCheckInCode(classId);
    return { token, expiresAt, code };
  }

  /** GET /attendance/my-qr-token — self-service, no role check and no DB read
   * at all. Any authenticated caller can mint a token for their own id; it
   * only has a real effect downstream if they also hold an Upcoming Booking
   * for the Class it ends up being scanned against (instructorScan() checks
   * that, not this endpoint) — same "the action naturally can't do anything
   * harmful for the wrong kind of caller" reasoning Phase 13's own self-service
   * scan() already relied on. */
  issueMyQrToken(callerId: string) {
    return this.qrTokenService.signStudentToken(callerId);
  }

  async scan(callerId: string, dto: ScanAttendanceDto) {
    const tokenClassId = this.qrTokenService.verifyClassToken(dto.qrToken);
    if (tokenClassId !== dto.classId) {
      throw new BadRequestException('This QR code is for a different Class.');
    }

    // Looks up by (studentId, classId, status=UPCOMING) rather than a specific
    // bookingId (Phase 13's own shape, no longer available — the caller only
    // ever supplies classId now). The partial unique index backing "one active
    // Booking per Student per Class" (Phase 11 migration) means at most one row
    // can ever match; if none does, "no Upcoming Booking" is accurate and
    // actionable on its own — this deliberately collapses Phase 13's own
    // separate "not found" vs. "not currently Upcoming" cases into one 404,
    // since there is no longer a specific bookingId to have gotten wrong.
    const booking = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.booking.findFirst({ where: { studentId: callerId, classId: dto.classId, status: 'UPCOMING' }, include: { class: true } }),
    );
    if (!booking) {
      throw new NotFoundException('No Upcoming Booking found for this Student on this Class.');
    }

    await this.assertWithinWindow(booking.class);
    await this.assertCameraConsentNotWithdrawn(callerId);

    return this.completeBooking(callerId, booking, 'SELF_SERVICE', null);
  }

  /**
   * POST /attendance/code — Decision 235's own standing, self-service,
   * camera-free check-in path: a Student types the 6-digit code the Class-QR
   * display screen also shows as text (same window as the QR, see
   * QrTokenService.deriveClassCheckInCode's own comment). Deliberately
   * SKIPS assertCameraConsentNotWithdrawn — this exists specifically to give
   * a consent-withdrawn or accessibility-affected Student a standing path
   * that doesn't depend on a camera at all, the same reasoning
   * instructorScan()'s own INSTRUCTOR_MANUAL mode already applies; gating it
   * on the exact thing it's the alternative to would defeat its own purpose.
   * `INSTRUCTOR_MANUAL` remains the true occasional-use STAFF fallback
   * (Decision 235) — this is its own, distinct, Student-initiated method.
   */
  async enterCode(studentId: string, classId: string, code: string) {
    if (!this.qrTokenService.verifyClassCheckInCode(classId, code)) {
      throw new BadRequestException('Incorrect or expired code — ask Staff for the current code.');
    }

    const booking = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.booking.findFirst({ where: { studentId, classId, status: 'UPCOMING' }, include: { class: true } }),
    );
    if (!booking) {
      throw new NotFoundException('No Upcoming Booking found for this Student on this Class.');
    }
    await this.assertWithinWindow(booking.class);

    return this.completeBooking(studentId, booking, 'SELF_SERVICE_CODE', null);
  }

  /** POST /classes/{id}/attendance-scan — Staff-only (Decision 71's confirmed
   * purpose: an Instructor-operated roll-call scan, distinct from self-service
   * and from PATCH /bookings/{id}/override).
   *
   * Consent-gate asymmetry, flagged explicitly (Decision 107): the camera-tier
   * ConsentRecord block applies to `INSTRUCTOR_SCAN` (the Instructor's own
   * camera scans the Student's screen, but SKILL.md §14's tier language —
   * "camera-based check-in" — isn't confirmed to hinge on literally whose
   * camera does the scanning, so this takes the conservative reading) but NOT
   * to `INSTRUCTOR_MANUAL`, which is deliberately camera-free end to end and
   * exists specifically so a consent-withdrawn or accessibility-blocked
   * Student still has a path that doesn't depend on resolving that ambiguity.
   */
  async instructorScan(instructorId: string, classId: string, dto: InstructorScanDto) {
    const cls = await this.prismaApp.withTenantContext(instructorId, (tx) => tx.class.findUnique({ where: { id: classId } }));
    if (!cls) {
      throw new NotFoundException('Class not found');
    }
    await this.tenantAuth.assertStaffAtSchool(instructorId, cls.schoolId, cls.branchId);
    await this.tenantAuth.assertStaffMay(instructorId, cls.schoolId, 'bookings', cls.branchId);

    let method: CheckInMethod;
    if (dto.lookupToken) {
      // The QR was checked when it was scanned (deskQrLookup); the lookup only
      // works for that student, School and staff member.
      const lookup = this.qrTokenService.verifyDeskLookup(dto.lookupToken);
      if (lookup.deskStudentId !== dto.studentId || lookup.schoolId !== cls.schoolId || lookup.staffId !== instructorId) {
        throw new BadRequestException('This scan belongs to a different Student.');
      }
      await this.assertCameraConsentNotWithdrawn(dto.studentId);
      method = 'INSTRUCTOR_SCAN';
    } else if (dto.studentToken) {
      const tokenStudentId = this.qrTokenService.verifyStudentToken(dto.studentToken);
      if (tokenStudentId !== dto.studentId) {
        throw new BadRequestException('This QR code belongs to a different Student.');
      }
      await this.assertCameraConsentNotWithdrawn(dto.studentId);
      method = 'INSTRUCTOR_SCAN';
    } else {
      method = 'INSTRUCTOR_MANUAL';
    }

    const booking = await this.prismaApp.withTenantContext(dto.studentId, (tx) =>
      tx.booking.findFirst({ where: { studentId: dto.studentId, classId, status: 'UPCOMING' }, include: { class: true } }),
    );
    if (!booking) {
      throw new NotFoundException('No Upcoming Booking found for this Student on this Class.');
    }
    await this.assertWithinWindow(booking.class);

    return this.completeBooking(dto.studentId, booking, method, instructorId);
  }

  /** POST /schools/{schoolId}/front-desk/qr-lookups — staff at the desk scan a
   * Student's app QR. The QR lasts about 20 seconds, too short to tick classes
   * and confirm, so it's checked here once and the desk gets a lookup token for
   * five minutes (front-desk check-in review Q2, product owner 28 Oct 2026).
   * Also says who it is, and refuses a QR of someone who isn't a current
   * Student here (CI6: before, the desk opened a card with no name). */
  async deskQrLookup(callerId: string, schoolId: string, studentToken: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.tenantAuth.assertStaffMay(callerId, schoolId, 'bookings');
    const studentId = this.qrTokenService.verifyStudentToken(studentToken);
    // Read via ultm8_jobs: Branch Staff and coaches can't see every RoleGrant.
    const enrolled = await this.prismaJobs.roleGrant.findFirst({
      where: { userId: studentId, schoolId, role: 'STUDENT', revokedAt: null },
      select: { id: true },
    });
    if (!enrolled) {
      throw new NotFoundException({ code: 'NOT_A_STUDENT_HERE', message: "This person isn't a Student at this School." });
    }
    await this.assertCameraConsentNotWithdrawn(studentId);
    const user = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: studentId }, select: { firstName: true, surname: true, profilePhotoUrl: true } }),
    );
    const { token, expiresAt } = this.qrTokenService.signDeskLookup({ deskStudentId: studentId, schoolId, staffId: callerId });
    return {
      lookupToken: token,
      expiresAt: expiresAt.toISOString(),
      studentId,
      firstName: user.firstName,
      surname: user.surname,
      profilePhotoUrl: user.profilePhotoUrl,
    };
  }

  /** POST /bookings/{id}/guests/{attendeeId}/check-in — staff at the desk check
   * one guest in, when they actually come (Decision 377). The member's own
   * check-in no longer speaks for their guests. Same check-in window as the
   * member's; the booking must be Upcoming or already checked in. Recorded on
   * the guest's seat only: a guest has no account, so nothing is credited
   * toward grading. Written in the booker's own context, as the member's
   * check-in is (booking_attendee_write). */
  async checkInGuest(callerId: string, bookingId: string, attendeeId: string) {
    const booking = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.booking.findUnique({ where: { id: bookingId }, include: { class: true, attendees: { select: { id: true } } } }),
    );
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    await this.tenantAuth.assertStaffAtSchool(callerId, booking.schoolId, booking.branchId);
    await this.tenantAuth.assertStaffMay(callerId, booking.schoolId, 'bookings', booking.branchId);
    if (!booking.attendees.some((a) => a.id === attendeeId)) {
      throw new NotFoundException('Guest not found on this booking');
    }
    if (booking.status !== 'UPCOMING' && booking.status !== 'COMPLETED') {
      throw new ConflictException('This booking was cancelled, so its guests can no longer be checked in.');
    }
    await this.assertWithinWindow(booking.class);
    const checkedInAt = new Date();
    const result = await this.prismaApp.withTenantContext(booking.studentId, (tx) =>
      tx.bookingAttendee.updateMany({ where: { id: attendeeId, bookingId, checkedInAt: null }, data: { checkedInAt, checkedInById: callerId } }),
    );
    if (result.count === 0) {
      throw new ConflictException('This guest is already checked in.');
    }
    return { attendeeId, checkedInAt: checkedInAt.toISOString() };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  // Trigger-timing resolution reused verbatim from booking-no-show-processing
  // (Phase 11 kickoff prompt §4 / decision-log precedent): qrAttendanceEndAt
  // when set, else Class.endDate. Applied uniformly to all three check-in
  // methods (Decision 107) — exempting INSTRUCTOR_MANUAL would turn "just say
  // manual" into an easy bypass of the one anti-fraud/no-show boundary the
  // whole check-in system is built around.
  async assertWithinWindow(cls: { schoolId: string; startDate: Date; qrAttendanceEndAt: Date | null; endDate: Date }): Promise<void> {
    const now = new Date();
    // Check-in opens the School's set number of minutes before the Class starts
    // (product owner, 26 Oct 2026; 30 by default). Before this, a Student could be
    // checked into next week's Class and the attendance counted toward grading.
    // Read via ultm8_jobs: a School setting, not a row the caller owns.
    const school = await this.prismaJobs.school.findUnique({ where: { id: cls.schoolId }, select: { checkInOpensMinutesBeforeStart: true } });
    const opensAt = new Date(cls.startDate.getTime() - (school?.checkInOpensMinutesBeforeStart ?? 30) * 60_000);
    if (now < opensAt) {
      throw new BadRequestException({ code: 'CHECK_IN_NOT_OPEN', message: `Check-in for this Class hasn't opened yet. It opens at ${opensAt.toISOString()}.` });
    }
    const cutoff = cls.qrAttendanceEndAt ?? cls.endDate;
    if (now > cutoff) {
      throw new BadRequestException('The check-in window for this Class has closed.');
    }
  }

  // Camera-tier consent check (SKILL.md §14) — via PrismaJobsService, same
  // ultm8_jobs bypass Phase 12's own migration provisioned for this read
  // (ConsentRecord's RLS is Guardian-self-only, no Student branch at all,
  // Decision 92 — an ordinary Student/Instructor tenant context can never see
  // it directly). Only an EXPLICIT WITHDRAWN record blocks — SKILL.md §14 only
  // ever describes WITHDRAWAL as the blocking trigger; a Student who simply
  // never had camera consent granted (true for every adult, self-registered
  // Student) has no ConsentRecord at all and must not be blocked by that
  // absence. Unchanged from Phase 13's own reasoning, now shared by both
  // scan() and instructorScan()'s own INSTRUCTOR_SCAN mode.
  async assertCameraConsentNotWithdrawn(studentId: string): Promise<void> {
    const withdrawn = await this.prismaJobs.consentRecord.findFirst({
      where: { studentId, tier: 'CAMERA', status: 'WITHDRAWN' },
      select: { id: true },
    });
    if (withdrawn) {
      throw new ForbiddenException(
        'Camera-tier consent has been withdrawn for this Student — a camera-based check-in is unavailable. Staff can confirm attendance manually instead.',
      );
    }
  }

  private async completeBooking(
    studentId: string,
    booking: { id: string; classId: string },
    method: CheckInMethod,
    checkedInById: string | null,
  ) {
    const completed = await this.prismaApp.withTenantContext(studentId, async (tx) => {
      // Taken before any row lock, the same as a booking for this Student and
      // Class (lockStudentClass: a booking and a check-in otherwise deadlocked).
      await lockStudentClass(tx, studentId, booking.classId);
      return this.completeInTx(tx, studentId, booking, method, checkedInById);
    });
    // The class may have made the student ready to grade (Decision 178).
    await this.afterCheckIn(studentId);
    return completed;
  }

  /** The check-in itself, inside the caller's transaction (in the Student's own
   * context, after lockStudentClass). completeBooking runs it alone; the front
   * desk's one-step check-in (Decision 378) runs it for several Classes in one
   * transaction. Call afterCheckIn once the transaction has committed. */
  async completeInTx(tx: TenantTx, studentId: string, booking: { id: string; classId: string }, method: CheckInMethod, checkedInById: string | null) {
    // Optimistic-concurrency guard, same established pattern as every other
    // status transition in this codebase — guards against a double-scan
    // race (any combination of the three methods) or a race against the
    // no-show sweep.
    const result = await tx.booking.updateMany({
      where: { id: booking.id, status: 'UPCOMING' },
      data: { status: 'COMPLETED', checkInMethod: method, checkedInById },
    });
    if (result.count === 0) {
      throw new ConflictException(
        'This Booking is no longer Upcoming — it may already have been checked into, cancelled, or marked No-Show.',
      );
    }

    // Credit toward the student's next rung in each style the class lists
    // (roadmap Phase 2b; Decisions 140, 149, 170, 171). This replaces Decision
    // 90's activities <-> Discipline.name bridge for attendance. Attendance
    // check-in happens regardless of ranking: a style the student has no rank
    // in is skipped.
    await creditAttendance(tx, studentId, booking);

    // Hours trained (Decisions 301 item 1, 306): the class's scheduled
    // length, per style, as a record only. Separate from the class count
    // above and never read by grading.
    await recordCheckInMinutes(tx, studentId, booking);

    return tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { attendees: true } });
  }

  /** After a check-in commits: the class may have made the student ready to
   * grade (Decision 178). */
  async afterCheckIn(studentId: string): Promise<void> {
    await queueReadyCheck(this.gradingNotificationsQueue, studentId);
  }
}
