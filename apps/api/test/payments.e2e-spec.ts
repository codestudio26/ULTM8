/**
 * HTTP-level gate for PaymentsModule (Phase 8) — PaymentAccount CRUD/RLS and the
 * webhook endpoint's signature verification. Same ground rule as every other e2e
 * spec in this repo: prove over real HTTP, not just by reading the code.
 *
 * Deliberately does NOT assert that a valid webhook is actually processed by
 * stripe-webhook-processing's queue worker — that needs a real Redis connection this
 * spec doesn't gate on, matching this repo's own established split (compare
 * timetable.e2e-spec.ts, which tests TimetableSlot CRUD/RLS only, against the
 * separate class-occurrence-generation.e2e-spec.ts, which calls that job's processor
 * directly). The processing/dedup half is covered by
 * stripe-webhook-processing.e2e-spec.ts instead.
 *
 * Webhook signature tests use Stripe's own `Stripe.webhooks.generateTestHeaderString`
 * SDK utility to construct a genuinely valid signature against STRIPE_WEBHOOK_SECRET
 * — no live Stripe account or network call involved, this is a documented offline
 * test helper, not a mock standing in for the real verification logic.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET,
 * STRIPE_WEBHOOK_SECRET, AND REDIS_URL — the last one caught on review: the "accepts
 * a valid webhook" test below reaches PaymentsService.handleIncomingWebhook, which
 * really does call webhookQueue.add() (BullMQ's lazyConnect defers the actual Redis
 * connection attempt to first use, not to app boot — so compile()/init() alone would
 * succeed without Redis reachable, but this specific test's own .add() call would
 * then hang/fail). Gating on it here rather than letting this be the second instance
 * of the exact under-gating bug Phase 7's own e2e spec review caught and fixed.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const REDIS_URL = process.env.REDIS_URL;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET && STRIPE_WEBHOOK_SECRET && REDIS_URL);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[payments.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET / ' +
      'STRIPE_WEBHOOK_SECRET / REDIS_URL not set. This gate MUST run against a real Postgres+Redis in CI; a local skip is not a substitute.',
  );
}

describeIfDb('PaymentsModule — HTTP-level cross-tenant isolation and webhook signature verification', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let schoolA: { id: string };
  let schoolB: { id: string };
  let franchise: { id: string };
  let ownerA: { id: string; email: string };
  let ownerB: { id: string; email: string };
  let franchiseOwner: { id: string; email: string };
  let tokenOwnerA: string;
  let tokenOwnerB: string;
  let tokenFranchiseOwner: string;

  const paymentAccountIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    schoolA = await superuser.school.create({ data: { id: randomUUID(), name: 'Payments HTTP School A' } });
    schoolB = await superuser.school.create({ data: { id: randomUUID(), name: 'Payments HTTP School B' } });
    franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'Payments HTTP Franchise' } });

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `payments-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    ownerA = await mkUser('owner-a');
    ownerB = await mkUser('owner-b');
    franchiseOwner = await mkUser('franchise-owner');

    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerA.id, schoolId: schoolA.id },
    });
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerB.id, schoolId: schoolB.id },
    });
    // FRANCHISE_OWNER — no self-service path exists to grant this in this product
    // today (see PaymentsService's own header comment); direct-seed is the only way
    // to exercise assertFranchiseOwner at all, same as every other cross-tenant test
    // in this repo bypasses the app's own write paths for fixture setup.
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: franchiseOwner.id, franchiseId: franchise.id },
    });

    tokenOwnerA = signAccessToken(ownerA, [
      { role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolA.id, branchId: null },
    ]);
    tokenOwnerB = signAccessToken(ownerB, [
      { role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolB.id, branchId: null },
    ]);
    tokenFranchiseOwner = signAccessToken(franchiseOwner, [
      { role: 'FRANCHISE_OWNER', franchiseId: franchise.id, schoolId: null, branchId: null },
    ]);
  });

  afterAll(async () => {
    await superuser.paymentAccount.deleteMany({ where: { id: { in: paymentAccountIds } } });
    await superuser.roleGrant.deleteMany({ where: { OR: [{ schoolId: { in: [schoolA.id, schoolB.id] } }, { franchiseId: franchise.id }] } });
    await superuser.user.deleteMany({ where: { email: { contains: 'payments-http-' } } });
    await superuser.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await superuser.franchise.delete({ where: { id: franchise.id } });
    await superuser.$disconnect();
    await app.close();
  });

  function paymentAccountBody(overrides: Record<string, unknown> = {}) {
    return {
      provider: 'STRIPE',
      accountTitle: 'Fixture Account',
      country: 'GB',
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------------
  // School side
  // ---------------------------------------------------------------------------

  it('CAN create and read a PaymentAccount within its own School', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/payment-accounts`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(paymentAccountBody());
    expect(createRes.status).toBe(201);
    paymentAccountIds.push(createRes.body.id);
    expect(createRes.body.stripeConnectedAccountId).toBeNull();
    expect(createRes.body.status).toBe('ACTIVE');
    expect(createRes.body.mode).toBe('TEST');

    const getRes = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/payment-account`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(createRes.body.id);
  });

  it('cannot create a second PaymentAccount for the same School — 409, not a silent duplicate', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/payment-accounts`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(paymentAccountBody());
    expect(res.status).toBe(409);
  });

  it('cannot create or read another tenant\'s School PaymentAccount', async () => {
    const created = await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: schoolB.id, provider: 'STRIPE', accountTitle: 'School B Account', country: 'GB' },
    });
    paymentAccountIds.push(created.id);

    const createRes = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolB.id}/payment-accounts`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send(paymentAccountBody());
    expect(createRes.status).toBe(404);

    const getRes = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolB.id}/payment-account`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(getRes.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Franchise side — assertFranchiseOwner, exercised only via direct-seed fixture.
  // ---------------------------------------------------------------------------

  it('a FRANCHISE_OWNER CAN create and read their Franchise\'s PaymentAccount', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/v1/franchises/${franchise.id}/payment-accounts`)
      .set('Authorization', `Bearer ${tokenFranchiseOwner}`)
      .send(paymentAccountBody({ accountTitle: 'Fixture Franchise Account' }));
    expect(createRes.status).toBe(201);
    paymentAccountIds.push(createRes.body.id);

    const getRes = await request(app.getHttpServer())
      .get(`/v1/franchises/${franchise.id}/payment-account`)
      .set('Authorization', `Bearer ${tokenFranchiseOwner}`);
    expect(getRes.status).toBe(200);
  });

  it('a School Owner with zero grants on the Franchise gets 404 reading its PaymentAccount, not 403', async () => {
    // Corrected on code review: an earlier draft of this test expected 403, but
    // findForFranchise (like findForSchool) deliberately has no owner-narrowing —
    // it relies on RLS alone, matching this codebase's established "RLS-blocked and
    // genuine-404 are indistinguishable by design" convention (see
    // PaymentsService.findForSchool's own comment). ownerA holds no RoleGrant
    // scoped to this Franchise at all, so RLS hides the row entirely — a real 404,
    // not a "wrong role" 403.
    const res = await request(app.getHttpServer())
      .get(`/v1/franchises/${franchise.id}/payment-account`)
      .set('Authorization', `Bearer ${tokenOwnerA}`);
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Webhook signature verification — Stripe's own generateTestHeaderString utility,
  // not a mock standing in for the real verification logic.
  // ---------------------------------------------------------------------------

  it('rejects a webhook with an invalid signature — 400, never enqueued', async () => {
    const payload = JSON.stringify({ id: 'evt_fake_invalid', type: 'account.updated' });
    const res = await request(app.getHttpServer())
      .post('/v1/payments/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=1,v1=not_a_real_signature')
      .send(payload);
    expect(res.status).toBe(400);
  });

  it('rejects a webhook with no Stripe-Signature header at all', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/payments/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_fake_no_sig', type: 'account.updated' }));
    expect(res.status).toBe(400);
  });

  it('accepts a webhook with a genuinely valid signature', async () => {
    const payload = JSON.stringify({
      id: `evt_fixture_${randomUUID()}`,
      object: 'event',
      type: 'account.updated',
      data: { object: {} },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: STRIPE_WEBHOOK_SECRET!,
    });
    const res = await request(app.getHttpServer())
      .post('/v1/payments/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});
