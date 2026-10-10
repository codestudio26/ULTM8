import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { randomUUID } from 'crypto';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { FranchiseFeeBillingService } from '../franchise-fees/franchise-fee-billing.service';
import { FRANCHISE_FEE_USAGE_REPORTING_QUEUE } from './queue.constants';

/** Postgres INTEGER's own ceiling — see create-franchise.dto.ts's own identical
 * constant for the full reasoning. The computed `amount` below (activeStudentCount
 * × perHeadcountRate) has no DTO layer to validate it before it's written, unlike
 * a caller-supplied value, so this job checks it directly. */
const POSTGRES_INTEGER_MAX = 2147483647;

/** Once a month, the 1st at 3am UTC — Spec 55 §9 confirms "monthly", no specific
 * day/time; a Developer-level default, same class as class-occurrence-generation's
 * own WEEKS_AHEAD/CRON_DAILY_AT_2AM_UTC, flagged for Architect review rather than
 * presented as a confirmed schedule. */
const CRON_MONTHLY_1ST_AT_3AM_UTC = '0 3 1 * *';
const REPEATABLE_JOB_ID = 'franchise-fee-usage-reporting-monthly';

/**
 * Registers the franchise-fee-usage-reporting repeatable job on module init — same
 * fixed-jobId, fire-and-forget-with-bounded-retry shape
 * ClassOccurrenceGenerationScheduler already established (Phase 5); see that
 * class's own header comment for the full "why not awaited, why retry
 * registration" account, not repeated here.
 */
