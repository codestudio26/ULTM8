import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { MembershipFreeze, Prisma } from '@prisma/client';
import { PrismaJobsService } from '../../common/prisma/prisma-jobs.service';
import { TenantAuthorizationService } from '../../tenants/tenant-authorization.service';
import { PaymentsService, NoSavedPaymentMethodError } from '../../payments/payments.service';
import { StripeClientService } from '../../payments/stripe-client.service';
import { NOTIFICATION_FANOUT_QUEUE } from '../../jobs/queue.constants';
import { NotificationFanoutJobData } from '../../jobs/notification-fanout.types';
import { isMembershipLive } from '../membership-creation-guard';
import { applyFreezeBillingShift, restoreFreezeBilling } from './freeze-billing';
import {
  assertFreezeAllowed,
  backDay,
  currentFreeze,
  dayIn,
  dayNumber,
  dayString,
  dayToDate,
  FreezeRuleError,
  freezeSummary,
  FreezeSummary,
  isFreezablePlanType,
  isFrozenOn,
} from './membership-freeze';
import { CreateMembershipFreezeDto } from './dto/membership-freeze.dto';
import { loadFreezeStates } from './freeze-states';

const DAY_MS = 24 * 60 * 60 * 1000;
const FREEZE_NOT_FOUND = { code: 'FREEZE_NOT_FOUND', message: 'Freeze not found' };

/**
 * Decision 404: freezing a membership.
 *
 * - The School's owner freezes a membership straight away (createByStaff), and
 *   approves or declines what members ask for. Owner only, like selling and
 *   cancelling memberships (Decision 348).
 * - A member, or the Guardian for a child, asks for a freeze in the app
 *   (request), withdraws a request (cancel) or ends a freeze early (end).
 * - Length: at least 7 days, starting today or later, within the School's
 *   maximum frozen days in any 12 months (default 90); no overlap.
 * - Approval moves a fixed-term membership's expiry date later by the freeze,
 *   moves a card Subscription's next charge (freeze-billing.ts; on the start
 *   day, by the 15-minute sweep when that is later), and charges the School's
 *   freeze fee once: on the member's saved card, else a pending cash charge the
 *   desk collects. Ending early moves both back by the days not frozen;
 *   billing restarts that day and the fee is kept.
 *
 * MembershipFreeze is read and written on the jobs connection only, after the
 * checks here (its migration's comment says why). Every lookup by id is
 * matched to the School in the path or to the caller's own (or own child's)
 * membership, so another School's freeze is a 404, never a 403.
 */
@Injectable()
export class MembershipFreezesService {
  private readonly logger = new Logger(MembershipFreezesService.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly paymentsService: PaymentsService,
    private readonly stripeClient: StripeClientService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly notificationFanoutQueue: Queue,
  ) {}

  // ---------------------------------------------------------------------------
  // Staff (the School's owner)
  // ---------------------------------------------------------------------------

