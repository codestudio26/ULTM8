import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaClient, RefundResolution, School } from '@prisma/client';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { PaymentsService } from '../payments/payments.service';
import { NOTIFICATION_FANOUT_QUEUE } from '../jobs/queue.constants';
import { NotificationFanoutJobData } from '../jobs/notification-fanout.types';
import { ResolveCancellationAction } from './dto/resolve-cancellation.dto';

type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * What a cancelled seat should get, before the seat's own Membership is looked
 * at: its credit back, nothing back, money back, or a staff decision.
 */
export type BaseOutcome = 'CREDIT' | 'KEEP' | 'MONEY' | 'PENDING';

/** One seat on a Booking: the Student's own (attendeeId null) or a guest's. */
export interface SeatRef {
  bookingId: string;
  attendeeId: string | null;
  membershipId: string;
}

/** A Stripe refund decided inside a transaction, sent once it commits. */
export interface StripeRefundPlan {
  seat: SeatRef;
  studentId: string;
  schoolId: string;
}

interface SeatResult {
  resolution: RefundResolution;
  refundAmount: number | null;
  stripeRefund: boolean;
}

export type CancellationSchoolSettings = Pick<
  School,
  | 'classCancellationPolicy'
  | 'classCancellationPolicyWindow'
  | 'chargeLateCancellationFee'
  | 'schoolCancelledClassResolution'
  | 'defaultRefundCutoffHours'
  | 'noShowFee'
>;

const SETTINGS_SELECT = {
  classCancellationPolicy: true,
  classCancellationPolicyWindow: true,
  chargeLateCancellationFee: true,
  schoolCancelledClassResolution: true,
  defaultRefundCutoffHours: true,
  noShowFee: true,
} as const;

const OPEN_RESOLUTIONS: RefundResolution[] = ['PENDING', 'REFUND_OWED'];

/** "Sat 24 Oct 2026, 18:00" in the class's own timezone (its branch's, else the
 * School's), for the class-cancelled notification. */
function formatClassTime(date: Date, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  try {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone }).format(date);
  } catch {
    return `${new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(date)} UTC`;
  }
}
const MONEY_RESOLUTIONS: RefundResolution[] = ['MONEY_REFUNDED', 'REFUND_OWED'];

/**
 * Decision 291 — the School's "Class cancellations" settings, applied.
 *
 * BookingsService.cancelBooking() still owns a single cancellation (who may
 * cancel, the UPCOMING -> CANCELLED guard, the late fee); this service decides
 * what each seat gets back, moves the money, cancels a whole class, and backs
 * the staff "to resolve" list.
 *
 * Fixed rules, not settings (domain rules §7 and §8.2):
 *  - a Friend Pass seat always gets its credit back, whatever the policy;
 *  - only a School Owner/Manager can send money back. A refund anyone else
 *    triggers (Branch Staff, an Instructor) waits as PENDING for one of them.
 *
 * Money only goes back for a Class Pack, one class's share of what was paid
 * (cumulative, rounded once — domain rules §7). Every other plan type has no
 * per-class price, so the seat falls back to its credit (a no-op for general
 * access, which never spent one).
 */
@Injectable()
export class CancellationService {
  private readonly logger = new Logger(CancellationService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly paymentsService: PaymentsService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly notificationFanoutQueue: Queue,
  ) {}

  /**
   * Decision 292 — the settings that apply to a class: its Branch's own, when
   * that Branch overrides the School's, else the School's. Read through the
   * jobs role so a Student's own cancellation can see its Branch row.
   */
  async settingsFor(schoolId: string, branchId: string | null): Promise<CancellationSchoolSettings> {
    if (branchId) {
      const branch = await this.prismaJobs.branch.findFirst({
        where: { id: branchId, schoolId },
        select: { cancellationSettingsOverride: true, ...SETTINGS_SELECT },
      });
      if (branch?.cancellationSettingsOverride) {
        const { cancellationSettingsOverride: _override, ...settings } = branch;
        return settings;
      }
    }
    return this.prismaJobs.school.findUniqueOrThrow({ where: { id: schoolId }, select: SETTINGS_SELECT });
  }

