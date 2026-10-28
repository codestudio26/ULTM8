/**
 * Decision 374 — the Dashboard's Active students count, setup checklist and
 * this week's birthdays (GET /schools/:schoolId/dashboard, PATCH
 * …/dashboard/setup-checklist, GET /schools/:schoolId/birthdays). Real HTTP
 * against a real Postgres, including the school_student_birthdays helper's
 * branch scoping for Branch Staff.
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
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Dashboard: Active students, setup checklist, birthdays (Decision 374)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let branchNorth: { id: string };
  let branchSouth: { id: string };
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const userIds: string[] = [];

  // Today in UTC (the School has no time zone) is always in this Mon–Sun week;
  // ten days on never is.
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const inTenDays = new Date(now.getTime() + 10 * 86_400_000);
  const dob = (d: Date) => new Date(Date.UTC(2012, d.getUTCMonth(), d.getUTCDate()));

  const sign = (user: { id: string; email: string }, grants: Array<Record<string, unknown>>) => jwt.sign({ sub: user.id, email: user.email, grants });
  const get = (path: string, token: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Dashboard Overview School' } });
    const mkUser = async (label: string, dateOfBirth: Date | null) => {
      const u = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `dashboard-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Tester',
          passcodeHash: 'x',
          dateOfBirth,
          phoneVerifiedAt: new Date(),
        },
      });
      userIds.push(u.id);
      users[label] = u;
      return u;
    };
    await mkUser('owner', new Date('1980-05-05'));
    await mkUser('northStaff', new Date('1990-01-01'));
    await mkUser('northKid', dob(now)); // birthday today, North branch
    await mkUser('southKid', dob(now)); // birthday today, South branch
    await mkUser('later', dob(inTenDays)); // birthday not this week
    await mkUser('revoked', dob(now)); // left the School
    await mkUser('trialOnly', null);
    await mkUser('guestOnly', null);

    branchNorth = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'North' } });
    branchSouth = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'South' } });

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: users.owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: users.northStaff.id, schoolId: school.id, branchId: branchNorth.id },
        { id: randomUUID(), role: 'STUDENT', userId: users.northKid.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: users.southKid.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: users.later.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: users.revoked.id, schoolId: school.id, revokedAt: new Date() },
        { id: randomUUID(), role: 'STUDENT', userId: users.trialOnly.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: users.guestOnly.id, schoolId: school.id },
      ],
    });
    await superuser.studentHomeBranch.createMany({
      data: [
        { id: randomUUID(), schoolId: school.id, studentId: users.northKid.id, branchId: branchNorth.id },
        { id: randomUUID(), schoolId: school.id, studentId: users.southKid.id, branchId: branchSouth.id },
      ],
    });

    tokens.owner = sign(users.owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokens.northStaff = sign(users.northStaff, [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: branchNorth.id }]);
    tokens.student = sign(users.northKid, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);

    // Memberships: northKid a Subscription (active), southKid a used-up Class
    // Pack (not active), later an expired Weekly Pass (not active), trialOnly a
    // Trial (active), guestOnly only a Friend Pass (not counted), revoked a
    // Subscription but no longer enrolled (not counted).
    const plan = (type: 'SUBSCRIPTION' | 'CLASS_PACK' | 'WEEKLY_PASS' | 'FRIEND_PASS' | 'TRIAL_MEMBERSHIP') =>
      superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type, title: type, price: 1000 } });
    const sub = await plan('SUBSCRIPTION');
    const pack = await plan('CLASS_PACK');
    const weekly = await plan('WEEKLY_PASS');
    const friend = await plan('FRIEND_PASS');
    const trial = await plan('TRIAL_MEMBERSHIP');
    const mk = (studentId: string, planId: string, extra: Record<string, unknown> = {}) =>
      superuser.membership.create({
        data: { id: randomUUID(), studentId, membershipPlanId: planId, schoolId: school.id, status: 'ACTIVE', frequency: 'ONE_TIME', ...extra },
      });
    await mk(users.northKid.id, sub.id, { frequency: 'RECURRING' });
    await mk(users.southKid.id, pack.id, { classesRemaining: 0 });
    await mk(users.later.id, weekly.id, { expiryDate: new Date(now.getTime() - 86_400_000) });
    await mk(users.trialOnly.id, trial.id, { expiryDate: new Date(now.getTime() + 5 * 86_400_000) });
    await mk(users.guestOnly.id, friend.id, { classesRemaining: 1 });
    await mk(users.revoked.id, sub.id, { frequency: 'RECURRING' });
  });

  afterAll(async () => {
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.waiver.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.branch.deleteMany({ where: { schoolId: school.id } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    await superuser.$disconnect();
  });

  it('counts Active students: a live Subscription, Class Pack with credits, Weekly Pass or Trial, enrolled students only, no Friend Pass', async () => {
    const res = await get(`/v1/schools/${school.id}/dashboard`, tokens.owner);
    expect(res.status).toBe(200);
    // northKid (Subscription) + trialOnly (Trial).
    expect(res.body.activeStudents).toBe(2);
  });

  it('the setup checklist ticks what the School has, and the owner can hide and show it', async () => {
    let res = await get(`/v1/schools/${school.id}/dashboard`, tokens.owner);
    const done = (body: { setupChecklist: { steps: Array<{ key: string; done: boolean }> } }) =>
      Object.fromEntries(body.setupChecklist.steps.map((s) => [s.key, s.done]));
    expect(res.body.setupChecklist.hidden).toBe(false);
    expect(res.body.setupChecklist.steps.map((s: { key: string }) => s.key)).toEqual([
      'BRANCH', 'STYLE_AND_BELTS', 'CLASS', 'MEMBERSHIP_PLAN', 'WAIVER', 'STRIPE', 'STAFF',
    ]);
    expect(done(res.body)).toEqual({
      BRANCH: true, STYLE_AND_BELTS: false, CLASS: false, MEMBERSHIP_PLAN: true, WAIVER: false, STRIPE: false, STAFF: true,
    });

    await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Liability', body: 'Text' } });
    res = await get(`/v1/schools/${school.id}/dashboard`, tokens.owner);
    expect(done(res.body).WAIVER).toBe(true);

    const hide = await request(app.getHttpServer())
      .patch(`/v1/schools/${school.id}/dashboard/setup-checklist`)
      .send({ hidden: true })
      .set('Authorization', `Bearer ${tokens.owner}`);
    expect(hide.status).toBe(200);
    expect(hide.body.setupChecklist.hidden).toBe(true);
    const show = await request(app.getHttpServer())
      .patch(`/v1/schools/${school.id}/dashboard/setup-checklist`)
      .send({ hidden: false })
      .set('Authorization', `Bearer ${tokens.owner}`);
    expect(show.body.setupChecklist.hidden).toBe(false);
  });

  it('the overview and hiding are School Owner only', async () => {
    expect((await get(`/v1/schools/${school.id}/dashboard`, tokens.northStaff)).status).toBe(403);
    expect((await get(`/v1/schools/${school.id}/dashboard`, tokens.student)).status).toBe(403);
    const hide = await request(app.getHttpServer())
      .patch(`/v1/schools/${school.id}/dashboard/setup-checklist`)
      .send({ hidden: true })
      .set('Authorization', `Bearer ${tokens.northStaff}`);
    expect(hide.status).toBe(403);
  });

  it('birthdays: the owner sees every enrolled student\'s birthday this week, with the date and no year', async () => {
    const res = await get(`/v1/schools/${school.id}/birthdays`, tokens.owner);
    expect(res.status).toBe(200);
    const names = res.body.items.map((i: { firstName: string }) => i.firstName).sort();
    // later (not this week), revoked (left) and the staff/owner (not students) are left out.
    expect(names).toEqual(['northKid', 'southKid']);
    for (const item of res.body.items) {
      expect(item.date).toBe(todayIso);
      expect(Object.keys(item).sort()).toEqual(['date', 'firstName', 'studentId', 'surname']);
    }
    expect(res.body.from <= todayIso && todayIso <= res.body.to).toBe(true);
    expect(res.body.today).toBe(todayIso);
  });

  it('birthdays: Branch Staff see only their own Branch\'s students; a student gets 403', async () => {
    const res = await get(`/v1/schools/${school.id}/birthdays`, tokens.northStaff);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { firstName: string }) => i.firstName)).toEqual(['northKid']);
    expect((await get(`/v1/schools/${school.id}/birthdays`, tokens.student)).status).toBe(403);
  });
});
