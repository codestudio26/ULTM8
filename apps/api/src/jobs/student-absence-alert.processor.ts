import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MembershipPlanType } from '@prisma/client';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { isMembershipLive } from '../memberships/membership-creation-guard';
import { backDay, dayIn, dayNumber, dayString, dayToDate, isFrozenOn } from '../memberships/freeze/membership-freeze';
import { NOTIFICATION_FANOUT_QUEUE, STUDENT_ABSENCE_ALERT_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';

/** Daily, at 7:15am UTC. */
const CRON_DAILY_AT_7_15AM_UTC = '15 7 * * *';
const REPEATABLE_JOB_ID = 'student-absence-alert';
/** A Friend Pass only covers a guest and a visit pass makes someone a
 * Visitor, not a member (Decision 391), so neither makes a member. */
const NOT_MEMBERSHIP_TYPES: MembershipPlanType[] = ['FRIEND_PASS', 'VISIT_PASS'];

/** The alert's English text, translated in the portal by its shape (@ultm8/i18n server/translate.ts). */
export function absenceAlertNotice(name: string, lastCheckInDay: string | null) {
  return {
    title: 'Member absent',
    body: lastCheckInDay ? `${name} hasn't checked in since ${lastCheckInDay}.` : `${name} hasn't checked in yet.`,
  };
}

/** Same fixed-jobId / not-awaited / bounded-retry registration as every other
 * scheduler in this directory (see ChargeAutoPayScheduler). */
@Injectable()
export class StudentAbsenceAlertScheduler implements OnModuleInit {
  private readonly logger = new Logger(StudentAbsenceAlertScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(STUDENT_ABSENCE_ALERT_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...StudentAbsenceAlertScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_DAILY_AT_7_15AM_UTC }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable student-absence-alert job (retrying): ${err}`);
      }
    }
    this.logger.error('Failed to register the repeatable student-absence-alert job after all retries — absence alerts will not go out until this succeeds.');
  }
}

export type StudentAbsenceAlertOutcome = { alerted: number; notices: number };

/**
 * Decision 317 item 7: "an absence alert to staff when a member hasn't
 * checked in for N weeks (the School sets N)". School.absenceAlertWeeks is N;
 * null (the default) is off, since the decision gives no N.
 *
 * - A member is a current student of the School holding a membership in
 *   effect now (isMembershipLive), other than a Friend Pass or a visit pass.
 * - A check-in is a Booking at the School marked attended (COMPLETED), dated
 *   by its Class's start.
 * - The absence counts from the latest of: their last check-in, the day they
 *   became a member (the earliest start of their memberships in effect), and
 *   the day they came back from a freeze. So a new member, or one just back
 *   from a freeze, isn't flagged straight away.
 * - Once that is N weeks or more ago (in the School's time zone), the
 *   School's owners are told once for that absence (StudentAbsenceAlert's
 *   key: the School, the student and the day it counts from). A new check-in
 *   starts a new absence.
 * - Skipped: members frozen today (they can't check in, Decision 404);
 *   closed Schools.
 * - Who is told: the School's Owners/Managers, as for every other staff
 *   notice (cash payments, cancellations to resolve).
 */
@Processor(STUDENT_ABSENCE_ALERT_QUEUE)
export class StudentAbsenceAlertProcessor extends WorkerHost {
  private readonly logger = new Logger(StudentAbsenceAlertProcessor.name);

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
  async run(now: Date): Promise<StudentAbsenceAlertOutcome> {
    const schools = await this.prismaJobs.school.findMany({
      where: { absenceAlertWeeks: { not: null }, archivedAt: null },
      select: { id: true, timezone: true, absenceAlertWeeks: true },
    });
    const outcome: StudentAbsenceAlertOutcome = { alerted: 0, notices: 0 };
    for (const school of schools) {
      try {
        await this.runSchool(school.id, school.timezone, school.absenceAlertWeeks as number, now, outcome);
      } catch (err) {
        this.logger.error(`student-absence-alert: School ${school.id} failed: ${err}`);
      }
    }
    this.logger.log(`student-absence-alert: ${outcome.alerted} absences, ${outcome.notices} notices.`);
    return outcome;
  }

  private async runSchool(schoolId: string, zone: string | null, weeks: number, now: Date, outcome: StudentAbsenceAlertOutcome) {
    const today = dayIn(now, zone);
    const grants = await this.prismaJobs.roleGrant.findMany({ where: { schoolId, role: 'STUDENT', revokedAt: null }, select: { userId: true }, distinct: ['userId'] });
    if (grants.length === 0) return;
    const memberships = await this.prismaJobs.membership.findMany({
      where: { schoolId, status: 'ACTIVE', studentId: { in: grants.map((g) => g.userId) }, membershipPlan: { type: { notIn: NOT_MEMBERSHIP_TYPES } } },
      select: {
        studentId: true,
        status: true,
        expiryDate: true,
        classesRemaining: true,
        startDate: true,
        freezes: { where: { status: 'APPROVED' }, select: { status: true, startsAt: true, endsAt: true, endedEarlyAt: true } },
      },
    });
    const byStudent = new Map<string, typeof memberships>();
    for (const m of memberships) {
      if (!isMembershipLive(m, now)) continue;
      byStudent.set(m.studentId, [...(byStudent.get(m.studentId) ?? []), m]);
    }
    if (byStudent.size === 0) return;

    const lastRows = await this.prismaJobs.$queryRaw<Array<{ studentId: string; last: Date }>>`
      SELECT b."studentId", max(c."startDate") AS "last"
      FROM "Booking" b JOIN "Class" c ON c."id" = b."classId"
      WHERE b."schoolId" = ${schoolId} AND b."status" = 'COMPLETED' AND b."studentId" = ANY(${[...byStudent.keys()]})
      GROUP BY b."studentId"`;
    const lastCheckIn = new Map(lastRows.map((r) => [r.studentId, dayIn(r.last, zone)]));

    let owners: string[] | null = null;
    const todayNumber = dayNumber(today);
    for (const [studentId, live] of byStudent) {
      const freezes = live.flatMap((m) => m.freezes);
      if (freezes.some((f) => isFrozenOn(f, today, zone))) continue;
      const last = lastCheckIn.get(studentId) ?? null;
      const memberSince = Math.min(...live.map((m) => dayNumber(dayIn(m.startDate, zone))));
      const backFromFreeze = freezes.map((f) => backDay(f, zone)).filter((d) => d <= todayNumber);
      const since = Math.max(memberSince, last ? dayNumber(last) : -Infinity, ...backFromFreeze);
      if (todayNumber - since < weeks * 7) continue;

      const sinceDay = dayString(since);
      const claimed = await this.prismaJobs.studentAbsenceAlert.createMany({ data: [{ schoolId, studentId, absentSince: dayToDate(sinceDay) }], skipDuplicates: true });
      if (claimed.count === 0) continue;
      outcome.alerted++;

      owners ??= [
        ...new Set(
          (await this.prismaJobs.roleGrant.findMany({ where: { schoolId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null }, select: { userId: true } })).map((g) => g.userId),
        ),
      ];
      const student = await this.prismaJobs.user.findUnique({ where: { id: studentId }, select: { firstName: true, surname: true } });
      const name = [student?.firstName, student?.surname].filter(Boolean).join(' ') || 'A member';
      const notice = absenceAlertNotice(name, last);
      for (const userId of owners) {
        await this.notify({
          notificationId: `student-absence-${schoolId}-${studentId}-${sinceDay}-${userId}`,
          userId,
          title: notice.title,
          body: notice.body,
          type: 'STUDENT_ABSENCE',
          schoolId,
        });
        outcome.notices++;
      }
    }
  }

  /** Best-effort, as ChargeDueReminderProcessor.notify(). */
  private async notify(data: NotificationFanoutJobData) {
    try {
      await this.fanoutQueue.add('notify', data, { jobId: data.notificationId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    } catch (err) {
      this.logger.warn(`Failed to enqueue the absence alert ${data.notificationId}: ${err}`);
    }
  }
}
