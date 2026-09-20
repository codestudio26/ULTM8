import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CheckInMethod } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { QrTokenService } from './qr-token.service';
import { ScanAttendanceDto } from './dto/scan-attendance.dto';
import { InstructorScanDto } from './dto/instructor-scan.dto';

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
 * Completed, and that Completed status is exactly what increments
 * `StudentRank.classesAttendedTowardCheckpoint`. All three methods share the
 * same completeBooking() transition below — the only difference between them
 * is which gates ran first and what gets recorded on `checkInMethod`/
 * `checkedInById`.
 *
 * `qr-attendance-processing` remains a synchronous request handler, not a
 * literal BullMQ job — unchanged from Phase 13's own Decision 93.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly qrTokenService: QrTokenService,
  ) {}

  /** GET /classes/{id}/qr-token — Staff-only. Mints the rotating Class-scoped
   * token the School Portal's own QR display screen polls for and renders. No
   * window check here (deliberately) — issuing a token for a Class whose
   * check-in window has already closed is harmless, since scan() enforces the
   * window itself; duplicating that check here would just be a second copy of
   * the same cutoff logic to keep in sync. */
  async issueClassQrToken(callerId: string, classId: string) {
    const cls = await this.prismaApp.withTenantContext(callerId, (tx) => tx.class.findUnique({ where: { id: classId } }));
    if (!cls) {
      throw new NotFoundException('Class not found');
    }
    await this.tenantAuth.assertStaffAtSchool(callerId, cls.schoolId, cls.branchId);
    return this.qrTokenService.signClassToken(classId);
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

    this.assertWithinWindow(booking.class);
    await this.assertCameraConsentNotWithdrawn(callerId);

    return this.completeBooking(callerId, booking, 'SELF_SERVICE', null);
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

    let method: CheckInMethod;
    if (dto.studentToken) {
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
    this.assertWithinWindow(booking.class);

    return this.completeBooking(dto.studentId, booking, method, instructorId);
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
  private assertWithinWindow(cls: { qrAttendanceEndAt: Date | null; endDate: Date }): void {
    const cutoff = cls.qrAttendanceEndAt ?? cls.endDate;
    if (new Date() > cutoff) {
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
  private async assertCameraConsentNotWithdrawn(studentId: string): Promise<void> {
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
    booking: { id: string; schoolId: string; class: { activities: string[] } },
    method: CheckInMethod,
    checkedInById: string | null,
  ) {
    return this.prismaApp.withTenantContext(studentId, async (tx) => {
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

      // StudentRank increment — reuses the SAME Class.activities <->
      // Discipline.name bridging heuristic Decision 90 established for the
      // rank gate, applied here for a different purpose (Decision 93,
      // extended to cover all three check-in methods by Decision 107). Two
      // DIFFERENT cases both silently increment nothing, deliberately: a
      // Class whose activities don't match any Discipline, and a Discipline
      // that DOES match but where this Student has no StudentRank row for it
      // yet — attendance check-in happens regardless of ranking, unlike
      // booking eligibility, which is explicitly rank-gated.
      if (booking.class.activities.length > 0) {
        const disciplines = await tx.discipline.findMany({
          where: { schoolId: booking.schoolId, name: { in: booking.class.activities } },
          select: { id: true },
        });
        for (const discipline of disciplines) {
          await tx.studentRank.updateMany({
            where: { studentId, disciplineId: discipline.id },
            data: { classesAttendedTowardCheckpoint: { increment: 1 } },
          });
        }
      }

      return tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { attendees: true } });
    });
  }
}
