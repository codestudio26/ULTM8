/**
 * Decision 407 (backlog 3.22) over real HTTP and the real webhook processor:
 * the Franchise Owner connects Stripe (Connected / Action needed / Not
 * connected); the School Owner adds a card through Stripe's hosted form, saved
 * to a kept Customer on the Franchise's connected account and made the default
 * payment method of the School's franchise-fee subscription; a failed charge
 * tells the School Owner to update the card (Stripe retries, nothing is
 * locked) and shows as a Failed charge, which the paid retry turns Successful;
 * both sides see the School's charges. Only that Franchise's Owner connects
 * Stripe; only the School's Owner/Manager adds the card or sees its charges.
 *
 * Stripe is faked (no live key in CI or this sandbox): the fake records every
 * call, so the tests check what WOULD be sent to Stripe, the same approach as
 * franchise-review-fixes.e2e-spec.ts.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_JOBS, JWT_ACCESS_SECRET.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';
import { FranchiseFeeBillingService } from '../src/franchise-fees/franchise-fee-billing.service';
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';
import { PromotionFeeService } from '../src/ranks/promotion-fee.service';
import { CHARGEBACK_PATTERN_RESTRICTION_QUEUE, NOTIFICATION_FANOUT_QUEUE, WAITLIST_CASCADE_PROCESSING_QUEUE } from '../src/jobs/queue.constants';

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.DATABASE_URL_JOBS && process.env.JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[franchise-card-billing.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_JOBS / JWT_ACCESS_SECRET not set.');
}

type Call = { account: string; params: Record<string, unknown>; id?: string; opts?: unknown };

/** Records every Stripe call; `accountState` sets what accounts.retrieve says. */
function makeFakeStripe() {
  const calls = {
    customerCreate: [] as Call[],
    customerUpdate: [] as Call[],
    sessionCreate: [] as Call[],
    subscriptionCreate: [] as Call[],
    subscriptionUpdate: [] as Call[],
    accountsCreate: [] as unknown[],
    accountLinks: [] as unknown[],
  };
  const state = {
    account: { details_submitted: false, charges_enabled: false },
    sessions: new Map<string, Record<string, unknown>>(),
    subscriptionCustomers: new Map<string, string>(),
    invoice: null as Record<string, unknown> | null,
    customerDefaultCard: null as null | { brand: string; last4: string },
  };
  const fake = {
    scopedClient: jest.fn((account: string) => ({
      customers: {
        create: jest.fn(async (params: Record<string, unknown>, opts: unknown) => {
          calls.customerCreate.push({ account, params, opts });
          return { id: `cus_fake_${randomUUID()}` };
        }),
        update: jest.fn(async (id: string, params: Record<string, unknown>) => {
          calls.customerUpdate.push({ account, id, params });
          return { id };
        }),
        retrieve: jest.fn(async (id: string) => ({
          id,
          invoice_settings: { default_payment_method: state.customerDefaultCard ? { id: 'pm_fake', card: state.customerDefaultCard } : null },
        })),
      },
      checkout: {
        sessions: {
          create: jest.fn(async (params: Record<string, unknown>) => {
            calls.sessionCreate.push({ account, params });
            const id = `cs_fake_${randomUUID()}`;
            state.sessions.set(id, { id, ...params, setup_intent: `seti_fake_${randomUUID()}` });
            return { id, url: `https://checkout.stripe.test/${id}` };
          }),
          retrieve: jest.fn(async (id: string) => state.sessions.get(id)),
        },
      },
      setupIntents: { retrieve: jest.fn(async (id: string) => ({ id, payment_method: 'pm_new_card' })) },
      subscriptions: {
        retrieve: jest.fn(async (id: string) => ({ id, customer: state.subscriptionCustomers.get(id) ?? 'cus_unknown' })),
        update: jest.fn(async (id: string, params: Record<string, unknown>) => {
          calls.subscriptionUpdate.push({ account, id, params });
          return { id };
        }),
        create: jest.fn(async (params: Record<string, unknown>, opts: unknown) => {
          calls.subscriptionCreate.push({ account, params, opts });
          return { id: `sub_fake_${randomUUID()}`, customer: params.customer };
        }),
      },
      products: { create: jest.fn(async () => ({ id: `prod_fake_${randomUUID()}` })) },
      invoices: { retrieve: jest.fn(async () => state.invoice) },
    })),
    platformClient: jest.fn(() => ({
      accounts: {
        retrieve: jest.fn(async (id: string) => ({ id, ...state.account })),
        create: jest.fn(async (params: unknown) => {
          calls.accountsCreate.push(params);
          return { id: `acct_fake_${randomUUID()}` };
        }),
      },
      accountLinks: {
        create: jest.fn(async (params: unknown) => {
          calls.accountLinks.push(params);
          return { url: 'https://connect.stripe.test/onboarding' };
        }),
      },
    })),
    constructWebhookEvent: jest.fn(),
  };
  return { fake, calls, state };
}

