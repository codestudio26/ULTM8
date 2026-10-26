/**
 * Regression gate for the billing stress test of 26 Oct 2026
 * (docs/handover/BILLING-STRESS-TEST.md). Each block pins one finding the
 * stress run proved over real HTTP:
 *
 * - confirming cash payments: the owner check ran in a second transaction
 *   nested inside the first, so as many confirmations at once as the pool has
 *   connections all failed "busy" (503);
 * - a card payment whose first attempt failed and which then succeeded stayed
 *   FAILED with no Membership;
 * - the Stripe webhook was rate-limited per IP.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET and REDIS_URL.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PaymentsController } from '../src/payments/payments.controller';
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[billing-stress-fixes.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

describe('Stripe webhook route', () => {
  it('is not rate-limited by either throttler', () => {
    const handler = PaymentsController.prototype.handleStripeWebhook;
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', handler)).toBe(true);
    expect(Reflect.getMetadata('THROTTLER:SKIPidentity', handler)).toBe(true);
  });
});

describeIfDb('Billing stress-test fixes', () => {
  let app: INestApplication;
  let processor: StripeWebhookProcessingProcessor;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const school = { id: randomUUID() };
  type U = { id: string; token: string };
  let owner: U;
  const students: U[] = [];
  let cashAccountId: string;
  let packPlanId: string;
  const eventIds: string[] = [];

  const http = () => request(app.getHttpServer());

  async function mkUser(label: string, role: 'SCHOOL_OWNER_MANAGER' | 'STUDENT'): Promise<U> {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `billing-fixes-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Billing',
        passcodeHash: 'x',
        dateOfBirth: new Date('1995-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId: school.id } });
    const token = jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId: null }] });
    return { id: user.id, token };
  }

  const pending = (studentId: string, extra: Record<string, unknown> = {}) =>
    superuser.transaction.create({
      data: { id: randomUUID(), schoolId: school.id, studentId, paymentAccountId: cashAccountId, membershipPlanId: packPlanId, amount: 3000, currency: 'GBP', status: 'PENDING', paymentMethod: 'CASH', ...extra },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    // Listening once: an unbound server makes supertest open a new listener per
    // request, and 20 at once then reset each other's connections.
    await app.listen(0);
    processor = moduleRef.get(StripeWebhookProcessingProcessor);

    await superuser.school.create({ data: { id: school.id, name: 'Billing Fixes School', timezone: 'UTC' } });
    owner = await mkUser('owner', 'SCHOOL_OWNER_MANAGER');
    for (let i = 0; i < 25; i++) students.push(await mkUser(`student${i}`, 'STUDENT'));
    cashAccountId = (await superuser.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'CASH', accountTitle: 'Desk', country: 'GB' } })).id;
    packPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: 'Pack', price: 3000, classesIncluded: 5, currency: 'GBP' } })).id;
  });

  afterAll(async () => {
    const userIds = (await superuser.user.findMany({ where: { email: { contains: 'billing-fixes-' } }, select: { id: true } })).map((u) => u.id);
    await superuser.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await superuser.transaction.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.paymentAccount.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('20 cash payments confirmed at once all succeed (no nested transaction holding the pool)', async () => {
    const txs = await Promise.all(students.slice(0, 20).map((s) => pending(s.id)));
    const res = await Promise.all(txs.map((t) => http().patch(`/v1/transactions/${t.id}/confirm`).set('Authorization', `Bearer ${owner.token}`)));
    expect(res.map((r) => r.status)).toEqual(txs.map(() => 200));
    expect(await superuser.membership.count({ where: { studentId: { in: students.slice(0, 20).map((s) => s.id) } } })).toBe(20);
  });

  it('one payment confirmed 20 times at once makes one Membership, and the owner check still applies', async () => {
    const s = students[20];
    const t = await pending(s.id);
    const res = await Promise.all(Array.from({ length: 20 }, () => http().patch(`/v1/transactions/${t.id}/confirm`).set('Authorization', `Bearer ${owner.token}`)));
    expect(res.every((r) => r.status === 200)).toBe(true);
    expect(await superuser.membership.count({ where: { studentId: s.id } })).toBe(1);
    const other = await pending(students[21].id);
    expect((await http().patch(`/v1/transactions/${other.id}/confirm`).set('Authorization', `Bearer ${students[21].token}`)).status).toBe(403);
    expect((await superuser.transaction.findUnique({ where: { id: other.id } }))!.status).toBe('PENDING');
  });

  it('a card payment that failed and then succeeded gets its Membership', async () => {
    const s = students[22];
    const pi = `pi_${randomUUID().replace(/-/g, '')}`;
    const t = await pending(s.id, { paymentMethod: 'STRIPE', stripePaymentIntentId: pi });
    const job = (eventType: string) => {
      const stripeEventId = `evt_${randomUUID().replace(/-/g, '')}`;
      eventIds.push(stripeEventId);
      return { data: { stripeEventId, eventType, objectId: pi }, attemptsMade: 1, opts: { attempts: 3 } } as never;
    };
    await processor.process(job('payment_intent.payment_failed'));
    expect((await superuser.transaction.findUnique({ where: { id: t.id } }))!.status).toBe('FAILED');
    await processor.process(job('payment_intent.succeeded'));
    const after = await superuser.transaction.findUnique({ where: { id: t.id } });
    expect(after!.status).toBe('SUCCESSFUL');
    expect(after!.membershipId).not.toBeNull();
    // A later duplicate success changes nothing.
    await processor.process(job('payment_intent.succeeded'));
    expect(await superuser.membership.count({ where: { studentId: s.id } })).toBe(1);
  });
});
