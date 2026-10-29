/**
 * Decision 386 (Decision 304 items 1, 4, 5; front-desk handover F10):
 * unplanned open mat sessions. The owner, and staff the owner allows, start
 * a one-off "Open mat" class at their Branch; students with a live
 * membership whose home Branch it is and who train the style are told in
 * the app only.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Open mat sessions (Decision 386)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  // The real notification-fanout worker writes the in-app rows.
  async function notificationsFor(classId: string, expected: number) {
    for (let i = 0; i < 50; i++) {
      const rows = await superuser.notification.findMany({ where: { targetId: classId } });
      if (rows.length >= expected) return rows;
      await new Promise((r) => setTimeout(r, 100));
    }
    return superuser.notification.findMany({ where: { targetId: classId } });
  }

  let school: { id: string };
  let branchA: { id: string };
  let branchB: { id: string };
  let bjj: { id: string };
  let judo: { id: string };
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const soon = () => new Date(Date.now() + 5 * 60_000).toISOString();
  const start = (who: string, body: Record<string, unknown>) =>
    http().post(`/v1/schools/${school.id}/open-mats`).set('Authorization', `Bearer ${tokens[who]}`).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Mat School', timezone: 'Europe/London' } });
    branchA = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Centro' } });
    branchB = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Norte' } });
    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: ['Fundamentals'] } });
    judo = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Judo' } });
    const bjjWhite = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order: 0, name: 'White', primaryColour: '#FFFFFF' } });
    const judoWhite = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: judo.id, schoolId: school.id, order: 0, name: 'White', primaryColour: '#FFFFFF' } });
    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });

    for (const label of ['owner', 'staffA', 'staffB', 'coach', 'told', 'otherBranch', 'otherStyle', 'noMembership']) {
      users[label] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `openmat-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Mat',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
    }
    const grants: Array<[string, Role, string | null]> = [
      ['owner', 'SCHOOL_OWNER_MANAGER', null],
      ['staffA', 'BRANCH_STAFF', branchA.id],
      ['staffB', 'BRANCH_STAFF', branchB.id],
      ['coach', 'INSTRUCTOR', branchA.id],
      ['told', 'STUDENT', null],
      ['otherBranch', 'STUDENT', null],
      ['otherStyle', 'STUDENT', null],
      ['noMembership', 'STUDENT', null],
    ];
    for (const [who, role, branchId] of grants) {
      await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: users[who].id, schoolId: school.id, branchId } });
      tokens[who] = jwt.sign({ sub: users[who].id, email: users[who].email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId }] });
    }
    const students: Array<[string, string, string]> = [
      ['told', branchA.id, bjj.id],
      ['otherBranch', branchB.id, bjj.id],
      ['otherStyle', branchA.id, judo.id],
      ['noMembership', branchA.id, bjj.id],
    ];
    for (const [who, branchId, disciplineId] of students) {
      await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: users[who].id, branchId } });
      await superuser.studentRank.create({
        data: { id: randomUUID(), studentId: users[who].id, disciplineId, schoolId: school.id, currentRankId: disciplineId === bjj.id ? bjjWhite.id : judoWhite.id },
      });
      if (who !== 'noMembership') {
        await superuser.membership.create({
          data: { id: randomUUID(), studentId: users[who].id, membershipPlanId: plan.id, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING' },
        });
      }
    }
  });

  afterAll(async () => {
    await superuser.notification.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.rank.deleteMany({ where: { schoolId: school.id } });
    await superuser.discipline.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.branch.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('the owner starts one: a one-off "Open mat" class, and only matching students are told, in the app only', async () => {
    const startsAt = soon();
    const res = await start('owner', { branchId: branchA.id, disciplineId: bjj.id, startsAt });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Open mat', branchId: branchA.id, notified: 1 });
    expect(new Date(res.body.endDate).getTime() - new Date(res.body.startDate).getTime()).toBe(60 * 60_000);
    const cls = await superuser.class.findUniqueOrThrow({ where: { id: res.body.classId } });
    expect(cls.styles).toEqual([{ disciplineId: bjj.id, classType: 'Open mat' }]);
    expect(cls.membershipInclusion).toBe(true);
    expect(cls.timetableSlotId).toBeNull();

    const rows = await notificationsFor(res.body.classId, 1);
    await new Promise((r) => setTimeout(r, 300));
    expect((await superuser.notification.findMany({ where: { targetId: res.body.classId } })).map((n) => n.userId)).toEqual([users.told.id]);
    expect(rows[0]).toMatchObject({ title: 'Open mat', type: 'OPEN_MAT', targetType: 'CLASS', schoolId: school.id });
    expect(rows[0].body).toMatch(/^Open mat \(BJJ\) at Centro on .+, for 60 minutes\. Book in the app to join\.$/);
  });

  it('staff need the owner\'s switch, and then only at their own Branch', async () => {
    expect((await start('staffA', { branchId: branchA.id, disciplineId: bjj.id, startsAt: soon() })).status).toBe(403);
    expect((await http().get(`/v1/schools/${school.id}/open-mats/me`).set('Authorization', `Bearer ${tokens.staffA}`)).body).toEqual({ canStart: false, branchIds: [] });

    const set = await http().put(`/v1/schools/${school.id}/open-mats/permissions/${users.staffA.id}`).set('Authorization', `Bearer ${tokens.owner}`).send({ canStartOpenMat: true });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ userId: users.staffA.id, roles: ['BRANCH_STAFF'], canStartOpenMat: true });
    expect((await http().get(`/v1/schools/${school.id}/open-mats/me`).set('Authorization', `Bearer ${tokens.staffA}`)).body).toEqual({ canStart: true, branchIds: [branchA.id] });

    expect((await start('staffA', { branchId: branchB.id, disciplineId: bjj.id, startsAt: soon() })).status).toBe(403);
    const ok = await start('staffA', { branchId: branchA.id, disciplineId: judo.id, startsAt: soon(), minutes: 90 });
    expect(ok.status).toBe(201);
    expect(new Date(ok.body.endDate).getTime() - new Date(ok.body.startDate).getTime()).toBe(90 * 60_000);
    // A coach can be given it too.
    await http().put(`/v1/schools/${school.id}/open-mats/permissions/${users.coach.id}`).set('Authorization', `Bearer ${tokens.owner}`).send({ canStartOpenMat: true });
    expect((await start('coach', { branchId: branchA.id, disciplineId: bjj.id, startsAt: soon() })).status).toBe(201);
    // Only the owner gives it, and only to staff.
    expect((await http().put(`/v1/schools/${school.id}/open-mats/permissions/${users.staffB.id}`).set('Authorization', `Bearer ${tokens.staffA}`).send({ canStartOpenMat: true })).status).toBe(403);
    expect((await http().put(`/v1/schools/${school.id}/open-mats/permissions/${users.told.id}`).set('Authorization', `Bearer ${tokens.owner}`).send({ canStartOpenMat: true })).status).toBe(400);
    const list = await http().get(`/v1/schools/${school.id}/open-mats/permissions`).set('Authorization', `Bearer ${tokens.owner}`);
    expect(list.body.items.map((i: { firstName: string; canStartOpenMat: boolean }) => [i.firstName, i.canStartOpenMat])).toEqual([
      ['coach', true],
      ['staffA', true],
      ['staffB', false],
    ]);
  });

  it('needs a Branch and a style, and a start from 30 minutes ago to 24 hours ahead', async () => {
    expect((await start('owner', { disciplineId: bjj.id, startsAt: soon() })).status).toBe(400);
    expect((await start('owner', { branchId: branchA.id, startsAt: soon() })).status).toBe(400);
    expect((await start('owner', { branchId: branchA.id, disciplineId: bjj.id, startsAt: new Date(Date.now() - 2 * 3600_000).toISOString() })).status).toBe(400);
    expect((await start('owner', { branchId: branchA.id, disciplineId: bjj.id, startsAt: new Date(Date.now() + 25 * 3600_000).toISOString() })).status).toBe(400);
    expect((await start('owner', { branchId: branchA.id, disciplineId: bjj.id, startsAt: soon(), minutes: 5 })).status).toBe(400);
    // Students can't start one.
    expect((await start('told', { branchId: branchA.id, disciplineId: bjj.id, startsAt: soon() })).status).toBe(403);
  });
});
