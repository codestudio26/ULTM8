import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { holdsPlace, lockPlanPlaces, placesTaken } from '../memberships/waitlist/plan-capacity';
import { noticeWallTime } from '../common/notice-time';
import { NOTIFICATION_FANOUT_QUEUE, PLAN_WAITLIST_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';

/** Every 15 minutes, so a freed place is offered soon after. */
const CRON_EVERY_15_MINUTES = '*/15 * * * *';
const REPEATABLE_JOB_ID = 'plan-waitlist';
/** Decision 435 item 11: a freed place is held for 24 hours. */
export const PLACE_HELD_MS = 24 * 60 * 60 * 1000;

/** The offer's English text, translated in the apps by shape (@ultm8/i18n server/translate.ts). */
export function placeHeldNotice(planTitle: string, until: string) {
  return {
    title: 'A place is free',
    body: `A place on ${planTitle} is held for you until ${until}. Buy it before then, or it goes to the next person waiting.`,
  };
}

@Injectable()
export class PlanWaitlistScheduler implements OnModuleInit {
  private readonly logger = new Logger(PlanWaitlistScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(PLAN_WAITLIST_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...PlanWaitlistScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_EVERY_15_MINUTES }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable plan-waitlist job (retrying): ${err}`);
      }
    }
    this.logger.error('Failed to register the repeatable plan-waitlist job after all retries — freed places will not be offered until this succeeds.');
  }
}

export type PlanWaitlistRunOutcome = { offered: number; expired: number; closed: number };

/**
 * Decision 316 item 5, as answered by Decision 435 items 10-15: offers each
 * freed place on a full plan to the first person waiting, held 24 hours.
 *
 * Each run, plan by plan (only plans with a limit and someone in line):
 * 1. A held place whose 24 hours are over is given up (EXPIRED); the place
 *    goes to the next person below.
 * 2. Entries of people who now have the plan (they bought it) become BOUGHT;
 *    of people who left the School, LEFT.
 * 3. While places taken (live and frozen members, waiting Cash/Bank payments,
 *    places still held) are fewer than the limit, the first person waiting is
 *    offered one: held 24 hours, and told (a child's Guardians get the usual
 *    copy). A limit lowered below the count offers nothing until there is room
 *    (item 15). Owners selling over the limit at the desk (item 12) just means
 *    nothing is offered.
 * A closed or archived plan, or a closed School, offers nothing. Places free
 * up when a membership ends, runs out, is refunded or cancelled, so this runs
 * on a timer rather than on each of those.
 */
@Processor(PLAN_WAITLIST_QUEUE)
export class PlanWaitlistProcessor extends WorkerHost {
  private readonly logger = new Logger(PlanWaitlistProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
  ) {
    super();
  }

  async process(): Promise<void> {
    await this.run(new Date());
  }

  /** Separate from process() so tests can pass the date. */
  async run(now: Date): Promise<PlanWaitlistRunOutcome> {
    const outcome: PlanWaitlistRunOutcome = { offered: 0, expired: 0, closed: 0 };
    const expired = await this.prismaJobs.planWaitlistEntry.updateMany({ where: { status: 'OFFERED', offerExpiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
    outcome.expired = expired.count;

    const planIds = await this.prismaJobs.planWaitlistEntry.findMany({ where: { status: { in: ['WAITING', 'OFFERED'] } }, distinct: ['membershipPlanId'], select: { membershipPlanId: true } });
    for (const { membershipPlanId } of planIds) {
      try {
        await this.runPlan(membershipPlanId, now, outcome);
      } catch (err) {
        this.logger.error(`plan-waitlist: plan ${membershipPlanId} could not be processed.`, err as Error);
      }
    }
    if (outcome.offered || outcome.expired || outcome.closed) {
      this.logger.log(`plan-waitlist: ${outcome.offered} offered, ${outcome.expired} expired, ${outcome.closed} closed.`);
    }
    return outcome;
  }

  private async runPlan(planId: string, now: Date, outcome: PlanWaitlistRunOutcome): Promise<void> {
    const plan = await this.prismaJobs.membershipPlan.findUniqueOrThrow({ where: { id: planId }, select: { id: true, schoolId: true, title: true, memberLimit: true, archivedAt: true, visible: true } });
    const school = await this.prismaJobs.school.findUniqueOrThrow({ where: { id: plan.schoolId }, select: { archivedAt: true, timezone: true } });
    const open = await this.prismaJobs.planWaitlistEntry.findMany({
      where: { membershipPlanId: planId, status: { in: ['WAITING', 'OFFERED'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    // Close the entries of people who have the plan now, or left the School.
    const waiting: typeof open = [];
    for (const entry of open) {
      const enrolled = await this.prismaJobs.roleGrant.findFirst({ where: { userId: entry.studentId, schoolId: plan.schoolId, role: 'STUDENT', revokedAt: null }, select: { id: true } });
      const closeAs = !enrolled ? ('LEFT' as const) : (await holdsPlace(this.prismaJobs, planId, entry.studentId, now)) ? ('BOUGHT' as const) : null;
      if (closeAs) {
        const closed = await this.prismaJobs.planWaitlistEntry.updateMany({ where: { id: entry.id, status: entry.status }, data: { status: closeAs } });
        outcome.closed += closed.count;
      } else if (entry.status === 'WAITING') {
        waiting.push(entry);
      }
    }
    if (plan.memberLimit === null || plan.archivedAt || !plan.visible || school.archivedAt) return;

    const limited = { id: plan.id, memberLimit: plan.memberLimit };
    for (const entry of waiting) {
      const offerExpiresAt = new Date(now.getTime() + PLACE_HELD_MS);
      // Decision 447 item 5: a held place takes a place, so it is offered
      // under the plan's lock, as orders are placed (Decision 446 item 6), and
      // the places are counted again inside: an order or a plan switch
      // starting at the same moment can't both take the last place.
      const offered = await this.prismaJobs.$transaction(async (tx) => {
        await lockPlanPlaces(tx, limited);
        if ((await placesTaken(tx, planId, null)) >= limited.memberLimit) return 'FULL' as const;
        const updated = await tx.planWaitlistEntry.updateMany({
          where: { id: entry.id, status: 'WAITING' },
          data: { status: 'OFFERED', offeredAt: now, offerExpiresAt },
        });
        return updated.count > 0 ? ('OFFERED' as const) : ('GONE' as const);
      });
      if (offered === 'FULL') break;
      if (offered === 'GONE') continue;
      outcome.offered++;
      const notice = placeHeldNotice(plan.title, noticeWallTime(offerExpiresAt, school.timezone ?? 'UTC'));
      await this.notify({ notificationId: `plan-place-held-${entry.id}`, userId: entry.studentId, title: notice.title, body: notice.body, type: 'PLAN_WAITLIST', schoolId: plan.schoolId });
    }
  }

  /** Best-effort, as the other notice jobs. */
  private async notify(data: NotificationFanoutJobData) {
    try {
      await this.fanoutQueue.add('notify', data, { jobId: data.notificationId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    } catch (err) {
      this.logger.warn(`Failed to enqueue the place-held notice ${data.notificationId}: ${err}`);
    }
  }
}
