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
 * the standard Express pattern, Decision 86) was deliberately NOT built in Phase 8 —
 * removed on that phase's own code review from an earlier draft that added it
 * speculatively ("establish the shape early"), unused and untested, ahead of
 * anything in that phase's own scope actually needing it (no checkout existed yet).
 * Phase 9's Membership purchase flow is the real caller that method was waiting
 * for — see `scopedClient()` below, added and verified against the installed SDK's
 * own type definitions this phase, not the earlier speculative draft.
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

  /**
   * Tenant-scoped client for moving money on a School's behalf — the real caller
   * this class's own Phase 8 header comment said to wait for before adding this
   * ("add it there, against a real caller, when the Stripe SDK/API shape can
   * actually be verified"). Phase 9's Membership purchase flow is that caller.
   *
   * Constructed with `{ stripeAccount: connectedAccountId }` — the Stripe Connect
   * Direct-charge pattern (Decision 86, Express accounts). Confirmed directly against
   * Spec 55 §10.2: "the charge is a Stripe Direct/Destination charge against the
   * [payer]'s saved payment method that settles directly into the [School]'s own
   * connected PaymentAccount... the same Direct/Destination-charge pattern Membership
   * billing already uses for Student→School." Every PaymentIntent/Subscription
   * created against the returned client is created ON the connected account
   * (verified against the installed SDK's own type definitions —
   * node_modules/stripe/cjs/lib.d.ts confirms `stripeAccount` as a real top-level
   * constructor option, "An account id on whose behalf you wish to make every
   * request" — not assumed from memory) — the platform's own API key stays the one
   * making the call, but Stripe attributes the resulting charge/subscription to the
   * connected account, not the platform account. The same type definition flags a
   * newer `stripeContext` option as the SDK's forward-looking replacement
   * ("currently identical, but we will eventually discourage and (later) drop
   * support for stripeAccount") — not switched to here since nothing else in this
   * codebase uses it yet either; worth revisiting if/when the SDK actually starts
   * warning on `stripeAccount`, not preemptively.
   *
   * A fresh Stripe instance per call, not cached — same reasoning `platformClient()`
   * doesn't need to worry about (one fixed platform key) but this one does: a
   * different `connectedAccountId` on every call means a different scoped client
   * every time, and Stripe's own SDK docs treat constructing a new client per
   * request as the normal, supported usage (no meaningful connection-pooling cost
   * to amortize the way a raw DB client has).
   */
  scopedClient(connectedAccountId: string): Stripe {
    this.assertConfigured();
    return new Stripe(process.env.STRIPE_SECRET_KEY!, { stripeAccount: connectedAccountId });
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
