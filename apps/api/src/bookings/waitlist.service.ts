import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertBookingUnlocked } from '../ranks/booking-unlocks';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { GuardiansService } from '../guardians/guardians.service';
import { SubscriptionGateService } from '../subscription-plans/subscription-gate.service';
import { JoinWaitlistDto } from './dto/join-waitlist.dto';
import { ClaimWaitlistDto } from './dto/claim-waitlist.dto';
import { WithdrawWaitlistQueryDto } from './dto/withdraw-waitlist-query.dto';
import { assertClassBookable, assertNotAlreadyAttended, lockClassSeats, lockClassShared, lockStudentClass, selectAndConsumeMembership, withSeatLockRetry, BOOKING_TX_OPTIONS, LockedClass } from './booking-gates';
import { hasCountingWaiverSignature } from '../waivers/waiver-signed-check';
import { lockSchoolOpen } from '../tenants/lock-school-open';

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
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly guardiansService: GuardiansService,
    private readonly subscriptionGate: SubscriptionGateService,
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
    // Decision 291 — the School cancelled this class.
    if (resolvedClass.cancelledAt) {
      throw new ConflictException('This class has been cancelled by the school.');
    }

    if (isGuardianAction) {
      await this.guardiansService.assertGuardianOfStudent(callerId, studentId);
    } else if (isOnBehalfOf) {
      await this.tenantAuth.assertStaffAtSchool(callerId, resolvedClass.schoolId);
    }
    assertClassBookable(resolvedClass, { byStaff: isOnBehalfOf && !isGuardianAction });
    // Decision 110: a closed School takes no new waitlist places (Classes review C16).
    await this.tenantAuth.assertSchoolNotArchived(studentId, resolvedClass.schoolId);

    return withSeatLockRetry(() => this.prismaApp.withTenantContext(studentId, async (tx) => {
      // First, before any row lock (see lockStudentClass): a Student who has
      // already attended this Class can't queue for it again.
      await lockStudentClass(tx, studentId, classId);
      await lockSchoolOpen(tx, resolvedClass.schoolId);
      await assertNotAlreadyAttended(tx, studentId, classId);
      // FOUND ON REVIEW: reading the current max position then computing +1 is a
      // TOCTOU race — two Students joining the same Class's waitlist concurrently
      // can both read the same highest position and collide, breaking the FCFS
      // ordering the cascade job relies on (no unique constraint exists on
      // (classId, position) since positions are meant to keep advancing, not be
      // reused). Same explicit-row-lock fix as the capacity check in
      // BookingsService.bookClass — see that method's own comment for why this
      // codebase's usual updateMany+count-guard pattern doesn't apply to an
      // aggregate read like this one.
      const locked = await lockClassSeats(tx, classId);
      // Only a full Class, or one others are already queued for, takes a waitlist
      // entry, and never from a Student already booked into it (stress test, 26 Oct
      // 2026: both were accepted).
      const alreadyBooked = await tx.booking.findFirst({ where: { classId, studentId, status: 'UPCOMING' }, select: { id: true } });
      if (alreadyBooked) {
        throw new ConflictException('This Student is already booked into this Class.');
      }
      if (resolvedClass.capacity === null) {
        throw new ConflictException('This Class has no seat limit. Book it instead.');
      }
      // Waivers review W15: the claim step needs a signed Waiver, so a
      // student without one would hold an offered seat they can never take.
      if (resolvedClass.termsWaiverRequired) {
        if (!(await hasCountingWaiverSignature(tx, studentId, resolvedClass.schoolId))) {
          throw new BadRequestException('This Student must hold a Signed Waiver for this School before joining the waitlist for this Class.');
        }
      }
      const [booked, guests, queued] = await Promise.all([
        this.prismaJobs.booking.count({ where: { classId, status: 'UPCOMING' } }),
        this.prismaJobs.bookingAttendee.count({ where: { booking: { classId, status: 'UPCOMING' } } }),
        this.prismaJobs.waitlistEntry.count({ where: { classId, status: { in: ['WAITING', 'NOTIFIED'] } } }),
      ]);
      if (queued === 0 && booked + guests < resolvedClass.capacity) {
        throw new ConflictException('This Class still has space. Book it instead.');
      }
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
            branchId: locked ? locked.branchId : resolvedClass.branchId,
            position,
          },
        });
      } catch (err) {
        if (this.isUniqueConstraintViolation(err)) {
          throw new ConflictException('This Student already has an active Waitlist entry for this Class.');
        }
        throw err;
      }
    }, BOOKING_TX_OPTIONS));
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
    // Spec 55 §10.2's confirmed read-only degraded-portal state ("no new Classes/
    // Bookings/payments") — a claim creates a real Booking below
    // (`tx.booking.create`), not through BookingsService, so it needs this same
    // check BookingsService.bookClass() makes rather than inheriting it. Checked
    // under the entry's own `studentId`, not `callerId` — same "a Guardian caller
    // holds zero RoleGrant anywhere, Decision 92" reasoning
    // BookingsService.bookClass()'s own identical check already documents.
    await this.subscriptionGate.assertNotDegraded(resolvedEntry.studentId, resolvedEntry.schoolId);
    // Decision 110: a closed School takes no new Bookings (Classes review C16).
    await this.tenantAuth.assertSchoolNotArchived(resolvedEntry.studentId, resolvedEntry.schoolId);

    return withSeatLockRetry(() => this.prismaApp.withTenantContext(resolvedEntry.studentId, async (tx) => {
      const studentId = resolvedEntry.studentId;
      // First, before any row lock (see lockStudentClass).
      await lockStudentClass(tx, studentId, resolvedEntry.classId);
      await lockSchoolOpen(tx, resolvedEntry.schoolId);
      await assertNotAlreadyAttended(tx, studentId, resolvedEntry.classId);
      const cls = await tx.class.findUniqueOrThrow({ where: { id: resolvedEntry.classId } });
      if (cls.cancelledAt) {
        throw new ConflictException('This class has been cancelled by the school.');
      }
      // A claim was offered by the waitlist, so the booking cut-off doesn't apply;
      // an archived or ended Class still can't be claimed into.
      assertClassBookable(cls, { byStaff: true });

      if (cls.termsWaiverRequired) {
        if (!(await hasCountingWaiverSignature(tx, studentId, cls.schoolId))) {
          throw new BadRequestException('This Student must hold a Signed Waiver for this School before claiming this Booking.');
        }
      }

      await this.assertRankEligible(tx, studentId, cls);

      let locked: LockedClass;
      if (cls.capacity !== null) {
        // Same explicit-row-lock fix as BookingsService.bookClass's own capacity
        // check — see that comment for the full reasoning.
        locked = await lockClassSeats(tx, cls.id);
        // Same PrismaJobsService fix as BookingsService.countOccupiedSeats — `tx`
        // (the claiming Student's own tenant context) can never see another
        // Student's Booking/BookingAttendee rows under Decision 89's RLS shape.
        // Held seats keep direct bookers out (BookingsService.bookClass), not other
        // notified Students: among those, the first to claim gets the seat. Counting
        // other holds here could leave a seat nobody may claim when the cascade has
        // offered it twice.
        const [bookingCount, attendeeCount] = await Promise.all([
          this.prismaJobs.booking.count({ where: { classId: cls.id, status: 'UPCOMING' } }),
          this.prismaJobs.bookingAttendee.count({ where: { booking: { classId: cls.id, status: 'UPCOMING' } } }),
        ]);
        if (bookingCount + attendeeCount + 1 > cls.capacity) {
          throw new ConflictException('This Class filled up again before the claim completed — please try the next opening.');
        }
      } else {
        // Re-checks the Class under a lock a whole-class cancel waits for (see
        // BookingsService.bookClass).
        locked = await lockClassShared(tx, cls.id);
      }

      const sourceMembership = await selectAndConsumeMembership(tx, studentId, cls.schoolId, cls);

      const bookingId = randomUUID();
      try {
        await tx.booking.create({
          data: {
            id: bookingId,
            studentId,
            classId: cls.id,
            schoolId: cls.schoolId,
            branchId: locked ? locked.branchId : cls.branchId,
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
    }, BOOKING_TX_OPTIONS));
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
    const entries = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.waitlistEntry.findMany({ where: { classId }, orderBy: { position: 'asc' } }),
    );
    // Resolved via PrismaAuthService (Decision 117) — see BookingsService.
    // findAllForClass's identical comment for why an `include` here isn't safe.
    const names = await resolveUserNames(this.prismaAuth, entries.map((e) => e.studentId));
    return entries.map((e) => ({
      ...e,
      studentFirstName: names.get(e.studentId)?.firstName ?? '',
      studentSurname: names.get(e.studentId)?.surname ?? '',
    }));
  }

  // ---------------------------------------------------------------------------
  // Private helpers — deliberately duplicated from BookingsService rather than
  // shared, given the two services' otherwise-different transaction shapes; see the
  // Phase 11 kickoff prompt for the reasoning each one implements (Membership
  // spend-order, SKILL.md §10). The rank gate itself is shared (Decision 173).
  // ---------------------------------------------------------------------------

  // Same booking rank gate as BookingsService (Decision 173).
  private async assertRankEligible(tx: TenantTx, studentId: string, cls: { styles: Prisma.JsonValue }): Promise<void> {
    await assertBookingUnlocked(tx, studentId, cls);
  }

  private isUniqueConstraintViolation(err: unknown): boolean {
    return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002');
  }
}
