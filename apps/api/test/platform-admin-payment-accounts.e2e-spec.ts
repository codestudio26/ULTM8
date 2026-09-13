/**
 * HTTP-level gate for PlatformAdminModule Slice 6 (Phase 30) — GET
 * .../payment-account, School- and Franchise-scoped, mirroring the shape of
 * platform-admin-schools.e2e-spec.ts / platform-admin-franchises.e2e-spec.ts.
 * What's actually NEW here (not already proven by those two files) is what
 * this file focuses on: the FIRST subRole-restricted READ in this module
 * (BILLING_PAYMENTS_OPS + FULL_ADMIN only, SUPPORT excluded — see
 * PlatformAdminPaymentAccountsService's own header comment for why), and that
 * stripeConnectedAccountId is excluded at both the DTO layer and the
 * DATABASE column-GRANT layer. Realm isolation, the revokedAt re-check, and
 * AuditLogEntry immutability are already proven generically in the School
 * suite and are not re-tested per entity here.
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

  it('the DATABASE column GRANT itself rejects stripeConnectedAccountId for ultm8_platform_admin', async () => {
    const { account } = await seedSchoolWithPaymentAccount();
    await expect(
      platformAdminRoleClient.$queryRaw`SELECT "stripeConnectedAccountId" FROM "PaymentAccount" WHERE id = ${account.id}`,
    ).rejects.toThrow(/permission denied/i);
  });
});
