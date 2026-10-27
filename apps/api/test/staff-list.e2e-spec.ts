/**
 * Decision 361: the Staff page's list, "Remove from School", blank names on
 * Add Manually, and role changes that take effect on the next request.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, and JWT_ACCESS_SECRET — skips with a
 * warning if any are unset, same convention as every other e2e spec in this repo.
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
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[staff-list.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('Staff list, Remove from School and instant role changes (Decision 361)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const tag = randomUUID().slice(0, 8);
  const PASSCODE = '135790';

  let school: { id: string };
  let other: { id: string };
  let north: { id: string };
  let south: { id: string };
  let owner: { id: string; email: string };
  let ownerToken: string;

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => http().delete(url).set('Authorization', `Bearer ${token}`),
  });
  const ownerOf = (u: { id: string; email: string }, schoolId: string) =>
    jwt.sign({ sub: u.id, email: u.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId, branchId: null }] });

  let passcodeHash: string;
  const mkUser = (firstName: string, surname = 'Staff') =>
    superuser.user.create({
      data: {
        id: randomUUID(),
        email: `staff-list-${firstName.toLowerCase()}-${tag}-${randomUUID().slice(0, 6)}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName,
        surname,
        passcodeHash,
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
  const grant = (userId: string, role: 'INSTRUCTOR' | 'BRANCH_STAFF' | 'STUDENT' | 'SCHOOL_OWNER_MANAGER', schoolId: string, branchId: string | null = null) =>
    superuser.roleGrant.create({ data: { id: randomUUID(), role, userId, schoolId, branchId, grantedById: owner.id } });
  const login = async (email: string) => {
    const res = await http().post('/v1/auth/login').send({ email, passcode: PASSCODE });
    expect(res.status).toBe(201);
    return res.body as { accessToken: string; refreshToken: string };
  };

  beforeAll(async () => {
    process.env.PORTAL_BASE_URL = 'https://portal.example.test';
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

    school = await superuser.school.create({ data: { id: randomUUID(), name: `Staff List ${tag}` } });
    other = await superuser.school.create({ data: { id: randomUUID(), name: `Staff List other ${tag}` } });
    north = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'North' } });
    south = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'South' } });
    owner = await mkUser('Olive', 'Owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    ownerToken = ownerOf(owner, school.id);
  });

  afterAll(async () => {
    const schools = await superuser.school.findMany({ where: { name: { contains: tag } }, select: { id: true } });
    const where = { schoolId: { in: schools.map((s) => s.id) } };
    await superuser.coachInvite.deleteMany({ where });
    await superuser.gradingPermission.deleteMany({ where });
    await superuser.staffPermission.deleteMany({ where });
    await superuser.roleGrant.deleteMany({ where });
    await superuser.branch.deleteMany({ where });
    const users = await superuser.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
    await superuser.refreshToken.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await superuser.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: schools.map((s) => s.id) } } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('staff list', () => {
    it('lists active staff with their roles and branches, and finds removed staff under the Removed filter', async () => {
      const coach = await mkUser('Cara', 'Coach');
      await grant(coach.id, 'INSTRUCTOR', school.id, north.id);
      await grant(coach.id, 'INSTRUCTOR', school.id, south.id);
      const desk = await mkUser('Dev', 'Desk');
      await grant(desk.id, 'BRANCH_STAFF', school.id, north.id);
      const gone = await mkUser('Gail', 'Gone');
      const goneGrant = await grant(gone.id, 'BRANCH_STAFF', school.id, south.id);
      await superuser.roleGrant.update({ where: { id: goneGrant.id }, data: { revokedAt: new Date() } });
      const student = await mkUser('Stu', 'Dent');
      await grant(student.id, 'STUDENT', school.id);

      const res = await as(ownerToken).get(`/v1/schools/${school.id}/staff`);
      expect(res.status).toBe(200);
      const ids = res.body.items.map((i: { userId: string }) => i.userId);
      expect(ids).toEqual(expect.arrayContaining([owner.id, coach.id, desk.id]));
      expect(ids).not.toContain(gone.id);
      expect(ids).not.toContain(student.id);
      const cara = res.body.items.find((i: { userId: string }) => i.userId === coach.id);
      expect(cara).toMatchObject({ firstName: 'Cara', email: coach.email, phone: coach.phone, active: true, removedAt: null });
      expect(cara.roles.map((r: { branchName: string }) => r.branchName).sort()).toEqual(['North', 'South']);
      expect(cara.roles[0].grantedByName).toBe('Olive Owner');

      const removed = await as(ownerToken).get(`/v1/schools/${school.id}/staff`).query({ status: 'removed' });
      expect(removed.body.items.map((i: { userId: string }) => i.userId)).toEqual([gone.id]);
      expect(removed.body.items[0]).toMatchObject({ active: false, firstName: 'Gail' });
      expect(removed.body.items[0].removedAt).not.toBeNull();
    });

    it('filters by role, branch and a name or email typed in any capitals', async () => {
      const ben = await mkUser('Benedict', 'Filter');
      await grant(ben.id, 'BRANCH_STAFF', school.id, south.id);
      const byRole = await as(ownerToken).get(`/v1/schools/${school.id}/staff`).query({ role: 'BRANCH_STAFF', branchId: south.id });
      expect(byRole.body.items.map((i: { userId: string }) => i.userId)).toEqual([ben.id]);
      const byName = await as(ownerToken).get(`/v1/schools/${school.id}/staff`).query({ q: 'BENEDICT' });
      expect(byName.body.items.map((i: { userId: string }) => i.userId)).toEqual([ben.id]);
      const byEmail = await as(ownerToken).get(`/v1/schools/${school.id}/staff`).query({ q: ben.email.toUpperCase() });
      expect(byEmail.body.items.map((i: { userId: string }) => i.userId)).toEqual([ben.id]);
    });

    it('is the owner’s only: Branch Staff, coaches and another School’s owner are refused', async () => {
      const desk = await mkUser('Nosy', 'Desk');
      await grant(desk.id, 'BRANCH_STAFF', school.id, north.id);
      const deskToken = jwt.sign({ sub: desk.id, email: desk.email, grants: [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: north.id }] });
      expect((await as(deskToken).get(`/v1/schools/${school.id}/staff`)).status).toBe(403);

      const stranger = await mkUser('Stranger', 'Owner');
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: stranger.id, schoolId: other.id } });
      const res = await as(ownerOf(stranger, other.id)).get(`/v1/schools/${school.id}/staff`);
      expect(res.status).toBe(403);
      const own = await as(ownerOf(stranger, other.id)).get(`/v1/schools/${other.id}/staff`);
      expect(own.body.items.map((i: { userId: string }) => i.userId)).toEqual([stranger.id]);
    });
  });

  describe('Remove from School', () => {
    it('ends every coach and staff role at every branch, keeps the student role, and clears their rights', async () => {
      const person = await mkUser('Rex', 'Removed');
      await grant(person.id, 'INSTRUCTOR', school.id, north.id);
      await grant(person.id, 'BRANCH_STAFF', school.id, south.id);
      await grant(person.id, 'STUDENT', school.id);
      await superuser.staffPermission.create({ data: { id: randomUUID(), userId: person.id, schoolId: school.id, canInviteCoaches: true } });

      const res = await as(ownerToken).post(`/v1/schools/${school.id}/staff/${person.id}/remove`);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ removedRoles: 2 });

      const live = await superuser.roleGrant.findMany({ where: { userId: person.id, revokedAt: null }, select: { role: true } });
      expect(live).toEqual([{ role: 'STUDENT' }]);
      expect((await superuser.staffPermission.findFirstOrThrow({ where: { userId: person.id } })).canInviteCoaches).toBe(false);

      const removed = await as(ownerToken).get(`/v1/schools/${school.id}/staff`).query({ status: 'removed' });
      expect(removed.body.items.map((i: { userId: string }) => i.userId)).toContain(person.id);

      const again = await as(ownerToken).post(`/v1/schools/${school.id}/staff/${person.id}/remove`);
      expect(again.status).toBe(404);
    });

    it('never removes an owner role, and another School’s owner can’t remove anyone here', async () => {
      const coOwner = await mkUser('Cole', 'Owner');
      await grant(coOwner.id, 'SCHOOL_OWNER_MANAGER', school.id);
      expect((await as(ownerToken).post(`/v1/schools/${school.id}/staff/${coOwner.id}/remove`)).status).toBe(404);
      expect(await superuser.roleGrant.count({ where: { userId: coOwner.id, revokedAt: null } })).toBe(1);

      const coach = await mkUser('Kept', 'Coach');
      await grant(coach.id, 'INSTRUCTOR', school.id, north.id);
      const stranger = await mkUser('Thief', 'Owner');
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: stranger.id, schoolId: other.id } });
      expect((await as(ownerOf(stranger, other.id)).post(`/v1/schools/${school.id}/staff/${coach.id}/remove`)).status).toBe(403);
      expect(await superuser.roleGrant.count({ where: { userId: coach.id, revokedAt: null } })).toBe(1);
    });
  });

  describe('role changes take effect on the next request', () => {
    it('a removed coach’s current token is refused at once; refreshing gives a token without the role', async () => {
      const coach = await mkUser('Quick', 'Coach');
      await grant(coach.id, 'INSTRUCTOR', school.id, north.id);
      const { accessToken, refreshToken } = await login(coach.email);
      const before = await as(accessToken).get(`/v1/users/${coach.id}/role-grants`);
      expect(before.status).toBe(200);

      await as(ownerToken).post(`/v1/schools/${school.id}/staff/${coach.id}/remove`).expect(201);

      const after = await as(accessToken).get(`/v1/users/${coach.id}/role-grants`);
      expect(after.status).toBe(401);
      expect(after.body.error.code).toBe('ROLES_CHANGED');

      const refreshed = await http().post('/v1/auth/refresh').send({ refreshToken });
      expect(refreshed.status).toBe(201);
      const claims = jwt.decode(refreshed.body.accessToken) as { grants: Array<{ role: string }> };
      expect(claims.grants.map((g) => g.role)).not.toContain('INSTRUCTOR');
      expect((await as(refreshed.body.accessToken).get(`/v1/users/${coach.id}/role-grants`)).status).toBe(200);
    });

    it('a new role reaches a signed-in person at once too, and other people’s tokens are untouched', async () => {
      const person = await mkUser('New', 'Hire');
      const bystander = await mkUser('By', 'Stander');
      await grant(bystander.id, 'STUDENT', school.id);
      const mine = await login(person.email);
      const theirs = await login(bystander.email);

      const given = await as(ownerToken).post(`/v1/users/${person.id}/role-grants`).send({ role: 'BRANCH_STAFF', schoolId: school.id, branchId: north.id });
      expect(given.status).toBe(201);

      expect((await as(mine.accessToken).get(`/v1/users/${person.id}/role-grants`)).status).toBe(401);
      const refreshed = await http().post('/v1/auth/refresh').send({ refreshToken: mine.refreshToken });
      const claims = jwt.decode(refreshed.body.accessToken) as { grants: Array<{ role: string }> };
      expect(claims.grants.map((g) => g.role)).toContain('BRANCH_STAFF');

      expect((await as(theirs.accessToken).get(`/v1/users/${bystander.id}/role-grants`)).status).toBe(200);
    });

    it('the database stamps the change for every path, including a direct write', async () => {
      const person = await mkUser('Raw', 'Write');
      const { accessToken } = await login(person.email);
      // A grant written straight to the database (as a job or SQL function
      // would) is still caught, within the few seconds an API instance trusts
      // its last read.
      await superuser.$executeRawUnsafe(
        `INSERT INTO "RoleGrant" ("id", "role", "userId", "schoolId", "grantedAt", "createdAt", "updatedAt") VALUES ($1, 'STUDENT', $2, $3, now(), now(), now())`,
        randomUUID(),
        person.id,
        school.id,
      );
      const stamped = await superuser.user.findUniqueOrThrow({ where: { id: person.id }, select: { rolesChangedAt: true } });
      expect(stamped.rolesChangedAt).not.toBeNull();
      await new Promise((r) => setTimeout(r, 5_200));
      expect((await as(accessToken).get(`/v1/users/${person.id}/role-grants`)).status).toBe(401);
    });
  });

  describe('Add Manually refuses names made only of spaces', () => {
    it('for Staff and for Instructors', async () => {
      const staff = await as(ownerToken)
        .post(`/v1/schools/${school.id}/role-grants/add-manually`)
        .send({ firstName: '   ', surname: 'Blank', email: `blank-staff-${tag}@example.test`, branchId: north.id });
      expect(staff.status).toBe(400);
      const instructor = await as(ownerToken)
        .post(`/v1/schools/${school.id}/instructors/add-manually`)
        .send({ firstName: 'Blank', surname: ' ', email: `blank-coach-${tag}@example.test`, branchId: north.id });
      expect(instructor.status).toBe(400);
      expect(await superuser.user.count({ where: { email: { startsWith: 'blank-', contains: tag } } })).toBe(0);

      const ok = await as(ownerToken)
        .post(`/v1/schools/${school.id}/role-grants/add-manually`)
        .send({ firstName: '  Tess ', surname: ' Trim ', email: `trim-${tag}@example.test`, branchId: north.id });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ userFirstName: 'Tess', userSurname: 'Trim' });
    });
  });
});
