/**
 * Decision 387: the owner's six access switches for Branch Staff (classes,
 * bookings, students, cancelClasses, staffList, inviteCoaches), their
 * defaults, the Instructor floor, the read-only staff list, and the reset when
 * the person stops being Branch Staff.
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
    '[staff-access.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

const ALL_OFF = { classes: false, bookings: false, students: false, cancelClasses: false, staffList: false, inviteCoaches: false };
const ALL_ON = { classes: true, bookings: true, students: true, cancelClasses: true, staffList: true, inviteCoaches: true };
const DEFAULTS = { classes: false, bookings: true, students: true, cancelClasses: true, staffList: false, inviteCoaches: false };

describeIfDb('Staff access switches (Decision 387)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const tag = randomUUID().slice(0, 8);
  const previousBaseUrl = process.env.PORTAL_BASE_URL;

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
        email: `staff-access-${firstName.toLowerCase()}-${tag}-${randomUUID().slice(0, 6)}@example.test`,
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
    const school = await superuser.school.create({ data: { id: randomUUID(), name: `Staff Access ${name} ${tag}` } });
    const branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: `Main ${tag}` } });
    const other = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: `Other ${tag}` } });
    const own = await mkUser('Olga');
    await grant(own.id, school.id, 'SCHOOL_OWNER_MANAGER');
    const staff = await mkUser('Bea');
    const staffGrant = await grant(staff.id, school.id, 'BRANCH_STAFF', branch.id);
    const coach = await mkUser('Carlos');
    await grant(coach.id, school.id, 'INSTRUCTOR', branch.id);
    const ownerApi = as(own, [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, branchId: null }]);
    const staffApi = as(staff, [{ role: 'BRANCH_STAFF', schoolId: school.id, branchId: branch.id }]);
    const coachApi = as(coach, [{ role: 'INSTRUCTOR', schoolId: school.id, branchId: branch.id }]);
    const setAccess = (access: object, userId = staff.id) => ownerApi.put(`/v1/schools/${school.id}/staff/${userId}/access`).send(access);
    return { school, branch, other, own, staff, staffGrant, coach, ownerApi, staffApi, coachApi, setAccess };
  };

  const mkClass = (schoolId: string, branchId: string | null) => {
    const start = new Date(Date.now() + 24 * 3_600_000);
    return superuser.class.create({
      data: { id: randomUUID(), schoolId, branchId, title: `Class ${randomUUID().slice(0, 6)}`, startDate: start, endDate: new Date(start.getTime() + 3_600_000), membershipInclusion: true },
    });
  };
  const classBody = (branchId?: string) => {
    const start = new Date(Date.now() + 48 * 3_600_000);
    return { title: 'Open mat', activities: ['Jiu Jitsu'], ...(branchId ? { branchId } : {}), startDate: start.toISOString(), endDate: new Date(start.getTime() + 3_600_000).toISOString() };
  };
  const expectOff = (res: request.Response, message: string) => {
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: 'STAFF_ACCESS_OFF', message });
  };

  beforeAll(async () => {
    process.env.PORTAL_BASE_URL = 'https://portal.example.test/';
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
    await superuser.coachInvite.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.class.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: ids } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: ids } } });
    const users = await superuser.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
    await superuser.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: ids } } });
    await superuser.$disconnect();
    await app.close();
    process.env.PORTAL_BASE_URL = previousBaseUrl;
  });

  it('reports each person’s own access: defaults for Branch Staff, everything for owners, the floor for coaches', async () => {
    const { school, ownerApi, staffApi, coachApi } = await seed('me');
    const url = `/v1/schools/${school.id}/staff/me/access`;

    expect((await staffApi.get(url)).body).toEqual({ owner: false, branchStaff: true, access: DEFAULTS });
    expect((await ownerApi.get(url)).body).toEqual({ owner: true, branchStaff: false, access: ALL_ON });
    expect((await coachApi.get(url)).body).toEqual({ owner: false, branchStaff: false, access: { ...ALL_OFF, bookings: true, students: true } });

    const stranger = await mkUser('Sam');
    const res = await as(stranger, []).get(url);
    expect(res.status).toBe(403);
  });

  it('classes: off by default; on lets Branch Staff manage their branch’s classes but never School-wide ones', async () => {
    const { school, branch, other, staffApi, setAccess } = await seed('classes');
    const create = (body: object) => staffApi.post(`/v1/schools/${school.id}/classes`).send(body);
    const off = "The School owner hasn't let you manage classes and the timetable here.";

    expectOff(await create(classBody(branch.id)), off);

    expect((await setAccess({ ...DEFAULTS, classes: true })).status).toBe(200);
    const made = await create(classBody(branch.id));
    expect(made.status).toBe(201);
    expect((await staffApi.patch(`/v1/classes/${made.body.id}`).send({ title: 'Renamed' })).status).toBe(200);

    // Not School-wide, and not someone else's branch.
    expectOff(await create(classBody()), off);
    expect((await create(classBody(other.id))).status).toBe(403);
    expect((await staffApi.patch(`/v1/classes/${made.body.id}`).send({ branchId: other.id })).status).toBe(403);
  });

  it('bookings: on by default; off stops Branch Staff but never the Instructor floor', async () => {
    const { school, branch, staffApi, coachApi, setAccess } = await seed('bookings');
    const cls = await mkClass(school.id, branch.id);
    const url = `/v1/classes/${cls.id}/qr-token`;

    expect((await staffApi.get(url)).status).toBe(200);
    await setAccess({ ...DEFAULTS, bookings: false });
    expectOff(await staffApi.get(url), "The School owner hasn't let you manage bookings and check-in here.");
    expect((await coachApi.get(url)).status).toBe(200);
  });

  it('students: the roster needs bookings or students', async () => {
    const { school, staffApi, setAccess } = await seed('students');
    const roster = `/v1/schools/${school.id}/students`;

    expect((await staffApi.get(roster)).status).toBe(200);
    await setAccess({ ...DEFAULTS, students: false });
    expect((await staffApi.get(roster)).status).toBe(200); // still the booking picker
    await setAccess({ ...DEFAULTS, students: false, bookings: false });
    expect((await staffApi.get(roster)).status).toBe(403);
    await setAccess({ ...DEFAULTS, students: true, bookings: false });
    expect((await staffApi.get(roster)).status).toBe(200);
  });

  it('cancelClasses: on by default; off stops Branch Staff cancelling a class', async () => {
    const { school, branch, staffApi, setAccess } = await seed('cancel');
    await setAccess({ ...DEFAULTS, cancelClasses: false });
    const cls = await mkClass(school.id, branch.id);
    expectOff(await staffApi.post(`/v1/classes/${cls.id}/cancel`).send({}), "The School owner hasn't let you cancel classes or give credit back.");

    await setAccess(DEFAULTS);
    expect((await staffApi.post(`/v1/classes/${cls.id}/cancel`).send({})).status).toBe(201);
  });

  it('staffList: off by default; on shows a read-only list of the people Branch Staff work with', async () => {
    const { school, other, own, staff, coach, staffApi, ownerApi, setAccess } = await seed('list');
    const elsewhere = await mkUser('Elsa');
    await grant(elsewhere.id, school.id, 'INSTRUCTOR', other.id);
    const url = `/v1/schools/${school.id}/staff`;

    expectOff(await staffApi.get(url), "The School owner hasn't let you see the staff list.");

    await setAccess({ ...DEFAULTS, staffList: true });
    const res = await staffApi.get(url);
    expect(res.status).toBe(200);
    const ids = (res.body.items as { userId: string; access: unknown }[]).map((i) => i.userId);
    expect(ids).toEqual(expect.arrayContaining([own.id, staff.id, coach.id]));
    expect(ids).not.toContain(elsewhere.id); // another branch's coach
    expect((res.body.items as { access: unknown }[]).every((i) => i.access === null)).toBe(true);
    expect((await staffApi.get(`${url}?status=removed`)).body.items).toEqual([]);

    // The owner's view carries each Branch Staff member's switches.
    const ownerView = await ownerApi.get(url);
    const row = (ownerView.body.items as { userId: string; access: unknown }[]).find((i) => i.userId === staff.id);
    expect(row?.access).toEqual({ ...DEFAULTS, staffList: true });
    expect((ownerView.body.items as { userId: string; access: unknown }[]).find((i) => i.userId === coach.id)?.access).toBeNull();
  });

  it('inviteCoaches: off by default; turning it off again withdraws open invites', async () => {
    const { school, branch, staff, staffApi, setAccess } = await seed('invite');
    const url = `/v1/schools/${school.id}/coach-invites`;
    const body = { email: `invitee-${tag}-${randomUUID().slice(0, 6)}@example.test`, branchId: branch.id };

    expect((await staffApi.post(url).send(body)).status).toBe(403);
    await setAccess({ ...DEFAULTS, inviteCoaches: true });
    const sent = await staffApi.post(url).send(body);
    expect(sent.status).toBe(201);

    await setAccess(DEFAULTS);
    const open = await superuser.coachInvite.findMany({ where: { schoolId: school.id, invitedById: staff.id, cancelledAt: null, acceptedAt: null } });
    expect(open).toEqual([]);
  });

  it('only an owner sets switches, only for Branch Staff, with all six given', async () => {
    const { school, coach, own, staffApi, staff, setAccess } = await seed('validate');

    const forCoach = await setAccess(ALL_ON, coach.id);
    expect(forCoach.status).toBe(400);
    expect(forCoach.body.error.message).toBe('Access switches are for Branch Staff. Coaches have the rights of their role, and owners have every right.');
    expect((await setAccess(ALL_ON, own.id)).status).toBe(400);
    expect((await setAccess({ classes: true })).status).toBe(400);
    expect((await staffApi.put(`/v1/schools/${school.id}/staff/${staff.id}/access`).send(ALL_ON)).status).toBe(403);

    const saved = await setAccess(ALL_OFF);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ userId: staff.id, access: ALL_OFF });
  });

  it('resets the switches when the person is no longer Branch Staff', async () => {
    const { school, staff, staffGrant, ownerApi, setAccess } = await seed('reset');
    await setAccess(ALL_ON);

    const revoked = await ownerApi.delete(`/v1/users/${staff.id}/role-grants/${staffGrant.id}`);
    expect(revoked.status).toBe(200);
    const row = await superuser.staffPermission.findUnique({ where: { schoolId_userId: { schoolId: school.id, userId: staff.id } } });
    expect(row).toMatchObject({
      canManageClasses: false,
      canManageBookings: true,
      canManageStudents: true,
      canCancelClasses: true,
      canSeeStaffList: false,
      canInviteCoaches: false,
    });
  });
});
