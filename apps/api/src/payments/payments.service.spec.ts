import { NoSavedPaymentMethodError, PaymentsService, checkoutTransactionId } from './payments.service';

/**
 * ULTM8 takes nothing from what a School charges its students, grading fees
 * included (Decisions 144, 159.1): a student's payment is made on the School's
 * own connected Stripe account, with no application fee and no transfer to the
 * platform. ULTM8's own income is its subscription and the franchise fee,
 * billed separately.
 */
describe('PaymentsService — a School keeps all of what its students pay (Decision 159.1)', () => {
  const stripe = {
    paymentIntents: { create: jest.fn().mockResolvedValue({ id: 'pi_1', client_secret: 'secret_1' }) },
    customers: { create: jest.fn().mockResolvedValue({ id: 'cus_1' }) },
    products: { create: jest.fn().mockResolvedValue({ id: 'prod_1' }) },
    subscriptions: {
      // Shaped like the real API version's (2026-08-26.dahlia) reply with
      // `expand: ['latest_invoice.payments', 'latest_invoice.confirmation_secret']`:
      // an Invoice has no `payment_intent`; its PaymentIntent is on `payments`.
      create: jest.fn().mockResolvedValue({
        id: 'sub_1',
        latest_invoice: {
          id: 'in_1',
          payments: { object: 'list', data: [{ id: 'inpay_1', object: 'invoice_payment', is_default: true, payment: { type: 'payment_intent', payment_intent: 'pi_2' } }] },
          confirmation_secret: { type: 'payment_intent', client_secret: 'pi_2_secret_2' },
        },
      }),
    },
  };
  const scopedClient = jest.fn().mockReturnValue(stripe);
  const service = new PaymentsService(
    null as never,
    null as never,
    null as never,
    null as never,
    { scopedClient } as never,
    null as never, null as never, null as never);
  jest
    .spyOn(service as unknown as { resolveStripePaymentAccount: () => Promise<unknown> }, 'resolveStripePaymentAccount')
    .mockResolvedValue({ stripeConnectedAccountId: 'acct_school' });

  const PLATFORM_CUT = ['application_fee_amount', 'application_fee_percent', 'transfer_data', 'on_behalf_of'];

  beforeEach(() => jest.clearAllMocks());

  it('a one-off pass (e.g. a grading-day pass) is charged on the School\'s own account, with no platform fee', async () => {
    await service.charge('student', 'school', 3000, 'gbp', 'Grading fee');
    expect(scopedClient).toHaveBeenCalledWith('acct_school');
    const params = stripe.paymentIntents.create.mock.calls[0][0];
    expect(params).toMatchObject({ amount: 3000, currency: 'gbp' });
    for (const key of PLATFORM_CUT) expect(params).not.toHaveProperty(key);
  });

  it('a subscription is billed on the School\'s own account, with no platform fee', async () => {
    await service.subscribe('student', 'school', 'student@example.test', 5000, 'gbp', 'Unlimited');
    expect(scopedClient).toHaveBeenCalledWith('acct_school');
    const params = stripe.subscriptions.create.mock.calls[0][0];
    for (const key of PLATFORM_CUT) expect(params).not.toHaveProperty(key);
  });

  // Decision 259 — PRORATED_TO_SHARED_CYCLE plans. Verified directly against
  // the installed SDK's own type definitions
  // (SubscriptionCreateParams.BillingCycleAnchorConfig) before writing this.
  it('omits billing_cycle_anchor_config when no billingCycleAnchorDay is passed (FRESH_CYCLE, every pre-existing plan)', async () => {
    await service.subscribe('student', 'school', 'student@example.test', 5000, 'gbp', 'Unlimited');
    const params = stripe.subscriptions.create.mock.calls[0][0];
    expect(params).not.toHaveProperty('billing_cycle_anchor_config');
  });

  // Every subscription purchase failed with a 500 on this API version: it
  // expanded `latest_invoice.payment_intent`, a field an Invoice no longer has.
  it('reads the first invoice\'s PaymentIntent from latest_invoice.payments and its client secret from confirmation_secret', async () => {
    const result = await service.subscribe('student', 'school', 'student@example.test', 5000, 'gbp', 'Unlimited');
    expect(result).toEqual({ subscriptionId: 'sub_1', paymentIntentId: 'pi_2', clientSecret: 'pi_2_secret_2' });
    const params = stripe.subscriptions.create.mock.calls[0][0];
    expect(params.expand).toEqual(['latest_invoice.payments', 'latest_invoice.confirmation_secret']);
  });

  it('refuses a subscription whose first invoice has no PaymentIntent, rather than recording an order nothing can pay', async () => {
    stripe.subscriptions.create.mockResolvedValueOnce({ id: 'sub_2', latest_invoice: { id: 'in_2', payments: { object: 'list', data: [] }, confirmation_secret: null } });
    await expect(service.subscribe('student', 'school', 'student@example.test', 5000, 'gbp', 'Unlimited')).rejects.toThrow("first invoice's PaymentIntent");
  });

  it('passes billing_cycle_anchor_config when billingCycleAnchorDay is passed (PRORATED_TO_SHARED_CYCLE)', async () => {
    await service.subscribe('student', 'school', 'student@example.test', 5000, 'gbp', 'Unlimited', undefined, 15);
    const params = stripe.subscriptions.create.mock.calls[0][0];
    expect(params.billing_cycle_anchor_config).toEqual({ day_of_month: 15 });
  });
});