describeIfDb('Franchise fee paid by card (Decision 407)', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const stripe = makeFakeStripe();
  const queue = { addBulk: jest.fn().mockResolvedValue(undefined), add: jest.fn().mockResolvedValue(undefined) };
  let app: INestApplication;
  let webhook: StripeWebhookProcessingProcessor;
  let billing: FranchiseFeeBillingService;
  const env = { portal: process.env.PORTAL_BASE_URL, ret: process.env.STRIPE_CONNECT_RETURN_URL, refresh: process.env.STRIPE_CONNECT_REFRESH_URL };

  const franchiseIds: string[] = [];
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const eventIds: string[] = [];

  beforeAll(async () => {
    process.env.PORTAL_BASE_URL = 'https://portal.example.test/';
    process.env.STRIPE_CONNECT_RETURN_URL = 'https://portal.example.test/payments/connect/return';
    process.env.STRIPE_CONNECT_REFRESH_URL = 'https://portal.example.test/payments/connect/refresh';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(stripe.fake).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    const jobsRef = await Test.createTestingModule({
      providers: [
        StripeWebhookProcessingProcessor,
        FranchiseFeeBillingService,
        PrismaJobsService,
        { provide: StripeClientService, useValue: stripe.fake },
        { provide: getQueueToken(NOTIFICATION_FANOUT_QUEUE), useValue: queue },
        { provide: getQueueToken(CHARGEBACK_PATTERN_RESTRICTION_QUEUE), useValue: queue },
        { provide: getQueueToken(WAITLIST_CASCADE_PROCESSING_QUEUE), useValue: queue },
        // None of these pay a promotion fee (backlog 3.6 step 6).
        { provide: PromotionFeeService, useValue: { settlePaidCharges: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    webhook = jobsRef.get(StripeWebhookProcessingProcessor);
    billing = jobsRef.get(FranchiseFeeBillingService);
  });

  afterAll(async () => {
    process.env.PORTAL_BASE_URL = env.portal;
    process.env.STRIPE_CONNECT_RETURN_URL = env.ret;
    process.env.STRIPE_CONNECT_REFRESH_URL = env.refresh;
    await superuser.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await superuser.franchiseFeeCharge.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.paymentAccount.deleteMany({ where: { franchiseId: { in: franchiseIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  async function mkUser(label: string) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `franchise-card-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Card',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function grant(role: 'FRANCHISE_OWNER' | 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'BRANCH_STAFF', scope: { franchiseId?: string; schoolId?: string }) {
    const user = await mkUser(role.toLowerCase());
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, ...scope } });
    const token = jwt.sign({
      sub: user.id,
      email: user.email,
      grants: [{ role, franchiseId: scope.franchiseId ?? null, schoolId: scope.schoolId ?? null, branchId: null }],
    });
    return { user, token };
  }

  /** A FLAT Franchise with its owner, optionally with a connected Stripe account, and one member School with its owner. */
  async function seed(opts: { connected?: boolean; school?: Record<string, unknown> } = {}) {
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'Card Franchise', feeModel: 'FLAT', flatFeeAmount: 5000 } });
    franchiseIds.push(franchise.id);
    const fOwner = await grant('FRANCHISE_OWNER', { franchiseId: franchise.id });
    const connectedAccountId = opts.connected === false ? null : `acct_fake_${randomUUID()}`;
    const account = connectedAccountId
      ? await superuser.paymentAccount.create({
          data: { id: randomUUID(), franchiseId: franchise.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: connectedAccountId },
        })
      : null;
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Card School', franchiseId: franchise.id, ...opts.school } });
    schoolIds.push(school.id);
    const sOwner = await grant('SCHOOL_OWNER_MANAGER', { schoolId: school.id });
    return { franchise, fOwner, connectedAccountId, account, school, sOwner };
  }

  const http = () => request(app.getHttpServer());
  const get = (path: string, token: string) => http().get(path).set('Authorization', `Bearer ${token}`);
  const post = (path: string, token: string, body: object = {}) => http().post(path).set('Authorization', `Bearer ${token}`).send(body);

  function job(eventType: string, objectId: string, stripeAccountId: string) {
    const stripeEventId = `evt_card_${randomUUID()}`;
    eventIds.push(stripeEventId);
    return { data: { stripeEventId, eventType, objectId, stripeAccountId }, attemptsMade: 1, opts: { attempts: 3 } } as never;
  }

  describe('Franchise Owner connects Stripe', () => {
    it('Not connected, then Action needed, then Connected', async () => {
      const { franchise, fOwner } = await seed({ connected: false });
      const statusUrl = `/v1/franchises/${franchise.id}/payment-account/connect-status`;
      expect((await get(statusUrl, fOwner.token)).body).toEqual({ status: 'NOT_CONNECTED' });

      const created = await post(`/v1/franchises/${franchise.id}/payment-accounts`, fOwner.token, { provider: 'STRIPE', accountTitle: 'Card Franchise', country: 'GB' });
      expect(created.status).toBe(201);
      const onboard = await post(`/v1/payment-accounts/${created.body.id}/connect/onboard`, fOwner.token);
      expect(onboard.status).toBe(201);
      expect(onboard.body.onboardingUrl).toBe('https://connect.stripe.test/onboarding');

      stripe.state.account = { details_submitted: true, charges_enabled: false };
      expect((await get(statusUrl, fOwner.token)).body).toEqual({ status: 'ACTION_NEEDED' });
      stripe.state.account = { details_submitted: true, charges_enabled: true };
      expect((await get(statusUrl, fOwner.token)).body).toEqual({ status: 'CONNECTED' });
    });

    it("only that Franchise's Owner — not another Franchise's Owner, not a member School's Owner", async () => {
      const { franchise, account, sOwner } = await seed();
      const other = await seed();
      for (const token of [other.fOwner.token, sOwner.token]) {
        expect((await get(`/v1/franchises/${franchise.id}/payment-account/connect-status`, token)).status).toBe(404);
        expect((await post(`/v1/franchises/${franchise.id}/payment-accounts`, token, { provider: 'STRIPE', accountTitle: 'x', country: 'GB' })).status).toBe(404);
        expect((await post(`/v1/payment-accounts/${account!.id}/connect/onboard`, token)).status).toBe(404);
      }
    });
  });

  describe('School Owner adds a card', () => {
    it('opens Stripe-hosted Checkout (setup mode) for a kept Customer on the Franchise account, reused next time', async () => {
      const { franchise, school, sOwner, connectedAccountId } = await seed();
      stripe.calls.customerCreate.length = 0;
      stripe.calls.sessionCreate.length = 0;

      const first = await post(`/v1/schools/${school.id}/franchise-fee/card/setup-session`, sOwner.token);
      expect(first.status).toBe(201);
      expect(first.body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);

      const stored = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
      expect(stored.stripeFranchiseFeeCustomerId).toMatch(/^cus_fake_/);
      expect(stripe.calls.customerCreate).toHaveLength(1);
      expect(stripe.calls.customerCreate[0].account).toBe(connectedAccountId);
      expect(stripe.calls.customerCreate[0].params.metadata).toEqual({ schoolId: school.id, franchiseId: franchise.id });

      const session = stripe.calls.sessionCreate[0];
      expect(session.account).toBe(connectedAccountId);
      expect(session.params).toMatchObject({
        mode: 'setup',
        customer: stored.stripeFranchiseFeeCustomerId,
        payment_method_types: ['card'],
        success_url: 'https://portal.example.test/school?franchiseCard=added',
        cancel_url: 'https://portal.example.test/school?franchiseCard=cancelled',
        metadata: { purpose: 'FRANCHISE_FEE_CARD', schoolId: school.id, franchiseId: franchise.id },
      });

      const again = await post(`/v1/schools/${school.id}/franchise-fee/card/setup-session`, sOwner.token);
      expect(again.status).toBe(201);
      expect(stripe.calls.customerCreate).toHaveLength(1);
      expect(stripe.calls.sessionCreate[1].params.customer).toBe(stored.stripeFranchiseFeeCustomerId);
    });

    it('a School already billed before cards existed keeps its subscription: that Customer is adopted', async () => {
      const subscriptionId = `sub_old_${randomUUID()}`;
      stripe.state.subscriptionCustomers.set(subscriptionId, 'cus_throwaway_old');
      const { school, sOwner } = await seed({ school: { stripeFranchiseFeeSubscriptionId: subscriptionId, franchiseFeeSubscriptionStatus: 'PAST_DUE' } });
      stripe.calls.customerCreate.length = 0;

      expect((await post(`/v1/schools/${school.id}/franchise-fee/card/setup-session`, sOwner.token)).status).toBe(201);
      expect(stripe.calls.customerCreate).toHaveLength(0);
      expect((await superuser.school.findUniqueOrThrow({ where: { id: school.id } })).stripeFranchiseFeeCustomerId).toBe('cus_throwaway_old');
    });

    it("only the School's Owner/Manager — not its coach or Branch Staff, another School's Owner, or the Franchise Owner", async () => {
      const { school, fOwner } = await seed();
      const coach = await grant('INSTRUCTOR', { schoolId: school.id });
      const staff = await grant('BRANCH_STAFF', { schoolId: school.id });
      const other = await seed();
      for (const token of [coach.token, staff.token, other.sOwner.token, fOwner.token]) {
        expect((await post(`/v1/schools/${school.id}/franchise-fee/card/setup-session`, token)).status).toBe(403);
        expect((await get(`/v1/schools/${school.id}/franchise-fee/card`, token)).status).toBe(403);
      }
      expect((await superuser.school.findUniqueOrThrow({ where: { id: school.id } })).stripeFranchiseFeeCustomerId).toBeNull();
    });

    it('needs a Franchise, and a Franchise that has connected Stripe', async () => {
      const notConnected = await seed({ connected: false });
      const res = await post(`/v1/schools/${notConnected.school.id}/franchise-fee/card/setup-session`, notConnected.sOwner.token);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain("hasn't connected Stripe yet");
      expect((await get(`/v1/schools/${notConnected.school.id}/franchise-fee/card`, notConnected.sOwner.token)).body).toEqual({ canAddCard: false, hasCard: false });

      const independent = await seed({ school: { franchiseId: null } });
      const res2 = await post(`/v1/schools/${independent.school.id}/franchise-fee/card/setup-session`, independent.sOwner.token);
      expect(res2.status).toBe(400);
      expect(JSON.stringify(res2.body)).toContain('not part of a Franchise');
    });

    it('the saved card shows as brand and last 4 digits', async () => {
      const { school, sOwner } = await seed({ school: { stripeFranchiseFeeCustomerId: `cus_fake_${randomUUID()}` } });
      stripe.state.customerDefaultCard = { brand: 'visa', last4: '4242' };
      const res = await get(`/v1/schools/${school.id}/franchise-fee/card`, sOwner.token);
      stripe.state.customerDefaultCard = null;
      expect(res.body).toEqual({ canAddCard: true, hasCard: true, brand: 'visa', last4: '4242' });
    });
  });

  describe('the saved card becomes the default payment method', () => {
    it('checkout.session.completed sets it on the kept Customer and on the existing subscription', async () => {
      const subscriptionId = `sub_cur_${randomUUID()}`;
      const { school, sOwner, connectedAccountId } = await seed({ school: { stripeFranchiseFeeSubscriptionId: subscriptionId, franchiseFeeSubscriptionStatus: 'ACTIVE' } });
      stripe.state.subscriptionCustomers.set(subscriptionId, `cus_sub_${randomUUID()}`);
      const res = await post(`/v1/schools/${school.id}/franchise-fee/card/setup-session`, sOwner.token);
      const sessionId = String(res.body.checkoutUrl).split('/').pop()!;
      const customerId = (await superuser.school.findUniqueOrThrow({ where: { id: school.id } })).stripeFranchiseFeeCustomerId;
      stripe.calls.customerUpdate.length = 0;
      stripe.calls.subscriptionUpdate.length = 0;

      await webhook.process(job('checkout.session.completed', sessionId, connectedAccountId!));

      expect(stripe.calls.customerUpdate).toEqual([
        { account: connectedAccountId, id: customerId, params: { invoice_settings: { default_payment_method: 'pm_new_card' } } },
      ]);
      expect(stripe.calls.subscriptionUpdate).toEqual([{ account: connectedAccountId, id: subscriptionId, params: { default_payment_method: 'pm_new_card' } }]);
      // No Student card row is written for a School's card.
      expect(await superuser.studentPaymentMethod.count({ where: { schoolId: school.id } })).toBe(0);
    });

    it('a session that no longer matches the School (it left the Franchise) is not applied', async () => {
      const { school, sOwner, connectedAccountId } = await seed();
      const res = await post(`/v1/schools/${school.id}/franchise-fee/card/setup-session`, sOwner.token);
      const sessionId = String(res.body.checkoutUrl).split('/').pop()!;
      const left = await post(`/v1/schools/${school.id}/leave-franchise`, sOwner.token);
      expect(left.status).toBe(201);
      expect((await superuser.school.findUniqueOrThrow({ where: { id: school.id } })).stripeFranchiseFeeCustomerId).toBeNull();
      stripe.calls.customerUpdate.length = 0;

      await webhook.process(job('checkout.session.completed', sessionId, connectedAccountId!));
      expect(stripe.calls.customerUpdate).toHaveLength(0);
    });

    it('a new subscription is created on the kept Customer, so it uses the card', async () => {
      const customerId = `cus_kept_${randomUUID()}`;
      const { franchise, school } = await seed({ school: { stripeFranchiseFeeCustomerId: customerId } });
      const full = await superuser.franchise.findUniqueOrThrow({ where: { id: franchise.id }, include: { paymentAccount: true } });
      stripe.calls.customerCreate.length = 0;
      stripe.calls.subscriptionCreate.length = 0;

      await billing.ensureSubscription(full, await superuser.school.findUniqueOrThrow({ where: { id: school.id } }));

      expect(stripe.calls.customerCreate).toHaveLength(0);
      expect(stripe.calls.subscriptionCreate[0].params.customer).toBe(customerId);
    });

    it('the monthly job keeps the Customer it creates, with the subscription idempotency key unchanged by that write', async () => {
      const { franchise, school } = await seed();
      const full = await superuser.franchise.findUniqueOrThrow({ where: { id: franchise.id }, include: { paymentAccount: true } });
      const before = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
      stripe.calls.subscriptionCreate.length = 0;

      await billing.ensureSubscription(full, before);

      const after = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
      expect(after.stripeFranchiseFeeCustomerId).toMatch(/^cus_fake_/);
      expect(stripe.calls.subscriptionCreate[0].params.customer).toBe(after.stripeFranchiseFeeCustomerId);
      expect((stripe.calls.subscriptionCreate[0].opts as { idempotencyKey: string }).idempotencyKey).toContain(String(before.updatedAt.getTime()));
    });
  });

  describe('a failed charge', () => {
    function flatInvoice(subscriptionId: string, overrides: Record<string, unknown> = {}) {
      return {
        id: `in_fake_${randomUUID()}`,
        amount_due: 5000,
        amount_paid: 0,
        attempt_count: 1,
        currency: 'usd',
        billing_reason: 'subscription_cycle',
        period_start: Date.parse('2026-11-01T00:00:00Z') / 1000,
        period_end: Date.parse('2026-12-01T00:00:00Z') / 1000,
        parent: { subscription_details: { subscription: subscriptionId } },
        payments: { data: [] },
        ...overrides,
      };
    }

    it('tells the School Owner to update the card, records a Failed charge, locks nothing; the retry that pays turns it Successful', async () => {
      const subscriptionId = `sub_fail_${randomUUID()}`;
      const { school, sOwner, fOwner, franchise, connectedAccountId } = await seed({
        school: { stripeFranchiseFeeSubscriptionId: subscriptionId, franchiseFeeSubscriptionStatus: 'ACTIVE' },
      });
      const invoice = flatInvoice(subscriptionId);
      stripe.state.invoice = invoice;
      queue.addBulk.mockClear();

      await webhook.process(job('invoice.payment_failed', invoice.id, connectedAccountId!));

      const failed = await superuser.franchiseFeeCharge.findUniqueOrThrow({ where: { stripeInvoiceId: invoice.id } });
      expect(failed).toMatchObject({ schoolId: school.id, franchiseId: franchise.id, status: 'FAILED', amount: 5000, currency: 'USD', feeBasisSnapshot: 'FLAT' });
      expect((await superuser.school.findUniqueOrThrow({ where: { id: school.id } })).franchiseFeeSubscriptionStatus).toBe('PAST_DUE');

      const notices = queue.addBulk.mock.calls.flatMap(([jobs]) => jobs as Array<{ data: Record<string, unknown> }>).map((j) => j.data);
      expect(notices).toEqual([
        expect.objectContaining({
          userId: sOwner.user.id,
          title: 'Franchise fee payment failed',
          body: "The franchise fee of 50.00 USD for Card School couldn't be charged. Stripe will try again. Add or update the card on the School page.",
          schoolId: school.id,
          targetType: 'SCHOOL',
          targetId: school.id,
        }),
      ]);

      // Nothing is locked: the School Owner still works normally, e.g. reads the School.
      expect((await get(`/v1/schools/${school.id}`, sOwner.token)).status).toBe(200);

      // Both sides see the failed charge.
      const schoolSide = await get(`/v1/schools/${school.id}/fee-charges`, sOwner.token);
      expect(schoolSide.body.items).toEqual([expect.objectContaining({ id: failed.id, status: 'FAILED', amount: 5000 })]);
      const franchiseSide = await get(`/v1/franchises/${franchise.id}/fee-charges`, fOwner.token);
      expect(franchiseSide.body.items).toEqual([expect.objectContaining({ id: failed.id, schoolId: school.id, status: 'FAILED' })]);

      // Stripe's retry pays it: the same row, now Successful.
      stripe.state.invoice = { ...invoice, amount_paid: 5000, attempt_count: 2 };
      await webhook.process(job('invoice.paid', invoice.id, connectedAccountId!));
      const rows = await superuser.franchiseFeeCharge.findMany({ where: { schoolId: school.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: failed.id, status: 'SUCCESSFUL', amount: 5000 });
      expect((await superuser.school.findUniqueOrThrow({ where: { id: school.id } })).franchiseFeeSubscriptionStatus).toBe('ACTIVE');

      // A late failure notice for the already-paid invoice changes nothing.
      queue.addBulk.mockClear();
      stripe.state.invoice = invoice;
      await webhook.process(job('invoice.payment_failed', invoice.id, connectedAccountId!));
      expect((await superuser.franchiseFeeCharge.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe('SUCCESSFUL');
      expect((await superuser.school.findUniqueOrThrow({ where: { id: school.id } })).franchiseFeeSubscriptionStatus).toBe('ACTIVE');
      expect(queue.addBulk).not.toHaveBeenCalled();
    });

    it('a second failed attempt sends a second notice, never two for the same attempt', async () => {
      const subscriptionId = `sub_fail2_${randomUUID()}`;
      const { connectedAccountId } = await seed({ school: { stripeFranchiseFeeSubscriptionId: subscriptionId, franchiseFeeSubscriptionStatus: 'ACTIVE' } });
      const invoice = flatInvoice(subscriptionId);
      queue.addBulk.mockClear();
      stripe.state.invoice = invoice;
      await webhook.process(job('invoice.payment_failed', invoice.id, connectedAccountId!));
      stripe.state.invoice = { ...invoice, attempt_count: 2 };
      await webhook.process(job('invoice.payment_failed', invoice.id, connectedAccountId!));
      const ids = queue.addBulk.mock.calls.flatMap(([jobs]) => jobs as Array<{ data: { notificationId: string } }>).map((j) => j.data.notificationId);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
      expect(await superuser.franchiseFeeCharge.count({ where: { stripeInvoiceId: invoice.id } })).toBe(1);
    });
  });

  describe("the School's charges", () => {
    it("only the School's Owner/Manager sees them on the School side; another Franchise's Owner sees none", async () => {
      const { school, franchise, account } = await seed();
      await superuser.franchiseFeeCharge.create({
        data: {
          id: randomUUID(),
          franchiseId: franchise.id,
          schoolId: school.id,
          franchisePaymentAccountId: account!.id,
          billingPeriodStart: new Date('2026-10-01'),
          billingPeriodEnd: new Date('2026-11-01'),
          feeBasisSnapshot: 'FLAT',
          amount: 5000,
          currency: 'USD',
          status: 'SUCCESSFUL',
          stripeInvoiceId: `in_fixture_${randomUUID()}`,
        },
      });
      const coach = await grant('INSTRUCTOR', { schoolId: school.id });
      const other = await seed();
      expect((await get(`/v1/schools/${school.id}/fee-charges`, coach.token)).status).toBe(403);
      expect((await get(`/v1/schools/${school.id}/fee-charges`, other.sOwner.token)).status).toBe(403);
      const otherFranchise = await get(`/v1/franchises/${franchise.id}/fee-charges`, other.fOwner.token);
      expect(otherFranchise.status).toBe(200);
      expect(otherFranchise.body.items).toEqual([]);
    });
  });
});
