import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PlanSwitchOutcome } from '@prisma/client';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { PaymentsService, NoSavedPaymentMethodError } from '../payments/payments.service';
import { planCardSurcharge, readCardSurchargeBps } from '../payments/card-surcharge';
import { takesCards } from '../payments/takes-cards';
import { resolveChargeCurrency } from '../common/school-currency';
import { noticeMoney } from '../charges/charge-ledger';
import { assertCanCreateMembership, GeneralAccessConflictError } from '../memberships/membership-creation-guard';
import { fixedPlanOver, membershipTerm, TERM_PLAN_TYPES } from '../memberships/plan-term';
import { planFullFor } from '../memberships/waitlist/plan-capacity';
import { dayIn } from '../memberships/freeze/membership-freeze';
import { trialEndedUnpaid } from '../subscription-plans/subscription-gate.service';
import { NOTIFICATION_FANOUT_QUEUE, PLAN_SWITCH_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';

/** Every hour, at 20 past (the other hourly jobs run on the hour). */
const CRON_HOURLY = '20 * * * *';
const REPEATABLE_JOB_ID = 'plan-switch';
/** How long before the end the member is told about the switch: the same 7
 * days as the expiry reminder (Decision 317 item 7). */
export const SWITCH_NOTICE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The notices' English text, translated in the apps by shape (@ultm8/i18n server/translate.ts). */
export function planSwitchNotice(planTitle: string, endDay: string, nextTitle: string, amount: string) {
  return {
    title: 'Your plan is about to change',
    body: `Your ${planTitle} ends on ${endDay}. Then ${nextTitle} starts and ${amount} is charged to your saved card. Without a saved card, or if ${nextTitle} is full, it simply ends and nothing is charged.`,
  };
}
export function planSwitchedNotice(planTitle: string, nextTitle: string, amount: string) {
  return { title: 'Your plan has changed', body: `Your ${planTitle} has ended and ${nextTitle} has started. ${amount} was charged to your saved card.` };
}
export function planSwitchEndedNotice(planTitle: string, nextTitle: string) {
  return { title: 'Membership ended', body: `Your ${planTitle} has ended. ${nextTitle} couldn't be started, so nothing was charged.` };
}

@Injectable()
export class PlanSwitchScheduler implements OnModuleInit {
  private readonly logger = new Logger(PlanSwitchScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(PLAN_SWITCH_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...PlanSwitchScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_HOURLY }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable plan-switch job (retrying): ${err}`);
      }
    }
    this.logger.error('Failed to register the repeatable plan-switch job after all retries — plan switches will not run until this succeeds.');
  }
}

export type PlanSwitchRunOutcome = { noticesSent: number; switched: number; ended: number };

/**
 * Decision 316 item 4, as answered by Decision 435 item 9: "switch to another
 * plan when it ends". The member agreed when buying (Membership.switchAgreedAt,
 * with the plan they agreed to), so:
 *
 * 1. They are told before the switch: up to 7 days before the end (at once for
 *    a shorter plan), once. A switch never runs before they were told.
 * 2. At the end, the next plan is charged to their saved card at this School,
 *    at its price then plus the School's card surcharge (Decision 406), and its
 *    Membership starts. Its own start and end rules apply (plan-term.ts).
 * 3. With no saved card, a declined card, or a next plan that can't be sold
 *    any more (archived, hidden, given a contract, its dates over, full under
 *    its member limit, or the member already holds general access), the
 *    membership simply ends: nothing is charged and nothing goes on their
 *    balance. They are told. A full plan (Decision 435 items 10-15, the
 *    owner's answer of 6 Nov 2026) is checked before the card is charged, by
 *    the same rule as a member's own purchase (planFullFor): a place held for
 *    this member on its waiting list is theirs, so it counts as room.
 * 4. Only once: Membership.switchedAt is claimed before any charge, and the
 *    charge's idempotency key is the membership's, so a retried run never
 *    charges twice. The new Membership doesn't switch on in turn: the member
 *    agreed to one switch.
 *
 * A School whose ULTM8 subscription has lapsed takes no new payments (Spec 55
 * §10.2), so its memberships end too. Never switched, and not told: students
 * who have left the School, closed Schools, a membership no longer active
 * (refunded or ended). A freeze moves the end out (Decision 404), and the
 * switch with it.
 */
@Processor(PLAN_SWITCH_QUEUE)
export class PlanSwitchProcessor extends WorkerHost {
  private readonly logger = new Logger(PlanSwitchProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly payments: PaymentsService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
  ) {
    super();
  }

  async process(): Promise<void> {
    await this.run(new Date());
  }

  /** Separate from process() so tests can pass the date. */
  async run(now: Date): Promise<PlanSwitchRunOutcome> {
    const outcome: PlanSwitchRunOutcome = { noticesSent: 0, switched: 0, ended: 0 };
    await this.sendNotices(now, outcome);
    await this.switchEnded(now, outcome);
    if (outcome.noticesSent || outcome.switched || outcome.ended) {
      this.logger.log(`plan-switch: ${outcome.noticesSent} told, ${outcome.switched} switched, ${outcome.ended} ended.`);
    }
    return outcome;
  }

  private async sendNotices(now: Date, outcome: PlanSwitchRunOutcome): Promise<void> {
    const due = await this.prismaJobs.membership.findMany({
      where: {
        status: 'ACTIVE',
        switchToPlanId: { not: null },
        switchAgreedAt: { not: null },
        switchNoticeSentAt: null,
        expiryDate: { lte: new Date(now.getTime() + SWITCH_NOTICE_DAYS * DAY_MS) },
      },
      select: {
        id: true,
        studentId: true,
        schoolId: true,
        expiryDate: true,
        membershipPlan: { select: { title: true } },
        switchToPlan: { select: { title: true, price: true, currency: true, type: true } },
      },
    });
    if (due.length === 0) return;
    const schools = await this.prismaJobs.school.findMany({ where: { id: { in: [...new Set(due.map((m) => m.schoolId))] }, archivedAt: null }, select: { id: true, timezone: true } });
    const zoneOf = new Map(schools.map((s) => [s.id, s.timezone]));
    for (const m of due) {
      if (!zoneOf.has(m.schoolId) || !m.switchToPlan || !m.expiryDate) continue;
      const claimed = await this.prismaJobs.membership.updateMany({ where: { id: m.id, switchNoticeSentAt: null }, data: { switchNoticeSentAt: now } });
      if (claimed.count === 0) continue;
      const currency = await resolveChargeCurrency(this.prismaJobs, m.schoolId, m.switchToPlan.currency);
      const bps = await readCardSurchargeBps(this.prismaJobs, m.schoolId);
      const amount = m.switchToPlan.price + planCardSurcharge(m.switchToPlan, bps, currency);
      if (!currency) continue;
      const notice = planSwitchNotice(m.membershipPlan.title, dayIn(m.expiryDate, zoneOf.get(m.schoolId)), m.switchToPlan.title, noticeMoney(amount, currency));
      await this.notify({ notificationId: `plan-switch-notice-${m.id}`, userId: m.studentId, title: notice.title, body: notice.body, type: 'MEMBERSHIP_EXPIRY', schoolId: m.schoolId });
      outcome.noticesSent++;
    }
  }

  private async switchEnded(now: Date, outcome: PlanSwitchRunOutcome): Promise<void> {
    const ended = await this.prismaJobs.membership.findMany({
      where: {
        status: 'ACTIVE',
        switchToPlanId: { not: null },
        switchAgreedAt: { not: null },
        // Told in an earlier run, never in the same breath as the switch.
        switchNoticeSentAt: { lt: now },
        switchedAt: null,
        expiryDate: { lte: now },
      },
      select: { id: true },
    });
    for (const { id } of ended) {
      try {
        const result = await this.switchOne(id, now);
        if (result === 'SWITCHED') outcome.switched++;
        else if (result) outcome.ended++;
      } catch (err) {
        this.logger.error(`plan-switch: membership ${id} could not be switched.`, err as Error);
      }
    }
  }

  /** One membership past its end. Returns its outcome, or null when another
   * run already took it. */
  private async switchOne(membershipId: string, now: Date): Promise<PlanSwitchOutcome | null> {
    const claimed = await this.prismaJobs.membership.updateMany({ where: { id: membershipId, switchedAt: null }, data: { switchedAt: now } });
    if (claimed.count === 0) return null;
    const m = await this.prismaJobs.membership.findUniqueOrThrow({
      where: { id: membershipId },
      include: { membershipPlan: { select: { title: true } }, switchToPlan: true },
    });
    const school = await this.prismaJobs.school.findUniqueOrThrow({
      where: { id: m.schoolId },
      select: { timezone: true, archivedAt: true, platformSubscriptionStatus: true, platformTrialEndsAt: true },
    });
    const next = m.switchToPlan!;
    const end = async (outcomeCode: PlanSwitchOutcome, notifyMember = true) => {
      await this.prismaJobs.membership.update({ where: { id: m.id }, data: { switchOutcome: outcomeCode } });
      if (notifyMember) {
        const notice = planSwitchEndedNotice(m.membershipPlan.title, next.title);
        await this.notify({ notificationId: `plan-switch-ended-${m.id}`, userId: m.studentId, title: notice.title, body: notice.body, type: 'MEMBERSHIP_EXPIRY', schoolId: m.schoolId });
      }
      return outcomeCode;
    };

    // Left alone: a closed School, or a member who has left it.
    if (school.archivedAt) return end('NOT_SOLD', false);
    const enrolled = await this.prismaJobs.roleGrant.findFirst({ where: { userId: m.studentId, schoolId: m.schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } });
    if (!enrolled) return end('NOT_SOLD', false);
    // No new payments while the School's ULTM8 subscription has lapsed (Spec 55 §10.2).
    if (school.platformSubscriptionStatus === 'CANCELED' || trialEndedUnpaid(school, now)) return end('NOT_SOLD');
    const nextSellable =
      next.schoolId === m.schoolId &&
      !next.archivedAt &&
      next.visible &&
      next.contractVersion === null &&
      next.price > 0 &&
      (TERM_PLAN_TYPES as readonly string[]).includes(next.type) &&
      !fixedPlanOver(next, school.timezone, now);
    if (!nextSellable) return end('NOT_SOLD');
    // No room under the next plan's member limit: it can't be sold to them
    // now, so it ends as above, before anything is charged.
    if (await planFullFor(this.prismaJobs, next, m.studentId, now)) return end('NOT_SOLD');
    const account = await this.prismaJobs.paymentAccount.findUnique({ where: { schoolId: m.schoolId } });
    const student = await this.prismaJobs.user.findUniqueOrThrow({ where: { id: m.studentId }, select: { paymentRestrictedAt: true } });
    // Decision 442 item 2: a Stripe account not ready yet takes no cards.
    if (!account || !takesCards(account) || student.paymentRestrictedAt) return end('NO_CARD');
    const currency = await resolveChargeCurrency(this.prismaJobs, m.schoolId, next.currency);
    if (!currency) return end('NOT_SOLD');
    const surcharge = planCardSurcharge(next, await readCardSurchargeBps(this.prismaJobs, m.schoolId), currency);

    let charge: { succeeded: boolean; paymentIntentId: string };
    try {
      charge = await this.payments.chargeOffSession(m.studentId, m.schoolId, next.price + surcharge, currency, next.title, `plan-switch-${m.id}`, surcharge);
    } catch (err) {
      if (err instanceof NoSavedPaymentMethodError) return end('NO_CARD');
      throw err;
    }
    const baseRow = {
      schoolId: m.schoolId,
      studentId: m.studentId,
      paymentAccountId: account.id,
      membershipPlanId: next.id,
      amount: next.price,
      surchargeAmount: surcharge,
      currency: currency.toUpperCase(),
      paymentMethod: 'STRIPE' as const,
    };
    if (!charge.succeeded) {
      // Recorded for the ledger as a failed attempt, as a declined saved-card
      // purchase is; nothing is owed.
      await this.prismaJobs.transaction.create({ data: { id: randomUUID(), ...baseRow, status: 'FAILED', stripePaymentIntentId: charge.paymentIntentId || undefined } });
      return end('DECLINED');
    }

    let newMembershipId: string;
    try {
      newMembershipId = await this.prismaJobs.$transaction(async (tx) => {
        await assertCanCreateMembership(tx, m.studentId, m.schoolId, next, now);
        const term = membershipTerm(next, school.timezone, now);
        const created = await tx.membership.create({
          data: {
            id: randomUUID(),
            studentId: m.studentId,
            membershipPlanId: next.id,
            schoolId: m.schoolId,
            frequency: 'ONE_TIME',
            classesRemaining: next.classesIncluded ?? undefined,
            startDate: term.startDate,
            expiryDate: term.expiryDate,
            awaitingFirstCheckIn: term.awaitingFirstCheckIn,
            scopedClassId: next.scopedClassId,
          },
        });
        await tx.transaction.create({ data: { id: randomUUID(), ...baseRow, membershipId: created.id, status: 'SUCCESSFUL', stripePaymentIntentId: charge.paymentIntentId } });
        await tx.membership.update({ where: { id: m.id }, data: { switchOutcome: 'SWITCHED', switchedToMembershipId: created.id } });
        return created.id;
      });
    } catch (err) {
      if (!(err instanceof GeneralAccessConflictError)) throw err;
      // The member already holds general access (bought since): the card is
      // refunded in full and the old membership simply ends.
      await this.payments.refundOffSessionCharge(m.studentId, m.schoolId, charge.paymentIntentId);
      await this.prismaJobs.transaction.create({
        data: { id: randomUUID(), ...baseRow, status: 'REFUNDED', refundedAmount: next.price + surcharge, stripePaymentIntentId: charge.paymentIntentId },
      });
      return end('NOT_SOLD');
    }
    const notice = planSwitchedNotice(m.membershipPlan.title, next.title, noticeMoney(next.price + surcharge, currency));
    await this.notify({ notificationId: `plan-switched-${m.id}`, userId: m.studentId, title: notice.title, body: notice.body, type: 'MEMBERSHIP_EXPIRY', schoolId: m.schoolId });
    this.logger.log(`plan-switch: membership ${m.id} switched to ${newMembershipId}.`);
    return 'SWITCHED';
  }

  /** Best-effort, as the other notice jobs. */
  private async notify(data: NotificationFanoutJobData) {
    try {
      await this.fanoutQueue.add('notify', data, { jobId: data.notificationId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    } catch (err) {
      this.logger.warn(`Failed to enqueue the plan-switch notice ${data.notificationId}: ${err}`);
    }
  }
}
