import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { MembershipsService } from './memberships.service';
import { NoSavedPaymentMethodError } from '../payments/payments.service';

/**
 * Decision 236's own follow-up — MembershipsService.purchase()'s
 * payWithSavedCard branch (purchaseWithSavedCard, private — called here via
 * direct cast, same technique PaymentsService's own spec file uses for its
 * private resolveStripePaymentAccount()). The HTTP-reachable blocking paths
 * (step-up missing/invalid, no saved card, SUBSCRIPTION/Guardian/Cash-Bank
 * scope blocks) are covered end-to-end in memberships.e2e-spec.ts against a
 * real Postgres; this file covers the one branch that e2e cannot reach
 * without a real Stripe call — what happens once chargeOffSession() already
 * succeeded, synchronously, before the Membership-creation race is even
 * attempted: a clean success, and the collision-triggers-a-refund case.
 */
describe('MembershipsService.purchaseWithSavedCard (Decision 236)', () => {
  function makeTx(overrides: { membershipCreate?: jest.Mock; membershipFindMany?: jest.Mock; transactionCreate?: jest.Mock; transactionUpdate?: jest.Mock } = {}) {
    return {
      // Decision 334's assertCanCreateMembership(): the advisory lock and the
      // live-membership read.
      $executeRaw: jest.fn().mockResolvedValue(1),
      membership: {
        create: overrides.membershipCreate ?? jest.fn().mockResolvedValue({ id: 'membership-1' }),
        findMany: overrides.membershipFindMany ?? jest.fn().mockResolvedValue([]),
      },
      transaction: {
        create: overrides.transactionCreate ?? jest.fn().mockResolvedValue({ id: 'transaction-1' }),
        update: overrides.transactionUpdate ?? jest.fn().mockResolvedValue({}),
      },
    };
  }

  function makeService(opts: {
    tx: ReturnType<typeof makeTx>;
    chargeOffSession: jest.Mock;
    refundOffSessionCharge?: jest.Mock;
    assertVerified?: jest.Mock;
  }) {
    const prismaApp = { withTenantContext: jest.fn((_userId: string, cb: (tx: unknown) => unknown) => cb(opts.tx)) };
    const paymentsService = {
      chargeOffSession: opts.chargeOffSession,
      refundOffSessionCharge: opts.refundOffSessionCharge ?? jest.fn().mockResolvedValue(undefined),
    };
    const stepUpService = { assertVerified: opts.assertVerified ?? jest.fn() };
    const service = new MembershipsService(
      prismaApp as never,
      null as never,
      null as never,
      paymentsService as never,
      null as never,
      null as never,
      stepUpService as never,
      // v1.2 backend backlog — the price-migration queue injection
      // (@InjectQueue(MEMBERSHIP_PLAN_PRICE_MIGRATION_QUEUE)); unused by the
      // purchaseWithSavedCard path this spec file exercises, same "null as
      // never for a dependency this test's code path never touches"
      // convention every other argument here already follows.
      null as never,
      null as never, // StripeClientService (Decision 348 cancel)
    );
    return { service, prismaApp, paymentsService, stepUpService };
  }

  interface FixturePlan {
    id: string;
    schoolId: string;
    type: string;
    classesIncluded: number | null;
    expiryDurationDays: number | null;
    scopedClassId: string | null;
    price: number;
    title: string;
  }

  const plan: FixturePlan = {
    id: 'plan-1',
    schoolId: 'school-1',
    type: 'CLASS_PACK',
    classesIncluded: 5,
    expiryDurationDays: null,
    scopedClassId: null,
    price: 3000,
    title: 'Pack',
  };

  function callPurchaseWithSavedCard(service: MembershipsService, stepUpToken?: string, fixturePlan: FixturePlan = plan) {
    return (
      service as unknown as {
        purchaseWithSavedCard: (
          studentId: string,
          callerId: string,
          plan: FixturePlan,
          paymentAccountId: string,
          currency: string,
          stepUpToken?: string,
        ) => Promise<unknown>;
      }
    ).purchaseWithSavedCard('student-1', 'student-1', fixturePlan, 'account-1', 'usd', stepUpToken);
  }

  it('checks step-up BEFORE ever calling chargeOffSession', async () => {
    const assertVerified = jest.fn(() => {
      throw new ForbiddenException({ code: 'STEP_UP_REQUIRED', message: 'Re-enter your passcode to confirm this action.' });
    });
    const chargeOffSession = jest.fn();
    const { service } = makeService({ tx: makeTx(), chargeOffSession, assertVerified });

    await expect(callPurchaseWithSavedCard(service, undefined)).rejects.toBeInstanceOf(ForbiddenException);
    expect(chargeOffSession).not.toHaveBeenCalled();
  });

  it('maps NoSavedPaymentMethodError to a clear 400, without creating any Transaction row', async () => {
    const chargeOffSession = jest.fn().mockRejectedValue(new NoSavedPaymentMethodError('none saved'));
    const tx = makeTx();
    const { service } = makeService({ tx, chargeOffSession });

    await expect(callPurchaseWithSavedCard(service, 'valid-token')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it('records a FAILED Transaction and throws 400 when the saved card is declined', async () => {
    const chargeOffSession = jest.fn().mockResolvedValue({ succeeded: false, paymentIntentId: 'pi_declined' });
    const tx = makeTx();
    const { service } = makeService({ tx, chargeOffSession });

    await expect(callPurchaseWithSavedCard(service, 'valid-token')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', stripePaymentIntentId: 'pi_declined' }) }),
    );
  });

  it('on a clean success, records a SUCCESSFUL Transaction, creates the Membership, and links the two', async () => {
    const chargeOffSession = jest.fn().mockResolvedValue({ succeeded: true, paymentIntentId: 'pi_ok' });
    const tx = makeTx();
    const { service } = makeService({ tx, chargeOffSession });

    const result = (await callPurchaseWithSavedCard(service, 'valid-token')) as { outcome: string; membership: { id: string }; transactionId: string };

    expect(result.outcome).toBe('active');
    expect(result.membership).toEqual({ id: 'membership-1' });
    expect(typeof result.transactionId).toBe('string');
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: result.transactionId, status: 'SUCCESSFUL', stripePaymentIntentId: 'pi_ok' }) }),
    );
    expect(tx.transaction.update).toHaveBeenCalledWith({ where: { id: result.transactionId }, data: { membershipId: 'membership-1' } });
  });

  it('refunds the already-captured charge and marks the Transaction REFUNDED when Membership creation loses the two-simultaneous-Active race', async () => {
    const chargeOffSession = jest.fn().mockResolvedValue({ succeeded: true, paymentIntentId: 'pi_collision' });
    const refundOffSessionCharge = jest.fn().mockResolvedValue(undefined);
    // A live Weekly Pass, created between purchase()'s pre-check and here.
    const tx = makeTx({ membershipFindMany: jest.fn().mockResolvedValue([{ status: 'ACTIVE', expiryDate: null, classesRemaining: null }]) });
    const { service, paymentsService } = makeService({ tx, chargeOffSession, refundOffSessionCharge });
    const weeklyPass: FixturePlan = { ...plan, type: 'WEEKLY_PASS', classesIncluded: null, expiryDurationDays: 7 };

    await expect(callPurchaseWithSavedCard(service, 'valid-token', weeklyPass)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.membership.create).not.toHaveBeenCalled();

    expect(paymentsService.refundOffSessionCharge).toHaveBeenCalledWith('student-1', 'school-1', 'pi_collision');
    const createdTransactionId = tx.transaction.create.mock.calls[0][0].data.id;
    expect(tx.transaction.update).toHaveBeenCalledWith({
      where: { id: createdTransactionId },
      data: { status: 'REFUNDED', refundedAmount: plan.price },
    });
  });
});

