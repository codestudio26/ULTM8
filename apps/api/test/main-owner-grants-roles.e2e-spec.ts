/**
 * Decision 423 item 10: only the account's main owner adds or removes roles.
 * At a School that is its main owner (RoleGrant.isMainOwner, or the earliest
 * live owner grant where none is flagged), for co-owners, Branch Staff and
 * coaches, by every path: give a role, remove a role, Add staff manually, Add
 * instructor manually, invite, cancel an invite, pause, unpause, Remove from
 * School, and moving roles when a Branch closes. A co-owner, Branch Staff
 * (with every access switch on) and a coach get 403 MAIN_OWNER_ONLY; another
 * School's main owner and the School's Franchise owner can't act here either.
 * Students still join by themselves, and owners still end a student's
 * enrolment. Real HTTP and real Postgres RLS.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_JOBS and
 * JWT_ACCESS_SECRET — skips with a warning if any are unset, same convention
 * as every other e2e spec in this repo.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_JOBS && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[main-owner-grants-roles.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_JOBS / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

const ALL_ON = {
  classes: true,
  bookings: true,
  students: true,
  cancelClasses: true,
  staffList: true,
  disciplines: true,
  checkInRules: true,
  exportStudents: true,
  freezeMemberships: true,
  attendanceStats: true,
  memberFiles: true,
  importData: true,
  seeMedicalInfo: true,
};

describeIfDb('Only the main owner adds or removes roles (Decision 423 item 10)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const tag = randomUUID().slice(0, 8);
  const previousBaseUrl = process.env.PORTAL_BASE_URL;
  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const franchiseIds: string[] = [];

  type U = { id: string; email: string };
  const http = () => request(app.getHttpServer());
  /** Signs the person's live grants into a token, as login does. */
  const as = async (u: U) => {
    const grants = await superuser.roleGrant.findMany({ where: { userId: u.id, revokedAt: null } });
    const auth = `Bearer ${jwt.sign({
      sub: u.id,
      email: u.email,
      grants: grants.map((g) => ({ role: g.role, franchiseId: g.franchiseId, schoolId: g.schoolId, branchId: g.branchId })),
    })}`;
    return {
      get: (url: string) => http().get(url).set('Authorization', auth),
      post: (url: string) => http().post(url).set('Authorization', auth),
      put: (url: string) => http().put(url).set('Authorization', auth),
      delete: (url: string) => http().delete(url).set('Authorization', auth),
    };
  };
  const mkUser = async (firstName: string): Promise<U> => {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `main-owner-roles-${firstName.toLowerCase()}-${tag}-${randomUUID().slice(0, 6)}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName,
        surname: 'Roles',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    return { id: u.id, email: u.email };
  };
  const grant = (userId: string, schoolId: string, role: Role, branchId: string | null = null, isMainOwner = false) =>
    superuser.roleGrant.create({ data: { id: randomUUID(), role, userId, schoolId, branchId, isMainOwner } });

  /** A School in a Franchise, with a main owner, a co-owner, Branch Staff
   * with every switch on, a coach, and people to give and take roles from. */
  const seed = async (name: string) => {
    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: `Main Owner Roles Franchise ${name} ${tag}` } });
    franchiseIds.push(franchise.id);
    const school = await superuser.school.create({ data: { id: randomUUID(), name: `Main Owner Roles ${name} ${tag}`, franchiseId: franchise.id } });
    schoolIds.push(school.id);
    const north = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: `North ${tag}` } });
    const south = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: `South ${tag}` } });
    const main = await mkUser('Mia');
    await grant(main.id, school.id, 'SCHOOL_OWNER_MANAGER', null, true);
    const co = await mkUser('Cole');
    await grant(co.id, school.id, 'SCHOOL_OWNER_MANAGER');
    const staff = await mkUser('Bea');
    await grant(staff.id, school.id, 'BRANCH_STAFF', north.id);
    const coach = await mkUser('Carl');
    await grant(coach.id, school.id, 'INSTRUCTOR', north.id);
    const franchiseOwner = await mkUser('Fran');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: franchiseOwner.id, franchiseId: franchise.id } });
    // Another School and its main owner.
    const other = await superuser.school.create({ data: { id: randomUUID(), name: `Main Owner Roles other ${name} ${tag}` } });
    schoolIds.push(other.id);
    const otherMain = await mkUser('Otto');
    await grant(otherMain.id, other.id, 'SCHOOL_OWNER_MANAGER', null, true);
    // People whose roles are given and taken.
    const target = await mkUser('Tia');
    const coTarget = await mkUser('Cody');
    const coTargetGrant = await grant(coTarget.id, school.id, 'SCHOOL_OWNER_MANAGER');
    const staffTarget = await mkUser('Stan');
    const staffTargetGrant = await grant(staffTarget.id, school.id, 'BRANCH_STAFF', north.id);
    const coachTarget = await mkUser('Kim');
    const coachTargetGrant = await grant(coachTarget.id, school.id, 'INSTRUCTOR', south.id);
    const student = await mkUser('Stu');
    const studentGrant = await grant(student.id, school.id, 'STUDENT');
    await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: student.id, branchId: north.id } });

    // Branch Staff with every access switch on: none of them adds people.
    const mainApi = await as(main);
    expect((await mainApi.put(`/v1/schools/${school.id}/staff/${staff.id}/access`).send(ALL_ON)).status).toBe(200);

    return {
      school, north, south, main, co, staff, coach, franchiseOwner, other, otherMain,
      target, coTarget, coTargetGrant, staffTarget, staffTargetGrant, coachTarget, coachTargetGrant, student, studentGrant,
    };
  };

  /** Every non-main-owner caller in one School, plus outsiders. */
  const refused = (s: Awaited<ReturnType<typeof seed>>) => ({ coOwner: s.co, staff: s.staff, coach: s.coach });
  const outsiders = (s: Awaited<ReturnType<typeof seed>>) => ({ otherSchoolMainOwner: s.otherMain, franchiseOwner: s.franchiseOwner });

  const expectMainOwnerOnly = (res: request.Response, who: string) => {
    if (res.status !== 403 || res.body?.error?.code !== 'MAIN_OWNER_ONLY') {
      throw new Error(`${who}: expected 403 MAIN_OWNER_ONLY, got ${res.status} ${JSON.stringify(res.body)}`);
    }
  };
  const expectNotFound = (res: request.Response, who: string) => {
    if (res.status !== 404) throw new Error(`${who}: expected 404, got ${res.status} ${JSON.stringify(res.body)}`);
  };
  /** Outsiders may meet the School's RLS first (404) or the main-owner
   * check (403); either way nothing happens. */
  const expectRefused = (res: request.Response, who: string) => {
    if (![403, 404].includes(res.status)) throw new Error(`${who}: expected 403 or 404, got ${res.status} ${JSON.stringify(res.body)}`);
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
    process.env.PORTAL_BASE_URL = previousBaseUrl;
    await superuser.staffActivity.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.coachInvite.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.instructor.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { franchiseId: { in: franchiseIds } }] } });
    const madeHere = await superuser.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
    await superuser.refreshToken.deleteMany({ where: { userId: { in: [...userIds, ...madeHere.map((u) => u.id)] } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: [...userIds, ...madeHere.map((u) => u.id)] } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: [...userIds, ...madeHere.map((u) => u.id)] } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('giving a role (coach, Branch Staff, co-owner): only the main owner', async () => {
    const s = await seed('give');
    const bodies = [
      { role: 'INSTRUCTOR', schoolId: s.school.id, branchId: s.north.id },
      { role: 'BRANCH_STAFF', schoolId: s.school.id, branchId: s.north.id },
      { role: 'SCHOOL_OWNER_MANAGER', schoolId: s.school.id },
    ];
    for (const body of bodies) {
      for (const [who, u] of Object.entries(refused(s))) expectMainOwnerOnly(await (await as(u)).post(`/v1/users/${s.target.id}/role-grants`).send(body), `${who} ${body.role}`);
      for (const [who, u] of Object.entries(outsiders(s))) expectRefused(await (await as(u)).post(`/v1/users/${s.target.id}/role-grants`).send(body), `${who} ${body.role}`);
    }
    expect(await superuser.roleGrant.count({ where: { userId: s.target.id } })).toBe(0);

    for (const body of bodies) {
      expect((await (await as(s.main)).post(`/v1/users/${s.target.id}/role-grants`).send(body)).status).toBe(201);
    }
    expect((await superuser.roleGrant.findMany({ where: { userId: s.target.id, revokedAt: null }, select: { role: true } })).map((g) => g.role).sort()).toEqual([
      'BRANCH_STAFF',
      'INSTRUCTOR',
      'SCHOOL_OWNER_MANAGER',
    ]);
  });

  it('removing a co-owner, staff or coach role: only the main owner', async () => {
    const s = await seed('remove');
    const targets = [
      { user: s.coTarget, grant: s.coTargetGrant },
      { user: s.staffTarget, grant: s.staffTargetGrant },
      { user: s.coachTarget, grant: s.coachTargetGrant },
    ];
    for (const t of targets) {
      for (const [who, u] of Object.entries(refused(s))) {
        expectMainOwnerOnly(await (await as(u)).delete(`/v1/users/${t.user.id}/role-grants/${t.grant.id}`), `${who} on ${t.grant.role}`);
      }
      // Outside the School the grant stays invisible: the 404 RLS gave before.
      for (const [who, u] of Object.entries(outsiders(s))) {
        expectNotFound(await (await as(u)).delete(`/v1/users/${t.user.id}/role-grants/${t.grant.id}`), `${who} on ${t.grant.role}`);
      }
      expect((await superuser.roleGrant.findUniqueOrThrow({ where: { id: t.grant.id } })).revokedAt).toBeNull();
    }
    for (const t of targets) {
      expect((await (await as(s.main)).delete(`/v1/users/${t.user.id}/role-grants/${t.grant.id}`)).status).toBe(200);
      expect((await superuser.roleGrant.findUniqueOrThrow({ where: { id: t.grant.id } })).revokedAt).not.toBeNull();
    }
  });

  it('Add staff manually and Add instructor manually: only the main owner', async () => {
    const s = await seed('manual');
    const staffBody = () => ({ firstName: 'New', surname: 'Staff', email: `manual-staff-${tag}-${randomUUID().slice(0, 6)}@example.test`, branchId: s.north.id });
    const coachBody = () => ({ firstName: 'New', surname: 'Coach', email: `manual-coach-${tag}-${randomUUID().slice(0, 6)}@example.test`, branchId: s.north.id });
    for (const [who, u] of Object.entries(refused(s))) {
      expectMainOwnerOnly(await (await as(u)).post(`/v1/schools/${s.school.id}/role-grants/add-manually`).send(staffBody()), `${who} staff`);
      expectMainOwnerOnly(await (await as(u)).post(`/v1/schools/${s.school.id}/instructors/add-manually`).send(coachBody()), `${who} coach`);
    }
    for (const [who, u] of Object.entries(outsiders(s))) {
      expectRefused(await (await as(u)).post(`/v1/schools/${s.school.id}/role-grants/add-manually`).send(staffBody()), `${who} staff`);
      expectRefused(await (await as(u)).post(`/v1/schools/${s.school.id}/instructors/add-manually`).send(coachBody()), `${who} coach`);
    }
    const main = await as(s.main);
    expect((await main.post(`/v1/schools/${s.school.id}/role-grants/add-manually`).send(staffBody())).status).toBe(201);
    expect((await main.post(`/v1/schools/${s.school.id}/instructors/add-manually`).send(coachBody())).status).toBe(201);
    expect(await superuser.roleGrant.count({ where: { schoolId: s.school.id, grantedById: { not: s.main.id }, user: { email: { startsWith: 'manual-' } } } })).toBe(0);
  });

  it('inviting and cancelling an invite: only the main owner', async () => {
    const s = await seed('invite');
    const url = `/v1/schools/${s.school.id}/coach-invites`;
    for (const [who, u] of Object.entries(refused(s))) {
      expectMainOwnerOnly(await (await as(u)).post(url).send({ email: `inv-${who}@example.test`, branchId: s.north.id }), `${who} coach invite`);
      expectMainOwnerOnly(await (await as(u)).post(url).send({ email: `inv-${who}@example.test`, branchId: s.north.id, role: 'BRANCH_STAFF' }), `${who} staff invite`);
    }
    for (const [who, u] of Object.entries(outsiders(s))) expectRefused(await (await as(u)).post(url).send({ email: `inv-${who}@example.test`, branchId: s.north.id }), who);
    expect(await superuser.coachInvite.count({ where: { schoolId: s.school.id } })).toBe(0);

    const sent = await (await as(s.main)).post(url).send({ email: `inv-${tag}@example.test`, branchId: s.north.id });
    expect(sent.status).toBe(201);
    for (const [who, u] of Object.entries(refused(s))) {
      expectMainOwnerOnly(await (await as(u)).post(`/v1/coach-invites/${sent.body.id}/cancel`), `${who} cancel`);
    }
    for (const [who, u] of Object.entries(outsiders(s))) {
      expectNotFound(await (await as(u)).post(`/v1/coach-invites/${sent.body.id}/cancel`), `${who} cancel`);
    }
    expect((await superuser.coachInvite.findUniqueOrThrow({ where: { id: sent.body.id } })).cancelledAt).toBeNull();
    expect((await (await as(s.main)).post(`/v1/coach-invites/${sent.body.id}/cancel`)).status).toBe(201);
  });

  it('pause, unpause and Remove from School: only the main owner', async () => {
    const s = await seed('pause');
    const base = `/v1/schools/${s.school.id}/staff/${s.staffTarget.id}`;
    for (const [who, u] of Object.entries(refused(s))) expectMainOwnerOnly(await (await as(u)).post(`${base}/pause`), `${who} pause`);
    for (const [who, u] of Object.entries(outsiders(s))) expectRefused(await (await as(u)).post(`${base}/pause`), `${who} pause`);
    expect((await superuser.roleGrant.findUniqueOrThrow({ where: { id: s.staffTargetGrant.id } })).pausedAt).toBeNull();

    expect((await (await as(s.main)).post(`${base}/pause`)).status).toBe(201);
    for (const [who, u] of Object.entries(refused(s))) expectMainOwnerOnly(await (await as(u)).post(`${base}/unpause`), `${who} unpause`);
    expect((await (await as(s.main)).post(`${base}/unpause`)).status).toBe(201);

    for (const [who, u] of Object.entries(refused(s))) expectMainOwnerOnly(await (await as(u)).post(`${base}/remove`).send({}), `${who} remove`);
    for (const [who, u] of Object.entries(outsiders(s))) expectRefused(await (await as(u)).post(`${base}/remove`).send({}), `${who} remove`);
    expect((await superuser.roleGrant.findUniqueOrThrow({ where: { id: s.staffTargetGrant.id } })).revokedAt).toBeNull();
    expect((await (await as(s.main)).post(`${base}/remove`).send({})).status).toBe(201);
    expect((await superuser.roleGrant.findUniqueOrThrow({ where: { id: s.staffTargetGrant.id } })).revokedAt).not.toBeNull();
  });

  it('closing a Branch that moves staff and coach roles: only the main owner; a co-owner may still close an empty Branch', async () => {
    const s = await seed('close');
    const empty = await superuser.branch.create({ data: { id: randomUUID(), schoolId: s.school.id, name: `Empty ${tag}` } });
    expect((await (await as(s.co)).post(`/v1/branches/${empty.id}/close`).send({})).status).toBe(201);

    const moved = await (await as(s.co)).post(`/v1/branches/${s.south.id}/close`).send({ staffTo: s.north.id });
    expectMainOwnerOnly(moved, 'co-owner close');
    expect((await superuser.roleGrant.findUniqueOrThrow({ where: { id: s.coachTargetGrant.id } })).revokedAt).toBeNull();
    expect((await (await as(s.main)).post(`/v1/branches/${s.south.id}/close`).send({ staffTo: s.north.id })).status).toBe(201);
    expect(await superuser.roleGrant.count({ where: { userId: s.coachTarget.id, branchId: s.north.id, revokedAt: null } })).toBe(1);
  });

  it('says who is the main owner, for the portal', async () => {
    const s = await seed('me');
    const me = async (u: U) => (await (await as(u)).get(`/v1/schools/${s.school.id}/staff/me/access`)).body;
    expect(await me(s.main)).toMatchObject({ owner: true, mainOwner: true });
    expect(await me(s.co)).toMatchObject({ owner: true, mainOwner: false });
    expect(await me(s.staff)).toMatchObject({ owner: false, mainOwner: false, branchStaff: true });
    expect(await me(s.coach)).toMatchObject({ owner: false, mainOwner: false });
  });

  it('a hand-over moves the right at once: the new main owner gives roles, the former one no longer does', async () => {
    const s = await seed('handover');
    const sent = await (await as(s.main)).post(`/v1/schools/${s.school.id}/coach-invites`).send({ email: `before-handover-${tag}@example.test`, branchId: s.north.id });
    expect(sent.status).toBe(201);
    // What POST /schools/{id}/main-owner writes (school-main-owner.e2e-spec covers the endpoint and its passcode check).
    await superuser.roleGrant.updateMany({ where: { schoolId: s.school.id, isMainOwner: true }, data: { isMainOwner: false } });
    await superuser.roleGrant.updateMany({ where: { schoolId: s.school.id, userId: s.co.id, role: 'SCHOOL_OWNER_MANAGER' }, data: { isMainOwner: true } });

    const body = { role: 'INSTRUCTOR', schoolId: s.school.id, branchId: s.north.id };
    expectMainOwnerOnly(await (await as(s.main)).post(`/v1/users/${s.target.id}/role-grants`).send(body), 'former main owner');
    expect((await (await as(s.co)).post(`/v1/users/${s.target.id}/role-grants`).send(body)).status).toBe(201);
    // An invite the former main owner sent while main still works: they are still an owner.
    const invite = await superuser.coachInvite.findUniqueOrThrow({ where: { id: sent.body.id } });
    expect(invite.cancelledAt).toBeNull();
  });

  it('students still join by themselves, and any owner still ends a student\'s enrolment', async () => {
    const s = await seed('students');
    const joiner = await mkUser('Jo');
    const joined = await (await as(joiner)).post(`/v1/schools/${s.school.id}/join`).send({ branchId: s.north.id });
    expect(joined.status).toBe(201);
    expect(await superuser.roleGrant.count({ where: { userId: joiner.id, schoolId: s.school.id, role: 'STUDENT', revokedAt: null } })).toBe(1);

    const ended = await (await as(s.co)).delete(`/v1/users/${s.student.id}/role-grants/${s.studentGrant.id}`);
    expect(ended.status).toBe(200);
    // Branch Staff and coaches still can't.
    const joinerGrant = await superuser.roleGrant.findFirstOrThrow({ where: { userId: joiner.id, schoolId: s.school.id, role: 'STUDENT' } });
    expectRefused(await (await as(s.staff)).delete(`/v1/users/${joiner.id}/role-grants/${joinerGrant.id}`), 'staff on a student');
    expectRefused(await (await as(s.coach)).delete(`/v1/users/${joiner.id}/role-grants/${joinerGrant.id}`), 'coach on a student');
  });

  it('a Franchise owner gives no roles inside a member School', async () => {
    const s = await seed('franchise');
    const fo = await as(s.franchiseOwner);
    for (const role of ['INSTRUCTOR', 'BRANCH_STAFF', 'SCHOOL_OWNER_MANAGER']) {
      const res = await fo.post(`/v1/users/${s.target.id}/role-grants`).send({ role, schoolId: s.school.id, ...(role === 'SCHOOL_OWNER_MANAGER' ? {} : { branchId: s.north.id }) });
      expect(res.status).toBe(403);
    }
    expectMainOwnerOnly(await fo.post(`/v1/schools/${s.school.id}/staff/${s.staffTarget.id}/pause`), 'franchise owner pause');
    expect(await superuser.roleGrant.count({ where: { userId: s.target.id } })).toBe(0);
  });
});
