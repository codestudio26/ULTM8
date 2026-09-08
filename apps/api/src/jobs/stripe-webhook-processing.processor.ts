import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { STRIPE_WEBHOOK_PROCESSING_QUEUE } from './queue.constants';

type WebhookJobData = { stripeEventId: string; eventType: string; objectId: string };

/**
 * Consumes the `stripe-webhook-processing` queue — the dedup+handling half of Spec
 * 55 §10.2's confirmed webhook flow; signature verification and enqueueing happen
 * upstream in PaymentsService.handleIncomingWebhook, not here.
 *
 * Runs via `PrismaJobsService` (`ultm8_jobs` role) — see this phase's migration for
 * the additive SELECT/INSERT/UPDATE policies granted on MembershipPlan/Membership/
 * Transaction specifically for this job (unrestricted `USING/WITH CHECK (true)`,
 * matching class-occurrence-generation's own established shape for a no-single-
 * caller background job triggered by a global event, not a School-scoped request).
 *
 * **Phase 9 is the first real handler** — Phase 8 shipped this as a deliberate no-op
 * logger with no per-event-type branching at all. Structured as specific-case-plus-
 * safe-default, not an exhaustive enumeration: Stripe delivers event types this
 * phase doesn't name a handler for (charge.dispute.*, customer.subscription.updated,
 * invoice.paid — see below), and the safe default is exactly Phase 8's old
 * behavior (dedup, log, return), so an unhandled type is inert, never a crash.
 *
 * **Ordering fix**: Phase 8's own header comment flagged a real ordering gap — the
 * dedup INSERT committed before the (then nonexistent) handler logic ran, so a
 * handler failure after dedup would make a BullMQ retry see "already processed" and
 * silently skip the event. Restructured here exactly as that comment asked:
 * the dedup INSERT and the handler's own writes now run inside ONE
 * `prismaJobs.$transaction`, so a handler failure rolls back the dedup row too — a
 * retry sees a fresh (non-deduped) event and tries again, rather than silently
 * losing it.
 */
