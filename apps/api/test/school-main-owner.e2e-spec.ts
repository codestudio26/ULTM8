/**
 * Decision 370: one main owner per School, co-owners, handing over the main
 * owner role after a passcode check, and ULTM8 support moving it.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_PLATFORM_ADMIN,
 * PLATFORM_ADMIN_JWT_SECRET and JWT_ACCESS_SECRET — skips with a warning if
 * any are unset, same convention as every other e2e spec in this repo.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const DATABASE_URL_PLATFORM_ADMIN = process.env.DATABASE_URL_PLATFORM_ADMIN;
const PLATFORM_ADMIN_JWT_SECRET = process.env.PLATFORM_ADMIN_JWT_SECRET;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_PLATFORM_ADMIN && PLATFORM_ADMIN_JWT_SECRET && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[school-main-owner.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_PLATFORM_ADMIN / ' +
      'PLATFORM_ADMIN_JWT_SECRET / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('Main owner and co-owners (Decision 370)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const adminJwt = new JwtService({ secret: PLATFORM_ADMIN_JWT_SECRET });
  const tag = randomUUID().slice(0, 8);
  const PASSCODE = '135790';
  const adminIds: string[] = [];
  let passcodeHash: string;

  type U = { id: string; email: string };
  const http = () => request(app.getHttpServer());
  const ownerToken = (u: U, schoolId: string) =>
    jwt.sign({ sub: u.id, email: u.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId, branchId: null }] });
  const as = (u: U, schoolId: string) => {
    const auth = `Bearer ${ownerToken(u, schoolId)}`;
    return {
      get: (url: string) => http().get(url).set('Authorization', auth),
      post: (url: string) => http().post(url).set('Authorization', auth),
      delete: (url: string) => http().delete(url).set('Authorization', auth),
    };
  };

  const mkUser = (firstName: string) =>
    superuser.user.create({
      data: {
        id: randomUUID(),
        email: `main-owner-${firstName.toLowerCase()}-${tag}-${randomUUID().slice(0, 6)}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName,
        surname: 'Owner',
        passcodeHash,
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
  const ownerGrant = (userId: string, schoolId: string, extra: { isMainOwner?: boolean; grantedAt?: Date } = {}) =>
    superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId, schoolId, ...extra } });
  /** A School with a main owner (flagged) and one co-owner. */
  const seed = async (name: string) => {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: `Main Owner ${name} ${tag}` } });
    const main = await mkUser('Mia');
    const co = await mkUser('Cole');
    const mainGrant = await ownerGrant(main.id, school.id, { isMainOwner: true, grantedAt: new Date('2025-01-01') });
    const coGrant = await ownerGrant(co.id, school.id);
    return { school, main, co, mainGrant, coGrant };
  };
  const stepUp = async (u: U, schoolId: string) => {
    const res = await as(u, schoolId).post('/v1/auth/step-up/verify').send({ passcode: PASSCODE });
    expect(res.status).toBe(201);
    return res.body.stepUpToken as string;
  };
  const staffRow = async (viewer: U, schoolId: string, userId: string) => {
    const res = await as(viewer, schoolId).get(`/v1/schools/${schoolId}/staff`);
    expect(res.status).toBe(200);
    return (res.body.items as { userId: string; mainOwner: boolean }[]).find((i) => i.userId === userId);
  };
  const seedAdmin = async (subRole: 'SUPPORT' | 'FULL_ADMIN') => {
    const admin = await superuser.adminUser.create({
      data: { id: randomUUID(), email: `main-owner-admin-${tag}-${randomUUID()}@example.test`, name: 'Main Owner Admin', subRole, ssoSubject: `cognito-sub-${randomUUID()}` },
    });
    adminIds.push(admin.id);
    return { admin, token: adminJwt.sign({ sub: admin.id, email: admin.email, subRole }) };
  };

  beforeAll(async () => {
    passcodeHash = await bcrypt.hash(PASSCODE, 4);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationDeliveryService)
      .useValue({ sendEmail: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    const schools = await superuser.school.findMany({ where: { name: { contains: tag } }, select: { id: true } });
    const ids = schools.map((s) => s.id);
    await superuser.auditLogEntry.deleteMany({ where: { targetId: { in: ids } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    const users = await superuser.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
    await superuser.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: ids } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('marks the main owner on the staff list; a co-owner can remove another co-owner but never the main owner', async () => {
    const { school, main, co, mainGrant } = await seed('remove');
    const third = await mkUser('Theo');
    const thirdGrant = await ownerGrant(third.id, school.id);

    expect((await staffRow(co, school.id, main.id))?.mainOwner).toBe(true);
    expect((await staffRow(co, school.id, co.id))?.mainOwner).toBe(false);

    const blocked = await as(co, school.id).delete(`/v1/users/${main.id}/role-grants/${mainGrant.id}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MAIN_OWNER');
    // The main owner can't remove themselves either.
    expect((await as(main, school.id).delete(`/v1/users/${main.id}/role-grants/${mainGrant.id}`)).status).toBe(403);

    const removed = await as(co, school.id).delete(`/v1/users/${third.id}/role-grants/${thirdGrant.id}`);
    expect(removed.status).toBe(200);
    expect((await superuser.roleGrant.findUnique({ where: { id: thirdGrant.id } }))?.revokedAt).not.toBeNull();
  });

  it('treats the earliest owner as main where no grant is flagged', async () => {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: `Main Owner unflagged ${tag}` } });
    const first = await mkUser('Fay');
    const later = await mkUser('Lou');
    const firstGrant = await ownerGrant(first.id, school.id, { grantedAt: new Date('2024-01-01') });
    await ownerGrant(later.id, school.id, { grantedAt: new Date('2025-01-01') });

    expect((await staffRow(later, school.id, first.id))?.mainOwner).toBe(true);
    const blocked = await as(later, school.id).delete(`/v1/users/${first.id}/role-grants/${firstGrant.id}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MAIN_OWNER');
  });

  it('lets the main owner hand over the role after a passcode check, and only them', async () => {
    const { school, main, co, mainGrant, coGrant } = await seed('handover');
    const url = `/v1/schools/${school.id}/main-owner`;

    const noStepUp = await as(main, school.id).post(url).send({ userId: co.id });
    expect(noStepUp.status).toBe(403);
    expect(noStepUp.body.error.code).toBe('STEP_UP_REQUIRED');

    const coStepUp = await stepUp(co, school.id);
    const notMain = await as(co, school.id).post(url).set('x-step-up-token', coStepUp).send({ userId: co.id });
    expect(notMain.status).toBe(403);
    expect(notMain.body.error.code).toBe('NOT_MAIN_OWNER');

    const token = await stepUp(main, school.id);
    expect((await as(main, school.id).post(url).set('x-step-up-token', token).send({ userId: main.id })).status).toBe(400);
    const stranger = await mkUser('Sam');
    expect((await as(main, school.id).post(url).set('x-step-up-token', token).send({ userId: stranger.id })).status).toBe(404);

    const before = await superuser.user.findUnique({ where: { id: co.id }, select: { rolesChangedAt: true } });
    const ok = await as(main, school.id).post(url).set('x-step-up-token', token).send({ userId: co.id });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ mainOwnerUserId: co.id });

    expect((await superuser.roleGrant.findUnique({ where: { id: mainGrant.id } }))?.isMainOwner).toBe(false);
    expect((await superuser.roleGrant.findUnique({ where: { id: coGrant.id } }))?.isMainOwner).toBe(true);
    // Who is main doesn't change anyone's access, so nobody's token is refreshed.
    const after = await superuser.user.findUnique({ where: { id: co.id }, select: { rolesChangedAt: true } });
    expect(after?.rolesChangedAt).toEqual(before?.rolesChangedAt);

    // The former main owner is now an ordinary co-owner and can be removed.
    expect((await as(co, school.id).delete(`/v1/users/${main.id}/role-grants/${mainGrant.id}`)).status).toBe(200);
  });

  it('lets any admin see the owners, and only a Full Platform Admin move the main owner', async () => {
    const { school, main, co, mainGrant, coGrant } = await seed('admin');
    const support = await seedAdmin('SUPPORT');
    const full = await seedAdmin('FULL_ADMIN');

    const list = await http().get(`/v1/platform-admin/schools/${school.id}/owners`).set('Authorization', `Bearer ${support.token}`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: { userId: string; mainOwner: boolean }) => [i.userId, i.mainOwner])).toEqual([
      [main.id, true],
      [co.id, false],
    ]);
    expect(await superuser.auditLogEntry.count({ where: { adminUserId: support.admin.id, action: 'VIEW_SCHOOL_OWNERS', targetId: school.id } })).toBe(1);

    const url = `/v1/platform-admin/schools/${school.id}/main-owner`;
    expect((await http().post(url).set('Authorization', `Bearer ${support.token}`).send({ userId: co.id })).status).toBe(403);
    // A tenant token never reaches the admin route.
    expect((await as(main, school.id).post(url).send({ userId: co.id })).status).toBe(401);
    expect((await http().post(url).set('Authorization', `Bearer ${full.token}`).send({ userId: main.id })).status).toBe(400);

    const moved = await http().post(url).set('Authorization', `Bearer ${full.token}`).send({ userId: co.id, removeFormerMainOwner: true });
    expect(moved.status).toBe(201);
    expect(moved.body).toEqual({ mainOwnerUserId: co.id, formerMainOwnerRemoved: true });
    const formerGrant = await superuser.roleGrant.findUnique({ where: { id: mainGrant.id } });
    expect(formerGrant?.revokedAt).not.toBeNull();
    expect((await superuser.roleGrant.findUnique({ where: { id: coGrant.id } }))?.isMainOwner).toBe(true);
    const entry = await superuser.auditLogEntry.findFirst({ where: { adminUserId: full.admin.id, action: 'CHANGE_SCHOOL_MAIN_OWNER', targetId: school.id } });
    expect(entry?.details).toEqual({ fromUserId: main.id, toUserId: co.id, formerMainOwnerRemoved: true });

    // With no co-owner left, there's nobody to move the main owner role to.
    const stranger = await mkUser('Nia');
    expect((await http().post(url).set('Authorization', `Bearer ${full.token}`).send({ userId: stranger.id })).status).toBe(404);
  });

  it('makes whoever creates a School its main owner', async () => {
    const founder = await mkUser('Fred');
    const token = jwt.sign({ sub: founder.id, email: founder.email, grants: [] });
    const res = await http().post('/v1/schools').set('Authorization', `Bearer ${token}`).send({ name: `Main Owner created ${tag}` });
    expect(res.status).toBe(201);
    const g = await superuser.roleGrant.findFirst({ where: { schoolId: res.body.id, userId: founder.id, role: 'SCHOOL_OWNER_MANAGER' } });
    expect(g?.isMainOwner).toBe(true);
  });
});