  /** The class's own refundFeeDate, else the School's default cutoff, else none. */
  effectiveCutoff(cls: { refundFeeDate: Date | null; startDate: Date }, school: Pick<School, 'defaultRefundCutoffHours'>): Date | null {
    if (cls.refundFeeDate) return cls.refundFeeDate;
    if (school.defaultRefundCutoffHours === null) return null;
    return new Date(cls.startDate.getTime() - school.defaultRefundCutoffHours * 3_600_000);
  }

  /** A Student/Guardian/staff cancelling one booking. */
  outcomeForBookingCancel(school: CancellationSchoolSettings, pastCutoff: boolean): BaseOutcome {
    if (pastCutoff && school.classCancellationPolicyWindow === 'BEFORE_CUTOFF') return 'KEEP';
    return this.outcomeForPolicy(school);
  }

  /** The School cancelling the whole class. The cutoff never applies: the student didn't cancel. */
  outcomeForClassCancel(school: CancellationSchoolSettings): BaseOutcome {
    switch (school.schoolCancelledClassResolution) {
      case 'REFUND_ALL':
        return 'MONEY';
      case 'CREDIT_ALL':
        return 'CREDIT';
      default:
        return this.outcomeForPolicy(school);
    }
  }

  private outcomeForPolicy(school: CancellationSchoolSettings): BaseOutcome {
    switch (school.classCancellationPolicy) {
      case 'AUTO_REFUND':
        return 'MONEY';
      case 'AUTO_CREDIT':
        return 'CREDIT';
      default:
        return 'PENDING';
    }
  }

  /** Whether `userId` holds an active School Owner/Manager grant at `schoolId`. */
  async isSchoolOwner(userId: string, schoolId: string): Promise<boolean> {
    const grant = await this.prismaApp.withTenantContext(userId, (tx) =>
      tx.roleGrant.findFirst({ where: { userId, schoolId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null }, select: { id: true } }),
    );
    return grant !== null;
  }

