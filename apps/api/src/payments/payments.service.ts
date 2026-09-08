import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { StripeClientService } from './stripe-client.service';
import { CreatePaymentAccountDto } from './dto/create-payment-account.dto';
import { STRIPE_WEBHOOK_PROCESSING_QUEUE } from '../jobs/queue.constants';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
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
  // Franchise-side PaymentAccount CRUD — schema-correct, practically unreachable
  // this phase (no FranchisesController/FranchisesService, no FRANCHISE_OWNER
  // grantability anywhere in this codebase — see the Phase 8 kickoff prompt). Built
  // correctly anyway; exercised only via direct-seed e2e fixtures.
  // ---------------------------------------------------------------------------

  async createForFranchise(callerId: string, franchiseId: string, dto: CreatePaymentAccountDto) {
    // No FranchisesService.findOne() exists yet — assertFranchiseOwner is the only
    // check available, and it already 403s (not 404s) for a nonexistent franchiseId
    // too, since a RoleGrant can never match one. No confirmed way to distinguish
    // "Franchise doesn't exist" from "you're not its Owner" without Franchise CRUD to
    // build a real existence check against — flagged, not silently assumed away.
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
    await this.webhookQueue.add(
      'process',
      { stripeEventId: event.id, eventType: event.type, objectId: object.id },
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
