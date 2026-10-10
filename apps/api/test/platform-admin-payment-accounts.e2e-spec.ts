/**
 * HTTP-level gate for PlatformAdminModule Slice 6 (Phase 30, reads) and Slice 7
 * (Phase 35, rotation) — GET .../payment-account (School- and Franchise-scoped)
 * and POST .../payment-accounts/:id/rotate-credential, mirroring the shape of
 * platform-admin-schools.e2e-spec.ts / platform-admin-franchises.e2e-spec.ts.
 * What's actually NEW here (not already proven by those two files) is what
 * this file focuses on: the FIRST subRole-restricted READ in this module
 * (BILLING_PAYMENTS_OPS + FULL_ADMIN only, SUPPORT excluded — see
 * PlatformAdminPaymentAccountsService's own header comment for why), that
 * stripeConnectedAccountId is excluded from every HTTP response at the DTO
 * layer, and the rotation endpoint's own precondition checks. Realm isolation,
 * the revokedAt re-check, and AuditLogEntry immutability are already proven
 * generically in the School suite and are not re-tested per entity here.
 *
 * Deliberately does NOT test a successful rotation (the actual
 * stripe.accountLinks.create() call reaching Stripe's live API) — same
 * established, accepted scoping payments.e2e-spec.ts's own header comment
 * already documents for PaymentsService.initiateConnectOnboarding() (the
 * tenant-side sibling this reuses): this codebase has no unit OR e2e coverage
 * anywhere of a live-Stripe-object-creating call, only of the reachable
 * validation/authorization logic in front of it. Every REJECTION path below
 * (auth, 404, both 400s) runs entirely before that boundary and is fully
 * covered.
 *
 * FOUND ON REVIEW while writing this phase's own migration: the pre-existing
 * "DB grant itself rejects stripeConnectedAccountId" test below is no longer
 * true, ON PURPOSE — Phase 35's own migration additively grants
 * ultm8_platform_admin SELECT on that exact column, since
 * initiateCredentialRotation() genuinely needs it to call Stripe (see that
 * method's own comment). Updated to prove the new, intended state instead of
 * silently going stale: the DB grant now allows it (proving the migration
 * worked), while the READ endpoints' own HTTP responses still never include
 * it (proving the application-layer `select` — not a DB denial — is now the
 * operative defense for this specific column, same as every other field this
 * codebase protects by explicit `select` rather than blanket GRANT denial).
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_PLATFORM_ADMIN,
 * PLATFORM_ADMIN_JWT_SECRET — skips with a warning if any are unset, same
 * convention as every other HTTP-level gate in this repo.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, AdminSubRole } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const DATABASE_URL_PLATFORM_ADMIN = process.env.DATABASE_URL_PLATFORM_ADMIN;
const PLATFORM_ADMIN_JWT_SECRET = process.env.PLATFORM_ADMIN_JWT_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_PLATFORM_ADMIN && PLATFORM_ADMIN_JWT_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[platform-admin-payment-accounts.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / ' +
      'DATABASE_URL_PLATFORM_ADMIN / PLATFORM_ADMIN_JWT_SECRET not set. This gate MUST run ' +
      'against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('PlatformAdminModule — .../payment-account (Slice 6)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const platformAdminRoleClient = new PrismaClient({ datasourceUrl: DATABASE_URL_PLATFORM_ADMIN });
  const platformAdminJwt = new JwtService({ secret: PLATFORM_ADMIN_JWT_SECRET });

  const adminIds: string[] = [];
  const schoolIds: string[] = [];
  const franchiseIds: string[] = [];
  const paymentAccountIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await superuser.auditLogEntry.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await superuser.paymentAccount.deleteMany({ where: { id: { in: paymentAccountIds } } });
    await superuser.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    await superuser.$disconnect();
    await platformAdminRoleClient.$disconnect();
    await app.close();
  });

  async function seedAdmin(subRole: AdminSubRole) {
    const admin = await superuser.adminUser.create({
      data: {
        id: randomUUID(),
        email: `platform-admin-payment-accounts-http-${randomUUID()}@example.test`,
        name: 'HTTP Gate Admin',
        subRole,
        ssoSubject: `cognito-sub-${randomUUID()}`,
      },
    });
    adminIds.push(admin.id);
    return admin;
  }

  function tokenFor(admin: { id: string; email: string; subRole: AdminSubRole }) {
    return platformAdminJwt.sign({ sub: admin.id, email: admin.email, subRole: admin.subRole });
  }

  async function seedSchoolWithPaymentAccount() {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Platform-Admin Payment Account Gate School' } });
    schoolIds.push(school.id);
    const account = await superuser.paymentAccount.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        provider: 'STRIPE',
        accountTitle: 'Gate School Stripe Account',
        country: 'US',
        status: 'ACTIVE',
        mode: 'TEST',
        stripeConnectedAccountId: `acct_${randomUUID()}`,
      },
    });
    paymentAccountIds.push(account.id);
    return { school, account };
  }

  async function seedFranchiseWithPaymentAccount() {
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'Platform-Admin Payment Account Gate Franchise', flatFeeAmount: 5000 } });
    franchiseIds.push(franchise.id);
    const account = await superuser.paymentAccount.create({
      data: {
        id: randomUUID(),
        franchiseId: franchise.id,
        provider: 'STRIPE',
        accountTitle: 'Gate Franchise Stripe Account',
        country: 'US',
        status: 'ACTIVE',
        mode: 'TEST',
        stripeConnectedAccountId: `acct_${randomUUID()}`,
      },
    });
    paymentAccountIds.push(account.id);
    return { franchise, account };
  }

  it('a BILLING_PAYMENTS_OPS admin can read a School PaymentAccount — 200, excludes stripeConnectedAccountId, audit row recorded', async () => {
    const { school, account } = await seedSchoolWithPaymentAccount();
    const admin = await seedAdmin(AdminSubRole.BILLING_PAYMENTS_OPS);

    const res = await request(app.getHttpServer())
      .get(`/v1/platform-admin/schools/${school.id}/payment-account`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: account.id, schoolId: school.id, franchiseId: null, provider: 'STRIPE', status: 'ACTIVE' });
    expect(res.body.stripeConnectedAccountId).toBeUndefined();

    const entries = await superuser.auditLogEntry.findMany({ where: { adminUserId: admin.id, targetId: account.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'VIEW_PAYMENT_ACCOUNT', targetType: 'PaymentAccount', schoolId: school.id, franchiseId: null });
  });

  it('a BILLING_PAYMENTS_OPS admin can read a Franchise PaymentAccount — 200, audit row records franchiseId not schoolId', async () => {
    const { franchise, account } = await seedFranchiseWithPaymentAccount();
    const admin = await seedAdmin(AdminSubRole.BILLING_PAYMENTS_OPS);

    const res = await request(app.getHttpServer())
      .get(`/v1/platform-admin/franchises/${franchise.id}/payment-account`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: account.id, franchiseId: franchise.id, schoolId: null });
    expect(res.body.stripeConnectedAccountId).toBeUndefined();

    const entries = await superuser.auditLogEntry.findMany({ where: { adminUserId: admin.id, targetId: account.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'VIEW_PAYMENT_ACCOUNT', targetType: 'PaymentAccount', schoolId: null, franchiseId: franchise.id });
  });

  it('a FULL_ADMIN can also read it — not restricted to BILLING_PAYMENTS_OPS alone', async () => {
    const { school } = await seedSchoolWithPaymentAccount();
    const admin = await seedAdmin(AdminSubRole.FULL_ADMIN);

    const res = await request(app.getHttpServer())
      .get(`/v1/platform-admin/schools/${school.id}/payment-account`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
  });

  it('a SUPPORT admin gets 403 — Support is explicitly not confirmed to see PaymentAccount configuration', async () => {
    const { school } = await seedSchoolWithPaymentAccount();
    const admin = await seedAdmin(AdminSubRole.SUPPORT);

    const res = await request(app.getHttpServer())
      .get(`/v1/platform-admin/schools/${school.id}/payment-account`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(403);
  });

  it('a School with no PaymentAccount is a clean 404', async () => {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Platform-Admin Payment Account Gate School — no account' } });
    schoolIds.push(school.id);
    const admin = await seedAdmin(AdminSubRole.BILLING_PAYMENTS_OPS);

    const res = await request(app.getHttpServer())
      .get(`/v1/platform-admin/schools/${school.id}/payment-account`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(404);
  });

  it('no token at all is rejected — 401 on both routes', async () => {
    const schoolRes = await request(app.getHttpServer()).get(`/v1/platform-admin/schools/${randomUUID()}/payment-account`);
    expect(schoolRes.status).toBe(401);

    const franchiseRes = await request(app.getHttpServer()).get(`/v1/platform-admin/franchises/${randomUUID()}/payment-account`);
    expect(franchiseRes.status).toBe(401);
  });

  it('the DATABASE column GRANT now allows stripeConnectedAccountId for ultm8_platform_admin (Phase 35, for rotation) — but the READ endpoint still never returns it', async () => {
    const { school, account } = await seedSchoolWithPaymentAccount();

    // Proves the Phase 35 migration actually took effect — a raw query, not
    // going through PlatformAdminPaymentAccountsService's own `select` at all.
    const rows = await platformAdminRoleClient.$queryRaw<Array<{ stripeConnectedAccountId: string }>>`
      SELECT "stripeConnectedAccountId" FROM "PaymentAccount" WHERE id = ${account.id}
    `;
    expect(rows[0]?.stripeConnectedAccountId).toBe(account.stripeConnectedAccountId);

    // FOUND ON REVIEW: proving SELECT now works isn't the same as proving the
    // migration granted ONLY SELECT — a future edit accidentally widening it to
    // GRANT ALL or GRANT SELECT, UPDATE would pass every assertion above without
    // this one. ultm8_platform_admin must still never be able to WRITE this
    // (or any) column — its own RLS policies/grants are read-only by design.
    await expect(
      platformAdminRoleClient.$executeRaw`UPDATE "PaymentAccount" SET "stripeConnectedAccountId" = 'acct_hijacked' WHERE id = ${account.id}`,
    ).rejects.toThrow(/permission denied/i);

    // The DB grant alone doesn't leak it — the READ service's own explicit
    // select is what actually keeps it out of the HTTP response, and still does.
    const admin = await seedAdmin(AdminSubRole.BILLING_PAYMENTS_OPS);
    const res = await request(app.getHttpServer())
      .get(`/v1/platform-admin/schools/${school.id}/payment-account`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.body.stripeConnectedAccountId).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Credential rotation (Phase 35) — see this file's own header comment for
  // why a successful rotation itself (the live Stripe call) isn't tested here.
  // ---------------------------------------------------------------------------

  it('a BILLING_PAYMENTS_OPS admin gets 404 for a nonexistent PaymentAccount id', async () => {
    const admin = await seedAdmin(AdminSubRole.BILLING_PAYMENTS_OPS);
    const res = await request(app.getHttpServer())
      .post(`/v1/platform-admin/payment-accounts/${randomUUID()}/rotate-credential`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(404);
  });

  it('a SUPPORT admin gets 403 on rotate-credential', async () => {
    const { account } = await seedSchoolWithPaymentAccount();
    const admin = await seedAdmin(AdminSubRole.SUPPORT);
    const res = await request(app.getHttpServer())
      .post(`/v1/platform-admin/payment-accounts/${account.id}/rotate-credential`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(403);
  });

  it('rotate-credential on a non-STRIPE PaymentAccount is a clean 400', async () => {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Platform-Admin Rotation Gate School — cash' } });
    schoolIds.push(school.id);
    const account = await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'CASH', accountTitle: 'Cash Account', country: 'US', status: 'ACTIVE', mode: 'TEST' },
    });
    paymentAccountIds.push(account.id);
    const admin = await seedAdmin(AdminSubRole.BILLING_PAYMENTS_OPS);

    const res = await request(app.getHttpServer())
      .post(`/v1/platform-admin/payment-accounts/${account.id}/rotate-credential`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(400);
  });

  it('rotate-credential on a STRIPE PaymentAccount that never completed onboarding is a clean 400 — no existing credential to rotate', async () => {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Platform-Admin Rotation Gate School — not onboarded' } });
    schoolIds.push(school.id);
    const account = await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Not Yet Onboarded', country: 'US', status: 'ACTIVE', mode: 'TEST' },
      // stripeConnectedAccountId deliberately omitted — onboarding never started.
    });
    paymentAccountIds.push(account.id);
    const admin = await seedAdmin(AdminSubRole.BILLING_PAYMENTS_OPS);

    const res = await request(app.getHttpServer())
      .post(`/v1/platform-admin/payment-accounts/${account.id}/rotate-credential`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(400);
  });

  it('no token at all is rejected — 401 on rotate-credential too', async () => {
    const res = await request(app.getHttpServer()).post(`/v1/platform-admin/payment-accounts/${randomUUID()}/rotate-credential`);
    expect(res.status).toBe(401);
  });
});
