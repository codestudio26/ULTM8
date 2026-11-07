/**
 * Decision 441 item 6 over real HTTP, Postgres and the real webhook processor:
 * the School owner connects Stripe from the portal (the existing
 * payment-account and onboarding endpoints), and the setup checklist ticks
 * "Connect Stripe" only once Stripe confirms the connected account is ready
 * (details_submitted and charges_enabled), not as soon as onboarding starts.
 * Readiness is saved on PaymentAccount.stripeAccountReady by the
 * account.updated webhook (through the narrow SECURITY DEFINER
 * set_stripe_account_ready(), ultm8_jobs keeps read-only access to the table)
 * and by the School's connect-status read when the owner comes back from
 * Stripe.
 *
 * Stripe is faked (no live key in CI): `accountState` sets what
 * accounts.retrieve says about each connected account.
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
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';
import { PromotionFeeService } from '../src/ranks/promotion-fee.service';
import { CHARGEBACK_PATTERN_RESTRICTION_QUEUE, NOTIFICATION_FANOUT_QUEUE, WAITLIST_CASCADE_PROCESSING_QUEUE } from '../src/jobs/queue.constants';

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.DATABASE_URL_JOBS && process.env.JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[stripe-connect-ready.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_JOBS / JWT_ACCESS_SECRET not set.');
}

type AccountState = { details_submitted: boolean; charges_enabled: boolean };

describeIfDb('Connect Stripe from the portal; the checklist ticks once Stripe says the account is ready (Decision 441 item 6)', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jobsDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_JOBS });
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const accountState = new Map<string, AccountState>();
  const retrieved: string[] = [];
  const platform = {
    accounts: {
      retrieve: jest.fn(async (id: string) => {
        retrieved.push(id);
        return { id, ...(accountState.get(id) ?? { details_submitted: false, charges_enabled: false }), capabilities: { card_payments: 'inactive' } };
      }),
      create: jest.fn(async () => ({ id: `acct_ready_${randomUUID()}` })),
      update: jest.fn(),
      del: jest.fn(),
    },
    accountLinks: { create: jest.fn(async () => ({ url: 'https://connect.stripe.test/onboarding' })) },
  };
  const stripeFake = { platformClient: jest.fn(() => platform), scopedClient: jest.fn(), constructWebhookEvent: jest.fn() };
  const queue = { addBulk: jest.fn().mockResolvedValue(undefined), add: jest.fn().mockResolvedValue(undefined) };
  let app: INestApplication;
  let webhook: StripeWebhookProcessingProcessor;
  const env = { ret: process.env.STRIPE_CONNECT_RETURN_URL, refresh: process.env.STRIPE_CONNECT_REFRESH_URL };

  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const eventIds: string[] = [];

  beforeAll(async () => {
    process.env.STRIPE_CONNECT_RETURN_URL = 'https://portal.example.test/payments/connect/return';
    process.env.STRIPE_CONNECT_REFRESH_URL = 'https://portal.example.test/payments/connect/refresh';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(stripeFake).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    const jobsRef = await Test.createTestingModule({
      providers: [
        StripeWebhookProcessingProcessor,
        PrismaJobsService,
        { provide: StripeClientService, useValue: stripeFake },
        { provide: getQueueToken(NOTIFICATION_FANOUT_QUEUE), useValue: queue },
        { provide: getQueueToken(CHARGEBACK_PATTERN_RESTRICTION_QUEUE), useValue: queue },
        { provide: getQueueToken(WAITLIST_CASCADE_PROCESSING_QUEUE), useValue: queue },
        { provide: PromotionFeeService, useValue: { settlePaidCharges: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    webhook = jobsRef.get(StripeWebhookProcessingProcessor);
  });

  afterAll(async () => {
    process.env.STRIPE_CONNECT_RETURN_URL = env.ret;
    process.env.STRIPE_CONNECT_REFRESH_URL = env.refresh;
    await superuser.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await superuser.paymentAccount.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await jobsDb.$disconnect();
    await app.close();
  });

  type Role = 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR';

  async function person(role: Role, schoolId: string) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `connect-ready-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: role,
        surname: 'Ready',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId } });
    return jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId, branchId: null }] });
  }

  async function school(addressCountry: string | null = 'GB') {
    const row = await superuser.school.create({ data: { id: randomUUID(), name: `Ready School ${randomUUID().slice(0, 8)}`, addressCountry } });
    schoolIds.push(row.id);
    return { schoolId: row.id, token: await person('SCHOOL_OWNER_MANAGER', row.id) };
  }

  const http = () => request(app.getHttpServer());
  const get = (path: string, token: string) => http().get(path).set('Authorization', `Bearer ${token}`);
  const post = (path: string, token: string, body: object = {}) => http().post(path).set('Authorization', `Bearer ${token}`).send(body);

  function job(eventType: string, objectId: string, stripeAccountId?: string, stripeEventId = `evt_ready_${randomUUID()}`) {
    eventIds.push(stripeEventId);
    return { data: { stripeEventId, eventType, objectId, stripeAccountId }, attemptsMade: 1, opts: { attempts: 3 } } as never;
  }

  async function stripeStep(schoolId: string, token: string) {
    const res = await get(`/v1/schools/${schoolId}/dashboard`, token);
    expect(res.status).toBe(200);
    return res.body.setupChecklist.steps.find((s: { key: string }) => s.key === 'STRIPE')?.done as boolean | undefined;
  }

  /** The owner presses Connect Stripe: the payment account, then the onboarding link. */
  async function connect(schoolId: string, token: string) {
    const created = await post(`/v1/schools/${schoolId}/payment-accounts`, token, { provider: 'STRIPE', accountTitle: 'Card', country: 'GB' });
    expect(created.status).toBe(201);
    expect(created.body.stripeAccountReady).toBe(false);
    const onboard = await post(`/v1/payment-accounts/${created.body.id}/connect/onboard`, token);
    expect(onboard.status).toBe(201);
    expect(onboard.body.onboardingUrl).toBe('https://connect.stripe.test/onboarding');
    const account = await superuser.paymentAccount.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(account.stripeConnectedAccountId).toEqual(expect.stringMatching(/^acct_ready_/));
    return { paymentAccountId: account.id, acct: account.stripeConnectedAccountId! };
  }

  it('starting onboarding does not tick the step; account.updated saying ready does, and saying not ready unticks it', async () => {
    const { schoolId, token } = await school();
    expect(await stripeStep(schoolId, token)).toBe(false);
    expect((await get(`/v1/schools/${schoolId}/payment-account/connect-status`, token)).body).toEqual(
      expect.objectContaining({ status: 'NOT_CONNECTED', connectAvailable: true }),
    );

    const { paymentAccountId, acct } = await connect(schoolId, token);
    // Onboarding started but not finished (the rehearsal's D6).
    expect(await stripeStep(schoolId, token)).toBe(false);

    // Details sent, charges not yet enabled: still not ready.
    accountState.set(acct, { details_submitted: true, charges_enabled: false });
    await webhook.process(job('account.updated', acct, acct));
    expect((await superuser.paymentAccount.findUniqueOrThrow({ where: { id: paymentAccountId } })).stripeAccountReady).toBe(false);
    expect(await stripeStep(schoolId, token)).toBe(false);

    // Stripe confirms the account is ready.
    accountState.set(acct, { details_submitted: true, charges_enabled: true });
    const readyEventId = `evt_ready_${randomUUID()}`;
    await webhook.process(job('account.updated', acct, acct, readyEventId));
    expect((await superuser.paymentAccount.findUniqueOrThrow({ where: { id: paymentAccountId } })).stripeAccountReady).toBe(true);
    expect(await stripeStep(schoolId, token)).toBe(true);
    expect((await get(`/v1/schools/${schoolId}/payment-account`, token)).body.stripeAccountReady).toBe(true);

    // A redelivery of the same event is skipped (deduplicated).
    const before = retrieved.length;
    await webhook.process(job('account.updated', acct, acct, readyEventId));
    expect(retrieved.length).toBe(before + 1);
    expect(await superuser.processedStripeEvent.count({ where: { stripeEventId: readyEventId } })).toBe(1);

    // Stripe later asks for more details and switches charges off.
    accountState.set(acct, { details_submitted: true, charges_enabled: false });
    await webhook.process(job('account.updated', acct, acct));
    expect(await stripeStep(schoolId, token)).toBe(false);
    expect((await get(`/v1/schools/${schoolId}/payment-account/connect-status`, token)).body.status).toBe('ACTION_NEEDED');
  });

  it('the connect-status read on return from Stripe saves readiness, without waiting for the webhook', async () => {
    const { schoolId, token } = await school();
    const { paymentAccountId, acct } = await connect(schoolId, token);
    expect((await get(`/v1/schools/${schoolId}/payment-account/connect-status`, token)).body.status).toBe('ACTION_NEEDED');
    expect(await stripeStep(schoolId, token)).toBe(false);

    accountState.set(acct, { details_submitted: true, charges_enabled: true });
    const status = await get(`/v1/schools/${schoolId}/payment-account/connect-status`, token);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ status: 'CONNECTED', connectAvailable: true, connectCountries: expect.arrayContaining(['GB']) });
    expect((await superuser.paymentAccount.findUniqueOrThrow({ where: { id: paymentAccountId } })).stripeAccountReady).toBe(true);
    expect(await stripeStep(schoolId, token)).toBe(true);
  });

  // Decision 446 item 7 (stress test round 6, T-4: races.mjs R5b). Two
  // workers: the event whose read of Stripe started first finishes last.
  it('an older account.updated finishing after a newer one never overwrites it', async () => {
    const { schoolId, token } = await school();
    const { paymentAccountId, acct } = await connect(schoolId, token);
    const realRetrieve = platform.accounts.retrieve.getMockImplementation()!;
    // Event A's read: Stripe says "not ready", and the answer is slow.
    let releaseA!: () => void;
    const aAnswered = new Promise<void>((resolve) => (releaseA = resolve));
    platform.accounts.retrieve.mockImplementationOnce(async (id: string) => {
      const answer = await realRetrieve(id);
      await aAnswered;
      return answer;
    });
    const a = webhook.process(job('account.updated', acct, acct));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Meanwhile Stripe says ready, and event B is processed in full.
    accountState.set(acct, { details_submitted: true, charges_enabled: true });
    await webhook.process(job('account.updated', acct, acct));
    expect((await superuser.paymentAccount.findUniqueOrThrow({ where: { id: paymentAccountId } })).stripeAccountReady).toBe(true);
    // A finishes last with Stripe's older answer: not saved.
    releaseA();
    await a;
    expect((await superuser.paymentAccount.findUniqueOrThrow({ where: { id: paymentAccountId } })).stripeAccountReady).toBe(true);
    expect(await stripeStep(schoolId, token)).toBe(true);

    // The reverse: a newer "not ready" (Stripe switched charges off) is saved.
    accountState.set(acct, { details_submitted: true, charges_enabled: false });
    await webhook.process(job('account.updated', acct, acct));
    expect((await superuser.paymentAccount.findUniqueOrThrow({ where: { id: paymentAccountId } })).stripeAccountReady).toBe(false);
  });

  it("an account.updated that isn't about a School's connected account changes nothing", async () => {
    const { schoolId, token } = await school();
    const { paymentAccountId, acct } = await connect(schoolId, token);
    accountState.set(acct, { details_submitted: true, charges_enabled: true });

    // The platform's own account (no connected account on the event).
    await webhook.process(job('account.updated', acct));
    // An event from one connected account about another.
    await webhook.process(job('account.updated', acct, `acct_other_${randomUUID()}`));
    // A connected account no School has.
    const stranger = `acct_stranger_${randomUUID()}`;
    accountState.set(stranger, { details_submitted: true, charges_enabled: true });
    await webhook.process(job('account.updated', stranger, stranger));

    expect((await superuser.paymentAccount.findUniqueOrThrow({ where: { id: paymentAccountId } })).stripeAccountReady).toBe(false);
    expect(await stripeStep(schoolId, token)).toBe(false);
  });

  it('School owners read the connect status; staff without "Can connect Stripe" (Decision 442 item 3), coaches and other Schools cannot', async () => {
    const { schoolId, token } = await school();
    expect((await get(`/v1/schools/${schoolId}/payment-account/connect-status`, token)).status).toBe(200);
    expect((await get(`/v1/schools/${schoolId}/payment-account/connect-status`, await person('BRANCH_STAFF', schoolId))).status).toBe(403);
    expect((await get(`/v1/schools/${schoolId}/payment-account/connect-status`, await person('INSTRUCTOR', schoolId))).status).toBe(403);
    const other = await school();
    expect((await get(`/v1/schools/${schoolId}/payment-account/connect-status`, other.token)).status).toBe(404);
  });

  it('a Brazilian School is told Connect is not available, and has no Stripe step', async () => {
    const { schoolId, token } = await school('BR');
    const status = await get(`/v1/schools/${schoolId}/payment-account/connect-status`, token);
    expect(status.body).toEqual(expect.objectContaining({ status: 'NOT_CONNECTED', connectAvailable: false }));
    expect(await stripeStep(schoolId, token)).toBeUndefined();
  });

  it('the jobs connection still cannot update PaymentAccount directly, only through set_stripe_account_ready()', async () => {
    const { schoolId, token } = await school();
    const { paymentAccountId, acct } = await connect(schoolId, token);
    await expect(jobsDb.$executeRaw`UPDATE "PaymentAccount" SET "stripeAccountReady" = true WHERE "id" = ${paymentAccountId}`).rejects.toThrow(/permission denied/);
    await expect(jobsDb.$executeRaw`UPDATE "PaymentAccount" SET "country" = 'FR' WHERE "id" = ${paymentAccountId}`).rejects.toThrow(/permission denied/);
    const [{ changed }] = await jobsDb.$queryRaw<Array<{ changed: number }>>`SELECT "set_stripe_account_ready"(${acct}, true, now()::timestamp(3)) AS changed`;
    expect(changed).toBe(1);
    // The app connection can't call it.
    const appDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_APP });
    try {
      await expect(appDb.$queryRaw`SELECT "set_stripe_account_ready"(${acct}, false, now()::timestamp(3))`).rejects.toThrow(/permission denied/);
    } finally {
      await appDb.$disconnect();
    }
    expect((await superuser.paymentAccount.findUniqueOrThrow({ where: { id: paymentAccountId } })).stripeAccountReady).toBe(true);
  });
});
