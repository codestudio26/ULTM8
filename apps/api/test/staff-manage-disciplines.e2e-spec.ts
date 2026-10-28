/**
 * Decision 383 over real HTTP: the owner's "Can manage disciplines" switch
 * for Branch Staff. Off by default; with it on, a Branch Staff member edits
 * the School's styles, belts and skills with the whole School in view (a
 * rename reaches other branches' classes, a belt a student holds can't be
 * deleted, a class in another branch blocks archiving), deletes an unused
 * archived style, but sets no grade prices and doesn't see the students
 * list. Losing the Branch Staff role clears the switch.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET.
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
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[staff-manage-disciplines.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

describeIfDb('Branch Staff "Can manage disciplines" (Decision 383)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const tag = `staff-disc-${randomUUID().slice(0, 8)}`;
  let school: { id: string };
  let other: { id: string };
  let north: { id: string };
  let south: { id: string };
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  let staffGrantId: string;

  const as = (who: string) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${tokens[who]}`);
    const server = () => request(app.getHttpServer());
    return {
      get: (path: string) => auth(server().get(path)),
      post: (path: string) => auth(server().post(path)),
      patch: (path: string) => auth(server().patch(path)),
      put: (path: string) => auth(server().put(path)),
      delete: (path: string) => auth(server().delete(path)),
    };
  };
  const allow = (on: boolean) => as('owner').put(`/v1/schools/${school.id}/staff-permissions/${users.staff.id}`).send({ canManageDisciplines: on });
  const tomorrow = () => new Date(Date.now() + 86_400_000);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: tag, ranksToggle: true } });
    other = await superuser.school.create({ data: { id: randomUUID(), name: `${tag}-other`, ranksToggle: true } });
    north = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'North' } });
    south = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'South' } });
    for (const label of ['owner', 'staff', 'coach', 'student', 'otherStaff']) {
      users[label] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `${tag}-${label}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Disc',
          passcodeHash: 'x',
          dateOfBirth: new Date('1990-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
    }
    staffGrantId = randomUUID();
    const grants = [
      { label: 'owner', role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id, branchId: null },
      { label: 'staff', role: 'BRANCH_STAFF', schoolId: school.id, branchId: north.id, id: staffGrantId },
      { label: 'coach', role: 'INSTRUCTOR', schoolId: school.id, branchId: north.id },
      { label: 'student', role: 'STUDENT', schoolId: school.id, branchId: null },
      { label: 'otherStaff', role: 'BRANCH_STAFF', schoolId: other.id, branchId: null },
    ] as const;
    for (const g of grants) {
      await superuser.roleGrant.create({
        data: { id: 'id' in g ? g.id : randomUUID(), role: g.role, userId: users[g.label].id, schoolId: g.schoolId, branchId: g.branchId },
      });
      tokens[g.label] = jwt.sign({ sub: users[g.label].id, email: users[g.label].email, grants: [{ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: g.branchId }] });
    }
    // The other School's staff member has the switch there; it gives nothing here.
    await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId: other.id, userId: users.otherStaff.id, canManageDisciplines: true } });
  });

  afterAll(async () => {
    for (const id of [school.id, other.id]) {
      await superuser.studentRank.deleteMany({ where: { schoolId: id } });
      await superuser.class.deleteMany({ where: { schoolId: id } });
      await superuser.rankStripeTierRequiredSkill.deleteMany({ where: { skill: { schoolId: id } } });
      await superuser.skill.deleteMany({ where: { schoolId: id } });
      await superuser.rankStripeTier.deleteMany({ where: { schoolId: id } });
      await superuser.rank.deleteMany({ where: { schoolId: id } });
      await superuser.discipline.deleteMany({ where: { schoolId: id } });
      await superuser.staffPermission.deleteMany({ where: { schoolId: id } });
      await superuser.roleGrant.deleteMany({ where: { schoolId: id } });
      await superuser.branch.deleteMany({ where: { schoolId: id } });
    }
    const ids = Object.values(users).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: ids } } });
    await superuser.user.deleteMany({ where: { id: { in: ids } } });
    await superuser.school.deleteMany({ where: { id: { in: [school.id, other.id] } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('is off by default, set by the owner only, for Branch Staff only, and shows on both staff lists', async () => {
    expect((await as('staff').post(`/v1/schools/${school.id}/disciplines`).send({ name: 'Nope' })).status).toBe(403);
    expect((await as('staff').get(`/v1/schools/${school.id}/staff-permissions/me`)).body).toMatchObject({ isOwner: false, canManageDisciplines: false });
    expect((await as('owner').get(`/v1/schools/${school.id}/staff-permissions/me`)).body).toMatchObject({ isOwner: true, canManageDisciplines: true });

    expect((await as('staff').put(`/v1/schools/${school.id}/staff-permissions/${users.staff.id}`).send({ canManageDisciplines: true })).status).toBe(403);
    expect((await as('owner').put(`/v1/schools/${school.id}/staff-permissions/${users.coach.id}`).send({ canManageDisciplines: true })).status).toBe(400);
    expect((await as('owner').put(`/v1/schools/${school.id}/staff-permissions/${users.staff.id}`).send({})).status).toBe(400);

    const given = await allow(true);
    expect(given.status).toBe(200);
    // The other switch keeps its value.
    expect(given.body).toMatchObject({ canManageDisciplines: true, canInviteCoaches: false });
    expect((await as('staff').get(`/v1/schools/${school.id}/staff-permissions/me`)).body).toMatchObject({ canManageDisciplines: true, canInviteCoaches: false });
    const staffList = await as('owner').get(`/v1/schools/${school.id}/staff`);
    expect(staffList.body.items.find((p: { userId: string }) => p.userId === users.staff.id)).toMatchObject({ canManageDisciplines: true });
    const invite = await as('owner').put(`/v1/schools/${school.id}/staff-permissions/${users.staff.id}`).send({ canInviteCoaches: true });
    expect(invite.body).toMatchObject({ canManageDisciplines: true, canInviteCoaches: true });
    await as('owner').put(`/v1/schools/${school.id}/staff-permissions/${users.staff.id}`).send({ canInviteCoaches: false });
  });

  it('with it on, edits run with the whole School in view', async () => {
    const style = await as('staff').post(`/v1/schools/${school.id}/disciplines`).send({ name: 'BJJ', classTypesOffered: ['Adults'] });
    expect(style.status).toBe(201);
    const belt = await as('staff').post(`/v1/styles/${style.body.id}/ranks`).send({
      order: 0,
      name: 'White',
      primaryColour: '#FFFFFF',
      stripeTiers: [{ order: 0, count: 0, colour: '#FFFFFF', classesRequired: 1, eligibleClassTypes: ['Adults'] }],
    });
    expect(belt.status).toBe(201);
    const skill = await as('staff').post(`/v1/styles/${style.body.id}/skills`).send({ name: 'Armbar' });
    expect(skill.status).toBe(201);
    expect((await as('staff').patch(`/v1/skills/${skill.body.id}`).send({ name: 'Armbar from guard' })).status).toBe(200);

    // A class in the other branch: the staff member's own view can't see it.
    const cls = await as('owner').post(`/v1/schools/${school.id}/classes`).send({
      title: 'South BJJ',
      branchId: south.id,
      styles: [{ disciplineId: style.body.id, classType: 'Adults' }],
      startDate: tomorrow().toISOString(),
      endDate: new Date(tomorrow().getTime() + 3_600_000).toISOString(),
    });
    expect(cls.status).toBe(201);
    expect((await as('staff').patch(`/v1/disciplines/${style.body.id}`).send({ name: 'Jiu-Jitsu' })).status).toBe(200);
    expect((await superuser.class.findUniqueOrThrow({ where: { id: cls.body.id } })).activities).toEqual(['Jiu-Jitsu']);
    // The South class still uses it, so it can't be archived.
    expect((await as('staff').post(`/v1/disciplines/${style.body.id}/archive`)).status).toBe(409);

    // A student holds the belt: it can't be deleted.
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: users.student.id, disciplineId: style.body.id, schoolId: school.id, currentRankId: belt.body.id, currentStripeId: belt.body.stripeTiers[0].id },
    });
    expect((await as('staff').delete(`/v1/ranks/${belt.body.id}`)).status).toBe(409);
    expect((await as('staff').delete(`/v1/disciplines/${style.body.id}`)).status).toBe(409);

    // The students list on a style stays the owner's.
    expect((await as('staff').get(`/v1/styles/${style.body.id}/rung-holders`)).status).toBe(403);
    expect((await as('owner').get(`/v1/styles/${style.body.id}/rung-holders`)).status).toBe(200);
  });

  it('sets no grade prices, and keeps the ones the owner set', async () => {
    await superuser.school.update({ where: { id: school.id }, data: { promotionFeeEnabled: true } });
    try {
      const style = await as('owner').post(`/v1/schools/${school.id}/disciplines`).send({ name: 'Judo' });
      const belt = await as('owner').post(`/v1/styles/${style.body.id}/ranks`).send({
        order: 0,
        name: 'White',
        primaryColour: '#FFFFFF',
        stripeTiers: [{ order: 0, count: 0, colour: '#FFFFFF', classesRequired: 1, promotionFeeMinor: 2500 }],
      });
      expect(belt.status).toBe(201);
      const tier = belt.body.stripeTiers[0];
      const priced = await as('staff').patch(`/v1/ranks/${belt.body.id}`).send({ stripeTiers: [{ id: tier.id, order: 0, count: 0, colour: '#FFFFFF', classesRequired: 2, promotionFeeMinor: 100 }] });
      expect(priced.status).toBe(403);
      const edited = await as('staff').patch(`/v1/ranks/${belt.body.id}`).send({ name: 'White belt', stripeTiers: [{ id: tier.id, order: 0, count: 0, colour: '#FFFFFF', classesRequired: 2 }] });
      expect(edited.status).toBe(200);
      expect((await superuser.rankStripeTier.findUniqueOrThrow({ where: { id: tier.id } })).promotionFeeMinor).toBe(2500);
    } finally {
      await superuser.school.update({ where: { id: school.id }, data: { promotionFeeEnabled: false } });
    }
  });

  it('deletes an archived style nobody uses', async () => {
    const style = await as('staff').post(`/v1/schools/${school.id}/disciplines`).send({ name: 'Old Karate' });
    expect((await as('staff').post(`/v1/disciplines/${style.body.id}/archive`)).status).toBe(201);
    expect((await as('staff').delete(`/v1/disciplines/${style.body.id}`)).status).toBe(204);
    expect(await superuser.discipline.findUnique({ where: { id: style.body.id } })).toBeNull();
  });

  it('gives nothing at another School, and is cleared with the Branch Staff role or turned off', async () => {
    // Not their School: it isn't even found.
    expect((await as('otherStaff').post(`/v1/schools/${school.id}/disciplines`).send({ name: 'Nope' })).status).toBe(404);
    // A coach has no switch to have.
    expect((await as('coach').post(`/v1/schools/${school.id}/disciplines`).send({ name: 'Nope' })).status).toBe(403);

    expect((await allow(false)).body.canManageDisciplines).toBe(false);
    expect((await as('staff').post(`/v1/schools/${school.id}/disciplines`).send({ name: 'Nope' })).status).toBe(403);
    await allow(true);
    const revoked = await as('owner').delete(`/v1/users/${users.staff.id}/role-grants/${staffGrantId}`);
    expect(revoked.status).toBe(200);
    const row = await superuser.staffPermission.findUniqueOrThrow({ where: { schoolId_userId: { schoolId: school.id, userId: users.staff.id } } });
    expect(row.canManageDisciplines).toBe(false);
  });
});
