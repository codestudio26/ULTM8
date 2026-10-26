import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, PrismaClient } from '@prisma/client';
import { assertBookingUnlocked } from '../ranks/booking-unlocks';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { GuardiansService } from '../guardians/guardians.service';
import { SubscriptionGateService } from '../subscription-plans/subscription-gate.service';
import { NoSavedPaymentMethodError, PaymentsService } from '../payments/payments.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { WAITLIST_CASCADE_PROCESSING_QUEUE } from '../jobs/queue.constants';
import { BookClassDto } from './dto/book-class.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { UpdateBookingOverrideDto } from './dto/update-booking-override.dto';
import { BookingsSummaryResponseDto } from './dto/bookings-summary-response.dto';
import { daysInRange, defaultWeekRange, localDateRangeToInstants } from './booking-week';
import { localDay } from '../ranks/engine';
import { assertClassBookable, lockClassSeats, selectAndConsumeMembership, withSeatLockRetry, BOOKING_TX_OPTIONS } from './booking-gates';

// Same shape PrismaAppService#withTenantContext hands its callback.
type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Phase 11 scope: single-Class booking creation/cancellation + the rank-gate
 * override amendment. Waitlist join/withdraw/claim live in WaitlistService — see that
 * file's own header comment. QR check-in/Attendance (Phase "12") and
 * NotificationsModule are both explicitly out of scope — see the Phase 11 kickoff
 * prompt §3. The late-cancellation-fee CHARGE mechanism (once flagged here as
 * deliberately missing) is built — Decision 234, see cancelBooking()'s own
 * comment for the full account. Phase 40 added Guardian-on-behalf-of booking CREATION; Phase 41 added
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
    private readonly paymentsService: PaymentsService,
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
  /**
   * `viaKidMode` (Decision 123) — set by BookingsController only when the
   * caller's JWT itself carried a `kidMode` claim, after its own live
   * `GuardiansService.assertBookingDelegationActive()` re-check already passed.
   * Threaded through as a plain flag rather than this method re-deriving it
   * from `callerId` alone, since a Kid-Mode token's `sub` is indistinguishable
   * from an ordinary Guardian token's `sub` — same guardianId either way,
   * exactly the point of reusing the existing on-behalf-of path unchanged.
   */
  async bookClass(callerId: string, classId: string, dto: BookClassDto, viaKidMode = false) {
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
    assertClassBookable(resolvedClass, { byStaff: isStaffAction });
    // Spec 55 §10.2's confirmed read-only degraded-portal state — "no new
    // Bookings" is one of the three actions it explicitly names (Phase 54).
    // Checked under `studentId`'s own RLS context, NOT `callerId`'s — a Guardian
    // caller holds zero RoleGrant anywhere (Decision 92), so `callerId`'s own
    // context would see nothing and silently no-op the check for exactly the
    // on-behalf-of path that most needs it; `studentId` is guaranteed
    // RLS-visible into this School the same way the actual Booking create()
    // below already relies on (it also runs under `studentId`'s context).
    await this.subscriptionGate.assertNotDegraded(studentId, resolvedClass.schoolId);
    // Decision 110: a closed School accepts no new Bookings, same as every other
    // write there (Classes review C16: a Student could still book after closing).
    await this.tenantAuth.assertSchoolNotArchived(studentId, resolvedClass.schoolId);
    // SKILL.md §10: each guest needs a Friend Pass; the organizer's own
    // Subscription or Class Pack never covers a guest, and one pass covers one
    // guest (Classes review C13: one Subscription sent three times booked three
    // free guests).
    const guestIds = dto.attendeeMembershipIds ?? [];
    if (new Set(guestIds).size !== guestIds.length) {
      throw new BadRequestException({ code: 'GUEST_PASS_REPEATED', message: 'Each guest needs their own Friend Pass: the same pass was listed more than once.' });
    }

    return withSeatLockRetry(() => this.prismaApp.withTenantContext(studentId, async (tx) => {
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
        // explicit row lock on the Class itself (taken with NOWAIT and retried — see
        // lockClassSeats in booking-gates.ts) for the duration of the
        // count-then-create, serializing concurrent bookers for THIS Class only
        // (other Classes are entirely unaffected). First use of an explicit lock in
        // this codebase; flagged here rather than silently introduced.
        await lockClassSeats(tx, classId);
        const occupied = await this.countOccupiedSeats(classId);
        // Waitlist first (product owner, 26 Oct 2026): a seat offered to a waitlisted
        // Student (NOTIFIED) is held for them, and while anyone is queued a Student
        // can't book past the queue. Staff can still book a walk-in into a free seat.
        const queue = await this.countActiveWaitlist(classId);
        if (!isStaffAction && queue.waiting + queue.notified > 0) {
          throw new ConflictException({ code: 'WAITLIST_FIRST', message: 'Students are waiting for this Class. Join the waitlist instead (POST /classes/{id}/waitlist).' });
        }
        if (occupied + queue.notified + partySize > resolvedClass.capacity) {
          throw new ConflictException({
            code: 'CLASS_FULL',
            message: 'This Class is full for the requested party size — join the waitlist instead (POST /classes/{id}/waitlist).',
          });
        }
      }

      const sourceMembership = await selectAndConsumeMembership(tx, studentId, resolvedClass.schoolId, resolvedClass);

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
            bookedViaKidMode: viaKidMode,
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
    }, BOOKING_TX_OPTIONS));
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
   *
   * `opts.schoolCancelled` (Decision 322): the School cancelled the Class itself,
   * so the credit always comes back, with no late-cancel rule and no fee.
   */
  async cancelBooking(callerId: string, bookingId: string, dto?: CancelBookingDto, opts?: { schoolCancelled?: boolean }) {
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

    let cancellationChargeAmount: number | null = null;
    let cancellationChargeCurrency = 'usd';
    const booking = await this.prismaApp.withTenantContext(resolvedBooking.studentId, async (tx) => {
      // Read past RLS: the Booking above already proved the caller may act on it,
      // and a Student can lose sight of their Class (moved to another Branch
      // before Decision 345 blocked that, C14), which left the Booking stuck.
      const cls = await this.prismaJobs.class.findUniqueOrThrow({ where: { id: resolvedBooking.classId } });
      const now = new Date();
      // Kickoff prompt §1.c: refunds/credits back before the Class's own
      // refundFeeDate cutoff; withholds on/after it.
      const pastCutoff = cls.refundFeeDate !== null && now >= cls.refundFeeDate;
      // Once the Class has started, the School's late-cancel setting decides
      // (product owner, 26 Oct 2026; default: no refund once started). Under the
      // first two settings an ended Class can't be cancelled: it will be marked a
      // No-Show instead. Before this, credit always came back, even after the end.
      const policy = (await this.prismaJobs.school.findUnique({ where: { id: cls.schoolId }, select: { lateCancelRefundPolicy: true } }))?.lateCancelRefundPolicy ?? 'NO_REFUND_ONCE_STARTED';
      if (!opts?.schoolCancelled && now >= cls.endDate && policy !== 'ALWAYS_REFUND') {
        throw new ConflictException('This Class has already ended, so the Booking can no longer be cancelled.');
      }
      const startedNoRefund = now >= cls.startDate && policy === 'NO_REFUND_ONCE_STARTED';
      const resolution: 'REFUNDED' | 'WITHHELD' = !opts?.schoolCancelled && (pastCutoff || startedNoRefund) ? 'WITHHELD' : 'REFUNDED';

      // Decision 234 — a sibling action to credit-withholding above, not a
      // replacement: captured here (inside the transaction, where cls/
      // resolvedBooking's sourceMembership are both cheaply available) but the
      // actual Stripe call happens AFTER this transaction commits (no external
      // I/O inside a transaction, same discipline every other Stripe-calling
      // write in this codebase follows) — see the try/catch below.
      // The late-cancellation fee stays tied to the refund cut-off itself; the
      // late-cancel setting above only keeps the credit.
      if (!opts?.schoolCancelled && pastCutoff && cls.cancellationCharge !== null && cls.cancellationCharge > 0) {
        cancellationChargeAmount = cls.cancellationCharge;
        // No currency field on Class itself — reuses the Booking's own
        // sourceMembership's MembershipPlan currency, the same `?? 'usd'`
        // fallback MembershipsService.purchase() already applies when charging
        // this exact Membership's own Stripe payments.
        const sourceMembership = await tx.membership.findUnique({
          where: { id: resolvedBooking.sourceMembershipId },
          select: { membershipPlan: { select: { currency: true } } },
        });
        cancellationChargeCurrency = sourceMembership?.membershipPlan.currency ?? 'usd';
      }

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

    // Decision 234 — the actual charge attempt, strictly AFTER the Cancellation
    // above has already committed: cancelling the Booking is the real action
    // being requested and must succeed regardless of whether this fee can
    // actually be collected right now (an unreachable Stripe, a declined card,
    // or no saved payment method at all are all real, expected outcomes here,
    // never a reason to roll back or block the cancellation itself). Recorded
    // onto the Booking via its own small follow-up update — never thrown to the
    // caller — same "best-effort side effect, logged on failure, never blocks
    // the user-facing action" shape SchoolsService.leaveFranchise's own Stripe
    // cancellation already established.
    if (cancellationChargeAmount !== null) {
      let outcome: 'CHARGED' | 'FAILED' | 'NO_SAVED_PAYMENT_METHOD';
      let paymentIntentId: string | null = null;
      try {
        const charge = await this.paymentsService.chargeOffSession(
          resolvedBooking.studentId,
          resolvedBooking.schoolId,
          cancellationChargeAmount,
          cancellationChargeCurrency,
          'Late-cancellation fee',
        );
        outcome = charge.succeeded ? 'CHARGED' : 'FAILED';
        paymentIntentId = charge.paymentIntentId || null;
      } catch (err) {
        if (err instanceof NoSavedPaymentMethodError) {
          outcome = 'NO_SAVED_PAYMENT_METHOD';
        } else {
          outcome = 'FAILED';
          this.logger.error(`Late-cancellation charge failed for Booking ${booking.id} (Student ${resolvedBooking.studentId}, School ${resolvedBooking.schoolId}).`, err as Error);
        }
      }
      return this.prismaApp.withTenantContext(resolvedBooking.studentId, (tx) =>
        tx.booking.update({
          where: { id: bookingId },
          data: {
            cancellationChargeOutcome: outcome,
            cancellationChargeAmount,
            stripeCancellationPaymentIntentId: paymentIntentId,
          },
          include: { attendees: true },
        }),
      );
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
    // Resolved via PrismaAuthService (Decision 117), not a Prisma `include` on
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

  /**
   * GET /students/{id}/bookings (v1.2 backend backlog — Student Detail's
   * "Upcoming Booking") — Staff-only (School Owner/Manager, Branch Staff, or
   * Instructor), same `schoolId` required-query-param shape
   * MembershipsService.getMembershipStatus / GradingService's own
   * students/{id}/... reads already established (a Student's Bookings are
   * School-scoped, and without it this can't know which School's data to
   * read). Queried under the CALLER's own tenant context, not the target
   * Student's — Booking's RLS already carries a broad, SELECT-only policy
   * admitting any active Staff RoleGrant holder at the School (the same
   * `booking_staff_read` policy findAllForClass() above already relies on),
   * so there's no narrow-RLS reason here to borrow the target-tenant-context
   * substitution MembershipsService.getMembershipStatus needs for
   * Membership's own narrower policy.
   */
  async findAllForStudent(
    callerId: string,
    studentId: string,
    schoolId: string,
    cursor?: string,
    limit?: number,
  ): Promise<CursorPage<{ id: string }>> {
    if (!schoolId) {
      throw new BadRequestException('schoolId query parameter is required');
    }
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);

    const page = await this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate(
        (args) =>
          tx.booking.findMany({
            ...args,
            where: { studentId, schoolId },
            include: { attendees: true, class: { select: { title: true, startDate: true, endDate: true } } },
          }),
        cursor,
        limit,
      ),
    );
    return {
      ...page,
      items: page.items.map((b) => {
        const { class: cls, ...rest } = b;
        return { ...rest, classTitle: cls.title, classStartDate: cls.startDate, classEndDate: cls.endDate };
      }),
    };
  }

  /**
   * GET /schools/:schoolId/bookings/summary — v1.2 backend backlog, Dashboard
   * "Bookings This Week" drill-down (nothing backed this before: see the backlog
   * doc's own entry for the full gap this closes). Staff-only (School Owner/
   * Manager, Branch Staff, or Instructor) — the same `assertStaffAtSchool` gate
   * findAllForClass/findAllForStudent above already use, not the narrower
   * `assertSchoolOwner` TransactionsController.findAllForSchool uses: Booking data
   * here is scheduling/attendance information, not the financial ledger Transaction
   * reads with a deliberately tighter Owner-only gate elsewhere in this codebase.
   *
   * Two real, disclosed judgment calls (see BookingsSummaryResponseDto's own header
   * comment for the full account): (1) grouping "by discipline" groups by the raw
   * `Class.activities` string tags, not the canonical `Discipline`/`styles` FK —
   * same Decision 90 bridge ClassesQueryDto's own `activities` filter already
   * relies on, not reopened here; (2) a Booking whose Class carries several
   * activities tags counts once per tag (fan-out) in the per-activity breakdown,
   * but exactly once in every day-level/overall total.
   *
   * `from`/`to` (YYYY-MM-DD) must both be supplied or both omitted — supplying only
   * one is treated the same as an invalid range, a plain 400, rather than silently
   * guessing the other end. Interpreted as local calendar days in the School's own
   * `timezone` (falls back to UTC — School.timezone is nullable) — see
   * booking-week.ts's own header comment for why.
   */
  async getWeeklySummary(callerId: string, schoolId: string, from?: string, to?: string): Promise<BookingsSummaryResponseDto> {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);

    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { timezone: true } }),
    );
    const timeZone = school?.timezone ?? null;

    let range: { from: string; to: string };
    if (from === undefined && to === undefined) {
      range = defaultWeekRange(timeZone);
    } else if (from === undefined || to === undefined) {
      throw new BadRequestException('from and to must both be supplied, or both omitted for the current week.');
    } else {
      range = { from, to };
    }
    if (range.from > range.to) {
      throw new BadRequestException('from must not be after to.');
    }

    const { gte, lt } = localDateRangeToInstants(range.from, range.to, timeZone);

    const bookings = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.booking.findMany({
        where: { schoolId, class: { startDate: { gte, lt } } },
        select: { status: true, class: { select: { startDate: true, activities: true } } },
      }),
    );

    const UNSPECIFIED = 'Unspecified';
    const dayBuckets = new Map<string, { total: number; upcoming: number; activities: Map<string, { total: number; upcoming: number }> }>();
    for (const day of daysInRange(range.from, range.to)) {
      dayBuckets.set(day, { total: 0, upcoming: 0, activities: new Map() });
    }

    let totalBookings = 0;
    let upcomingBookings = 0;
    for (const b of bookings) {
      totalBookings += 1;
      const isUpcoming = b.status === 'UPCOMING';
      if (isUpcoming) upcomingBookings += 1;

      const day = localDay(b.class.startDate, timeZone ?? 'UTC');
      const bucket = dayBuckets.get(day);
      if (!bucket) continue; // Defensive — the gte/lt filter above should make this unreachable.
      bucket.total += 1;
      if (isUpcoming) bucket.upcoming += 1;

      const tags = b.class.activities.length > 0 ? b.class.activities : [UNSPECIFIED];
      for (const tag of tags) {
        const a = bucket.activities.get(tag) ?? { total: 0, upcoming: 0 };
        a.total += 1;
        if (isUpcoming) a.upcoming += 1;
        bucket.activities.set(tag, a);
      }
    }

    return {
      from: range.from,
      to: range.to,
      totalBookings,
      upcomingBookings,
      days: Array.from(dayBuckets.entries()).map(([date, bucket]) => ({
        date,
        totalBookings: bucket.total,
        upcomingBookings: bucket.upcoming,
        activities: Array.from(bucket.activities.entries()).map(([activity, a]) => ({
          activity,
          totalBookings: a.total,
          upcomingBookings: a.upcoming,
        })),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  // Booking rank gate (SKILL.md §9, Decision 173): for each style the class
  // lists, its class type must be open or unlocked by the student's rung or a
  // rung below, as the school owner sets per rung. Replaces Decision 90's
  // activities <-> Discipline.name bridge.
  private async assertRankEligible(tx: TenantTx, studentId: string, cls: { styles: Prisma.JsonValue }): Promise<void> {
    await assertBookingUnlocked(tx, studentId, cls, ' A Staff member can override this per-Booking.');
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
  /** Active waitlist for a Class, read via ultm8_jobs for the same reason as
   * countOccupiedSeats: a Student's own context only sees their own entries. */
  private async countActiveWaitlist(classId: string): Promise<{ waiting: number; notified: number }> {
    const [waiting, notified] = await Promise.all([
      this.prismaJobs.waitlistEntry.count({ where: { classId, status: 'WAITING' } }),
      this.prismaJobs.waitlistEntry.count({ where: { classId, status: 'NOTIFIED' } }),
    ]);
    return { waiting, notified };
  }


  /** Guest-seat equivalent of selectAndConsumeMembership (booking-gates.ts) — the caller names a
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
    if (!membership || membership.studentId !== organizerId || membership.schoolId !== schoolId || membership.status !== 'ACTIVE' || (membership.expiryDate !== null && membership.expiryDate <= new Date())) {
      throw new BadRequestException(`attendeeMembershipIds must each reference an Active Membership belonging to the organizing Student at this School (got ${membershipId}).`);
    }
    if (membership.scopedClassId && membership.scopedClassId !== classId) {
      throw new BadRequestException(`Membership ${membershipId} is scoped to a different Class.`);
    }
    const plan = await tx.membershipPlan.findUnique({ where: { id: membership.membershipPlanId }, select: { type: true } });
    if (plan?.type !== 'FRIEND_PASS') {
      throw new BadRequestException({ code: 'GUEST_NEEDS_FRIEND_PASS', message: 'A guest can only be booked with a Friend Pass. Your own membership covers you, not your guests.' });
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
    if (membership.classesRemaining === null) {
      // General-access (classesRemaining IS NULL) was never decremented at
      // booking time — nothing to restore.
      return;
    }

    // Decision 111 — frozen while this Membership's own purchase Transaction is
    // under an active Stripe dispute (Decision 55's own confirmed "refund/
    // credit-restore frozen while disputed" contract): giving back a class
    // credit while the payment that funded it is contested risks the School
    // delivering free value if the dispute is later lost. Only the
    // credit-restore is frozen here, not the Booking cancellation itself —
    // Decision 55's text freezes the money-adjacent action, not every Booking
    // action.
    //
    // FLAGGED, not fully closed: this reads Transaction through the SAME
    // tenant-scoped `tx` cancelBooking() already opened for the organizer
    // (resolvedBooking.studentId) — correct for the organizer's own Membership,
    // but transaction_school_staff_or_self's RLS policy only admits a
    // Transaction row to School staff OR that Transaction's own studentId. For
    // a GUEST's membership (the attendee.membershipId call site below, a
    // genuinely different Student), this lookup can be silently RLS-blocked if
    // the organizer isn't School staff at this School — a narrow, real gap not
    // closed here (needs either a jobs-role read or a broadened RLS policy,
    // out of this phase's own scope of freezing the two real call sites).
    const disputedTransaction = await tx.transaction.findFirst({ where: { membershipId, status: 'DISPUTED' } });
    if (disputedTransaction) {
      this.logger.warn(`Membership ${membershipId}'s credit-restore skipped — its Transaction ${disputedTransaction.id} is under an active Stripe dispute (Decision 55/111).`);
      return;
    }

    await tx.membership.update({ where: { id: membershipId }, data: { classesRemaining: { increment: 1 } } });
  }

  private isUniqueConstraintViolation(err: unknown): boolean {
    return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002');
  }
}
