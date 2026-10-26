/**
 * Decision 337 — the Franchises section review fixes (F1–F4, F10–F12, F15–F21,
 * roster F2). One file so each fix has a test that names it.
 *
 * Stripe is faked throughout (no live key in CI or this sandbox): the fake
 * records every call, so the tests can check what WOULD be sent to Stripe —
 * the final-invoice cancel on leave and on close (F16/F19), and the
 * subscription parameters (F15/F18) — without reaching it.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_JOBS,
 * DATABASE_URL_PLATFORM_ADMIN, JWT_ACCESS_SECRET, PLATFORM_ADMIN_JWT_SECRET —
 * skips with a warning if any are unset, same convention as every other
 * HTTP-level gate in this repo.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';
import { FranchiseFeeBillingService } from '../src/franchise-fees/franchise-fee-billing.service';
import { FranchiseFeeUsageReportingProcessor } from '../src/jobs/franchise-fee-usage-reporting.processor';
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';
import {
  CHARGEBACK_PATTERN_RESTRICTION_QUEUE,
  NOTIFICATION_FANOUT_QUEUE,
  WAITLIST_CASCADE_PROCESSING_QUEUE,
} from '../src/jobs/queue.constants';

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = Boolean(
  DATABASE_URL &&
    process.env.DATABASE_URL_APP &&
    process.env.DATABASE_URL_JOBS &&
    process.env.DATABASE_URL_PLATFORM_ADMIN &&
    process.env.JWT_ACCESS_SECRET &&
    process.env.PLATFORM_ADMIN_JWT_SECRET,
);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[franchise-review-fixes.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_JOBS / ' +
      'DATABASE_URL_PLATFORM_ADMIN / JWT_ACCESS_SECRET / PLATFORM_ADMIN_JWT_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

/** Records every Stripe call any test below makes. */
function makeFakeStripe() {
  const calls = {
    cancel: [] as Array<{ account: string; subscriptionId: string; params: unknown }>,
    subscriptionCreate: [] as Array<{ params: Record<string, unknown>; idempotencyKey: string }>,
    meterEvents: [] as unknown[],
  };
  let invoiceToReturn: Record<string, unknown> | null = null;
  const fake = {
    scopedClient: jest.fn((account: string) => ({
      subscriptions: {
        cancel: jest.fn(async (subscriptionId: string, params: unknown) => {
          calls.cancel.push({ account, subscriptionId, params });
          return { id: subscriptionId, status: 'canceled' };
        }),
        create: jest.fn(async (params: Record<string, unknown>, opts: { idempotencyKey: string }) => {
          calls.subscriptionCreate.push({ params, idempotencyKey: opts.idempotencyKey });
          return { id: `sub_fake_${randomUUID()}`, customer: 'cus_fake' };
        }),
      },
      customers: { create: jest.fn(async () => ({ id: 'cus_fake' })) },
      products: { create: jest.fn(async () => ({ id: `prod_fake_${randomUUID()}` })) },
      prices: { create: jest.fn(async () => ({ id: `price_fake_${randomUUID()}` })) },
      billing: {
        meters: { create: jest.fn(async () => ({ id: `mtr_fake_${randomUUID()}` })) },
        meterEvents: {
          create: jest.fn(async (params: unknown) => {
            calls.meterEvents.push(params);
            return params;
          }),
        },
      },
      invoices: { retrieve: jest.fn(async () => invoiceToReturn) },
    })),
    platformClient: jest.fn(),
    constructWebhookEvent: jest.fn(),
  };
  return {
    fake,
    calls,
    setInvoice: (inv: Record<string, unknown>) => {
      invoiceToReturn = inv;
    },
  };
}

