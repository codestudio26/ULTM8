import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { STRIPE_WEBHOOK_PROCESSING_QUEUE } from './queue.constants';

/**
 * Consumes the `stripe-webhook-processing` queue (Phase 8) — the dedup+handling half
 * of Spec 55 §10.2's confirmed webhook flow; signature verification and enqueueing
 * happen upstream in PaymentsService.handleIncomingWebhook, not here.
 *
 * Runs via `PrismaJobsService` (`ultm8_jobs` role), NOT `PrismaAppService` —
 * corrected on code review from an earlier draft that used the bare `PrismaAppService`
 * client, citing `SettingsService.getLegalDocument()`'s "no RLS, no tenant context
 * needed" reasoning as precedent. That precedent doesn't actually transfer:
 * `SettingsService` is an HTTP-request-scoped, unauthenticated public route;
 * this processor is a background BullMQ worker with no single caller at all — the
 * exact situation `PrismaJobsService`/`ultm8_jobs` already exists for (see
 * `class-occurrence-generation.processor.ts`'s own header comment: "this is a genuine
 * cross-tenant sweep with no single caller, unlike every other write path in this
 * codebase"). `ProcessedStripeEvent` itself still carries no RLS, so this doesn't
 * change today's behavior — but it means the first real handler (Phase 9+, once
 * `payment_intent.succeeded` etc. need to touch RLS-protected `Membership`/
 * `Transaction` rows) extends a file already wired to the correct role, instead of
 * inheriting a bare-client pattern that would either silently no-op under RLS or
 * pressure someone into loosening `ultm8_app`'s own grants to work around it.
 *
 * Dedup is atomic — `create()` with a caught `P2002` on the table's own primary key
 * (`stripeEventId`), not a separate `findUnique` check first. Corrected on code
 * review from an earlier draft that did check-then-create as two statements: that
 * shape has a real TOCTOU race (Stripe genuinely redelivers the same event; two
 * concurrent deliveries can both pass the check before either commits), which this
 * codebase already has an established atomic pattern for avoiding elsewhere
 * (`class-occurrence-generation`'s own `createMany({ skipDuplicates: true })`) — just
 * expressed here as a single-row `create()` + catch, since `createMany`'s
 * `skipDuplicates` option doesn't surface *which* rows were skipped, and this
 * processor needs to know whether ITS OWN delivery was the duplicate (to skip the
 * handler) or the winner (to run it).
 *
 * **Every event this phase is received, deduplicated, and logged — none gets real
 * business handling yet.** This is the honest state of things, not an oversight:
 * `payment_intent.succeeded/failed`, `invoice.paid/payment_failed`,
 * `customer.subscription.updated/deleted`, and `charge.dispute.*` all need
 * `Membership`/`Transaction` to exist before there's anything for them to create or
 * update (Phase 9). `account.updated` — the one event a first draft of this file
 * expected to handle specially (setting `PaymentAccount.stripeConnectedAccountId`) —
 * turned out not to need that either: that id is set synchronously in
 * `PaymentsService.initiateConnectOnboarding()` from Stripe's own
 * `accounts.create()` response, not via this webhook (see that method's own
 * comment for why). There is currently no confirmed field to write
 * `account.updated`'s actual payload (`details_submitted`/`charges_enabled`) into,
 * so it stays logged-and-TODO'd like every other event here, not guessed at.
 *
 * **Ordering caveat for whoever adds the first real handler (Phase 9+)**: the dedup
 * `create()` below commits BEFORE the (currently no-op) handler logic runs. That's
 * fine while the handler can't fail — it does nothing but log. It stops being fine
 * once a real handler exists: if that handler throws partway through (e.g. a DB
 * write to `Transaction` errors), the dedup row is already committed, so a BullMQ
 * retry of the same event is treated as "already processed" and silently skipped —
 * the event is lost with no other safety net, since Stripe's own redelivery already
 * stopped once the webhook endpoint returned 200. Deliberately NOT built out into a
 * pending/completed status column now: with no real handler yet, there's nothing to
 * verify that machinery against, and speculative untested infrastructure is exactly
 * what this phase's own review already caught and removed once (see
 * `StripeClientService`'s history — `scopedClient()` was cut for the same reason).
 * Restructure this to handle-then-mark-complete (or wrap both in one transaction)
 * when the first real handler is added, not before.
 */
@Processor(STRIPE_WEBHOOK_PROCESSING_QUEUE)
export class StripeWebhookProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(StripeWebhookProcessingProcessor.name);

  constructor(private readonly prismaJobs: PrismaJobsService) {
    super();
  }

  async process(job: Job<{ stripeEventId: string; eventType: string }>): Promise<void> {
    const { stripeEventId, eventType } = job.data;

    try {
      await this.prismaJobs.processedStripeEvent.create({
        data: { stripeEventId, eventType },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(`Stripe event ${stripeEventId} (${eventType}) already processed — skipping (redelivery).`);
        return;
      }
      throw err;
    }

    // TODO(Phase 9+): real handling once Membership/Transaction exist —
    // payment_intent.succeeded/failed, invoice.paid/payment_failed,
    // customer.subscription.updated/deleted, charge.dispute.* (see this file's own
    // header comment), and account.updated once a confirmed field exists to write
    // its onboarding-completion signal into. See this file's own "ordering caveat"
    // comment above before adding a handler here.
    this.logger.log(`Stripe event ${stripeEventId} (${eventType}) received and recorded — no handler yet (Phase 8 scope).`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<{ stripeEventId: string; eventType: string }> | undefined, error: Error) {
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
