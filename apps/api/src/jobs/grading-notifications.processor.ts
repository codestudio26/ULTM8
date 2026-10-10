import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { loadLadder } from '../ranks/grading-attendance';
import { eligibilityOnLadder, studentTimeZone } from '../ranks/grading-eligibility';
import { GRADING_NOTIFICATIONS_QUEUE, NOTIFICATION_FANOUT_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';
import { GradingPromotedJobData, GradingReadyCheckJobData } from './grading-notifications.types';

/** Days are served at each student's local midnight, so a daily pass catches
 * everyone who became ready by time alone. Not set by the spec; a Developer
 * choice, like every other CRON_* constant in this directory. */
const CRON_DAILY_AT_4AM_UTC = '0 4 * * *';
const REPEATABLE_JOB_ID = 'grading-notifications-ready-sweep';
const SWEEP_BATCH = 500;

const FANOUT_OPTIONS = { attempts: 3, backoff: { type: 'exponential' as const, delay: 5000 } };

/** Registers the daily ready-to-grade sweep, the same way (fixed job id,
 * not awaited, bounded retries) as ClassOccurrenceGenerationScheduler. */
@Injectable()
export class GradingNotificationsScheduler implements OnModuleInit {
  private readonly logger = new Logger(GradingNotificationsScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(GRADING_NOTIFICATIONS_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...GradingNotificationsScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_DAILY_AT_4AM_UTC }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable ready-to-grade sweep (retrying): ${err}`);
      }
    }
    this.logger.error(
      'Failed to register the repeatable ready-to-grade sweep after all retries — students who become ready by time alone ' +
        'won\'t be reported until this succeeds (checks after grading actions still run).',
    );
  }
}

/**
 * Grading notifications (Decisions 145, 178). Runs as ultm8_jobs, with the
 * read-only grading grants of 20261022000000_grading_ready_notification.
 *
 * "Ready to grade" ('ready-check' after a grading action or check-in, and the
 * daily 'sweep'): when the engine says a student meets everything for their
 * next rung — classes, minimum days and required skills — the School owner
 * and the staff who may grade them are told, once per rank:
 * - Only for an enrolled student (an active STUDENT grant, as the Grading
 *   Board), at a School that is open and has ranks switched on.
 * - Staff: those with grading permission for the style who cover the
 *   student's branch, exactly as assertCanGrade (Decisions 138, 139, 168): in
 *   a School with no branches every staff member; otherwise those assigned to
 *   the student's home branch (none while the student has no home branch).
 * - Once per rank: StudentRank.readyNotifiedAt is claimed with a conditional
 *   update, so two checks at once notify once; every rank change clears it.
 *   If queueing the notifications fails, the claim is released for the retry.
 *
 * "You've been promoted" ('promoted', queued by GradingService after a
 * promote, downgrade or stripe award): to the student, or, when the student
 * is a Guardian-linked minor, to each linked guardian instead (Decision 145,
 * item 2) — a linked minor has no login of their own (Decision 175).
 */
@Processor(GRADING_NOTIFICATIONS_QUEUE)
export class GradingNotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(GradingNotificationsProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'ready-check') return this.readyCheck(job.data as GradingReadyCheckJobData);
    if (job.name === 'promoted') return this.promoted(job.data as GradingPromotedJobData);
    if (job.name === 'sweep') return this.sweep();
    this.logger.warn(`grading-notifications: unknown job "${job.name}" ignored.`);
  }

  private async readyCheck({ studentId, disciplineId }: GradingReadyCheckJobData): Promise<void> {
    const ranks = await this.prismaJobs.studentRank.findMany({
      where: { studentId, ...(disciplineId ? { disciplineId } : {}), readyNotifiedAt: null },
      select: { id: true },
    });
    for (const r of ranks) await this.checkStudentRank(r.id);
  }

  private async sweep(): Promise<void> {
    let cursor: string | undefined;
    let checked = 0;
    for (;;) {
      const batch = await this.prismaJobs.studentRank.findMany({
        where: { readyNotifiedAt: null },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: SWEEP_BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      for (const r of batch) {
        try {
          await this.checkStudentRank(r.id);
        } catch (err) {
          // One bad row must not stop the sweep; it is tried again tomorrow.
          this.logger.error(`grading-notifications: ready check failed for StudentRank ${r.id}`, err as Error);
        }
      }
      checked += batch.length;
      if (batch.length < SWEEP_BATCH) break;
      cursor = batch[batch.length - 1].id;
    }
    this.logger.log(`grading-notifications: ready-to-grade sweep checked ${checked} student rank(s).`);
  }

  private async checkStudentRank(studentRankId: string): Promise<void> {
    const db = this.prismaJobs;
    const sr = await db.studentRank.findUnique({
      where: { id: studentRankId },
      include: { skillStatuses: { select: { skillId: true, status: true } } },
    });
    if (!sr || sr.readyNotifiedAt) return;

    const school = await db.school.findUnique({ where: { id: sr.schoolId }, select: { archivedAt: true, ranksToggle: true } });
    if (!school || school.archivedAt || !school.ranksToggle) return;
    const enrolled = await db.roleGrant.findFirst({
      where: { userId: sr.studentId, schoolId: sr.schoolId, role: 'STUDENT', revokedAt: null },
      select: { id: true },
    });
    if (!enrolled) return;

    const ladder = await loadLadder(db, sr.disciplineId);
    const eligibility = eligibilityOnLadder(ladder, sr, await studentTimeZone(db, sr.studentId, sr.schoolId));
    if (!eligibility.hasNext || !eligibility.eligible) return;

    // Claim "once per rank" — on the rung just checked, so a rank change in
    // between isn't marked as notified.
    const claimedAt = new Date();
    const claim = await db.studentRank.updateMany({
      where: { id: sr.id, readyNotifiedAt: null, currentStripeId: sr.currentStripeId },
      data: { readyNotifiedAt: claimedAt },
    });
    if (claim.count === 0) return;

    try {
      const [recipients, student, discipline] = await Promise.all([
        this.readyRecipients(sr.schoolId, sr.disciplineId, sr.studentId),
        db.user.findUnique({ where: { id: sr.studentId }, select: { firstName: true, surname: true } }),
        db.discipline.findUnique({ where: { id: sr.disciplineId }, select: { name: true } }),
      ]);
      const nextRung = ladder.find((r) => r.id === eligibility.nextRungId);
      const name = student ? `${student.firstName} ${student.surname}` : 'A student';
      for (const userId of recipients) {
        const id = `grading-ready-${sr.id}-${claimedAt.getTime()}-${userId}`;
        await this.fanoutQueue.add(
          'notify',
          {
            notificationId: id,
            userId,
            title: 'Ready to grade',
            body: `${name} is ready for ${nextRung?.name ?? 'their next rank'} (${discipline?.name ?? 'grading'}).`,
            type: 'GRADING_READY',
          } satisfies NotificationFanoutJobData,
          { jobId: id, ...FANOUT_OPTIONS },
        );
      }
    } catch (err) {
      await db.studentRank.updateMany({ where: { id: sr.id, readyNotifiedAt: claimedAt }, data: { readyNotifiedAt: null } });
      throw err;
    }
  }

  /** The owner(s), plus the staff who may grade this student (see the class comment). */
  private async readyRecipients(schoolId: string, disciplineId: string, studentId: string): Promise<string[]> {
    const db = this.prismaJobs;
    const owners = await db.roleGrant.findMany({
      where: { schoolId, role: 'SCHOOL_OWNER_MANAGER', revokedAt: null },
      select: { userId: true },
    });
    const permitted = (await db.gradingPermission.findMany({ where: { schoolId, disciplineId }, select: { userId: true } })).map((p) => p.userId);
    let staff: string[] = [];
    if (permitted.length > 0) {
      const hasBranches = (await db.branch.findFirst({ where: { schoolId }, select: { id: true } })) !== null;
      const home = hasBranches
        ? await db.studentHomeBranch.findUnique({ where: { schoolId_studentId: { schoolId, studentId } }, select: { branchId: true } })
        : null;
      if (!hasBranches || home) {
        const grants = await db.roleGrant.findMany({
          where: {
            schoolId,
            userId: { in: permitted },
            role: { in: ['INSTRUCTOR', 'BRANCH_STAFF'] },
            revokedAt: null,
            ...(home ? { branchId: home.branchId } : {}),
          },
          select: { userId: true },
        });
        staff = grants.map((g) => g.userId);
      }
    }
    return [...new Set([...owners.map((o) => o.userId), ...staff])].filter((id) => id !== studentId);
  }

  private async promoted(data: GradingPromotedJobData): Promise<void> {
    const guardians = await this.prismaJobs.guardianLink.findMany({
      where: { studentId: data.studentId, revokedAt: null },
      select: { guardianId: true },
    });
    const title = data.kind === 'STRIPE' ? 'New stripe!' : data.kind === 'PROMOTED' ? 'Promoted!' : 'Rank updated';
    const base = { title, type: 'GRADING_RANK_CHANGE' };

    if (guardians.length === 0) {
      const body =
        data.kind === 'STRIPE'
          ? `You've earned ${data.toRungName}.`
          : data.kind === 'PROMOTED'
            ? `You've been promoted to ${data.toRungName}.`
            : `Your rank has been adjusted to ${data.toRungName}.`;
      const id = `grading-${data.promotionEventId}`;
      await this.fanoutQueue.add(
        'notify',
        { ...base, notificationId: id, userId: data.studentId, body: `${body} (${data.disciplineName})` } satisfies NotificationFanoutJobData,
        { jobId: id, ...FANOUT_OPTIONS },
      );
      return;
    }

    const student = await this.prismaJobs.user.findUnique({ where: { id: data.studentId }, select: { firstName: true } });
    const who = student?.firstName ?? 'Your child';
    const body =
      data.kind === 'STRIPE'
        ? `${who} has earned ${data.toRungName}.`
        : data.kind === 'PROMOTED'
          ? `${who} has been promoted to ${data.toRungName}.`
          : `${who}'s rank has been adjusted to ${data.toRungName}.`;
    for (const { guardianId } of guardians) {
      const id = `grading-${data.promotionEventId}-${guardianId}`;
      await this.fanoutQueue.add(
        'notify',
        { ...base, notificationId: id, userId: guardianId, body: `${body} (${data.disciplineName})` } satisfies NotificationFanoutJobData,
        { jobId: id, ...FANOUT_OPTIONS },
      );
    }
  }
}
