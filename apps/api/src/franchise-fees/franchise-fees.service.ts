import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { cursorPaginate, CursorPage } from '../common/pagination/cursor-paginate';
import { StripeClientService } from '../payments/stripe-client.service';

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
  ) {}

  /** GET /franchises/:id/fee-charges — RLS-scoped (franchiseId side); no
   * additional assertFranchiseOwner narrowing on this read, matching
   * FranchisesService.findSchoolsForFranchise's own convention of relying on the
   * tenant-boundary check alone for a read, not a role-specific one. */
  async findAllForFranchise(callerId: string, franchiseId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
    return this.prismaApp.withTenantContext(callerId, (tx) =>
      cursorPaginate((args) => tx.franchiseFeeCharge.findMany({ ...args, where: { franchiseId } }), cursor, limit),
    );
  }

  /** GET /schools/:id/fee-charges — RLS-scoped (schoolId side). */
  async findAllForSchool(callerId: string, schoolId: string, cursor?: string, limit?: number): Promise<CursorPage<{ id: string }>> {
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
      if (fresh.status !== 'SUCCESSFUL') {
        throw new BadRequestException(`Only a Successful charge can be refunded (this charge is ${fresh.status}).`);
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