/**
 * Decision 234's own saved-payment-method dependency — closes the real gap
 * charge()/subscribe()'s own header comments already flagged ("no GET
 * /payments/methods, no saved-card reuse anywhere yet"). Unit-tests the
 * Stripe-call shapes directly (verified against the installed SDK's own type
 * definitions before writing the service), the same split
 * subscription-plans.e2e-spec.ts's own header comment documents: e2e tests
 * cover everything up to the first real Stripe call; these unit tests cover
 * the Stripe-calling code itself, with a mocked client, never real Stripe.
 */
describe('PaymentsService — saved payment methods (Decision 234)', () => {
  function mockTx(studentPaymentMethod: Record<string, jest.Mock>, defaultCurrency: string | null = 'GBP') {
    return { studentPaymentMethod, school: { findUnique: jest.fn().mockResolvedValue({ defaultCurrency }) } };
  }

  function makeService(stripe: Record<string, unknown>, tx: ReturnType<typeof mockTx>) {
    const scopedClient = jest.fn().mockReturnValue(stripe);
    const prismaApp = { withTenantContext: jest.fn((_userId: string, cb: (tx: unknown) => unknown) => cb(tx)) };
    const service = new PaymentsService(
      prismaApp as never,
      null as never,
      null as never,
      null as never,
      { scopedClient } as never,
      null as never, null as never, null as never);
    jest
      .spyOn(service as unknown as { resolveStripePaymentAccount: () => Promise<unknown> }, 'resolveStripePaymentAccount')
      .mockResolvedValue({ stripeConnectedAccountId: 'acct_school' });
    return { service, scopedClient, prismaApp };
  }

  it('createSetupSession reuses the existing Customer for a Student who already has one at this School', async () => {
    const tx = mockTx({
      findUnique: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_existing' }),
    });
    const stripe = { checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_1' }) } } };
    const { service } = makeService(stripe, tx);

    const result = await service.createSetupSession('student', 'school');

    expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/pay/cs_1' });
    const params = stripe.checkout.sessions.create.mock.calls[0][0] as Record<string, unknown>;
    expect(params).toMatchObject({ mode: 'setup', customer: 'cus_existing', metadata: { studentId: 'student', schoolId: 'school' } });
  });

  // Stripe refused every setup Session on this API version ("Missing required
  // param: currency"). Cards only, in the School's currency: with a currency
  // alone the sandbox offered Klarna, Link, Revolut Pay and Amazon Pay too.
  it('createSetupSession asks for a card only, in the School\'s currency', async () => {
    const tx = mockTx({ findUnique: jest.fn().mockResolvedValue(null) });
    const stripe = { checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_3' }) } } };
    const { service } = makeService(stripe, tx);

    await service.createSetupSession('student', 'school');

    const params = stripe.checkout.sessions.create.mock.calls[0][0] as Record<string, unknown>;
    expect(params).toMatchObject({ mode: 'setup', payment_method_types: ['card'], currency: 'gbp' });
  });

  it('createSetupSession still asks for a card when the School has no currency set (card-only needs none)', async () => {
    const tx = mockTx({ findUnique: jest.fn().mockResolvedValue(null) }, null);
    const stripe = { checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_4' }) } } };
    const { service } = makeService(stripe, tx);

    await service.createSetupSession('student', 'school');

    const params = stripe.checkout.sessions.create.mock.calls[0][0] as Record<string, unknown>;
    expect(params.payment_method_types).toEqual(['card']);
    expect(params).not.toHaveProperty('currency');
  });

  it('createSetupSession omits `customer` for a Student with no saved card yet (Stripe creates a fresh one)', async () => {
    const tx = mockTx({ findUnique: jest.fn().mockResolvedValue(null) });
    const stripe = { checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_2' }) } } };
    const { service } = makeService(stripe, tx);

    await service.createSetupSession('student', 'school');

    const params = stripe.checkout.sessions.create.mock.calls[0][0] as Record<string, unknown>;
    expect(params.customer).toBeUndefined();
  });

  it('getMyPaymentMethod reports card brand/last4 live from Stripe, without persisting them locally', async () => {
    const tx = mockTx({ findUnique: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_1' }) });
    const stripe = {
      customers: {
        retrieve: jest.fn().mockResolvedValue({ invoice_settings: { default_payment_method: { card: { brand: 'visa', last4: '4242' } } } }),
      },
    };
    const { service } = makeService(stripe, tx);

    const result = await service.getMyPaymentMethod('student', 'school');

    expect(result).toEqual({ hasSavedPaymentMethod: true, brand: 'visa', last4: '4242' });
  });

  it('getMyPaymentMethod reports false without ever calling Stripe when nothing is saved', async () => {
    const tx = mockTx({ findUnique: jest.fn().mockResolvedValue(null) });
    const stripe = { customers: { retrieve: jest.fn() } };
    const { service } = makeService(stripe, tx);

    const result = await service.getMyPaymentMethod('student', 'school');

    expect(result).toEqual({ hasSavedPaymentMethod: false });
    expect(stripe.customers.retrieve).not.toHaveBeenCalled();
  });

  it('chargeOffSession throws NoSavedPaymentMethodError when the Student never saved a card', async () => {
    const tx = mockTx({ findUnique: jest.fn().mockResolvedValue(null) });
    const { service } = makeService({}, tx);

    await expect(service.chargeOffSession('student', 'school', 1000, 'usd', 'Late-cancellation fee')).rejects.toBeInstanceOf(
      NoSavedPaymentMethodError,
    );
  });

  it('chargeOffSession confirms an off-session PaymentIntent against the saved default payment method', async () => {
    const tx = mockTx({ findUnique: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_1' }) });
    const stripe = {
      customers: { retrieve: jest.fn().mockResolvedValue({ invoice_settings: { default_payment_method: 'pm_1' } }) },
      paymentIntents: { create: jest.fn().mockResolvedValue({ id: 'pi_1', status: 'succeeded' }) },
    };
    const { service } = makeService(stripe, tx);

    const result = await service.chargeOffSession('student', 'school', 1500, 'usd', 'Late-cancellation fee');

    expect(result).toEqual({ succeeded: true, paymentIntentId: 'pi_1' });
    const params = stripe.paymentIntents.create.mock.calls[0][0];
    expect(params).toMatchObject({ amount: 1500, currency: 'usd', customer: 'cus_1', payment_method: 'pm_1', off_session: true, confirm: true });
    expect(params).not.toHaveProperty('metadata');
  });

  it('chargeOffSession keeps a card surcharge in the PaymentIntent metadata, as charge() does', async () => {
    const tx = mockTx({ findUnique: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_1' }) });
    const stripe = {
      customers: { retrieve: jest.fn().mockResolvedValue({ invoice_settings: { default_payment_method: 'pm_1' } }) },
      paymentIntents: { create: jest.fn().mockResolvedValue({ id: 'pi_1', status: 'succeeded' }) },
    };
    const { service } = makeService(stripe, tx);

    await service.chargeOffSession('student', 'school', 1530, 'usd', 'Pack', undefined, 30);

    expect(stripe.paymentIntents.create.mock.calls[0][0]).toMatchObject({ amount: 1530, metadata: { surchargeAmount: '30' } });
  });

  it('chargeOffSession reports a declined card as succeeded:false, not a thrown error', async () => {
    const tx = mockTx({ findUnique: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_1' }) });
    const StripeErrors = jest.requireActual('stripe').errors;
    const declined = new StripeErrors.StripeCardError({ message: 'Your card was declined.', payment_intent: { id: 'pi_declined' } });
    const stripe = {
      customers: { retrieve: jest.fn().mockResolvedValue({ invoice_settings: { default_payment_method: 'pm_1' } }) },
      paymentIntents: { create: jest.fn().mockRejectedValue(declined) },
    };
    const { service } = makeService(stripe, tx);

    const result = await service.chargeOffSession('student', 'school', 1500, 'usd', 'Late-cancellation fee');

    expect(result).toEqual({ succeeded: false, paymentIntentId: 'pi_declined' });
  });
});

/**
 * Decision 243 (Track B Slice 4b) — `MembershipsService.purchase()`'s
 * `useHostedCheckout` branch calls this instead of `charge()` above: apps/
 * student has no Stripe Elements/PaymentSheet SDK, so a bare PaymentIntent
 * `clientSecret` is unusable there. Same "e2e tests cover everything up to
 * the first real Stripe call; these unit tests cover the Stripe-calling code
 * itself" split as the Decision 234 block above.
 */
describe('PaymentsService — createPurchaseCheckoutSession (Decision 243)', () => {
  function makeService(stripe: Record<string, unknown>) {
    const scopedClient = jest.fn().mockReturnValue(stripe);
    const service = new PaymentsService(null as never, null as never, null as never, null as never, { scopedClient } as never, null as never, null as never, null as never);
    jest
      .spyOn(service as unknown as { resolveStripePaymentAccount: () => Promise<unknown> }, 'resolveStripePaymentAccount')
      .mockResolvedValue({ stripeConnectedAccountId: 'acct_school' });
    return { service, scopedClient };
  }

  /** A `mode: 'payment'` Session as this API version (2026-08-26.dahlia)
   * returns it from create: no PaymentIntent until the member pays (seen on
   * the real test-mode sandbox, 30 Oct 2026). */
  function createdSession(id: string, metadata: Record<string, string>) {
    return { id, object: 'checkout.session', mode: 'payment', status: 'open', url: `https://checkout.stripe.com/c/pay/${id}`, payment_intent: null, metadata };
  }

  it('creates a mode:payment Checkout Session with inline price_data, the Transaction id in its metadata and its PaymentIntent\'s, and returns its hosted URL', async () => {
    const stripe = {
      checkout: { sessions: { create: jest.fn().mockResolvedValue(createdSession('cs_test_1', { transactionId: 'tx-1' })) } },
    };
    const { service, scopedClient } = makeService(stripe);

    const result = await service.createPurchaseCheckoutSession('student', 'school', 'tx-1', 3000, 'gbp', '5-Class Pack');

    expect(scopedClient).toHaveBeenCalledWith('acct_school');
    expect(result).toEqual({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const params = stripe.checkout.sessions.create.mock.calls[0][0] as Record<string, unknown>;
    expect(params).toMatchObject({
      mode: 'payment',
      success_url: 'ultm8-student://membership-purchase/complete',
      cancel_url: 'ultm8-student://membership-purchase/cancel',
      metadata: { transactionId: 'tx-1' },
      payment_intent_data: { metadata: { transactionId: 'tx-1' } },
    });
    expect(params).not.toHaveProperty('expand');
    expect(params.line_items).toEqual([
      { price_data: { currency: 'gbp', unit_amount: 3000, product_data: { name: '5-Class Pack' } }, quantity: 1 },
    ]);
  });

  it('keeps the surcharge beside the Transaction id in the PaymentIntent metadata, as its own line', async () => {
    const stripe = {
      checkout: { sessions: { create: jest.fn().mockResolvedValue(createdSession('cs_test_2', { transactionId: 'tx-2' })) } },
    };
    const { service } = makeService(stripe);

    await service.createPurchaseCheckoutSession('student', 'school', 'tx-2', 1000, 'usd', 'Trial', 'key-2', 30, 'charge-payment');

    const [params, options] = stripe.checkout.sessions.create.mock.calls[0] as unknown as [Record<string, unknown>, unknown];
    expect(options).toEqual({ idempotencyKey: 'key-2' });
    expect(params).toMatchObject({
      payment_intent_data: { metadata: { transactionId: 'tx-2', surchargeAmount: '30' } },
      success_url: 'ultm8-student://charge-payment/complete',
    });
    expect((params.line_items as unknown[])[1]).toEqual({ price_data: { currency: 'usd', unit_amount: 30, product_data: { name: 'Card surcharge' } }, quantity: 1 });
  });

  it('throws if Stripe returns no hosted URL', async () => {
    const stripe = {
      checkout: { sessions: { create: jest.fn().mockResolvedValue({ ...createdSession('cs_test_3', {}), url: null }) } },
    };
    const { service } = makeService(stripe);

    await expect(service.createPurchaseCheckoutSession('student', 'school', 'tx-3', 1000, 'usd', 'Trial')).rejects.toThrow('did not return a hosted URL');
  });

  it('checkoutTransactionId gives one stable UUID per idempotency key, and another for another key', () => {
    const a = checkoutTransactionId('membership-purchase-checkout-s-p-abc-1');
    expect(a).toBe(checkoutTransactionId('membership-purchase-checkout-s-p-abc-1'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(checkoutTransactionId('membership-purchase-checkout-s-p-abc-2')).not.toBe(a);
  });
});

/**
 * Decision 236's own follow-up — MembershipsService.purchase()'s
 * payWithSavedCard branch calls this when a saved-card charge already
 * succeeded but the Membership it was paying for then lost the
 * two-simultaneous-Active-Membership race, so the just-captured money has
 * to be refunded explicitly (see refundOffSessionCharge's own header
 * comment for the full account of why this codebase's usual async-webhook
 * collision handling doesn't apply here).
 */
describe('PaymentsService — refundOffSessionCharge (Decision 236)', () => {
  it('refunds the given PaymentIntent on the School\'s own connected account', async () => {
    const stripe = { refunds: { create: jest.fn().mockResolvedValue({ id: 're_1' }) } };
    const scopedClient = jest.fn().mockReturnValue(stripe);
    const service = new PaymentsService(null as never, null as never, null as never, null as never, { scopedClient } as never, null as never, null as never, null as never);
    jest
      .spyOn(service as unknown as { resolveStripePaymentAccount: () => Promise<unknown> }, 'resolveStripePaymentAccount')
      .mockResolvedValue({ stripeConnectedAccountId: 'acct_school' });

    await service.refundOffSessionCharge('student', 'school', 'pi_1');

    expect(scopedClient).toHaveBeenCalledWith('acct_school');
    expect(stripe.refunds.create).toHaveBeenCalledWith({ payment_intent: 'pi_1' });
  });
});

