/**
 * Shared payload shape for the `membership-plan-price-migration` queue (v1.2
 * backend backlog) — its one producer (MembershipsService.updatePlan(), on a
 * recorded MIGRATE decision) and its one consumer
 * (MembershipPlanPriceMigrationProcessor) both import this, same "no drifting
 * inline shapes" reasoning notification-fanout.types.ts's own header comment
 * already established for that queue.
 */
export interface MembershipPlanPriceMigrationJobData {
  priceChangeId: string;
}
