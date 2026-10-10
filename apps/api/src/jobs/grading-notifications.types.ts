import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

/**
 * Payloads for the `grading-notifications` queue (Decisions 145, 178). Job
 * names: 'ready-check', 'promoted', and the daily 'sweep' (no payload).
 */

/** Check whether a student is now ready for their next rung: in one style, or
 * in every style they hold a rank in (a check-in can count toward several). */
export interface GradingReadyCheckJobData {
  studentId: string;
  disciplineId?: string;
}

/** A coach changed the student's rank. The job picks the recipients: the
 * student, or, for a minor, their guardians (Decision 145, item 2). */
export interface GradingPromotedJobData {
  promotionEventId: string;
  studentId: string;
  disciplineName: string;
  toRungName: string;
  kind: 'PROMOTED' | 'STRIPE' | 'ADJUSTED';
}

const logger = new Logger('GradingNotifications');

/**
 * Queue a "ready to grade" check after a grading action has committed. A
 * failure to queue is logged, not thrown: the action itself succeeded, and the
 * daily sweep checks the student anyway.
 */
export async function queueReadyCheck(queue: Queue, studentId: string, disciplineId?: string): Promise<void> {
  try {
    await queue.add('ready-check', { studentId, disciplineId } satisfies GradingReadyCheckJobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  } catch (err) {
    logger.warn(`Could not queue a ready-to-grade check for student ${studentId} (the daily sweep will pick it up): ${err}`);
  }
}
