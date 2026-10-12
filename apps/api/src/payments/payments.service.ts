import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { FranchisesService } from '../tenants/franchises/franchises.service';
import { StripeClientService } from './stripe-client.service';
import { CreatePaymentAccountDto } from './dto/create-payment-account.dto';
import { STRIPE_WEBHOOK_PROCESSING_QUEUE } from '../jobs/queue.constants';

/** Thrown by PaymentsService.chargeOffSession() when the Student has no saved
 * payment method (or their Customer has no default one set) at this School —
 * a real precondition failure, distinct from a Stripe-side decline/error.
 * Exported so BookingsService.cancelBooking() can check it via `instanceof`,
 * the same shape MembershipCollisionError (stripe-webhook-processing.processor.ts)
 * already established for a signal-not-a-generic-failure error in this codebase. */
export class NoSavedPaymentMethodError extends Error {}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    private readonly franchisesService: FranchisesService,
    private readonly stripeClient: StripeClientService,
    @InjectQueue(STRIPE_WEBHOOK_PROCESSING_QUEUE) private readonly webhookQueue: Queue,
  ) {}

  // ---------------------------------------------------------------------------
  // School-side PaymentAccount CRUD — fully reachable this phase.
  // ---------------------------------------------------------------------------

  /** School Owner/Manager only (Spec §8.2) — same gate as every other write. */
  async createForSchool(callerId: string, schoolId: string, dto: CreatePaymentAccountDto) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);

    // "has one PaymentAccount set" (School's own confirmed entity row) — pre-checked
    // explicitly (same convention InstructorsService.create()/RoleGrantsService.create()
    // use) rather than relying on the generic P2002 catch-all, so the caller gets a
    // specific message.
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.paymentAccount.findUnique({ where: { schoolId }, select: { id: true } }),
    );
    if (existing) {
      throw new ConflictException('This School already has a PaymentAccount.');
    }

    const id = randomUUID();
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.paymentAccount.create({
        data: {
          id,
          schoolId,
          provider: dto.provider,
          accountTitle: dto.accountTitle,
          country: dto.country,
        },
      }),
    );
  }

  /**
   * Singular resource, not a paginated list — a School has at most one
   * PaymentAccount ("has one PaymentAccount set"), so a cursor-paginated
   * items/nextCursor envelope would be misleading complexity for something that can
   * only ever hold 0 or 1 result. Deliberately deviates from the Phase 8 kickoff
   * prompt's own "GET .../payment-accounts" (list-shaped) suggestion — caught during
   * implementation, same as prior phases' own build-time corrections — matches the
   * singular-resource shape /users/me already established instead.
   *
   * **Read visibility, flagged for Architect review**: no `assertSchoolOwner` call
   * here — matches this codebase's established "RLS admits any role, only writes are
   * owner-gated" convention (every other module's own `findOne`/`findForSchool`-style
   * read does the same). `PaymentAccount` is the first RLS-readable table exposing a
   * live `stripeConnectedAccountId`, though — whether that field's sensitivity
   * actually warrants Owner-only reads (an asymmetric deviation from every other
   * module) is a genuine open question this phase deliberately did NOT decide
   * unilaterally either way, rather than silently narrowing (or silently not
   * narrowing) a business rule Spec 55 doesn't itself state. Confirmed step-up MFA
   * (§11.5) gates payout/bank-detail *changes*, not reads — this code follows that
   * literally, not by extension.
   */
  async findForSchool(callerId: string, schoolId: string) {
    await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.paymentAccount.findUnique({ where: { schoolId } }),
    );
    // RLS returns null (not another tenant's row) for a PaymentAccount outside the
    // caller's scope — a genuine "none exists yet" and a cross-tenant-blocked read
    // are indistinguishable at this layer by design (ultm8-tenant-isolation §2) —
    // and also indistinguishable from each other here, which is fine: both cases mean
    // "there's nothing for this School to show the caller."
    if (!found) {
      throw new NotFoundException('PaymentAccount not found');
    }
    return found;
  }

  // ---------------------------------------------------------------------------
  // Franchise-side PaymentAccount CRUD — now fully reachable via FranchisesService
  // (Phase 16) and self-service FRANCHISE_OWNER grantability (FranchisesService.
  // create()). Previously schema-correct but practically unreachable (Phase 8) —
  // exercised only via direct-seed e2e fixtures until now.
  // ---------------------------------------------------------------------------

  async createForFranchise(callerId: string, franchiseId: string, dto: CreatePaymentAccountDto) {
    // Phase 8 flagged this itself, not silently: this method had no way to
    // distinguish "Franchise doesn't exist" from "you're not its Owner" —
    // assertFranchiseOwner alone can only ever 403, since a RoleGrant can never
    // match a nonexistent franchiseId. FranchisesService.findOne() now exists
    // (Phase 16) and is called first, so a nonexistent franchiseId 404s before
    // assertFranchiseOwner is ever reached.
    //
    // FOUND ON REVIEW: an earlier version of this comment claimed this "mirrors
    // createForSchool's own schoolsService.findOne() call exactly" — checked
    // directly and that overstates it. School's school_tenant_isolation RLS admits
    // ANY role at that School (Student, Instructor, Staff, Owner alike), so
    // schoolsService.findOne() succeeding does NOT imply Owner there — createForSchool
    // genuinely needs both findOne() (existence) and assertSchoolOwner() (the
    // narrower role gate) as two independently meaningful checks. Franchise's RLS is
    // already Owner-only (FRANCHISE_OWNER is the only Role value ever scoped to
    // franchiseId — franchises.service.ts's own findOne()/findAllForCaller() comments),
    // so franchisesService.findOne() succeeding already proves Owner here; the
    // assertFranchiseOwner() call below is mathematically redundant with it today. Kept
    // anyway, deliberately, as the explicit business-layer check TenantAuthorizationService's
    // own header comment argues for (RLS + an explicit layer on top, not RLS alone) —
    // this is money/Stripe-adjacent (PaymentAccount creation), a low-frequency write,
    // and the redundancy is one extra round-trip, not a correctness cost; removing it
    // would make this method's safety depend entirely on Franchise's RLS shape never
    // changing (e.g. a future franchiseId-scoped role) without anything else re-checking
    // that assumption. `findSchoolsForFranchise()` (franchises.service.ts) made the
    // opposite call for a different reason — see that method's own comment for why the
    // redundant check there was replaced with a genuine second layer instead of just
    // dropped.
    await this.franchisesService.findOne(callerId, franchiseId); // 404s if not visible/doesn't exist
    await this.tenantAuth.assertFranchiseOwner(callerId, franchiseId);

    const existing = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.paymentAccount.findUnique({ where: { franchiseId }, select: { id: true } }),
    );
    if (existing) {
      throw new ConflictException('This Franchise already has a PaymentAccount.');
    }

    const id = randomUUID();
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.paymentAccount.create({
        data: {
          id,
          franchiseId,
          provider: dto.provider,
          accountTitle: dto.accountTitle,
          country: dto.country,
        },
      }),
    );
  }

  /**
   * **Corrected on code review** — an earlier draft of this method had no
   * `assertFranchiseOwner` call at all, which the diff's own e2e test caught as a
   * mismatch (the test expected 403 for a caller with zero grants on this Franchise;
   * RLS-only visibility actually produces 404, matching `findForSchool`'s own
   * documented "RLS-blocked and genuine-404 are indistinguishable" convention). On
   * review, kept consistent with `findForSchool` (RLS-only reads, no owner-narrowing)
   * rather than silently choosing the opposite — see `findForSchool`'s own comment
   * for the full "should PaymentAccount reads be Owner-only" open question, flagged
   * for Architect review rather than decided here. The e2e test was corrected to
   * match this, not the other way around.
   *
   * FOUND ON REVIEW (Phase 16): a draft of this method briefly added a
   * `franchisesService.findOne()` call here too, by analogy with `createForFranchise`
   * above — but this method never had the gap that call would close. Unlike
   * `createForFranchise` (a write with no prior lookup to piggyback a 404 off of),
   * this method's own `payment_account_tenant_isolation` RLS policy (Phase 8) already
   * has its own `franchiseId`-scoped `EXISTS` clause independent of Franchise's own
   * RLS — `tx.paymentAccount.findUnique({ where: { franchiseId } })` below already
   * correctly returns null (→ 404) for a caller with zero grant on that Franchise,
   * with or without a separate Franchise-existence check. Adding one would have been
   * a pure extra DB round-trip for identical observable behavior — removed.
   */
  async findForFranchise(callerId: string, franchiseId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.paymentAccount.findUnique({ where: { franchiseId } }),
    );
    if (!found) {
      throw new NotFoundException('PaymentAccount not found');
    }
    return found;
  }

  // ---------------------------------------------------------------------------
  // Stripe Connect Express onboarding (Decision 86).
  // ---------------------------------------------------------------------------

  /**
   * `stripeConnectedAccountId` is set HERE, synchronously, not by a webhook handler
   * — corrected from an earlier draft of the Phase 8 kickoff prompt, which assumed
   * the id itself arrived via `account.updated`. Checked directly against Stripe's
   * own API shape before writing this: `stripe.accounts.create()` returns the new
   * Connected Account's `id` synchronously in its response, no webhook needed for
   * that specific value — a webhook only becomes necessary for tracking whether
   * onboarding has actually *completed* (`details_submitted`/`charges_enabled` on
   * `account.updated`), and there's no confirmed field yet to write that outcome
   * into beyond the id itself, so that half stays a logged TODO in
   * stripe-webhook-processing.processor.ts (JobsModule) rather than built against a
   * guess at what field it should update.
   *
   * Any `Stripe.errors.*` this method's own calls raise (e.g. an unsupported/typo'd
   * `country`) propagates to `HttpExceptionFilter`'s own Stripe-error mapping — no
   * local try/catch needed here, same centralized handling every future Stripe SDK
   * call in this codebase gets for free (see that filter's own comment for why this
   * moved there instead of being a one-off catch per call site — code review caught
   * an earlier draft that only handled the webhook-signature case this way).
   */
  async initiateConnectOnboarding(callerId: string, paymentAccountId: string) {
    const account = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.paymentAccount.findUnique({ where: { id: paymentAccountId } }),
    );
    if (!account) {
      throw new NotFoundException('PaymentAccount not found');
    }
    if (account.schoolId) {
      await this.tenantAuth.assertSchoolOwner(callerId, account.schoolId);
    } else if (account.franchiseId) {
      await this.tenantAuth.assertFranchiseOwner(callerId, account.franchiseId);
    } else {
      // Unreachable in practice — every row has exactly one owner, enforced at
      // creation (createForSchool/createForFranchise each set exactly one FK) — but
      // checked explicitly rather than assumed, same defensive convention every
      // other service's findOne uses.
      throw new BadRequestException('PaymentAccount has no owner');
    }
    if (account.provider !== 'STRIPE') {
      throw new BadRequestException('Only a STRIPE-provider PaymentAccount can onboard through Stripe Connect');
    }

    const returnUrl = process.env.STRIPE_CONNECT_RETURN_URL;
    const refreshUrl = process.env.STRIPE_CONNECT_REFRESH_URL;
    if (!returnUrl || !refreshUrl) {
      throw new Error('STRIPE_CONNECT_RETURN_URL / STRIPE_CONNECT_REFRESH_URL are not set');
    }

    const stripe = this.stripeClient.platformClient();

    let stripeAccountId = account.stripeConnectedAccountId;
    if (!stripeAccountId) {
      // Decision 86 — Express, not Standard.
      const created = await stripe.accounts.create({ type: 'express', country: account.country });
      stripeAccountId = created.id;
      try {
        await this.prismaApp.withTenantContext(callerId, (tx) =>
          tx.paymentAccount.update({
            where: { id: paymentAccountId },
            data: { stripeConnectedAccountId: stripeAccountId },
          }),
        );
      } catch (dbError) {
        // Caught on code review: Stripe account creation and the DB persist below
        // aren't one atomic operation — if Stripe succeeds but this write fails
        // (a transient DB hiccup), the new Connected Account id was otherwise lost
        // entirely (never persisted, no cleanup), and a caller's retry would create
        // a SECOND orphaned Stripe account on top of the first, since
        // stripeAccountId would still read as unset. Best-effort compensating
        // delete of the just-created Stripe account, so a retry doesn't compound
        // the orphan rather than just leaving one behind — deliberately not a full
        // saga/outbox pattern (out of scope for this phase's stakes), but silently
        // leaking Stripe accounts is not an acceptable middle ground.
        try {
          await stripe.accounts.del(stripeAccountId);
        } catch (cleanupError) {
          this.logger.error(
            `Stripe Connect account ${stripeAccountId} was created but the DB write recording it on PaymentAccount ${paymentAccountId} failed, AND the compensating Stripe account deletion also failed — this account is now orphaned at Stripe with nothing in ULTM8 pointing back to it. Manual cleanup needed.`,
            cleanupError instanceof Error ? cleanupError.stack : String(cleanupError),
          );
          throw dbError;
        }
        throw dbError;
      }
    }
    // Already onboarded once, no fresh Account Link needed to *start* — but Stripe's
    // own Account Links are short-lived/single-use, so re-requesting one against an
    // existing Connected Account (to resume/finish onboarding) is the normal,
    // supported flow, not an error case — no branch needed here beyond the
    // `!stripeAccountId` check above.

    const link = await stripe.accountLinks.create({
      account: stripeAccountId,
      return_url: returnUrl,
      refresh_url: refreshUrl,
      type: 'account_onboarding',
    });
    return { onboardingUrl: link.url };
  }

  // ---------------------------------------------------------------------------
  // Webhook receiving (Spec 55 §10.2's confirmed flow) — signature verification and
  // enqueueing only. The dedup+processing half lives in
  // stripe-webhook-processing.processor.ts (JobsModule), matching §10.2's own text:
  // "pushes events onto the stripe-webhook-processing BullMQ queue for idempotent,
  // asynchronous handling" — the receiving endpoint stays fast, the (slower) dedup
  // check happens downstream in the worker, not here.
  // ---------------------------------------------------------------------------

  /**
   * An invalid/missing signature throws `Stripe.errors.StripeSignatureVerificationError`
   * from `constructWebhookEvent` — propagates straight to `HttpExceptionFilter`'s own
   * Stripe-error mapping (400), no local try/catch needed. An earlier draft of this
   * method caught it locally instead; centralized on code review once a second Stripe
   * call site (`initiateConnectOnboarding`) needed the identical translation and a
   * copy-pasted try/catch stopped being the right shape for a pattern with more than
   * one caller.
   */
  async handleIncomingWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const event = this.stripeClient.constructWebhookEvent(rawBody, signature);
    // objectId — Phase 9 addition, found necessary while wiring the first real
    // handler: Phase 8's original job payload carried only the outer Event's own id
    // (evt_...) and type, never the actual Stripe object the event concerns (the
    // PaymentIntent/Subscription/etc. itself). A handler that needs to find "which
    // Transaction did this payment_intent.succeeded settle" has nothing to look up
    // by without this. `event.data.object.id` is the correlating id uniformly across
    // every event type this processor handles (a PaymentIntent event's object IS the
    // PaymentIntent, a Subscription event's object IS the Subscription) — no need to
    // thread the full event payload through the queue for what this phase's handlers
    // actually use.
    const object = event.data.object as { id: string };
    // stripeAccountId — Phase 16b-ii addition, found necessary while wiring the
    // first handler that needs to call BACK into Stripe rather than just match
    // an id against a stored correlator column: invoice.paid/invoice.payment_failed
    // (stripe-webhook-processing.processor.ts's own new handlers) need the full
    // Invoice object (period/amount/subscription), which the queue payload
    // never carries (same reasoning objectId's own comment above already
    // established — don't thread the whole event through the queue for what
    // isn't needed), so they must re-fetch it — and that re-fetch has to be
    // scoped to the correct CONNECTED account (every Franchise-fee invoice
    // lives on the Franchise's own account, Decision 86), not the platform
    // account. `event.account` is Stripe's own Connect field for exactly this —
    // verified directly against the installed SDK's own Events.d.ts
    // (`account?: string`), not assumed. Optional/unused by every handler that
    // only matches ids (payment_intent.*, customer.subscription.deleted).
    await this.webhookQueue.add(
      'process',
      { stripeEventId: event.id, eventType: event.type, objectId: object.id, stripeAccountId: event.account ?? undefined },
      // Kept on the default 3-attempts/exponential-backoff policy every other job in
      // this codebase gets (Decision 23) — deliberately, not by omission. Decision
      // 23's own "except stripe-webhook-processing" carve-out reads (on this review)
      // as being about the underlying PAYMENT retry (don't build a custom BullMQ
      // retry-the-charge job — Stripe's own Subscription dunning schedule already
      // handles that), not about this job's own infrastructure-level retry for a
      // transient failure while processing an already-received event. Since this
      // endpoint returns 200 to Stripe as soon as the event is enqueued (Stripe's
      // own redelivery never fires for a downstream processing failure after that),
      // dropping this job's own retry entirely would risk silently losing an event
      // to a one-off DB hiccup with no other safety net catching it. Flagged as a
      // genuine ambiguity in the spec's own wording, not a confident reading —
      // Architect review welcome, but "keep the safer default" is the right call
      // while it's unresolved, not silence in either direction.
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );
  }

  // ---------------------------------------------------------------------------
  // Stripe payment primitives (Phase 9) — pure Stripe-API wrappers, no
  // Transaction/Membership writes of their own. MembershipsService owns the DB
  // writes (Transaction row at purchase time, Membership row once the webhook
  // confirms settlement) and calls these two for the actual Stripe API calls, same
  // "PaymentsModule wraps the Stripe SDK" split Spec 55 §10.2 states directly.
  // Both use the tenant-scoped client (scopedClient) — a Direct charge against the
  // School's own connected account (Decision 86), never the platform client.
  // ---------------------------------------------------------------------------

  /**
   * One-time PaymentIntent for a Class Pack / Weekly Pass / Trial Membership
   * purchase. No pre-existing Stripe Customer or saved payment method required —
   * `automatic_payment_methods` lets the frontend collect card details fresh via
   * Stripe.js against the returned `clientSecret` (the same minimal flow GET
   * /payments/methods being out of scope this phase already implies — see the Phase
   * 9 kickoff prompt §3).
   */
  async charge(
    callerId: string,
    schoolId: string,
    amount: number,
    currency: string,
    description: string,
  ): Promise<{ paymentIntentId: string; clientSecret: string }> {
    const account = await this.resolveStripePaymentAccount(callerId, schoolId);
    const stripe = this.stripeClient.scopedClient(account.stripeConnectedAccountId!);
    const intent = await stripe.paymentIntents.create({
      amount,
      currency,
      description,
      automatic_payment_methods: { enabled: true },
    });
    return { paymentIntentId: intent.id, clientSecret: intent.client_secret! };
  }

  /**
   * Stripe Subscription for a SUBSCRIPTION-type MembershipPlan. Billing interval is
   * hardcoded to monthly — Spec 55 never confirms a MembershipPlan-level interval
   * field (the "£30.00 Per Month" example belongs to the unrelated platform
   * SubscriptionPlan, domain-rules §15), and no interval column exists on
   * MembershipPlan. Flagged as a Developer-level inferred default, same class as
   * MembershipPlan.expiryDurationDays — needs an explicit Decision entry before
   * treated as settled, not silently shipped as fact.
   *
   * Uses inline `price_data` rather than a pre-created, persisted Stripe Price —
   * avoids needing a `stripePriceId` column that would have to stay in sync with
   * MembershipPlan.price/currency on every edit. Verified directly against the
   * installed SDK's own type definitions (Subscriptions.d.ts) before writing this:
   * a Subscription item's `price_data` requires a real `product` id — unlike a
   * one-time PaymentIntent/Checkout Price, it does NOT accept inline `product_data`
   * (an earlier draft of this method assumed it did and failed `tsc`) — so a
   * throwaway Product is created alongside the throwaway Customer below, same
   * simplification, same reasoning.
   *
   * Creates a throwaway Stripe Customer AND Product per subscription rather than
   * persisted, reusable ids — a real, deliberate simplification, not an oversight:
   * a full Customer/Product-lifecycle model (create-once, reuse across future
   * purchases) is real payments infrastructure this phase's own scope doesn't cover
   * (no `GET /payments/methods`, no saved-card reuse anywhere yet — see the Phase 9
   * kickoff prompt §3). Known limitation: a Student who subscribes more than once
   * (a second School, or resubscribing after cancellation) gets a new Stripe
   * Customer object each time, and each MembershipPlan.title change creates a new
   * Product on its next subscription rather than updating one persisted Product.
   * Flagged, not hidden.
   */
  async subscribe(
    callerId: string,
    schoolId: string,
    studentEmail: string,
    amount: number,
    currency: string,
    productName: string,
  ): Promise<{ subscriptionId: string; paymentIntentId: string; clientSecret: string }> {
    const account = await this.resolveStripePaymentAccount(callerId, schoolId);
    const stripe = this.stripeClient.scopedClient(account.stripeConnectedAccountId!);
    const customer = await stripe.customers.create({ email: studentEmail });
    const product = await stripe.products.create({ name: productName });
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [
        {
          price_data: {
            currency,
            unit_amount: amount,
            recurring: { interval: 'month' },
            product: product.id,
          },
        },
      ],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
    });
    const invoice = subscription.latest_invoice as { payment_intent?: { id: string; client_secret: string } };
    const paymentIntent = invoice?.payment_intent;
    if (!paymentIntent) {
      throw new Error('Stripe Subscription did not return an expandable latest_invoice.payment_intent');
    }
    return { subscriptionId: subscription.id, paymentIntentId: paymentIntent.id, clientSecret: paymentIntent.client_secret };
  }

  // ---------------------------------------------------------------------------
  // Saved payment methods (Decision 234's own dependency — see
  // StudentPaymentMethod's schema.prisma comment for why this didn't exist before
  // this phase). A Stripe Checkout Session in `mode: 'setup'` — hosted, not an
  // embedded Stripe Elements form — is the collection mechanism: `apps/student`
  // has no Stripe SDK dependency at all today, and this app is Expo-managed
  // (Decision 113) with no custom native dev client, so a native card-element
  // integration isn't buildable/verifiable in this phase either. The hosted
  // Checkout URL is opened in the device's own browser (`expo-web-browser`,
  // `WebBrowser.openAuthSessionAsync`, which auto-returns to the app via its
  // registered `ultm8-student://` scheme on redirect) — zero native linking,
  // same reasoning that already ruled out an embedded SDK. Confirmation is via
  // the `checkout.session.completed` webhook (StripeWebhookProcessingProcessor),
  // the same "never trust a client-side success callback alone" discipline every
  // other Stripe confirmation in this codebase already follows.
  // ---------------------------------------------------------------------------

  /**
   * POST /schools/:schoolId/payment-methods/setup-session — any caller with a
   * RoleGrant at this School (resolveStripePaymentAccount's own existing scope;
   * narrower than that isn't needed — a Student setting up their OWN card is the
   * only real caller, and `customer`/`metadata.studentId` below are always the
   * CALLER's own id, never attacker-controlled). Reuses the existing Customer if
   * this Student already has one for this School (re-running this flow UPDATES
   * the saved card, never creates a second Customer) — read under the caller's
   * own tenant context, same self-only RLS StudentPaymentMethod's migration
   * establishes.
   */
  async createSetupSession(callerId: string, schoolId: string): Promise<{ checkoutUrl: string }> {
    const account = await this.resolveStripePaymentAccount(callerId, schoolId);
    const stripe = this.stripeClient.scopedClient(account.stripeConnectedAccountId!);
    const existing = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.studentPaymentMethod.findUnique({ where: { studentId_schoolId: { studentId: callerId, schoolId } } }),
    );
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: existing?.stripeCustomerId,
      success_url: 'ultm8-student://payment-methods/complete',
      cancel_url: 'ultm8-student://payment-methods/cancel',
      // Read back by StripeWebhookProcessingProcessor's checkout.session.completed
      // handler — the Session itself carries these, no separate lookup needed.
      metadata: { studentId: callerId, schoolId },
    });
    if (!session.url) {
      throw new Error('Stripe Checkout Session did not return a hosted URL.');
    }
    return { checkoutUrl: session.url };
  }

  /**
   * GET /schools/:schoolId/payment-methods/me — self-only (StudentPaymentMethod's
   * own RLS already enforces this; no separate assert needed). Card brand/last4
   * are fetched live from Stripe for display, never persisted locally — see
   * StudentPaymentMethod's own schema.prisma comment for why.
   */
  async getMyPaymentMethod(
    callerId: string,
    schoolId: string,
  ): Promise<{ hasSavedPaymentMethod: boolean; brand?: string; last4?: string }> {
    const saved = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.studentPaymentMethod.findUnique({ where: { studentId_schoolId: { studentId: callerId, schoolId } } }),
    );
    if (!saved) {
      return { hasSavedPaymentMethod: false };
    }
    const account = await this.resolveStripePaymentAccount(callerId, schoolId);
    const stripe = this.stripeClient.scopedClient(account.stripeConnectedAccountId!);
    const customer = await stripe.customers.retrieve(saved.stripeCustomerId, {
      expand: ['invoice_settings.default_payment_method'],
    });
    const pm = (customer as { invoice_settings?: { default_payment_method?: { card?: { brand: string; last4: string } } } })
      .invoice_settings?.default_payment_method;
    return { hasSavedPaymentMethod: true, brand: pm?.card?.brand, last4: pm?.card?.last4 };
  }

  /**
   * DELETE /schools/:schoolId/payment-methods/me — self-only. Detaches the
   * payment method at Stripe best-effort (logged, never blocking — same
   * "the local row is the authoritative 'do we still charge this Student' state"
   * reasoning SchoolsService.leaveFranchise's own best-effort Stripe cancel
   * already established) and always deletes the local row: once a Student asks
   * to remove their card, this codebase must stop treating them as chargeable
   * even if the Stripe-side cleanup call itself fails.
   */
  async deleteMyPaymentMethod(callerId: string, schoolId: string): Promise<void> {
    const saved = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.studentPaymentMethod.findUnique({ where: { studentId_schoolId: { studentId: callerId, schoolId } } }),
    );
    if (!saved) {
      throw new NotFoundException('No saved payment method for this School.');
    }
    try {
      const account = await this.resolveStripePaymentAccount(callerId, schoolId);
      const stripe = this.stripeClient.scopedClient(account.stripeConnectedAccountId!);
      const customer = await stripe.customers.retrieve(saved.stripeCustomerId);
      const pmId = (customer as { invoice_settings?: { default_payment_method?: string } }).invoice_settings?.default_payment_method;
      if (pmId) {
        await stripe.paymentMethods.detach(pmId);
      }
    } catch (err) {
      this.logger.error(`Failed to detach Stripe payment method for Student ${callerId} at School ${schoolId} — Stripe-side cleanup may be needed.`, err as Error);
    }
    await this.prismaApp.withTenantContext(callerId, (tx) => tx.studentPaymentMethod.delete({ where: { id: saved.id } }));
  }

  // ---------------------------------------------------------------------------
  // Hosted Checkout for a one-time fresh-card purchase (Track B Slice 4b,
  // `docs/TRACK-B-ROADMAP.md`'s own Slice 4b entry). apps/student has no Stripe
  // SDK dependency at all (Decision 113) and is plain Expo-managed with no
  // custom native dev client, so `charge()` above's bare PaymentIntent
  // `clientSecret` (the `requires_payment` outcome) has nothing in that app to
  // render it with — Stripe Elements/PaymentSheet both need a native module
  // this app's build setup doesn't have. Exactly Decision 238's own reasoning
  // for `createSetupSession()` above, extended from mode: 'setup' (saving a
  // card) to mode: 'payment' (actually charging one, once, for a specific
  // MembershipPlan amount).
  // ---------------------------------------------------------------------------

  /**
   * `MembershipsService.purchase()`'s `useHostedCheckout` branch — a hosted
   * Stripe Checkout Session (`mode: 'payment'`) for a one-time CLASS_PACK/
   * WEEKLY_PASS/TRIAL_MEMBERSHIP purchase, opened in the device's own browser
   * via `expo-web-browser` exactly like `createSetupSession()` above, same
   * `ultm8-student://` auto-return scheme.
   *
   * **Deliberately reuses the EXISTING `payment_intent.succeeded` webhook
   * handler** (`StripeWebhookProcessingProcessor.handlePaymentIntentSucceeded`)
   * as the completion signal, rather than adding a second, parallel
   * Membership-creation path keyed off `checkout.session.completed` the way
   * `createSetupSession()`'s own mode:'setup' flow has to (a Setup Intent has
   * no Membership/Transaction of its own to settle — a Checkout `payment`-mode
   * Session's underlying PaymentIntent does). Verified directly against the
   * installed Stripe SDK's own type definitions before relying on this: a
   * `mode: 'payment'` Checkout Session creates its underlying PaymentIntent
   * SYNCHRONOUSLY at Session-creation time — `Session.payment_intent` is a
   * real, expandable field from the moment `sessions.create()` returns, the
   * identical shape `subscribe()`'s own `expand: ['latest_invoice.payment_intent']`
   * already relies on for the same reason (needing the PaymentIntent id
   * immediately, to stash on the Transaction before any webhook ever fires).
   * So `MembershipsService.purchase()`'s caller sets
   * `Transaction.stripePaymentIntentId` at CREATION time here, exactly like
   * the plain `charge()` branch already does — once the Student completes
   * payment on the hosted page, Stripe fires `payment_intent.succeeded` for
   * that SAME PaymentIntent, already matched, collision-resolved (Spec 55
   * §6.1's two-simultaneous-Active-Membership race), and turned into a
   * Membership by the one handler that already exists. Deliberately NOT a new
   * `checkout.session.completed` branch for `mode: 'payment'`: Stripe fires
   * BOTH events for a successful card Checkout, and building a second
   * Membership-creation path keyed off the Session would duplicate
   * `handlePaymentIntentSucceeded`'s own logic for no benefit while opening a
   * real risk of the two deliveries racing each other — a second source of
   * truth, not a safer one. (Also recorded as Decision 241,
   * `docs/decisions/POST-SPEC-55-DECISION-LOG.md`.)
   */
  async createPurchaseCheckoutSession(
    callerId: string,
    schoolId: string,
    amount: number,
    currency: string,
    description: string,
  ): Promise<{ checkoutUrl: string; paymentIntentId: string }> {
    const account = await this.resolveStripePaymentAccount(callerId, schoolId);
    const stripe = this.stripeClient.scopedClient(account.stripeConnectedAccountId!);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: amount,
            // Inline product_data, same simplification charge()/subscribe()
            // above already use (no persisted MembershipPlan<->Stripe Product
            // mapping exists) — unlike subscribe()'s own Price, a Checkout
            // line item's price_data DOES accept inline product_data (verified
            // against the installed SDK's own type definitions, same check
            // subscribe()'s own header comment already did for the opposite
            // answer on Subscriptions).
            product_data: { name: description },
          },
          quantity: 1,
        },
      ],
      success_url: 'ultm8-student://membership-purchase/complete',
      cancel_url: 'ultm8-student://membership-purchase/cancel',
      expand: ['payment_intent'],
    });
    if (!session.url) {
      throw new Error('Stripe Checkout Session did not return a hosted URL.');
    }
    const paymentIntent = session.payment_intent;
    const paymentIntentId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id;
    if (!paymentIntentId) {
      throw new Error("Stripe Checkout Session (mode: 'payment') did not return an expandable PaymentIntent.");
    }
    return { checkoutUrl: session.url, paymentIntentId };
  }

  /**
   * The actual off-session charge — Decision 234's own late-cancellation fee is
   * the first real caller (BookingsService.cancelBooking()), reusing whatever
   * card this Student saved via createSetupSession() above. Reads
   * StudentPaymentMethod under the STUDENT's own tenant context (self-only RLS),
   * not the caller's — BookingsService already runs its own Stripe-adjacent work
   * under `withTenantContext(resolvedBooking.studentId, ...)` for the identical
   * reason (a Staff-initiated cancellation has no RoleGrant of its own that would
   * otherwise see this row).
   *
   * Throws NoSavedPaymentMethodError (exported, checked via instanceof at the
   * call site) when there's nothing to charge — a real, expected precondition
   * failure, not a Stripe-side error. A declined card is NOT thrown as an
   * error — `{ succeeded: false }` is an ordinary, expected outcome of an
   * automated off-session charge attempt, same category as a bounced cheque,
   * not a system failure; only a genuinely unexpected Stripe/network error
   * propagates.
   */
  async chargeOffSession(
    studentId: string,
    schoolId: string,
    amount: number,
    currency: string,
    description: string,
  ): Promise<{ succeeded: boolean; paymentIntentId: string }> {
    const saved = await this.prismaApp.withTenantContext(studentId, (tx) =>
      tx.studentPaymentMethod.findUnique({ where: { studentId_schoolId: { studentId, schoolId } } }),
    );
    if (!saved) {
      throw new NoSavedPaymentMethodError(`Student ${studentId} has no saved payment method at School ${schoolId}.`);
    }
    const account = await this.resolveStripePaymentAccount(studentId, schoolId);
    const stripe = this.stripeClient.scopedClient(account.stripeConnectedAccountId!);
    const customer = await stripe.customers.retrieve(saved.stripeCustomerId);
    const pmId = (customer as { invoice_settings?: { default_payment_method?: string } }).invoice_settings?.default_payment_method;
    if (!pmId) {
      throw new NoSavedPaymentMethodError(`Student ${studentId}'s Stripe Customer at School ${schoolId} has no default payment method set.`);
    }
    try {
      const intent = await stripe.paymentIntents.create({
        amount,
        currency,
        description,
        customer: saved.stripeCustomerId,
        payment_method: pmId,
        off_session: true,
        confirm: true,
      });
      return { succeeded: intent.status === 'succeeded', paymentIntentId: intent.id };
    } catch (err) {
      if (err instanceof Stripe.errors.StripeCardError) {
        const paymentIntentId = (err.payment_intent as { id?: string } | undefined)?.id ?? '';
        return { succeeded: false, paymentIntentId };
      }
      throw err;
    }
  }

  /**
   * Decision 236's own follow-up — MembershipsService.purchase()'s saved-card
   * reuse branch calls this when chargeOffSession() above already captured a
   * real charge but the Membership it was paying for then lost the
   * two-simultaneous-Active-general-access-Membership race (the same P2002
   * createMembershipAndReturn() already catches). Unlike that race when it
   * happens via the async webhook path (StripeWebhookProcessingProcessor's
   * own resolveMembershipCollision, which has a dedicated queue+idempotency-
   * key mechanism), this one is synchronous — chargeOffSession() already ran
   * BEFORE any DB write (same "an external Stripe call has no place holding a
   * DB transaction open" discipline this codebase enforces everywhere else),
   * so by the time the collision is detected here, real money has already
   * moved and nothing else will refund it. No idempotency key is set — this
   * is called at most once per purchase() invocation, synchronously, never
   * retried by a queue the way the webhook path's own equivalent is.
   */
  async refundOffSessionCharge(studentId: string, schoolId: string, paymentIntentId: string): Promise<void> {
    const account = await this.resolveStripePaymentAccount(studentId, schoolId);
    const stripe = this.stripeClient.scopedClient(account.stripeConnectedAccountId!);
    await stripe.refunds.create({ payment_intent: paymentIntentId });
  }

  /**
   * A School's single configured PaymentAccount must be STRIPE-provider and fully
   * onboarded (stripeConnectedAccountId set) before it can charge/subscribe anyone —
   * derived, not client-chosen (see MembershipPlan's own schema comment for the full
   * "one PaymentAccount, one fixed provider" reasoning). `callerId` is the actual
   * caller's own User.id for `withTenantContext` — NOT schoolId (an earlier draft of
   * this method passed schoolId here, which would have set RLS's
   * app.current_user_id to a School's id instead of a real User's, silently
   * returning zero rows for every query in this transaction instead of throwing;
   * caught and fixed before this ever ran against a real database).
   */
  private async resolveStripePaymentAccount(callerId: string, schoolId: string) {
    const account = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.paymentAccount.findUnique({ where: { schoolId } }),
    );
    if (!account || account.provider !== 'STRIPE' || !account.stripeConnectedAccountId) {
      throw new BadRequestException(
        'This School has no fully-onboarded Stripe PaymentAccount — Stripe Connect onboarding must complete before Stripe-paid purchases are possible.',
      );
    }
    return account;
  }

  // ---------------------------------------------------------------------------
  // Cash/Bank Transfer settlement confirmation (Phase 9, Spec 55 §7/§10.2/§6.1).
  // ---------------------------------------------------------------------------

  /**
   * PATCH /transactions/{id}/confirm — School Owner/Manager only, idempotent.
   * Atomically flips a PENDING Cash/Bank Transaction to SUCCESSFUL and creates the
   * resulting Membership Active, in one DB transaction (withTenantContext already
   * wraps its callback in `$transaction`, so both writes commit-or-rollback
   * together).
   *
   * Idempotency is a CONDITIONAL UPDATE (`WHERE status = 'PENDING'`, checked via
   * affected-row-count), NOT the create()+caught-P2002 dedup pattern used elsewhere
   * in this codebase (ProcessedStripeEvent, the Membership two-simultaneous-Active
   * check) — deliberately different technique, since nothing is being deduped here;
   * an existing Transaction is transitioning state, and the thing being guarded
   * against is a double state-transition on an already-resolved row, not a
   * duplicate insert. A repeat call finds 0 rows affected and no-ops (Spec 55 §6.1:
   * "the second PATCH /transactions/{id}/confirm call is simply rejected, its
   * Transaction stays Pending" — read here as "no-ops, doesn't throw", matching
   * this endpoint's own confirmed idempotency, not the different collision case
   * that same sentence describes for a genuinely competing Cash/Bank purchase).
   */
  async confirmTransaction(callerId: string, transactionId: string) {
    try {
      return await this.confirmTransactionInner(callerId, transactionId);
    } catch (err) {
      // FOUND ON REVIEW: the two-simultaneous-Active-general-access-Membership
      // partial unique index (this phase's migration) can collide here exactly
      // like it can in MembershipsService.createMembershipAndReturn, which catches
      // it and throws a friendly ConflictException — this method didn't, falling
      // through to the generic Prisma-error filter's "A record with this value
      // already exists" instead. The catch MUST live out here, outside
      // withTenantContext's own `$transaction` — catching it INSIDE that
      // transaction and trying to keep going would hit the exact Postgres
      // transaction-abort bug documented at length in
      // stripe-webhook-processing.processor.ts's handlePaymentIntentSucceeded
      // (once any statement inside a Postgres transaction errors, the whole
      // transaction is aborted regardless of a JS-level try/catch) — this whole
      // method's writes (the Transaction status flip included) correctly roll
      // back together when the Membership create collides, same as intended.
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
        throw new ConflictException('This Student already holds an active general-access Membership at this School.');
      }
      throw err;
    }
  }

  private async confirmTransactionInner(callerId: string, transactionId: string) {
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      const transaction = await tx.transaction.findUnique({ where: { id: transactionId } });
      if (!transaction) {
        throw new NotFoundException('Transaction not found');
      }
      await this.tenantAuth.assertSchoolOwner(callerId, transaction.schoolId);

      if (transaction.status !== 'PENDING') {
        // Already resolved (by an earlier call, or was never Pending to begin with,
        // e.g. a Stripe-paid Transaction) — idempotent no-op, not an error.
        return { transaction, membershipCreated: false };
      }
      if (transaction.paymentMethod === 'STRIPE') {
        throw new BadRequestException('Only Cash/Bank Transfer Transactions are confirmed through this endpoint — Stripe Transactions settle via webhook.');
      }

      const updateResult = await tx.transaction.updateMany({
        where: { id: transactionId, status: 'PENDING' },
        data: { status: 'SUCCESSFUL' },
      });
      if (updateResult.count === 0) {
        // Lost a race with a concurrent confirm call between the findUnique above
        // and this updateMany — the other call already won. No-op, matching the
        // single-call idempotent case above.
        return { transaction, membershipCreated: false };
      }

      const plan = await tx.membershipPlan.findUniqueOrThrow({ where: { id: transaction.membershipPlanId } });
      const membership = await tx.membership.create({
        data: {
          id: randomUUID(),
          studentId: transaction.studentId,
          membershipPlanId: transaction.membershipPlanId,
          schoolId: transaction.schoolId,
          frequency: 'ONE_TIME', // Cash/Bank Transfer is never Subscription-eligible (Spec 55 §6.1)
          classesRemaining: plan.classesIncluded ?? undefined,
          expiryDate: plan.expiryDurationDays
            ? new Date(Date.now() + plan.expiryDurationDays * 24 * 60 * 60 * 1000)
            : undefined,
          scopedClassId: plan.scopedClassId,
        },
      });
      await tx.transaction.update({ where: { id: transactionId }, data: { membershipId: membership.id } });

      return { transaction: { ...transaction, status: 'SUCCESSFUL' as const }, membership, membershipCreated: true };
    });
  }
}
