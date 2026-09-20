/**
 * HTTP-level gate for SubscriptionPlansModule (Phase 54) — SubscriptionPlan CRUD
 * (FULL_ADMIN-only authoring), `GET /plans` (tenant-JWT-gated), and the
 * subscribe/cancel ownership/existence gates for both School and Franchise.
 *
 * Deliberately does NOT exercise the Stripe-calling half of subscribe()/cancel() —
 * both make real Stripe API calls against `StripeClientService.platformClient()`,
 * and CI's STRIPE_SECRET_KEY is a dummy value (memberships.e2e-spec.ts's own header
 * comment already documents and accepts this identical gap for
 * PaymentsService.charge()/subscribe()). What IS covered here for subscribe/cancel:
 * every check that runs BEFORE the first Stripe call — School/Franchise
 * existence (404), ownership (403), unknown plan (404), and cancel's own "nothing to
 * cancel" (400) — all pure-DB paths in SubscriptionPlansService.
 *
 * The read-only degraded-portal gate (SubscriptionGateService, the correctness-
 * critical piece of this whole phase) IS fully covered — it's pure DB logic, no
 * Stripe involved — proven via `POST /schools/:schoolId/classes`, the same
 * confirmed-blocked action ClassesService.create() gates. `CANCELED` blocks;
 * `null` (never subscribed — the ordinary state of every School before this phase)
 * does not.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET, and
 * PLATFORM_ADMIN_JWT_SECRET — this module spans both identity realms — skips with a
 * warning if any are unset.
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
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const PLATFORM_ADMIN_JWT_SECRET = process.env.PLATFORM_ADMIN_JWT_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET && PLATFORM_ADMIN_JWT_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[subscription-plans.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / ' +
      'JWT_ACCESS_SECRET / PLATFORM_ADMIN_JWT_SECRET not set. This gate MUST run ' +
      'against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('SubscriptionPlansModule — HTTP-level CRUD, subscribe/cancel gates, and the degraded-portal gate', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const tenantJwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const platformAdminJwt = new JwtService({ secret: PLATFORM_ADMIN_JWT_SECRET });

  const adminIds: string[] = [];
  const planIds: string[] = [];
  const schoolIds: string[] = [];
  const franchiseIds: string[] = [];
  const userIds: string[] = [];
  const classIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await superuser.class.deleteMany({ where: { id: { in: classIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    // AuditLogEntry.adminUserId has a real FK to AdminUser — must be deleted first,
    // same order every other admin-CRUD e2e spec in this repo already uses.
    await superuser.auditLogEntry.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await superuser.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await superuser.subscriptionPlan.deleteMany({ where: { id: { in: planIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  async function seedAdmin(subRole: AdminSubRole) {
    const admin = await superuser.adminUser.create({
      data: {
        id: randomUUID(),
        email: `subscription-plans-http-${randomUUID()}@example.test`,
        name: 'HTTP Gate Admin',
        subRole,
        ssoSubject: `cognito-sub-${randomUUID()}`,
      },
    });
    adminIds.push(admin.id);
    return admin;
  }

  function adminToken(admin: { id: string; email: string; subRole: AdminSubRole }) {
    return platformAdminJwt.sign({ sub: admin.id, email: admin.email, subRole: admin.subRole });
  }

  async function seedPlan(overrides: Partial<{ name: string; price: number }> = {}) {
    const plan = await superuser.subscriptionPlan.create({
      data: { id: randomUUID(), name: overrides.name ?? `Fixture Plan ${randomUUID()}`, price: overrides.price ?? 3000 },
    });
    planIds.push(plan.id);
    return plan;
  }

  async function mkTenantUser(label: string) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `subscription-plans-http-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
        firstName: label,
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    userIds.push(user.id);
    return user;
  }

  function tenantToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return tenantJwt.sign({ sub: user.id, email: user.email, grants });
  }

  async function seedSchoolWithOwner(overrides: Partial<{ platformSubscriptionStatus: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' }> = {}) {
    const school = await superuser.school.create({
      data: { id: randomUUID(), name: `Subscription Plans HTTP School ${randomUUID()}`, platformSubscriptionStatus: overrides.platformSubscriptionStatus },
    });
    schoolIds.push(school.id);
    const owner = await mkTenantUser('school-owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    const token = tenantToken(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
    return { school, owner, token };
  }

  async function seedFranchiseWithOwner() {
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: `Subscription Plans HTTP Franchise ${randomUUID()}` } });
    franchiseIds.push(franchise.id);
    const owner = await mkTenantUser('franchise-owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: owner.id, franchiseId: franchise.id } });
    const token = tenantToken(owner, [{ role: 'FRANCHISE_OWNER', franchiseId: franchise.id, schoolId: null, branchId: null }]);
    return { franchise, owner, token };
  }

  // ---------------------------------------------------------------------------
  // Platform Admin authoring CRUD
  // ---------------------------------------------------------------------------

  it('a FULL_ADMIN can create a SubscriptionPlan — 201, audit row has schoolId/franchiseId both null', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const payload = { name: `Growth ${randomUUID()}`, description: 'A growth plan', price: 3000, featureList: ['Feature A', 'Feature B'] };
    const res = await request(app.getHttpServer())
      .post('/v1/platform-admin/subscription-plans')
      .set('Authorization', `Bearer ${adminToken(caller)}`)
      .send(payload);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject(payload);
    planIds.push(res.body.id);

    const entries = await superuser.auditLogEntry.findMany({ where: { adminUserId: caller.id, targetId: res.body.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'CREATE_SUBSCRIPTION_PLAN', targetType: 'SubscriptionPlan', schoolId: null, franchiseId: null });
  });

  it.each([AdminSubRole.SUPPORT, AdminSubRole.BILLING_PAYMENTS_OPS] as const)(
    'a %s caller gets 403 on create — only a Full Platform Admin may author SubscriptionPlans',
    async (subRole) => {
      const caller = await seedAdmin(subRole);
      const res = await request(app.getHttpServer())
        .post('/v1/platform-admin/subscription-plans')
        .set('Authorization', `Bearer ${adminToken(caller)}`)
        .send({ name: 'Should Not Be Created', price: 1000 });
      expect(res.status).toBe(403);
    },
  );

  it('no token at all is rejected — 401 on create/update', async () => {
    const createRes = await request(app.getHttpServer()).post('/v1/platform-admin/subscription-plans').send({ name: 'x', price: 100 });
    expect(createRes.status).toBe(401);
    const patchRes = await request(app.getHttpServer()).patch(`/v1/platform-admin/subscription-plans/${randomUUID()}`).send({ price: 100 });
    expect(patchRes.status).toBe(401);
  });

  it('a FULL_ADMIN can update a SubscriptionPlan — 200, price changed, audit row recorded', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const seeded = await seedPlan();
    const res = await request(app.getHttpServer())
      .patch(`/v1/platform-admin/subscription-plans/${seeded.id}`)
      .set('Authorization', `Bearer ${adminToken(caller)}`)
      .send({ price: 4500 });
    expect(res.status).toBe(200);
    expect(res.body.price).toBe(4500);
    expect(res.body.name).toBe(seeded.name);

    const entries = await superuser.auditLogEntry.findMany({ where: { adminUserId: caller.id, targetId: seeded.id, action: 'UPDATE_SUBSCRIPTION_PLAN' } });
    expect(entries).toHaveLength(1);
  });

  it('updating a nonexistent SubscriptionPlan id is a clean 404', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const res = await request(app.getHttpServer())
      .patch(`/v1/platform-admin/subscription-plans/${randomUUID()}`)
      .set('Authorization', `Bearer ${adminToken(caller)}`)
      .send({ price: 100 });
    expect(res.status).toBe(404);
  });

  it('a non-FULL_ADMIN caller gets 403 on update', async () => {
    const caller = await seedAdmin(AdminSubRole.SUPPORT);
    const seeded = await seedPlan();
    const res = await request(app.getHttpServer())
      .patch(`/v1/platform-admin/subscription-plans/${seeded.id}`)
      .set('Authorization', `Bearer ${adminToken(caller)}`)
      .send({ price: 100 });
    expect(res.status).toBe(403);
  });

  it('rejects a negative price at the DTO layer — 400', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const res = await request(app.getHttpServer())
      .post('/v1/platform-admin/subscription-plans')
      .set('Authorization', `Bearer ${adminToken(caller)}`)
      .send({ name: 'Negative Price Plan', price: -100 });
    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // GET /platform-admin/subscription-plans — Phase 55: the admin-authoring list
  // endpoint the apps/platform-admin authoring UI actually holds a token for (see
  // PlatformAdminSubscriptionPlansController's own header comment for why
  // GET /plans, tenant-JWT-gated, isn't reusable here the way GET /translations is).
  // Authentication-only, no assertFullAdmin — any admin subRole may list.
  // ---------------------------------------------------------------------------

  it('GET platform-admin/subscription-plans requires an admin token — 401 with none', async () => {
    const res = await request(app.getHttpServer()).get('/v1/platform-admin/subscription-plans');
    expect(res.status).toBe(401);
  });

  it('GET platform-admin/subscription-plans lists a seeded plan for any admin subRole, including non-FULL_ADMIN', async () => {
    const seeded = await seedPlan();
    const caller = await seedAdmin(AdminSubRole.SUPPORT);
    const res = await request(app.getHttpServer())
      .get('/v1/platform-admin/subscription-plans')
      .set('Authorization', `Bearer ${adminToken(caller)}`);
    expect(res.status).toBe(200);
    expect(res.body.items.some((item: { id: string }) => item.id === seeded.id)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // GET /plans — tenant-JWT-gated (not public, unlike GET /translations)
  // ---------------------------------------------------------------------------

  it('GET /plans requires a tenant token — 401 with none', async () => {
    const res = await request(app.getHttpServer()).get('/v1/plans');
    expect(res.status).toBe(401);
  });

  it('GET /plans with a valid tenant token lists a seeded plan', async () => {
    const seeded = await seedPlan();
    const { token } = await seedSchoolWithOwner();
    const res = await request(app.getHttpServer()).get('/v1/plans').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items.some((item: { id: string }) => item.id === seeded.id)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Subscribe/cancel — Stripe-free paths only (ownership/existence/no-op gates,
  // all of which run before the first Stripe call in SubscriptionPlansService).
  // ---------------------------------------------------------------------------

  it('subscribing under another tenant\'s School is a clean 404 — never reaches Stripe', async () => {
    const { token: tokenA } = await seedSchoolWithOwner();
    const { school: schoolB } = await seedSchoolWithOwner();
    const plan = await seedPlan();
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolB.id}/subscription-plans/${plan.id}/subscribe`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(404);
  });

  it('subscribing to an unknown plan id is a clean 404 — never reaches Stripe', async () => {
    const { school, token } = await seedSchoolWithOwner();
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/subscription-plans/${randomUUID()}/subscribe`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('a non-owner (Branch Staff) cannot subscribe their School — 403', async () => {
    const { school } = await seedSchoolWithOwner();
    const plan = await seedPlan();
    const staff = await mkTenantUser('branch-staff');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: staff.id, schoolId: school.id } });
    const staffToken = tenantToken(staff, [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: null }]);
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/subscription-plans/${plan.id}/subscribe`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it('cancelling with no active platform subscription is a clean 400 — never reaches Stripe', async () => {
    const { school, token } = await seedSchoolWithOwner();
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/subscription/cancel`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('a non-owner cannot cancel a Franchise\'s platform subscription — 403', async () => {
    const { franchise } = await seedFranchiseWithOwner();
    const outsider = await mkTenantUser('outsider');
    const outsiderToken = tenantToken(outsider, []);
    const res = await request(app.getHttpServer())
      .post(`/v1/franchises/${franchise.id}/subscription/cancel`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    // Zero grants at all — FranchisesService.findOne() itself already returns 404
    // (RLS: no visible row), not 403 — same "existence and authorization checks
    // are indistinguishable by design" reasoning SchoolsService.findOne()'s own
    // comment documents.
    expect(res.status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // The degraded-portal gate itself (SubscriptionGateService) — pure DB logic,
  // fully testable without Stripe. Proven via POST /schools/:id/classes, one of
  // the three confirmed-blocked actions.
  // ---------------------------------------------------------------------------

  function classBody(overrides: Record<string, unknown> = {}) {
    return {
      title: 'Degraded-Gate Fixture Class',
      activities: ['BJJ'],
      startDate: '2026-10-01T10:00:00.000Z',
      endDate: '2026-10-01T11:00:00.000Z',
      ...overrides,
    };
  }

  it('a School with platformSubscriptionStatus CANCELED cannot create a new Class — 403, read-only portal', async () => {
    const { school, token } = await seedSchoolWithOwner({ platformSubscriptionStatus: 'CANCELED' });
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/classes`)
      .set('Authorization', `Bearer ${token}`)
      .send(classBody());
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/read-only/i);
  });

  it('a School that never subscribed (platformSubscriptionStatus null) is unaffected — Class creation still succeeds', async () => {
    const { school, token } = await seedSchoolWithOwner();
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/classes`)
      .set('Authorization', `Bearer ${token}`)
      .send(classBody());
    expect(res.status).toBe(201);
    classIds.push(res.body.id);
  });

  it('a School with platformSubscriptionStatus PAST_DUE is unaffected — still inside Stripe\'s own retry grace period', async () => {
    const { school, token } = await seedSchoolWithOwner({ platformSubscriptionStatus: 'PAST_DUE' });
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/classes`)
      .set('Authorization', `Bearer ${token}`)
      .send(classBody());
    expect(res.status).toBe(201);
    classIds.push(res.body.id);
  });
});
