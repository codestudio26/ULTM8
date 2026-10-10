import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { ScanAttendanceDto } from './dto/scan-attendance.dto';
import { InstructorCheckInDto } from './dto/instructor-check-in.dto';
import { ClassRosterResponseDto } from './dto/class-roster-response.dto';

// Same shape PrismaAppService#withTenantContext hands its callback — matches
// BookingsService's own alias for the identical need.
type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Phase 13 scope: self-service QR check-in (`POST /attendance/scan`). See the
 * Phase 13 kickoff prompt for the full scoping rationale.
 *
 * Phase 17 scope (added after Phase 13): the Instructor roll-call check-in
 * (`POST /classes/{id}/attendance-scan`, `GET /classes/{id}/roster`, `DELETE
 * /classes/{id}/attendance-scan/{studentId}`) — Decision 71's named concept,
 * resolved with the product owner to be a plain per-Student roster tap, not a
 * literal QR scan (the endpoint keeps its spec-given name regardless). This
 * also closes the accessibility/no-alternative gap SKILL.md §14 describes:
 * since it needs no Student camera or device at all, a Student whose
 * camera-tier consent is withdrawn now has a real path to being checked in,
 * where previously none of the endpoints matching that description actually
 * touched `Booking.status` (see this file's git history for the full
 * before/after).
 *
 * Deliberately NOT built: the QR code's own generation/rotation mechanism
 * (SKILL.md §12, unresolved as a screen — apps/school-portal's CheckInPage owns
 * that), and the camera-tier-consent check this roster path doesn't need (see
 * instructorCheckIn's own comment for why).
 *
 * No dedicated Attendance entity — confirmed as intentional (SKILL.md §11): a
 * successful scan marks the matching Booking Completed, and that Completed
 * status is exactly what increments `StudentRank.classesAttendedTowardCheckpoint`.
 *
 * `qr-attendance-processing` is implemented as a synchronous request handler,
 * not a literal BullMQ job — flagged as a Developer-level interpretation
 * (Decision 93), though notably NOT a lone judgment call: the Phase 12
 * migration's own `consent_record_jobs_read` comment already anticipated this
 * exact tension and named it explicitly ("NOT a background job in the usual
 * sense... the same interactive-bypass precedent... for Booking's capacity
 * check") before this phase was ever built.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  async scan(callerId: string, dto: ScanAttendanceDto) {
    const booking = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.booking.findUnique({ where: { id: dto.bookingId }, include: { class: true } }),
    );
    if (!booking || booking.studentId !== callerId) {
      throw new NotFoundException('Booking not found');
    }
    if (booking.status !== 'UPCOMING') {
      throw new BadRequestException('This Booking is not currently Upcoming — nothing to check into.');
    }

    // Trigger-timing resolution reused verbatim from booking-no-show-processing
    // (Phase 11 kickoff prompt §4 / decision-log precedent): qrAttendanceEndAt
    // when set, else Class.endDate.
    const cutoff = booking.class.qrAttendanceEndAt ?? booking.class.endDate;
    if (new Date() > cutoff) {
      throw new BadRequestException('The check-in window for this Class has closed.');
    }

    // Camera-tier consent check (SKILL.md §14/AttendanceModule's own confirmed
    // scope) — via PrismaJobsService, the same ultm8_jobs bypass Phase 12's own
    // migration provisioned specifically for this read (Booking/WaitlistEntry's
    // own RLS-visibility precedent, Decision 89's addendum, applies the same
    // way here: the scanning Student's own tenant context can see their OWN
    // ConsentRecord rows even less than a Booking capacity check could see
    // other Students' rows — ConsentRecord's RLS is Guardian-self-only, with NO
    // Student branch at all, Decision 92).
    //
    // Only an EXPLICIT WITHDRAWN camera-tier record blocks — SKILL.md §14 only
    // ever describes WITHDRAWAL as the blocking trigger ("blocks future
    // self-service QR check-in"); it says nothing about a Student who simply
    // never had camera consent granted in the first place (true for every
    // adult, self-registered Student, who has no ConsentRecord at all). Treating
    // "no consent record exists" the same as "withdrawn" would incorrectly lock
    // out every non-Guardian-linked Student in the system.
    const withdrawnCameraConsent = await this.prismaJobs.consentRecord.findFirst({
      where: { studentId: callerId, tier: 'CAMERA', status: 'WITHDRAWN' },
      select: { id: true },
    });
    if (withdrawnCameraConsent) {
      throw new ForbiddenException(
        'Camera-tier consent has been withdrawn for this Student — self-service check-in is unavailable. Contact School Staff for an alternative.',
      );
    }

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      // Optimistic-concurrency guard, same established pattern as every other
      // status transition in this codebase — guards against a double-scan race
      // or a race against the no-show sweep.
      const result = await tx.booking.updateMany({
        where: { id: dto.bookingId, status: 'UPCOMING' },
        data: { status: 'COMPLETED' },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'This Booking is no longer Upcoming — it may already have been checked into, cancelled, or marked No-Show.',
        );
      }

      await this.adjustRankProgress(tx, callerId, booking.schoolId, booking.class.activities, 1);

      return tx.booking.findUniqueOrThrow({ where: { id: dto.bookingId }, include: { attendees: true } });
    });
  }

  /** GET /classes/{id}/roster — Staff-only. Every Booking a Student could
   * plausibly need checking into/out of for this Class: UPCOMING (not yet
   * checked in), COMPLETED (already checked in, self-service or roster), and
   * NO_SHOW (the background sweep already ran before the Instructor got to
   * roll call — still correctable from here, see instructorCheckIn's own
   * comment). CANCELLED is excluded: that Student isn't attending, nothing to
   * roll-call. `studentName` is resolved via the same broad "shared School"
   * User-visibility RLS every other Staff-facing name lookup in this codebase
   * already relies on (user_self_or_shared_school) — no new access needed. */
  async getClassRoster(callerId: string, classId: string): Promise<ClassRosterResponseDto> {
    const cls = await this.prismaApp.withTenantContext(callerId, (tx) => tx.class.findUnique({ where: { id: classId } }));
    if (!cls) {
      throw new NotFoundException('Class not found');
    }
    await this.tenantAuth.assertStaffAtSchool(callerId, cls.schoolId);

    const bookings = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.booking.findMany({
        where: { classId, status: { in: ['UPCOMING', 'COMPLETED', 'NO_SHOW'] } },
        include: { student: { select: { firstName: true, surname: true } } },
        orderBy: { id: 'asc' },
      }),
    );

    return {
      items: bookings.map((b) => ({
        bookingId: b.id,
        studentId: b.studentId,
        studentName: `${b.student.firstName} ${b.student.surname}`,
        status: b.status,
        checkedInById: b.checkedInById,
      })),
    };
  }

  /** POST /classes/{id}/attendance-scan — Staff-only. See this file's own
   * header comment for why this is a roster tap, not a literal scan, and why
   * it closes the accessibility-fallback gap. No camera-tier consent check
   * (unlike self-service `scan()` above): that check exists to stop a
   * consent-withdrawn Student's OWN camera/device from being used for
   * self-service check-in — it has nothing to say about Staff marking
   * attendance by eye, which needs no Student camera or device at all. Runs
   * the actual write under the target Student's own tenant context (same
   * established "Staff acts, target Student's RLS governs the write"
   * precedent BookingsService.bookClass's override path already uses) — the
   * broad Staff-read policy on Booking is SELECT-only, so Staff's own tenant
   * context can see this row (getClassRoster above) but can't update it. */
  async instructorCheckIn(callerId: string, classId: string, dto: InstructorCheckInDto) {
    const cls = await this.prismaApp.withTenantContext(callerId, (tx) => tx.class.findUnique({ where: { id: classId } }));
    if (!cls) {
      throw new NotFoundException('Class not found');
    }
    await this.tenantAuth.assertStaffAtSchool(callerId, cls.schoolId);
    this.assertWithinGraceWindow(cls.endDate);

    return this.prismaApp.withTenantContext(dto.studentId, async (tx) => {
      const booking = await tx.booking.findFirst({ where: { classId, studentId: dto.studentId } });
      if (!booking) {
        throw new NotFoundException('This Student has no Booking for this Class.');
      }
      if (booking.status === 'CANCELLED') {
        throw new BadRequestException('This Booking was Cancelled — nothing to check in.');
      }

      // Same optimistic-concurrency shape as self-service scan() — UPCOMING or
      // NO_SHOW (the sweep beat the Instructor to it) both mean "not yet
      // confirmed present," and roll-call is the authoritative correction for
      // either. Already-COMPLETED isn't in the where-clause at all: re-tapping
      // an already-checked-in Student is a silent no-op here, not an error —
      // the roster UI's own toggle state already prevents a normal double-tap,
      // this is just defense against a stale/duplicate request.
      const result = await tx.booking.updateMany({
        where: { id: booking.id, status: { in: ['UPCOMING', 'NO_SHOW'] } },
        data: { status: 'COMPLETED', checkedInById: callerId },
      });
      if (result.count === 0) {
        return tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { attendees: true } });
      }

      await this.adjustRankProgress(tx, dto.studentId, cls.schoolId, cls.activities, 1);

      return tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { attendees: true } });
    });
  }

  /** DELETE /classes/{id}/attendance-scan/{studentId} — Staff-only. Undoes a
   * mis-tap on the roster. Deliberately scoped to ONLY a Booking this exact
   * mechanism checked in (`checkedInById` set) — reverting a genuine
   * self-service check-in via this Staff-facing endpoint would be a much
   * bigger, unrequested capability than "fix my own roll-call mistake," so
   * it's left out of scope rather than silently allowed. */
  async undoInstructorCheckIn(callerId: string, classId: string, studentId: string) {
    const cls = await this.prismaApp.withTenantContext(callerId, (tx) => tx.class.findUnique({ where: { id: classId } }));
    if (!cls) {
      throw new NotFoundException('Class not found');
    }
    await this.tenantAuth.assertStaffAtSchool(callerId, cls.schoolId);
    this.assertWithinGraceWindow(cls.endDate);

    return this.prismaApp.withTenantContext(studentId, async (tx) => {
      const booking = await tx.booking.findFirst({ where: { classId, studentId } });
      if (!booking) {
        throw new NotFoundException('This Student has no Booking for this Class.');
      }

      const result = await tx.booking.updateMany({
        where: { id: booking.id, status: 'COMPLETED', checkedInById: { not: null } },
        data: { status: 'UPCOMING', checkedInById: null },
      });
      if (result.count === 0) {
        throw new ConflictException('This Booking was not checked in via the roster, or is no longer Completed — nothing to undo.');
      }

      await this.adjustRankProgress(tx, studentId, cls.schoolId, cls.activities, -1);

      return tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { attendees: true } });
    });
  }

  /** Same-day grace window (product decision, Phase 17): roll-call can
   * complete any time up to 24h after the Class's own end — forgiving for a
   * busy Instructor without allowing backdating to a different day.
   * Timezone-agnostic by design rather than reaching for Branch.timezone,
   * which is optional and frequently null (a School-wide Class may have no
   * Branch at all) — "within 24h of class end" approximates "the same day"
   * closely enough for this purpose without depending on data that often
   * isn't there. */
  private assertWithinGraceWindow(classEndDate: Date): void {
    const graceDeadline = new Date(classEndDate.getTime() + 24 * 60 * 60 * 1000);
    if (new Date() > graceDeadline) {
      throw new BadRequestException('The roll-call window for this Class has closed (same-day only).');
    }
  }

  /** Shared by self-service scan() and the Instructor roster path — same
   * Class.activities <-> Discipline.name bridging heuristic Decision 90
   * established for the rank gate (Phase 11), reused here for attendance
   * (Decision 93). `delta` is 1 for a check-in, -1 to reverse one on undo.
   * Two DIFFERENT cases both silently adjust nothing, deliberately: a Class
   * whose activities don't match any Discipline (the same "nothing to bridge
   * against" fallback Decision 90 established), AND a Discipline that DOES
   * match but where this Student has no StudentRank row for it yet. The
   * second case is a genuine, intentional divergence from
   * BookingsService.assertRankEligible, which THROWS in that situation —
   * attendance check-in is confirmed to happen regardless of ranking (§11's
   * own text never conditions it on holding a Rank), unlike booking
   * eligibility, which is explicitly rank-gated. */
  private async adjustRankProgress(tx: TenantTx, studentId: string, schoolId: string, classActivities: string[], delta: 1 | -1): Promise<void> {
    if (classActivities.length === 0) return;
    const disciplines = await tx.discipline.findMany({
      where: { schoolId, name: { in: classActivities } },
      select: { id: true },
    });
    for (const discipline of disciplines) {
      await tx.studentRank.updateMany({
        where: { studentId, disciplineId: discipline.id },
        data: { classesAttendedTowardCheckpoint: { increment: delta } },
      });
    }
  }
}