@Processor(STRIPE_WEBHOOK_PROCESSING_QUEUE)
export class StripeWebhookProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(StripeWebhookProcessingProcessor.name);

  constructor(private readonly prismaJobs: PrismaJobsService) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { stripeEventId, eventType, objectId } = job.data;

    try {
      await this.prismaJobs.$transaction(async (tx) => {
        await tx.processedStripeEvent.create({ data: { stripeEventId, eventType } });
        await this.dispatch(tx, eventType, objectId, stripeEventId);
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && this.isProcessedStripeEventConflict(err)) {
        this.logger.log(`Stripe event ${stripeEventId} (${eventType}) already processed — skipping (redelivery).`);
        return;
      }
      throw err;
    }
  }

  /**
   * FOUND ON REVIEW (independently by 4 review angles) — an earlier draft defaulted
   * to `true` (treat as the benign ProcessedStripeEvent dedup redelivery, safe to
   * swallow) whenever `err.meta?.target` wasn't an array. That's backwards: this
   * catch block now wraps not just the dedup INSERT but every handler's own writes
   * too, including `handlePaymentIntentSucceeded`'s `tx.membership.create()` against
   * `Membership_one_active_general_access_per_school` — a hand-authored partial
   * unique index with no `@@unique` in schema.prisma, so Prisma's engine has no
   * column-name mapping for it and may report `meta.target` in a shape this code
   * can't confidently parse as an array. Defaulting `true` there would silently
   * swallow the exact real, money-relevant collision that method's own header
   * comment spends a paragraph explaining must propagate loudly instead. Defaulting
   * to `false` (rethrow, let BullMQ retry, eventually alarm via onFailed) is the
   * safe direction to be wrong in: worst case a genuine redelivery gets one
   * spurious retry-and-refail cycle before permanently failing loudly; the old
   * default's worst case was a real payment/Membership inconsistency vanishing
   * with no alert at all.
   */
  private isProcessedStripeEventConflict(err: Prisma.PrismaClientKnownRequestError): boolean {
    const target = err.meta?.target;
    return Array.isArray(target) && target.includes('stripeEventId');
  }

  /** `tx` is the interactive-transaction client from `process()`'s own
   * `$transaction` call — every handler below writes through it, never through
   * `this.prismaJobs` directly, so a handler's writes commit-or-rollback atomically
   * with the dedup row above. */
  private async dispatch(
    tx: Prisma.TransactionClient,
    eventType: string,
    objectId: string,
    stripeEventId: string,
  ): Promise<void> {
    switch (eventType) {
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(tx, objectId);
        return;
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(tx, objectId);
        return;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(tx, objectId);
        return;
      // Safe defaults — see this file's own header comment for why each of these
      // stays log-only this phase rather than a guessed handler:
      //  - invoice.paid: Spec 55 §10.2 lists it as a handled event but never
      //    describes its handler role anywhere else, and Decision 6's own
      //    Membership-creation text only names payment_intent.succeeded — building
      //    a second, competing Membership-creation path from an unspecified event
      //    risks double-creation. Flagged for the Architect, not guessed.
      //  - invoice.payment_failed: feeds notification-fanout per Spec 55 §9, but
      //    NotificationsModule doesn't exist yet (Phase 12+, gated behind Booking).
      //  - customer.subscription.updated: nothing built yet reacts differently to
      //    past_due vs Active beyond what .deleted already covers on cancellation.
      //  - charge.dispute.*: Decision 55's real handling exists to freeze
      //    refund/credit-restore, neither built yet.
      case 'invoice.paid':
      case 'invoice.payment_failed':
      case 'customer.subscription.updated':
      case 'charge.dispute.created':
      case 'charge.dispute.updated':
      case 'charge.dispute.closed':
      default:
        this.logger.log(`Stripe event ${stripeEventId} (${eventType}) received and recorded — no handler for this type yet.`);
    }
  }

  /**
   * Decision 6's confirmed Membership-creation trigger, for ALL plan types
   * including SUBSCRIPTION (see MembershipsService.purchase()'s own comment on why
   * invoice.paid does NOT also get this role). `objectId` is the PaymentIntent id —
   * looked up against Transaction.stripePaymentIntentId, the correlation column
   * MembershipsService.purchase() sets at Transaction-creation time.
   */
  private async handlePaymentIntentSucceeded(tx: Prisma.TransactionClient, paymentIntentId: string): Promise<void> {
    const transaction = await tx.transaction.findUnique({ where: { stripePaymentIntentId: paymentIntentId } });
    if (!transaction) {
      this.logger.warn(`payment_intent.succeeded for ${paymentIntentId} — no matching Transaction found. Ignoring (not a Membership purchase this platform created).`);
      return;
    }
    if (transaction.status !== 'PENDING') {
      // Already settled by an earlier delivery of this same event, or a duplicate
      // payment_intent.succeeded Stripe occasionally sends for the same intent —
      // idempotent no-op, not an error.
      return;
    }

    const updateResult = await tx.transaction.updateMany({
      where: { id: transaction.id, status: 'PENDING' },
      data: { status: 'SUCCESSFUL' },
    });
    if (updateResult.count === 0) {
      return; // lost a race with a concurrent delivery — the other one already won.
    }

    const plan = await tx.membershipPlan.findUniqueOrThrow({ where: { id: transaction.membershipPlanId } });

    // Deliberately NOT caught here. An earlier draft of this method wrapped this
    // create() in its own try/catch to swallow a P2002 collision (Spec 55 §11.5's
    // two-simultaneous-Active-Memberships constraint) and log-and-continue within
    // the SAME transaction — that doesn't work: once any statement inside a
    // Postgres transaction errors, the whole transaction is aborted at the
    // database level regardless of a JS-level try/catch, so "catch and keep going"
    // would have left the surrounding `tx.transaction.updateMany` above and the
    // dedup INSERT in `process()` unable to commit either, throwing a confusing
    // second error instead of the clean rollback this comment now documents.
    // Letting it propagate is correct: the WHOLE transaction (dedup row + the
    // Transaction status flip above + this create) rolls back together — the
    // Transaction row stays PENDING (not falsely SUCCESSFUL-with-no-Membership),
    // and since the dedup row never committed, BullMQ's retry sees a fresh event
    // and tries the whole thing again. The business condition causing the
    // collision won't have changed between retries, so this repeats until BullMQ's
    // attempts exhaust and `onFailed` below logs it loudly and permanently — an
    // honest, visible failure rather than a silently-swallowed one.
    //
    // Spec 55 §6.1's confirmed collision handling is a Stripe Refund API call (and,
    // for a Subscription, cancelling it too) — NOT built here: this processor has
    // no StripeClientService wired up this phase, and an unverified money-moving
    // Stripe call inside this already-large phase risks shipping something
    // untested. TODO(Phase 9 follow-up): inject StripeClientService here and issue
    // the refund/cancel automatically instead of relying on `onFailed`'s log alone.
    const membership = await tx.membership.create({
      data: {
        id: randomUUID(),
        studentId: transaction.studentId,
        membershipPlanId: transaction.membershipPlanId,
        schoolId: transaction.schoolId,
        frequency: plan.type === 'SUBSCRIPTION' ? 'RECURRING' : 'ONE_TIME',
        classesRemaining: plan.classesIncluded ?? undefined,
        expiryDate: plan.expiryDurationDays ? new Date(Date.now() + plan.expiryDurationDays * 24 * 60 * 60 * 1000) : undefined,
        scopedClassId: plan.scopedClassId,
        stripeSubscriptionId: transaction.stripeSubscriptionId ?? undefined,
      },
    });
    await tx.transaction.update({ where: { id: transaction.id }, data: { membershipId: membership.id } });
  }

  /** payment_intent.payment_failed — flips a PENDING Transaction to FAILED. No
   * Membership was ever created for this Transaction (Decision 6), so nothing else
   * to undo. */
  private async handlePaymentIntentFailed(tx: Prisma.TransactionClient, paymentIntentId: string): Promise<void> {
    const transaction = await tx.transaction.findUnique({ where: { stripePaymentIntentId: paymentIntentId } });
    if (!transaction || transaction.status !== 'PENDING') {
      return;
    }
    await tx.transaction.updateMany({ where: { id: transaction.id, status: 'PENDING' }, data: { status: 'FAILED' } });
  }

  /**
   * Spec 55 §6.1 (quoted): "a failed renewal charge... Stripe's own retry schedule
   * keeps the Membership Active while... past_due, Expiring it... only once Stripe
   * exhausts retries and cancels the subscription." `customer.subscription.deleted`
   * fires exactly at that final-cancellation point (both voluntary cancellation and
   * exhausted-retries land here identically per that same confirmed text).
   *
   * The "same-day sweep cancels the Student's own future Bookings" half of this
   * rule is NOT built here — Booking doesn't exist in this codebase yet (Phase 11).
   */
  private async handleSubscriptionDeleted(tx: Prisma.TransactionClient, subscriptionId: string): Promise<void> {
    const membership = await tx.membership.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
    if (!membership || membership.status !== 'ACTIVE') {
      return;
    }
    await tx.membership.updateMany({ where: { id: membership.id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
    this.logger.log(
      `Membership ${membership.id} (Student ${membership.studentId}) Expired on subscription cancellation (${subscriptionId}). ` +
        'Booking sweep NOT run — Booking does not exist in this codebase yet (Phase 11 scope).',
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<WebhookJobData> | undefined, error: Error) {
    if (!job) return;
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts?.attempts ?? 1;
    if (attemptsMade >= maxAttempts) {
      this.logger.error(
        `Stripe webhook processing permanently failed after ${attemptsMade} attempt(s) for event ${job.data?.stripeEventId} (${job.data?.eventType}) — Stripe already has the money/state change and this platform hasn't recorded it.`,
        error,
      );
    }
  }
}
