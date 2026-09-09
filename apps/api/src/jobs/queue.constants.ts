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
