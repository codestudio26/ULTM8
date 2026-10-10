import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { ScanAttendanceDto } from './dto/scan-attendance.dto';

/**
 * Phase 13 scope only: self-service QR check-in (`POST /attendance/scan`). See
 * the Phase 13 kickoff prompt for the full scoping rationale. Deliberately NOT
 * built: the QR code's own generation/rotation mechanism (SKILL.md §12,
 * unresolved as a screen), the Instructor roll-call scan (`POST /classes/{id}/
 * attendance-scan`, Decision 71, mechanics undesigned), and any Staff/
 * accessibility check-in override for a Student blocked by withdrawn camera
 * consent — SKILL.md §14 names an "Instructor/Staff-scoped booking-override
 * endpoint" as that fallback, but the only endpoint matching that name built so
 * far (`PATCH /bookings/{id}/override`, Phase 11) is explicitly scoped to
 * amending an existing rank-gate override's justification text, never
 * `Booking.status` — extending it (or building a new one) needs its own
 * confirmation, not assumed here.
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

      // StudentRank increment — reuses the SAME Class.activities <->
      // Discipline.name bridging heuristic Decision 90 already established for
      // the rank gate (Phase 11), applied here for a new purpose (Decision 93).
      // Two DIFFERENT cases both silently increment nothing, deliberately: a
      // Class whose activities don't match any Discipline (the same "nothing to
      // bridge against" fallback Decision 90 established), AND a Discipline
      // that DOES match but where this Student has no StudentRank row for it
      // yet. The second case is a genuine, intentional divergence from
      // BookingsService.assertRankEligible, which THROWS in that situation —
      // attendance check-in is confirmed to happen regardless of ranking
      // (§11's own text never conditions it on holding a Rank), unlike booking
      // eligibility, which is explicitly rank-gated. Not an oversight; flagged
      // explicitly since the two call sites otherwise look identical.
      if (booking.class.activities.length > 0) {
        const disciplines = await tx.discipline.findMany({
          where: { schoolId: booking.schoolId, name: { in: booking.class.activities } },
          select: { id: true },
        });
        for (const discipline of disciplines) {
          await tx.studentRank.updateMany({
            where: { studentId: callerId, disciplineId: discipline.id },
            data: { classesAttendedTowardCheckpoint: { increment: 1 } },
          });
        }
      }

      return tx.booking.findUniqueOrThrow({ where: { id: dto.bookingId }, include: { attendees: true } });
    });
  }
}