  /**
   * Owner/Manager, or Branch Staff covering `branchId` — the two roles that may
   * cancel a whole class or work the "to resolve" list (Instructors can't).
   * Returns whether the caller is the Owner/Manager.
   */
  async assertCancellationStaff(userId: string, schoolId: string, branchId: string | null): Promise<{ isOwner: boolean }> {
    const grants = await this.prismaApp.withTenantContext(userId, (tx) =>
      tx.roleGrant.findMany({
        where: {
          userId,
          schoolId,
          revokedAt: null,
          role: { in: ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF'] },
          ...(branchId ? { OR: [{ branchId: null }, { branchId }] } : {}),
        },
        select: { role: true },
      }),
    );
    if (grants.length === 0) {
      throw new ForbiddenException('Only the School Owner/Manager or that branch\'s Branch Staff may do this.');
    }
    return { isOwner: grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER') };
  }

  /**
   * Resolves one seat inside the caller's transaction (run under the booking's
   * own Student context, like every other Booking write). Restores a credit
   * right away; a Stripe refund comes back as `stripeRefund: true` and is sent
   * by sendStripeRefunds() once the transaction commits.
   */
  async resolveSeat(tx: TenantTx, seat: SeatRef, base: BaseOutcome, mayRefund: boolean): Promise<SeatResult> {
    if (base === 'KEEP') return { resolution: 'WITHHELD', refundAmount: null, stripeRefund: false };

    const membership = await tx.membership.findUniqueOrThrow({
      where: { id: seat.membershipId },
      select: { classesRemaining: true, membershipPlan: { select: { type: true, classesIncluded: true } } },
    });
    // Fixed rule: a Friend Pass was free, so it only ever gets its credit back.
    const outcome = membership.membershipPlan.type === 'FRIEND_PASS' ? 'CREDIT' : base;

    if (outcome === 'PENDING') return { resolution: 'PENDING', refundAmount: null, stripeRefund: false };
    if (outcome === 'CREDIT' || membership.membershipPlan.type !== 'CLASS_PACK') {
      await this.restoreCredit(tx, seat.membershipId);
      return { resolution: 'REFUNDED', refundAmount: null, stripeRefund: false };
    }

    const payment = await tx.transaction.findFirst({
      where: { membershipId: seat.membershipId, status: { in: ['SUCCESSFUL', 'DISPUTED', 'REFUNDED'] } },
      orderBy: { billingDate: 'desc' },
    });
    // A pack the School handed out with no payment has nothing to refund.
    if (!payment || payment.amount <= 0) {
      await this.restoreCredit(tx, seat.membershipId);
      return { resolution: 'REFUNDED', refundAmount: null, stripeRefund: false };
    }
    const refundAmount = await this.perClassShare(tx, seat, payment.amount, payment.refundedAmount ?? 0, membership.membershipPlan.classesIncluded);
    // Disputed (Decision 55: refunds frozen), nothing left to refund, or a caller
    // who may not send money: a staff decision.
    if (payment.status !== 'SUCCESSFUL' || refundAmount <= 0 || !mayRefund) {
      return { resolution: 'PENDING', refundAmount: refundAmount > 0 ? refundAmount : null, stripeRefund: false };
    }
    if (payment.paymentMethod === 'STRIPE' && payment.stripePaymentIntentId) {
      // Stays PENDING until Stripe confirms; a failed refund is left for staff.
      return { resolution: 'PENDING', refundAmount, stripeRefund: true };
    }
    return { resolution: 'REFUND_OWED', refundAmount, stripeRefund: false };
  }

  /** Writes a resolved seat back to its Booking or BookingAttendee row. */
  async writeSeat(tx: TenantTx, seat: SeatRef, result: SeatResult, resolvedById: string): Promise<void> {
    const data = {
      refundResolution: result.resolution,
      refundAmount: result.refundAmount,
      resolvedById,
      resolvedAt: result.resolution === 'PENDING' ? null : new Date(),
    };
    if (seat.attendeeId) {
      await tx.bookingAttendee.update({ where: { id: seat.attendeeId }, data });
    } else {
      await tx.booking.update({ where: { id: seat.bookingId }, data });
    }
  }

  /**
   * One class's share of a Class Pack's price: the cumulative entitlement after
   * this refund minus the cumulative entitlement before it, each rounded once to
   * the minor unit (domain rules §7). Capped at what's left unrefunded.
   *
   * "Before it" counts every other seat on this Membership already refunded,
   * owed, or waiting with an amount (a Stripe refund in flight, or one waiting
   * for the Owner) — so two seats resolved together, or one resolved later,
   * still get consecutive shares. A waiting seat that ends up credited or kept
   * has its amount cleared and drops out.
   */
  private async perClassShare(tx: TenantTx, seat: SeatRef, paid: number, alreadyRefunded: number, classesIncluded: number | null): Promise<number> {
    if (!classesIncluded || classesIncluded <= 0) return 0;
    const counted = { OR: [{ refundResolution: { in: MONEY_RESOLUTIONS } }, { refundResolution: 'PENDING' as const, refundAmount: { not: null } }] };
    const [bookings, attendees] = await Promise.all([
      tx.booking.count({ where: { sourceMembershipId: seat.membershipId, ...counted, ...(seat.attendeeId ? {} : { id: { not: seat.bookingId } }) } }),
      tx.bookingAttendee.count({ where: { membershipId: seat.membershipId, ...counted, ...(seat.attendeeId ? { id: { not: seat.attendeeId } } : {}) } }),
    ]);
    const prior = bookings + attendees;
    if (prior >= classesIncluded) return 0;
    const share = Math.round(((prior + 1) * paid) / classesIncluded) - Math.round((prior * paid) / classesIncluded);
    return Math.min(share, paid - alreadyRefunded);
  }

  /**
   * Sends each planned Stripe refund, after the cancellation itself has
   * committed. Each one locks its Transaction and re-checks it first, the same
   * shape FranchiseFeesService.refund() uses; the idempotency key is the seat,
   * so a retry can never refund one seat twice. A failure leaves the seat
   * PENDING for staff — the cancellation already happened either way.
   */
  async sendStripeRefunds(plans: StripeRefundPlan[]): Promise<{ failed: number }> {
    let failed = 0;
    for (const plan of plans) {
      try {
        await this.sendStripeRefund(plan.studentId, plan.schoolId, plan.seat);
      } catch (err) {
        failed += 1;
        this.logger.error(`Stripe refund failed for Booking ${plan.seat.bookingId}${plan.seat.attendeeId ? ` (guest ${plan.seat.attendeeId})` : ''} — left for staff.`, err as Error);
      }
    }
    return { failed };
  }

  private async sendStripeRefund(studentId: string, schoolId: string, seat: SeatRef): Promise<void> {
    await this.prismaApp.withTenantContext(
      studentId,
      async (tx) => {
        const row = seat.attendeeId
          ? await tx.bookingAttendee.findUniqueOrThrow({ where: { id: seat.attendeeId } })
          : await tx.booking.findUniqueOrThrow({ where: { id: seat.bookingId } });
        if (row.refundResolution !== 'PENDING' || !row.refundAmount) return;
        const payment = await tx.transaction.findFirst({
          where: { membershipId: seat.membershipId, status: 'SUCCESSFUL', paymentMethod: 'STRIPE', stripePaymentIntentId: { not: null } },
          orderBy: { billingDate: 'desc' },
        });
        if (!payment) throw new Error('No refundable Stripe payment for this Membership.');
        await tx.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${payment.id} FOR UPDATE`;
        const fresh = await tx.transaction.findUniqueOrThrow({ where: { id: payment.id } });
        const alreadyRefunded = fresh.refundedAmount ?? 0;
        if (fresh.status !== 'SUCCESSFUL' || alreadyRefunded + row.refundAmount > fresh.amount) {
          throw new Error(`Transaction ${fresh.id} can no longer cover this refund.`);
        }

        const refundId = await this.paymentsService.refundPayment(
          studentId,
          schoolId,
          fresh.stripePaymentIntentId!,
          row.refundAmount,
          `booking-refund-${seat.attendeeId ?? seat.bookingId}`,
        );

        const newRefunded = alreadyRefunded + row.refundAmount;
        await tx.transaction.update({
          where: { id: fresh.id },
          data: { refundedAmount: newRefunded, status: newRefunded >= fresh.amount ? 'REFUNDED' : fresh.status },
        });
        const data = { refundResolution: 'MONEY_REFUNDED' as const, stripeRefundId: refundId, resolvedAt: new Date() };
        if (seat.attendeeId) {
          await tx.bookingAttendee.update({ where: { id: seat.attendeeId }, data });
        } else {
          await tx.booking.update({ where: { id: seat.bookingId }, data });
        }
      },
      { timeoutMs: 15_000 },
    );
  }

  /**
   * Gives a class credit back — unchanged from BookingsService's original
   * restoreCredit(), moved here so both single and whole-class cancellations
   * share it.
   *
   * Decision 111 — frozen while this Membership's own purchase Transaction is
   * under an active Stripe dispute (Decision 55's "refund/credit-restore
   * frozen while disputed"). Only the credit-restore is frozen, not the
   * cancellation itself.
   *
   * FLAGGED, not fully closed (carried over): this reads Transaction through
   * the organizer's own tenant context, which can't see a guest's Transaction
   * when the organizer isn't School staff.
   */
  async restoreCredit(tx: TenantTx, membershipId: string): Promise<void> {
    const membership = await tx.membership.findUniqueOrThrow({ where: { id: membershipId } });
    if (membership.classesRemaining === null) {
      // General-access (classesRemaining IS NULL) was never decremented at
      // booking time — nothing to restore.
      return;
    }
    const disputedTransaction = await tx.transaction.findFirst({ where: { membershipId, status: 'DISPUTED' } });
    if (disputedTransaction) {
      this.logger.warn(`Membership ${membershipId}'s credit-restore skipped — its Transaction ${disputedTransaction.id} is under an active Stripe dispute (Decision 55/111).`);
      return;
    }
    await tx.membership.update({ where: { id: membershipId }, data: { classesRemaining: { increment: 1 } } });
  }

  /**
   * POST /classes/{id}/cancel — the School cancels a whole class. Every Upcoming
   * booking is cancelled and resolved by School.schoolCancelledClassResolution
   * (no late fee: the student didn't cancel), the waitlist is closed, and
   * everyone booked or waiting is told, with the staff member's reason.
   */
  async cancelClass(callerId: string, classId: string, reason: string | undefined) {
    const cls = await this.prismaApp.withTenantContext(callerId, (tx) => tx.class.findUnique({ where: { id: classId } }));
    if (!cls) throw new NotFoundException('Class not found');
    const { isOwner } = await this.assertCancellationStaff(callerId, cls.schoolId, cls.branchId);
    if (cls.cancelledAt) throw new ConflictException('This class is already cancelled.');
    if (cls.endDate <= new Date()) throw new BadRequestException('This class has already finished.');

    const trimmedReason = reason?.trim() || null;
    const marked = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.class.updateMany({
        where: { id: classId, cancelledAt: null },
        data: { cancelledAt: new Date(), cancelledById: callerId, cancellationReason: trimmedReason },
      }),
    );
    if (marked.count === 0) throw new ConflictException('This class is already cancelled.');

    const school = await this.prismaJobs.school.findUniqueOrThrow({ where: { id: cls.schoolId } });
    const base = this.outcomeForClassCancel(await this.settingsFor(cls.schoolId, cls.branchId));

    const bookings = await this.prismaJobs.booking.findMany({
      where: { classId, status: 'UPCOMING' },
      select: { id: true, studentId: true, sourceMembershipId: true, attendees: { select: { id: true, membershipId: true } } },
    });

    const refunds: StripeRefundPlan[] = [];
    let needsStaff = 0;
    for (const booking of bookings) {
      const results = await this.prismaApp.withTenantContext(booking.studentId, async (tx) => {
        const updated = await tx.booking.updateMany({ where: { id: booking.id, status: 'UPCOMING' }, data: { status: 'CANCELLED' } });
        if (updated.count === 0) return [];
        const seats: SeatRef[] = [
          { bookingId: booking.id, attendeeId: null, membershipId: booking.sourceMembershipId },
          ...booking.attendees.map((a) => ({ bookingId: booking.id, attendeeId: a.id, membershipId: a.membershipId })),
        ];
        const out: Array<{ seat: SeatRef; result: SeatResult }> = [];
        for (const seat of seats) {
          const result = await this.resolveSeat(tx, seat, base, isOwner);
          await this.writeSeat(tx, seat, result, callerId);
          out.push({ seat, result });
        }
        return out;
      });
      for (const { seat, result } of results) {
        if (result.stripeRefund) refunds.push({ seat, studentId: booking.studentId, schoolId: cls.schoolId });
        else if (OPEN_RESOLUTIONS.includes(result.resolution)) needsStaff += 1;
      }
    }
    const { failed } = await this.sendStripeRefunds(refunds);
    needsStaff += failed;

    const waiting = await this.prismaJobs.waitlistEntry.findMany({
      where: { classId, status: { in: ['WAITING', 'NOTIFIED'] } },
      select: { id: true, studentId: true },
    });
    await this.prismaJobs.waitlistEntry.updateMany({
      where: { id: { in: waiting.map((w) => w.id) }, status: { in: ['WAITING', 'NOTIFIED'] } },
      data: { status: 'CANCELLED' },
    });

    const branch = cls.branchId ? await this.prismaJobs.branch.findUnique({ where: { id: cls.branchId }, select: { timezone: true } }) : null;
    const when = formatClassTime(cls.startDate, branch?.timezone ?? school.timezone ?? 'UTC');
    // The portal translates these exact shapes (i18n/server/translate.ts) — keep them in step.
    const body = `${cls.title} on ${when} has been cancelled by the school.${trimmedReason ? ` Reason: ${trimmedReason}` : ''}`;
    const recipients = new Set([...bookings.map((b) => b.studentId), ...waiting.map((w) => w.studentId)]);
    for (const userId of recipients) {
      await this.notify({ notificationId: `class-cancelled-${classId}-${userId}`, userId, title: 'Class cancelled', body, type: 'CLASS_CANCELLED' });
    }
    if (needsStaff > 0) {
      await this.alertOwners(cls.schoolId, `class-cancelled-review-${classId}`, `Bookings from the cancelled class ${cls.title} need a refund decision or a cash refund paid (${needsStaff}). See Cancellations to resolve.`);
    }

    return this.prismaApp.withTenantContext(callerId, (tx) => tx.class.findUniqueOrThrow({ where: { id: classId } }));
  }

  /**
   * GET /schools/{id}/cancellations — the staff "to resolve" list: every seat
   * waiting for a decision (PENDING) or a cash/bank refund still to pay
   * (REFUND_OWED). Read under the caller's own context, so Branch Staff only
   * see their own branches' bookings (booking_staff_read), and plan/payment
   * details only come back for an Owner/Manager — Branch Staff have no raw
   * Membership/Transaction access (domain rules §3).
   */
  async listOpen(callerId: string, schoolId: string) {
    const { isOwner } = await this.assertCancellationStaff(callerId, schoolId, null);
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const [bookings, attendees] = await Promise.all([
        tx.booking.findMany({
          where: { schoolId, status: 'CANCELLED', refundResolution: { in: OPEN_RESOLUTIONS } },
          select: { id: true, studentId: true, classId: true, branchId: true, sourceMembershipId: true, refundResolution: true, refundAmount: true, updatedAt: true },
        }),
        tx.bookingAttendee.findMany({
          where: { schoolId, refundResolution: { in: OPEN_RESOLUTIONS }, booking: { status: 'CANCELLED' } },
          select: { id: true, membershipId: true, refundResolution: true, refundAmount: true, updatedAt: true, booking: { select: { id: true, studentId: true, classId: true, branchId: true } } },
        }),
      ]);
      const rows = [
        ...bookings.map((b) => ({ bookingId: b.id, attendeeId: null as string | null, studentId: b.studentId, classId: b.classId, branchId: b.branchId, membershipId: b.sourceMembershipId, resolution: b.refundResolution!, refundAmount: b.refundAmount, updatedAt: b.updatedAt })),
        ...attendees.map((a) => ({ bookingId: a.booking.id, attendeeId: a.id as string | null, studentId: a.booking.studentId, classId: a.booking.classId, branchId: a.booking.branchId, membershipId: a.membershipId, resolution: a.refundResolution!, refundAmount: a.refundAmount, updatedAt: a.updatedAt })),
      ];
      const classes = await tx.class.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.classId))] } },
        select: { id: true, title: true, startDate: true, cancelledAt: true },
      });
      const classById = new Map(classes.map((c) => [c.id, c]));
      const memberships = isOwner
        ? await tx.membership.findMany({
            where: { id: { in: [...new Set(rows.map((r) => r.membershipId))] } },
            select: { id: true, membershipPlan: { select: { title: true, type: true, currency: true } }, transactions: { select: { paymentMethod: true }, orderBy: { billingDate: 'desc' }, take: 1 } },
          })
        : [];
      const membershipById = new Map(memberships.map((m) => [m.id, m]));
      const names = await resolveUserNames(this.prismaAuth, rows.map((r) => r.studentId));

      return rows
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map((r) => {
          const cls = classById.get(r.classId);
          const m = membershipById.get(r.membershipId);
          const name = names.get(r.studentId);
          return {
            bookingId: r.bookingId,
            attendeeId: r.attendeeId,
            studentId: r.studentId,
            studentName: name ? `${name.firstName} ${name.surname}`.trim() : null,
            classId: r.classId,
            classTitle: cls?.title ?? null,
            classStartDate: cls?.startDate ?? null,
            classCancelledBySchool: Boolean(cls?.cancelledAt),
            resolution: r.resolution,
            refundAmount: r.refundAmount,
            currency: m?.membershipPlan.currency ?? null,
            planTitle: m?.membershipPlan.title ?? null,
            planType: m?.membershipPlan.type ?? null,
            paymentMethod: m?.transactions[0]?.paymentMethod ?? null,
            cancelledAt: r.updatedAt,
          };
        });
    });
  }

  /**
   * PATCH /bookings/{id}/resolution — a staff decision on one open seat.
   * REFUND (Owner/Manager only) sends the money back the same way Auto-refund
   * does; CREDIT gives the class credit back; KEEP gives nothing back;
   * MARK_PAID (Owner/Manager only) records a cash/bank refund as paid out.
   */
  async resolve(callerId: string, bookingId: string, attendeeId: string | undefined, action: ResolveCancellationAction) {
    const booking = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.booking.findUnique({ where: { id: bookingId }, include: { attendees: true } }),
    );
    if (!booking) throw new NotFoundException('Booking not found');
    const { isOwner } = await this.assertCancellationStaff(callerId, booking.schoolId, booking.branchId);
    if ((action === 'REFUND' || action === 'MARK_PAID') && !isOwner) {
      throw new ForbiddenException('Only the School Owner/Manager can send money back (Spec §8.2).');
    }
    const attendee = attendeeId ? booking.attendees.find((a) => a.id === attendeeId) : undefined;
    if (attendeeId && !attendee) throw new NotFoundException('Guest not found on this booking');
    const seat: SeatRef = { bookingId, attendeeId: attendee?.id ?? null, membershipId: attendee?.membershipId ?? booking.sourceMembershipId };
    const current = attendee ? attendee.refundResolution : booking.refundResolution;

    if (booking.status !== 'CANCELLED' || !current || !OPEN_RESOLUTIONS.includes(current)) {
      throw new ConflictException('This booking has nothing left to resolve.');
    }
    if (current === 'REFUND_OWED' && action !== 'MARK_PAID') {
      throw new ConflictException('A refund is already owed on this booking — mark it paid once the money has gone back.');
    }
    if (current === 'PENDING' && action === 'MARK_PAID') {
      throw new ConflictException('There is no cash refund owed on this booking yet.');
    }

    let stripe = false;
    await this.prismaApp.withTenantContext(booking.studentId, async (tx) => {
      // Re-checked under a row lock so two staff can't resolve the same seat twice.
      const table = seat.attendeeId ? 'BookingAttendee' : 'Booking';
      const rows = await tx.$queryRawUnsafe<Array<{ refundResolution: RefundResolution | null }>>(
        `SELECT "refundResolution" FROM "${table}" WHERE id = $1 FOR UPDATE`,
        seat.attendeeId ?? seat.bookingId,
      );
      if (rows[0]?.refundResolution !== current) throw new ConflictException('Someone else has already resolved this booking.');

      if (action === 'MARK_PAID') {
        const amount = (attendee ?? booking).refundAmount ?? 0;
        const payment = await tx.transaction.findFirst({ where: { membershipId: seat.membershipId, status: { in: ['SUCCESSFUL', 'REFUNDED'] } }, orderBy: { billingDate: 'desc' } });
        if (payment && amount > 0) {
          const newRefunded = (payment.refundedAmount ?? 0) + amount;
          await tx.transaction.update({
            where: { id: payment.id },
            data: { refundedAmount: newRefunded, status: newRefunded >= payment.amount ? 'REFUNDED' : payment.status },
          });
        }
        await this.writeSeat(tx, seat, { resolution: 'MONEY_REFUNDED', refundAmount: amount || null, stripeRefund: false }, callerId);
        return;
      }
      const base: BaseOutcome = action === 'REFUND' ? 'MONEY' : action === 'CREDIT' ? 'CREDIT' : 'KEEP';
      const result = await this.resolveSeat(tx, seat, base, true);
      if (action === 'REFUND' && result.resolution === 'PENDING' && !result.stripeRefund) {
        throw new BadRequestException('This booking can\'t be refunded automatically (its payment is disputed, already refunded, or there\'s no paid Class Pack). Give the credit back or keep it instead.');
      }
      await this.writeSeat(tx, seat, result, callerId);
      stripe = result.stripeRefund;
    });

    if (stripe) {
      const { failed } = await this.sendStripeRefunds([{ seat, studentId: booking.studentId, schoolId: booking.schoolId }]);
      if (failed > 0) {
        throw new BadRequestException('Stripe could not process this refund. It is still waiting in the list — try again, or give the credit back instead.');
      }
    }
    return this.prismaApp.withTenantContext(callerId, (tx) => tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { attendees: true } }));
  }

  /** Tells the School's Owners/Managers something in the "to resolve" list needs them. */
  async alertOwners(schoolId: string, key: string, body: string): Promise<void> {
    const owners = await this.prismaJobs.roleGrant.findMany({
      where: { schoolId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null },
      select: { userId: true },
    });
    for (const userId of new Set(owners.map((o) => o.userId))) {
      await this.notify({ notificationId: `${key}-${userId}`, userId, title: 'Cancellations to resolve', body, type: 'CANCELLATION_TO_RESOLVE' });
    }
  }

  /** Fire-and-logged, same as every other post-commit enqueue in this module. */
  private async notify(data: NotificationFanoutJobData): Promise<void> {
    try {
      await this.notificationFanoutQueue.add('notify', data, { jobId: data.notificationId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    } catch (err) {
      this.logger.warn(`Failed to enqueue notification ${data.notificationId}: ${err}`);
    }
  }
}
