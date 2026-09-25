/**
 * HTTP-level gate for TenantLifecycleModule (Phase 56, Decision 110) — the
 * close-account/reactivate actions for School and Franchise, plus the
 * archived-gate they unblock (TenantAuthorizationService.assertSchoolNotArchived/
 * assertFranchiseNotArchived, wired into all 10 services Decision 110 names).
 * Exercises two representative gated endpoints end-to-end (School's own PATCH,
 * and Branch's POST — a School-owned child entity) rather than all 10 — the
 * gate itself is one centralized method reused at every call site, so this
 * proves the mechanism works over HTTP without redundantly re-testing an
 * identical two-line guard 20 times.
 *
 * Same "sign tokens directly, no real Cognito/Twilio" convention as every
 * other platform-admin/*.e2e-spec.ts and tenants.e2e-spec.ts in this repo.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_PLATFORM_ADMIN,
 * PLATFORM_ADMIN_JWT_SECRET, JWT_ACCESS_SECRET — skips with a warning if any
 * are unset, same convention as every other HTTP-level gate in this repo.
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
    '[tenant-lifecycle.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / ' +
      'DATABASE_URL_PLATFORM_ADMIN / PLATFORM_ADMIN_JWT_SECRET / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('TenantLifecycleModule — close-account/reactivate + the archived-gate (Phase 56, Decision 110)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const platformAdminJwt = new JwtService({ secret: PLATFORM_ADMIN_JWT_SECRET });
  const tenantJwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const adminIds: string[] = [];
  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const franchiseIds: string[] = [];

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
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  async function seedAdmin(subRole: 'SUPPORT' | 'FULL_ADMIN') {
    const admin = await superuser.adminUser.create({
      data: {
        id: randomUUID(),
        email: `tenant-lifecycle-${randomUUID()}@example.test`,
        name: 'Lifecycle Gate Admin',
        subRole,
        ssoSubject: `cognito-sub-${randomUUID()}`,
      },
    });
    adminIds.push(admin.id);
    return admin;
  }

  function adminToken(admin: { id: string; email: string; subRole: string }) {
    return platformAdminJwt.sign({ sub: admin.id, email: admin.email, subRole: admin.subRole });
  }

  async function seedSchoolWithOwner(name: string) {
    const school = await superuser.school.create({ data: { id: randomUUID(), name } });
    schoolIds.push(school.id);
    const owner = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `tenant-lifecycle-owner-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'Owner',
        surname: 'Lifecycle',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(owner.id);
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
    });
    const ownerToken = tenantJwt.sign({
      sub: owner.id,
      email: owner.email,
      grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }],
    });
    return { school, owner, ownerToken };
  }

  async function seedFranchiseWithOwner(name: string) {
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name } });
    franchiseIds.push(franchise.id);
    const owner = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `tenant-lifecycle-fowner-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: 'FOwner',
        surname: 'Lifecycle',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(owner.id);
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: owner.id, franchiseId: franchise.id },
    });
    return { franchise, owner };
  }

  it('a FULL_ADMIN can close a School with the correct confirmName — 200, archivedAt/purgeAt set ~90 days out, audited', async () => {
    const fullAdmin = await seedAdmin('FULL_ADMIN');
    const { school } = await seedSchoolWithOwner('Lifecycle Close School A');

    const res = await request(app.getHttpServer())
      .post(`/v1/platform-admin/schools/${school.id}/close`)
      .set('Authorization', `Bearer ${adminToken(fullAdmin)}`)
      .send({ confirmName: school.name });

    expect(res.status).toBe(201); // NestJS default for @Post() with no @HttpCode override
    expect(res.body.archivedAt).toBeTruthy();
    expect(res.body.purgeAt).toBeTruthy();
    expect(res.body.purgedAt).toBeNull();
    const days = (new Date(res.body.purgeAt).getTime() - new Date(res.body.archivedAt).getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(90, 0);

    const entries = await superuser.auditLogEntry.findMany({ where: { adminUserId: fullAdmin.id, targetId: school.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'CLOSE_SCHOOL_ACCOUNT', targetType: 'School', schoolId: school.id });
  });

  it('a SUPPORT-tier admin cannot close a School — 403', async () => {
    const supportAdmin = await seedAdmin('SUPPORT');
    const { school } = await seedSchoolWithOwner('Lifecycle Close School B');

    const res = await request(app.getHttpServer())
      .post(`/v1/platform-admin/schools/${school.id}/close`)
      .set('Authorization', `Bearer ${adminToken(supportAdmin)}`)
      .send({ confirmName: school.name });
    expect(res.status).toBe(403);
  });

  it('a wrong confirmName is rejected — 400', async () => {
    const fullAdmin = await seedAdmin('FULL_ADMIN');
    const { school } = await seedSchoolWithOwner('Lifecycle Close School C');

    const res = await request(app.getHttpServer())
      .post(`/v1/platform-admin/schools/${school.id}/close`)
      .set('Authorization', `Bearer ${adminToken(fullAdmin)}`)
      .send({ confirmName: 'Not The Right Name' });
    expect(res.status).toBe(400);
  });

  it('closing an already-closed School is rejected — 409', async () => {
    const fullAdmin = await seedAdmin('FULL_ADMIN');
    const { school } = await seedSchoolWithOwner('Lifecycle Close School D');

    const first = await request(app.getHttpServer())
      .post(`/v1/platform-admin/schools/${school.id}/close`)
      .set('Authorization', `Bearer ${adminToken(fullAdmin)}`)
      .send({ confirmName: school.name });
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post(`/v1/platform-admin/schools/${school.id}/close`)
      .set('Authorization', `Bearer ${adminToken(fullAdmin)}`)
      .send({ confirmName: school.name });
    expect(second.status).toBe(409);
  });

  it('closing a nonexistent School is a clean 404', async () => {
    const fullAdmin = await seedAdmin('FULL_ADMIN');
    const res = await request(app.getHttpServer())
      .post(`/v1/platform-admin/schools/${randomUUID()}/close`)
      .set('Authorization', `Bearer ${adminToken(fullAdmin)}`)
      .send({ confirmName: 'Whatever' });
    expect(res.status).toBe(404);
  });

  it('no token at all is rejected — 401', async () => {
    const { school } = await seedSchoolWithOwner('Lifecycle Close School E');
    const res = await request(app.getHttpServer())
      .post(`/v1/platform-admin/schools/${school.id}/close`)
      .send({ confirmName: school.name });
    expect(res.status).toBe(401);
  });

  it('the archived-gate: a closed School refuses PATCH /schools/:id from its own Owner — 403, with the specific reason', async () => {
    const fullAdmin = await seedAdmin('FULL_ADMIN');
    const { school, ownerToken } = await seedSchoolWithOwner('Lifecycle Gated School A');

    await request(app.getHttpServer())
      .post(`/v1/platform-admin/schools/${school.id}/close`)
      .set('Authorization', `Bearer ${adminToken(fullAdmin)}`)
      .send({ confirmName: school.name })
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/v1/schools/${school.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Trying To Rename A Closed School' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/closed/i);
  });

  it('the archived-gate: a closed School refuses POST /schools/:schoolId/branches (a different one of the 10 gated services) — 403', async () => {
    const fullAdmin = await seedAdmin('FULL_ADMIN');
    const { school, ownerToken } = await seedSchoolWithOwner('Lifecycle Gated School B');

    await request(app.getHttpServer())
      .post(`/v1/platform-admin/schools/${school.id}/close`)
      .set('Authorization', `Bearer ${adminToken(fullAdmin)}`)
      .send({ confirmName: school.name })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/branches`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'A New Branch On A Closed School' });
    expect(res.status).toBe(403);
  });

  it('reactivating clears archivedAt/purgeAt and lifts the gate — PATCH succeeds again after', async () => {
    const fullAdmin = await seedAdmin('FULL_ADMIN');
    const { school, ownerToken } = await seedSchoolWithOwner('Lifecycle Reactivate School A');

    await request(app.getHttpServer())
      .post(`/v1/platform-admin/schools/${school.id}/close`)
      .set('Authorization', `Bearer ${adminToken(fullAdmin)}`)
      .send({ confirmName: school.name })
      .expect(201);

    const reactivated = await request(app.getHttpServer())
      .post(`/v1/platform-admin/schools/${school.id}/reactivate`)
      .set('Authorization', `Bearer ${adminToken(fullAdmin)}`);
    expect(reactivated.status).toBe(201);
    expect(reactivated.body.archivedAt).toBeNull();
    expect(reactivated.body.purgeAt).toBeNull();

    const patched = await request(app.getHttpServer())
      .patch(`/v1/schools/${school.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Reactivated School, Renamed' });
    expect(patched.status).toBe(200);
    expect(patched.body.name).toBe('Reactivated School, Renamed');
  });

  it('reactivating a School that is not closed is rejected — 409', async () => {
    const fullAdmin = await seedAdmin('FULL_ADMIN');
    const { school } = await seedSchoolWithOwner('Lifecycle Reactivate School B');

    const res = await request(app.getHttpServer())
      .post(`/v1/platform-admin/schools/${school.id}/reactivate`)
      .set('Authorization', `Bearer ${adminToken(fullAdmin)}`);
    expect(res.status).toBe(409);
  });

  it('reactivating an already-purged School is rejected — 409 (no undo once the purge job has run)', async () => {
    const fullAdmin = await seedAdmin('FULL_ADMIN');
    const { school } = await seedSchoolWithOwner('Lifecycle Reactivate School C');
    await superuser.school.update({
      where: { id: school.id },
      data: { archivedAt: new Date('2026-01-01'), purgeAt: new Date('2026-04-01'), purgedAt: new Date('2026-04-02') },
    });

    const res = await request(app.getHttpServer())
      .post(`/v1/platform-admin/schools/${school.id}/reactivate`)
      .set('Authorization', `Bearer ${adminToken(fullAdmin)}`);
    expect(res.status).toBe(409);
  });

  it('the same close/reactivate lifecycle works for Franchise, via its own FRANCHISE_OWNER-gated PATCH', async () => {
    const fullAdmin = await seedAdmin('FULL_ADMIN');
    const { franchise } = await seedFranchiseWithOwner('Lifecycle Close Franchise A');

    const closed = await request(app.getHttpServer())
      .post(`/v1/platform-admin/franchises/${franchise.id}/close`)
      .set('Authorization', `Bearer ${adminToken(fullAdmin)}`)
      .send({ confirmName: franchise.name });
    expect(closed.status).toBe(201);
    expect(closed.body.archivedAt).toBeTruthy();

    const entries = await superuser.auditLogEntry.findMany({ where: { adminUserId: fullAdmin.id, targetId: franchise.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'CLOSE_FRANCHISE_ACCOUNT', targetType: 'Franchise', franchiseId: franchise.id });

    const reactivated = await request(app.getHttpServer())
      .post(`/v1/platform-admin/franchises/${franchise.id}/reactivate`)
      .set('Authorization', `Bearer ${adminToken(fullAdmin)}`);
    expect(reactivated.status).toBe(201);
    expect(reactivated.body.archivedAt).toBeNull();
  });
});