describeIfDb('Franchises review fixes (Decision 337)', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const tenantJwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const adminJwt = new JwtService({ secret: process.env.PLATFORM_ADMIN_JWT_SECRET });
  const stripe = makeFakeStripe();
  let app: INestApplication;

  const franchiseIds: string[] = [];
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const adminIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StripeClientService)
      .useValue(stripe.fake)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await superuser.franchiseFeeCharge.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.franchiseFeeRateChange.deleteMany({ where: { franchiseId: { in: franchiseIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.auditLogEntry.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await superuser.adminUser.deleteMany({ where: { id: { in: adminIds } } });
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
        email: `franchise-review-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Review',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function seedFranchise(data: Record<string, unknown> = {}, opts: { stripeAccount?: boolean } = {}) {
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'Review Franchise', ...data } });
    franchiseIds.push(franchise.id);
    const owner = await mkUser('fowner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: owner.id, franchiseId: franchise.id } });
    const token = tenantJwt.sign({
      sub: owner.id,
      email: owner.email,
      grants: [{ role: 'FRANCHISE_OWNER', franchiseId: franchise.id, schoolId: null, branchId: null }],
    });
    let connectedAccountId: string | null = null;
    if (opts.stripeAccount) {
      connectedAccountId = `acct_fake_${randomUUID()}`;
      await superuser.paymentAccount.create({
        data: { id: randomUUID(), franchiseId: franchise.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: connectedAccountId },
      });
    }
    return { franchise, owner, token, connectedAccountId };
  }

  async function seedSchool(data: Record<string, unknown> = {}) {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Review School', ...data } });
    schoolIds.push(school.id);
    const owner = await mkUser('sowner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    const token = tenantJwt.sign({
      sub: owner.id,
      email: owner.email,
      grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }],
    });
    return { school, owner, token };
  }

  async function fullAdminToken() {
    const admin = await superuser.adminUser.create({
      data: { id: randomUUID(), email: `franchise-review-admin-${randomUUID()}@example.test`, name: 'Review Admin', subRole: 'FULL_ADMIN', ssoSubject: `sub-${randomUUID()}` },
    });
    adminIds.push(admin.id);
    return adminJwt.sign({ sub: admin.id, email: admin.email, subRole: admin.subRole });
  }

  const http = () => request(app.getHttpServer());

  describe('saving a Franchise', () => {
    it('F10 — a name of only spaces is rejected on create and on edit', async () => {
      const { franchise, token } = await seedFranchise();
      const create = await http().post('/v1/franchises').set('Authorization', `Bearer ${token}`).send({ name: '   ' });
      expect(create.status).toBe(400);
      const edit = await http().patch(`/v1/franchises/${franchise.id}`).set('Authorization', `Bearer ${token}`).send({ name: '   ' });
      expect(edit.status).toBe(400);
      const unchanged = await superuser.franchise.findUniqueOrThrow({ where: { id: franchise.id } });
      expect(unchanged.name).toBe('Review Franchise');
    });

    it('F10 — a name is saved without its surrounding spaces', async () => {
      const { franchise, token } = await seedFranchise();
      const res = await http().patch(`/v1/franchises/${franchise.id}`).set('Authorization', `Bearer ${token}`).send({ name: '  Tidy Name  ' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Tidy Name');
    });

    it('F20 — null name, fee model or activities is a clear 400, not a server error', async () => {
      const { franchise, token } = await seedFranchise();
      for (const body of [{ name: null }, { feeModel: null }, { activities: null }, { facilities: null }]) {
        const res = await http().patch(`/v1/franchises/${franchise.id}`).set('Authorization', `Bearer ${token}`).send(body);
        expect(res.status).toBe(400);
      }
      const nameRes = await http().patch(`/v1/franchises/${franchise.id}`).set('Authorization', `Bearer ${token}`).send({ name: null });
      expect(JSON.stringify(nameRes.body)).toContain("Franchise name can't be empty.");
    });

    it('F21 — language and currency must come from the supported lists', async () => {
      const { franchise, token } = await seedFranchise();
      const badCreate = await http().post('/v1/franchises').set('Authorization', `Bearer ${token}`).send({ name: 'Lang Test', defaultLanguage: 'klingon' });
      expect(badCreate.status).toBe(400);
      const badEdit = await http().patch(`/v1/franchises/${franchise.id}`).set('Authorization', `Bearer ${token}`).send({ defaultCurrency: 'ZZZ' });
      expect(badEdit.status).toBe(400);
      const ok = await http().patch(`/v1/franchises/${franchise.id}`).set('Authorization', `Bearer ${token}`).send({ defaultLanguage: 'es', defaultCurrency: 'GBP' });
      expect(ok.status).toBe(200);
      expect(ok.body.defaultLanguage).toBe('es');
      expect(ok.body.defaultCurrency).toBe('GBP');
    });

    it('F21 — an older Franchise with a free-text value can still be edited if that value is left as it is', async () => {
      const { franchise, token } = await seedFranchise({ defaultCurrency: 'dollars' });
      const res = await http()
        .patch(`/v1/franchises/${franchise.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ defaultCurrency: 'dollars', description: 'still editable' });
      expect(res.status).toBe(200);
      expect(res.body.description).toBe('still editable');
    });

    it('F1 — the fee model cannot change while a School is being billed, but the amount still can', async () => {
      const { franchise, token } = await seedFranchise({ feeModel: 'FLAT', flatFeeAmount: 5000 });
      await seedSchool({ franchiseId: franchise.id, stripeFranchiseFeeSubscriptionId: `sub_fake_${randomUUID()}`, franchiseFeeSubscriptionStatus: 'ACTIVE' });

      const res = await http().patch(`/v1/franchises/${franchise.id}`).set('Authorization', `Bearer ${token}`).send({ feeModel: 'PER_HEADCOUNT', perHeadcountRate: 200 });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('1 School(s) already being billed');
      const after = await superuser.franchise.findUniqueOrThrow({ where: { id: franchise.id } });
      expect(after.feeModel).toBe('FLAT');

      const amount = await http()
        .patch(`/v1/franchises/${franchise.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ flatFeeAmount: 6000, feeRateChangeStrategy: 'MIGRATE_NEXT_CYCLE' });
      expect(amount.status).toBe(200);
    });

    it('the billing count sees member Schools that have their own Owner (the rate-change prompt relies on it)', async () => {
      const { franchise, token } = await seedFranchise({ feeModel: 'FLAT', flatFeeAmount: 5000 });
      await seedSchool({ franchiseId: franchise.id, stripeFranchiseFeeSubscriptionId: `sub_fake_${randomUUID()}`, franchiseFeeSubscriptionStatus: 'ACTIVE' });
      const status = await http().get(`/v1/franchises/${franchise.id}/billing-status`).set('Authorization', `Bearer ${token}`);
      expect(status.status).toBe(200);
      expect(status.body.schoolsAlreadyBillingCount).toBe(1);
      const noStrategy = await http().patch(`/v1/franchises/${franchise.id}`).set('Authorization', `Bearer ${token}`).send({ flatFeeAmount: 7000 });
      expect(noStrategy.status).toBe(400);
      expect(JSON.stringify(noStrategy.body)).toContain('feeRateChangeStrategy');
    });

    it('F1 — a School whose subscription is cancelled, or that is closed, does not lock the fee model', async () => {
      const { franchise, token } = await seedFranchise({ feeModel: 'FLAT', flatFeeAmount: 5000 });
      await seedSchool({ franchiseId: franchise.id, stripeFranchiseFeeSubscriptionId: `sub_fake_${randomUUID()}`, franchiseFeeSubscriptionStatus: 'CANCELED' });
      await seedSchool({ franchiseId: franchise.id, stripeFranchiseFeeSubscriptionId: `sub_fake_${randomUUID()}`, franchiseFeeSubscriptionStatus: 'ACTIVE', archivedAt: new Date() });

      const res = await http().patch(`/v1/franchises/${franchise.id}`).set('Authorization', `Bearer ${token}`).send({ feeModel: 'PER_HEADCOUNT', perHeadcountRate: 200 });
      expect(res.status).toBe(200);
      expect(res.body.feeModel).toBe('PER_HEADCOUNT');
    });
  });

  describe('Franchises list', () => {
    it('F11 — the Activity filter ignores capitals', async () => {
      const { franchise, token } = await seedFranchise({ activities: ['Jiu Jitsu', 'Judo'] });
      const res = await http().get('/v1/franchises').query({ activity: 'jiu JITSU' }).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.items.map((f: { id: string }) => f.id)).toEqual([franchise.id]);
      const none = await http().get('/v1/franchises').query({ activity: 'karate' }).set('Authorization', `Bearer ${token}`);
      expect(none.body.items).toEqual([]);
    });
  });

  describe('member Schools roster', () => {
    it('F2 — returns only the roster columns: no join code, no Stripe ids', async () => {
      const { franchise, token } = await seedFranchise();
      const { school } = await seedSchool({ franchiseId: franchise.id, stripeFranchiseFeeSubscriptionId: `sub_fake_${randomUUID()}`, franchiseFeeSubscriptionStatus: 'ACTIVE' });

      const res = await http().get(`/v1/franchises/${franchise.id}/schools`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      const row = res.body.items[0];
      expect(row.id).toBe(school.id);
      expect(row.franchiseFeeSubscriptionStatus).toBe('ACTIVE');
      expect(Object.keys(row).sort()).toEqual(['archivedAt', 'businessType', 'createdAt', 'franchiseFeeSubscriptionStatus', 'id', 'logoUrl', 'name']);
    });

    it('F2 — another Franchise\'s owner gets nothing back', async () => {
      const { franchise } = await seedFranchise();
      await seedSchool({ franchiseId: franchise.id });
      const other = await seedFranchise();
      const res = await http().get(`/v1/franchises/${franchise.id}/schools`).set('Authorization', `Bearer ${other.token}`);
      expect(res.status).toBe(404);
    });

    it('F2 — the function itself refuses a caller who does not own the Franchise', async () => {
      const { franchise } = await seedFranchise();
      await seedSchool({ franchiseId: franchise.id });
      const outsider = await mkUser('outsider');
      const rows = await superuser.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${outsider.id}, true)`;
        return tx.$queryRaw<unknown[]>`SELECT * FROM franchise_member_schools(${franchise.id})`;
      });
      expect(rows).toEqual([]);
    });
  });

  describe('joining and leaving', () => {
    it('F3 — a closed Franchise cannot be joined', async () => {
      const { franchise } = await seedFranchise({ archivedAt: new Date() });
      const { school, token } = await seedSchool();
      const res = await http().post(`/v1/schools/${school.id}/join-franchise`).set('Authorization', `Bearer ${token}`).send({ franchiseId: franchise.id });
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain('This Franchise has been closed and no longer accepts new Schools.');
      expect((await superuser.school.findUniqueOrThrow({ where: { id: school.id } })).franchiseId).toBeNull();
    });

    it('F4 — a closed School cannot join a Franchise', async () => {
      const { franchise } = await seedFranchise();
      const { school, token } = await seedSchool({ archivedAt: new Date() });
      const res = await http().post(`/v1/schools/${school.id}/join-franchise`).set('Authorization', `Bearer ${token}`).send({ franchiseId: franchise.id });
      expect(res.status).toBe(403);
      expect((await superuser.school.findUniqueOrThrow({ where: { id: school.id } })).franchiseId).toBeNull();
    });

    it('F12 — joining a second Franchise says to leave the first one', async () => {
      const first = await seedFranchise();
      const second = await seedFranchise();
      const { school, token } = await seedSchool({ franchiseId: first.franchise.id });
      const res = await http().post(`/v1/schools/${school.id}/join-franchise`).set('Authorization', `Bearer ${token}`).send({ franchiseId: second.franchise.id });
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).toContain('This School is already in a Franchise. Leave it first, then join the new one.');
    });

    it('F19 — leaving cancels the fee subscription with a final invoice for the month', async () => {
      const { franchise, connectedAccountId } = await seedFranchise({ feeModel: 'FLAT', flatFeeAmount: 5000 }, { stripeAccount: true });
      const subscriptionId = `sub_fake_${randomUUID()}`;
      const { school, token } = await seedSchool({ franchiseId: franchise.id, stripeFranchiseFeeSubscriptionId: subscriptionId, franchiseFeeSubscriptionStatus: 'ACTIVE' });

      const res = await http().post(`/v1/schools/${school.id}/leave-franchise`).set('Authorization', `Bearer ${token}`).send();
      expect(res.status).toBe(201);
      expect(stripe.calls.cancel).toContainEqual({ account: connectedAccountId, subscriptionId, params: { invoice_now: true, prorate: false } });
      const after = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
      expect(after.franchiseId).toBeNull();
      expect(after.stripeFranchiseFeeSubscriptionId).toBeNull();
    });
  });

  describe('closing a School or Franchise (Platform Admin)', () => {
    it('F16 — closing a Franchise cancels every member School\'s fee subscription', async () => {
      const { franchise, connectedAccountId } = await seedFranchise({ name: 'Closing Franchise', feeModel: 'FLAT', flatFeeAmount: 5000 }, { stripeAccount: true });
      const subA = `sub_fake_${randomUUID()}`;
      const subB = `sub_fake_${randomUUID()}`;
      const a = await seedSchool({ franchiseId: franchise.id, stripeFranchiseFeeSubscriptionId: subA, franchiseFeeSubscriptionStatus: 'ACTIVE' });
      const b = await seedSchool({ franchiseId: franchise.id, stripeFranchiseFeeSubscriptionId: subB, franchiseFeeSubscriptionStatus: 'PAST_DUE' });

      const res = await http()
        .post(`/v1/platform-admin/franchises/${franchise.id}/close`)
        .set('Authorization', `Bearer ${await fullAdminToken()}`)
        .send({ confirmName: 'Closing Franchise' });
      expect(res.status).toBe(201);

      for (const subscriptionId of [subA, subB]) {
        expect(stripe.calls.cancel).toContainEqual({ account: connectedAccountId, subscriptionId, params: { invoice_now: true, prorate: false } });
      }
      for (const { school } of [a, b]) {
        const after = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
        expect(after.stripeFranchiseFeeSubscriptionId).toBeNull();
        expect(after.franchiseFeeSubscriptionStatus).toBe('CANCELED');
      }
    });

    it('F16 — closing one School cancels only its own fee subscription', async () => {
      const { franchise, connectedAccountId } = await seedFranchise({ feeModel: 'FLAT', flatFeeAmount: 5000 }, { stripeAccount: true });
      const closingSub = `sub_fake_${randomUUID()}`;
      const keptSub = `sub_fake_${randomUUID()}`;
      const closing = await seedSchool({ name: 'Closing School', franchiseId: franchise.id, stripeFranchiseFeeSubscriptionId: closingSub, franchiseFeeSubscriptionStatus: 'ACTIVE' });
      const kept = await seedSchool({ franchiseId: franchise.id, stripeFranchiseFeeSubscriptionId: keptSub, franchiseFeeSubscriptionStatus: 'ACTIVE' });

      const res = await http()
        .post(`/v1/platform-admin/schools/${closing.school.id}/close`)
        .set('Authorization', `Bearer ${await fullAdminToken()}`)
        .send({ confirmName: 'Closing School' });
      expect(res.status).toBe(201);

      expect(stripe.calls.cancel).toContainEqual({ account: connectedAccountId, subscriptionId: closingSub, params: { invoice_now: true, prorate: false } });
      expect(stripe.calls.cancel.map((c) => c.subscriptionId)).not.toContain(keptSub);
      expect((await superuser.school.findUniqueOrThrow({ where: { id: kept.school.id } })).stripeFranchiseFeeSubscriptionId).toBe(keptSub);
    });
  });

  describe('monthly franchise-fee job', () => {
    let processor: FranchiseFeeUsageReportingProcessor;
    let billing: FranchiseFeeBillingService;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [FranchiseFeeUsageReportingProcessor, FranchiseFeeBillingService, PrismaJobsService, { provide: StripeClientService, useValue: stripe.fake }],
      }).compile();
      processor = moduleRef.get(FranchiseFeeUsageReportingProcessor);
      billing = moduleRef.get(FranchiseFeeBillingService);
    });

    const fakeJob = () => ({ data: {}, attemptsMade: 1, opts: { attempts: 3 } }) as never;

    it('F16 — never starts billing a closed School, or any School of a closed Franchise', async () => {
      const open = await seedFranchise({ feeModel: 'FLAT', flatFeeAmount: 5000 }, { stripeAccount: true });
      const closedSchool = await seedSchool({ franchiseId: open.franchise.id, archivedAt: new Date() });
      const closed = await seedFranchise({ feeModel: 'FLAT', flatFeeAmount: 5000, archivedAt: new Date() }, { stripeAccount: true });
      const schoolOfClosed = await seedSchool({ franchiseId: closed.franchise.id });

      await processor.process(fakeJob());

      for (const { school } of [closedSchool, schoolOfClosed]) {
        expect((await superuser.school.findUniqueOrThrow({ where: { id: school.id } })).stripeFranchiseFeeSubscriptionId).toBeNull();
      }
    });

    it('F16 — never reports usage for a closed School, or any School of a closed Franchise', async () => {
      const open = await seedFranchise(
        { feeModel: 'PER_HEADCOUNT', perHeadcountRate: 200, stripeMeterId: 'mtr_fake', stripeUsagePriceId: 'price_fake' },
        { stripeAccount: true },
      );
      const closedSchool = await seedSchool({ franchiseId: open.franchise.id, archivedAt: new Date(), stripeFranchiseFeeSubscriptionId: `sub_fake_${randomUUID()}`, franchiseFeeSubscriptionStatus: 'ACTIVE' });
      const closed = await seedFranchise(
        { feeModel: 'PER_HEADCOUNT', perHeadcountRate: 200, stripeMeterId: 'mtr_fake', stripeUsagePriceId: 'price_fake', archivedAt: new Date() },
        { stripeAccount: true },
      );
      const schoolOfClosed = await seedSchool({ franchiseId: closed.franchise.id, stripeFranchiseFeeSubscriptionId: `sub_fake_${randomUUID()}`, franchiseFeeSubscriptionStatus: 'ACTIVE' });

      await processor.process(fakeJob());

      const charges = await superuser.franchiseFeeCharge.count({ where: { schoolId: { in: [closedSchool.school.id, schoolOfClosed.school.id] } } });
      expect(charges).toBe(0);
    });

    it('F18 — a per-headcount subscription\'s billing months start at midnight UTC on the 1st', async () => {
      const { franchise } = await seedFranchise(
        { feeModel: 'PER_HEADCOUNT', perHeadcountRate: 200, stripeMeterId: 'mtr_fake', stripeUsagePriceId: 'price_fake' },
        { stripeAccount: true },
      );
      const { school } = await seedSchool({ franchiseId: franchise.id });
      const full = await superuser.franchise.findUniqueOrThrow({ where: { id: franchise.id }, include: { paymentAccount: true } });

      stripe.calls.subscriptionCreate.length = 0;
      await billing.ensureSubscription(full, school);

      expect(stripe.calls.subscriptionCreate).toHaveLength(1);
      const { params } = stripe.calls.subscriptionCreate[0];
      expect(params.billing_cycle_anchor).toBe(DateTime.utc().startOf('month').plus({ months: 1 }).toSeconds());
      expect(params.proration_behavior).toBe('none');
    });

    it('F15 — a School that leaves and rejoins gets a new idempotency key, a retry keeps the same one', async () => {
      const { franchise } = await seedFranchise({ feeModel: 'FLAT', flatFeeAmount: 5000 }, { stripeAccount: true });
      const { school } = await seedSchool({ franchiseId: franchise.id });
      const full = await superuser.franchise.findUniqueOrThrow({ where: { id: franchise.id }, include: { paymentAccount: true } });

      stripe.calls.subscriptionCreate.length = 0;
      await billing.ensureSubscription(full, school);
      await billing.ensureSubscription(full, school); // same row read twice: a retry or a concurrent run
      // Leaving and rejoining writes the School row.
      await superuser.school.update({ where: { id: school.id }, data: { franchiseId: null, stripeFranchiseFeeSubscriptionId: null } });
      const rejoined = await superuser.school.update({ where: { id: school.id }, data: { franchiseId: franchise.id } });
      await billing.ensureSubscription(full, rejoined);

      const keys = stripe.calls.subscriptionCreate.map((c) => c.idempotencyKey);
      expect(keys).toHaveLength(3);
      expect(keys[0]).toBe(keys[1]);
      expect(keys[2]).not.toBe(keys[0]);
      expect(keys[0]).toContain(franchise.id);
    });
  });

  describe('invoice.paid for a franchise fee', () => {
    let webhook: StripeWebhookProcessingProcessor;

    beforeAll(async () => {
      const queue = { addBulk: jest.fn().mockResolvedValue(undefined) };
      const moduleRef = await Test.createTestingModule({
        providers: [
          StripeWebhookProcessingProcessor,
          PrismaJobsService,
          { provide: StripeClientService, useValue: stripe.fake },
          { provide: getQueueToken(NOTIFICATION_FANOUT_QUEUE), useValue: queue },
          { provide: getQueueToken(CHARGEBACK_PATTERN_RESTRICTION_QUEUE), useValue: queue },
          { provide: getQueueToken(WAITLIST_CASCADE_PROCESSING_QUEUE), useValue: queue },
        ],
      }).compile();
      webhook = moduleRef.get(StripeWebhookProcessingProcessor);
    });

    afterAll(async () => {
      await superuser.processedStripeEvent.deleteMany({ where: { stripeEventId: { startsWith: 'evt_review_' } } });
    });

    async function seedTwoPendingMonths() {
      const { franchise, connectedAccountId } = await seedFranchise({ feeModel: 'PER_HEADCOUNT', perHeadcountRate: 200 }, { stripeAccount: true });
      const subscriptionId = `sub_fake_${randomUUID()}`;
      const { school } = await seedSchool({ franchiseId: franchise.id, stripeFranchiseFeeSubscriptionId: subscriptionId, franchiseFeeSubscriptionStatus: 'ACTIVE' });
      const account = await superuser.paymentAccount.findUniqueOrThrow({ where: { franchiseId: franchise.id } });
      const row = (createdAt: Date) =>
        superuser.franchiseFeeCharge.create({
          data: {
            id: randomUUID(),
            franchiseId: franchise.id,
            schoolId: school.id,
            franchisePaymentAccountId: account.id,
            billingPeriodStart: createdAt,
            billingPeriodEnd: DateTime.fromJSDate(createdAt).plus({ months: 1 }).toJSDate(),
            feeBasisSnapshot: 'PER_HEADCOUNT',
            activeStudentCountSnapshot: 10,
            amount: 2000,
            currency: 'USD',
            status: 'PENDING',
            stripeSubscriptionId: subscriptionId,
            createdAt,
          },
        });
      const november = await row(new Date('2026-11-01T03:00:05Z'));
      const december = await row(new Date('2026-12-01T03:00:05Z'));
      return { connectedAccountId: connectedAccountId!, subscriptionId, november, december };
    }

    function invoiceJob(stripeAccountId: string, invoiceId: string) {
      return { data: { stripeEventId: `evt_review_${randomUUID()}`, eventType: 'invoice.paid', objectId: invoiceId, stripeAccountId }, attemptsMade: 1, opts: { attempts: 3 } } as never;
    }

    it('F17 — November\'s invoice marks November\'s charge paid, even when December\'s is already recorded', async () => {
      const { connectedAccountId, subscriptionId, november, december } = await seedTwoPendingMonths();
      const invoiceId = `in_fake_${randomUUID()}`;
      stripe.setInvoice({
        id: invoiceId,
        amount_paid: 2000,
        currency: 'usd',
        billing_reason: 'subscription_cycle',
        period_start: Date.parse('2026-11-01T00:00:00Z') / 1000,
        period_end: Date.parse('2026-12-01T00:00:00Z') / 1000,
        parent: { subscription_details: { subscription: subscriptionId } },
        payments: { data: [] },
      });

      await webhook.process(invoiceJob(connectedAccountId, invoiceId));

      expect((await superuser.franchiseFeeCharge.findUniqueOrThrow({ where: { id: november.id } })).status).toBe('SUCCESSFUL');
      expect((await superuser.franchiseFeeCharge.findUniqueOrThrow({ where: { id: december.id } })).status).toBe('PENDING');
    });

    it('F17 — the $0 opening invoice of a per-headcount subscription marks nothing paid', async () => {
      const { connectedAccountId, subscriptionId, november, december } = await seedTwoPendingMonths();
      const invoiceId = `in_fake_${randomUUID()}`;
      const opened = Date.parse('2026-11-01T03:00:00Z') / 1000;
      stripe.setInvoice({
        id: invoiceId,
        amount_paid: 0,
        currency: 'usd',
        billing_reason: 'subscription_create',
        period_start: opened,
        period_end: opened,
        parent: { subscription_details: { subscription: subscriptionId } },
        payments: { data: [] },
      });

      await webhook.process(invoiceJob(connectedAccountId, invoiceId));

      for (const row of [november, december]) {
        expect((await superuser.franchiseFeeCharge.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING');
      }
      expect(await superuser.franchiseFeeCharge.count({ where: { stripeInvoiceId: invoiceId } })).toBe(0);
    });
  });
});
