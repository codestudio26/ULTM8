import { Logger } from '@nestjs/common';
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { StripeClientService } from '../payments/stripe-client.service';
import { FranchiseFeeBillingService } from '../franchise-fees/franchise-fee-billing.service';
import { FRANCHISE_FEE_RATE_MIGRATION_QUEUE } from './queue.constants';
import { FranchiseFeeDeferredSwapJobData, FranchiseFeeRateMigrationJobData } from './franchise-fee-rate-migration.types';

type RateChangeWithFranchise = Prisma.FranchiseFeeRateChangeGetPayload<{ include: { franchise: { include: { paymentAccount: true } } } }>;

// Deliberate buffer past a Subscription Item's own `current_period_end` before
// firing a deferred PER_HEADCOUNT/MIGRATE_NEXT_CYCLE swap — Stripe generates the
// period's final invoice automatically close to that timestamp, not necessarily
// exactly at it. This is a disclosed buffer, not a guarantee: if Stripe's own
// invoice generation is ever delayed past it for an unrelated reason, the swap
// could still land before that invoice finalizes, re-rating that period anyway.
// No existing mechanism in this codebase (e.g. a webhook-driven wait for
// invoice.created) removes that residual risk without materially more complexity
// than this phase's scope — flagged, not hidden.
const DEFERRED_SWAP_BUFFER_MS = 15 * 60 * 1000;

/**
 * Consumes the `franchise-fee-rate-migration` queue (Decision 99's own follow-up) —
 * the real rate-migration mechanism FranchisesService.update() used to reject
 * outright once franchise-fee billing had started for at least one School under a
 * Franchise. Event-triggered, enqueued once by FranchisesService.update() the
 * instant a feeRateChangeStrategy decision is recorded — same shape
 * MembershipPlanPriceMigrationProcessor's own header comment already establishes
 * for "react to one event, no Scheduler needed."
 *
 * FLAT and PER_HEADCOUNT are NOT mechanically symmetric, and neither are the two
 * strategies for PER_HEADCOUNT — verified directly against the installed `stripe`
 * SDK's own types before building, not assumed:
 *
 * - FLAT: a flat recurring Price's billing impact is always forward-looking —
 *   swapping a Subscription Item's Price right now with `proration_behavior:
 *   'none'` changes nothing about what's already been charged, only what the NEXT
 *   invoice bills. That already IS "next cycle" semantics, with no deferral
 *   needed. MIGRATE_IMMEDIATE instead passes `proration_behavior: 'always_invoice'`
 *   — Stripe immediately invoices the prorated difference for the remaining days
 *   of the current period, on top of the new rate applying going forward.
 * - PER_HEADCOUNT (metered): Stripe always bills a metered item's WHOLE period at
 *   whichever Price is attached when that period's invoice is generated — it has
 *   no concept of splitting a period's accumulated usage by date across two
 *   Prices. That means an immediate Price swap can NEVER cleanly affect "only the
 *   remaining days" the way FLAT's `proration_behavior` can — this is a genuine
 *   Stripe billing constraint, not a choice this code makes:
 *     - MIGRATE_IMMEDIATE: swap the Subscription Item's Price right now. Disclosed
 *       (FranchisesService.update()'s own BadRequestException, confirmed with the
 *       product owner before building) that this re-rates the Franchise's ENTIRE
 *       current period's already-accrued usage at the NEW rate, not just the days
 *       remaining.
 *     - MIGRATE_NEXT_CYCLE: the swap is deliberately DEFERRED past the Subscription
 *       Item's own `current_period_end` (via a second, delayed job on this same
 *       queue, `deferred-swap`) — so the already-committed current period's
 *       invoice generates at the OLD rate, and only the Price attached afterward
 *       (the new one) affects the NEXT period's usage. A real Stripe Subscription
 *       Schedule (two phases, old Price ending at `current_period_end`, new Price
 *       starting there) would also achieve this without a delayed job, but adds
 *       real additional API-surface risk (schedule phase/item-quantity edge cases)
 *       this phase's scope doesn't need — a BullMQ delayed job achieves the exact
 *       same outcome with infrastructure this codebase already has.
 *
 * `status: COMPLETED` on the main `FranchiseFeeRateChange` row means every
 * affected School's swap was either performed (FLAT, PER_HEADCOUNT/IMMEDIATE) or
 * successfully SCHEDULED (PER_HEADCOUNT/NEXT_CYCLE) — a scheduled deferred swap's
 * own eventual success/failure is logged by `processDeferredSwap` but not
 * reflected back onto this row (would need either a child-row model or a wider
 * status enum, both out of this phase's scope) — disclosed here rather than
 * silently implied.
 *
 * Per-row try/catch across every School, same "one bad row doesn't abort the
 * whole sweep" convention MembershipPlanPriceMigrationProcessor's own identical
 * loop already establishes.
 */