/**
 * Decision 243 (Track B Slice 4b) — `MembershipsService.purchase()`'s
 * `useHostedCheckout` branch (purchaseViaHostedCheckout, private — called
 * here via direct cast, same technique the payWithSavedCard describe block
 * above uses). apps/student has no Stripe Elements/PaymentSheet SDK, so the
 * bare clientSecret `charge()`/`requires_payment` would return is unusable
 * there — this wraps the identical one-time charge in a hosted Stripe
 * Checkout Session instead. Unlike payWithSavedCard, there is no live Stripe
 * call to avoid in e2e here either way — PaymentsService.
 * createPurchaseCheckoutSession() is mocked directly, the same split
 * payments.service.spec.ts's own Decision 243 block already establishes
 * (e2e cannot exercise a real Checkout Session create against a fixture
 * `acct_fixture_...` connected account id, so this Transaction-creation
 * logic is unit-tested here instead). The webhook-settlement half (once
 * payment_intent.succeeded fires for the Session's own PaymentIntent) is
 * NOT re-tested here — it is the exact same Transaction shape, and the exact
 * same handler, `charge()`'s own requires_payment path already produces and
 * stripe-webhook-processing.e2e-spec.ts already covers end-to-end.
 */
describe('MembershipsService.purchaseViaHostedCheckout (Decision 243)', () => {
  function makeTx(overrides: { transactionCreate?: jest.Mock } = {}) {
    return { transaction: { create: overrides.transactionCreate ?? jest.fn().mockResolvedValue({ id: 'transaction-1' }) } };
  }

  function makeService(opts: { tx: ReturnType<typeof makeTx>; createPurchaseCheckoutSession: jest.Mock }) {
    const prismaApp = { withTenantContext: jest.fn((_userId: string, cb: (tx: unknown) => unknown) => cb(opts.tx)) };
    const paymentsService = { createPurchaseCheckoutSession: opts.createPurchaseCheckoutSession };
    const service = new MembershipsService(
      prismaApp as never,
      null as never,
      null as never,
      paymentsService as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never, // StripeClientService (Decision 348 cancel)
    );
    return { service, prismaApp, paymentsService };
  }

  const hostedCheckoutPlan = { id: 'plan-1', schoolId: 'school-1', price: 3000, title: 'Pack' };

  function callPurchaseViaHostedCheckout(service: MembershipsService) {
    return (
      service as unknown as {
        purchaseViaHostedCheckout: (
          studentId: string,
          plan: typeof hostedCheckoutPlan,
          paymentAccountId: string,
          currency: string,
        ) => Promise<unknown>;
      }
    ).purchaseViaHostedCheckout('student-1', hostedCheckoutPlan, 'account-1', 'usd');
  }

  it("creates a PENDING Transaction carrying the Checkout Session's own synchronously-created PaymentIntent id, and returns the hosted checkoutUrl", async () => {
    const tx = makeTx();
    const createPurchaseCheckoutSession = jest
      .fn()
      .mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_1', paymentIntentId: 'pi_checkout_1' });
    const { service } = makeService({ tx, createPurchaseCheckoutSession });

    const result = (await callPurchaseViaHostedCheckout(service)) as { outcome: string; checkoutUrl: string; transactionId: string };

    expect(createPurchaseCheckoutSession).toHaveBeenCalledWith('student-1', 'school-1', 3000, 'usd', 'Pack');
    expect(result.outcome).toBe('requires_checkout');
    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/pay/cs_1');
    expect(typeof result.transactionId).toBe('string');
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: result.transactionId,
          schoolId: 'school-1',
          studentId: 'student-1',
          paymentAccountId: 'account-1',
          membershipPlanId: 'plan-1',
          amount: 3000,
          currency: 'usd',
          status: 'PENDING',
          paymentMethod: 'STRIPE',
          stripePaymentIntentId: 'pi_checkout_1',
        }),
      }),
    );
  });
});

