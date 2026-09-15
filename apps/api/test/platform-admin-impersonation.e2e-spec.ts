/**
 * HTTP-level gate for PlatformAdminModule Slice 8 (Phase 43) — POST
 * /platform-admin/impersonation-sessions, per Decision 102 (resolved directly
 * with the user, docs/decisions/POST-SPEC-55-DECISION-LOG.md): Support-tier
 * impersonation is read-only.
 *
 * Deliberately proves the mechanism end-to-end across BOTH realms, not just the
 * issuance endpoint in isolation — the returned `accessToken` is a genuine
 * tenant-realm JWT (verified by the SAME JwtStrategy/JwtAuthGuard every ordinary
 * tenant request already goes through), so this suite also drives it against
 * real tenant routes (GET /v1/schools for a read, POST /v1/schools for a write)
 * to confirm JwtStrategy's own read-only enforcement actually blocks a write
 * with that specific token while leaving an ordinary token's own writes
 * untouched.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_PLATFORM_ADMIN,
 * PLATFORM_ADMIN_JWT_SECRET, JWT_ACCESS_SECRET.
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
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(
  DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_PLATFORM_ADMIN && PLATFORM_ADMIN_JWT_SECRET && JWT_ACCESS_SECRET,
);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[platform-admin-impersonation.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / ' +
      'DATABASE_URL_PLATFORM_ADMIN / PLATFORM_ADMIN_JWT_SECRET / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('PlatformAdminModule — impersonation-sessions (Slice 8)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const platformAdminJwt = new JwtService({ secret: PLATFORM_ADMIN_JWT_SECRET });
  // No secret needed for decode() — only used to inspect claims, never to verify
  // (the server itself is what verifies the token when it's sent back as a
  // Bearer header below), same convention tenants.e2e-spec.ts's own join test
  // already established for inspecting a returned accessToken's claims.
  const tenantJwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const adminIds: string[] = [];
  const userIds: string[] = [];
  const schoolIds: string[] = [];

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
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  async function seedAdmin(subRole: AdminSubRole) {
    const admin = await superuser.adminUser.create({
      data: {
        id: randomUUID(),
        email: `platform-admin-impersonation-http-${randomUUID()}@example.test`,
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

  async function seedTenantStudent() {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Impersonation Gate School' } });
    schoolIds.push(school.id);
    const student = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `impersonation-http-student-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'Impersonated',
        surname: 'Student',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(student.id);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id } });
    return { school, student };
  }

  it('a SUPPORT admin CAN start an impersonation session — a genuine tenant-realm token carrying the target\'s own grants', async () => {
    const { school, student } = await seedTenantStudent();
    const admin = await seedAdmin(AdminSubRole.SUPPORT);

    const res = await request(app.getHttpServer())
      .post('/v1/platform-admin/impersonation-sessions')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ userId: student.id });
    expect(res.status).toBe(201);
    expect(res.body.impersonatedUserId).toBe(student.id);
    expect(typeof res.body.accessToken).toBe('string');
    // A near-future expiry, not the ordinary 15-minute tenant default and not
    // some far-future value — proves a real, short TTL was actually applied,
    // not just that SOME date came back.
    const expiresAt = new Date(res.body.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(expiresAt).toBeLessThan(Date.now() + 20 * 60 * 1000);

    const decoded = tenantJwt.decode(res.body.accessToken) as {
      sub: string;
      grants: Array<Record<string, unknown>>;
      impersonation?: { adminUserId: string; startedAt: string };
    };
    expect(decoded.sub).toBe(student.id);
    expect(decoded.grants).toContainEqual(expect.objectContaining({ role: 'STUDENT', schoolId: school.id }));
    expect(decoded.impersonation?.adminUserId).toBe(admin.id);

    const entries = await superuser.auditLogEntry.findMany({ where: { adminUserId: admin.id, targetId: student.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'START_IMPERSONATION_SESSION', targetType: 'User' });
  });

  it('the impersonation token CAN read tenant data as the impersonated user, but a WRITE with the same token is rejected — 403', async () => {
    const { student } = await seedTenantStudent();
    const admin = await seedAdmin(AdminSubRole.SUPPORT);

    const startRes = await request(app.getHttpServer())
      .post('/v1/platform-admin/impersonation-sessions')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ userId: student.id });
    expect(startRes.status).toBe(201);
    const impersonationToken = startRes.body.accessToken;

    // Read — an ordinary tenant endpoint, completely unmodified for this phase,
    // "just works" with the impersonation token (JwtStrategy's own comment).
    const readRes = await request(app.getHttpServer()).get('/v1/schools').set('Authorization', `Bearer ${impersonationToken}`);
    expect(readRes.status).toBe(200);

    // Write — the SAME token, rejected before it ever reaches a controller.
    const writeRes = await request(app.getHttpServer())
      .post('/v1/schools')
      .set('Authorization', `Bearer ${impersonationToken}`)
      .send({ name: 'Should Never Be Created' });
    expect(writeRes.status).toBe(403);

    // Sanity check the rejection is specific to the impersonation token, not
    // that self-service School creation is broken in general — an ORDINARY
    // token for the same user succeeds at the identical write.
    const ordinaryToken = tenantJwt.sign({ sub: student.id, email: student.email, grants: [] });
    const ordinaryWriteRes = await request(app.getHttpServer())
      .post('/v1/schools')
      .set('Authorization', `Bearer ${ordinaryToken}`)
      .send({ name: 'Created By The Real Student' });
    expect(ordinaryWriteRes.status).toBe(201);
    schoolIds.push(ordinaryWriteRes.body.id);
  });

  it('a FULL_ADMIN can also start a session — not restricted to SUPPORT alone', async () => {
    const { student } = await seedTenantStudent();
    const admin = await seedAdmin(AdminSubRole.FULL_ADMIN);

    const res = await request(app.getHttpServer())
      .post('/v1/platform-admin/impersonation-sessions')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ userId: student.id });
    expect(res.status).toBe(201);
  });

  it('a BILLING_PAYMENTS_OPS admin gets 403 — impersonation is confirmed for Support (and Full Admin), not this tier', async () => {
    const { student } = await seedTenantStudent();
    const admin = await seedAdmin(AdminSubRole.BILLING_PAYMENTS_OPS);

    const res = await request(app.getHttpServer())
      .post('/v1/platform-admin/impersonation-sessions')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ userId: student.id });
    expect(res.status).toBe(403);
  });

  it('starting a session for a nonexistent User id is a clean 404', async () => {
    const admin = await seedAdmin(AdminSubRole.SUPPORT);
    const res = await request(app.getHttpServer())
      .post('/v1/platform-admin/impersonation-sessions')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ userId: randomUUID() });
    expect(res.status).toBe(404);
  });

  it('no token at all is rejected — 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/platform-admin/impersonation-sessions')
      .send({ userId: randomUUID() });
    expect(res.status).toBe(401);
  });
});
