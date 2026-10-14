/**
 * Shared payload shapes for the `franchise-fee-rate-migration` queue (Decision 99's
 * own follow-up) — same "no drifting inline shapes" reasoning
 * membership-plan-price-migration.types.ts's own header comment already
 * established.
 *
 * Two distinct job names share this one queue:
 *
 * - `'migrate'` (FranchiseFeeRateMigrationJobData) — the main job, enqueued once by
 *   FranchisesService.update() the instant a feeRateChangeStrategy decision is
 *   recorded. Walks every School under the Franchise that already has a standing
 *   franchise-fee Subscription.
 * - `'deferred-swap'` (FranchiseFeeDeferredSwapJobData) — PER_HEADCOUNT +
 *   MIGRATE_NEXT_CYCLE only. The main job cannot swap a metered Subscription's
 *   Price immediately without re-rating the WHOLE current period (see the
 *   processor's own header comment) — so for this one combination, it instead
 *   enqueues one of these per School, delayed until just past that School's own
 *   Subscription Item's `current_period_end`, to perform the actual swap only once
 *   the current period's invoice has already been generated at the OLD rate.
 */
export interface FranchiseFeeRateMigrationJobData {
  rateChangeId: string;
}

export interface FranchiseFeeDeferredSwapJobData {
  rateChangeId: string;
  schoolId: string;
  stripeSubscriptionId: string;
  newPriceId: string;
}
