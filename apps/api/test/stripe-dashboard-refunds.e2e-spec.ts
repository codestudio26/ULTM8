/**
 * Decision 382 (Transactions G6) — a refund made in the Stripe dashboard is
 * picked up by the charge.refunded / charge.refund.updated webhooks and shows
 * on the Transactions page, over real HTTP against a real Postgres. Stripe is
 * faked: charges.retrieve and refunds.retrieve return what each test sets.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET, REDIS_URL.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, TransactionStatus } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { Job } from 'bullmq';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Stripe-dashboard refunds (Decision 382)', () => {
  let app: INestApplication;
  let processor: StripeWebhookProcessingProcessor;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const eventIds: string[] = [];
  const TAG = 'tx-dash-refunds-';

  /** What Stripe holds, by id: Charges and Refunds. */
  const charges = new Map<string, object>();
  const refunds = new Map<string, object>();
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({
      charges: { retrieve: jest.fn(async (id: string) => charges.get(id)) },
      refunds: { retrieve: jest.fn(async (id: string) => refunds.get(id)) },
    })),
    platformClient: jest.fn(),
  };

  const mkUser = (label: string) =>
    su.user.create({
      data: {
        id: randomUUID(),
        email: `${TAG}${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Tester',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });

  async function seed(status: TransactionStatus = 'SUCCESSFUL') {
    const school = await su.school.create({ data: { id: randomUUID(), name: `Dash refunds ${randomUUID().slice(0, 6)}` } });
    schoolIds.push(school.id);
    const owner = await mkUser('owner');
    const student = await mkUser('student');
    await su.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id },
      ],
    });
    const account = await su.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Card', country: 'GB', stripeConnectedAccountId: `acct_${randomUUID().slice(0, 8)}` },
    });
    const plan = await su.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '10-Class Pack', price: 15000, classesIncluded: 10, currency: 'GBP' },
    });
    const pi = `pi_${randomUUID()}`;
    const transaction = await su.transaction.create({
      data: {
        id: randomUUID(), schoolId: school.id, studentId: student.id, paymentAccountId: account.id, membershipPlanId: plan.id,
        amount: 15000, currency: 'GBP', status, paymentMethod: 'STRIPE', stripePaymentIntentId: pi,
      },
    });
    const ownerToken = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
    return { school, account, transaction, pi, ownerToken };
  }
  type Seeded = Awaited<ReturnType<typeof seed>>;

  /** Stripe's Charge for the seeded payment, refunded so far by `amountRefunded`. */
  function setCharge(s: Seeded, amountRefunded: number, id = `ch_${s.pi}`) {
    charges.set(id, { id, object: 'charge', amount: 15000, amount_refunded: amountRefunded, payment_intent: s.pi });
    return id;
  }

  async function webhook(s: Seeded | null, eventType: string, objectId: string) {
    const stripeEventId = `evt_${randomUUID()}`;
    eventIds.push(stripeEventId);
    await processor.process({ data: { stripeEventId, eventType, objectId, stripeAccountId: s?.account.stripeConnectedAccountId } } as unknown as Job);
  }
  const row = (s: Seeded) => su.transaction.findUniqueOrThrow({ where: { id: s.transaction.id } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(fakeStripeClient).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    processor = app.get(StripeWebhookProcessingProcessor);
  });

  afterAll(async () => {
    await app.close();
    const where = { schoolId: { in: schoolIds } };
    await su.transaction.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.roleGrant.deleteMany({ where });
    await su.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await su.user.deleteMany({ where: { email: { startsWith: TAG } } });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await su.$disconnect();
  });

  it('a full refund made in the Stripe dashboard marks the payment Refunded on the Transactions page', async () => {
    const s = await seed();
    await webhook(s, 'charge.refunded', setCharge(s, 15000));

    expect(await row(s)).toMatchObject({ status: 'REFUNDED', refundedAmount: 15000 });
    const res = await request(app.getHttpServer()).get(`/v1/schools/${s.school.id}/transactions`).set('Authorization', `Bearer ${s.ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ id: s.transaction.id, status: 'REFUNDED', refundedAmount: 15000 });
  });

  it('a partial refund shows its amount and keeps the payment Successful; a second one completing it marks it Refunded', async () => {
    const s = await seed();
    const chargeId = setCharge(s, 5000);
    await webhook(s, 'charge.refunded', chargeId);
    expect(await row(s)).toMatchObject({ status: 'SUCCESSFUL', refundedAmount: 5000 });

    setCharge(s, 15000, chargeId);
    await webhook(s, 'charge.refunded', chargeId);
    expect(await row(s)).toMatchObject({ status: 'REFUNDED', refundedAmount: 15000 });
  });

  it("a refund ULTM8 already recorded doesn't change the row again, and a late, older event can't lower the total", async () => {
    const s = await seed();
    await su.transaction.update({ where: { id: s.transaction.id }, data: { refundedAmount: 5000 } });
    const before = await row(s);
    const chargeId = setCharge(s, 5000);
    await webhook(s, 'charge.refunded', chargeId);
    const after = await row(s);
    expect(after).toMatchObject({ status: 'SUCCESSFUL', refundedAmount: 5000 });
    expect(after.updatedAt).toEqual(before.updatedAt);

    // Two refunds, events delivered out of order: each one reads the Charge as
    // it stands now, so the older event still sees the full total.
    setCharge(s, 15000, chargeId);
    await webhook(s, 'charge.refunded', chargeId);
    await webhook(s, 'charge.refunded', chargeId);
    expect(await row(s)).toMatchObject({ status: 'REFUNDED', refundedAmount: 15000 });
  });

  it('a refund that later fails (charge.refund.updated) lowers the total and turns the payment back to Successful', async () => {
    const s = await seed();
    const chargeId = setCharge(s, 15000);
    await webhook(s, 'charge.refunded', chargeId);
    expect((await row(s)).status).toBe('REFUNDED');

    const refundId = `re_${randomUUID()}`;
    refunds.set(refundId, { id: refundId, object: 'refund', status: 'failed', charge: chargeId });
    setCharge(s, 0, chargeId);
    await webhook(s, 'charge.refund.updated', refundId);
    expect(await row(s)).toMatchObject({ status: 'SUCCESSFUL', refundedAmount: null });
  });

  it('a disputed payment keeps its Disputed status; only the refunded total moves', async () => {
    const s = await seed('DISPUTED');
    await webhook(s, 'charge.refunded', setCharge(s, 15000));
    expect(await row(s)).toMatchObject({ status: 'DISPUTED', refundedAmount: 15000 });
  });

  it("a refund on a charge ULTM8 has no row for, or on the platform's own account, changes nothing", async () => {
    const s = await seed();
    const otherCharge = `ch_${randomUUID()}`;
    charges.set(otherCharge, { id: otherCharge, object: 'charge', amount: 999, amount_refunded: 999, payment_intent: `pi_${randomUUID()}` });
    await webhook(s, 'charge.refunded', otherCharge);
    await webhook(null, 'charge.refunded', setCharge(s, 15000));
    expect(await row(s)).toMatchObject({ status: 'SUCCESSFUL', refundedAmount: null });
  });
});