  /** POST /schools/:schoolId/memberships/:membershipId/freezes — frozen at once. */
  async createByStaff(callerId: string, schoolId: string, membershipId: string, dto: CreateMembershipFreezeDto) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const membership = await this.prismaJobs.membership.findFirst({ where: { id: membershipId, schoolId }, select: { id: true } });
    if (!membership) throw new NotFoundException('Membership not found');
    const freeze = await this.approve({ membershipId, startsAt: dto.startsAt, endsAt: dto.endsAt, actorId: callerId, requestId: null });
    await this.afterApproval(freeze);
    return this.toResponse(await this.reload(freeze.id));
  }

  /** GET /schools/:schoolId/freezes — the School's freezes, newest first. */
  async listForSchool(callerId: string, schoolId: string, status?: MembershipFreeze['status']) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const rows = await this.prismaJobs.membershipFreeze.findMany({
      where: { schoolId, ...(status ? { status } : {}) },
      include: {
        student: { select: { firstName: true, surname: true } },
        membership: { select: { membershipPlan: { select: { title: true, type: true } } } },
        school: { select: { timezone: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 500,
    });
    return {
      items: rows.map((f) => ({
        ...this.toResponse(f),
        studentFirstName: f.student.firstName,
        studentSurname: f.student.surname,
        planTitle: f.membership.membershipPlan.title,
        planType: f.membership.membershipPlan.type,
      })),
    };
  }

  /** POST /schools/:schoolId/freezes/:id/approve. */
  async approveRequest(callerId: string, schoolId: string, freezeId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const request = await this.findInSchool(schoolId, freezeId);
    if (request.status !== 'REQUESTED') throw this.alreadyDecided();
    const freeze = await this.approve({
      membershipId: request.membershipId,
      startsAt: dayString(dayNumber(request.startsAt)),
      endsAt: dayString(dayNumber(request.endsAt)),
      actorId: callerId,
      requestId: request.id,
    });
    await this.afterApproval(freeze);
    return this.toResponse(await this.reload(freeze.id));
  }

  /** POST /schools/:schoolId/freezes/:id/decline. */
  async declineRequest(callerId: string, schoolId: string, freezeId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const request = await this.findInSchool(schoolId, freezeId);
    const result = await this.prismaJobs.membershipFreeze.updateMany({
      where: { id: request.id, status: 'REQUESTED' },
      data: { status: 'DECLINED', decidedById: callerId, decidedAt: new Date() },
    });
    if (result.count === 0) throw this.alreadyDecided();
    const declined = await this.reload(request.id);
    await this.notifyDecision(declined, 'declined');
    return this.toResponse(declined);
  }

  /** POST /schools/:schoolId/freezes/:id/end — staff end a freeze early. */
  async endByStaff(callerId: string, schoolId: string, freezeId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const freeze = await this.findInSchool(schoolId, freezeId);
    return this.toResponse(await this.endEarly(freeze.id));
  }

  // ---------------------------------------------------------------------------
  // The member, or the Guardian for a child
  // ---------------------------------------------------------------------------

  /** POST /memberships/:membershipId/freeze-requests. */
  async request(callerId: string, membershipId: string, dto: CreateMembershipFreezeDto) {
    const membership = await this.prismaJobs.membership.findUnique({ where: { id: membershipId }, select: { id: true, studentId: true, schoolId: true } });
    if (!membership || !(await this.actsFor(callerId, membership.studentId))) throw new NotFoundException('Membership not found');
    const school = await this.prismaJobs.school.findUniqueOrThrow({ where: { id: membership.schoolId }, select: { archivedAt: true } });
    if (school.archivedAt) {
      throw new ForbiddenException('This School has been closed and no longer accepts new or updated records.');
    }
    const id = randomUUID();
    await this.prismaJobs.$transaction(async (tx) => {
      const ctx = await this.lockAndLoad(tx, membershipId);
      this.checkRules(ctx, dto.startsAt, dto.endsAt);
      await tx.membershipFreeze.create({
        data: {
          id,
          membershipId,
          schoolId: ctx.membership.schoolId,
          studentId: ctx.membership.studentId,
          startsAt: dayToDate(dto.startsAt),
          endsAt: dayToDate(dto.endsAt),
          status: 'REQUESTED',
          requestedById: callerId,
        },
      });
    });
    return this.toResponse(await this.reload(id));
  }

  /** POST /freezes/:id/cancel — withdraw a request nobody has decided yet. */
  async cancelRequest(callerId: string, freezeId: string) {
    const freeze = await this.findForMember(callerId, freezeId);
    const result = await this.prismaJobs.membershipFreeze.updateMany({
      where: { id: freeze.id, status: 'REQUESTED' },
      data: { status: 'CANCELLED', decidedById: callerId, decidedAt: new Date() },
    });
    if (result.count === 0) throw this.alreadyDecided();
    return this.toResponse(await this.reload(freeze.id));
  }

  /** POST /freezes/:id/end — the member ends their freeze early. */
  async endByMember(callerId: string, freezeId: string) {
    const freeze = await this.findForMember(callerId, freezeId);
    return this.toResponse(await this.endEarly(freeze.id));
  }

  /**
   * GET /memberships/freezes/me — the caller's own memberships that can be
   * frozen, and their linked children's, each with its current freeze or
   * request and the School's limits.
   */
  async listMine(callerId: string) {
    const links = await this.prismaJobs.guardianLink.findMany({ where: { guardianId: callerId, revokedAt: null }, select: { studentId: true } });
    const studentIds = [callerId, ...links.map((l) => l.studentId)];
    const memberships = await this.prismaJobs.membership.findMany({
      where: { studentId: { in: studentIds }, status: 'ACTIVE', membershipPlan: { type: { in: ['SUBSCRIPTION', 'WEEKLY_PASS', 'TRIAL_MEMBERSHIP'] } } },
      include: { membershipPlan: { select: { title: true, type: true, currency: true } }, student: { select: { firstName: true } }, freezes: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    const now = new Date();
    const live = memberships.filter((m) => isMembershipLive(m, now));
    const schoolIds = [...new Set(live.map((m) => m.schoolId))];
    const [schools, grants] = await Promise.all([
      this.prismaJobs.school.findMany({
        where: { id: { in: schoolIds } },
        select: { id: true, name: true, timezone: true, freezeMaxDaysPer12Months: true, freezeFeeAmount: true, defaultCurrency: true, archivedAt: true },
      }),
      // Only a current Student of the School (Decision 334, M18).
      this.prismaJobs.roleGrant.findMany({
        where: { userId: { in: studentIds }, schoolId: { in: schoolIds }, role: 'STUDENT', revokedAt: null },
        select: { userId: true, schoolId: true },
      }),
    ]);
    const bySchool = new Map(schools.map((s) => [s.id, s]));
    const current = new Set(grants.map((g) => `${g.userId}:${g.schoolId}`));
    return {
      items: live
        .filter((m) => current.has(`${m.studentId}:${m.schoolId}`) && !bySchool.get(m.schoolId)?.archivedAt)
        .map((m) => {
          const school = bySchool.get(m.schoolId)!;
          const today = dayIn(now, school.timezone);
          return {
            membershipId: m.id,
            studentId: m.studentId,
            studentFirstName: m.student.firstName,
            self: m.studentId === callerId,
            schoolId: m.schoolId,
            schoolName: school.name,
            planTitle: m.membershipPlan.title,
            planType: m.membershipPlan.type,
            expiryDate: m.expiryDate ? m.expiryDate.toISOString() : null,
            frozen: m.freezes.some((f) => isFrozenOn(f, today, school.timezone)),
            freeze: freezeSummary(currentFreeze(m.freezes, today, school.timezone), school.timezone),
            maxDaysPer12Months: school.freezeMaxDaysPer12Months,
            feeAmount: school.freezeFeeAmount,
            currency: (school.defaultCurrency ?? m.membershipPlan.currency)?.toUpperCase() ?? null,
            today,
          };
        }),
    };
  }

  // ---------------------------------------------------------------------------
  // Shared with the membership reads (MembershipsService, SchoolsService)
  // ---------------------------------------------------------------------------

  /** Each membership's current freeze or request, and whether it is frozen
   * today. For memberships the caller has already been allowed to read. */
  async freezeStates(membershipIds: string[]): Promise<Map<string, { frozen: boolean; freeze: FreezeSummary | null }>> {
    return loadFreezeStates(this.prismaJobs, membershipIds);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** The member themselves, or an active Guardian of the member. */
  private async actsFor(callerId: string, studentId: string): Promise<boolean> {
    if (callerId === studentId) return true;
    const link = await this.prismaJobs.guardianLink.findUnique({ where: { guardianId_studentId: { guardianId: callerId, studentId } }, select: { revokedAt: true } });
    return !!link && !link.revokedAt;
  }

  private async findInSchool(schoolId: string, freezeId: string) {
    const freeze = await this.prismaJobs.membershipFreeze.findFirst({ where: { id: freezeId, schoolId } });
    if (!freeze) throw new NotFoundException(FREEZE_NOT_FOUND);
    return freeze;
  }

  private async findForMember(callerId: string, freezeId: string) {
    const freeze = await this.prismaJobs.membershipFreeze.findUnique({ where: { id: freezeId } });
    if (!freeze || !(await this.actsFor(callerId, freeze.studentId))) throw new NotFoundException(FREEZE_NOT_FOUND);
    return freeze;
  }

  private reload(id: string) {
    return this.prismaJobs.membershipFreeze.findUniqueOrThrow({ where: { id }, include: { school: { select: { timezone: true } } } });
  }

  private alreadyDecided() {
    return new ConflictException({ code: 'FREEZE_ALREADY_DECIDED', message: 'This freeze request has already been approved, declined or withdrawn.' });
  }

  /**
   * Serializes every freeze change on one membership until the transaction
   * ends, then reads what the rules need: the membership, its plan, its other
   * freezes, the School's settings and whether the member is still a Student.
   */
  private async lockAndLoad(tx: Prisma.TransactionClient, membershipId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`membership-freeze:${membershipId}`}, 0))`;
    const membership = await tx.membership.findUniqueOrThrow({
      where: { id: membershipId },
      include: { membershipPlan: { select: { type: true, title: true, currency: true } }, freezes: true },
    });
    const school = await tx.school.findUniqueOrThrow({
      where: { id: membership.schoolId },
      select: { timezone: true, freezeMaxDaysPer12Months: true, freezeFeeAmount: true, defaultCurrency: true },
    });
    const enrolled = await tx.roleGrant.findFirst({
      where: { userId: membership.studentId, schoolId: membership.schoolId, role: 'STUDENT', revokedAt: null },
      select: { id: true },
    });
    return { membership, school, enrolled: !!enrolled, today: dayIn(new Date(), school.timezone) };
  }

  /**
   * Which memberships can be frozen, and the length rules. Returns the freeze's
   * length in days. Class packs can't be frozen (Decision 404); friend and
   * visit passes neither, nor a membership that has ended, is set to cancel,
   * or whose member has left the School.
   */
  private checkRules(ctx: Awaited<ReturnType<MembershipFreezesService['lockAndLoad']>>, startsAt: string, endsAt: string, ignoreId?: string): number {
    const { membership, school, today } = ctx;
    const type = membership.membershipPlan.type;
    if (type === 'CLASS_PACK') {
      throw new BadRequestException({ code: 'FREEZE_CLASS_PACK', message: "A class pack can't be frozen." });
    }
    if (!isFreezablePlanType(type)) {
      throw new BadRequestException({ code: 'FREEZE_NOT_FREEZABLE', message: "This kind of membership can't be frozen." });
    }
    if (!ctx.enrolled || !isMembershipLive(membership)) {
      throw new BadRequestException({ code: 'FREEZE_MEMBERSHIP_ENDED', message: "This membership has ended, so it can't be frozen." });
    }
    if (membership.cancelAt) {
      throw new BadRequestException({ code: 'FREEZE_CANCELLING', message: "This membership is set to end, so it can't be frozen." });
    }
    if (membership.expiryDate && dayNumber(startsAt) >= dayNumber(dayIn(membership.expiryDate, school.timezone))) {
      throw new BadRequestException({ code: 'FREEZE_AFTER_END', message: 'A freeze must start before the membership ends.' });
    }
    try {
      return assertFreezeAllowed({
        startsAt,
        endsAt,
        today,
        maxDays: school.freezeMaxDaysPer12Months,
        others: membership.freezes,
        zone: school.timezone,
        ignoreId,
      });
    } catch (err) {
      if (err instanceof FreezeRuleError) throw new BadRequestException({ code: err.code, message: err.message });
      throw err;
    }
  }

  /**
   * Makes an APPROVED freeze, from staff directly (requestId null) or from a
   * member's request, re-checking every rule under the membership's lock. A
   * fixed-term membership's expiry date moves later by the freeze's length in
   * the same transaction.
   */
  private async approve(input: { membershipId: string; startsAt: string; endsAt: string; actorId: string; requestId: string | null }) {
    const id = input.requestId ?? randomUUID();
    await this.prismaJobs.$transaction(async (tx) => {
      const ctx = await this.lockAndLoad(tx, input.membershipId);
      const days = this.checkRules(ctx, input.startsAt, input.endsAt, input.requestId ?? undefined);
      const fee = ctx.school.freezeFeeAmount;
      if (fee) {
        const account = await tx.paymentAccount.findUnique({ where: { schoolId: ctx.membership.schoolId }, select: { id: true } });
        if (!account || !(ctx.school.defaultCurrency ?? ctx.membership.membershipPlan.currency)) {
          throw new BadRequestException({
            code: 'FREEZE_FEE_NO_PAYMENTS',
            message: "This School charges a freeze fee but has no payments or currency set up. Set them up, or remove the fee, first.",
          });
        }
      }
      const now = new Date();
      if (input.requestId) {
        const result = await tx.membershipFreeze.updateMany({
          where: { id, status: 'REQUESTED' },
          data: { status: 'APPROVED', decidedById: input.actorId, decidedAt: now, feeAmount: fee },
        });
        if (result.count === 0) throw this.alreadyDecided();
      } else {
        await tx.membershipFreeze.create({
          data: {
            id,
            membershipId: input.membershipId,
            schoolId: ctx.membership.schoolId,
            studentId: ctx.membership.studentId,
            startsAt: dayToDate(input.startsAt),
            endsAt: dayToDate(input.endsAt),
            status: 'APPROVED',
            requestedById: input.actorId,
            decidedById: input.actorId,
            decidedAt: now,
            feeAmount: fee,
          },
        });
      }
      if (ctx.membership.expiryDate) {
        await tx.membership.update({
          where: { id: input.membershipId },
          data: { expiryDate: new Date(ctx.membership.expiryDate.getTime() + days * DAY_MS) },
        });
      }
    });
    return this.reload(id);
  }

  /** After an approval commits: the Subscription's next charge (when the
   * freeze starts today), the fee, and the member's notice. None of these
   * undo the approval when they fail; the sweep retries the billing. */
  private async afterApproval(freeze: MembershipFreeze) {
    try {
      await applyFreezeBillingShift(this.prismaJobs, this.stripeClient, freeze.id);
    } catch (err) {
      this.logger.error(`Freeze ${freeze.id}: moving the Subscription's next charge failed; the membership sweep tries again.`, err as Error);
    }
    try {
      await this.chargeFee(freeze.id);
    } catch (err) {
      // The freeze stands; the owner sees no fee on the Transactions page and can record one at the desk.
      this.logger.error(`Freeze ${freeze.id}: recording the freeze fee failed.`, err as Error);
    }
    await this.notifyDecision(await this.reload(freeze.id), 'approved');
  }

  /**
   * The School's freeze fee, once per freeze (Decision 404): on the member's
   * saved card at a card School, as a FREEZE_FEE Transaction; with no saved
   * card, or a declined one, a pending cash charge the desk collects (it is
   * marked paid like any cash payment). A declined attempt is kept on the
   * ledger as FAILED, as a late-cancellation fee's is. Never refunded.
   */
  private async chargeFee(freezeId: string) {
    const freeze = await this.prismaJobs.membershipFreeze.findUniqueOrThrow({
      where: { id: freezeId },
      include: { membership: { select: { membershipPlan: { select: { currency: true } } } }, school: { select: { defaultCurrency: true } } },
    });
    if (!freeze.feeAmount || freeze.feeTransactionId || freeze.status !== 'APPROVED') return;
    const account = await this.prismaJobs.paymentAccount.findUnique({ where: { schoolId: freeze.schoolId }, select: { id: true, provider: true } });
    const currency = (freeze.school.defaultCurrency ?? freeze.membership.membershipPlan.currency)?.toUpperCase();
    if (!account || !currency) return;
    const base = {
      schoolId: freeze.schoolId,
      studentId: freeze.studentId,
      paymentAccountId: account.id,
      membershipId: freeze.membershipId,
      kind: 'FREEZE_FEE' as const,
      amount: freeze.feeAmount,
      currency,
    };

    let paid: { status: 'SUCCESSFUL' | 'FAILED'; paymentIntentId: string | null } | null = null;
    if (account.provider === 'STRIPE') {
      try {
        const charge = await this.paymentsService.chargeOffSession(
          freeze.studentId,
          freeze.schoolId,
          freeze.feeAmount,
          currency,
          'Membership freeze fee',
          `membership-freeze-fee-${freeze.id}`,
        );
        paid = { status: charge.succeeded ? 'SUCCESSFUL' : 'FAILED', paymentIntentId: charge.paymentIntentId || null };
      } catch (err) {
        if (!(err instanceof NoSavedPaymentMethodError)) {
          this.logger.error(`Freeze ${freeze.id}: the freeze fee card charge failed; a pending desk charge is recorded instead.`, err as Error);
        }
      }
    }

    await this.prismaJobs.$transaction(async (tx) => {
      // One fee per freeze: a second caller finds the first one's Transaction.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`membership-freeze-fee:${freeze.id}`}, 0))`;
      const again = await tx.membershipFreeze.findUniqueOrThrow({ where: { id: freeze.id }, select: { feeTransactionId: true } });
      if (again.feeTransactionId) return;
      let feeTransactionId: string;
      if (paid?.status === 'SUCCESSFUL') {
        feeTransactionId = randomUUID();
        await tx.transaction.create({ data: { ...base, id: feeTransactionId, status: 'SUCCESSFUL', paymentMethod: 'STRIPE', stripePaymentIntentId: paid.paymentIntentId } });
      } else {
        if (paid?.status === 'FAILED') {
          await tx.transaction.create({ data: { ...base, id: randomUUID(), status: 'FAILED', paymentMethod: 'STRIPE', stripePaymentIntentId: paid.paymentIntentId } });
        }
        feeTransactionId = randomUUID();
        await tx.transaction.create({
          data: { ...base, id: feeTransactionId, status: 'PENDING', paymentMethod: account.provider === 'STRIPE' ? 'CASH' : account.provider },
        });
      }
      await tx.membershipFreeze.update({ where: { id: freeze.id }, data: { feeTransactionId } });
    });
  }

  /**
   * Ends an approved freeze early (Decision 404): the member is back today,
   * billing restarts today, a fixed-term expiry date moves back by the days
   * not frozen, and the fee is kept. A freeze that hasn't started yet ends
   * with no days frozen.
   */
  private async endEarly(freezeId: string) {
    await this.prismaJobs.$transaction(async (tx) => {
      const first = await tx.membershipFreeze.findUniqueOrThrow({ where: { id: freezeId }, select: { membershipId: true } });
      const ctx = await this.lockAndLoad(tx, first.membershipId);
      const freeze = ctx.membership.freezes.find((f) => f.id === freezeId)!;
      const today = dayNumber(ctx.today);
      if (freeze.status !== 'APPROVED' || freeze.endedEarlyAt || backDay(freeze, ctx.school.timezone) <= today) {
        throw new ConflictException({ code: 'FREEZE_NOT_RUNNING', message: 'This freeze has already ended, or was never approved.' });
      }
      const now = new Date();
      const unused = dayNumber(freeze.endsAt) - Math.max(dayNumber(freeze.startsAt), today);
      await tx.membershipFreeze.update({ where: { id: freezeId }, data: { endedEarlyAt: now } });
      if (ctx.membership.expiryDate && unused > 0) {
        await tx.membership.update({
          where: { id: ctx.membership.id },
          data: { expiryDate: new Date(ctx.membership.expiryDate.getTime() - unused * DAY_MS) },
        });
      }
    });
    try {
      await restoreFreezeBilling(this.prismaJobs, this.stripeClient, freezeId);
    } catch (err) {
      this.logger.error(`Freeze ${freezeId}: moving the Subscription's next charge back failed; the membership sweep tries again.`, err as Error);
    }
    return this.reload(freezeId);
  }

  /**
   * The member's notice when a freeze is approved (by staff, or a request) or
   * a request is declined. A minor's Guardians get the copy the fan-out makes.
   * Best-effort. The English shapes are matched in @ultm8/i18n's
   * server/translate.ts.
   */
  private async notifyDecision(freeze: MembershipFreeze & { school: { timezone: string | null } }, event: 'approved' | 'declined') {
    try {
      const membership = await this.prismaJobs.membership.findUniqueOrThrow({
        where: { id: freeze.membershipId },
        select: { membershipPlan: { select: { title: true } } },
      });
      const plan = membership.membershipPlan.title;
      const start = dayString(dayNumber(freeze.startsAt));
      const back = dayString(backDay(freeze, freeze.school.timezone));
      const notice =
        event === 'approved'
          ? { title: 'Freeze approved', body: `Your ${plan} membership is frozen from ${start}. You're back on ${back}.` }
          : { title: 'Freeze declined', body: `Your School declined your request to freeze ${plan} from ${start}.` };
      const key = `membership-freeze-${event}-${freeze.id}`;
      await this.notificationFanoutQueue.add(
        'notify',
        { notificationId: key, userId: freeze.studentId, title: notice.title, body: notice.body, type: 'MEMBERSHIP_FREEZE', schoolId: freeze.schoolId } satisfies NotificationFanoutJobData,
        { jobId: key, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    } catch (err) {
      this.logger.warn(`Failed to enqueue the ${event} freeze notice for freeze ${freeze.id}: ${err}`);
    }
  }

  private toResponse(f: MembershipFreeze & { school: { timezone: string | null } }) {
    const today = dayIn(new Date(), f.school.timezone);
    return {
      id: f.id,
      membershipId: f.membershipId,
      schoolId: f.schoolId,
      studentId: f.studentId,
      startsAt: dayString(dayNumber(f.startsAt)),
      endsAt: dayString(dayNumber(f.endsAt)),
      backOn: dayString(f.status === 'APPROVED' ? backDay(f, f.school.timezone) : dayNumber(f.endsAt)),
      status: f.status,
      frozenNow: isFrozenOn(f, today, f.school.timezone),
      endedEarlyAt: f.endedEarlyAt?.toISOString() ?? null,
      requestedById: f.requestedById,
      decidedById: f.decidedById,
      decidedAt: f.decidedAt?.toISOString() ?? null,
      feeAmount: f.feeAmount,
      feeTransactionId: f.feeTransactionId,
      createdAt: f.createdAt.toISOString(),
    };
  }
}
