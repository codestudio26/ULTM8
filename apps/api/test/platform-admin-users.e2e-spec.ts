/**
 * HTTP-level gate for PlatformAdminModule Slice 4 (Phase 28) — POST/GET
 * /platform-admin/admin-users, mirroring the shape of the existing
 * platform-admin-schools.e2e-spec.ts / platform-admin-franchises.e2e-spec.ts
 * gates. What's actually NEW here (not already proven by those two files) is
 * what this file focuses on: the FULL_ADMIN-only authorization check (the
 * first subRole restriction any PlatformAdminModule endpoint enforces), the
 * P2002-to-409 mapping on duplicate email/ssoSubject, and that the resulting
 * audit row correctly has both schoolId and franchiseId null (Platform
 * Admin's own roster, not tenant data — see PlatformAdminUsersService's own
 * comment). Realm isolation, the revokedAt re-check, and AuditLogEntry
 * immutability are already proven generically in the School suite and are
 * not re-tested per entity here.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, PLATFORM_ADMIN_JWT_SECRET — skips
 * with a warning if any are unset, same convention as every other HTTP-level
 * gate in this repo. Unlike the Schools/Franchises gates, this endpoint reads
 * and writes AdminUser directly (no RLS, no dedicated Postgres role — see
 * that service's own comment), so DATABASE_URL_PLATFORM_ADMIN isn't needed.
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
const PLATFORM_ADMIN_JWT_SECRET = process.env.PLATFORM_ADMIN_JWT_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && PLATFORM_ADMIN_JWT_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[platform-admin-users.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / ' +
      'PLATFORM_ADMIN_JWT_SECRET not set. This gate MUST run against a real Postgres ' +
      'in CI; a local skip is not a substitute.',
  );
}

describeIfDb('PlatformAdminModule — /platform-admin/admin-users (Slice 4)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const platformAdminJwt = new JwtService({ secret: PLATFORM_ADMIN_JWT_SECRET });

  const adminIds: string[] = [];

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
    await superuser.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  async function seedAdmin(subRole: AdminSubRole) {
    const admin = await superuser.adminUser.create({
      data: {
        id: randomUUID(),
        email: `platform-admin-users-http-${randomUUID()}@example.test`,
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

  function newAdminPayload() {
    const id = randomUUID();
    return {
      email: `invited-admin-${id}@example.test`,
      name: 'Invited Admin',
      subRole: AdminSubRole.SUPPORT,
      ssoSubject: `cognito-sub-invited-${id}`,
    };
  }

  it('a FULL_ADMIN can create a new AdminUser — 201, and the audit row has schoolId/franchiseId both null', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const payload = newAdminPayload();
    const res = await request(app.getHttpServer())
      .post('/v1/platform-admin/admin-users')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send(payload);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: payload.email, name: payload.name, subRole: payload.subRole });
    expect(res.body.ssoSubject).toBeUndefined();
    adminIds.push(res.body.id);

    const entries = await superuser.auditLogEntry.findMany({ where: { adminUserId: caller.id, targetId: res.body.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'CREATE_ADMIN_USER',
      targetType: 'AdminUser',
      schoolId: null,
      franchiseId: null,
    });
  });

  it('a FULL_ADMIN can list AdminUsers — 200, includes a just-created one', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const created = await superuser.adminUser.create({
      data: {
        id: randomUUID(),
        email: `platform-admin-users-list-${randomUUID()}@example.test`,
        name: 'Listed Admin',
        subRole: AdminSubRole.SUPPORT,
        ssoSubject: `cognito-sub-list-${randomUUID()}`,
      },
    });
    adminIds.push(created.id);

    const res = await request(app.getHttpServer())
      .get('/v1/platform-admin/admin-users')
      .set('Authorization', `Bearer ${tokenFor(caller)}`);
    expect(res.status).toBe(200);
    expect(res.body.items.some((item: { id: string }) => item.id === created.id)).toBe(true);
    expect(res.body.items.every((item: { ssoSubject?: string }) => item.ssoSubject === undefined)).toBe(true);

    // "Who else has Platform Admin access" is itself sensitive — this list is
    // audited on every successful call, same as PlatformAdminSchoolsService
    // audits every successful School view, not only writes.
    const entries = await superuser.auditLogEntry.findMany({ where: { adminUserId: caller.id, action: 'LIST_ADMIN_USERS' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ targetType: 'AdminUser', schoolId: null, franchiseId: null });
  });

  it('an invalid subRole enum value is a clean 400, not a 500', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const res = await request(app.getHttpServer())
      .post('/v1/platform-admin/admin-users')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({ ...newAdminPayload(), subRole: 'NOT_A_REAL_SUBROLE' });
    expect(res.status).toBe(400);
  });

  it('an unexpected extra body field is rejected by the global ValidationPipe — 400', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const res = await request(app.getHttpServer())
      .post('/v1/platform-admin/admin-users')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({ ...newAdminPayload(), revokedAt: null });
    expect(res.status).toBe(400);
  });

  it.each([AdminSubRole.SUPPORT, AdminSubRole.BILLING_PAYMENTS_OPS] as const)(
    'a %s caller gets 403 on both create and list — only a Full Platform Admin may manage other admin accounts',
    async (subRole) => {
      const caller = await seedAdmin(subRole);
      const createRes = await request(app.getHttpServer())
        .post('/v1/platform-admin/admin-users')
        .set('Authorization', `Bearer ${tokenFor(caller)}`)
        .send(newAdminPayload());
      expect(createRes.status).toBe(403);

      const listRes = await request(app.getHttpServer())
        .get('/v1/platform-admin/admin-users')
        .set('Authorization', `Bearer ${tokenFor(caller)}`);
      expect(listRes.status).toBe(403);
    },
  );

  it('a duplicate email is a clean 409, not a 500', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const payload = newAdminPayload();
    const first = await request(app.getHttpServer())
      .post('/v1/platform-admin/admin-users')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send(payload);
    expect(first.status).toBe(201);
    adminIds.push(first.body.id);

    const second = await request(app.getHttpServer())
      .post('/v1/platform-admin/admin-users')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({ ...payload, ssoSubject: `cognito-sub-${randomUUID()}` });
    expect(second.status).toBe(409);
  });

  it('a duplicate ssoSubject is also a clean 409', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const payload = newAdminPayload();
    const first = await request(app.getHttpServer())
      .post('/v1/platform-admin/admin-users')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send(payload);
    expect(first.status).toBe(201);
    adminIds.push(first.body.id);

    const second = await request(app.getHttpServer())
      .post('/v1/platform-admin/admin-users')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({ ...payload, email: `other-${randomUUID()}@example.test` });
    expect(second.status).toBe(409);
  });

  it('no token at all is rejected — 401 on both routes', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/v1/platform-admin/admin-users')
      .send(newAdminPayload());
    expect(createRes.status).toBe(401);

    const listRes = await request(app.getHttpServer()).get('/v1/platform-admin/admin-users');
    expect(listRes.status).toBe(401);
  });
});
