/**
 * HTTP-level gate for PlatformAdminModule Slice 1 (Phase 25) — the auth spine only:
 * verify a Cognito ID token, map it to an AdminUser, issue ULTM8's own Platform Admin
 * JWT, and prove the resulting token actually gates GET /platform-admin/auth/me.
 *
 * No real Cognito User Pool is reachable in this sandbox (or in CI) — same class of
 * gap this codebase already accepts for the live-Stripe-call path (see
 * franchise-fees.e2e-spec.ts's own header comment). Unlike that case, this endpoint's
 * entire point IS verify-then-map-then-issue, so skipping success-path coverage
 * entirely would leave the actual feature unproven. Fixed by substituting a stub
 * CognitoTokenVerifierService via NestJS's own `overrideProvider` — the first use of
 * that pattern in this test suite — which lets every assertion below exercise this
 * module's REAL code (AdminUser lookup, revokedAt check, JWT issuance,
 * PlatformAdminJwtAuthGuard) against a controlled, known verifier result, rather than
 * either mocking HTTP responses or skipping the success path outright.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, PLATFORM_ADMIN_JWT_SECRET, JWT_ACCESS_SECRET
 * (the last one for the cross-realm-token-rejection test below) — skips with a warning
 * if any are unset, same convention as every other HTTP-level gate in this repo.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { CognitoTokenVerifierService, VerifiedCognitoIdToken } from '../src/platform-admin/cognito-token-verifier.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const PLATFORM_ADMIN_JWT_SECRET = process.env.PLATFORM_ADMIN_JWT_SECRET;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && PLATFORM_ADMIN_JWT_SECRET && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[platform-admin-auth.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / ' +
      'PLATFORM_ADMIN_JWT_SECRET / JWT_ACCESS_SECRET not set. This gate MUST run ' +
      'against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('PlatformAdminModule — auth spine (Cognito token exchange, /me)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const tenantJwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  // For decoding/verifying tokens THIS module issues — see the success-path test
  // below, which asserts the signed payload's own claims directly rather than only
  // the DB-derived /me response (FOUND ON REVIEW: /me re-fetches from the DB because
  // it needs `name`, which isn't in the JWT — that's a side effect of needing that
  // field, not proof the token's own email/subRole claims are actually correct).
  const platformAdminJwt = new JwtService({ secret: PLATFORM_ADMIN_JWT_SECRET });

  // Mutable so each test can control what the "Cognito" verification returns without
  // a real network call — see this file's own header comment.
  let stubVerifierResult: VerifiedCognitoIdToken | Error = { sub: 'stub-sub-unset', email: 'unset@example.test' };
  const stubVerifier: Pick<CognitoTokenVerifierService, 'verify'> = {
    verify: async () => {
      if (stubVerifierResult instanceof Error) throw stubVerifierResult;
      return stubVerifierResult;
    },
  };

  const adminIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CognitoTokenVerifierService)
      .useValue(stubVerifier)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await superuser.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  async function seedAdmin(overrides: Partial<{ subRole: 'SUPPORT' | 'BILLING_PAYMENTS_OPS' | 'FULL_ADMIN'; revokedAt: Date | null }> = {}) {
    const ssoSubject = `cognito-sub-${randomUUID()}`;
    const admin = await superuser.adminUser.create({
      data: {
        id: randomUUID(),
        email: `platform-admin-http-${randomUUID()}@example.test`,
        name: 'HTTP Gate Admin',
        subRole: overrides.subRole ?? 'SUPPORT',
        ssoSubject,
        revokedAt: overrides.revokedAt ?? null,
      },
    });
    adminIds.push(admin.id);
    return admin;
  }

  it('exchanging a valid Cognito token for a provisioned, active AdminUser succeeds — 201, the SIGNED TOKEN carries the correct claims, and it gates /me', async () => {
    const admin = await seedAdmin({ subRole: 'FULL_ADMIN' });
    stubVerifierResult = { sub: admin.ssoSubject, email: admin.email };

    const exchangeRes = await request(app.getHttpServer())
      .post('/v1/platform-admin/auth/exchange')
      .send({ idToken: 'stub-cognito-id-token' });
    expect(exchangeRes.status).toBe(201);
    expect(typeof exchangeRes.body.accessToken).toBe('string');

    // Asserted directly on the decoded token, not just on /me's response — /me
    // derives its response from a fresh DB lookup keyed on `sub` alone, so it would
    // report correct values even if the token's OWN email/subRole claims were wrong.
    const decoded = platformAdminJwt.verify(exchangeRes.body.accessToken);
    expect(decoded).toMatchObject({ sub: admin.id, email: admin.email, subRole: 'FULL_ADMIN' });

    const meRes = await request(app.getHttpServer())
      .get('/v1/platform-admin/auth/me')
      .set('Authorization', `Bearer ${exchangeRes.body.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body).toMatchObject({ id: admin.id, email: admin.email, name: admin.name, subRole: 'FULL_ADMIN' });
  });

  it('a second exchange for the same already-matched AdminUser still succeeds — 201, login is idempotent, not a first-time-only action', async () => {
    const admin = await seedAdmin();
    stubVerifierResult = { sub: admin.ssoSubject, email: admin.email };

    const first = await request(app.getHttpServer())
      .post('/v1/platform-admin/auth/exchange')
      .send({ idToken: 'stub-cognito-id-token' });
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post('/v1/platform-admin/auth/exchange')
      .send({ idToken: 'stub-cognito-id-token' });
    expect(second.status).toBe(201);
    expect(typeof second.body.accessToken).toBe('string');
  });

  it('POST /platform-admin/auth/exchange rejects an unexpected extra field on the body — 400 (forbidNonWhitelisted)', async () => {
    // Asserted explicitly, not assumed — same convention users.e2e-spec.ts's own
    // header comment already establishes for this exact ValidationPipe behavior,
    // worth proving directly on the highest-privilege identity boundary's own DTO
    // too, not just trusted to still be globally configured correctly.
    const res = await request(app.getHttpServer())
      .post('/v1/platform-admin/auth/exchange')
      .send({ idToken: 'stub-cognito-id-token', subRole: 'FULL_ADMIN' });
    expect(res.status).toBe(400);
  });

  it('a Cognito token verifying successfully but matching no AdminUser is rejected — 401, not treated as a new signup', async () => {
    stubVerifierResult = { sub: `cognito-sub-${randomUUID()}`, email: 'nobody-provisioned@example.test' };
    const res = await request(app.getHttpServer())
      .post('/v1/platform-admin/auth/exchange')
      .send({ idToken: 'stub-cognito-id-token' });
    expect(res.status).toBe(401);
  });

  it('a revoked AdminUser is rejected even with an otherwise-valid Cognito token — 401', async () => {
    const admin = await seedAdmin({ revokedAt: new Date() });
    stubVerifierResult = { sub: admin.ssoSubject, email: admin.email };
    const res = await request(app.getHttpServer())
      .post('/v1/platform-admin/auth/exchange')
      .send({ idToken: 'stub-cognito-id-token' });
    expect(res.status).toBe(401);
  });

  it('a Cognito token that fails verification itself (bad signature, expired, wrong pool) is rejected — 401', async () => {
    stubVerifierResult = new Error('stub: Cognito signature verification failed');
    const res = await request(app.getHttpServer())
      .post('/v1/platform-admin/auth/exchange')
      .send({ idToken: 'garbage' });
    expect(res.status).toBe(401);
  });

  it('POST /platform-admin/auth/exchange rejects a missing idToken — 400', async () => {
    const res = await request(app.getHttpServer()).post('/v1/platform-admin/auth/exchange').send({});
    expect(res.status).toBe(400);
  });

  it('GET /platform-admin/auth/me with no token is rejected — 401', async () => {
    const res = await request(app.getHttpServer()).get('/v1/platform-admin/auth/me');
    expect(res.status).toBe(401);
  });

  it('a TENANT access token (customer realm) does not work against /me — the two realms are structurally separate, not just conventionally kept apart', async () => {
    // Proves the isolation claim in PlatformAdminJwtStrategy's own header comment
    // directly, rather than only asserting it in prose: a token signed with the
    // tenant realm's own secret (JWT_ACCESS_SECRET) and shape (JwtPayload, not
    // AdminJwtPayload) must fail signature verification against
    // PLATFORM_ADMIN_JWT_SECRET — different secrets, so this is expected to fail
    // even before any claims-shape mismatch would matter.
    const tenantToken = tenantJwt.sign({ sub: randomUUID(), email: 'tenant-user@example.test', grants: [] });
    const res = await request(app.getHttpServer())
      .get('/v1/platform-admin/auth/me')
      .set('Authorization', `Bearer ${tenantToken}`);
    expect(res.status).toBe(401);
  });
});