@Injectable()
export class FranchiseFeeUsageReportingScheduler implements OnModuleInit {
  private readonly logger = new Logger(FranchiseFeeUsageReportingScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(FRANCHISE_FEE_USAGE_REPORTING_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...FranchiseFeeUsageReportingScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        // Explicit attempts/backoff — a deliberate deviation from the other
        // repeatable jobs in this file's own siblings (class-occurrence-
        // generation, booking-no-show-processing, waitlist-cascade-processing),
        // none of which set one: those run daily/every-few-minutes, so a
        // single failed run costs at most a short delay until the next one.
        // This job runs MONTHLY — a single unretried failure (e.g. the outer
        // findMany() in either pass throwing on a transient DB hiccup) means
        // an entire month's worth of franchise-fee usage reporting is silently
        // skipped with no other chance to catch up. Same shape as
        // waiver-signature-requests/notification-fanout's own retry policy for
        // a job where a missed run has real, non-trivial cost.
        await this.queue.add(
          'run',
          {},
          { repeat: { pattern: CRON_MONTHLY_1ST_AT_3AM_UTC }, jobId: REPEATABLE_JOB_ID, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
        );
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable franchise-fee-usage-reporting job (retrying): ${err}`);
      }
    }
    this.logger.error(
      'Failed to register the repeatable franchise-fee-usage-reporting job after all retries — ' +
        'no franchise-fee Subscriptions will be created and no Per-Headcount usage will be reported until this succeeds.',
    );
  }
}

/**
 * Consumes the franchise-fee-usage-reporting queue (Phase 16b-ii) — Spec 55 §9's
 * confirmed job. Runs via PrismaJobsService (ultm8_jobs role) — a genuine
 * cross-tenant sweep across every Franchise-affiliated School, no single caller,
 * same class as class-occurrence-generation's own justification for that role.
 *
 * Two passes in one job run, not two separate jobs, deliberately: Spec 55 names
 * exactly one confirmed job ("franchise-fee-usage-reporting... reporting each
 * School's active-student-count monthly") — inventing a second job name for the
 * "ensure the standing Subscription exists" half would be adding surface area
 * the spec doesn't ask for. Pass 1 covers BOTH feeModel values (a Flat-fee
 * Subscription needs creating exactly once too, just never needs recurring
 * per-cycle action after that — Stripe's own billing cycle handles it from
 * there); Pass 2 is Per-Headcount-only, matching the job's own confirmed name.
 *
 * Deliberately deferred (not silently dropped): the platform-enforced 30-day
 * Trial Membership expiry cap Decision 54 also confirms ("to close the resulting
 * headcount-dodge gap") is a genuinely separate MembershipsModule gap, not
 * required for THIS job's own correctness — the active-student-count query below
 * already excludes TRIAL_MEMBERSHIP entirely regardless of its expiry, so an
 * unbounded trial doesn't inflate or deflate what this job counts. Flagged for a
 * future MembershipsModule pass, not built here.
 */
@Processor(FRANCHISE_FEE_USAGE_REPORTING_QUEUE)
export class FranchiseFeeUsageReportingProcessor extends WorkerHost {
  private readonly logger = new Logger(FranchiseFeeUsageReportingProcessor.name);

  constructor(
    private readonly prismaJobs: PrismaJobsService,
    private readonly billingService: FranchiseFeeBillingService,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const subscriptionsCreated = await this.ensureSubscriptionsPass();
    const usageReported = await this.usageReportPass();
    this.logger.log(
      `franchise-fee-usage-reporting: ${subscriptionsCreated} Subscription(s) created, ${usageReported} usage report(s) sent.`,
    );
  }

  /** Pass 1 — every Franchise-affiliated School with no standing Subscription
   * yet gets one, if its Franchise is actually ready (onboarded PaymentAccount +
   * configured rate — see FranchiseFeeBillingService.ensureSubscription's own
   * comment for what "ready" means and why an unready pair is a skip, not an
   * error). Per-row try/catch, same "one bad row doesn't abort the whole sweep"
   * convention class-occurrence-generation already established for its own
   * per-slot loop. */
  private async ensureSubscriptionsPass(): Promise<number> {
    const unsubscribedSchools = await this.prismaJobs.school.findMany({
      where: { franchiseId: { not: null }, stripeFranchiseFeeSubscriptionId: null },
      include: { franchise: { include: { paymentAccount: true } } },
    });

    let created = 0;
    for (const school of unsubscribedSchools) {
      if (!school.franchise) continue; // narrows the type; the WHERE clause already guarantees this
      try {
        const subscriptionId = await this.billingService.ensureSubscription(school.franchise, school);
        if (subscriptionId) created++;
      } catch (err) {
        this.logger.error(`Failed to ensure a franchise-fee Subscription for School ${school.id} (Franchise ${school.franchise.id})`, err as Error);
      }
    }
    return created;
  }

  /** Pass 2 — every School with an active standing Subscription whose Franchise
   * is PER_HEADCOUNT gets this month's active-student-count reported to Stripe
   * as metered usage, plus a PENDING FranchiseFeeCharge row capturing the
   * snapshot (the count isn't recoverable later from Stripe's own webhook
   * payload — see FranchiseFeeCharge's own schema.prisma comment for the full
   * creation-timing account). Idempotent per (subscription, billingPeriodStart)
   * pair, in two layers: the `existing` check below is the fast path (a re-run
   * within the same month finds the row and skips before ever calling
   * Stripe), and the migration's own partial unique index is the real,
   * DB-enforced backstop against two concurrent runs racing past that check —
   * see the migration's own comment for why an app-layer check alone wasn't
   * enough (found on review). The check matches any existing row for the
   * period regardless of status (PENDING, SUCCESSFUL, or FAILED) — a period
   * that already produced a row of ANY status should never get a second one,
   * not just while it's still PENDING. */
  private async usageReportPass(): Promise<number> {
    const now = DateTime.utc();
    const periodKey = now.toFormat('yyyy-LL');
    const billingPeriodStart = now.startOf('month').toJSDate();
    const billingPeriodEnd = now.endOf('month').toJSDate();

    const activeSchools = await this.prismaJobs.school.findMany({
      where: {
        stripeFranchiseFeeSubscriptionId: { not: null },
        franchise: { feeModel: 'PER_HEADCOUNT' },
        // FOUND ON REVIEW: a first draft had no status filter at all, so a
        // School whose standing Subscription was already CANCELED
        // (handleSubscriptionDeleted, stripe-webhook-processing.processor.ts)
        // kept getting swept into this pass every month — reporting usage to
        // Stripe for a dead subscription that will never invoice again, and
        // accumulating PENDING FranchiseFeeCharge rows with no code path that
        // ever flips them (no invoice.paid will ever arrive for a cancelled
        // subscription). Excluded now — a cancelled relationship stops
        // accruing new charge attempts entirely, matching the same "cancelled
        // means cancelled" behavior every other Stripe Subscription in this
        // codebase already gets once customer.subscription.deleted fires.
        franchiseFeeSubscriptionStatus: { not: 'CANCELED' },
      },
      include: { franchise: { include: { paymentAccount: true } } },
    });

    let reported = 0;
    for (const school of activeSchools) {
      if (!school.franchise || !school.stripeFranchiseFeeSubscriptionId) continue;
      const subscriptionId = school.stripeFranchiseFeeSubscriptionId;
      try {
        const existing = await this.prismaJobs.franchiseFeeCharge.findFirst({
          where: { stripeSubscriptionId: subscriptionId, billingPeriodStart },
          select: { id: true },
        });
        if (existing) continue;

        const franchisePaymentAccountId = school.franchise.paymentAccount?.id;
        if (!franchisePaymentAccountId) {
          // Shouldn't happen — ensureSubscription already requires an onboarded
          // PaymentAccount before a Subscription can exist at all — but a
          // Franchise's PaymentAccount could in principle be reconfigured after
          // the fact; skip rather than crash the whole pass over one row.
          this.logger.warn(`School ${school.id}'s Franchise (${school.franchise.id}) has an active Subscription but no PaymentAccount — skipping usage report.`);
          continue;
        }

        const activeStudentCount = await this.countActiveStudents(school.id);
        const amount = activeStudentCount * (school.franchise.perHeadcountRate ?? 0);
        // FOUND ON REVIEW: computed BEFORE the Stripe call now, not after —
        // an earlier draft only discovered an overflow (Postgres INTEGER's
        // 2^31-1 ceiling; unlike a caller-supplied rate, this computed value
        // has no DTO layer validating it) when franchiseFeeCharge.create()
        // itself threw, by which point reportUsage() had already told Stripe
        // to bill this School with no local row to show for it. Checked here
        // instead, before reportUsage() is ever called, so an unreportable
        // amount is skipped cleanly rather than billed-then-lost.
        if (amount > POSTGRES_INTEGER_MAX) {
          this.logger.error(
            `Computed franchise-fee amount ${amount} for School ${school.id} (Franchise ${school.franchise.id}, ${activeStudentCount} active students × rate ${school.franchise.perHeadcountRate}) exceeds the storable maximum — skipping this School's usage report for ${periodKey} rather than billing Stripe for an amount this platform cannot record.`,
          );
          continue;
        }

        await this.billingService.reportUsage(school.franchise, subscriptionId, activeStudentCount, periodKey);

        try {
          await this.prismaJobs.franchiseFeeCharge.create({
            data: {
              id: randomUUID(),
              franchiseId: school.franchise.id,
              schoolId: school.id,
              franchisePaymentAccountId,
              billingPeriodStart,
              billingPeriodEnd,
              feeBasisSnapshot: 'PER_HEADCOUNT',
              amount,
              currency: 'USD',
              activeStudentCountSnapshot: activeStudentCount,
              status: 'PENDING',
              stripeSubscriptionId: subscriptionId,
            },
          });
        } catch (err) {
          // P2002 against the partial unique index (migration.sql) — a
          // concurrent run for this exact (subscription, billingPeriodStart)
          // pair already won the race between our own `existing` check above
          // and this create(). Usage was already reported to Stripe twice in
          // that race (Stripe's own per-identifier dedup absorbs it, see
          // reportUsage's own comment), but only one PENDING row should ever
          // exist — the loser here is a benign idempotent no-op, not an error.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            this.logger.log(`FranchiseFeeCharge for subscription ${subscriptionId} / period ${periodKey} already recorded by a concurrent run — skipping.`);
          } else {
            throw err;
          }
        }
        reported++;
      } catch (err) {
        this.logger.error(`Failed to report franchise-fee usage for School ${school.id} (Franchise ${school.franchise.id})`, err as Error);
      }
    }
    return reported;
  }

  /** "active means holding at least one Membership there with status=Active and
   * type in Subscription/Class Pack/Weekly Pass; Friend Pass and Trial
   * Membership excluded" (Spec 55 §10.2, Decision 54, quoted directly) — `type`
   * lives on the related MembershipPlan, not on Membership itself (checked
   * directly against schema.prisma before writing this, not assumed by
   * analogy to `status`), hence the nested filter rather than a flat one.
   * `distinct: ['studentId']` counts each Student once even if they hold more
   * than one qualifying Membership at this School. */
  private async countActiveStudents(schoolId: string): Promise<number> {
    const rows = await this.prismaJobs.membership.findMany({
      where: { schoolId, status: 'ACTIVE', membershipPlan: { type: { in: ['SUBSCRIPTION', 'CLASS_PACK', 'WEEKLY_PASS'] } } },
      distinct: ['studentId'],
      select: { studentId: true },
    });
    return rows.length;
  }
}
