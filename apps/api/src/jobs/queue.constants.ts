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
// Closes the gap Decision 122's own "What this does NOT resolve" note flagged:
// a Membership that EXPIRES only via its own expiryDate passing (no Stripe
// event involved — a Class Pack/Trial/Weekly Pass simply running out) never
// had its Student's own future Bookings swept the way the Stripe-driven
// force-Expiry paths already are. Does NOT persist Membership.status —
// Decision 26 confirms that stays live-computed-only; see
// membership-expiry-sweep.processor.ts's own header comment for the full
// account (including a real bug this caught before merge).
export const MEMBERSHIP_EXPIRY_SWEEP_QUEUE = 'membership-expiry-sweep';
// v1.2 backend backlog — Subscription price-change migrate-vs-grandfather
// prompt. Event-triggered only (enqueued by MembershipsService.updatePlan()
// the instant a staff member records a MIGRATE decision), same shape
// CHARGEBACK_PATTERN_RESTRICTION_QUEUE already establishes for "react to one
// event, no Scheduler needed" — see that queue's own comment. Runs the bulk
// per-Membership Stripe Subscription-update work as a background job rather
// than blocking the edit's own HTTP request, matching
// franchise-fee-usage-reporting.processor.ts's own established "a
// potentially-large per-row Stripe loop belongs in a job, not inline in a
// service method" precedent.
export const MEMBERSHIP_PLAN_PRICE_MIGRATION_QUEUE = 'membership-plan-price-migration';
// Decisions 145, 178 — grading notifications: "ready to grade" to the owner and
// the coaches who may grade the student (checked after grading actions and in a
// daily sweep), and "you've been promoted" to the student, or a minor's
// guardians. Runs as ultm8_jobs: GuardianLink is readable only by the guardian
// under ultm8_app's RLS.
export const GRADING_NOTIFICATIONS_QUEUE = 'grading-notifications';
// v1.2 backend backlog ("Notifications page" — Snooze, approved by the
// product owner): a scheduled sweep clearing Notification.snoozedUntil once
// it elapses, returning the Notification to the ordinary unread list — same
// shape as booking-no-show-processing's own scheduled sweep.
export const NOTIFICATION_UNSNOOZE_SWEEP_QUEUE = 'notification-unsnooze-sweep';
// Decision 226 — the second half of the entity-level tenant-offboarding
// lifecycle (Branch/Class/TimetableSlot/Instructor/Rank/Waiver/Lesson archive/
// unarchive, this phase's own service methods start the countdown). Same
// shape as TENANT_LIFECYCLE_PURGE_QUEUE's own daily sweep (Decision 110),
// scoped to these 7 entities instead of School/Franchise. Waiver is
// deliberately swept but never purged — see the processor's own header
// comment.
export const ENTITY_OFFBOARDING_PURGE_QUEUE = 'entity-offboarding-purge';
// Decision 227/254 — Curriculum learner-facing redesign's actual video-
// upload/captioning-pipeline wiring (Decision 101's picked vendors, left
// unbuilt by Phase 44). Polls CloudflareStreamService/TranscribeService to
// completion for every Lesson whose captionStatus is PROCESSING — see
// video-processing-poll.processor.ts's own header comment for the full
// state-machine account (a genuinely new, un-precedented async-external-API-
// poll shape in this codebase, not an established convention).
export const VIDEO_PROCESSING_POLL_QUEUE = 'video-processing-poll';
// Decision 99's own follow-up — the real rate-migration mechanism FranchisesService.
// update() used to reject outright once franchise-fee billing had started for at
// least one School. Event-triggered only (enqueued the instant a Franchise Owner
// records a feeRateChangeStrategy decision), same shape
// MEMBERSHIP_PLAN_PRICE_MIGRATION_QUEUE already establishes for "react to one
// event, no Scheduler needed" — see franchise-fee-rate-migration.processor.ts's own
// header comment for why, unlike that queue's GRANDFATHER case, BOTH strategies
// here always enqueue real work.
export const FRANCHISE_FEE_RATE_MIGRATION_QUEUE = 'franchise-fee-rate-migration';

/** Decision 354 — daily: waiver renewals, the sign-again-at-18 rule and repeat reminders. */
export const WAIVER_RENEWAL_SWEEP_QUEUE = 'waiver-renewal-sweep';
