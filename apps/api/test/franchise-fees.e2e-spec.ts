/**
 * HTTP-level gate for FranchiseFeesModule (Phase 16b-ii) — read-side RLS/cross-
 * tenant isolation for FranchiseFeeCharge, plus the refund action's
 * authorization and pre-Stripe validation.
 *
 * Deliberately does NOT test a successful refund (the actual
 * `stripe.invoicePayments.list`/`stripe.refunds.create` calls) — same
 * established gap MembershipsService.purchase()'s own Stripe charge()/
 * subscribe() calls already have (grepped memberships.e2e-spec.ts to confirm:
 * zero coverage of the live-Stripe path anywhere in this repo, not an
 * oversight specific to this phase). This sandbox has no real Stripe
 * credentials (CI's own STRIPE_SECRET_KEY is a documented dummy value — see
 * .github/workflows/ci.yml's own comment) — every assertion below is reachable
 * without a live Stripe API call: RLS-scoped reads, and refund validation
 * paths (403 non-owner, 400 wrong status/invalid amount) that all throw
 * BEFORE FranchiseFeesService.refund() ever calls StripeClientService.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET — skips with a
 * warning if any are unset, same convention as every other HTTP-level gate in
 * this repo.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[franchise-fees.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('FranchiseFeesModule — HTTP-level cross-tenant isolation and refund validation', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let franchise: { id: string };
  let franchiseB: { id: string };
  let school: { id: string };
  let paymentAccount: { id: string };
  let franchiseOwner: { id: string; email: string };
  let franchiseOwnerB: { id: string; email: string };
  let schoolOwner: { id: string; email: string };
  let tokenFranchiseOwner: string;
  let tokenFranchiseOwnerB: string;
  let tokenSchoolOwner: string;

  const chargeIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'Franchise-Fees HTTP Franchise' } });
    franchiseB = await superuser.franchise.create({ data: { id: randomUUID(), name: 'Franchise-Fees HTTP Franchise B' } });
    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Franchise-Fees HTTP School', franchiseId: franchise.id } });
    paymentAccount = await superuser.paymentAccount.create({
      data: { id: randomUUID(), franchiseId: franchise.id, provider: 'STRIPE', accountTitle: 'Fixture Franchise Account', country: 'GB' },
    });

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `franchise-fees-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    franchiseOwner = await mkUser('franchise-owner');
    franchiseOwnerB = await mkUser('franchise-owner-b');
    schoolOwner = await mkUser('school-owner');

    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: franchiseOwner.id, franchiseId: franchise.id } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: franchiseOwnerB.id, franchiseId: franchiseB.id } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: schoolOwner.id, schoolId: school.id } });

    tokenFranchiseOwner = signAccessToken(franchiseOwner, [{ role: 'FRANCHISE_OWNER', franchiseId: franchise.id, schoolId: null, branchId: null }]);
    tokenFranchiseOwnerB = signAccessToken(franchiseOwnerB, [{ role: 'FRANCHISE_OWNER', franchiseId: franchiseB.id, schoolId: null, branchId: null }]);
    tokenSchoolOwner = signAccessToken(schoolOwner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
  });

  afterAll(async () => {
    await superuser.franchiseFeeCharge.deleteMany({ where: { id: { in: chargeIds } } });
    await superuser.paymentAccount.delete({ where: { id: paymentAccount.id } });
    await superuser.roleGrant.deleteMany({ where: { OR: [{ franchiseId: { in: [franchise.id, franchiseB.id] } }, { schoolId: school.id }] } });
    await superuser.user.deleteMany({ where: { email: { contains: 'franchise-fees-http-' } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.franchise.deleteMany({ where: { id: { in: [franchise.id, franchiseB.id] } } });
    await superuser.$disconnect();
    await app.close();
  });

  /** Direct-seeded (superuser) — no code path creates a FranchiseFeeCharge
   * directly through the API (rows are only ever created by
   * FranchiseFeeUsageReportingProcessor or stripe-webhook-processing's own
   * invoice.paid handler, neither of which is exercisable without live Stripe
   * — see this file's own header comment), same convention every other
   * cross-boundary fixture in this suite already uses. */
  async function seedCharge(overrides: Partial<{ status: string; amount: number }> = {}) {
    const charge = await superuser.franchiseFeeCharge.create({
      data: {
        id: randomUUID(),
        franchiseId: franchise.id,
        schoolId: school.id,
        franchisePaymentAccountId: paymentAccount.id,
        billingPeriodStart: new Date('2026-09-01'),
        billingPeriodEnd: new Date('2026-09-30'),
        feeBasisSnapshot: 'FLAT',
        amount: overrides.amount ?? 10000,
        currency: 'USD',
        status: (overrides.status ?? 'SUCCESSFUL') as never,
        stripeInvoiceId: `in_fixture_${randomUUID()}`,
      },
    });
    chargeIds.push(charge.id);
    return charge;
  }

  it('the Franchise Owner CAN read their own Franchise\'s fee charges', async () => {
    const charge = await seedCharge();
    const res = await request(app.getHttpServer())
      .get(`/v1/franchises/${franchise.id}/fee-charges`)
      .set('Authorization', `Bearer ${tokenFranchiseOwner}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { id: string }) => c.id)).toContain(charge.id);
  });

  it('the School Owner CAN read their own School\'s fee charges (the payer side)', async () => {
    const charge = await seedCharge();
    const res = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/fee-charges`)
      .set('Authorization', `Bearer ${tokenSchoolOwner}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { id: string }) => c.id)).toContain(charge.id);
  });

  it('a Franchise Owner with zero relationship to this Franchise gets 404, not the other Franchise\'s charges', async () => {
    await seedCharge();
    const res = await request(app.getHttpServer())
      .get(`/v1/franchises/${franchise.id}/fee-charges`)
      .set('Authorization', `Bearer ${tokenFranchiseOwnerB}`);
    // RLS returns an empty (not 404) list for a list endpoint — same
    // "RLS-blocked and empty are indistinguishable by design" convention every
    // other list endpoint in this codebase already follows.
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('GET /franchise-fee-charges/:id is RLS-scoped — 404 for a caller with no relationship to either side', async () => {
    const charge = await seedCharge();
    const res = await request(app.getHttpServer())
      .get(`/v1/franchise-fee-charges/${charge.id}`)
      .set('Authorization', `Bearer ${tokenFranchiseOwnerB}`);
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Refund — authorization + pre-Stripe validation only (see this file's own
  // header comment for why a successful refund isn't tested here).
  // ---------------------------------------------------------------------------

  it('only the Franchise Owner may refund a charge — a School Owner (the payer side) gets 403', async () => {
    const charge = await seedCharge();
    const res = await request(app.getHttpServer())
      .post(`/v1/franchise-fee-charges/${charge.id}/refund`)
      .set('Authorization', `Bearer ${tokenSchoolOwner}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('a Franchise Owner with zero relationship to this charge gets 404 attempting to refund it', async () => {
    const charge = await seedCharge();
    const res = await request(app.getHttpServer())
      .post(`/v1/franchise-fee-charges/${charge.id}/refund`)
      .set('Authorization', `Bearer ${tokenFranchiseOwnerB}`)
      .send({});
    expect(res.status).toBe(404);
  });

  it('refunding a non-Successful charge is rejected — 400, before any Stripe call', async () => {
    const charge = await seedCharge({ status: 'PENDING' });
    const res = await request(app.getHttpServer())
      .post(`/v1/franchise-fee-charges/${charge.id}/refund`)
      .set('Authorization', `Bearer ${tokenFranchiseOwner}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('refunding more than the charge\'s own amount is rejected — 400, before any Stripe call', async () => {
    const charge = await seedCharge({ amount: 5000 });
    const res = await request(app.getHttpServer())
      .post(`/v1/franchise-fee-charges/${charge.id}/refund`)
      .set('Authorization', `Bearer ${tokenFranchiseOwner}`)
      .send({ amount: 999999 });
    expect(res.status).toBe(400);
  });
});