/**
 * Decision 243's own scope checks, exercised against the full public
 * `purchase()` method rather than the private branch directly — these are
 * pure validation/authorization logic reachable before any Stripe call, the
 * same "no live Stripe credentials needed" territory
 * memberships.e2e-spec.ts's own payWithSavedCard guard tests already occupy,
 * covered here at the unit level instead since the Guardian-ALLOWED case
 * below needs to observe that `purchaseViaHostedCheckout` (and therefore
 * `PaymentsService.createPurchaseCheckoutSession`) was actually reached —
 * something e2e cannot assert without a live Stripe call.
 */
describe('MembershipsService.purchase — useHostedCheckout scope (Decision 243)', () => {
  function makeService(opts: {
    plan: Record<string, unknown>;
    paymentAccount: Record<string, unknown> | null;
    student?: Record<string, unknown>;
    createPurchaseCheckoutSession?: jest.Mock;
  }) {
    const tx = {
      membershipPlan: { findUnique: jest.fn().mockResolvedValue(opts.plan) },
      paymentAccount: { findUnique: jest.fn().mockResolvedValue(opts.paymentAccount) },
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue(opts.student ?? { email: 'minor@example.test', paymentRestrictedAt: null }) },
      transaction: { create: jest.fn().mockResolvedValue({ id: 'transaction-1' }) },
      // Decision 334's purchase checks: a current Student, and the pre-charge
      // assertCanCreateMembership().
      roleGrant: { findFirst: jest.fn().mockResolvedValue({ id: 'grant-1' }) },
      membership: { findMany: jest.fn().mockResolvedValue([]) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const prismaApp = { withTenantContext: jest.fn((_userId: string, cb: (tx: unknown) => unknown) => cb(tx)) };
    const tenantAuth = { assertSchoolNotArchived: jest.fn().mockResolvedValue(undefined) };
    const paymentsService = {
      createPurchaseCheckoutSession:
        opts.createPurchaseCheckoutSession ??
        jest.fn().mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_1', paymentIntentId: 'pi_checkout_1' }),
    };
    const guardiansService = { assertGuardianOfStudent: jest.fn().mockResolvedValue(undefined) };
    const subscriptionGate = { assertNotDegraded: jest.fn().mockResolvedValue(undefined) };
    const service = new MembershipsService(
      prismaApp as never,
      tenantAuth as never,
      null as never,
      paymentsService as never,
      guardiansService as never,
      subscriptionGate as never,
      null as never,
      null as never,
      null as never, // StripeClientService (Decision 348 cancel)
    );
    return { service, tx, paymentsService, guardiansService };
  }

  const scopePlan = { id: 'plan-1', schoolId: 'school-1', type: 'CLASS_PACK', price: 3000, title: 'Pack', currency: 'usd', visible: true, expiryDurationDays: null };
  const stripeAccount = { id: 'account-1', provider: 'STRIPE' };
  const cashBankAccount = { id: 'account-1', provider: 'CASH_BANK_TRANSFER' };

  it('a Guardian-driven purchase with useHostedCheckout is NOT rejected the way payWithSavedCard would be — reaches the hosted-Checkout branch, for the MINOR\'s own School context', async () => {
    const { service, tx, paymentsService, guardiansService } = makeService({ plan: scopePlan, paymentAccount: stripeAccount });

    const result = (await service.purchase('guardian-1', 'plan-1', { studentId: 'minor-1', useHostedCheckout: true })) as {
      outcome: string;
      checkoutUrl: string;
    };

    expect(guardiansService.assertGuardianOfStudent).toHaveBeenCalledWith('guardian-1', 'minor-1');
    expect(result.outcome).toBe('requires_checkout');
    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/pay/cs_1');
    expect(paymentsService.createPurchaseCheckoutSession).toHaveBeenCalledWith('minor-1', 'school-1', 3000, 'USD', 'Pack');
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ studentId: 'minor-1', paymentAccountId: 'account-1' }) }),
    );
  });

  it('rejects combining payWithSavedCard and useHostedCheckout — 400, before any plan lookup', async () => {
    const { service, tx } = makeService({ plan: scopePlan, paymentAccount: stripeAccount });

    await expect(
      service.purchase('student-1', 'plan-1', { payWithSavedCard: true, useHostedCheckout: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.membershipPlan.findUnique).not.toHaveBeenCalled();
  });

  it('rejects useHostedCheckout for a SUBSCRIPTION plan — 400, before any Stripe call', async () => {
    const { service, paymentsService } = makeService({ plan: { ...scopePlan, type: 'SUBSCRIPTION' }, paymentAccount: stripeAccount });

    await expect(service.purchase('student-1', 'plan-1', { useHostedCheckout: true })).rejects.toBeInstanceOf(BadRequestException);
    expect(paymentsService.createPurchaseCheckoutSession).not.toHaveBeenCalled();
  });

  it('rejects useHostedCheckout at a Cash/Bank-provider School — 400', async () => {
    const { service, paymentsService } = makeService({ plan: scopePlan, paymentAccount: cashBankAccount });

    await expect(service.purchase('student-1', 'plan-1', { useHostedCheckout: true })).rejects.toBeInstanceOf(BadRequestException);
    expect(paymentsService.createPurchaseCheckoutSession).not.toHaveBeenCalled();
  });
});
