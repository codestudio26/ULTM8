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
import { CancellationService, SeatRef, StripeRefundPlan } from './cancellation.service';
import { BookClassDto } from './dto/book-class.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { UpdateBookingOverrideDto } from './dto/update-booking-override.dto';
import { BookingsSummaryResponseDto } from './dto/bookings-summary-response.dto';
import { daysInRange, defaultWeekRange, localDateRangeToInstants, MAX_SUMMARY_RANGE_DAYS, safeZone } from './booking-week';
import { styleIdsOf } from '../classes/class-styles';
import { localDay } from '../ranks/engine';
import { assertClassBookable, assertNotAlreadyAttended, lockClassSeats, lockClassShared, lockStudentClass, selectAndConsumeMembership, withSeatLockRetry, BOOKING_TX_OPTIONS, LockedClass } from './booking-gates';
import { hasCountingWaiverSignature } from '../waivers/waiver-signed-check';
import { guestWaiverToken, hashGuestWaiverToken } from '../waivers/guest-waiver-token';
import { lockSchoolOpen } from '../tenants/lock-school-open';
import { SEAT_HOLDING_STATUSES } from '../classes/class-seats';

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
    private readonly cancellation: CancellationService,
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
    // Decision 291 — the School cancelled this class.
    if (resolvedClass.cancelledAt) {
      throw new ConflictException('This class has been cancelled by the school.');
    }

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
    // Decision 379: Kid Mode books the child only. Guests and their signing
    // links stay with the parent, who adds them from their own session.
    if (viaKidMode && guestIds.length > 0) {
      throw new ForbiddenException({ code: 'NO_GUESTS_IN_KID_MODE', message: 'Guests can only be added by a parent, not in Kid Mode.' });
    }
    if (new Set(guestIds).size !== guestIds.length) {
      throw new BadRequestException({ code: 'GUEST_PASS_REPEATED', message: 'Each guest needs their own Friend Pass: the same pass was listed more than once.' });
    }

    return withSeatLockRetry(() => this.prismaApp.withTenantContext(studentId, async (tx) => {
      // First, before any row lock (see lockStudentClass).
      await lockStudentClass(tx, studentId, classId);
      await lockSchoolOpen(tx, resolvedClass.schoolId);
      await assertNotAlreadyAttended(tx, studentId, classId);
      if (resolvedClass.termsWaiverRequired) {
        if (!(await hasCountingWaiverSignature(tx, studentId, resolvedClass.schoolId))) {
          throw new BadRequestException('This Student must hold a Signed Waiver for this School before booking a Class that requires one.');
        }
      }

      if (!dto.overrideReason) {
        await this.assertRankEligible(tx, studentId, resolvedClass);
      }

      const attendeeMembershipIds = dto.attendeeMembershipIds ?? [];
      const partySize = 1 + attendeeMembershipIds.length;
      let locked: LockedClass;
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
        // The lock also re-checks that the School hasn't cancelled or archived the
        // Class since the read above (stress test, 27 Oct 2026).
        locked = await lockClassSeats(tx, classId);
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
      } else {
        // No seats to count, so a shared lock: it only makes a whole-class cancel
        // and this booking wait for each other, and re-checks the Class.
        locked = await lockClassShared(tx, classId);
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
            branchId: locked ? locked.branchId : resolvedClass.branchId,
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
        // Waivers Q9: each guest seat gets its own waiver signing link.
        const attendeeId = randomUUID();
        await tx.bookingAttendee.create({
          data: {
            id: attendeeId,
            bookingId,
            schoolId: resolvedClass.schoolId,
            membershipId: guestMembership.id,
            guestTokenHash: hashGuestWaiverToken(guestWaiverToken(attendeeId)),
          },
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

    // Decision 291 — only a School Owner/Manager can send money back. A Student
    // or Guardian cancelling their own booking gets whatever the owner chose;
    // any other staff member's refund waits for an Owner/Manager instead.
    const mayRefund = isGuardianAction || resolvedBooking.studentId === callerId
      ? true
      : await this.cancellation.isSchoolOwner(callerId, resolvedBooking.schoolId);

    let cancellationChargeAmount: number | null = null;
    let cancellationChargeCurrency = 'usd';
    const refunds: StripeRefundPlan[] = [];
    let needsStaff = 0;
    const booking = await this.prismaApp.withTenantContext(resolvedBooking.studentId, async (tx) => {
      // Read past RLS: the Booking above already proved the caller may act on it,
      // and a Student can lose sight of their Class (moved to another Branch
      // before Decision 345 blocked that, C14), which left the Booking stuck.
      const cls = await this.prismaJobs.class.findUniqueOrThrow({ where: { id: resolvedBooking.classId } });
      // Decision 292 — the class's Branch's own settings when it has them.
      const school = await this.cancellation.settingsFor(resolvedBooking.schoolId, cls.branchId);
      const now = new Date();
      // Kickoff prompt §1.c: the Class's own refundFeeDate cutoff — or, since
      // Decision 291, the School's (or Branch's) default cutoff for a class
      // with none. No cutoff at all means never past it.
      const cutoff = this.cancellation.effectiveCutoff(cls, school);
      const pastCutoff = cutoff !== null && now >= cutoff;
      // Once the Class has started, the School's late-cancel setting decides
      // (Decision 322; default: no refund once started). Under the first two
      // settings an ended Class can't be cancelled: it will be marked a No-Show
      // instead.
      const policy = (await this.prismaJobs.school.findUnique({ where: { id: cls.schoolId }, select: { lateCancelRefundPolicy: true } }))?.lateCancelRefundPolicy ?? 'NO_REFUND_ONCE_STARTED';
      if (!opts?.schoolCancelled && now >= cls.endDate && policy !== 'ALWAYS_REFUND') {
        throw new ConflictException('This Class has already ended, so the Booking can no longer be cancelled.');
      }
      const startedNoRefund = now >= cls.startDate && policy === 'NO_REFUND_ONCE_STARTED';
      // Decision 322 — when the School cancels the Class from the Timetable the
      // credit always comes back. Otherwise a started class under "no refund
      // once started" keeps the credit, and anything else follows the
      // cancellation policy (Decision 291).
      const base = opts?.schoolCancelled
        ? 'CREDIT'
        : startedNoRefund
          ? 'KEEP'
          : this.cancellation.outcomeForBookingCancel(school, pastCutoff);

      // Decision 234 — a sibling action to credit-withholding, not a
      // replacement: captured here (inside the transaction, where cls/
      // resolvedBooking's sourceMembership are both cheaply available) but the
      // actual Stripe call happens AFTER this transaction commits (no external
      // I/O inside a transaction, same discipline every other Stripe-calling
      // write in this codebase follows) — see the try/catch below. The fee
      // stays tied to the refund cut-off itself (Decision 322), and Decision 291
      // lets the owner switch it off.
      if (!opts?.schoolCancelled && pastCutoff && school.chargeLateCancellationFee && cls.cancellationCharge !== null && cls.cancellationCharge > 0) {
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
        data: { status: 'CANCELLED' },
      });
      if (result.count === 0) {
        throw new ConflictException('This Booking is no longer Upcoming — it may already be Cancelled, Completed, or marked No-Show.');
      }

      // Decision 291 — each seat (the Student's own, then each guest's) is
      // resolved by the School's policy: credit back, nothing back, money back,
      // or left for staff. See CancellationService.resolveSeat.
      const seats: SeatRef[] = [
        { bookingId, attendeeId: null, membershipId: resolvedBooking.sourceMembershipId },
        ...resolvedBooking.attendees.map((a) => ({ bookingId, attendeeId: a.id, membershipId: a.membershipId })),
      ];
      for (const seat of seats) {
        const seatResult = await this.cancellation.resolveSeat(tx, seat, base, mayRefund);
        await this.cancellation.writeSeat(tx, seat, seatResult, callerId);
        if (seatResult.stripeRefund) refunds.push({ seat, studentId: resolvedBooking.studentId, schoolId: resolvedBooking.schoolId });
        else if (seatResult.resolution === 'PENDING' || seatResult.resolution === 'REFUND_OWED') needsStaff += 1;
      }

      return tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { attendees: true } });
    });

    const { failed } = await this.cancellation.sendStripeRefunds(refunds);
    if (needsStaff + failed > 0) {
      await this.cancellation.alertOwners(
        resolvedBooking.schoolId,
        `booking-cancelled-review-${bookingId}`,
        'A cancelled booking needs a refund decision or a cash refund paid. See Cancellations to resolve.',
      );
    }

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
      const feeAmount = cancellationChargeAmount;
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
      return this.prismaApp.withTenantContext(resolvedBooking.studentId, async (tx) => {
        // Decision 346 (G5) — a fee that was charged, or tried and declined, is
        // also a row on the School's Transactions ledger. No saved card means
        // nothing was charged, so no row.
        if (outcome !== 'NO_SAVED_PAYMENT_METHOD') {
          const paymentAccount = await tx.paymentAccount.findUnique({ where: { schoolId: resolvedBooking.schoolId }, select: { id: true } });
          if (paymentAccount) {
            await tx.transaction.create({
              data: {
                id: randomUUID(),
                schoolId: resolvedBooking.schoolId,
                studentId: resolvedBooking.studentId,
                paymentAccountId: paymentAccount.id,
                kind: 'LATE_CANCEL_FEE',
                bookingId,
                amount: feeAmount,
                currency: cancellationChargeCurrency.toUpperCase(),
                status: outcome === 'CHARGED' ? 'SUCCESSFUL' : 'FAILED',
                paymentMethod: 'STRIPE',
                stripePaymentIntentId: paymentIntentId,
              },
            });
          }
        }
        return tx.booking.update({
          where: { id: bookingId },
          data: {
            cancellationChargeOutcome: outcome,
            cancellationChargeAmount,
            stripeCancellationPaymentIntentId: paymentIntentId,
          },
          include: { attendees: true },
        });
      });
    }

    // Re-read when a Stripe refund ran after the cancellation committed, so the
    // caller sees the seat as MONEY_REFUNDED rather than PENDING.
    if (refunds.length > 0) {
      return this.prismaApp.withTenantContext(resolvedBooking.studentId, (tx) =>
        tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { attendees: true } }),
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
  /** Decision 379 — the Schools a parent's child is a student at, for the
   * parent's "Book a class" screen. Read under the child's own context, as
   * every other Guardian-on-behalf-of read does (the parent holds no
   * RoleGrant, Decision 92). */
  async findMinorSchools(guardianId: string, studentId: string) {
    await this.guardiansService.assertGuardianOfStudent(guardianId, studentId);
    const grants = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.roleGrant.findMany({
        where: { userId: studentId, role: 'STUDENT', revokedAt: null, school: { archivedAt: null } },
        select: { schoolId: true, school: { select: { name: true } } },
        distinct: ['schoolId'],
      }),
    );
    const items = grants.filter((g) => g.schoolId && g.school).map((g) => ({ schoolId: g.schoolId!, name: g.school!.name }));
    items.sort((a, b) => a.name.localeCompare(b.name));
    return { items };
  }

  /** Decision 379 — the child's upcoming bookings, soonest first, so the
   * parent can share guest links and cancel. */
  async findMinorUpcomingBookings(guardianId: string, studentId: string) {
    await this.guardiansService.assertGuardianOfStudent(guardianId, studentId);
    const bookings = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.booking.findMany({
        where: { studentId, status: 'UPCOMING', class: { endDate: { gt: new Date() } } },
        select: { id: true, classId: true, schoolId: true, class: { select: { title: true, startDate: true } }, _count: { select: { attendees: true } } },
        orderBy: [{ class: { startDate: 'asc' } }, { id: 'asc' }],
        take: 100,
      }),
    );
    return {
      items: bookings.map((b) => ({
        id: b.id,
        classId: b.classId,
        classTitle: b.class.title,
        classStartsAt: b.class.startDate.toISOString(),
        schoolId: b.schoolId,
        guestCount: b._count.attendees,
      })),
    };
  }

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
   * GET /students/{id}/bookings/next — the student page's "Upcoming booking"
   * (Decision 341, S14): the soonest UPCOMING booking whose class hasn't
   * started yet, and how many more there are. The paged list above is in id
   * order, so the page used to pick the soonest from its first 20 only.
   * Staff who cover this student only (the owner, or by the Grading Board's
   * branch rule), as for the rest of that page.
   */
  async findNextForStudent(callerId: string, studentId: string, schoolId: string) {
    if (!schoolId) {
      throw new BadRequestException('schoolId query parameter is required');
    }
    await this.tenantAuth.assertStaffCoversStudent(callerId, schoolId, studentId);
    const where = { studentId, schoolId, status: 'UPCOMING' as const, class: { startDate: { gt: new Date() } } };
    const [next, total] = await this.prismaApp.withTenantContext(callerId, (tx) =>
      Promise.all([
        tx.booking.findFirst({
          where,
          orderBy: [{ class: { startDate: 'asc' } }, { id: 'asc' }],
          include: { attendees: true, class: { select: { title: true, startDate: true, endDate: true } } },
        }),
        tx.booking.count({ where }),
      ]),
    );
    if (!next) return { next: null, moreUpcoming: 0 };
    const { class: cls, ...rest } = next;
    return {
      next: { ...rest, classTitle: cls.title, classStartDate: cls.startDate, classEndDate: cls.endDate },
      moreUpcoming: total - 1,
    };
  }

  /**
   * GET /schools/:schoolId/bookings/summary — v1.2 backend backlog, Dashboard
   * "Bookings This Week" drill-down, reworked by Decision 367 (Dashboard review).
   * School Owner only (Q6): no other screen reads it, and Branch Staff would
   * otherwise see every Branch's numbers.
   *
   * `from`/`to` (YYYY-MM-DD) must both be supplied or both omitted — supplying only
   * one is a plain 400 rather than silently guessing the other end — and span at
   * most MAX_SUMMARY_RANGE_DAYS (D2). The default is the current Mon–Sun week in
   * the School's time zone (booking-week.ts). Each Class lands on its own local
   * day: its Branch's time zone, else the School's, else UTC (D3), so the
   * instant window is padded a day either side and trimmed per Class.
   *
   * See BookingsSummaryResponseDto's header comment for what each figure counts
   * (cancelled apart, Styles grouping, multi-Style fan-out).
   */
  async getWeeklySummary(callerId: string, schoolId: string, from?: string, to?: string, branchId?: string): Promise<BookingsSummaryResponseDto> {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);

    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { timezone: true } }),
    );
    const schoolZone = safeZone(school?.timezone);

    let range: { from: string; to: string };
    if (from === undefined && to === undefined) {
      range = defaultWeekRange(schoolZone);
    } else if (from === undefined || to === undefined) {
      throw new BadRequestException('from and to must both be supplied, or both omitted for the current week.');
    } else {
      range = { from, to };
    }
    if (range.from > range.to) {
      throw new BadRequestException('from must not be after to.');
    }
    // Validates both ends before daysInRange builds anything.
    const { gte, lt } = localDateRangeToInstants(range.from, range.to, schoolZone);
    if ((lt.getTime() - gte.getTime()) / 86_400_000 > MAX_SUMMARY_RANGE_DAYS + 1) {
      throw new BadRequestException(`The date range can be at most ${MAX_SUMMARY_RANGE_DAYS} days.`);
    }
    const dayList = daysInRange(range.from, range.to);
    if (dayList.length > MAX_SUMMARY_RANGE_DAYS) {
      throw new BadRequestException(`The date range can be at most ${MAX_SUMMARY_RANGE_DAYS} days.`);
    }

    const PAD_MS = 86_400_000;
    const { classes, disciplines } = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      if (branchId) {
        const branch = await tx.branch.findFirst({ where: { id: branchId, schoolId }, select: { id: true } });
        if (!branch) throw new BadRequestException('That Branch is not part of this School.');
      }
      const [classes, disciplines] = await Promise.all([
        tx.class.findMany({
          where: {
            schoolId,
            ...(branchId ? { branchId } : {}),
            startDate: { gte: new Date(gte.getTime() - PAD_MS), lt: new Date(lt.getTime() + PAD_MS) },
            // An archived Class still shows if people booked it.
            OR: [{ archivedAt: null }, { bookings: { some: {} } }],
          },
          select: {
            id: true,
            title: true,
            startDate: true,
            capacity: true,
            activities: true,
            styles: true,
            cancelledAt: true,
            branch: { select: { name: true, timezone: true } },
            bookings: { select: { status: true } },
          },
          orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
        }),
        tx.discipline.findMany({ where: { schoolId }, select: { id: true, name: true } }),
      ]);
      return { classes, disciplines };
    });
    const styleName = new Map(disciplines.map((d) => [d.id, d.name]));

    type ActivityCount = { total: number; upcoming: number };
    const dayBuckets = new Map<
      string,
      { total: number; upcoming: number; cancelled: number; activities: Map<string | null, ActivityCount>; classes: BookingsSummaryResponseDto['days'][number]['classes'] }
    >();
    for (const day of dayList) {
      dayBuckets.set(day, { total: 0, upcoming: 0, cancelled: 0, activities: new Map(), classes: [] });
    }

    let totalBookings = 0;
    let upcomingBookings = 0;
    let cancelledBookings = 0;
    let attendedBookings = 0;
    let noShowBookings = 0;
    for (const cls of classes) {
      const timeZone = safeZone(cls.branch?.timezone || school?.timezone);
      const bucket = dayBuckets.get(localDay(cls.startDate, timeZone));
      if (!bucket) continue; // In the padding, outside the range on its own local day.

      const counts = { booked: 0, upcoming: 0, cancelled: 0 };
      for (const b of cls.bookings) {
        if (b.status === 'CANCELLED') {
          counts.cancelled += 1;
          continue;
        }
        counts.booked += 1;
        if (b.status === 'UPCOMING') counts.upcoming += 1;
        if (b.status === 'COMPLETED') attendedBookings += 1;
        if (b.status === 'NO_SHOW') noShowBookings += 1;
      }
      totalBookings += counts.booked;
      upcomingBookings += counts.upcoming;
      cancelledBookings += counts.cancelled;
      bucket.total += counts.booked;
      bucket.upcoming += counts.upcoming;
      bucket.cancelled += counts.cancelled;

      if (counts.booked > 0) {
        const ids = styleIdsOf(cls.styles).filter((id) => styleName.has(id));
        const names = ids.length > 0 ? [...new Set(ids.map((id) => styleName.get(id)!))] : cls.activities.length > 0 ? [...new Set(cls.activities)] : [null];
        for (const name of names) {
          const a = bucket.activities.get(name) ?? { total: 0, upcoming: 0 };
          a.total += counts.booked;
          a.upcoming += counts.upcoming;
          bucket.activities.set(name, a);
        }
      }

      bucket.classes.push({
        classId: cls.id,
        title: cls.title,
        startDate: cls.startDate,
        timeZone,
        branchName: cls.branch?.name ?? null,
        capacity: cls.capacity,
        bookedCount: counts.booked,
        cancelledCount: counts.cancelled,
        cancelled: cls.cancelledAt !== null,
      });
    }

    return {
      from: range.from,
      to: range.to,
      branchId: branchId ?? null,
      totalBookings,
      upcomingBookings,
      cancelledBookings,
      attendedBookings,
      noShowBookings,
      days: Array.from(dayBuckets.entries()).map(([date, bucket]) => ({
        date,
        totalBookings: bucket.total,
        upcomingBookings: bucket.upcoming,
        cancelledBookings: bucket.cancelled,
        activities: Array.from(bucket.activities.entries())
          .map(([activity, a]) => ({ activity, totalBookings: a.total, upcomingBookings: a.upcoming }))
          .sort((x, y) => y.totalBookings - x.totalBookings || (x.activity ?? '\uffff').localeCompare(y.activity ?? '\uffff')),
        classes: bucket.classes,
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
      this.prismaJobs.booking.count({ where: { classId, status: SEAT_HOLDING_STATUSES } }),
      this.prismaJobs.bookingAttendee.count({ where: { booking: { classId, status: SEAT_HOLDING_STATUSES } } }),
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

  private isUniqueConstraintViolation(err: unknown): boolean {
    return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002');
  }
}
