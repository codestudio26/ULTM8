import { Injectable, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { PaymentsService } from '../payments/payments.service';
import { MEMBERSHIP_PLAN_PRICE_MIGRATION_QUEUE } from './queue.constants';
import { MembershipPlanPriceMigrationJobData } from './membership-plan-price-migration.types';

/**
 * Consumes the `membership-plan-price-migration` queue (v1.2 backend backlog —
 * Subscription price-change migrate-vs-grandfather prompt). Event-triggered,
 * not a periodic sweep — enqueued once, by MembershipsService.updatePlan(),
 * the instant a staff member records a MIGRATE decision — same shape
 * ChargebackPatternRestrictionProcessor's own header comment already
 * establishes for "react to an event, no Scheduler needed."
 *
 * Runs via PrismaJobsService (`ultm8_jobs` role) — a genuine
 * potentially-many-row bulk Stripe operation with no single HTTP caller to
 * block on, same class as FranchiseFeeUsageReportingProcessor's own per-row
 * Stripe loop. Per-row try/catch, same "one bad row doesn't abort the whole
 * sweep" convention that processor already established for its own per-School
 * loop — one Student's Stripe Subscription failing to migrate (e.g. it was
 * cancelled moments earlier by its own Student-initiated flow) must not stop
 * every OTHER subscriber on this plan from being migrated.
 *
 * Idempotent by construction, not by a separate dedup key: re-running this job
 * for the same MembershipPlanPriceChange id simply re-issues
 * `subscriptions.update()` with the same target Price for whichever
 * Memberships are still ACTIVE with a stripeSubscriptionId — Stripe's own
 * `subscriptions.update()` is itself idempotent in effect (setting an item's
 * Price to the Price it is already on is a no-op charge-wise), and a
 * Membership already migrated by an earlier attempt is migrated again
 * harmlessly rather than skipped, which is the safer of the two failure modes
 * for a job whose own retry policy (BullMQ default, 3 attempts/exponential
 * backoff — Decision 23) can re-run it after a partial failure.
 */
@Processor(MEMBERSHIP_PLAN_PRICE_MIGRATION_QUEUE)
export class MembershipPlanPriceMigrationProcessor extends WorkerHost {
  private readonly logger = new Logger(MembershipPlanPriceMigrationProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly paymentsService: PaymentsService,
  ) {
    super();
  }

  async process(job: Job<MembershipPlanPriceMigrationJobData>): Promise<void> {
    const { priceChangeId } = job.data;

    const priceChange = await this.prismaJobs.membershipPlanPriceChange.findUnique({
      where: { id: priceChangeId },
      include: { membershipPlan: { include: { school: { include: { paymentAccount: true } } } } },
    });
    if (!priceChange) {
      this.logger.error(`MembershipPlanPriceChange ${priceChangeId} not found — nothing to migrate.`);
      return;
    }
    // Guards against a redundant re-enqueue reaching here after this job
    // already ran to a terminal state once (BullMQ retries only re-run a
    // FAILED attempt, but a defensive check costs nothing and matches
    // usageReportPass()'s own "an existing row of ANY status should never be
    // reprocessed" discipline).
    if (priceChange.status === 'COMPLETED' || priceChange.status === 'FAILED') {
      return;
    }
    if (priceChange.decision !== 'MIGRATE') {
      this.logger.error(`MembershipPlanPriceChange ${priceChangeId} is a ${priceChange.decision} decision — this job only ever processes MIGRATE.`);
      return;
    }

    const plan = priceChange.membershipPlan;
    const connectedAccountId = plan.school.paymentAccount?.stripeConnectedAccountId;
    const newPriceId = plan.stripePriceId;
    if (!connectedAccountId || !newPriceId) {
      this.logger.error(
        `MembershipPlanPriceChange ${priceChangeId} (plan ${plan.id}) is missing a connected Stripe account or stripePriceId — cannot migrate.`,
      );
      await this.prismaJobs.membershipPlanPriceChange.update({ where: { id: priceChangeId }, data: { status: 'FAILED', completedAt: new Date() } });
      return;
    }

    await this.prismaJobs.membershipPlanPriceChange.update({ where: { id: priceChangeId }, data: { status: 'PROCESSING' } });

    const memberships = await this.prismaJobs.membership.findMany({
      where: { membershipPlanId: plan.id, status: 'ACTIVE', stripeSubscriptionId: { not: null } },
      select: { id: true, stripeSubscriptionId: true },
    });

    let migrated = 0;
    let failed = 0;
    for (const membership of memberships) {
      try {
        await this.paymentsService.migrateSubscriptionToNewPrice(connectedAccountId, membership.stripeSubscriptionId!, newPriceId);
        migrated++;
      } catch (err) {
        failed++;
        this.logger.error(`Failed to migrate Membership ${membership.id} (Subscription ${membership.stripeSubscriptionId}) to Price ${newPriceId}`, err as Error);
      }
    }

    await this.prismaJobs.membershipPlanPriceChange.update({
      where: { id: priceChangeId },
      data: {
        // A total failure (every row failed, at least one existed) is
        // reported FAILED so staff see a loud signal rather than a quiet
        // COMPLETED with migratedCount: 0 — a partial failure still reports
        // COMPLETED with its own failedCount, same "best-effort bulk op,
        // counts tell the real story" shape FranchiseFeeUsageReportingProcessor's
        // own per-row try/catch already established.
        status: failed > 0 && migrated === 0 && memberships.length > 0 ? 'FAILED' : 'COMPLETED',
        migratedCount: migrated,
        failedCount: failed,
        completedAt: new Date(),
      },
    });
    this.logger.log(`membership-plan-price-migration: plan ${plan.id} — ${migrated} migrated, ${failed} failed, ${memberships.length} total.`);
  }

  /** Same loud-alarm-on-permanent-failure convention
   * ChargebackPatternRestrictionProcessor's own identical hook already
   * establishes — a migration that should have run but silently didn't is a
   * real billing-correctness gap (some subscribers left on a stale price
   * indefinitely), not a benign miss. */
  @OnWorkerEvent('failed')
  onFailed(job: Job<MembershipPlanPriceMigrationJobData> | undefined, error: Error) {
    if (!job) return;
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts?.attempts ?? 1;
    if (attemptsMade >= maxAttempts) {
      this.logger.error(
        `membership-plan-price-migration permanently failed after ${attemptsMade} attempt(s) for MembershipPlanPriceChange ${job.data?.priceChangeId} — some subscribers may still be on the old Stripe Price.`,
        error,
      );
    }
  }
}
