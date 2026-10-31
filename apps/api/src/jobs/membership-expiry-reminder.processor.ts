import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MembershipPlanType } from '@prisma/client';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { isMembershipLive } from '../memberships/membership-creation-guard';
import { dayIn, dayNumber, dayString, isFrozenOn } from '../memberships/freeze/membership-freeze';
import { MEMBERSHIP_EXPIRY_REMINDER_QUEUE, NOTIFICATION_FANOUT_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';

/** Daily, at 6:45am UTC, beside the other daily notices. */
const CRON_DAILY_AT_6_45AM_UTC = '45 6 * * *';
const REPEATABLE_JOB_ID = 'membership-expiry-reminder';
/** Decision 317 item 7: "7 days before a membership ends". */
export const EXPIRY_REMINDER_DAYS = 7;
/** Not reminded: a Friend Pass only covers a guest, and a visit pass is a
 * Visitor's free pass, not a membership (Decision 391; no reminder asked for). */
export const NOT_REMINDED_TYPES: MembershipPlanType[] = ['FRIEND_PASS', 'VISIT_PASS'];

/** When a membership ends: its expiry date, or a cancelled Subscription's
 * cancelAt, whichever comes first and is still ahead. Null: no end (a
 * renewing Subscription). Shared with the weekly membership-ending-report. */
export function membershipEnd(m: { expiryDate: Date | null; cancelAt: Date | null }, now: Date): Date | null {
  return [m.expiryDate, m.cancelAt].filter((d): d is Date => !!d && d > now).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
}

/** The notice's English text, translated in the apps by its shape (@ultm8/i18n server/translate.ts). */
export function membershipExpiryNotice(planTitle: string, endDay: string) {
  return { title: 'Membership ending soon', body: `Your ${planTitle} membership ends on ${endDay}.` };
}

/** Same fixed-jobId / not-awaited / bounded-retry registration as every other
 * scheduler in this directory (see ChargeAutoPayScheduler). */
@Injectable()
export class MembershipExpiryReminderScheduler implements OnModuleInit {
  private readonly logger = new Logger(MembershipExpiryReminderScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(MEMBERSHIP_EXPIRY_REMINDER_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...MembershipExpiryReminderScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_DAILY_AT_6_45AM_UTC }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable membership-expiry-reminder job (retrying): ${err}`);
      }
    }
    this.logger.error('Failed to register the repeatable membership-expiry-reminder job after all retries — expiry reminders will not go out until this succeeds.');
  }
}

export type MembershipExpiryReminderOutcome = { sent: number };

/**
 * Decision 317 item 7: "an expiry reminder to the member 7 days before a
 * membership ends (Guardian for a child)". The member is told once per end
 * date; notification-fanout copies it to a child's Guardians as
 * "For {name}: …", as every member notice is (Decision 333).
 *
 * - A membership ends on its expiry date, or, for a Subscription the member
 *   or owner cancelled, on the date it was cancelled to (cancelAt). A
 *   Subscription that keeps renewing has no end, so no reminder.
 * - Sent from 7 days before the end day (in the School's time zone) until the
 *   day before; a missed run catches up the next day.
 * - Once per end date (MembershipExpiryReminder's key). A freeze moves a
 *   fixed-term membership's end later (Decision 404), and the new end gets
 *   its own reminder.
 * - Skipped: Friend Passes and visit passes; a membership no longer in effect
 *   (a used-up Class Pack); a membership made less than 7 days before its end
 *   (its end date was just shown when it was bought); a day the membership is
 *   frozen (tried again the next day); students who have left the School;
 *   closed Schools.
 * - No School switch: the decision doesn't give one.
 */
@Processor(MEMBERSHIP_EXPIRY_REMINDER_QUEUE)
export class MembershipExpiryReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(MembershipExpiryReminderProcessor.name);

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
  async run(now: Date): Promise<MembershipExpiryReminderOutcome> {
    // Ending within the next 7 days (+2 for time zones); each is checked
    // below against its own School's day.
    const latest = new Date(now.getTime() + (EXPIRY_REMINDER_DAYS + 2) * 24 * 60 * 60 * 1000);
    const window = { gt: now, lte: latest };
    const candidates = await this.prismaJobs.membership.findMany({
      where: {
        status: 'ACTIVE',
        membershipPlan: { type: { notIn: NOT_REMINDED_TYPES } },
        OR: [{ expiryDate: window }, { cancelAt: window }],
      },
      select: {
        id: true,
        studentId: true,
        schoolId: true,
        status: true,
        expiryDate: true,
        cancelAt: true,
        classesRemaining: true,
        createdAt: true,
        membershipPlan: { select: { title: true } },
        freezes: { where: { status: 'APPROVED' }, select: { status: true, startsAt: true, endsAt: true, endedEarlyAt: true } },
      },
    });
    const outcome: MembershipExpiryReminderOutcome = { sent: 0 };
    if (candidates.length === 0) return outcome;

    const schoolIds = [...new Set(candidates.map((m) => m.schoolId))];
    const schools = await this.prismaJobs.school.findMany({ where: { id: { in: schoolIds }, archivedAt: null }, select: { id: true, timezone: true } });
    const zoneOf = new Map(schools.map((s) => [s.id, s.timezone]));
    const grants = await this.prismaJobs.roleGrant.findMany({
      where: { schoolId: { in: schoolIds }, role: 'STUDENT', revokedAt: null, userId: { in: [...new Set(candidates.map((m) => m.studentId))] } },
      select: { userId: true, schoolId: true },
    });
    const enrolled = new Set(grants.map((g) => `${g.schoolId}:${g.userId}`));

    for (const m of candidates) {
      if (!zoneOf.has(m.schoolId)) continue; // closed School
      if (!enrolled.has(`${m.schoolId}:${m.studentId}`)) continue;
      if (!isMembershipLive(m, now)) continue;
      const end = membershipEnd(m, now);
      if (!end) continue;
      const zone = zoneOf.get(m.schoolId);
      const today = dayIn(now, zone);
      const endDay = dayIn(end, zone);
      const remindOn = dayString(dayNumber(endDay) - EXPIRY_REMINDER_DAYS);
      if (today < remindOn || today >= endDay) continue;
      if (dayIn(m.createdAt, zone) >= remindOn) continue;
      if (m.freezes.some((f) => isFrozenOn(f, today, zone))) continue;

      const claimed = await this.prismaJobs.membershipExpiryReminder.createMany({ data: [{ membershipId: m.id, endsAt: end }], skipDuplicates: true });
      if (claimed.count === 0) continue;
      const notice = membershipExpiryNotice(m.membershipPlan.title, endDay);
      await this.notify({
        notificationId: `membership-expiry-reminder-${m.id}-${endDay}`,
        userId: m.studentId,
        title: notice.title,
        body: notice.body,
        type: 'MEMBERSHIP_EXPIRY',
        schoolId: m.schoolId,
      });
      outcome.sent++;
    }
    this.logger.log(`membership-expiry-reminder: ${outcome.sent} sent.`);
    return outcome;
  }

  /** Best-effort, as ChargeDueReminderProcessor.notify(). */
  private async notify(data: NotificationFanoutJobData) {
    try {
      await this.fanoutQueue.add('notify', data, { jobId: data.notificationId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    } catch (err) {
      this.logger.warn(`Failed to enqueue the expiry reminder ${data.notificationId}: ${err}`);
    }
  }
}
