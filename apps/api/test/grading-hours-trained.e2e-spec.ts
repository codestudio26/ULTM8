/**
 * Hours trained (Decisions 301 items 1, 5, 6 and 306; handover B11): logged,
 * not graded. Check-ins add the class's scheduled length; "Log a class" adds
 * the picked class's length or the coach's minutes (60 by default); open mat
 * follows the School's "Open mat counts toward hours" switch; the student's
 * grading data returns the hours and a progress breakdown; and nothing about
 * grading (%, readiness, board) changes. Real HTTP, real check-in endpoint,
 * real tenant context.
 *
 * Requires the same environment as attendance.e2e-spec.ts.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaAppService } from '../src/common/prisma/prisma-app.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET && process.env.QR_CLASS_TOKEN_SECRET && process.env.QR_STUDENT_TOKEN_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[grading-hours-trained.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const MIN = 60_000;
const RANK_DATE = new Date('2026-09-01T00:00:00Z');

describeIfDb('Hours trained — logged, not graded (Decisions 301, 306)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const http = () => request(app.getHttpServer());

  let school: { id: string };
  let otherSchool: { id: string };
  let membershipId: string;
  let bjj: { id: string };
  let judo: { id: string };
  let otherStyle: { id: string };
  let otherClass: { id: string };
  const user: Record<string, { id: string }> = {};
  const token: Record<string, string> = {};
  const userIds: string[] = [];

  const sign = (id: string, role: string, schoolId: string) =>
    jwt.sign({ sub: id, email: `${id}@example.test`, grants: [{ role, franchiseId: null, schoolId, branchId: null }] });

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `hours-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Hours',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    user[label] = u;
    return u;
  }

  /** A class of `minutes` length, starting at `start`, with these styles. */
  async function mkClass(start: Date, minutes: number, styles: Array<{ disciplineId: string; classType: string | null }>) {
    return superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        title: 'Hours Class',
        activities: ['BJJ'],
        styles,
        startDate: start,
        endDate: new Date(start.getTime() + minutes * MIN),
        qrAttendanceEndAt: new Date(Date.now() + 86_400_000),
      },
    });
  }

  /** Books the student in and checks them in through the Instructor roll call. */
  async function checkIn(start: Date, minutes: number, styles: Array<{ disciplineId: string; classType: string | null }>) {
    const cls = await mkClass(start, minutes, styles);
    await superuser.booking.create({
      data: { id: randomUUID(), studentId: user.ana.id, classId: cls.id, schoolId: school.id, sourceMembershipId: membershipId, status: 'UPCOMING' },
    });
    const res = await http().post(`/v1/classes/${cls.id}/attendance-scan`).set('Authorization', `Bearer ${token.coach}`).send({ studentId: user.ana.id });
    expect(res.status).toBe(201);
    return cls;
  }

  const logClass = (who: string, body: object, disciplineId = bjj.id) =>
    http().post(`/v1/students/${user.ana.id}/ranks/${disciplineId}/log-class`).set('Authorization', `Bearer ${token[who]}`).send(body);

  const eligibility = async (who = 'owner') => {
    const res = await http().get(`/v1/students/${user.ana.id}/eligibility?schoolId=${school.id}`).set('Authorization', `Bearer ${token[who]}`);
    expect(res.status).toBe(200);
    return res.body.items as Array<Record<string, any>>;
  };
  const styleRow = async (disciplineId: string, who = 'owner') => (await eligibility(who)).find((i) => i.disciplineId === disciplineId)!;
  const hours = async (disciplineId = bjj.id) => (await styleRow(disciplineId)).hoursTrained;

  const setting = (who: string, schoolId = school.id) => http().get(`/v1/schools/${schoolId}/grading-settings/open-mat-hours`).set('Authorization', `Bearer ${token[who]}`);
  const setSetting = (who: string, on: boolean, schoolId = school.id) =>
    http().put(`/v1/schools/${schoolId}/grading-settings/open-mat-hours`).set('Authorization', `Bearer ${token[who]}`).send({ openMatCountsTowardHours: on });

  /** Clean slate: no hours, no bookings, nothing counted, rank date fixed. */
  async function reset() {
    await superuser.trainingLog.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.promotionEvent.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.updateMany({
      where: { studentId: user.ana.id, schoolId: school.id },
      data: { classesAttendedTowardCheckpoint: 0, classesAttendedByType: {}, countingSince: RANK_DATE, dateOfCurrentRank: RANK_DATE },
    });
    await superuser.school.update({ where: { id: school.id }, data: { openMatCountsTowardHours: false } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Hours Trained School', timezone: 'UTC', ranksToggle: true } });
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Hours Trained Other School', timezone: 'UTC', ranksToggle: true } });

    await mkUser('ana');
    await mkUser('owner');
    await mkUser('coach'); // INSTRUCTOR with grading permission (log a class), no "Change board %"
    await mkUser('settingsCoach'); // INSTRUCTOR with "Change board %" on Judo only
    await mkUser('peer'); // another STUDENT at the School
    await mkUser('otherOwner'); // owner of another School
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'STUDENT', userId: user.ana.id, schoolId: school.id },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: user.owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: user.coach.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: user.settingsCoach.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: user.peer.id, schoolId: school.id },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: user.otherOwner.id, schoolId: otherSchool.id },
      ],
    });
    token.ana = sign(user.ana.id, 'STUDENT', school.id);
    token.owner = sign(user.owner.id, 'SCHOOL_OWNER_MANAGER', school.id);
    token.coach = sign(user.coach.id, 'INSTRUCTOR', school.id);
    token.settingsCoach = sign(user.settingsCoach.id, 'INSTRUCTOR', school.id);
    token.peer = sign(user.peer.id, 'STUDENT', school.id);
    token.otherOwner = sign(user.otherOwner.id, 'SCHOOL_OWNER_MANAGER', otherSchool.id);

    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
    membershipId = (
      await superuser.membership.create({
        data: { id: randomUUID(), studentId: user.ana.id, membershipPlanId: plan.id, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null },
      })
    ).id;

    // BJJ: a normal rung needing 40 classes, 100 days and 2 skills.
    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: ['Fundamentals', 'Open mat'] } });
    const white = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order: 0, name: 'White', primaryColour: '#FFFFFF' } });
    const w0 = await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: white.id, schoolId: school.id, order: 0, count: 0, colour: '#000', name: 'White 0' } });
    const w1 = await superuser.rankStripeTier.create({
      data: { id: randomUUID(), rankId: white.id, schoolId: school.id, order: 1, count: 1, colour: '#000', name: 'White 1', classesRequired: 40, minimumDaysInRank: 100 },
    });
    const skills = await Promise.all(
      ['Shrimp', 'Bridge'].map((name, i) => superuser.skill.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, name, order: i } })),
    );
    await superuser.rankStripeTierRequiredSkill.createMany({ data: skills.map((s) => ({ stripeTierId: w1.id, skillId: s.id })) });

    // Judo: the student is on a time-only rung (days only).
    judo = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Judo', classTypesOffered: [] } });
    const black = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: judo.id, schoolId: school.id, order: 0, name: 'Black', primaryColour: '#000000' } });
    const b0 = await superuser.rankStripeTier.create({
      data: { id: randomUUID(), rankId: black.id, schoolId: school.id, order: 0, count: 0, colour: '#000', name: 'Black 0', timeOnly: true, minimumDaysInRank: 1000 },
    });
    await superuser.rankStripeTier.create({
      data: { id: randomUUID(), rankId: black.id, schoolId: school.id, order: 1, count: 1, colour: '#000', name: 'Black 1', timeOnly: true, minimumDaysInRank: 1000 },
    });

    await superuser.studentRank.createMany({
      data: [
        { id: randomUUID(), studentId: user.ana.id, disciplineId: bjj.id, schoolId: school.id, currentRankId: white.id, currentStripeId: w0.id, dateOfCurrentRank: RANK_DATE },
        { id: randomUUID(), studentId: user.ana.id, disciplineId: judo.id, schoolId: school.id, currentRankId: black.id, currentStripeId: b0.id, dateOfCurrentRank: RANK_DATE },
      ],
    });
    await superuser.gradingPermission.createMany({
      data: [
        { id: randomUUID(), schoolId: school.id, userId: user.coach.id, disciplineId: bjj.id, canChangeBoardThresholds: false },
        { id: randomUUID(), schoolId: school.id, userId: user.coach.id, disciplineId: judo.id, canChangeBoardThresholds: false },
        { id: randomUUID(), schoolId: school.id, userId: user.settingsCoach.id, disciplineId: judo.id, canPromote: false, canChangeBoardThresholds: true },
      ],
    });

    // Another School's own style and class, to try to log across Schools.
    otherStyle = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: otherSchool.id, name: 'BJJ' } });
    otherClass = await superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: otherSchool.id,
        title: 'Other',
        activities: [],
        styles: [{ disciplineId: otherStyle.id, classType: null }],
        startDate: new Date('2026-10-01T10:00:00Z'),
        endDate: new Date('2026-10-01T12:00:00Z'),
      },
    });
  });

  afterAll(async () => {
    await superuser.trainingLog.deleteMany({ where: { schoolId: { in: [school.id, otherSchool.id] } } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.promotionEvent.deleteMany({ where: { schoolId: school.id } });
    await superuser.skillSignOffLog.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRankSkillStatus.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.gradingPermission.deleteMany({ where: { schoolId: school.id } });
    await superuser.rankStripeTierRequiredSkill.deleteMany({ where: { skill: { schoolId: school.id } } });
    await superuser.skill.deleteMany({ where: { schoolId: school.id } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: school.id } });
    await superuser.rank.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: { in: [school.id, otherSchool.id] } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: [school.id, otherSchool.id] } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: [school.id, otherSchool.id] } } });
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: [school.id, otherSchool.id] } } });
    await superuser.$disconnect();
    await app.close();
  });

  beforeEach(reset);

  describe('check-in', () => {
    it('adds the class\'s scheduled length (90 minutes) to the style, as minutes', async () => {
      expect(await hours()).toEqual({ totalMinutes: 0, sinceCurrentRankMinutes: 0 });
      await checkIn(new Date('2026-10-01T18:00:00Z'), 90, [{ disciplineId: bjj.id, classType: 'Fundamentals' }]);
      expect(await hours()).toEqual({ totalMinutes: 90, sinceCurrentRankMinutes: 90 });
      const rows = await superuser.trainingLog.findMany({ where: { studentId: user.ana.id, schoolId: school.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ disciplineId: bjj.id, minutes: 90, source: 'CHECK_IN', openMat: false, countsTowardHours: true });
    });

    it('a class for two styles adds its length to each; a time-only rung still logs hours', async () => {
      await checkIn(new Date('2026-10-01T18:00:00Z'), 60, [
        { disciplineId: bjj.id, classType: 'Fundamentals' },
        { disciplineId: judo.id, classType: null },
      ]);
      expect(await hours(bjj.id)).toEqual({ totalMinutes: 60, sinceCurrentRankMinutes: 60 });
      expect(await hours(judo.id)).toEqual({ totalMinutes: 60, sinceCurrentRankMinutes: 60 });
    });

    it('"since the current rank" counts only training on or after the rank date', async () => {
      await checkIn(new Date('2026-08-20T18:00:00Z'), 60, [{ disciplineId: bjj.id, classType: 'Fundamentals' }]); // before RANK_DATE
      await checkIn(new Date('2026-09-02T18:00:00Z'), 45, [{ disciplineId: bjj.id, classType: 'Fundamentals' }]);
      expect(await hours()).toEqual({ totalMinutes: 105, sinceCurrentRankMinutes: 45 });
    });
  });

  describe('"Log a class"', () => {
    it('with a picked class adds that class\'s length', async () => {
      const cls = await mkClass(new Date('2026-10-02T18:00:00Z'), 75, [{ disciplineId: bjj.id, classType: 'Fundamentals' }]);
      const res = await logClass('coach', { classType: 'Fundamentals', classId: cls.id });
      expect(res.status).toBe(201);
      expect(res.body.minutesLogged).toBe(75);
      expect(await hours()).toEqual({ totalMinutes: 75, sinceCurrentRankMinutes: 75 });
      const row = await superuser.trainingLog.findFirstOrThrow({ where: { studentId: user.ana.id, schoolId: school.id } });
      expect(row).toMatchObject({ source: 'LOGGED', classId: cls.id, promotionEventId: res.body.promotionEvent.id, minutes: 75 });
    });

    it('without a class adds 60 minutes by default, or the minutes the coach enters', async () => {
      expect((await logClass('coach', { classType: 'Fundamentals' })).body.minutesLogged).toBe(60);
      expect(await hours()).toEqual({ totalMinutes: 60, sinceCurrentRankMinutes: 60 });
      expect((await logClass('coach', { classType: 'Fundamentals', minutes: 25 })).body.minutesLogged).toBe(25);
      expect(await hours()).toEqual({ totalMinutes: 85, sinceCurrentRankMinutes: 85 });
    });

    it('still counts exactly one class, as before', async () => {
      const res = await logClass('coach', { classType: 'Fundamentals', minutes: 120 });
      expect(res.body.studentRank.classesAttendedTowardCheckpoint).toBe(1);
    });

    it('refuses bad input: both a class and minutes, minutes out of range, a class of another style or School', async () => {
      const cls = await mkClass(new Date('2026-10-02T18:00:00Z'), 60, [{ disciplineId: bjj.id, classType: 'Fundamentals' }]);
      const judoClass = await mkClass(new Date('2026-10-02T18:00:00Z'), 60, [{ disciplineId: judo.id, classType: null }]);
      expect((await logClass('coach', { classType: 'Fundamentals', classId: cls.id, minutes: 30 })).status).toBe(400);
      expect((await logClass('coach', { classType: 'Fundamentals', minutes: 0 })).status).toBe(400);
      expect((await logClass('coach', { classType: 'Fundamentals', minutes: 601 })).status).toBe(400);
      expect((await logClass('coach', { classType: 'Fundamentals', minutes: 1.5 })).status).toBe(400);
      expect((await logClass('coach', { classType: 'Fundamentals', classId: 'not-a-uuid' })).status).toBe(400);
      expect((await logClass('coach', { classType: 'Fundamentals', classId: judoClass.id })).status).toBe(400);
      expect((await logClass('coach', { classType: 'Fundamentals', classId: otherClass.id })).status).toBe(404);
      // Nothing was logged or counted by any refused request.
      expect(await hours()).toEqual({ totalMinutes: 0, sinceCurrentRankMinutes: 0 });
      const sr = await superuser.studentRank.findFirstOrThrow({ where: { studentId: user.ana.id, disciplineId: bjj.id } });
      expect(sr.classesAttendedTowardCheckpoint).toBe(0);
    });
  });

  describe('open mat ("Open mat counts toward hours")', () => {
    it('is off by default: open mat minutes are recorded but not in the hours', async () => {
      expect((await setting('owner')).body).toEqual({ openMatCountsTowardHours: false });
      await checkIn(new Date('2026-10-01T18:00:00Z'), 60, [{ disciplineId: bjj.id, classType: 'Open mat' }]);
      await checkIn(new Date('2026-10-02T18:00:00Z'), 30, [{ disciplineId: bjj.id, classType: 'Fundamentals' }]);
      expect((await logClass('coach', { classType: 'Open mat', minutes: 40 })).body.minutesLogged).toBe(0);
      expect(await hours()).toEqual({ totalMinutes: 30, sinceCurrentRankMinutes: 30 });
      const openMatRows = await superuser.trainingLog.findMany({ where: { studentId: user.ana.id, openMat: true } });
      expect(openMatRows.map((r) => r.countsTowardHours)).toEqual([false, false]);
    });

    it('when on, open mat minutes are added (matched on the class type, ignoring case)', async () => {
      expect((await setSetting('owner', true)).body).toEqual({ openMatCountsTowardHours: true });
      await checkIn(new Date('2026-10-01T18:00:00Z'), 60, [{ disciplineId: bjj.id, classType: 'OPEN MAT' }]);
      const cls = await mkClass(new Date('2026-10-02T18:00:00Z'), 50, [{ disciplineId: bjj.id, classType: 'Open mat' }]);
      expect((await logClass('coach', { classType: 'Fundamentals', classId: cls.id })).body.minutesLogged).toBe(50);
      expect(await hours()).toEqual({ totalMinutes: 110, sinceCurrentRankMinutes: 110 });
    });

    it('the switch applies from now on: minutes already recorded keep their state', async () => {
      await checkIn(new Date('2026-10-01T18:00:00Z'), 60, [{ disciplineId: bjj.id, classType: 'Open mat' }]);
      await setSetting('owner', true);
      expect(await hours()).toEqual({ totalMinutes: 0, sinceCurrentRankMinutes: 0 });
    });
  });

  describe('who may read and change the switch', () => {
    it('the owner and a coach with "Change board %" for any style may change it', async () => {
      expect((await setSetting('owner', true)).status).toBe(200);
      const res = await setSetting('settingsCoach', false);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ openMatCountsTowardHours: false });
      expect((await setting('settingsCoach')).body).toEqual({ openMatCountsTowardHours: false });
    });

    it('a coach without it, a student and another School\'s owner get 403', async () => {
      expect((await setSetting('coach', true)).status).toBe(403);
      expect((await setSetting('ana', true)).status).toBe(403);
      expect((await setSetting('otherOwner', true)).status).toBe(403);
      expect((await setting('ana')).status).toBe(403);
      expect((await setting('otherOwner')).status).toBe(403);
      const s = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
      expect(s.openMatCountsTowardHours).toBe(false);
    });

    it('a coach\'s right at one School does not reach another School\'s switch', async () => {
      expect((await setSetting('settingsCoach', true, otherSchool.id)).status).toBe(403);
      const other = await superuser.school.findUniqueOrThrow({ where: { id: otherSchool.id } });
      expect(other.openMatCountsTowardHours).toBe(false);
    });

    it('rejects a missing or non-boolean value', async () => {
      const bad = await http().put(`/v1/schools/${school.id}/grading-settings/open-mat-hours`).set('Authorization', `Bearer ${token.owner}`).send({ openMatCountsTowardHours: 'yes' });
      expect(bad.status).toBe(400);
    });
  });

  describe('the student\'s grading data', () => {
    it('returns the breakdown from the same engine values: classes, days and skills on their own', async () => {
      await superuser.studentRank.updateMany({ where: { studentId: user.ana.id, disciplineId: bjj.id }, data: { classesAttendedTowardCheckpoint: 10 } });
      const row = await styleRow(bjj.id);
      expect(row.progressBreakdown.classes).toEqual({ counted: 10, required: 40, percent: 25, byType: [] });
      expect(row.progressBreakdown.classes.percent).toBe(row.eligibility.progressPercent);
      expect(row.progressBreakdown.days.elapsed).toBe(row.eligibility.elapsedDays);
      expect(row.progressBreakdown.days.required).toBe(100);
      expect(row.progressBreakdown.skills).toEqual({ signedOff: 0, required: 2, percent: 0 });
    });

    it('a time-only rung has days only', async () => {
      const row = await styleRow(judo.id);
      expect(row.progressBreakdown.classes).toBeNull();
      expect(row.progressBreakdown.skills).toBeNull();
      expect(row.progressBreakdown.days.required).toBe(1000);
    });

    it('the student app\'s view (GET /students/{id}/grading) carries the hours and the breakdown too', async () => {
      await checkIn(new Date('2026-10-01T18:00:00Z'), 90, [{ disciplineId: bjj.id, classType: 'Fundamentals' }]);
      const res = await http().get(`/v1/students/${user.ana.id}/grading`).set('Authorization', `Bearer ${token.ana}`);
      expect(res.status).toBe(200);
      const item = res.body.items.find((i: { disciplineId: string }) => i.disciplineId === bjj.id);
      expect(item.hoursTrained).toEqual({ totalMinutes: 90, sinceCurrentRankMinutes: 90 });
      expect(item.progressBreakdown.classes.percent).toBe(item.eligibility.progressPercent);
    });

    it('hours never change the %, readiness or the board', async () => {
      await superuser.studentRank.updateMany({ where: { studentId: user.ana.id, disciplineId: bjj.id }, data: { classesAttendedTowardCheckpoint: 30 } });
      const board = async () => {
        const res = await http().get(`/v1/schools/${school.id}/grading-board?disciplineId=${bjj.id}`).set('Authorization', `Bearer ${token.owner}`);
        expect(res.status).toBe(200);
        return res.body;
      };
      const before = { bjj: (await styleRow(bjj.id)).eligibility, judo: (await styleRow(judo.id)).eligibility, board: await board() };
      expect(before.bjj).toMatchObject({ progressPercent: 75, boardColumn: 'READY_TO_GRADE', classesOk: false });

      // A huge amount of hours in both styles, through the real paths and directly.
      await checkIn(new Date('2026-10-01T18:00:00Z'), 600, [{ disciplineId: judo.id, classType: null }]);
      await superuser.trainingLog.createMany({
        data: [bjj.id, judo.id].map((disciplineId) => ({
          id: randomUUID(),
          schoolId: school.id,
          studentId: user.ana.id,
          disciplineId,
          minutes: 100_000,
          source: 'LOGGED' as const,
          trainedAt: new Date(),
        })),
      });

      const after = { bjj: (await styleRow(bjj.id)).eligibility, judo: (await styleRow(judo.id)).eligibility, board: await board() };
      expect(after).toEqual(before);
      expect((await hours(bjj.id)).totalMinutes).toBe(100_000);
      expect((await hours(judo.id)).totalMinutes).toBe(100_600);
    });
  });

  describe('tenant isolation', () => {
    it('another School\'s owner can\'t read the student\'s hours', async () => {
      await checkIn(new Date('2026-10-01T18:00:00Z'), 90, [{ disciplineId: bjj.id, classType: 'Fundamentals' }]);
      const asOther = await http().get(`/v1/students/${user.ana.id}/eligibility?schoolId=${school.id}`).set('Authorization', `Bearer ${token.otherOwner}`);
      expect(asOther.status).toBe(403);
      // Asking through their own School finds nothing of School A's (the
      // existing read lets an owner ask about any id at their own School).
      const ownSchool = await http().get(`/v1/students/${user.ana.id}/eligibility?schoolId=${otherSchool.id}`).set('Authorization', `Bearer ${token.otherOwner}`);
      expect(ownSchool.status).toBe(200);
      expect(ownSchool.body.items).toEqual([]);
      // Nor does the setting read or write reach across (see "who may read and change the switch").
    });

    it('at the database: another School\'s owner and a peer student see no rows; the owner and the student do', async () => {
      await checkIn(new Date('2026-10-01T18:00:00Z'), 90, [{ disciplineId: bjj.id, classType: 'Fundamentals' }]);
      const prismaApp = app.get(PrismaAppService);
      const visibleTo = (userId: string) => prismaApp.withTenantContext(userId, (tx) => tx.trainingLog.count({ where: { studentId: user.ana.id } }));
      expect(await visibleTo(user.otherOwner.id)).toBe(0);
      expect(await visibleTo(user.peer.id)).toBe(0);
      expect(await visibleTo(user.coach.id)).toBe(0); // coaches read through the student's context, like every grading record
      expect(await visibleTo(user.owner.id)).toBe(1);
      expect(await visibleTo(user.ana.id)).toBe(1);
    });

    it('at the database: nobody can write hours for someone else, or into a School the student isn\'t at, or change them', async () => {
      const prismaApp = app.get(PrismaAppService);
      const row = (studentId: string, schoolId: string, disciplineId: string) => ({
        id: randomUUID(),
        schoolId,
        studentId,
        disciplineId,
        minutes: 60,
        source: 'LOGGED' as const,
        trainedAt: new Date(),
      });
      await expect(prismaApp.withTenantContext(user.owner.id, (tx) => tx.trainingLog.create({ data: row(user.ana.id, school.id, bjj.id) }))).rejects.toThrow();
      await expect(prismaApp.withTenantContext(user.ana.id, (tx) => tx.trainingLog.create({ data: row(user.ana.id, otherSchool.id, otherStyle.id) }))).rejects.toThrow();
      await expect(prismaApp.withTenantContext(user.peer.id, (tx) => tx.trainingLog.create({ data: row(user.ana.id, school.id, bjj.id) }))).rejects.toThrow();

      await checkIn(new Date('2026-10-01T18:00:00Z'), 90, [{ disciplineId: bjj.id, classType: 'Fundamentals' }]);
      await expect(prismaApp.withTenantContext(user.ana.id, (tx) => tx.trainingLog.updateMany({ where: { studentId: user.ana.id }, data: { minutes: 9999 } }))).rejects.toThrow();
      await expect(prismaApp.withTenantContext(user.owner.id, (tx) => tx.trainingLog.deleteMany({ where: { studentId: user.ana.id } }))).rejects.toThrow();
      expect(await hours()).toEqual({ totalMinutes: 90, sinceCurrentRankMinutes: 90 });
    });
  });
});
