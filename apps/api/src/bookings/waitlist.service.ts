import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { GuardiansService } from '../guardians/guardians.service';
import { JoinWaitlistDto } from './dto/join-waitlist.dto';
import { ClaimWaitlistDto } from './dto/claim-waitlist.dto';
import { WithdrawWaitlistQueryDto } from './dto/withdraw-waitlist-query.dto';

type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Phase 11 scope: join/withdraw/claim. See BookingsService's own header comment
 * for the module-wide scope boundary and RLS shape (Decision 89) — WaitlistEntry
 * uses the identical asymmetric narrow-plus-broad structure.
 *
 * Originally self-only for join/claim — unlike BookClassDto, nothing in SKILL.md
 * §10 confirmed a Staff-on-behalf-of shape for the waitlist specifically, and
 * claiming immediately spends a Membership credit, a materially bigger inference
 * than booking creation's override already was at the time. Phase 42 (Decision
 * 103, resolved directly with the user) extended join/claim to BOTH Staff and
 * Guardian on-behalf-of — join carries no credit-consumption risk (same as
 * withdraw, already Staff-enabled before this phase), and claim's risk is the
 * identical profile Guardian-on-behalf-of Booking creation (Phase 40) already
 * ships. Every write below follows the same target-tenant-context substitution
 * used four times already this session (Phase 37-41) — no new mechanism.
 */
