/**
 * Students → Attendance (Decision 317 items 3 and 4; backlog 5.6, 5.7):
 * - logging past attendance counts like a normal check-in: a Class Pack
 *   credit is used when booking is needed, the grading count and hours go up,
 *   it is recorded as STAFF_LOGGED with who logged it, and never twice;
 * - up to 30 days back, days in the School's time zone;
 * - statistics over the last 30 days: the owner sees the whole School, Branch
 *   Staff with "See attendance statistics" their own Branches; Trial, Visitor
 *   and Friend Pass check-ins count, with a filter to leave them out;
 * - no one sees or logs another School's or another Branch's attendance.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MembershipPlanType, PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET && process.env.QR_CLASS_TOKEN_SECRET && process.env.QR_STUDENT_TOKEN_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[staff-attendance.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const MIN = 60_000;
const DAY = 86_400_000;
const ZONE = 'America/Sao_Paulo';
const RANK_DATE = new Date('2026-01-01T00:00:00Z');
const ACCESS_DEFAULTS = {
  classes: false, bookings: true, students: true, cancelClasses: true, staffList: false, inviteCoaches: false,
  disciplines: false, checkInRules: false, exportStudents: false, freezeMemberships: false, attendanceStats: false, memberFiles: false,
};

describeIfDb('Students → Attendance: statistics and logging past attendance (Decision 317 items 3, 4)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const http = () => request(app.getHttpServer());

  let school: { id: string };
  let otherSchool: { id: string };
  let main: { id: string };
  let other: { id: string };
  let bjj: { id: string };
  const plans: Partial<Record<MembershipPlanType, string>> = {};
  let otherPlan: string;
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};

  const as = (who: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${tokens[who]}`),
    put: (url: string) => http().put(url).set('Authorization', `Bearer ${tokens[who]}`),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const base = () => `/v1/schools/${school.id}/attendance`;
  const log = (who: string, student: string, cls: { id: string }, schoolId = school.id) =>
    as(who).post(`/v1/schools/${schoolId}/attendance/logs`).send({ studentId: users[student].id, classId: cls.id });
  const setAccess = (who: string, access: Partial<typeof ACCESS_DEFAULTS>) =>
    as('owner').put(`/v1/schools/${school.id}/staff/${users[who].id}/access`).send({ ...ACCESS_DEFAULTS, ...access });

  async function mkUser(label: string) {
    users[label] = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `staff-attendance-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Attendance',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
  }

  /** A 60-minute BJJ class that started `agoMs` ago (negative: in the future). */
  async function classAgo(agoMs: number, branchId: string | null = null, schoolId = school.id) {
    const start = new Date(Date.now() - agoMs);
    return superuser.class.create({
      data: {
        id: randomUUID(), schoolId, branchId, title: 'Logged class', membershipInclusion: true,
        styles: schoolId === school.id ? [{ disciplineId: bjj.id, classType: null }] : [],
        startDate: start, endDate: new Date(start.getTime() + 60 * MIN),
      },
    });
  }

  async function membership(who: string, type: MembershipPlanType, classesRemaining: number | null = null, schoolId = school.id) {
    return superuser.membership.create({
      data: {
        id: randomUUID(), studentId: users[who].id, membershipPlanId: schoolId === school.id ? plans[type]! : otherPlan, schoolId,
        status: 'ACTIVE', frequency: type === 'SUBSCRIPTION' ? 'RECURRING' : 'ONE_TIME', classesRemaining,
      },
    });
  }

  async function booking(who: string, cls: { id: string; branchId: string | null }, membershipId: string, status: 'UPCOMING' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' = 'UPCOMING', extra: object = {}) {
    return superuser.booking.create({
      data: { id: randomUUID(), studentId: users[who].id, classId: cls.id, schoolId: school.id, branchId: cls.branchId, sourceMembershipId: membershipId, status, ...extra },
    });
  }

  const classesCounted = async (who: string) =>
    (await superuser.studentRank.findFirstOrThrow({ where: { studentId: users[who].id, disciplineId: bjj.id } })).classesAttendedTowardCheckpoint;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Staff Attendance School', timezone: ZONE, ranksToggle: true } });
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Staff Attendance Other School', timezone: 'UTC' } });
    main = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Main' } });
    other = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Other' } });

    const labels = ['owner', 'staff', 'staffOther', 'coach', 'ana', 'ben', 'cara', 'dan', 'eve', 'fay', 'gil', 'left', 'otherOwner', 'otherStaff', 'otherStudent'];
    for (const label of labels) await mkUser(label);
    const grants: Array<[string, 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT', string | null, string]> = [
      ['owner', 'SCHOOL_OWNER_MANAGER', null, school.id],
      ['staff', 'BRANCH_STAFF', main.id, school.id],
      ['staffOther', 'BRANCH_STAFF', other.id, school.id],
      ['coach', 'INSTRUCTOR', main.id, school.id],
      ['ana', 'STUDENT', null, school.id],
      ['ben', 'STUDENT', null, school.id],
      ['cara', 'STUDENT', null, school.id],
      ['dan', 'STUDENT', null, school.id],
      ['eve', 'STUDENT', null, school.id],
      ['fay', 'STUDENT', null, school.id],
      ['gil', 'STUDENT', null, school.id],
      ['otherOwner', 'SCHOOL_OWNER_MANAGER', null, otherSchool.id],
      ['otherStaff', 'BRANCH_STAFF', null, otherSchool.id],
      ['otherStudent', 'STUDENT', null, otherSchool.id],
    ];
    await superuser.roleGrant.createMany({
      data: grants.map(([who, role, branchId, schoolId]) => ({ id: randomUUID(), role, userId: users[who].id, schoolId, branchId, isMainOwner: role === 'SCHOOL_OWNER_MANAGER' })),
    });
    // A former student: enrolment revoked.
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: users.left.id, schoolId: school.id, revokedAt: new Date() } });
    for (const [who, role, branchId, schoolId] of grants) {
      tokens[who] = jwt.sign({ sub: users[who].id, email: users[who].email, grants: [{ role, franchiseId: null, schoolId, branchId }] });
    }
    tokens.left = jwt.sign({ sub: users.left.id, email: users.left.email, grants: [] });

    for (const type of ['SUBSCRIPTION', 'CLASS_PACK', 'TRIAL_MEMBERSHIP', 'FRIEND_PASS', 'VISIT_PASS'] as MembershipPlanType[]) {
      plans[type] = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type, title: type, price: 1000 } })).id;
    }
    otherPlan = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: otherSchool.id, type: 'SUBSCRIPTION', title: 'Other', price: 1000 } })).id;

    // BJJ: every class counts toward the next rung.
    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: [] } });
    const white = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order: 0, name: 'White', primaryColour: '#FFFFFF' } });
    const w0 = await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: white.id, schoolId: school.id, order: 0, count: 0, colour: '#000', name: 'White 0' } });
    await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: white.id, schoolId: school.id, order: 1, count: 1, colour: '#000', name: 'White 1', classesRequired: 40 } });
    await superuser.studentRank.createMany({
      data: ['ana', 'ben', 'dan'].map((who) => ({
        id: randomUUID(), studentId: users[who].id, disciplineId: bjj.id, schoolId: school.id, currentRankId: white.id, currentStripeId: w0.id, dateOfCurrentRank: RANK_DATE, countingSince: RANK_DATE,
      })),
    });
  });

  afterAll(async () => {
    const schoolIds = [school.id, otherSchool.id];
    await superuser.trainingLog.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.booking.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membership.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.class.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.promotionEvent.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentRank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffActivity.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('logging past attendance', () => {
    it('books with a Class Pack credit, checks in as STAFF_LOGGED by the staff member, and counts toward grading and hours', async () => {
      const pack = await membership('ana', 'CLASS_PACK', 5);
      const cls = await classAgo(3 * DAY, main.id);
      const res = await log('staff', 'ana', cls);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ classId: cls.id, studentId: users.ana.id, checkInMethod: 'STAFF_LOGGED', checkedInById: users.staff.id, from: 'BOOKED' });

      const saved = await superuser.booking.findUniqueOrThrow({ where: { id: res.body.bookingId } });
      expect(saved).toMatchObject({ status: 'COMPLETED', checkInMethod: 'STAFF_LOGGED', checkedInById: users.staff.id, sourceMembershipId: pack.id, branchId: main.id });
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: pack.id } })).classesRemaining).toBe(4);
      expect(await classesCounted('ana')).toBe(1);
      const hours = await superuser.trainingLog.findMany({ where: { studentId: users.ana.id, classId: cls.id } });
      expect(hours).toHaveLength(1);
      expect(hours[0]).toMatchObject({ minutes: 60, source: 'CHECK_IN', bookingId: res.body.bookingId });

      // Never twice: no second credit, count or hours.
      const again = await log('owner', 'ana', cls);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('ALREADY_ATTENDED');
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: pack.id } })).classesRemaining).toBe(4);
      expect(await classesCounted('ana')).toBe(1);
      expect(await superuser.trainingLog.count({ where: { studentId: users.ana.id, classId: cls.id } })).toBe(1);
      expect(await superuser.booking.count({ where: { studentId: users.ana.id, classId: cls.id } })).toBe(1);
    });

    it('refuses a student already checked in to that class on the day', async () => {
      const sub = await membership('ben', 'SUBSCRIPTION');
      const cls = await classAgo(2 * DAY, main.id);
      await booking('ben', cls, sub.id, 'COMPLETED', { checkInMethod: 'INSTRUCTOR_MANUAL', checkedInById: users.coach.id });
      const res = await log('owner', 'ben', cls);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_ATTENDED');
    });

    it('checks in a booking marked No-Show without paying for it again', async () => {
      const pack = await membership('dan', 'CLASS_PACK', 3);
      const cls = await classAgo(5 * DAY, main.id);
      const noShow = await booking('dan', cls, pack.id, 'NO_SHOW');
      const before = await classesCounted('dan');
      const res = await log('staff', 'dan', cls);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ bookingId: noShow.id, from: 'NO_SHOW' });
      expect(await superuser.booking.findUniqueOrThrow({ where: { id: noShow.id } })).toMatchObject({ status: 'COMPLETED', checkInMethod: 'STAFF_LOGGED', checkedInById: users.staff.id });
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: pack.id } })).classesRemaining).toBe(3);
      expect(await classesCounted('dan')).toBe(before + 1);
    });

    it('checks in a booking still Upcoming', async () => {
      const sub = await membership('dan', 'SUBSCRIPTION');
      const cls = await classAgo(30 * MIN, main.id);
      const open = await booking('dan', cls, sub.id, 'UPCOMING');
      const res = await log('coach', 'dan', cls);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ bookingId: open.id, from: 'UPCOMING', checkedInById: users.coach.id });
    });

    it('logs up to 30 days back in the School time zone, and never a class that has not started', async () => {
      await membership('cara', 'SUBSCRIPTION');
      const today = DateTime.now().setZone(ZONE).startOf('day');
      const earliest = today.minus({ days: 30 });
      // Just inside: an hour after the earliest day starts there.
      const inside = await classAgo(Date.now() - earliest.plus({ hours: 1 }).toMillis(), main.id);
      // Just outside: an hour before it.
      const outside = await classAgo(Date.now() - earliest.minus({ hours: 1 }).toMillis(), main.id);
      const future = await classAgo(-60 * MIN, main.id);

      expect((await log('staff', 'cara', inside)).status).toBe(201);
      const tooOld = await log('staff', 'cara', outside);
      expect(tooOld.status).toBe(400);
      expect(tooOld.body.error.code).toBe('LOG_OUT_OF_RANGE');
      const notYet = await log('staff', 'cara', future);
      expect(notYet.status).toBe(400);
      expect(notYet.body.error.code).toBe('LOG_NOT_STARTED');

      const day = earliest.toISODate();
      const list = await as('staff').get(`${base()}/log-classes?date=${day}&studentId=${users.cara.id}`);
      expect(list.status).toBe(200);
      expect(list.body).toMatchObject({ earliestDay: day, today: today.toISODate() });
      expect(list.body.items.map((c: { id: string }) => c.id)).toContain(inside.id);
      expect(list.body.items.find((c: { id: string }) => c.id === inside.id).attended).toBe(true);
      expect(list.body.items.map((c: { id: string }) => c.id)).not.toContain(outside.id);
      // No day: today, the School's.
      const todays = await as('staff').get(`${base()}/log-classes`);
      expect(todays.status).toBe(200);
      expect(todays.body).toMatchObject({ date: today.toISODate(), timeZone: ZONE });
      const beforeRange = await as('staff').get(`${base()}/log-classes?date=${today.minus({ days: 31 }).toISODate()}`);
      expect(beforeRange.status).toBe(400);
      expect(beforeRange.body.error.code).toBe('LOG_OUT_OF_RANGE');
    });

    it('uses the same accounting as a booking: no credit left, no log', async () => {
      const empty = await membership('fay', 'CLASS_PACK', 0);
      const cls = await classAgo(DAY, main.id);
      const res = await log('owner', 'fay', cls);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PACK_USED_UP');
      expect(await superuser.booking.count({ where: { studentId: users.fay.id } })).toBe(0);
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: empty.id } })).classesRemaining).toBe(0);
    });

    it('refuses a former student, a cancelled class, and staff whose bookings switch is off', async () => {
      const cls = await classAgo(DAY, main.id);
      const formerly = await log('owner', 'left', cls);
      expect(formerly.status).toBe(404);
      expect(formerly.body.error.code).toBe('NOT_A_STUDENT_HERE');

      const cancelled = await classAgo(DAY, main.id);
      await superuser.class.update({ where: { id: cancelled.id }, data: { cancelledAt: new Date() } });
      await membership('gil', 'SUBSCRIPTION');
      expect((await log('owner', 'gil', cancelled)).status).toBe(409);

      expect((await setAccess('staff', { bookings: false })).status).toBe(200);
      const off = await log('staff', 'gil', cls);
      expect(off.status).toBe(403);
      expect(off.body.error.code).toBe('STAFF_ACCESS_OFF');
      expect((await setAccess('staff', {})).status).toBe(200);
      // A student can't log attendance, even their own.
      expect((await log('gil', 'gil', cls)).status).toBe(403);
    });

    it("never logs another Branch's or another School's class", async () => {
      await membership('eve', 'SUBSCRIPTION');
      const atOther = await classAgo(DAY, other.id);
      const res = await log('staff', 'eve', atOther);
      expect([403, 404]).toContain(res.status);
      expect(await superuser.booking.count({ where: { studentId: users.eve.id, classId: atOther.id } })).toBe(0);

      // The other School's owner and staff, through their own School or this one.
      const otherClass = await classAgo(DAY, null, otherSchool.id);
      await membership('otherStudent', 'SUBSCRIPTION', null, otherSchool.id);
      const mine = await classAgo(DAY, main.id);
      expect((await log('otherOwner', 'eve', mine)).status).toBe(403);
      expect((await log('otherOwner', 'eve', mine, otherSchool.id)).status).toBe(404);
      expect((await log('otherStaff', 'eve', mine, otherSchool.id)).status).toBe(404);
      expect((await log('owner', 'otherStudent', otherClass)).status).toBe(404);
      expect((await log('owner', 'otherStudent', otherClass, otherSchool.id)).status).toBe(403);
      expect(await superuser.booking.count({ where: { classId: { in: [mine.id, otherClass.id] } } })).toBe(0);

      // The class list for logging shows only the caller's Branches.
      const today = DateTime.now().setZone(ZONE).toISODate();
      const yesterday = DateTime.fromJSDate(atOther.startDate).setZone(ZONE).toISODate();
      const list = await as('staff').get(`${base()}/log-classes?date=${yesterday}`);
      expect(list.status).toBe(200);
      expect(list.body.items.map((c: { id: string }) => c.id)).not.toContain(atOther.id);
      expect((await as('otherOwner').get(`${base()}/log-classes?date=${today}`)).status).toBe(403);
    });
  });

  describe('statistics', () => {
    const stats = (who: string, query = '') => as(who).get(`${base()}/stats${query}`);

    beforeAll(async () => {
      // A clean, known set for the last 30 days.
      await superuser.trainingLog.deleteMany({ where: { schoolId: school.id } });
      await superuser.bookingAttendee.deleteMany({ where: { schoolId: school.id } });
      await superuser.booking.deleteMany({ where: { schoolId: school.id } });

      const subA = await membership('ana', 'SUBSCRIPTION');
      const subB = await membership('ben', 'SUBSCRIPTION');
      const trial = await membership('cara', 'TRIAL_MEMBERSHIP');
      const visit = await membership('dan', 'VISIT_PASS');
      const friend = await membership('ana', 'FRIEND_PASS');
      const mainOne = await classAgo(2 * DAY, main.id);
      const mainTwo = await classAgo(4 * DAY, main.id);
      const otherOne = await classAgo(3 * DAY, other.id);
      const tooOld = await classAgo(40 * DAY, main.id);
      const future = await classAgo(-2 * 60 * MIN, main.id);

      // Main: ana twice (one logged), ben once, cara on a trial, dan on a visit pass, one Friend Pass guest.
      const withGuest = await booking('ana', mainOne, subA.id, 'COMPLETED', { checkInMethod: 'INSTRUCTOR_MANUAL' });
      await booking('ana', mainTwo, subA.id, 'COMPLETED', { checkInMethod: 'STAFF_LOGGED' });
      await booking('ben', mainOne, subB.id, 'COMPLETED', { checkInMethod: 'SELF_SERVICE' });
      await booking('cara', mainOne, trial.id, 'COMPLETED', { checkInMethod: 'SELF_SERVICE' });
      await booking('dan', mainTwo, visit.id, 'COMPLETED', { checkInMethod: 'INSTRUCTOR_MANUAL' });
      await superuser.bookingAttendee.create({ data: { id: randomUUID(), bookingId: withGuest.id, schoolId: school.id, membershipId: friend.id, checkedInAt: new Date() } });
      // Other Branch: ben once.
      await booking('ben', otherOne, subB.id, 'COMPLETED', { checkInMethod: 'SELF_SERVICE' });
      // Not counted: no-show, cancelled, upcoming, too old.
      await booking('eve', mainTwo, (await membership('eve', 'SUBSCRIPTION')).id, 'NO_SHOW');
      await booking('fay', mainOne, (await membership('fay', 'SUBSCRIPTION')).id, 'CANCELLED');
      await booking('gil', future, (await membership('gil', 'SUBSCRIPTION')).id, 'UPCOMING');
      await booking('ben', tooOld, subB.id, 'COMPLETED');
    });

    it('the owner sees the whole School for the last 30 days, Trial, Visitor and Friend Pass included', async () => {
      const res = await stats('owner');
      expect(res.status).toBe(200);
      const today = DateTime.now().setZone(ZONE);
      expect(res.body).toEqual({
        from: today.minus({ days: 29 }).toISODate(),
        to: today.toISODate(),
        timeZone: ZONE,
        branchIds: null,
        excludePasses: false,
        // 6 members + 1 guest
        checkIns: 7,
        guestCheckIns: 1,
        loggedCheckIns: 1,
        classes: 3,
        students: 4,
        studentsPerClass: 2.3,
        classesPerStudent: 1.5,
      });
    });

    it('leaves Trial, Visitor and Friend Pass check-ins out with the filter, and narrows to a Branch', async () => {
      const res = await stats('owner', '?excludePasses=true');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ excludePasses: true, checkIns: 4, guestCheckIns: 0, classes: 3, students: 2, studentsPerClass: 1.3, classesPerStudent: 2 });

      const mainOnly = await stats('owner', `?branchId=${main.id}`);
      expect(mainOnly.body).toMatchObject({ branchIds: [main.id], checkIns: 6, classes: 2, students: 4 });
    });

    it('Branch Staff need "See attendance statistics", and then see only their own Branches', async () => {
      const off = await stats('staff');
      expect(off.status).toBe(403);
      expect(off.body.error).toMatchObject({ code: 'STAFF_ACCESS_OFF', message: "The School owner hasn't let you see attendance statistics." });
      expect((await as('staff').get(`/v1/schools/${school.id}/staff/me/access`)).body.access.attendanceStats).toBe(false);

      expect((await setAccess('staff', { attendanceStats: true })).status).toBe(200);
      expect((await as('staff').get(`/v1/schools/${school.id}/staff/me/access`)).body.access.attendanceStats).toBe(true);
      const own = await stats('staff');
      expect(own.status).toBe(200);
      expect(own.body).toMatchObject({ branchIds: [main.id], checkIns: 6, classes: 2 });
      const otherBranch = await stats('staff', `?branchId=${other.id}`);
      expect(otherBranch.status).toBe(403);
      expect(otherBranch.body.error.code).toBe('OTHER_BRANCH');

      expect((await setAccess('staffOther', { attendanceStats: true })).status).toBe(200);
      expect((await stats('staffOther')).body).toMatchObject({ branchIds: [other.id], checkIns: 1, classes: 1, students: 1 });
      await setAccess('staff', {});
      await setAccess('staffOther', {});
      expect((await stats('staff')).status).toBe(403);
    });

    it('coaches, students and other Schools never see them', async () => {
      expect((await stats('coach')).status).toBe(403);
      expect((await stats('ana')).status).toBe(403);
      expect((await stats('otherOwner')).status).toBe(403);
      expect((await stats('otherStaff')).status).toBe(403);
      // The other School's own statistics don't include this School's.
      const theirs = await as('otherOwner').get(`/v1/schools/${otherSchool.id}/attendance/stats`);
      expect(theirs.status).toBe(200);
      expect(theirs.body).toMatchObject({ checkIns: 0, classes: 0, students: 0 });
      // Naming another School's Branch is refused.
      expect((await as('otherOwner').get(`/v1/schools/${otherSchool.id}/attendance/stats?branchId=${main.id}`)).status).toBe(400);
    });
  });
});
