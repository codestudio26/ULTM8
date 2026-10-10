/**
 * Shared payload shape for the `chargeback-pattern-restriction` queue (Decision
 * 68/112) — its one producer (stripe-webhook-processing.processor.ts, on a newly
 * recorded lost dispute) and its one consumer
 * (ChargebackPatternRestrictionProcessor) both import this, same "no drifting
 * inline shapes" reasoning notification-fanout.types.ts's own header comment
 * already established for that queue.
 */
export interface ChargebackPatternRestrictionJobData {
  studentId: string;
}
