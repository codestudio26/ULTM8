import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { StripeClientService } from '../payments/stripe-client.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { FranchiseFeeBillingService } from './franchise-fee-billing.service';
import { FRANCHISE_FEE_CARD_PURPOSE } from './franchise-fee-card';

/**
 * Caller-scoped FranchiseFeeCharge reads + the refund action — the
 * PrismaAppService/withTenantContext counterpart to
 * FranchiseFeeBillingService's own job-scoped Stripe primitives (that service
 * has no caller; this one always does). Every read here relies on RLS alone
 * (`franchise_fee_charge_read`, this phase's migration — either tenant side, any
 * active role), same "RLS enforces the tenant boundary, no extra owner-narrowing
 * on reads" convention PaymentAccount's own findForSchool/findForFranchise
 * already established and left as an open question rather than deciding
 * differently here without a reason to.
 */
@Injectable()
export class FranchiseFeesService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly stripeClient: StripeClientService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly billing: FranchiseFeeBillingService,
  ) {}

  /**
   * Decision 407 — the School's Franchise and that Franchise's connected Stripe
   * account, for the card actions below. School Owner/Manager only. The
   * Franchise's PaymentAccount is read on the jobs connection after that check:
   * a School Owner holds no grant on the Franchise, so RLS hides it from them
   * (the same reason SchoolsService.leaveFranchise reads it there). Returns
   * `connectedAccountId: null` while the Franchise hasn't connected Stripe.
   */
  private async feeContext(callerId: string, schoolId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const school = await this.prismaApp.withTenantContext(callerId, (tx) => tx.school.findUnique({ where: { id: schoolId } }));
    if (!school) {
      throw new NotFoundException('School not found');
    }
    if (!school.franchiseId) {
      throw new BadRequestException('This School is not part of a Franchise, so it has no franchise fee to pay.');
    }
    const account = await this.prismaJobs.paymentAccount.findUnique({ where: { franchiseId: school.franchiseId } });
    const connectedAccountId = account?.provider === 'STRIPE' ? account.stripeConnectedAccountId : null;
    return { school, franchiseId: school.franchiseId, connectedAccountId };
  }

  /**
   * GET /schools/:id/franchise-fee/card — whether a card is saved for the
   * franchise fee (brand and last 4 digits read live from Stripe, never stored,
   * as PaymentsService.getMyPaymentMethod does), and whether one can be added
   * yet (the Franchise must have connected Stripe).
   */
  async getCard(callerId: string, schoolId: string): Promise<{ canAddCard: boolean; hasCard: boolean; brand?: string; last4?: string }> {
    const { school, connectedAccountId } = await this.feeContext(callerId, schoolId);
    if (!connectedAccountId) {
      return { canAddCard: false, hasCard: false };
    }
    if (!school.stripeFranchiseFeeCustomerId) {
      return { canAddCard: true, hasCard: false };
    }
    const customer = await this.stripeClient.scopedClient(connectedAccountId).customers.retrieve(school.stripeFranchiseFeeCustomerId, {
      expand: ['invoice_settings.default_payment_method'],
    });
    const pm = (customer as { invoice_settings?: { default_payment_method?: { card?: { brand: string; last4: string } } | string | null } })
      .invoice_settings?.default_payment_method;
    const card = pm && typeof pm !== 'string' ? pm.card : undefined;
    return { canAddCard: true, hasCard: !!pm, brand: card?.brand, last4: card?.last4 };
  }

  /**
   * POST /schools/:id/franchise-fee/card/setup-session — "Add card": a hosted
   * Stripe Checkout Session in setup mode, the same collection mechanism
   * PaymentsService.createSetupSession uses for a Student's card (Decision 238),
   * on the Franchise's connected account and for the School's kept Customer
   * (FranchiseFeeBillingService.ensureFeeCustomer — created here if the monthly
   * job hasn't made one yet). Stripe's own page takes the card; nothing about it
   * passes through ULTM8. The checkout.session.completed webhook
   * (StripeWebhookProcessingProcessor) makes it the Customer's and the
   * subscription's default payment method — never this request.
   *
   * Returns to the School page in the portal (PORTAL_BASE_URL, as invite links do).
   */
  async createCardSetupSession(callerId: string, schoolId: string): Promise<{ checkoutUrl: string }> {
    const { school, franchiseId, connectedAccountId } = await this.feeContext(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    if (!connectedAccountId) {
      throw new BadRequestException("This School's Franchise hasn't connected Stripe yet, so a card can't be added.");
    }
    const portal = process.env.PORTAL_BASE_URL?.trim().replace(/\/+$/, '');
    if (!portal) {
      throw new Error('PORTAL_BASE_URL is not set');
    }
    const stripe = this.stripeClient.scopedClient(connectedAccountId);
    const customerId = await this.billing.ensureFeeCustomer(stripe, school, franchiseId);
    // Read back by the checkout.session.completed handler, which checks them
    // against the School row before using the card.
    const metadata = { purpose: FRANCHISE_FEE_CARD_PURPOSE, schoolId, franchiseId };
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: customerId,
      payment_method_types: ['card'],
      success_url: `${portal}/school?franchiseCard=added`,
      cancel_url: `${portal}/school?franchiseCard=cancelled`,
      metadata,
      setup_intent_data: { metadata },
    });
    if (!session.url) {
      throw new Error('Stripe Checkout Session did not return a hosted URL.');
    }
    return { checkoutUrl: session.url };
  }

  /** GET /franchises/:id/fee-charges — RLS-scoped (franchiseId side); no
   * additional assertFranchiseOwner narrowing on this read, matching
   * FranchisesService.findSchoolsForFranchise's own convention of relying on the
   * tenant-boundary check alone for a read, not a role-specific one. */
  async findAllForFranchise(callerId: string, franchiseId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.franchiseFeeCharge.findMany({ ...args, where: { franchiseId } }), cursor, limit),
    );
  }

  /** GET /schools/:id/fee-charges — the School's Owner/Manager only (Decision
   * 407: the School pays the fee, its Owner sees what was charged). RLS alone
   * admits every role at the School, so the narrowing is here. */
  async findAllForSchool(callerId: string, schoolId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.franchiseFeeCharge.findMany({ ...args, where: { schoolId } }), cursor, limit),
    );
  }

  async findOne(callerId: string, id: string) {
    const charge = await this.prismaApp.withTenantContext(callerId, (tx) => tx.franchiseFeeCharge.findUnique({ where: { id } }));
    // RLS returns null (not another tenant's row) for a charge outside the
    // caller's scope — same "genuine 404 and RLS-blocked are indistinguishable
    // by design" convention every other read in this codebase already follows
    // (ultm8-tenant-isolation §2).
    if (!charge) {
      throw new NotFoundException('FranchiseFeeCharge not found');
    }
    return charge;
  }

  /**
   * POST /franchise-fee-charges/:id/refund — Franchise Owner only (Spec 55
   * §10.2, quoted: "refunded... only by the Franchise Owner — the Franchise's
   * own PaymentAccount is the one holding the money"). `amount` optional
   * (minor-unit); omitted means "refund whatever hasn't been refunded yet" —
   * same full-or-partial shape Transaction.refundedAmount's own established
   * convention already supports.
   *
   * The underlying PaymentIntent/Charge id isn't stored on FranchiseFeeCharge
   * itself (see that model's own schema.prisma comment on why — the modern
   * Stripe Invoice object no longer exposes it directly) — looked up here,
   * lazily, only when a refund is actually requested, via
   * `stripe.invoicePayments.list()` against the charge's own `stripeInvoiceId`.
   * Deliberately NOT done proactively in the invoice.paid webhook handler: that
   * would add an extra external API call (and a new failure mode) to every
   * single webhook delivery for a lookup only the rare, manual refund path
   * actually needs — found on review of an earlier draft that did fetch it
   * eagerly there.
   */
  async refund(callerId: string, id: string, amount?: number) {
    // Authorization + basic shape checks first — cheap, read-only, and don't
    // need the row lock below. `assertFranchiseOwner` needs `charge.franchiseId`,
    // so this read has to happen before the locked transaction regardless.
    const charge = await this.findOne(callerId, id);
    await this.tenantAuth.assertFranchiseOwner(callerId, charge.franchiseId);
    if (!charge.stripeInvoiceId) {
      throw new BadRequestException('This charge has no associated Stripe invoice to refund against.');
    }

    const account = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.paymentAccount.findUnique({ where: { id: charge.franchisePaymentAccountId } }),
    );
    if (!account?.stripeConnectedAccountId) {
      throw new BadRequestException('This Franchise\'s PaymentAccount is not fully onboarded with Stripe.');
    }

    /**
     * FOUND ON REVIEW, before this ever shipped: a first draft spanned the
     * balance read, the Stripe call, and the final write across THREE
     * separate `withTenantContext` calls (each its own transaction, no lock
     * held across any of them). Two concurrent refund requests for the same
     * charge (two admin clicks, a client retry) could both read the same
     * `refundedAmount`, both pass validation, and both successfully call
     * Stripe — a real, reachable double-refund via ordinary concurrent
     * action, not a contrived edge case.
     *
     * Fixed with the same `SELECT ... FOR UPDATE` idiom `bookings.service.ts`/
     * `waitlist.service.ts` already established for exactly this class of
     * problem: lock the row FIRST, re-read the balance AFTER acquiring the
     * lock (a concurrent request that started first has by then either
     * committed or rolled back), and only then validate/call Stripe/write —
     * all inside the one transaction holding the lock. This does mean the
     * Stripe network call happens while a DB lock is held, unlike this
     * codebase's usual "no external I/O inside a transaction" preference
     * (see stripe-webhook-processing.processor.ts's own comment on that) —
     * a deliberate trade-off here, not an oversight: refund is a low-
     * frequency, admin-only action, not a hot path, so a slightly
     * longer-held lock is worth a genuine full-serialization guarantee
     * rather than just narrowing the race window.
     *
     * FOUND ON REVIEW (follow-up verify pass): this transaction makes TWO
     * sequential real Stripe HTTP calls (`invoicePayments.list()` then
     * `refunds.create()`) plus the row lock/re-read/final write — comfortably
     * capable of exceeding Prisma's own default 5000ms interactive-transaction
     * timeout under ordinary network latency, not just under a Stripe outage.
     * A timeout that fires AFTER `refunds.create()` has already succeeded but
     * BEFORE the final `franchiseFeeCharge.update()` commits would force-roll-
     * back the whole transaction while Stripe has genuinely already moved the
     * money — the idempotency key above prevents a *retry* from double-
     * refunding, but does nothing to reconcile that specific outcome. Passing
     * an explicit, generous `timeoutMs` here (only for this call site —
     * PrismaAppService.withTenantContext's default is unchanged for every
     * other caller) makes that failure mode require genuinely pathological
     * Stripe latency rather than ordinary variance. This narrows the window
     * rather than closing it outright (a `refunds.create()` that succeeds at
     * Stripe but whose response never reaches this process — a dropped
     * connection, not a timeout — is a distinct, even-rarer gap that would
     * need Stripe-side reconciliation, e.g. a periodic sweep matching Stripe
     * refunds against FranchiseFeeCharge.refundedAmount, to close completely;
     * out of scope for this phase, not silently treated as solved here).
     */
    return this.prismaApp.withTenantContext(callerId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "FranchiseFeeCharge" WHERE id = ${id} FOR UPDATE`;
      const fresh = await tx.franchiseFeeCharge.findUniqueOrThrow({ where: { id } });

      // Re-checked after acquiring the lock, not trusted from the pre-lock
      // read above — a concurrent refund that fully refunded this charge
      // while this request was waiting for the lock would have flipped
      // `status` to REFUNDED in the meantime.
      //
      // Decision 111 — this same guard already satisfies Decision 55's
      // confirmed "refund frozen while disputed" contract with no new code:
      // stripe-webhook-processing's charge.dispute.* handler flips `status` to
      // DISPUTED as soon as a dispute opens, and DISPUTED !== SUCCESSFUL, so a
      // refund attempt against a disputed charge is already rejected here.
      // Confirmed, not assumed, before treating this as covered.
      if (fresh.status !== 'SUCCESSFUL') {
        const reason = fresh.status === 'DISPUTED' ? 'it is under an active Stripe dispute' : `this charge is ${fresh.status}`;
        throw new BadRequestException(`Only a Successful charge can be refunded — ${reason}.`);
      }
      const alreadyRefunded = fresh.refundedAmount ?? 0;
      const refundAmount = amount ?? fresh.amount - alreadyRefunded;
      if (refundAmount <= 0 || alreadyRefunded + refundAmount > fresh.amount) {
        throw new BadRequestException('Invalid refund amount — must be positive and not exceed the remaining unrefunded balance.');
      }

      const stripe = this.stripeClient.scopedClient(account.stripeConnectedAccountId!);
      const payments = await stripe.invoicePayments.list({ invoice: fresh.stripeInvoiceId! });
      const paid = payments.data.find((p) => p.is_default) ?? payments.data[0];
      if (!paid) {
        throw new BadRequestException('No recorded payment was found for this charge\'s invoice — nothing to refund.');
      }
      const paymentIntentId = paid.payment.type === 'payment_intent'
        ? typeof paid.payment.payment_intent === 'string' ? paid.payment.payment_intent : paid.payment.payment_intent?.id
        : undefined;
      const stripeChargeId = paid.payment.type === 'charge'
        ? typeof paid.payment.charge === 'string' ? paid.payment.charge : paid.payment.charge?.id
        : undefined;
      if (!paymentIntentId && !stripeChargeId) {
        throw new BadRequestException('Could not resolve a refundable PaymentIntent or Charge for this invoice.');
      }

      // Idempotency key derived from the state being refunded FROM — a
      // genuine retry of this exact request (network timeout, client
      // double-submit) reuses this key and Stripe dedupes it; a real second
      // refund attempted after this one already committed has a different
      // `alreadyRefunded` value and gets its own key. Same mechanism
      // FranchiseFeeBillingService.ensureSubscription() already uses for its
      // own money-moving Stripe call — flagged as missing here on review, not
      // present in the first draft.
      const idempotencyKey = `franchise-fee-refund-${id}-${alreadyRefunded}`;
      await stripe.refunds.create(
        paymentIntentId ? { payment_intent: paymentIntentId, amount: refundAmount } : { charge: stripeChargeId, amount: refundAmount },
        { idempotencyKey },
      );

      const newRefundedAmount = alreadyRefunded + refundAmount;
      return tx.franchiseFeeCharge.update({
        where: { id },
        data: { refundedAmount: newRefundedAmount, status: newRefundedAmount >= fresh.amount ? 'REFUNDED' : fresh.status },
      });
    }, { timeoutMs: 15_000 });
  }
}
