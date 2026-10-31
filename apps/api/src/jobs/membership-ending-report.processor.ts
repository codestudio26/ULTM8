import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { isMembershipLive } from '../memberships/membership-creation-guard';
import { dayIn, dayNumber, dayString, dayToDate, freezeZone } from '../memberships/freeze/membership-freeze';
import { NOT_REMINDED_TYPES, membershipEnd } from './membership-expiry-reminder.processor';
import { MEMBERSHIP_ENDING_REPORT_QUEUE, NOTIFICATION_FANOUT_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';

/** Daily, at 7:30am UTC; each School gets its report on the first run of its
 * week (see the processor). */
const CRON_DAILY_AT_7_30AM_UTC = '30 7 * * *';
const REPEATABLE_JOB_ID = 'membership-ending-report';
/** The report covers the 7 days from the day it is sent (that day included). */
export const ENDING_REPORT_DAYS = 7;
/** Most memberships named in one notice; the rest are counted ("; +N"). */
export const ENDING_REPORT_MAX_ITEMS = 20;

/** The report's English text, translated in the portal by its shape
 * (@ultm8/i18n server/translate.ts). `items` are "Name: Plan (YYYY-MM-DD)". */
export function membershipEndingReportNotice(items: string[]) {
  const shown = items.slice(0, ENDING_REPORT_MAX_ITEMS);
  const more = items.length - shown.length;
  return {
    title: 'Memberships ending soon',
    body: `Memberships ending in the next 7 days: ${shown.join('; ')}${more > 0 ? `; +${more}` : ''}.`,
  };
}

/** Same fixed-jobId / not-awaited / bounded-retry registration as every other
 * scheduler in this directory (see ChargeAutoPayScheduler). */
@Injectable()
export class MembershipEndingReportScheduler implements OnModuleInit {
  private readonly logger = new Logger(MembershipEndingReportScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(MEMBERSHIP_ENDING_REPORT_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...MembershipEndingReportScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_DAILY_AT_7_30AM_UTC }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable membership-ending-report job (retrying): ${err}`);
      }
    }
    this.logger.error('Failed to register the repeatable membership-ending-report job after all retries — weekly reports will not go out until this succeeds.');
  }
}

export type MembershipEndingReportOutcome = { reports: number; notices: number };

/** The first day of the School's week containing `today` (YYYY-MM-DD). */
export function weekStartOf(today: string, weekStartsOn: 'MONDAY' | 'SUNDAY'): string {
  const weekday = DateTime.fromISO(today, { zone: 'UTC' }).weekday; // 1 = Monday … 7 = Sunday
  const back = weekStartsOn === 'MONDAY' ? weekday - 1 : weekday % 7;
  return dayString(dayNumber(today) - back);
}

/**
 * Decision 317 item 7: "a weekly report to staff of memberships ending soon".
 *
 * - Once a week per School (MembershipEndingReport's key: the School and the
 *   first day of its week, School.weekStartsOn in its time zone). It goes on
 *   the first daily run of that week, normally the week's first day; a missed
 *   run catches up later the same week.
 * - Lists the memberships ending in the 7 days from that day (that day
 *   included), with the expiry reminder's "ends" and exclusions: a
 *   membership's expiry date, or a cancelled Subscription's cancelAt; not
 *   Friend Passes or visit passes, used-up Class Packs, students who have
 *   left, or closed Schools.
 * - Sent to the School's Owners/Managers (the absence alert's recipients).
 *   Nothing is sent when the list is empty; the week is still marked done.
 */
@Processor(MEMBERSHIP_ENDING_REPORT_QUEUE)
export class MembershipEndingReportProcessor extends WorkerHost {
  private readonly logger = new Logger(MembershipEndingReportProcessor.name);

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
  async run(now: Date): Promise<MembershipEndingReportOutcome> {
    const schools = await this.prismaJobs.school.findMany({ where: { archivedAt: null }, select: { id: true, timezone: true, weekStartsOn: true } });
    const outcome: MembershipEndingReportOutcome = { reports: 0, notices: 0 };
    for (const school of schools) {
      try {
        await this.runSchool(school.id, school.timezone, school.weekStartsOn, now, outcome);
      } catch (err) {
        this.logger.error(`membership-ending-report: School ${school.id} failed: ${err}`);
      }
    }
    this.logger.log(`membership-ending-report: ${outcome.reports} reports, ${outcome.notices} notices.`);
    return outcome;
  }

  private async runSchool(schoolId: string, zone: string | null, weekStartsOn: 'MONDAY' | 'SUNDAY', now: Date, outcome: MembershipEndingReportOutcome) {
    const today = dayIn(now, zone);
    const weekStart = weekStartOf(today, weekStartsOn);
    if (await this.prismaJobs.membershipEndingReport.findUnique({ where: { schoolId_weekStart: { schoolId, weekStart: dayToDate(weekStart) } }, select: { schoolId: true } })) return;

    // The window ends at the start of the 8th day, in the School's time zone.
    const until = DateTime.fromISO(dayString(dayNumber(today) + ENDING_REPORT_DAYS), { zone: freezeZone(zone) }).toJSDate();
    const window = { gt: now, lt: until };
    const memberships = await this.prismaJobs.membership.findMany({
      where: { schoolId, status: 'ACTIVE', membershipPlan: { type: { notIn: NOT_REMINDED_TYPES } }, OR: [{ expiryDate: window }, { cancelAt: window }] },
      select: { studentId: true, status: true, expiryDate: true, cancelAt: true, classesRemaining: true, membershipPlan: { select: { title: true } } },
    });
    const enrolled = new Set(
      (
        await this.prismaJobs.roleGrant.findMany({
          where: { schoolId, role: 'STUDENT', revokedAt: null, userId: { in: [...new Set(memberships.map((m) => m.studentId))] } },
          select: { userId: true },
        })
      ).map((g) => g.userId),
    );
    const ending = memberships
      .filter((m) => enrolled.has(m.studentId) && isMembershipLive(m, now))
      .map((m) => ({ m, end: membershipEnd(m, now) }))
      .filter((x): x is { m: (typeof memberships)[number]; end: Date } => !!x.end && x.end < until);

    const claimed = await this.prismaJobs.membershipEndingReport.createMany({ data: [{ schoolId, weekStart: dayToDate(weekStart), listed: ending.length }], skipDuplicates: true });
    if (claimed.count === 0 || ending.length === 0) return;
    outcome.reports++;

    const names = new Map(
      (await this.prismaJobs.user.findMany({ where: { id: { in: [...new Set(ending.map((x) => x.m.studentId))] } }, select: { id: true, firstName: true, surname: true } })).map((u) => [
        u.id,
        [u.firstName, u.surname].filter(Boolean).join(' ') || 'A member',
      ]),
    );
    const items = ending
      .map((x) => ({ day: dayIn(x.end, zone), name: names.get(x.m.studentId) ?? 'A member', plan: x.m.membershipPlan.title }))
      .sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name))
      .map((x) => `${x.name}: ${x.plan} (${x.day})`);
    const notice = membershipEndingReportNotice(items);
    const owners = [
      ...new Set((await this.prismaJobs.roleGrant.findMany({ where: { schoolId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null }, select: { userId: true } })).map((g) => g.userId)),
    ];
    for (const userId of owners) {
      await this.notify({
        notificationId: `membership-ending-report-${schoolId}-${weekStart}-${userId}`,
        userId,
        title: notice.title,
        body: notice.body,
        type: 'MEMBERSHIP_ENDING_REPORT',
        schoolId,
      });
      outcome.notices++;
    }
  }

  /** Best-effort, as ChargeDueReminderProcessor.notify(). */
  private async notify(data: NotificationFanoutJobData) {
    try {
      await this.fanoutQueue.add('notify', data, { jobId: data.notificationId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    } catch (err) {
      this.logger.warn(`Failed to enqueue the weekly report ${data.notificationId}: ${err}`);
    }
  }
}
