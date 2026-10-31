/**
 * Decision 390: "Pause" on the Staff page. Pausing ends a coach's or Branch
 * Staff member's roles at once and keeps everything the School set for them;
 * Unpause gives the same roles back. Paused staff stay on the staff list,
 * can be removed for good, and get no new role until they are unpaused.
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
    '[staff-pause.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

const DEFAULTS = { classes: false, bookings: true, students: true, cancelClasses: true, staffList: false, inviteCoaches: false, disciplines: false, checkInRules: false, exportStudents: false, freezeMemberships: false, attendanceStats: false, seeMedicalInfo: false };

describeIfDb('Pause and Unpause staff (Decision 390)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const tag = randomUUID().slice(0, 8);

  type U = { id: string; email: string };
  type Role = 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'BRANCH_STAFF';
  type Grant = { role: Role; schoolId: string; branchId: string | null };
  const http = () => request(app.getHttpServer());
  const as = (u: U, grants: Grant[], extra: object = {}) => {
    const auth = `Bearer ${jwt.sign({ sub: u.id, email: u.email, grants: grants.map((g) => ({ franchiseId: null, ...g })), ...extra })}`;
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
        email: `staff-pause-${firstName.toLowerCase()}-${tag}-${randomUUID().slice(0, 6)}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName,
        surname: 'Tester',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
  const grant = (userId: string, schoolId: string, role: Role, branchId: string | null = null) =>
    superuser.roleGrant.create({ data: { id: randomUUID(), role, userId, schoolId, branchId, isMainOwner: role === 'SCHOOL_OWNER_MANAGER' } });

  const seed = async (name: string) => {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: `Staff Pause ${name} ${tag}` } });
    const branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: `Main ${tag}` } });
    const other = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: `Other ${tag}` } });
    const own = await mkUser('Olga');
    await grant(own.id, school.id, 'SCHOOL_OWNER_MANAGER');
    const staff = await mkUser('Bea');
    const staffGrant = await grant(staff.id, school.id, 'BRANCH_STAFF', branch.id);
    const coach = await mkUser('Carlos');
    const coachGrant = await grant(coach.id, school.id, 'INSTRUCTOR', branch.id);
    const ownerApi = as(own, [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, branchId: null }]);
    const staffApi = as(staff, [{ role: 'BRANCH_STAFF', schoolId: school.id, branchId: branch.id }]);
    const base = `/v1/schools/${school.id}/staff`;
    const pause = (userId: string) => ownerApi.post(`${base}/${userId}/pause`).send({});
    const unpause = (userId: string) => ownerApi.post(`${base}/${userId}/unpause`).send({});
    const list = async (status: string) => (await ownerApi.get(`${base}?status=${status}`)).body.items as Array<Record<string, any>>;
    return { school, branch, other, own, staff, staffGrant, coach, coachGrant, ownerApi, staffApi, base, pause, unpause, list };
  };

  beforeAll(async () => {
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
    await superuser.class.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: ids } } });
    const users = await superuser.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
    await superuser.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: ids } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('pausing stops all their staff access at once, keeps their setup, and Unpause gives the same roles back', async () => {
    const { school, staff, staffGrant, ownerApi, staffApi, base, pause, unpause, list } = await seed('cycle');
    const custom = { ...DEFAULTS, classes: true, staffList: true };
    expect((await ownerApi.put(`${base}/${staff.id}/access`).send(custom)).status).toBe(200);
    expect((await ownerApi.patch(`${base}/${staff.id}/details`).send({ displayName: 'Bea at the desk' })).status).toBe(200);

    // A signed-in session made before the pause.
    const { rolesChangedAt } = await superuser.user.findUniqueOrThrow({ where: { id: staff.id }, select: { rolesChangedAt: true } });
    const signedIn = as(staff, [{ role: 'BRANCH_STAFF', schoolId: school.id, branchId: staffGrant.branchId }], { rca: rolesChangedAt?.getTime() ?? 0 });
    expect((await signedIn.get(`${base}/me/access`)).status).toBe(200);

    const paused = await pause(staff.id);
    expect(paused.status).toBe(201);
    expect(paused.body).toMatchObject({ userId: staff.id, pausedRoles: 1 });

    // Their next request is refused and the refreshed session has no staff role.
    const refused = await signedIn.get(`${base}/me/access`);
    expect(refused.status).toBe(401);
    expect(refused.body.error.code).toBe('ROLES_CHANGED');
    expect((await staffApi.get(`${base}/me/access`)).status).toBe(403);

    const row = await superuser.roleGrant.findUniqueOrThrow({ where: { id: staffGrant.id } });
    expect(row.revokedAt).not.toBeNull();
    expect(row.pausedAt).not.toBeNull();
    expect(row.pausedById).not.toBeNull();

    // Still on the staff list (with the active ones, and under Paused), never under Removed.
    const active = (await list('active')).find((p) => p.userId === staff.id);
    expect(active).toMatchObject({ active: false, paused: true, removedAt: null, displayName: 'Bea at the desk', access: custom });
    expect(active!.pausedAt).toBe(paused.body.pausedAt);
    expect(active!.roles[0]).toMatchObject({ grantId: staffGrant.id, pausedAt: paused.body.pausedAt });
    expect((await list('paused')).map((p) => p.userId)).toEqual([staff.id]);
    expect((await list('removed')).some((p) => p.userId === staff.id)).toBe(false);

    const back = await unpause(staff.id);
    expect(back.status).toBe(201);
    expect(back.body).toEqual({ userId: staff.id, restoredRoles: 1, closedBranches: [] });
    const restored = await superuser.roleGrant.findUniqueOrThrow({ where: { id: staffGrant.id } });
    expect(restored).toMatchObject({ revokedAt: null, pausedAt: null, pausedById: null, grantedAt: staffGrant.grantedAt });
    expect((await staffApi.get(`${base}/me/access`)).body).toEqual({ owner: false, branchStaff: true, access: custom });
    expect((await list('active')).find((p) => p.userId === staff.id)).toMatchObject({ active: true, paused: false, pausedAt: null });
  });

  it('a paused coach keeps their classes; only owners pause, owners are never paused, and each step is checked', async () => {
    const { school, branch, own, staff, coach, staffApi, pause, unpause } = await seed('rules');
    const start = new Date(Date.now() + 24 * 3_600_000);
    const cls = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, branchId: branch.id, instructorId: coach.id, title: 'Kids', startDate: start, endDate: new Date(start.getTime() + 3_600_000), membershipInclusion: true },
    });

    expect((await staffApi.post(`/v1/schools/${school.id}/staff/${coach.id}/pause`).send({})).status).toBe(403);
    const owner = await pause(own.id);
    expect(owner.status).toBe(400);
    expect(owner.body.error.message).toBe("Owners can't be paused. Pause is for coaches and Branch Staff.");
    expect((await pause((await mkUser('Nobody')).id)).status).toBe(404);
    expect((await unpause(staff.id)).body.error).toMatchObject({ message: 'This person is not paused.' });

    expect((await pause(coach.id)).status).toBe(201);
    expect((await pause(coach.id)).body.error).toMatchObject({ message: 'This person is already paused.' });
    expect((await superuser.class.findUniqueOrThrow({ where: { id: cls.id } })).instructorId).toBe(coach.id);
  });

  it('while paused: no new role, but access and details can be set; Remove from School ends the pause for good', async () => {
    const { school, branch, other, staff, ownerApi, base, pause, unpause, list } = await seed('remove');
    expect((await pause(staff.id)).status).toBe(201);

    const give = await ownerApi.post(`/v1/users/${staff.id}/role-grants`).send({ role: 'BRANCH_STAFF', schoolId: school.id, branchId: other.id });
    expect(give.status).toBe(409);
    expect(give.body.error).toMatchObject({ code: 'STAFF_PAUSED', message: 'This person is paused at this School. Unpause them to give their roles back.' });
    expect((await ownerApi.put(`${base}/${staff.id}/access`).send({ ...DEFAULTS, bookings: false })).status).toBe(200);
    expect((await ownerApi.patch(`${base}/${staff.id}/details`).send({ workPhone: '+447911123456' })).status).toBe(200);

    const removed = await ownerApi.post(`${base}/${staff.id}/remove`).send({});
    expect(removed.status).toBe(201);
    expect(removed.body.removedRoles).toBe(1);
    const rows = await superuser.roleGrant.findMany({ where: { userId: staff.id, schoolId: school.id } });
    expect(rows.every((g) => g.revokedAt && !g.pausedAt)).toBe(true);
    expect((await unpause(staff.id)).status).toBe(404);
    expect((await list('removed')).find((p) => p.userId === staff.id)).toMatchObject({ active: false, paused: false });
    // Removed staff start again from the defaults (Decision 387).
    expect(await superuser.staffPermission.findFirst({ where: { userId: staff.id, schoolId: school.id }, select: { canManageBookings: true } })).toEqual({ canManageBookings: true });
    // Now they can be given a role again.
    expect((await ownerApi.post(`/v1/users/${staff.id}/role-grants`).send({ role: 'BRANCH_STAFF', schoolId: school.id, branchId: branch.id })).status).toBe(201);
  });

  it('removing one paused role ends it for good; a branch closed meanwhile does not come back', async () => {
    const { school, other, coach, coachGrant, ownerApi, pause, unpause } = await seed('branches');
    const atOther = await grant(coach.id, school.id, 'INSTRUCTOR', other.id);
    const third = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: `Third ${tag}` } });
    const atThird = await grant(coach.id, school.id, 'INSTRUCTOR', third.id);
    expect((await pause(coach.id)).body.pausedRoles).toBe(3);

    expect((await ownerApi.delete(`/v1/users/${coach.id}/role-grants/${atThird.id}`)).status).toBe(200);
    await superuser.branch.update({ where: { id: other.id }, data: { archivedAt: new Date() } });

    const back = await unpause(coach.id);
    expect(back.body).toEqual({ userId: coach.id, restoredRoles: 1, closedBranches: [other.name] });
    const rows = await superuser.roleGrant.findMany({ where: { userId: coach.id, schoolId: school.id }, select: { id: true, revokedAt: true, pausedAt: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(coachGrant.id)).toMatchObject({ revokedAt: null, pausedAt: null });
    expect(byId.get(atOther.id)!.revokedAt).not.toBeNull();
    expect(byId.get(atOther.id)!.pausedAt).toBeNull();
    expect(byId.get(atThird.id)!.pausedAt).toBeNull();
    expect(byId.get(atThird.id)!.revokedAt).not.toBeNull();
  });
});
