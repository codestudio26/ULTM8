import { PaymentsService } from './payments.service';

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
      create: jest.fn().mockResolvedValue({ id: 'sub_1', latest_invoice: { payment_intent: { id: 'pi_2', client_secret: 'secret_2' } } }),
    },
  };
  const scopedClient = jest.fn().mockReturnValue(stripe);
  const service = new PaymentsService(
    null as never,
    null as never,
    null as never,
    null as never,
    { scopedClient } as never,
    null as never,
  );
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
});
