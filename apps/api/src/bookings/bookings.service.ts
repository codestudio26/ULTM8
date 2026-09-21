import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { GuardiansService } from '../guardians/guardians.service';
import { SubscriptionGateService } from '../subscription-plans/subscription-gate.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { WAITLIST_CASCADE_PROCESSING_QUEUE } from '../jobs/queue.constants';
import { BookClassDto } from './dto/book-class.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { UpdateBookingOverrideDto } from './dto/update-booking-override.dto';

// Same shape PrismaAppService#withTenantContext hands its callback.
type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Phase 11 scope: single-Class booking creation/cancellation + the rank-gate
 * override amendment. Waitlist join/withdraw/claim live in WaitlistService — see that
 * file's own header comment. QR check-in/Attendance (Phase "12") and
 * NotificationsModule are both explicitly out of scope — see the Phase 11 kickoff
 * prompt §3. Phase 40 added Guardian-on-behalf-of booking CREATION; Phase 41 added
 * Guardian-on-behalf-of CANCELLATION (see cancelBooking()'s own comment for why it
 * needed a genuinely different mechanism — a new DTO field, not the pre-existing
 * BookClassDto.studentId — even though both ultimately reuse the same target-
 * tenant-context substitution). updateOverrideReason() remains Staff-only — amending
 * a rank-gate override's justification text is Instructor/Staff-exclusive by the
 * same SKILL.md §9 reasoning bookClass() itself already applies to the override
 * REASON field, so there is no Guardian case to build there at all, not a deferred
 * one. Guardian-on-behalf-of Waitlist join/claim remains its own, separately-
 * flagged follow-on — see WaitlistService's own header comment for why.
 *
 * RLS shape for Booking/BookingAttendee: the narrow "School Owner/Manager, or the
 * row's own Student, nobody else" shape (Decision 89), PLUS a second, additive,
 * SELECT-only broad Staff-read policy this phase newly introduces (kickoff prompt §4
 * point 2, migration's own comment) — every WRITE method below that acts on behalf of
 * a Staff caller (not the Student themselves) still goes through
 * TenantAuthorizationService.assertStaffAtSchool() + running the actual write under
 * the TARGET Student's own tenant context, the same mechanism established in Phase
 * 9/10b — the broad policy only ever serves reads.
 */
@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly guardiansService: GuardiansService,
    private readonly subscriptionGate: SubscriptionGateService,
    @InjectQueue(WAITLIST_CASCADE_PROCESSING_QUEUE) private readonly waitlistCascadeQueue: Queue,
  ) {}

  /**
   * POST /classes/{id}/book. See BookClassDto's own comment for the override/
   * on-behalf-of shape. Gate order matches the Phase 11 kickoff prompt §1.b exactly:
   * waiver -> rank -> capacity, then Membership-credit selection, then the actual
   * create.
   *
   * Phase 40 added Guardian-on-behalf-of booking, the small follow-on Phase 37/38/39
   * flagged as the true remaining prerequisite chain finally clears —
   * selectAndConsumeMembership() below already keys purely off `studentId`, so it
   * needed zero changes once a Guardian-managed minor could actually hold a
   * Membership to spend (Phase 39).
   *
   * `cls` is looked up under the CALLER's own context first, same as before — this
   * still succeeds unchanged for both ordinary self-booking and Staff-on-behalf-of,
   * since both hold a RoleGrant at the School (Class's RLS requires one, any role).
   * Only a Guardian caller (zero RoleGrant anywhere — Decision 92) fails that first
   * lookup; the retry under the TARGET Student's own context is what a Staff caller
   * already effectively relies on the target being enrolled for anyway, so this
   * changes no existing behavior, only adds a fallback for the genuinely new case.
   */
  async bookClass(callerId: string, classId: string, dto: BookClassDto) {
    const studentId = dto.studentId ?? callerId;
    const isOnBehalfOf = dto.studentId !== undefined && dto.studentId !== callerId;

    let cls = await this.prismaApp.withTenantContext(callerId, (tx) => tx.class.findUnique({ where: { id: classId } }));
    let isGuardianAction = false;
    if (!cls && isOnBehalfOf) {
      cls = await this.prismaApp.withTenantContext(studentId, (tx) => tx.class.findUnique({ where: { id: classId } }));
      isGuardianAction = cls !== null;
    }
    if (!cls) {
      throw new NotFoundException('Class not found');
    }
    // Hoisted to a local const — `cls` above is `let` (conditionally reassigned
    // by the Guardian-retry branch), and TS narrowing from the guard above
    // doesn't persist into the withTenantContext(...) closure below for a
    // mutable binding, the same "narrowing doesn't cross a closure boundary
    // for `let`" limitation MembershipsService.updatePlan() already found and
    // worked around the same way (see its own comment on scopedClassIdToValidate).
    const resolvedClass = cls;

    // FOUND ON REVIEW (Phase 11): `dto.studentId !== undefined` alone would wrongly
    // flag an ordinary self-booking as a Staff action whenever a client happens to
    // include its own caller id in the field (harmless but avoidably 403s a real
    // Student) — only naming someone ELSE, or supplying an overrideReason, is
    // actually a Staff action. `isGuardianAction` above already excludes the ordinary
    // self-booking case (it's only ever set true when isOnBehalfOf is also true).
    const isStaffAction = !isGuardianAction && (isOnBehalfOf || dto.overrideReason !== undefined);
    if (isGuardianAction) {
      // A Guardian may never also override — SKILL.md §9 reserves that to
      // Instructor/Staff specifically, and Guardian is further still from Staff.
      if (dto.overrideReason !== undefined) {
        throw new ForbiddenException('A Guardian may not supply overrideReason — only Instructor/Staff may override the rank-eligibility gate.');
      }
      await this.guardiansService.assertGuardianOfStudent(callerId, studentId);
    } else if (isStaffAction) {
      // A Student may never self-override or book on someone else's behalf — SKILL.md
      // §9: "An Instructor/Staff member can override", never the Student themselves.
      await this.tenantAuth.assertStaffAtSchool(callerId, resolvedClass.schoolId);
    }
    // Spec 55 §10.2's confirmed read-only degraded-portal state — "no new
    // Bookings" is one of the three actions it explicitly names (Phase 54).
    // Checked under `studentId`'s own RLS context, NOT `callerId`'s — a Guardian
    // caller holds zero RoleGrant anywhere (Decision 92), so `callerId`'s own
    // context would see nothing and silently no-op the check for exactly the
    // on-behalf-of path that most needs it; `studentId` is guaranteed
    // RLS-visible into this School the same way the actual Booking create()
    // below already relies on (it also runs under `studentId`'s context).
    await this.subscriptionGate.assertNotDegraded(studentId, resolvedClass.schoolId);

    return this.prismaApp.withTenantContext(studentId, async (tx) => {
      if (resolvedClass.termsWaiverRequired) {
        const signed = await tx.waiverSignature.findFirst({
          where: { studentId, schoolId: resolvedClass.schoolId, status: 'SIGNED' },
          select: { id: true },
        });
        if (!signed) {
          throw new BadRequestException('This Student must hold a Signed Waiver for this School before booking a Class that requires one.');
        }
      }

      if (!dto.overrideReason) {
        await this.assertRankEligible(tx, studentId, resolvedClass);
      }

      const attendeeMembershipIds = dto.attendeeMembershipIds ?? [];
      const partySize = 1 + attendeeMembershipIds.length;
      if (resolvedClass.capacity !== null) {
        // FOUND ON REVIEW: a plain count()-then-compare here is a genuine TOCTOU
        // race — two concurrent bookClass() calls for the same Class can both read
        // the same pre-booking occupancy, both pass the capacity check, and both
        // commit, overbooking the Class. Unlike a scalar-field race (Membership
        // credit, Booking status), capacity is an aggregate COUNT across two child
        // tables (Booking + BookingAttendee), which the established
        // updateMany+count-guard pattern can't express directly — so this takes an
        // explicit row lock on the Class itself for the duration of the
        // count-then-create, serializing concurrent bookers for THIS Class only
        // (other Classes are entirely unaffected). First use of an explicit lock in
        // this codebase; flagged here rather than silently introduced.
        await tx.$queryRaw`SELECT id FROM "Class" WHERE id = ${classId} FOR UPDATE`;
        const occupied = await this.countOccupiedSeats(classId);
        if (occupied + partySize > resolvedClass.capacity) {
          throw new ConflictException(
            'This Class is full for the requested party size — join the waitlist instead (POST /classes/{id}/waitlist).',
          );
        }
      }

      const sourceMembership = await this.selectAndConsumeMembership(tx, studentId, resolvedClass.schoolId, classId);

      const bookingId = randomUUID();
      try {
        await tx.booking.create({
          data: {
            id: bookingId,
            studentId,
            classId,
            schoolId: resolvedClass.schoolId,
            branchId: resolvedClass.branchId,
            sourceMembershipId: sourceMembership.id,
            overriddenById: dto.overrideReason ? callerId : null,
            overrideReason: dto.overrideReason ?? null,
          },
        });
      } catch (err) {
        if (this.isUniqueConstraintViolation(err)) {
          throw new ConflictException('This Student already has an active Booking for this Class.');
        }
        throw err;
      }

      // Guest attendees — see BookingAttendee's own schema comment for why each
      // membershipId here must belong to the SAME studentId as the Booking (the
      // organizing Student), not a separate guest account: Membership's own narrow
      // RLS policy (studentId = caller) means a genuinely separate guest's Membership
      // row would be invisible under this transaction's tenant context (studentId,
      // the organizer) in the first place — a School-gifted Friend Pass is modeled as
      // a credit the ORGANIZING Student holds and redeems per guest, not a credit
      // living on a separate guest-registered account. Flagged explicitly as a
      // Developer-level interpretation of SKILL.md §10's "their own valid Membership
      // or a School-gifted Friend Pass for that specific guest" — the alternative
      // reading (a guest who is themselves a separately-registered Student spending
      // their OWN Membership) would need a real cross-account consent mechanism
      // nothing in this codebase or spec confirms, so it's deferred, not guessed at.
      for (const membershipId of attendeeMembershipIds) {
        const guestMembership = await this.consumeGuestMembership(tx, membershipId, studentId, resolvedClass.schoolId, classId);
        await tx.bookingAttendee.create({
          data: { id: randomUUID(), bookingId, schoolId: resolvedClass.schoolId, membershipId: guestMembership.id },
        });
      }

      return tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { attendees: true } });
    });
  }

  /**
   * PATCH /bookings/{id}/cancel. Any caller (self, Staff, or — as of Phase 41 — a
   * Guardian cancelling a linked minor's own Booking) may cancel; Staff/Guardian
   * writes run under the target Student's own tenant context, same established
   * mechanism.
   *
   * The initial lookup runs under the CALLER's own context first, unchanged for
   * self-booking and Staff (Booking's broad `booking_staff_read` policy already lets
   * any Staff role see the row directly, so a Staff caller never needed to name the
   * Student up front). Only when that first lookup finds nothing does a Guardian's
   * `dto.studentId` hint (CancelBookingDto's own comment) get a retry under that
   * Student's own context — the same fallback shape bookClass() already established
   * for Class visibility, applied here to Booking visibility instead. The actual
   * authorization check afterward is always keyed off the row's own REAL
   * `studentId` (whichever context actually found it), never trusted from
   * `dto.studentId` directly.
   */
  async cancelBooking(callerId: string, bookingId: string, dto?: CancelBookingDto) {
    let existing = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.booking.findUnique({ where: { id: bookingId }, include: { attendees: true } }),
    );
    let isGuardianAction = false;
    if (!existing && dto?.studentId !== undefined && dto.studentId !== callerId) {
      existing = await this.prismaApp.withTenantContext(dto.studentId, (tx) =>
        tx.booking.findUnique({ where: { id: bookingId }, include: { attendees: true } }),
      );
      isGuardianAction = existing !== null;
    }
    if (!existing) {
      throw new NotFoundException('Booking not found');
    }
    // Hoisted to a local const — same "narrowing doesn't cross a closure boundary
    // for a `let`" fix bookClass() already applies to its own `cls`/`resolvedClass`.
    const resolvedBooking = existing;

    if (isGuardianAction) {
      await this.guardiansService.assertGuardianOfStudent(callerId, resolvedBooking.studentId);
    } else if (resolvedBooking.studentId !== callerId) {
      await this.tenantAuth.assertStaffAtSchool(callerId, resolvedBooking.schoolId);
    }

    const booking = await this.prismaApp.withTenantContext(resolvedBooking.studentId, async (tx) => {
      const cls = await tx.class.findUniqueOrThrow({ where: { id: resolvedBooking.classId } });
      const now = new Date();
      // Kickoff prompt §1.c: refunds/credits back before the Class's own
      // refundFeeDate cutoff; withholds on/after it. No cutoff configured (null)
      // means never past it — always refunded.
      const pastCutoff = cls.refundFeeDate !== null && now >= cls.refundFeeDate;
      const resolution: 'REFUNDED' | 'WITHHELD' = pastCutoff ? 'WITHHELD' : 'REFUNDED';

      // Optimistic-concurrency guard, same shape as every other status-transition in
      // this codebase (Phase 9/10b) — if the Booking already left UPCOMING (a
      // concurrent cancel, or the no-show sweep won the race), this is a clean 409
      // instead of double-resolving credit.
      const result = await tx.booking.updateMany({
        where: { id: bookingId, status: 'UPCOMING' },
        data: { status: 'CANCELLED', refundResolution: resolution, resolvedById: callerId },
      });
      if (result.count === 0) {
        throw new ConflictException('This Booking is no longer Upcoming — it may already be Cancelled, Completed, or marked No-Show.');
      }

      if (resolution === 'REFUNDED') {
        await this.restoreCredit(tx, resolvedBooking.sourceMembershipId);
      }
      for (const attendee of resolvedBooking.attendees) {
        await tx.bookingAttendee.update({
          where: { id: attendee.id },
          data: { refundResolution: resolution, resolvedById: callerId },
        });
        if (resolution === 'REFUNDED') {
          await this.restoreCredit(tx, attendee.membershipId);
        }
      }

      return tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { attendees: true } });
    });

    // Enqueued OUTSIDE the DB transaction, fire-and-logged rather than failing the
    // caller — same precedent WaiversService.createWaiver() established for its own
    // post-commit enqueue (a Redis hiccup must never roll back an already-successful
    // Cancellation).
    try {
      await this.waitlistCascadeQueue.add('seat-freed', { classId: booking.classId });
    } catch (err) {
      this.logger.warn(`Failed to enqueue waitlist-cascade-processing after cancelling Booking ${booking.id}: ${err}`);
    }

    return booking;
  }

  /** PATCH /bookings/{id}/override. See UpdateBookingOverrideDto's own comment for
   * why this is scoped to amending an existing override's justification text, not
   * creating a fresh override (which happens via BookClassDto.overrideReason at
   * creation time instead). */
  async updateOverrideReason(callerId: string, bookingId: string, dto: UpdateBookingOverrideDto) {
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) => tx.booking.findUnique({ where: { id: bookingId } }));
    if (!existing) {
      throw new NotFoundException('Booking not found');
    }
    await this.tenantAuth.assertStaffAtSchool(callerId, existing.schoolId);
    if (!existing.overriddenById) {
      throw new BadRequestException('This Booking was not created via a rank-gate override — there is no override justification to amend.');
    }

    return this.prismaApp.withTenantContext(existing.studentId, (tx) =>
      tx.booking.update({ where: { id: bookingId }, data: { overrideReason: dto.overrideReason }, include: { attendees: true } }),
    );
  }

  /** GET /bookings/me. */
  async findMyBookings(callerId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate(
        (args) => tx.booking.findMany({ ...args, where: { studentId: callerId }, include: { attendees: true } }),
        cursor,
        limit,
      ),
    );
  }

  /**
   * GET /classes/{id}/bookings — School Owner/Manager, Branch Staff, or Instructor
   * (School Portal's own "who's booked into this Class" view). FOUND ON REVIEW
   * (Phase 22, school-portal's own Booking admin screen): this endpoint never
   * existed anywhere before, despite this phase's own `booking_staff_read` RLS
   * policy (this migration's own header comment, §4 point 2) having been laid down
   * specifically to support exactly this — a broad, SELECT-only Staff read,
   * additive to Booking's own narrow owner-or-self policy. Completing that
   * already-anticipated groundwork, not inventing new authorization shape.
   */
  async findAllForClass(callerId: string, classId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    const cls = await this.prismaApp.withTenantContext(callerId, (tx) => tx.class.findUnique({ where: { id: classId } }));
    if (!cls) {
      throw new NotFoundException('Class not found');
    }
    // FOUND ON REVIEW: passes cls.branchId for defense-in-depth against a
    // caller holding MULTIPLE RoleGrants at this School whose mismatched-Branch
    // Staff grant would otherwise wrongly authorize them once some other grant
    // of theirs has already let the Class row itself pass class_tenant_isolation
    // (see assertStaffAtSchool's own comment — its header documents a case CI
    // caught where this comment previously overstated what the check does: the
    // common single-grant wrong-Branch case is already a 404 via RLS alone,
    // before this line is ever reached).
    await this.tenantAuth.assertStaffAtSchool(callerId, cls.schoolId, cls.branchId);
    const page = await this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate(
        (args) => tx.booking.findMany({ ...args, where: { classId }, include: { attendees: true } }),
        cursor,
        limit,
      ),
    );
    // Resolved via PrismaAuthService (Decision 113), not a Prisma `include` on
    // Booking.student — an RLS-scoped include can silently fail to resolve the
    // Student's own User row once their RoleGrant is revoked (e.g.
    // GuardiansService.withdrawConsent's BASELINE cascade), even though this
    // caller is fully authorized to see the Booking row itself. See
    // resolveUserNames's own header comment.
    const names = await resolveUserNames(this.prismaAuth, page.items.map((b) => b.studentId));
    return {
      ...page,
      items: page.items.map((b) => ({
        ...b,
        // Falls back to '' only if the id genuinely doesn't resolve — not expected
        // in practice (User rows are never hard-deleted in this codebase today),
        // kept as defense-in-depth rather than a non-null assertion.
        studentFirstName: names.get(b.studentId)?.firstName ?? '',
        studentSurname: names.get(b.studentId)?.surname ?? '',
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Rank gate (SKILL.md §9, quoted): "a Rank/stripe tier's eligibleClassTypes...
   * governs which class types a Student may book, cumulative by ladder order."
   *
   * BRIDGING INFERENCE, not §9-confirmed — flagged prominently, recorded as Decision
   * 90 (docs/decisions/POST-SPEC-55-DECISION-LOG.md): SKILL.md §4 itself flags that
   * `Class.activities` and `Discipline` are "not formally reconciled into one
   * controlled list." This method bridges them the only implementable way available
   * without inventing a new reconciliation table: matching a Class's `activities`
   * strings against `Discipline.name` at the same School. A Class whose activities
   * don't match any Discipline has nothing to gate against and is silently allowed
   * through (not a confirmed exemption — simply nothing to check). This means the
   * rank gate is NOT reliably enforced for every Class, only for ones whose
   * activities happen to name a real Discipline exactly — flagged for Architect
   * confirmation, not asserted as a complete implementation of §9.
   *
   * "Cumulative by ladder order" is read as: every RankStripeTier belonging to a
   * LOWER-ordered Rank in the same Discipline, PLUS every RankStripeTier at or below
   * the Student's own current stripe-tier order within their CURRENT Rank — i.e. the
   * full sequence of tiers the Student has already progressed through, not just their
   * single current tier in isolation.
   */
  private async assertRankEligible(
    tx: TenantTx,
    studentId: string,
    cls: { id: string; schoolId: string; activities: string[] },
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
        throw new ForbiddenException(
          `This Student has no Rank in the "${discipline.name}" Discipline required for this Class. A Staff member can override this per-Booking.`,
        );
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
      throw new ForbiddenException(
        `This Student's current Rank does not permit booking a Class with activities: ${uncovered.join(', ')}. A Staff member can override this per-Booking.`,
      );
    }
  }

  /** "A Class's Full status counts every attendee across all Bookings... including
   * Friend Pass guests on the attendee list — not raw Booking count" (SKILL.md §9).
   *
   * FOUND ON REVIEW, before this ever shipped: this MUST run via PrismaJobsService
   * (ultm8_jobs), not the caller's own `tx` — Booking/BookingAttendee's own RLS
   * (Decision 89) is narrow-plus-broad-STAFF-ONLY-read, so an ORDINARY STUDENT
   * caller's own tenant context can only ever see THEIR OWN rows under RLS, never
   * another Student's. Counting via `tx` would silently undercount every time (0,
   * always, unless the counting Student happens to already hold the only booking),
   * defeating the Full-Class gate entirely for exactly the caller who most needs it
   * enforced. `ultm8_jobs` bypasses RLS for this one read the same way it already
   * does for the background jobs' own sweeps — this is a genuine, deliberate reuse
   * of that mechanism from an interactive request path, not a background job, since
   * no interactive-path alternative exists that both preserves Student-to-Student
   * row privacy AND lets a Student's own booking attempt see the true occupancy. */
  private async countOccupiedSeats(classId: string): Promise<number> {
    const [bookingCount, attendeeCount] = await Promise.all([
      this.prismaJobs.booking.count({ where: { classId, status: 'UPCOMING' } }),
      this.prismaJobs.bookingAttendee.count({ where: { booking: { classId, status: 'UPCOMING' } } }),
    ]);
    return bookingCount + attendeeCount;
  }

  /** Selects the Student's own funding Membership for their own seat — prefers a
   * non-consuming general-access Membership (classesRemaining IS NULL, i.e.
   * Subscription/Weekly Pass) over a credit-consuming one (Class Pack/Friend Pass/
   * Trial), per SKILL.md §10's confirmed spend-order rule, so a paid credit is never
   * spent unnecessarily. */
  private async selectAndConsumeMembership(
    tx: TenantTx,
    studentId: string,
    schoolId: string,
    classId: string,
  ): Promise<{ id: string }> {
    const candidates = await tx.membership.findMany({
      where: {
        studentId,
        schoolId,
        status: 'ACTIVE',
        OR: [{ scopedClassId: null }, { scopedClassId: classId }],
      },
    });

    const generalAccess = candidates.find((m) => m.classesRemaining === null);
    if (generalAccess) {
      return generalAccess;
    }

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

  /** Guest-seat equivalent of selectAndConsumeMembership above — the caller names a
   * SPECIFIC Membership id rather than letting the server auto-select, since a guest
   * seat is deliberately funded by a distinct Membership from the organizer's own
   * (see bookClass's own comment on why this must belong to the SAME studentId as
   * the organizer). */
  private async consumeGuestMembership(
    tx: TenantTx,
    membershipId: string,
    organizerId: string,
    schoolId: string,
    classId: string,
  ): Promise<{ id: string }> {
    const membership = await tx.membership.findUnique({ where: { id: membershipId } });
    if (!membership || membership.studentId !== organizerId || membership.schoolId !== schoolId || membership.status !== 'ACTIVE') {
      throw new BadRequestException(`attendeeMembershipIds must each reference an Active Membership belonging to the organizing Student at this School (got ${membershipId}).`);
    }
    if (membership.scopedClassId && membership.scopedClassId !== classId) {
      throw new BadRequestException(`Membership ${membershipId} is scoped to a different Class.`);
    }
    if (membership.classesRemaining === null) {
      return membership;
    }
    const result = await tx.membership.updateMany({
      where: { id: membershipId, classesRemaining: { gt: 0 } },
      data: { classesRemaining: { decrement: 1 } },
    });
    if (result.count === 0) {
      throw new ConflictException(`Membership ${membershipId} has no remaining credit.`);
    }
    return membership;
  }

  private async restoreCredit(tx: TenantTx, membershipId: string): Promise<void> {
    const membership = await tx.membership.findUniqueOrThrow({ where: { id: membershipId } });
    if (membership.classesRemaining !== null) {
      await tx.membership.update({ where: { id: membershipId }, data: { classesRemaining: { increment: 1 } } });
    }
    // General-access (classesRemaining IS NULL) was never decremented at booking
    // time — nothing to restore.
  }

  private isUniqueConstraintViolation(err: unknown): boolean {
    return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002');
  }
}