@Processor(FRANCHISE_FEE_RATE_MIGRATION_QUEUE)
export class FranchiseFeeRateMigrationProcessor extends WorkerHost {
  private readonly logger = new Logger(FranchiseFeeRateMigrationProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly stripeClient: StripeClientService,
    private readonly franchiseFeeBilling: FranchiseFeeBillingService,
    @InjectQueue(FRANCHISE_FEE_RATE_MIGRATION_QUEUE) private readonly rateMigrationQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<FranchiseFeeRateMigrationJobData | FranchiseFeeDeferredSwapJobData>): Promise<void> {
    if (job.name === 'deferred-swap') {
      return this.processDeferredSwap(job as Job<FranchiseFeeDeferredSwapJobData>);
    }
    return this.processMigration(job as Job<FranchiseFeeRateMigrationJobData>);
  }

  private async processMigration(job: Job<FranchiseFeeRateMigrationJobData>): Promise<void> {
    const { rateChangeId } = job.data;

    const rateChange = await this.prismaJobs.franchiseFeeRateChange.findUnique({
      where: { id: rateChangeId },
      include: { franchise: { include: { paymentAccount: true } } },
    });
    if (!rateChange) {
      this.logger.error(`FranchiseFeeRateChange ${rateChangeId} not found — nothing to migrate.`);
      return;
    }
    // Same defensive re-check MembershipPlanPriceMigrationProcessor's own
    // identical guard documents — a redundant re-enqueue should never reprocess
    // an already-terminal row.
    if (rateChange.status === 'COMPLETED' || rateChange.status === 'FAILED') {
      return;
    }

    const franchise = rateChange.franchise;
    const account = franchise.paymentAccount;
    if (!account || account.provider !== 'STRIPE' || !account.stripeConnectedAccountId) {
      this.logger.error(`FranchiseFeeRateChange ${rateChangeId} (Franchise ${franchise.id}) has no valid Stripe PaymentAccount — cannot migrate.`);
      await this.prismaJobs.franchiseFeeRateChange.update({ where: { id: rateChangeId }, data: { status: 'FAILED', completedAt: new Date() } });
      return;
    }

    await this.prismaJobs.franchiseFeeRateChange.update({ where: { id: rateChangeId }, data: { status: 'PROCESSING' } });

    const stripe = this.stripeClient.scopedClient(account.stripeConnectedAccountId);

    const schools = await this.prismaJobs.school.findMany({
      where: { franchiseId: franchise.id, stripeFranchiseFeeSubscriptionId: { not: null } },
      select: { id: true, stripeFranchiseFeeSubscriptionId: true },
    });

    // PER_HEADCOUNT needs exactly one new, shared metered Price up front (same
    // Meter, new rate) — created once here, then reused by every School's own
    // swap/deferred-swap below, rather than one new Price per School the way
    // FLAT needs (see createReplacementFlatPrice's own comment on why those two
    // cases differ).
    let sharedMeteredPriceId: string | undefined;
    if (rateChange.feeModel === 'PER_HEADCOUNT') {
      try {
        sharedMeteredPriceId = await this.franchiseFeeBilling.createReplacementMeteredPrice(franchise, stripe, rateChange.newPerHeadcountRate!);
      } catch (err) {
        this.logger.error(`FranchiseFeeRateChange ${rateChangeId} — failed to create the replacement metered Price, aborting.`, err as Error);
        await this.prismaJobs.franchiseFeeRateChange.update({ where: { id: rateChangeId }, data: { status: 'FAILED', completedAt: new Date() } });
        return;
      }
    }

    let migrated = 0;
    let failed = 0;
    for (const school of schools) {
      try {
        await this.migrateOneSchool(stripe, school.id, school.stripeFranchiseFeeSubscriptionId!, rateChange, sharedMeteredPriceId);
        migrated++;
      } catch (err) {
        failed++;
        this.logger.error(`Failed to migrate School ${school.id} (Subscription ${school.stripeFranchiseFeeSubscriptionId}) for FranchiseFeeRateChange ${rateChangeId}`, err as Error);
      }
    }

    await this.prismaJobs.franchiseFeeRateChange.update({
      where: { id: rateChangeId },
      data: {
        // A total failure (every row failed, at least one existed) is reported
        // FAILED so staff see a loud signal rather than a quiet COMPLETED with
        // migratedCount: 0 — same "best-effort bulk op, counts tell the real
        // story" shape MembershipPlanPriceMigrationProcessor's own identical
        // final-status write already establishes.
        status: failed > 0 && migrated === 0 && schools.length > 0 ? 'FAILED' : 'COMPLETED',
        migratedCount: migrated,
        failedCount: failed,
        completedAt: new Date(),
      },
    });
    this.logger.log(`franchise-fee-rate-migration: Franchise ${franchise.id} — ${migrated} migrated/scheduled, ${failed} failed, ${schools.length} total.`);
  }

