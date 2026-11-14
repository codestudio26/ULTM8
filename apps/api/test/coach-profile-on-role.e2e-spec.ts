/**
 * Every coach has a coach profile (Instructor row) however they got the role
 * (owner's choice, 14 Nov 2026): accepting an invite and "Give a role" make
 * the empty row with the role; "My coach profile" makes it first for an
 * account that has the role but no row yet. Before this, both answered 404
 * "You have no Instructor profile." for such coaches. Real HTTP, real
 * Postgres RLS.
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
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Coach profile comes with the coach role', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const sent: Array<{ subject: string; body: string }> = [];
  const previousBaseUrl = process.env.PORTAL_BASE_URL;
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const token: Record<string, string> = {};
  const user: Record<string, { id: string; email: string }> = {};
  let school: { id: string };
  let north: { id: string };
  let south: { id: string };
  let otherSchool: { id: string };

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `coach-profile-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Profile',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    user[label] = { id: u.id, email: u.email };
  }
  const sign = async (label: string) => {
    const grants = await superuser.roleGrant.findMany({ where: { userId: user[label].id, revokedAt: null } });
    token[label] = jwt.sign({
      sub: user[label].id,
      email: user[label].email,
      grants: grants.map((g) => ({ role: g.role, franchiseId: g.franchiseId, schoolId: g.schoolId, branchId: g.branchId })),
    });
  };
  const http = () => request(app.getHttpServer());
  const as = (label: string) => ({
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${token[label]}`),
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token[label]}`),
    delete: (url: string) => http().delete(url).set('Authorization', `Bearer ${token[label]}`),
    patch: (url: string) => http().patch(url).set('Authorization', `Bearer ${token[label]}`),
  });

  beforeAll(async () => {
    process.env.PORTAL_BASE_URL = 'https://portal.example.test/';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationDeliveryService)
      .useValue({
        sendEmail: async (_to: string, subject: string, body: string) => {
          sent.push({ subject, body });
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Profile Dojo' } });
    schoolIds.push(school.id);
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Other Dojo' } });
    schoolIds.push(otherSchool.id);
    north = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'North' } });
    south = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'South' } });
    for (const label of ['owner', 'otherOwner', 'invited', 'given', 'twin', 'regrant', 'existing', 'student', 'revoked']) await mkUser(label);
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: user.owner.id, schoolId: school.id, isMainOwner: true },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: user.otherOwner.id, schoolId: otherSchool.id, isMainOwner: true },
        // An account given the coach role before profiles came with it: the
        // role at South, no Instructor row.
        { id: randomUUID(), role: 'INSTRUCTOR', userId: user.existing.id, schoolId: school.id, branchId: south.id },
        { id: randomUUID(), role: 'STUDENT', userId: user.student.id, schoolId: school.id },
        // A coach role that was taken away, never with a row.
        { id: randomUUID(), role: 'INSTRUCTOR', userId: user.revoked.id, schoolId: school.id, branchId: north.id, revokedAt: new Date() },
        { id: randomUUID(), role: 'STUDENT', userId: user.revoked.id, schoolId: school.id },
      ],
    });
    for (const label of Object.keys(user)) await sign(label);
  });

  afterAll(async () => {
    process.env.PORTAL_BASE_URL = previousBaseUrl;
    await superuser.instructor.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.coachInvite.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  const rows = (label: string) => superuser.instructor.findMany({ where: { userId: user[label].id }, select: { id: true, schoolId: true, branchId: true, bio: true } });
  const giveRole = (label: string, branchId: string, schoolId = school.id, by = 'owner') =>
    as(by).post(`/v1/users/${user[label].id}/role-grants`).send({ role: 'INSTRUCTOR', schoolId, branchId });

  it('accepting a coach invite makes the empty coach profile, and "My coach profile" saves', async () => {
    const inv = await as('owner').post(`/v1/schools/${school.id}/coach-invites`).send({ email: user.invited.email, branchId: north.id });
    expect(inv.status).toBe(201);
    const link = sent.map((s) => s.body.match(/\/coach-invite\/([A-Za-z0-9_-]+)/)).filter(Boolean).pop()![1];
    expect((await as('invited').post(`/v1/coach-invite-links/${link}/accept`)).status).toBe(201);
    expect(await rows('invited')).toEqual([{ id: expect.any(String), schoolId: school.id, branchId: north.id, bio: null }]);
    await sign('invited');

    const save = await as('invited').patch('/v1/instructors/me/profile').send({ bio: 'Black belt' });
    expect(save.status).toBe(200);
    expect(save.body.items).toHaveLength(1);
    expect(save.body.items[0]).toMatchObject({ schoolId: school.id, bio: 'Black belt', status: 'ACTIVE' });
    expect((await as('invited').post('/v1/instructors/me/certification-upload-url').send({ contentType: 'application/pdf' })).status).toBe(201);

    // On the owner's Instructors list now, and no longer offered by "Add instructor".
    const list = await as('owner').get(`/v1/schools/${school.id}/instructors`);
    expect(list.body.items.map((i: { userId: string }) => i.userId)).toContain(user.invited.id);
    const eligible = await as('owner').get(`/v1/schools/${school.id}/instructors/eligible-users`);
    expect(eligible.body.items.map((i: { id: string }) => i.id)).not.toContain(user.invited.id);
  });

  it('"Give a role" (INSTRUCTOR) makes the empty coach profile; a second branch keeps the one row', async () => {
    const give = await giveRole('given', north.id);
    expect(give.status).toBe(201);
    expect(await rows('given')).toEqual([{ id: expect.any(String), schoolId: school.id, branchId: north.id, bio: null }]);
    expect((await giveRole('given', south.id)).status).toBe(201);
    expect(await rows('given')).toHaveLength(1);
    await sign('given');
    const save = await as('given').patch('/v1/instructors/me/profile').send({ bio: 'Brown belt' });
    expect(save.status).toBe(200);
    expect(save.body.items[0]).toMatchObject({ bio: 'Brown belt' });
  });

  it('two coach roles given at the same moment make one row, and both succeed', async () => {
    const [a, b] = await Promise.all([giveRole('twin', north.id), giveRole('twin', south.id)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await rows('twin')).toHaveLength(1);
  });

  it('a coach given the role before this, with no row, gets it on "My coach profile" (both calls)', async () => {
    expect(await rows('existing')).toHaveLength(0);
    const upload = await as('existing').post('/v1/instructors/me/certification-upload-url').send({ contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    expect(await rows('existing')).toEqual([{ id: expect.any(String), schoolId: school.id, branchId: south.id, bio: null }]);
    const save = await as('existing').patch('/v1/instructors/me/profile').send({ bio: 'Purple belt' });
    expect(save.status).toBe(200);
    expect(await rows('existing')).toEqual([expect.objectContaining({ schoolId: school.id, branchId: south.id, bio: 'Purple belt' })]);
  });

  it('no live coach role: 404 as before, and no row is made', async () => {
    for (const label of ['student', 'revoked']) {
      const save = await as(label).patch('/v1/instructors/me/profile').send({ bio: 'x' });
      expect(save.status).toBe(404);
      expect(save.body.error.message).toBe('You have no Instructor profile.');
      expect((await as(label).post('/v1/instructors/me/certification-upload-url').send({ contentType: 'application/pdf' })).status).toBe(404);
      expect(await rows(label)).toHaveLength(0);
    }
  });

  it('revoked then given again: the same row, never a second one', async () => {
    expect((await giveRole('regrant', north.id)).status).toBe(201);
    const [first] = await rows('regrant');
    await sign('regrant');
    expect((await as('regrant').patch('/v1/instructors/me/profile').send({ bio: 'Kept' })).status).toBe(200);
    const grant = await superuser.roleGrant.findFirstOrThrow({ where: { userId: user.regrant.id, role: 'INSTRUCTOR', revokedAt: null } });
    expect((await as('owner').delete(`/v1/users/${user.regrant.id}/role-grants/${grant.id}`)).status).toBe(200);
    // Revoked: still listed (Revoked), the row untouched.
    const list = await as('owner').get(`/v1/schools/${school.id}/instructors`);
    expect(list.body.items.find((i: { userId: string }) => i.userId === user.regrant.id)).toMatchObject({ id: first.id, status: 'REVOKED' });
    expect((await giveRole('regrant', north.id)).status).toBe(201);
    expect(await rows('regrant')).toEqual([{ id: first.id, schoolId: school.id, branchId: north.id, bio: 'Kept' }]);
  });

  it('cross-tenant: another School\'s owner can\'t make a coach profile here, and a coach\'s save makes rows only where they coach', async () => {
    const before = await superuser.instructor.count({ where: { schoolId: school.id } });
    const foreign = await giveRole('student', north.id, school.id, 'otherOwner');
    expect([403, 404]).toContain(foreign.status);
    const foreign2 = await as('otherOwner').post(`/v1/users/${user.student.id}/role-grants`).send({ role: 'INSTRUCTOR', schoolId: school.id });
    expect([400, 403, 404]).toContain(foreign2.status);
    expect(await superuser.instructor.count({ where: { schoolId: school.id } })).toBe(before);
    expect(await superuser.instructor.count({ where: { schoolId: otherSchool.id } })).toBe(0);

    // A coach at Profile Dojo who is a student at Other Dojo: their save never
    // reaches Other Dojo.
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.existing.id, schoolId: otherSchool.id } });
    await sign('existing');
    expect((await as('existing').patch('/v1/instructors/me/profile').send({ bio: 'Again' })).status).toBe(200);
    expect((await rows('existing')).map((r) => r.schoolId)).toEqual([school.id]);
    expect(await superuser.instructor.count({ where: { schoolId: otherSchool.id } })).toBe(0);
  });
});
