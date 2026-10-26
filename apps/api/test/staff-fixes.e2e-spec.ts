/**
 * Decisions 295 and 296: fixes from the Staff page review.
 *
 * 295 — one email, one account, whatever the capitals: every email that
 * creates or finds a User is lower-cased and trimmed, and the database refuses
 * a second account that differs only by case.
 * 296 — no new staff, coaches or coach invites at an archived Branch (nor
 * accepting an invite to one), and no role grants at a closed School.
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
import { createHash, randomBytes, randomUUID } from 'crypto';
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
    '[staff-fixes.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('Staff page fixes (Decisions 295, 296)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const tag = randomUUID().slice(0, 8);

  let school: { id: string };
  let live: { id: string };
  let archived: { id: string };
  let owner: { id: string; email: string };
  let ownerToken: string;

  const http = () => request(app.getHttpServer());
  const asOwner = () => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${ownerToken}`),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${ownerToken}`),
  });
  const tokenFor = (u: { id: string; email: string }, grants: Array<Record<string, unknown>> = []) =>
    jwt.sign({ sub: u.id, email: u.email, grants });

  const mkUser = (label: string, email = `staff-fixes-${label}-${tag}-${randomUUID()}@example.test`, passcodeHash = 'x') =>
    superuser.user.create({
      data: {
        id: randomUUID(),
        email,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Fixes',
        passcodeHash,
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });

  beforeAll(async () => {
    process.env.PORTAL_BASE_URL = 'https://portal.example.test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationDeliveryService)
      .useValue({ sendEmail: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: `Staff Fixes ${tag}` } });
    live = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Live' } });
    archived = await superuser.branch.create({
      data: { id: randomUUID(), schoolId: school.id, name: 'Archived', archivedAt: new Date(), purgeAt: new Date(Date.now() + 90 * 86_400_000) },
    });
    owner = await mkUser('owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    ownerToken = tokenFor(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
  });

  afterAll(async () => {
    const schools = await superuser.school.findMany({ where: { name: { contains: tag } }, select: { id: true } });
    const where = { schoolId: { in: schools.map((s) => s.id) } };
    await superuser.coachInvite.deleteMany({ where });
    await superuser.staffPermission.deleteMany({ where });
    await superuser.roleGrant.deleteMany({ where });
    await superuser.branch.deleteMany({ where });
    await superuser.user.deleteMany({ where: { email: { contains: tag, mode: 'insensitive' } } });
    await superuser.school.deleteMany({ where: { id: { in: schools.map((s) => s.id) } } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('Decision 295 — emails ignore case', () => {
    it('Find locates an account whatever the capitals or spaces typed', async () => {
      const person = await mkUser('find', `find-${tag}@example.test`);
      for (const typed of [`FIND-${tag}@Example.TEST`, `  find-${tag}@example.test  `]) {
        const res = await asOwner().get(`/v1/schools/${school.id}/role-grants/invite-candidate`).query({ email: typed });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ found: true, id: person.id });
      }
    });

    it('Add Manually and Add Instructor Manually refuse an existing account typed with other capitals', async () => {
      await mkUser('dup', `dup-${tag}@example.test`);
      const staff = await asOwner()
        .post(`/v1/schools/${school.id}/role-grants/add-manually`)
        .send({ firstName: 'Dup', surname: 'Staff', email: `DUP-${tag}@Example.test`, branchId: live.id });
      expect(staff.status).toBe(409);
      const instructor = await asOwner()
        .post(`/v1/schools/${school.id}/instructors/add-manually`)
        .send({ firstName: 'Dup', surname: 'Coach', email: `Dup-${tag}@EXAMPLE.test`, branchId: live.id });
      expect(instructor.status).toBe(409);
      expect(await superuser.user.count({ where: { email: { equals: `dup-${tag}@example.test`, mode: 'insensitive' } } })).toBe(1);
    });

    it('Add Manually stores the email in lower case', async () => {
      const res = await asOwner()
        .post(`/v1/schools/${school.id}/role-grants/add-manually`)
        .send({ firstName: 'New', surname: 'Staff', email: ` New.Staff-${tag}@Example.TEST `, branchId: live.id });
      expect(res.status).toBe(201);
      expect(res.body.email).toBe(`new.staff-${tag}@example.test`);
    });

    it('login works whatever the capitals typed', async () => {
      const passcodeHash = await bcrypt.hash('246810', 4);
      await mkUser('login', `login-${tag}@example.test`, passcodeHash);
      const res = await http().post('/v1/auth/login').send({ email: `LOGIN-${tag}@Example.Test`, passcode: '246810' });
      expect(res.status).toBe(201);
      expect(typeof res.body.accessToken).toBe('string');
    });

    it('the database refuses a second account that differs only by case', async () => {
      await mkUser('unique', `unique-${tag}@example.test`);
      await expect(mkUser('unique2', `UNIQUE-${tag}@example.test`)).rejects.toThrow();
    });
  });

  describe('Decision 296 — archived branches and closed Schools', () => {
    it('no new staff, coach or coach invite at an archived branch', async () => {
      const person = await mkUser('arch');
      const grant = await asOwner()
        .post(`/v1/users/${person.id}/role-grants`)
        .send({ role: 'BRANCH_STAFF', schoolId: school.id, branchId: archived.id });
      expect(grant.status).toBe(400);
      expect(grant.body.error.message).toContain('archived');

      const coach = await asOwner()
        .post(`/v1/users/${person.id}/role-grants`)
        .send({ role: 'INSTRUCTOR', schoolId: school.id, branchId: archived.id });
      expect(coach.status).toBe(400);

      const manual = await asOwner()
        .post(`/v1/schools/${school.id}/role-grants/add-manually`)
        .send({ firstName: 'A', surname: 'B', email: `arch-manual-${tag}@example.test`, branchId: archived.id });
      expect(manual.status).toBe(400);
      expect(await superuser.user.count({ where: { email: `arch-manual-${tag}@example.test` } })).toBe(0);

      const invite = await asOwner()
        .post(`/v1/schools/${school.id}/coach-invites`)
        .send({ email: `arch-invite-${tag}@example.test`, branchId: archived.id });
      expect(invite.status).toBe(400);

      expect(await superuser.roleGrant.count({ where: { branchId: archived.id } })).toBe(0);
    });

    it('a live branch still works', async () => {
      const person = await mkUser('live');
      const grant = await asOwner()
        .post(`/v1/users/${person.id}/role-grants`)
        .send({ role: 'BRANCH_STAFF', schoolId: school.id, branchId: live.id });
      expect(grant.status).toBe(201);
    });

    it('an invite to a branch archived after it was sent can no longer be accepted', async () => {
      const later = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Later archived' } });
      const person = await mkUser('late', `late-${tag}@example.test`);
      const token = randomBytes(32).toString('base64url');
      await superuser.coachInvite.create({
        data: {
          id: randomUUID(),
          schoolId: school.id,
          branchId: later.id,
          email: person.email,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          invitedById: owner.id,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        },
      });
      await superuser.branch.update({ where: { id: later.id }, data: { archivedAt: new Date() } });

      expect((await http().get(`/v1/coach-invite-links/${token}`)).body.status).toBe('CANCELLED');
      const accept = await http().post(`/v1/coach-invite-links/${token}/accept`).set('Authorization', `Bearer ${tokenFor(person)}`);
      expect(accept.status).toBe(410);
      expect(await superuser.roleGrant.count({ where: { userId: person.id } })).toBe(0);
    });

    it('no role grants at a closed School', async () => {
      const closed = await superuser.school.create({ data: { id: randomUUID(), name: `Staff Fixes closed ${tag}`, archivedAt: new Date() } });
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: closed.id } });
      const token = tokenFor(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: closed.id, branchId: null }]);
      const person = await mkUser('closed');
      const res = await http()
        .post(`/v1/users/${person.id}/role-grants`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'INSTRUCTOR', schoolId: closed.id });
      expect(res.status).toBe(403);
      expect(await superuser.roleGrant.count({ where: { userId: person.id } })).toBe(0);
    });
  });
});