  private async migrateOneSchool(
    stripe: Stripe,
    schoolId: string,
    subscriptionId: string,
    rateChange: RateChangeWithFranchise,
    sharedMeteredPriceId: string | undefined,
  ): Promise<void> {
    if (rateChange.feeModel === 'FLAT') {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const item = subscription.items.data[0];
      if (!item) {
        throw new Error(`Stripe Subscription ${subscriptionId} has no Subscription Item.`);
      }
      const productId = typeof item.price.product === 'string' ? item.price.product : item.price.product.id;
      const newPriceId = await this.franchiseFeeBilling.createReplacementFlatPrice(stripe, productId, rateChange.newFlatFeeAmount!);
      await this.franchiseFeeBilling.swapSubscriptionPrice(stripe, subscriptionId, newPriceId, rateChange.strategy === 'MIGRATE_IMMEDIATE' ? 'always_invoice' : 'none');
      return;
    }

    // PER_HEADCOUNT
    if (rateChange.strategy === 'MIGRATE_IMMEDIATE') {
      // proration_behavior has no meaningful stub-period effect on a metered item
      // (no quantity, no stub invoice to prorate) — 'none' is passed only because
      // the Stripe param is required, not because another value would change
      // anything here. The disclosed re-rate risk IS this immediate swap itself.
      await this.franchiseFeeBilling.swapSubscriptionPrice(stripe, subscriptionId, sharedMeteredPriceId!, 'none');
      return;
    }

    // MIGRATE_NEXT_CYCLE — defer past this Subscription Item's own current period,
    // see this class's own header comment for why an immediate swap can never be
    // safe for a metered item.
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const item = subscription.items.data[0];
    if (!item) {
      throw new Error(`Stripe Subscription ${subscriptionId} has no Subscription Item.`);
    }
    const delay = Math.max(0, item.current_period_end * 1000 - Date.now()) + DEFERRED_SWAP_BUFFER_MS;
    await this.rateMigrationQueue.add(
      'deferred-swap',
      {
        rateChangeId: rateChange.id,
        schoolId,
        stripeSubscriptionId: subscriptionId,
        newPriceId: sharedMeteredPriceId!,
      } satisfies FranchiseFeeDeferredSwapJobData,
      { delay, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, jobId: `${rateChange.id}-${schoolId}-deferred` },
    );
  }

  /**
   * PER_HEADCOUNT/MIGRATE_NEXT_CYCLE only — performs the swap this class's own
   * header comment deferred. Re-fetches the FranchiseFeeRateChange/PaymentAccount
   * fresh rather than trusting anything cached in the job payload beyond ids —
   * this can fire days or weeks after the main job ran.
   */
  private async processDeferredSwap(job: Job<FranchiseFeeDeferredSwapJobData>): Promise<void> {
    const { rateChangeId, schoolId, stripeSubscriptionId, newPriceId } = job.data;

    const rateChange = await this.prismaJobs.franchiseFeeRateChange.findUnique({
      where: { id: rateChangeId },
      include: { franchise: { include: { paymentAccount: true } } },
    });
    if (!rateChange) {
      this.logger.error(`Deferred swap for FranchiseFeeRateChange ${rateChangeId}/School ${schoolId} — rate change row no longer exists.`);
      return;
    }
    const account = rateChange.franchise.paymentAccount;
    if (!account?.stripeConnectedAccountId) {
      this.logger.error(`Deferred swap for FranchiseFeeRateChange ${rateChangeId}/School ${schoolId} — Franchise has no valid Stripe PaymentAccount.`);
      return;
    }

    const stripe = this.stripeClient.scopedClient(account.stripeConnectedAccountId);
    await this.franchiseFeeBilling.swapSubscriptionPrice(stripe, stripeSubscriptionId, newPriceId, 'none');
    this.logger.log(`franchise-fee-rate-migration deferred-swap completed: FranchiseFeeRateChange ${rateChangeId}, School ${schoolId}.`);
  }

  /** Same loud-alarm-on-permanent-failure convention
   * MembershipPlanPriceMigrationProcessor's own identical hook already
   * establishes — a migration or deferred swap that should have run but silently
   * didn't is a real billing-correctness gap, not a benign miss. */
  @OnWorkerEvent('failed')
  onFailed(job: Job<FranchiseFeeRateMigrationJobData | FranchiseFeeDeferredSwapJobData> | undefined, error: Error) {
    if (!job) return;
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts?.attempts ?? 1;
    if (attemptsMade >= maxAttempts) {
      this.logger.error(`franchise-fee-rate-migration (${job.name}) permanently failed after ${attemptsMade} attempt(s) — job data: ${JSON.stringify(job.data)}`, error);
    }
  }
}
