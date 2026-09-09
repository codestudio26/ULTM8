import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { NotificationDeliveryService } from '../notifications/notification-delivery.service';
import { NOTIFICATION_FANOUT_QUEUE } from './queue.constants';
import { NotificationFanoutJobData } from './notification-fanout.types';

/**
 * Consumes the `notification-fanout` queue (Phase 15) — Spec 55 §9's confirmed
 * job: "Triggered by: Any of the above, plus manual school messages." Every
 * other job whose own "Notification samples" text names a real trigger enqueues
 * ONE job here per (notificationId, userId, title, body) — this processor is
 * the single place that actually writes the Notification row and attempts
 * delivery, so every trigger gets identical behavior rather than each caller
 * reimplementing it.
 *
 * Runs via PrismaJobsService (ultm8_jobs) — the calling context (e.g. a School
 * Owner creating a Waiver) is never the notification's own target, the same
 * cross-user-write shape Booking's capacity check (Decision 89) and Guardian's
 * consent-withdrawal cascade (Decision 92) already established.
 *
 * Retry semantics — FOUND ON REVIEW, this is a real correction, not a
 * restatement: an earlier draft wrote the Notification row unconditionally
 * via `.create()`, then swallowed any email-delivery error in a try/catch so
 * the job always "succeeded," with no retry ever configured or attempted —
 * despite the header comment at the time falsely claiming parity with
 * `OtpDeliveryProcessor`'s real retry-then-log-loudly precedent. This version
 * earns that comparison instead of just asserting it: the Notification row is
 * written via `upsert` keyed on the producer-supplied, deterministic
 * `notificationId` (see notification-fanout.types.ts) — safe to run more than
 * once for the same logical event, since a retry re-creating the identical
 * row is a no-op, not a duplicate. Email delivery failure is allowed to
 * PROPAGATE (not swallowed), so BullMQ's own `attempts`/`backoff` (configured
 * per-job by each producer — see WaiverSignatureRequestsProcessor) actually
 * retries it, and `onFailed` below logs loudly only once every retry is
 * exhausted — the exact `OtpDeliveryProcessor` shape this now genuinely
 * matches. The in-app Notification row is durably written on the FIRST
 * attempt regardless of how the email delivery ultimately resolves — a
 * permanently-failed email doesn't undo it.
 */
@Processor(NOTIFICATION_FANOUT_QUEUE)
export class NotificationFanoutProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationFanoutProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly delivery: NotificationDeliveryService,
  ) {
    super();
  }

  async process(job: Job<NotificationFanoutJobData>): Promise<void> {
    const { notificationId, userId, title, body, type } = job.data;

    // Idempotent by design — see this class's own header comment. Runs before
    // the email attempt below so a retry never re-sends an email for a
    // notification that failed to deliver AND never duplicates the row for
    // one that already delivered.
    await this.prismaJobs.notification.upsert({
      where: { id: notificationId },
      create: { id: notificationId, userId, title, body, type },
      update: { title, body, type },
    });

    const user = await this.prismaJobs.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) {
      // The target User row is gone (a genuine race — deleted between enqueue and
      // processing) — the Notification row above still exists for consistency's
      // sake (an orphaned notification is a minor cosmetic issue, not a
      // correctness one), but there's no email address left to deliver to. Not
      // a delivery failure worth retrying — nothing will make the User reappear.
      this.logger.warn(`notification-fanout: User ${userId} not found — Notification ${notificationId} created, no email sent.`);
      return;
    }

    await this.delivery.sendEmail(user.email, title, body);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<NotificationFanoutJobData> | undefined, error: Error) {
    if (!job) return;
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts?.attempts ?? 1;
    if (attemptsMade >= maxAttempts) {
      // The Notification row (in-app) was already durably written on the first
      // attempt regardless — only email delivery is what's permanently failed
      // here. "Surfaced to Platform Admin" (§11.4's confirmed dead-letter
      // behavior) isn't built yet — PlatformAdminModule doesn't exist (see
      // Decision 95) — logged loudly instead, matching OtpDeliveryProcessor's
      // own precedent.
      this.logger.error(
        `notification-fanout: email delivery permanently failed after ${attemptsMade} attempt(s) for Notification ${job.data.notificationId} (User ${job.data.userId}) — the in-app notification still exists, only email delivery failed.`,
        error,
      );
    }
  }
}
