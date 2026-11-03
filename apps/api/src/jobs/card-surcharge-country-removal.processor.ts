import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { PaymentsService } from '../payments/payments.service';
import { CARD_SURCHARGE_COUNTRY_REMOVAL_QUEUE } from './queue.constants';
import { CardSurchargeCountryRemovalJobData } from './card-surcharge-country-removal.types';

/**
 * Consumes the `card-surcharge-country-removal` queue (Decision 419 item 3):
 * "When Platform Admin removes a country from the surcharge allow-list, every
 * running Subscription at a School in that country stops charging the
 * surcharge from its next renewal." Enqueued once per removal by
 * CardSurchargeService.removeCountry(), no Scheduler, the same event-triggered
 * shape as MembershipPlanPriceMigrationProcessor.
 *
 * Runs via PrismaJobsService (`ultm8_jobs`): one platform action reaches every
 * School in the country, so there is no single tenant caller to scope to. It
 * reads only Schools in that country, their Stripe accounts and their Active
 * Subscription Memberships, and each Stripe call goes to that School's own
 * connected account.
 *
 * Per-Subscription try/catch: one Subscription Stripe refuses (cancelled a
 * moment ago, a network error) doesn't stop the rest. If any failed, the job
 * throws at the end so BullMQ retries it (3 attempts, exponential backoff,
 * set where it is enqueued). A re-run is safe:
 * PaymentsService.removeSubscriptionSurcharge() reads each Subscription first
 * and leaves one that no longer carries a surcharge as it is.
 *
 * Owner changes (turning the surcharge off, changing the %) never come here:
 * they keep applying only when a member next subscribes (#427).
 */
@Processor(CARD_SURCHARGE_COUNTRY_REMOVAL_QUEUE)
export class CardSurchargeCountryRemovalProcessor extends WorkerHost {
  private readonly logger = new Logger(CardSurchargeCountryRemovalProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly paymentsService: PaymentsService,
  ) {
    super();
  }

  async process(job: Job<CardSurchargeCountryRemovalJobData>): Promise<{ removed: number; unchanged: number; failed: number }> {
    const countryCode = job.data.countryCode.toUpperCase();
    const removedAt = new Date(job.data.removedAt);

    // The same match card_surcharge_bps() uses: upper(School.addressCountry).
    const schools = await this.prismaJobs.school.findMany({
      where: { addressCountry: { equals: countryCode, mode: 'insensitive' } },
      select: { id: true, paymentAccount: { select: { provider: true, stripeConnectedAccountId: true } } },
    });
    const accountBySchool = new Map<string, string>();
    for (const school of schools) {
      const account = school.paymentAccount;
      if (account?.provider === 'STRIPE' && account.stripeConnectedAccountId) accountBySchool.set(school.id, account.stripeConnectedAccountId);
    }

    const memberships = accountBySchool.size
      ? await this.prismaJobs.membership.findMany({
          where: { schoolId: { in: [...accountBySchool.keys()] }, status: 'ACTIVE', stripeSubscriptionId: { not: null } },
          select: { id: true, schoolId: true, stripeSubscriptionId: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    let removed = 0;
    let unchanged = 0;
    let failed = 0;
    for (const membership of memberships) {
      try {
        const outcome = await this.paymentsService.removeSubscriptionSurcharge(accountBySchool.get(membership.schoolId)!, membership.stripeSubscriptionId!, removedAt);
        if (outcome === 'removed') {
          removed++;
          this.logger.log(`Card surcharge removed from Subscription ${membership.stripeSubscriptionId} (Membership ${membership.id}, School ${membership.schoolId}): country ${countryCode} came off the allow-list.`);
        } else {
          unchanged++;
        }
      } catch (err) {
        failed++;
        this.logger.error(
          `Failed to remove the card surcharge from Subscription ${membership.stripeSubscriptionId} (Membership ${membership.id}, School ${membership.schoolId}) after ${countryCode} came off the allow-list`,
          err as Error,
        );
      }
    }

    this.logger.log(
      `card-surcharge-country-removal ${countryCode}: ${memberships.length} Subscription(s) at ${accountBySchool.size} School(s) with Stripe; ${removed} removed, ${unchanged} unchanged, ${failed} failed.`,
    );
    if (failed > 0) {
      // BullMQ retries the job; the Subscriptions already done are left as they are.
      throw new Error(`card-surcharge-country-removal ${countryCode}: ${failed} Subscription(s) still carry the surcharge.`);
    }
    return { removed, unchanged, failed };
  }

  /** A removal that never finished leaves members paying a surcharge their
   * School's country no longer allows: logged loudly, as the price migration's
   * own hook does. */
  @OnWorkerEvent('failed')
  onFailed(job: Job<CardSurchargeCountryRemovalJobData> | undefined, error: Error) {
    if (!job) return;
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts?.attempts ?? 1;
    if (attemptsMade >= maxAttempts) {
      this.logger.error(
        `card-surcharge-country-removal permanently failed after ${attemptsMade} attempt(s) for ${job.data?.countryCode} — some running Subscriptions there still charge the card surcharge.`,
        error,
      );
    }
  }
}
