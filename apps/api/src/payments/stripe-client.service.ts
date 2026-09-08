import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';

/**
 * Thin wrapper around the official `stripe` SDK — Spec 55 §10.2 ("PaymentsModule
 * wraps the Stripe SDK"). Same "warn on missing config, don't throw at construction,
 * fail on first actual use" convention `TwilioVerifyService`/`PrismaAppService`/
 * `QueueModule`'s `redisConnection()` already established for every other
 * unconfigured external dependency in this codebase.
 *
 * `platformClient()` is ULTM8's own platform-level Stripe client — used to create
 * Connect accounts and Account Links during onboarding. Never constructed from a raw
 * tenant secret key — there is no such thing to construct one from under this custody
 * model (§4.5/§10.4).
 *
 * A tenant-scoped client (constructed with `{ stripeAccount: connectedAccountId }` —
 * the standard Express pattern, Decision 86) is NOT built here yet — removed on code
 * review from an earlier draft that added it speculatively ("establish the shape
 * early"), unused and untested, ahead of anything in this phase's own scope actually
 * needing it (no checkout exists yet — Phase 9). Shipping unverified surface area
 * doesn't save Phase 9 real work; add it there, against a real caller, when the
 * Stripe SDK/API shape can actually be verified.
 */
@Injectable()
export class StripeClientService {
  private readonly logger = new Logger(StripeClientService.name);
  private readonly client: Stripe | null;

  constructor() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      this.logger.warn('STRIPE_SECRET_KEY is not set — Stripe API calls will fail until it is.');
      this.client = null;
      return;
    }
    this.client = new Stripe(secretKey);
  }

  /** ULTM8's own platform-level client — Connect account/Account Link creation only
   * this phase. Never used to move money on a tenant's behalf; Phase 9+ builds the
   * tenant-scoped equivalent when it has a real caller to verify it against. */
  platformClient(): Stripe {
    this.assertConfigured();
    return this.client!;
  }

  /** Verifies a webhook payload's signature — throws (Stripe's own
   * `Stripe.errors.StripeSignatureVerificationError`) on an invalid/missing signature,
   * never silently accepts an unsigned/forged payload. `payload` MUST be the raw,
   * unparsed request body — signature verification fails against a re-serialized JSON
   * object, a common integration mistake this comment exists to head off. */
  constructWebhookEvent(payload: string | Buffer, signature: string): Stripe.Event {
    this.assertConfigured();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('StripeClientService is not configured for webhooks — set STRIPE_WEBHOOK_SECRET');
    }
    return this.client!.webhooks.constructEvent(payload, signature, webhookSecret);
  }

  private assertConfigured() {
    if (!this.client) {
      throw new Error('StripeClientService is not configured — set STRIPE_SECRET_KEY');
    }
  }
}
