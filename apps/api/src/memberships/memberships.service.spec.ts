import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { MembershipsService, stripePurchaseKey } from './memberships.service';
import { NoSavedPaymentMethodError, checkoutTransactionId } from '../payments/payments.service';

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
  type Row = Record<string, unknown> & { id: string; status: string };
  // A small in-memory Transaction table: Decision 447 item 4 writes the row
  // Pending before the card is charged and settles it after
  // (off-session-purchase.ts), so the test follows the row's status.
  function makeTx(overrides: { membershipCreate?: jest.Mock; membershipFindMany?: jest.Mock; saved?: boolean; plan?: object } = {}) {
    const rows = new Map<string, Row>();
    const statusMatches = (row: Row, where: { status?: string | { in: string[] } }) =>
      where.status === undefined || (typeof where.status === 'string' ? row.status === where.status : where.status.in.includes(row.status));
    const tx = {
      rows,
      // Decision 334's assertCanCreateMembership(): the advisory lock and the
      // live-membership read.
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ taken: 0 }]),
      studentPaymentMethod: { findUnique: jest.fn().mockResolvedValue(overrides.saved === false ? null : { id: 'pm-1' }) },
      membershipPlan: { findUniqueOrThrow: jest.fn().mockResolvedValue(overrides.plan ?? plan) },
      membership: {
        create: overrides.membershipCreate ?? jest.fn().mockResolvedValue({ id: 'membership-1' }),
        findMany: overrides.membershipFindMany ?? jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      transaction: {
        create: jest.fn(async ({ data }: { data: Row }) => {
          rows.set(data.id, { ...data });
          return data;
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = rows.get(where.id)!;
          Object.assign(row, data);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: { where: { id: string; status?: string | { in: string[] }; stripePaymentIntentId?: null }; data: Record<string, unknown> }) => {
          const row = rows.get(where.id);
          if (!row || !statusMatches(row, where) || (where.stripePaymentIntentId === null && row.stripePaymentIntentId)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
        findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
          const row = rows.get(where.id)!;
          return { ...row, membership: row.membershipId ? { id: row.membershipId } : null };
        }),
      },
    };
    return tx;
  }

  function makeService(opts: {
    tx: ReturnType<typeof makeTx>;
    chargeOffSession: jest.Mock;
    refundOffSessionCharge?: jest.Mock;
    assertVerified?: jest.Mock;
  }) {
    // Each call is one database transaction: a throw rolls its writes back.
    const prismaApp = {
      withTenantContext: jest.fn(async (_userId: string, cb: (tx: unknown) => unknown) => {
        const before = new Map([...opts.tx.rows].map(([id, row]) => [id, { ...row }]));
        try {
          return await cb(opts.tx);
        } catch (err) {
          opts.tx.rows.clear();
          for (const [id, row] of before) opts.tx.rows.set(id, row);
          throw err;
        }
      }),
    };
    const paymentsService = {
      chargeOffSession: opts.chargeOffSession,
      refundOffSessionCharge: opts.refundOffSessionCharge ?? jest.fn().mockResolvedValue(undefined),
      sendRefundNotice: jest.fn().mockResolvedValue(undefined),
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
      // PrismaJobsService (Decision 404 freezes); Decision 432 item 8 reads the
      // School's zone with it for an N-day pass's expiry.
      { school: { findUnique: jest.fn().mockResolvedValue({ timezone: 'America/New_York' }) } } as never,
      null as never, // IncomeCategoriesService (Decision 316 item 10)
      null as never, // PlanContractsService (Decision 316 item 6)
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

  // `surcharge` sits before `stepUpToken` in purchaseWithSavedCard()'s own
  // signature (Decision 406); an earlier version of this helper left it out,
  // so the token was passed as the surcharge.
  function callPurchaseWithSavedCard(service: MembershipsService, stepUpToken?: string, fixturePlan: FixturePlan = plan, surcharge = 0) {
    return (
      service as unknown as {
        purchaseWithSavedCard: (
          studentId: string,
          callerId: string,
          plan: FixturePlan,
          paymentAccountId: string,
          currency: string,
          surcharge: number,
          stepUpToken?: string,
        ) => Promise<unknown>;
      }
    ).purchaseWithSavedCard('student-1', 'student-1', fixturePlan, 'account-1', 'usd', surcharge, stepUpToken);
  }

  const onlyRow = (tx: ReturnType<typeof makeTx>) => {
    expect(tx.rows.size).toBe(1);
    return [...tx.rows.values()][0];
  };

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
    const tx = makeTx({ saved: false });
    const { service } = makeService({ tx, chargeOffSession });

    await expect(callPurchaseWithSavedCard(service, 'valid-token')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.transaction.create).not.toHaveBeenCalled();
  });

  it('a saved card with no default card on the Customer: the Pending attempt ends Failed, and a 400', async () => {
    const chargeOffSession = jest.fn().mockRejectedValue(new NoSavedPaymentMethodError('no default'));
    const tx = makeTx();
    const { service } = makeService({ tx, chargeOffSession });

    await expect(callPurchaseWithSavedCard(service, 'valid-token')).rejects.toBeInstanceOf(BadRequestException);
    expect(onlyRow(tx)).toMatchObject({ status: 'FAILED', offSessionAttempt: true });
  });

  it('records a FAILED Transaction and throws 400 when the saved card is declined', async () => {
    const chargeOffSession = jest.fn().mockResolvedValue({ succeeded: false, paymentIntentId: 'pi_declined' });
    const tx = makeTx();
    const { service } = makeService({ tx, chargeOffSession });

    await expect(callPurchaseWithSavedCard(service, 'valid-token')).rejects.toBeInstanceOf(BadRequestException);
    expect(onlyRow(tx)).toMatchObject({ status: 'FAILED', stripePaymentIntentId: 'pi_declined' });
  });

  it('on a clean success, writes the attempt Pending before charging (tagged), then settles it Successful with the Membership', async () => {
    const chargeOffSession = jest.fn().mockResolvedValue({ succeeded: true, paymentIntentId: 'pi_ok' });
    const tx = makeTx();
    const { service } = makeService({ tx, chargeOffSession });

    const result = (await callPurchaseWithSavedCard(service, 'valid-token')) as { outcome: string; membership: { id: string }; transactionId: string };

    expect(result.outcome).toBe('active');
    expect(result.membership).toEqual({ id: 'membership-1' });
    expect(typeof result.transactionId).toBe('string');
    // Decision 447 item 4: Pending first, then Stripe, tagged with the row.
    expect(tx.transaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: result.transactionId, status: 'PENDING', offSessionAttempt: true }) }));
    expect(tx.transaction.create.mock.invocationCallOrder[0]).toBeLessThan(chargeOffSession.mock.invocationCallOrder[0]);
    expect(chargeOffSession).toHaveBeenCalledWith('student-1', 'school-1', plan.price, 'usd', plan.title, `membership-saved-card-${result.transactionId}`, 0, { transactionId: result.transactionId });
    expect(onlyRow(tx)).toMatchObject({ id: result.transactionId, status: 'SUCCESSFUL', stripePaymentIntentId: 'pi_ok', membershipId: 'membership-1' });
    expect(tx.membership.create).toHaveBeenCalledTimes(1);
  });

  it('refunds the already-captured charge and marks the Transaction REFUNDED when Membership creation loses the two-simultaneous-Active race', async () => {
    const chargeOffSession = jest.fn().mockResolvedValue({ succeeded: true, paymentIntentId: 'pi_collision' });
    const refundOffSessionCharge = jest.fn().mockResolvedValue(undefined);
    const weeklyPass: FixturePlan = { ...plan, type: 'WEEKLY_PASS', classesIncluded: null, expiryDurationDays: 7 };
    // A live Weekly Pass, created between purchase()'s pre-check and here.
    const tx = makeTx({ membershipFindMany: jest.fn().mockResolvedValue([{ status: 'ACTIVE', expiryDate: null, classesRemaining: null }]), plan: weeklyPass });
    const { service, paymentsService } = makeService({ tx, chargeOffSession, refundOffSessionCharge });

    await expect(callPurchaseWithSavedCard(service, 'valid-token', weeklyPass)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.membership.create).not.toHaveBeenCalled();

    const row = onlyRow(tx);
    expect(paymentsService.refundOffSessionCharge).toHaveBeenCalledWith('student-1', 'school-1', 'pi_collision', `off-session-purchase-refund-${row.id}`);
    expect(row).toMatchObject({ status: 'REFUNDED', refundedAmount: plan.price, stripePaymentIntentId: 'pi_collision' });
    expect(chargeOffSession).toHaveBeenCalledWith('student-1', 'school-1', plan.price, 'usd', plan.title, `membership-saved-card-${row.id}`, 0, { transactionId: row.id });
    // Decision 415 item 4: the member is told why the card was refunded.
    expect(paymentsService.sendRefundNotice).toHaveBeenCalledWith(
      expect.objectContaining({ key: `refund-refused-${row.id}`, title: 'Refund', body: expect.stringMatching(/was refunded to your card: .+ couldn't be bought\.$/) }),
      'student-1',
      'school-1',
    );
  });

  // Stripe refunds the whole card payment, surcharge included (seen on the
  // real test-mode sandbox: 1530 refunded for a 1500 plan with a 30 surcharge);
  // the recorded refund says the same.
  it('records the whole card payment as refunded, surcharge included, when a surcharged purchase loses the race', async () => {
    const chargeOffSession = jest.fn().mockResolvedValue({ succeeded: true, paymentIntentId: 'pi_collision' });
    const weeklyPass: FixturePlan = { ...plan, type: 'WEEKLY_PASS', classesIncluded: null, expiryDurationDays: 7, price: 1500 };
    const tx = makeTx({ membershipFindMany: jest.fn().mockResolvedValue([{ status: 'ACTIVE', expiryDate: null, classesRemaining: null }]), plan: weeklyPass });
    const { service, paymentsService } = makeService({ tx, chargeOffSession, refundOffSessionCharge: jest.fn().mockResolvedValue(undefined) });

    await expect(callPurchaseWithSavedCard(service, 'valid-token', weeklyPass, 30)).rejects.toBeInstanceOf(ConflictException);

    const row = onlyRow(tx);
    expect(chargeOffSession).toHaveBeenCalledWith('student-1', 'school-1', 1530, 'usd', weeklyPass.title, `membership-saved-card-${row.id}`, 30, { transactionId: row.id });
    expect(row).toMatchObject({ amount: 1500, surchargeAmount: 30, status: 'REFUNDED', refundedAmount: 1530 });
    expect(paymentsService.sendRefundNotice).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('15.30') }), 'student-1', 'school-1');
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
 * payment_intent.succeeded fires for the PaymentIntent the Session makes when
 * the member pays, matched by the Transaction id in its metadata) is covered by
 * stripe-webhook-processing.e2e-spec.ts's hosted Checkout block.
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
      null as never, // PrismaJobsService (Decision 404 freezes)
      null as never, // IncomeCategoriesService (Decision 316 item 10)
      null as never, // PlanContractsService (Decision 316 item 6)
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
          surcharge: number,
        ) => Promise<unknown>;
      }
    ).purchaseViaHostedCheckout('student-1', hostedCheckoutPlan, 'account-1', 'usd', 0);
  }

  // On the API version the installed SDK pins, the Session has no
  // PaymentIntent until the member pays: the row is linked to it by its own id,
  // which goes in the PaymentIntent's metadata (the webhook matches by it).
  it('creates a PENDING Transaction with no PaymentIntent yet, sends its id (derived from the idempotency key) to Stripe, and returns the hosted checkoutUrl', async () => {
    const tx = makeTx();
    const createPurchaseCheckoutSession = jest.fn().mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const { service } = makeService({ tx, createPurchaseCheckoutSession });

    const result = (await callPurchaseViaHostedCheckout(service)) as { outcome: string; checkoutUrl: string; transactionId: string };

    expect(createPurchaseCheckoutSession).toHaveBeenCalledWith('student-1', 'school-1', result.transactionId, 3000, 'usd', 'Pack', expect.stringMatching(/^membership-purchase-checkout-student-1-plan-1-[0-9a-f]{12}-\d+$/), 0, 'membership-purchase', 0);
    const key = createPurchaseCheckoutSession.mock.calls[0][6] as string;
    expect(result.transactionId).toBe(checkoutTransactionId(key));
    expect(result.outcome).toBe('requires_checkout');
    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: result.transactionId,
          schoolId: 'school-1',
          studentId: 'student-1',
          paymentAccountId: 'account-1',
          membershipPlanId: 'plan-1',
          amount: 3000,
          currency: 'USD', // stored in capitals (Decision 339, T3)
          status: 'PENDING',
          paymentMethod: 'STRIPE',
        }),
      }),
    );
    expect(tx.transaction.create.mock.calls[0][0].data).not.toHaveProperty('stripePaymentIntentId');
  });

  it('a double click (same key, so the same Session and id) returns the row the first click wrote', async () => {
    const duplicate = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const tx = { transaction: { create: jest.fn().mockRejectedValue(duplicate), findUnique: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id })) } };
    const createPurchaseCheckoutSession = jest.fn().mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const { service } = makeService({ tx: tx as never, createPurchaseCheckoutSession });

    const result = (await callPurchaseViaHostedCheckout(service)) as { transactionId: string };

    const id = createPurchaseCheckoutSession.mock.calls[0][2] as string;
    expect(tx.transaction.findUnique).toHaveBeenCalledWith({ where: { id }, select: { id: true } });
    expect(result.transactionId).toBe(id);
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
      // Decision 430 item 5: the School's zone for the buyer's age.
      school: { findUnique: jest.fn().mockResolvedValue({ timezone: null }) },
      paymentAccount: { findUnique: jest.fn().mockResolvedValue(opts.paymentAccount) },
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue(opts.student ?? { email: 'minor@example.test', paymentRestrictedAt: null, dateOfBirth: new Date('1990-01-01') }) },
      transaction: { create: jest.fn().mockResolvedValue({ id: 'transaction-1' }) },
      // Decision 334's purchase checks: a current Student, and the pre-charge
      // assertCanCreateMembership().
      roleGrant: { findFirst: jest.fn().mockResolvedValue({ id: 'grant-1' }) },
      membership: { findMany: jest.fn().mockResolvedValue([]) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      // Decision 406: no card surcharge at this School.
      $queryRaw: jest.fn().mockResolvedValue([{ bps: 0 }]),
    };
    const prismaApp = { withTenantContext: jest.fn((_userId: string, cb: (tx: unknown) => unknown) => cb(tx)) };
    const tenantAuth = { assertSchoolNotArchived: jest.fn().mockResolvedValue(undefined) };
    const paymentsService = {
      createPurchaseCheckoutSession:
        opts.createPurchaseCheckoutSession ??
        jest.fn().mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' }),
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
      // PrismaJobsService (Decision 404 freezes; "Delete my account": the
      // buyer's account is not being deleted).
      { user: { findUnique: jest.fn().mockResolvedValue({ deletionRequestedAt: null, erasedAt: null }) } } as never,
      null as never, // IncomeCategoriesService (Decision 316 item 10)
      null as never, // PlanContractsService (Decision 316 item 6)
    );
    return { service, tx, paymentsService, guardiansService };
  }

  const scopePlan = { id: 'plan-1', schoolId: 'school-1', type: 'CLASS_PACK', price: 3000, title: 'Pack', currency: 'usd', visible: true, expiryDurationDays: null };
  const stripeAccount = { id: 'account-1', provider: 'STRIPE', stripeConnectedAccountId: 'acct_school', stripeAccountReady: true };
  const cashBankAccount = { id: 'account-1', provider: 'CASH_BANK_TRANSFER' };

  it('a Guardian-driven purchase with useHostedCheckout is NOT rejected the way payWithSavedCard would be — reaches the hosted-Checkout branch, for the MINOR\'s own School context', async () => {
    const { service, tx, paymentsService, guardiansService } = makeService({ plan: scopePlan, paymentAccount: stripeAccount });

    const result = (await service.purchase('guardian-1', 'plan-1', { studentId: 'minor-1', useHostedCheckout: true })) as {
      outcome: string;
      checkoutUrl: string;
    };

    expect(guardiansService.assertGuardianOfStudent).toHaveBeenCalledWith('guardian-1', 'minor-1', { purpose: 'pay' });
    expect(result.outcome).toBe('requires_checkout');
    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    expect(paymentsService.createPurchaseCheckoutSession).toHaveBeenCalledWith('minor-1', 'school-1', expect.any(String), 3000, 'USD', 'Pack', expect.stringMatching(/^membership-purchase-checkout-minor-1-plan-1-[0-9a-f]{12}-\d+$/), 0, 'membership-purchase', 0);
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

describe('stripePurchaseKey (billing stress test, B2)', () => {
  it('is the same for a repeat click, and changes with the plan, the student or what is sent', () => {
    const key = stripePurchaseKey('student-1', 'plan-1', 'checkout', [3000, 'usd', 'Pack']);
    expect(stripePurchaseKey('student-1', 'plan-1', 'checkout', [3000, 'usd', 'Pack'])).toBe(key);
    expect(stripePurchaseKey('student-1', 'plan-1', 'checkout', [3500, 'usd', 'Pack'])).not.toBe(key);
    expect(stripePurchaseKey('student-1', 'plan-2', 'checkout', [3000, 'usd', 'Pack'])).not.toBe(key);
    expect(stripePurchaseKey('student-2', 'plan-1', 'checkout', [3000, 'usd', 'Pack'])).not.toBe(key);
    expect(stripePurchaseKey('student-1', 'plan-1', 'card', [3000, 'usd', 'Pack'])).not.toBe(key);
  });
});
