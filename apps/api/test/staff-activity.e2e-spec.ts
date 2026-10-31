/**
 * Decision 408: the Staff page's activity log. Each staff change writes one
 * line (who, about whom, what changed, when) in the same step as the change.
 * Owners and co-owners read it, newest first, 50 at a time; nobody else can.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP and JWT_ACCESS_SECRET — skips with a
 * warning if any are unset, same convention as every other e2e spec in this repo.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[staff-activity.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

const DEFAULTS = { classes: false, bookings: true, students: true, cancelClasses: true, staffList: false, inviteCoaches: false, disciplines: false, checkInRules: false, exportStudents: false, freezeMemberships: false, memberFiles: false };

describeIfDb('Staff activity log (Decision 408)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const tag = randomUUID().slice(0, 8);
  const previousBaseUrl = process.env.PORTAL_BASE_URL;
  const sent: string[] = [];

  type U = { id: string; email: string };
  type Role = 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'BRANCH_STAFF';
  type Grant = { role: Role; schoolId: string; branchId: string | null };
  const http = () => request(app.getHttpServer());
  const as = (u: U, grants: Grant[]) => {
    const auth = `Bearer ${jwt.sign({ sub: u.id, email: u.email, grants: grants.map((g) => ({ franchiseId: null, ...g })) })}`;
    return {
      get: (url: string) => http().get(url).set('Authorization', auth),
      post: (url: string) => http().post(url).set('Authorization', auth),
      put: (url: string) => http().put(url).set('Authorization', auth),
      patch: (url: string) => http().patch(url).set('Authorization', auth),
      delete: (url: string) => http().delete(url).set('Authorization', auth),
    };
  };
  const mkUser = (firstName: string) =>
    superuser.user.create({
      data: {
        id: randomUUID(),
        email: `staff-activity-${firstName.toLowerCase()}-${tag}-${randomUUID().slice(0, 6)}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName,
        surname: 'Log',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
  const grant = (userId: string, schoolId: string, role: Role, branchId: string | null = null, isMainOwner = false) =>
    superuser.roleGrant.create({ data: { id: randomUUID(), role, userId, schoolId, branchId, isMainOwner } });

  const seed = async (name: string) => {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: `Staff Activity ${name} ${tag}` } });
    const branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: `North ${tag}` } });
    const own = await mkUser('Olga');
    await grant(own.id, school.id, 'SCHOOL_OWNER_MANAGER', null, true);
    const coOwner = await mkUser('Cora');
    await grant(coOwner.id, school.id, 'SCHOOL_OWNER_MANAGER');
    const staff = await mkUser('Bea');
    await grant(staff.id, school.id, 'BRANCH_STAFF', branch.id);
    const ownerApi = as(own, [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, branchId: null }]);
    const coOwnerApi = as(coOwner, [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, branchId: null }]);
    const staffApi = as(staff, [{ role: 'BRANCH_STAFF', schoolId: school.id, branchId: branch.id }]);
    const base = `/v1/schools/${school.id}/staff`;
    const log = async (query = '') => {
      const res = await ownerApi.get(`${base}/activity${query}`);
      expect(res.status).toBe(200);
      return res.body as { items: Array<Record<string, any>>; nextCursor: string | null };
    };
    return { school, branch, own, coOwner, staff, ownerApi, coOwnerApi, staffApi, base, log };
  };

  beforeAll(async () => {
    process.env.PORTAL_BASE_URL = 'https://portal.example.test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationDeliveryService)
      .useValue({
        sendEmail: async (_to: string, subject: string, body: string) => {
          if (subject.startsWith("You're invited to")) sent.push(body);
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    process.env.PORTAL_BASE_URL = previousBaseUrl;
    const schools = await superuser.school.findMany({ where: { name: { contains: tag } }, select: { id: true } });
    const ids = schools.map((s) => s.id);
    await superuser.staffActivity.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.coachInvite.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: ids } } });
    const users = await superuser.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
    await superuser.refreshToken.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await superuser.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: ids } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('each staff change writes one line, newest first, with who did it and to whom', async () => {
    const { school, branch, own, staff, ownerApi, base, log } = await seed('changes');
    const carlos = await mkUser('Carlos');

    expect((await ownerApi.post(`/v1/users/${carlos.id}/role-grants`).send({ role: 'INSTRUCTOR', schoolId: school.id, branchId: branch.id })).status).toBe(201);
    expect((await ownerApi.put(`${base}/${staff.id}/access`).send({ ...DEFAULTS, classes: true })).status).toBe(200);
    // Saving the same switches again changes nothing, so writes nothing.
    expect((await ownerApi.put(`${base}/${staff.id}/access`).send({ ...DEFAULTS, classes: true })).status).toBe(200);
    expect((await ownerApi.patch(`${base}/${staff.id}/details`).send({ displayName: 'Bea at the desk' })).status).toBe(200);
    expect((await ownerApi.post(`${base}/${staff.id}/pause`).send({})).status).toBe(201);
    expect((await ownerApi.post(`${base}/${staff.id}/unpause`).send({})).status).toBe(201);
    expect((await ownerApi.put(`${base}/settings`).send({ mustAcceptFirst: true })).status).toBe(200);
    const carlosGrant = await superuser.roleGrant.findFirstOrThrow({ where: { userId: carlos.id, schoolId: school.id } });
    expect((await ownerApi.delete(`/v1/users/${carlos.id}/role-grants/${carlosGrant.id}`)).status).toBe(200);

    const { items, nextCursor } = await log();
    expect(nextCursor).toBeNull();
    expect(items.map((i) => i.action)).toEqual([
      'ROLE_REMOVED',
      'SETTING_CHANGED',
      'UNPAUSED',
      'PAUSED',
      'DETAILS_CHANGED',
      'ACCESS_CHANGED',
      'ROLE_GIVEN',
    ]);
    const byAction = Object.fromEntries(items.map((i) => [i.action, i]));
    expect(byAction.ROLE_GIVEN).toMatchObject({ actorId: own.id, actorName: 'Olga Log', targetUserId: carlos.id, targetName: 'Carlos Log', details: { role: 'INSTRUCTOR', branchName: branch.name } });
    expect(byAction.ACCESS_CHANGED.details).toEqual({ changes: [{ switch: 'classes', on: true }] });
    expect(byAction.DETAILS_CHANGED.details).toEqual({ displayName: 'Bea at the desk' });
    expect(byAction.PAUSED.details).toEqual({ pausedRoles: 1 });
    expect(byAction.UNPAUSED.details).toEqual({ restoredRoles: 1, closedBranches: [] });
    expect(byAction.SETTING_CHANGED).toMatchObject({ targetUserId: null, details: { mustAcceptFirst: true } });
    expect(byAction.ROLE_REMOVED.details).toEqual({ role: 'INSTRUCTOR', branchName: branch.name });

    // Filtered to one person.
    const bea = await log(`?userId=${staff.id}`);
    expect(bea.items.map((i) => i.action)).toEqual(['UNPAUSED', 'PAUSED', 'DETAILS_CHANGED', 'ACCESS_CHANGED']);
  });

  it('only owners and co-owners can read it', async () => {
    const { coOwnerApi, staffApi, base } = await seed('who');
    expect((await coOwnerApi.get(`${base}/activity`)).status).toBe(200);
    expect((await staffApi.get(`${base}/activity`)).status).toBe(403);
    const other = await seed('other');
    expect((await other.ownerApi.get(`${base}/activity`)).status).toBe(403);
    expect((await other.ownerApi.get(`${base}/activity?userId=not-a-uuid`)).status).toBe(400);
  });

  it('invites sent, cancelled and accepted are logged, also when staff with "Can invite coaches" send them', async () => {
    const { school, branch, staff, ownerApi, staffApi, log } = await seed('invites');
    const newbie = await mkUser('Nina');
    const sentByOwner = await ownerApi.post(`/v1/schools/${school.id}/coach-invites`).send({ email: newbie.email, branchId: branch.id });
    expect(sentByOwner.status).toBe(201);
    const link = sent[sent.length - 1].match(/\/coach-invite\/([A-Za-z0-9_-]+)/)![1];
    const accepted = await as(newbie, []).post(`/v1/coach-invite-links/${link}/accept`);
    expect(accepted.status).toBe(201);

    await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId: school.id, userId: staff.id, canInviteCoaches: true } });
    const byStaff = await staffApi.post(`/v1/schools/${school.id}/coach-invites`).send({ email: 'someone@example.test', branchId: branch.id });
    expect(byStaff.status).toBe(201);
    expect((await staffApi.post(`/v1/coach-invites/${byStaff.body.id}/cancel`)).status).toBe(201);

    const { items } = await log();
    expect(items.map((i) => [i.action, i.actorId])).toEqual([
      ['INVITE_CANCELLED', staff.id],
      ['INVITE_SENT', staff.id],
      ['INVITE_ACCEPTED', newbie.id],
      ['INVITE_SENT', items[3].actorId],
    ]);
    expect(items[0].details).toEqual({ email: 'someone@example.test', role: 'INSTRUCTOR', branchName: branch.name });
    expect(items[2]).toMatchObject({ targetUserId: newbie.id, details: { role: 'INSTRUCTOR', branchName: branch.name } });
    expect(items[3].details).toEqual({ email: newbie.email.toLowerCase(), role: 'INSTRUCTOR', branchName: branch.name });
  });

  it('the app can only write lines as the person acting, at a School they own', async () => {
    const { school, own, staff } = await seed('rls');
    const { PrismaClient: App } = await import('@prisma/client');
    const appDb = new App({ datasourceUrl: DATABASE_URL_APP });
    try {
      const insert = (actorId: string, action: string, as = staff.id) =>
        appDb.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SELECT set_config('app.current_user_id', '${as}', true)`);
          return tx.staffActivity.createMany({ data: [{ schoolId: school.id, actorId, action }] });
        });
      // The owner, as themselves: allowed.
      await expect(insert(own.id, 'SETTING_CHANGED', own.id)).resolves.toEqual({ count: 1 });
      await expect(insert(staff.id, 'ROLE_GIVEN')).rejects.toThrow();
      // Someone else's name as the actor.
      await expect(insert(own.id, 'INVITE_ACCEPTED')).rejects.toThrow();
    } finally {
      await appDb.$disconnect();
    }
  });

  it('pages 50 at a time', async () => {
    const { school, own, log } = await seed('pages');
    const start = Date.now() - 1_000_000;
    await superuser.staffActivity.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({ schoolId: school.id, actorId: own.id, action: 'SETTING_CHANGED', details: { mustAcceptFirst: i % 2 === 0 }, createdAt: new Date(start + i * 1000) })),
    });
    const first = await log();
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBe(first.items[49].id);
    const second = await log(`?cursor=${first.nextCursor}`);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(55);
  });
});
