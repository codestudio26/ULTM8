import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { WaiverAssignmentService } from '../waivers/waiver-assignment.service';
import { WAIVER_RENEWAL_SWEEP_QUEUE, WAIVER_SIGNATURE_REQUESTS_QUEUE } from './queue.constants';
import type { WaiverNoticeReason, WaiverSignatureRequestJobData } from './waiver-signature-requests.processor';

/** Daily, at 5am UTC: after the 4am entity-offboarding purge, so the two
 * don't start at the same moment. */
const CRON_DAILY_AT_5AM_UTC = '0 5 * * *';
const REPEATABLE_JOB_ID = 'waiver-renewal-sweep';
const AGE_OF_MAJORITY_YEARS = 18;

/** Same fixed-jobId / not-awaited / bounded-retry registration as every other
 * scheduler in this directory (see BookingNoShowProcessingScheduler). */
@Injectable()
export class WaiverRenewalSweepScheduler implements OnModuleInit {
  private readonly logger = new Logger(WaiverRenewalSweepScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(WAIVER_RENEWAL_SWEEP_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...WaiverRenewalSweepScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_DAILY_AT_5AM_UTC }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable waiver-renewal-sweep job (retrying): ${err}`);
      }
    }
    this.logger.error(
      'Failed to register the repeatable waiver-renewal-sweep job after all retries — waiver renewals, ' +
        'the sign-again-at-18 rule and repeat reminders will not run until this succeeds.',
    );
  }
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function ageOn(dateOfBirth: Date, on: Date): number {
  let age = on.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const hadBirthday =
    on.getUTCMonth() > dateOfBirth.getUTCMonth() ||
    (on.getUTCMonth() === dateOfBirth.getUTCMonth() && on.getUTCDate() >= dateOfBirth.getUTCDate());
  return hadBirthday ? age : age - 1;
}

/**
 * Decision 354 — the three Waiver settings that act over time, for every
 * School that uses them:
 *  - "Sign again every N months" (Q5): a signature older than that expires.
 *  - "A child signs again at 18" (Q5): a signature given while the student
 *    was under 18 expires once they are 18.
 *  - "Remind again every N days" (Q8): an unsigned entry is reminded again.
 * An expired signature is kept, with its copy of what was signed; the student
 * gets a new unsigned entry and a notice. Only current students and waivers
 * still in use, at Schools that are open. Each School is handled on its own,
 * so one failure doesn't stop the rest.
 */
@Processor(WAIVER_RENEWAL_SWEEP_QUEUE)
export class WaiverRenewalSweepProcessor extends WorkerHost {
  private readonly logger = new Logger(WaiverRenewalSweepProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly waiverAssignment: WaiverAssignmentService,
    @InjectQueue(WAIVER_SIGNATURE_REQUESTS_QUEUE) private readonly waiverSignatureRequestsQueue: Queue,
  ) {
    super();
  }

  async process(): Promise<void> {
    await this.sweep(new Date());
  }

  /** Separate from process() so tests can pass the date. */
  async sweep(now: Date): Promise<{ expired: number; reminded: number }> {
    const schools = await this.prismaJobs.school.findMany({
      where: {
        archivedAt: null,
        OR: [{ waiverRenewalMonths: { not: null } }, { waiverMinorsSignAgainAt18: true }, { waiverReminderDays: { not: null } }],
      },
      select: { id: true, waiverRenewalMonths: true, waiverMinorsSignAgainAt18: true, waiverReminderDays: true },
    });
    let expired = 0;
    let reminded = 0;
    const batchId = now.toISOString().slice(0, 10);
    for (const school of schools) {
      try {
        const outcome = await this.sweepSchool(school, now, batchId);
        expired += outcome.expired;
        reminded += outcome.reminded;
      } catch (err) {
        this.logger.error(`waiver-renewal-sweep: School ${school.id} failed; will retry tomorrow.`, err as Error);
      }
    }
    this.logger.log(`waiver-renewal-sweep: ${expired} signature(s) expired, ${reminded} reminder(s) sent.`);
    return { expired, reminded };
  }

  private async sweepSchool(
    school: { id: string; waiverRenewalMonths: number | null; waiverMinorsSignAgainAt18: boolean; waiverReminderDays: number | null },
    now: Date,
    batchId: string,
  ): Promise<{ expired: number; reminded: number }> {
    const grants = await this.prismaJobs.roleGrant.findMany({
      where: { schoolId: school.id, role: 'STUDENT', revokedAt: null },
      select: { userId: true },
      distinct: ['userId'],
    });
    const active = grants.map((g) => g.userId);
    if (active.length === 0) return { expired: 0, reminded: 0 };
    const waivers = await this.prismaJobs.waiver.findMany({ where: { schoolId: school.id, archivedAt: null }, select: { id: true } });
    const waiverIds = waivers.map((w) => w.id);
    if (waiverIds.length === 0) return { expired: 0, reminded: 0 };

    // reason per expiring signature; renewal wins when both apply.
    const toExpire = new Map<string, { waiverId: string; studentId: string; reason: WaiverNoticeReason }>();
    const signed = await this.prismaJobs.waiverSignature.findMany({
      where: { schoolId: school.id, waiverId: { in: waiverIds }, studentId: { in: active }, status: 'SIGNED', signedDate: { not: null } },
      select: { id: true, waiverId: true, studentId: true, signedDate: true },
    });
    if (school.waiverMinorsSignAgainAt18 && signed.length > 0) {
      const users = await this.prismaJobs.user.findMany({
        where: { id: { in: [...new Set(signed.map((s) => s.studentId))] } },
        select: { id: true, dateOfBirth: true },
      });
      const dob = new Map(users.map((u) => [u.id, u.dateOfBirth]));
      for (const s of signed) {
        const born = dob.get(s.studentId);
        if (born && ageOn(born, s.signedDate!) < AGE_OF_MAJORITY_YEARS && ageOn(born, now) >= AGE_OF_MAJORITY_YEARS) {
          toExpire.set(s.id, { waiverId: s.waiverId, studentId: s.studentId, reason: 'adult' });
        }
      }
    }
    if (school.waiverRenewalMonths) {
      const cutoff = addMonths(now, -school.waiverRenewalMonths);
      for (const s of signed) {
        if (s.signedDate! <= cutoff) toExpire.set(s.id, { waiverId: s.waiverId, studentId: s.studentId, reason: 'renewal' });
      }
    }

    let expired = 0;
    const notices = new Map<string, WaiverSignatureRequestJobData>();
    const addNotice = (waiverId: string, studentId: string, reason: WaiverNoticeReason) => {
      const key = `${waiverId}:${reason}`;
      const notice = notices.get(key) ?? { waiverId, schoolId: school.id, studentIds: [], reason, batchId };
      notice.studentIds!.push(studentId);
      notices.set(key, notice);
    };
    if (toExpire.size > 0) {
      const rows = [...toExpire.entries()];
      await this.prismaJobs.$transaction(async (tx) => {
        const { count } = await tx.waiverSignature.updateMany({ where: { id: { in: rows.map(([id]) => id) }, status: 'SIGNED' }, data: { status: 'EXPIRED' } });
        expired = count;
        for (const [, row] of rows) {
          await this.waiverAssignment.assignUnsignedRows(tx, school.id, [row.waiverId], [row.studentId]);
        }
      });
      for (const [, row] of rows) addNotice(row.waiverId, row.studentId, row.reason);
    }

    let reminded = 0;
    if (school.waiverReminderDays) {
      const cutoff = new Date(now.getTime() - school.waiverReminderDays * 24 * 60 * 60 * 1000);
      const due = await this.prismaJobs.waiverSignature.findMany({
        where: {
          schoolId: school.id,
          waiverId: { in: waiverIds },
          studentId: { in: active },
          status: { in: ['UNSIGNED', 'PENDING'] },
          OR: [{ lastRemindedAt: null, createdAt: { lte: cutoff } }, { lastRemindedAt: { lte: cutoff } }],
        },
        select: { id: true, waiverId: true, studentId: true },
      });
      // Just made by an expiry above: that notice already asks them to sign.
      const justAsked = new Set([...toExpire.values()].map((r) => `${r.waiverId}:${r.studentId}`));
      const fresh = due.filter((d) => !justAsked.has(`${d.waiverId}:${d.studentId}`));
      if (fresh.length > 0) {
        await this.prismaJobs.waiverSignature.updateMany({ where: { id: { in: fresh.map((d) => d.id) } }, data: { lastRemindedAt: now } });
        for (const d of fresh) addNotice(d.waiverId, d.studentId, 'reminder');
        reminded = fresh.length;
      }
    }

    for (const notice of notices.values()) {
      await this.waiverSignatureRequestsQueue.add('notify', notice, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    }
    return { expired, reminded };
  }
}
