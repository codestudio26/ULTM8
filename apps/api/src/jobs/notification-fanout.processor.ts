import { Logger } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { NotificationDeliveryService } from '../notifications/notification-delivery.service';
import { PushNotificationService } from '../notifications/push-notification.service';
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
 *
 * Push (Decision 223/264) is a SEPARATE, best-effort channel, not given the
 * same propagate-and-retry treatment as email above — a deliberate asymmetry,
 * not an oversight. Email is this codebase's one spec-confirmed, eventually-
 * configured delivery channel (§11.4); push is still blocked on real FCM
 * credentials in every environment today (Decision 223/250's own "Still
 * blocked" note), so letting a push failure fail/retry the whole job would
 * make EVERY notification retry forever — and once FCM is configured, a
 * transient push failure still shouldn't block or retry an email that already
 * succeeded. Push errors (including "not configured") are caught and logged
 * here instead; the in-app Notification row and email delivery are both
 * unaffected by push's outcome either way.
 *
 * Parents (Decision 333, chosen by the product owner 26 Oct 2026): a
 * notification for a Student with live GuardianLinks is also copied to each
 * linked guardian, as "For {firstName}: {body}", one job per guardian with a
 * deterministic id. A minor created by a guardian has no login, and its
 * email is GuardiansService.createMinor's placeholder, so for them only the
 * in-app row is written — no push or email to that address. (Told apart by
 * the placeholder's domain: ultm8_jobs is not granted `phoneVerifiedAt`.) The grading producers already
 * address guardians directly and never the minor itself, so nothing is
 * doubled; a copy (`guardianCopyOf` set) is never copied on again.
 */
/** GuardiansService.createMinor's placeholder email domain. */
const MINOR_PLACEHOLDER_EMAIL_DOMAIN = '@guardian-managed.ultm8.internal';

@Processor(NOTIFICATION_FANOUT_QUEUE)
export class NotificationFanoutProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationFanoutProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly delivery: NotificationDeliveryService,
    private readonly push: PushNotificationService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly fanoutQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<NotificationFanoutJobData>): Promise<void> {
    const { notificationId, userId, title, body, type, guardianCopyOf, schoolId, targetType, targetId, inAppOnly } = job.data;

    // Decision 355: the School's name is copied onto the row now, since the
    // reader can't always see the School itself (see the Notification model).
    const school = schoolId ? await this.prismaJobs.school.findUnique({ where: { id: schoolId }, select: { name: true } }) : null;
    const extra = { schoolId: schoolId ?? null, schoolName: school?.name ?? null, targetType: targetType ?? null, targetId: targetId ?? null };

    // Idempotent by design — see this class's own header comment. Runs before
    // the email attempt below so a retry never re-sends an email for a
    // notification that failed to deliver AND never duplicates the row for
    // one that already delivered.
    await this.prismaJobs.notification.upsert({
      where: { id: notificationId },
      create: { id: notificationId, userId, title, body, type, ...extra },
      update: { title, body, type, ...extra },
    });

    const user = await this.prismaJobs.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true },
    });
    if (!user) {
      // The target User row is gone (a genuine race — deleted between enqueue and
      // processing) — the Notification row above still exists for consistency's
      // sake (an orphaned notification is a minor cosmetic issue, not a
      // correctness one), but there's no email address left to deliver to. Not
      // a delivery failure worth retrying — nothing will make the User reappear.
      this.logger.warn(`notification-fanout: User ${userId} not found — Notification ${notificationId} created, no email sent.`);
      return;
    }

    if (!guardianCopyOf) {
      const guardians = await this.prismaJobs.guardianLink.findMany({
        where: { studentId: userId, revokedAt: null },
        select: { guardianId: true },
      });
      if (guardians.length > 0) {
        await this.fanoutQueue.addBulk(
          guardians.map(({ guardianId }) => {
            const id = `${notificationId}-guardian-${guardianId}`;
            const data: NotificationFanoutJobData = {
              notificationId: id,
              userId: guardianId,
              title,
              body: `For ${user.firstName}: ${body}`,
              type,
              guardianCopyOf: userId,
              schoolId,
              targetType,
              targetId,
              inAppOnly,
            };
            return { name: 'notify', data, opts: { jobId: id, attempts: 3, backoff: { type: 'exponential' as const, delay: 5000 } } };
          }),
        );
        // A child with no login of their own: the in-app row above is enough.
        if (user.email.endsWith(MINOR_PLACEHOLDER_EMAIL_DOMAIN)) return;
      }
    }

    if (inAppOnly) return;

    // Push first, and only on the first attempt: it is caught (never fails the
    // job), so a retry exists only to re-try EMAIL — re-sending push on it would
    // buzz the same phone again. Before this ordering, push ran only after a
    // successful email, so an email outage silently took push down with it.
    if (!job.attemptsMade) {
      await this.sendPush(notificationId, userId, title, body);
    }

    // No email service configured at all (as on staging this testing round):
    // nothing a retry can fix, so skip quietly instead of failing the job three
    // times and logging a "permanently failed" alarm for every notification.
    if (!this.delivery.isConfigured()) {
      this.logger.debug(`notification-fanout: email not configured — Notification ${notificationId} delivered in-app only.`);
      return;
    }
    await this.delivery.sendEmail(user.email, title, body);
  }

  /** Best-effort push — see this class's own header comment for why a push
   * failure is logged, never propagated. */
  private async sendPush(notificationId: string, userId: string, title: string, body: string): Promise<void> {
    try {
      const deviceTokens = await this.prismaJobs.deviceToken.findMany({ where: { userId }, select: { token: true } });
      if (deviceTokens.length > 0) {
        const { staleTokens } = await this.push.send(deviceTokens.map((d) => d.token), title, body);
        if (staleTokens.length > 0) {
          await this.prismaJobs.deviceToken.deleteMany({ where: { token: { in: staleTokens } } });
        }
      }
    } catch (err) {
      this.logger.warn(
        `notification-fanout: push delivery unavailable for Notification ${notificationId} (User ${userId}) — email channel unaffected. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
