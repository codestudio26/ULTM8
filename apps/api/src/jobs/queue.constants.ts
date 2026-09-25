/**
 * Queue name constants, split out from queue.module.ts deliberately — importing a
 * NestJS `@Module`-decorated file just to grab a string constant runs that decorator's
 * config object (including `BullModule.forRoot`'s Redis connection setup) as an
 * import-time side effect, which is what was happening when TwilioVerifyService only
 * wanted these two names.
 */
export const OTP_DELIVERY_QUEUE = 'otp-delivery';
export const CLASS_OCCURRENCE_GENERATION_QUEUE = 'class-occurrence-generation';
export const STRIPE_WEBHOOK_PROCESSING_QUEUE = 'stripe-webhook-processing';
export const WAIVER_SIGNATURE_REQUESTS_QUEUE = 'waiver-signature-requests';
export const BOOKING_NO_SHOW_PROCESSING_QUEUE = 'booking-no-show-processing';
export const WAITLIST_CASCADE_PROCESSING_QUEUE = 'waitlist-cascade-processing';
// Phase 15 — Spec 55 §9's confirmed job: every other job's own "Notification
// samples" text feeds this one queue ("Triggered by: Any of the above, plus
// manual school messages").
export const NOTIFICATION_FANOUT_QUEUE = 'notification-fanout';
// Phase 16b-ii — Spec 55 §9/§10.2's confirmed job name, quoted directly:
// "franchise-fee-usage-reporting job... reporting each School's
// active-student-count monthly." Also owns the (Flat-fee-only) "ensure the
// standing Subscription exists" pass — see the processor's own comment for why
// one job covers both rather than splitting them.
export const FRANCHISE_FEE_USAGE_REPORTING_QUEUE = 'franchise-fee-usage-reporting';
// Phase 56 — Decision 110's own 90-day scheduled purge, the second half of the
// close-account/purge lifecycle TenantLifecycleService starts.
export const TENANT_LIFECYCLE_PURGE_QUEUE = 'tenant-lifecycle-purge';
// Decision 68/112 — the confirmed job name, quoted directly from
// skills/ultm8-domain-rules/SKILL.md §9: "A platform-wide
// `chargeback-pattern-restriction` background job counts a Student's lost
// Stripe disputes... across every School the Student holds a RoleGrant at."
// Event-triggered (enqueued by stripe-webhook-processing on a newly-lost
// dispute), not a periodic sweep — see Decision 112's own reasoning.
export const CHARGEBACK_PATTERN_RESTRICTION_QUEUE = 'chargeback-pattern-restriction';