@Injectable()
export class WaitlistService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly guardiansService: GuardiansService,
  ) {}

  /**
   * POST /classes/{id}/waitlist. Phase 42 (Decision 103) on-behalf-of shape — same
   * caller-context-first-then-target-context-retry pattern BookingsService.
   * bookClass() (Phase 40) already established for Class visibility: a Guardian
   * caller holds zero RoleGrant anywhere (Decision 92), so their own context
   * never sees the Class directly; only the retry under the target Student's own
   * context does.
   */
  async joinWaitlist(callerId: string, classId: string, dto?: JoinWaitlistDto) {
    const studentId = dto?.studentId ?? callerId;
    const isOnBehalfOf = dto?.studentId !== undefined && dto.studentId !== callerId;

    let cls = await this.prismaApp.withTenantContext(callerId, (tx) => tx.class.findUnique({ where: { id: classId } }));
    let isGuardianAction = false;
    if (!cls && isOnBehalfOf) {
      cls = await this.prismaApp.withTenantContext(studentId, (tx) => tx.class.findUnique({ where: { id: classId } }));
      isGuardianAction = cls !== null;
    }
    if (!cls) {
      throw new NotFoundException('Class not found');
    }
    // Hoisted to a local const — same closure-narrowing fix bookClass()'s own
    // resolvedClass already applies.
    const resolvedClass = cls;

    if (isGuardianAction) {
      await this.guardiansService.assertGuardianOfStudent(callerId, studentId);
    } else if (isOnBehalfOf) {
      await this.tenantAuth.assertStaffAtSchool(callerId, resolvedClass.schoolId);
    }

    return this.prismaApp.withTenantContext(studentId, async (tx) => {
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
            studentId,
            classId,
            schoolId: resolvedClass.schoolId,
            branchId: resolvedClass.branchId,
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

  /**
   * DELETE /waitlist/{id} — the Student withdrawing themselves, Staff on their
   * behalf (unchanged since Phase 11 — a pure status change, no credit
   * implication), or — as of Phase 42 (Decision 103) — a Guardian withdrawing a
   * linked minor's own entry. The initial lookup runs under the caller's own
   * context first, unchanged for self/Staff (both already have RLS visibility
   * via WaitlistEntry's narrow self-branch or its broad Staff-read policy). Only
   * when that finds nothing does `query.studentId` (a Guardian retry hint, same
   * shape CancelBookingDto already established) trigger a retry under that
   * Student's own context — see WithdrawWaitlistQueryDto's own comment for why
   * this is a query param, not a body, unlike every other on-behalf-of consumer.
   */
  async withdraw(callerId: string, entryId: string, query?: WithdrawWaitlistQueryDto): Promise<void> {
    let existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.waitlistEntry.findUnique({ where: { id: entryId } }));
    let isGuardianAction = false;
    if (!existing && query?.studentId !== undefined && query.studentId !== callerId) {
      existing = await this.prismaApp.withTenantContext(query.studentId, (tx) => tx.waitlistEntry.findUnique({ where: { id: entryId } }));
      isGuardianAction = existing !== null;
    }
    if (!existing) {
      throw new NotFoundException('Waitlist entry not found');
    }
    const resolvedEntry = existing;

    if (isGuardianAction) {
      await this.guardiansService.assertGuardianOfStudent(callerId, resolvedEntry.studentId);
    } else if (resolvedEntry.studentId !== callerId) {
      await this.tenantAuth.assertStaffAtSchool(callerId, resolvedEntry.schoolId);
    }

    await this.prismaApp.withTenantContext(resolvedEntry.studentId, async (tx) => {
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
   * POST /waitlist/{id}/claim. Only a NOTIFIED entry, still within its own
   * claimByDeadline, may be claimed. Kickoff prompt §1.d's own resolved
   * inference: RE-CHECKS rank-eligibility and remaining capacity at claim time
   * (state may have changed since joining), not a carried-over decision from
   * join time.
   *
   * Originally hard self-only — Phase 42 (Decision 103) extended this to Staff
   * and Guardian on-behalf-of, the exact same shape and reasoning as
   * BookingsService.cancelBooking() (Phase 41): the initial lookup runs under
   * the caller's own context first (unchanged for self and any Staff role, both
   * already covered by WaitlistEntry's own RLS), and only a Guardian's
   * `dto.studentId` hint (ClaimWaitlistDto) triggers a retry under the target
   * Student's own context when that first lookup finds nothing. The
   * authorization check afterward always keys off the entry's own REAL
   * studentId once found, never the client-supplied hint directly.
   */
  async claim(callerId: string, entryId: string, dto?: ClaimWaitlistDto) {
    let existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.waitlistEntry.findUnique({ where: { id: entryId } }));
    let isGuardianAction = false;
    if (!existing && dto?.studentId !== undefined && dto.studentId !== callerId) {
      existing = await this.prismaApp.withTenantContext(dto.studentId, (tx) => tx.waitlistEntry.findUnique({ where: { id: entryId } }));
      isGuardianAction = existing !== null;
    }
    if (!existing) {
      throw new NotFoundException('Waitlist entry not found');
    }
    const resolvedEntry = existing;

    if (isGuardianAction) {
      await this.guardiansService.assertGuardianOfStudent(callerId, resolvedEntry.studentId);
    } else if (resolvedEntry.studentId !== callerId) {
      await this.tenantAuth.assertStaffAtSchool(callerId, resolvedEntry.schoolId);
    }
    if (resolvedEntry.status !== 'NOTIFIED') {
      throw new BadRequestException('This Waitlist entry is not currently Notified — nothing to claim.');
    }
    if (resolvedEntry.claimByDeadline && resolvedEntry.claimByDeadline < new Date()) {
      throw new ConflictException('This Waitlist entry\'s claim window has passed.');
    }

    return this.prismaApp.withTenantContext(resolvedEntry.studentId, async (tx) => {
      const cls = await tx.class.findUniqueOrThrow({ where: { id: resolvedEntry.classId } });
      const studentId = resolvedEntry.studentId;

      if (cls.termsWaiverRequired) {
        const signed = await tx.waiverSignature.findFirst({
          where: { studentId, schoolId: cls.schoolId, status: 'SIGNED' },
          select: { id: true },
        });
        if (!signed) {
          throw new BadRequestException('This Student must hold a Signed Waiver for this School before claiming this Booking.');
        }
      }

      await this.assertRankEligible(tx, studentId, cls);

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

      const sourceMembership = await this.selectAndConsumeMembership(tx, studentId, cls.schoolId, cls.id);

      const bookingId = randomUUID();
      try {
        await tx.booking.create({
          data: {
            id: bookingId,
            studentId,
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

  /**
   * GET /classes/{id}/waitlist — School Owner/Manager, Branch Staff, or Instructor.
   * FOUND ON REVIEW (Phase 22, mirroring BookingsService.findAllForClass()'s own
   * identical finding): never existed before, despite this phase's own
   * `waitlist_entry_staff_read` RLS policy already anticipating exactly this read.
   * Unpaginated, matching WaitlistEntryListResponseDto's own shape (no `nextCursor`)
   * — a single Class's own waitlist queue is inherently small/bounded, unlike
   * findMyBookings' own all-time cross-Class list.
   */
  async findAllForClass(callerId: string, classId: string) {
    const cls = await this.prismaApp.withTenantContext(callerId, (tx) => tx.class.findUnique({ where: { id: classId } }));
    if (!cls) {
      throw new NotFoundException('Class not found');
    }
    // FOUND ON REVIEW: passes cls.branchId — same dual-grant defense-in-depth
    // reasoning as BookingsService.findAllForClass()'s own identical call; see
    // that method's own comment for the corrected account of what this
    // actually defends against (CI caught an earlier, inaccurate version).
    await this.tenantAuth.assertStaffAtSchool(callerId, cls.schoolId, cls.branchId);
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.waitlistEntry.findMany({ where: { classId }, orderBy: { position: 'asc' } }),
    );
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
