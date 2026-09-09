import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';

type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Phase 11 scope only: join/withdraw/claim. See BookingsService's own header comment
 * for the module-wide scope boundary and RLS shape (Decision 89) — WaitlistEntry
 * uses the identical asymmetric narrow-plus-broad structure.
 *
 * Deliberately self-only for join/claim — unlike BookClassDto, there is no
 * Staff-books-on-behalf-of shape here (not confirmed anywhere in SKILL.md §10 for the
 * waitlist specifically, and a Staff member joining/claiming a waitlist slot on a
 * Student's behalf would immediately spend that Student's own credit at claim time,
 * a materially bigger inference than booking creation's override already is — not
 * built without confirmation). Withdraw does support Staff-on-behalf-of, matching
 * Booking's own cancel shape, since withdrawing is purely a status change, no credit
 * implication either way.
 */
@Injectable()
export class WaitlistService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  /** POST /classes/{id}/waitlist. */
  async joinWaitlist(callerId: string, classId: string) {
    const cls = await this.prismaApp.withTenantContext(callerId, (tx) => tx.class.findUnique({ where: { id: classId } }));
    if (!cls) {
      throw new NotFoundException('Class not found');
    }

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      // FOUND ON REVIEW: reading the current max position then computing +1 is a
      // TOCTOU race — two Students joining the same Class's waitlist concurrently
      // can both read the same highest position and collide, breaking the FCFS
      // ordering the cascade job relies on (no unique constraint exists on
      // (classId, position) since positions are meant to keep advancing, not be
      // reused). Same explicit-row-lock fix as the capacity check in
      // BookingsService.bookClass — see that method's own comment for why this
      // codebase's usual updateMany+count-guard pattern doesn't apply to an
      // aggregate read like this one.
      await tx.$queryRaw`SELECT id FROM "Class" WHERE id = ${classId} FOR UPDATE`;
      // FOUND ON REVIEW, before this ever shipped: like BookingsService's own
      // occupancy count, this MUST run via PrismaJobsService, not `tx` — WaitlistEntry's
      // narrow-plus-broad-STAFF-ONLY-read RLS (Decision 89) means an ordinary Student
      // caller can never see another Student's WaitlistEntry rows under their own
      // tenant context, so `highest` would always be null/undefined from any Student's
      // own perspective — every joiner would silently land on position 1, regardless
      // of how many people are already waiting, breaking FCFS ordering entirely (not
      // just under concurrency — this was wrong even sequentially).
      const highest = await this.prismaJobs.waitlistEntry.findFirst({
        where: { classId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      const position = (highest?.position ?? 0) + 1;

      try {
        return await tx.waitlistEntry.create({
          data: {
            id: randomUUID(),
            studentId: callerId,
            classId,
            schoolId: cls.schoolId,
            branchId: cls.branchId,
            position,
          },
        });
      } catch (err) {
        if (this.isUniqueConstraintViolation(err)) {
          throw new ConflictException('This Student already has an active Waitlist entry for this Class.');
        }
        throw err;
      }
    });
  }

  /** DELETE /waitlist/{id} — the Student withdrawing themselves, or Staff on their
   * behalf. */
  async withdraw(callerId: string, entryId: string): Promise<void> {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.waitlistEntry.findUnique({ where: { id: entryId } }));
    if (!existing) {
      throw new NotFoundException('Waitlist entry not found');
    }
    if (existing.studentId !== callerId) {
      await this.tenantAuth.assertStaffAtSchool(callerId, existing.schoolId);
    }

    await this.prismaApp.withTenantContext(existing.studentId, async (tx) => {
      const result = await tx.waitlistEntry.updateMany({
        where: { id: entryId, status: { in: ['WAITING', 'NOTIFIED'] } },
        data: { status: 'CANCELLED' },
      });
      if (result.count === 0) {
        throw new ConflictException('This Waitlist entry is no longer active (already Claimed, Expired, or Cancelled).');
      }
    });
  }

  /**
   * POST /waitlist/{id}/claim — self-only (see class header comment). Only a
   * NOTIFIED entry, still within its own claimByDeadline, may be claimed. Kickoff
   * prompt §1.d's own resolved inference: RE-CHECKS rank-eligibility and remaining
   * capacity at claim time (state may have changed since joining), not a
   * carried-over decision from join time.
   */
  async claim(callerId: string, entryId: string) {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.waitlistEntry.findUnique({ where: { id: entryId } }));
    if (!existing) {
      throw new NotFoundException('Waitlist entry not found');
    }
    if (existing.studentId !== callerId) {
      throw new ForbiddenException('Only the Student who joined this Waitlist entry may claim it.');
    }
    if (existing.status !== 'NOTIFIED') {
      throw new BadRequestException('This Waitlist entry is not currently Notified — nothing to claim.');
    }
    if (existing.claimByDeadline && existing.claimByDeadline < new Date()) {
      throw new ConflictException('This Waitlist entry\'s claim window has passed.');
    }

    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const cls = await tx.class.findUniqueOrThrow({ where: { id: existing.classId } });

      if (cls.termsWaiverRequired) {
        const signed = await tx.waiverSignature.findFirst({
          where: { studentId: callerId, schoolId: cls.schoolId, status: 'SIGNED' },
          select: { id: true },
        });
        if (!signed) {
          throw new BadRequestException('This Student must hold a Signed Waiver for this School before claiming this Booking.');
        }
      }

      await this.assertRankEligible(tx, callerId, cls);

      if (cls.capacity !== null) {
        // Same explicit-row-lock fix as BookingsService.bookClass's own capacity
        // check — see that comment for the full reasoning.
        await tx.$queryRaw`SELECT id FROM "Class" WHERE id = ${cls.id} FOR UPDATE`;
        // Same PrismaJobsService fix as BookingsService.countOccupiedSeats — `tx`
        // (the claiming Student's own tenant context) can never see another
        // Student's Booking/BookingAttendee rows under Decision 89's RLS shape.
        const [bookingCount, attendeeCount] = await Promise.all([
          this.prismaJobs.booking.count({ where: { classId: cls.id, status: 'UPCOMING' } }),
          this.prismaJobs.bookingAttendee.count({ where: { booking: { classId: cls.id, status: 'UPCOMING' } } }),
        ]);
        if (bookingCount + attendeeCount + 1 > cls.capacity) {
          throw new ConflictException('This Class filled up again before the claim completed — please try the next opening.');
        }
      }

      const sourceMembership = await this.selectAndConsumeMembership(tx, callerId, cls.schoolId, cls.id);

      const bookingId = randomUUID();
      try {
        await tx.booking.create({
          data: {
            id: bookingId,
            studentId: callerId,
            classId: cls.id,
            schoolId: cls.schoolId,
            branchId: cls.branchId,
            sourceMembershipId: sourceMembership.id,
          },
        });
      } catch (err) {
        if (this.isUniqueConstraintViolation(err)) {
          throw new ConflictException('This Student already has an active Booking for this Class.');
        }
        throw err;
      }

      const result = await tx.waitlistEntry.updateMany({
        where: { id: entryId, status: 'NOTIFIED' },
        data: { status: 'CLAIMED', claimedBookingId: bookingId },
      });
      if (result.count === 0) {
        // Lost a race (e.g. the claim-expiry sweep fired in between) — the Booking
        // above already committed as part of this same transaction, so roll the
        // whole thing back rather than leaving an orphaned Booking with no
        // corresponding Claimed WaitlistEntry.
        throw new ConflictException('This Waitlist entry expired concurrently — please retry.');
      }

      return tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { attendees: true } });
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers — deliberately duplicated from BookingsService rather than
  // shared, given the two services' otherwise-different transaction shapes; see the
  // Phase 11 kickoff prompt for the reasoning each one implements (rank-gate
  // bridging inference, Decision 90; Membership spend-order, SKILL.md §10).
  // ---------------------------------------------------------------------------

  private async assertRankEligible(
    tx: TenantTx,
    studentId: string,
    cls: { schoolId: string; activities: string[] },
  ): Promise<void> {
    if (cls.activities.length === 0) return;

    const disciplines = await tx.discipline.findMany({ where: { schoolId: cls.schoolId, name: { in: cls.activities } } });
    if (disciplines.length === 0) return;

    const cumulativeEligible = new Set<string>();
    for (const discipline of disciplines) {
      const studentRank = await tx.studentRank.findUnique({
        where: { studentId_disciplineId: { studentId, disciplineId: discipline.id } },
        include: { currentRank: true, currentStripe: true },
      });
      if (!studentRank) {
        throw new ForbiddenException(`This Student has no Rank in the "${discipline.name}" Discipline required for this Class.`);
      }

      const tiers = await tx.rankStripeTier.findMany({
        where: { rank: { disciplineId: discipline.id } },
        include: { rank: true },
      });
      for (const tier of tiers) {
        const passedLowerRank = tier.rank.order < studentRank.currentRank.order;
        const passedCurrentRankTier =
          tier.rank.order === studentRank.currentRank.order &&
          studentRank.currentStripe !== null &&
          tier.order <= studentRank.currentStripe.order;
        if (passedLowerRank || passedCurrentRankTier) {
          tier.eligibleClassTypes.forEach((t) => cumulativeEligible.add(t));
        }
      }
    }

    const uncovered = cls.activities.filter((a) => !cumulativeEligible.has(a));
    if (uncovered.length > 0) {
      throw new ForbiddenException(`This Student's current Rank does not permit booking a Class with activities: ${uncovered.join(', ')}.`);
    }
  }

  private async selectAndConsumeMembership(
    tx: TenantTx,
    studentId: string,
    schoolId: string,
    classId: string,
  ): Promise<{ id: string }> {
    const candidates = await tx.membership.findMany({
      where: { studentId, schoolId, status: 'ACTIVE', OR: [{ scopedClassId: null }, { scopedClassId: classId }] },
    });
    const generalAccess = candidates.find((m) => m.classesRemaining === null);
    if (generalAccess) return generalAccess;

    const classPack = candidates.find((m) => m.classesRemaining !== null && m.classesRemaining > 0);
    if (!classPack) {
      throw new BadRequestException('This Student has no Active Membership eligible to fund this Booking.');
    }
    const result = await tx.membership.updateMany({
      where: { id: classPack.id, classesRemaining: { gt: 0 } },
      data: { classesRemaining: { decrement: 1 } },
    });
    if (result.count === 0) {
      throw new ConflictException('This Membership\'s remaining credit changed concurrently — please retry.');
    }
    return classPack;
  }

  private isUniqueConstraintViolation(err: unknown): boolean {
    return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002');
  }
}
