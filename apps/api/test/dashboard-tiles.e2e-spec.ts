/**
 * The Dashboard's "Ready to grade" list and "Check-ins today" (Decision 454
 * item 8): GET /schools/:schoolId/grading-board/ready and
 * GET /schools/:schoolId/attendance/today. Real HTTP against a real Postgres.
 *
 * - Ready to grade is the Grading Board's Ready to Grade column, currently
 *   attending students only, across the styles the caller grades: the owner
 *   every open style and student; Branch Staff and coaches only the styles
 *   they hold a grading permission for, and only their own Branches' students.
 * - Check-ins today are counted as the attendance statistics count them
 *   (members checked in, plus guests checked in on a Friend Pass), for the
 *   classes starting today in the School's time zone: the owner the whole
 *   School, Branch Staff with "See attendance statistics" their own Branches.
 * - School A never sees School B's numbers, and the reverse.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[dashboard-tiles.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const MIN = 60_000;
const DAY = 86_400_000;
/** Far from UTC, so "today" in the School's zone differs from UTC's for half the day. */
const ZONE_A = 'Pacific/Auckland';

type Role = 'SCHOOL_OWNER_MANAGER' | 'INSTRUCTOR' | 'BRANCH_STAFF' | 'STUDENT';

describeIfDb('Dashboard: Ready to grade and Check-ins today (Decision 454 item 8)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const tokens: Record<string, string> = {};
  const users: Record<string, string> = {};

  type SchoolFixture = Awaited<ReturnType<typeof makeSchool>>;
  let A: SchoolFixture;
  let B: SchoolFixture;

  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokens[who]}`);
  const ready = (s: SchoolFixture, who: string) => get(`/v1/schools/${s.school.id}/grading-board/ready`, who);
  const today = (s: SchoolFixture, who: string, branchId?: string) =>
    get(`/v1/schools/${s.school.id}/attendance/today${branchId ? `?branchId=${branchId}` : ''}`, who);
  const readyIds = (res: request.Response) =>
    (res.body.items as Array<{ studentId: string; disciplineId: string }>).map((i) => `${i.studentId}:${i.disciplineId}`).sort();

  async function person(label: string, grants: Array<{ role: Role; schoolId: string; branchId?: string | null; revokedAt?: Date }>) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `dashboard-tiles-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Tiles',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    users[label] = u.id;
    for (const g of grants) {
      await superuser.roleGrant.create({
        data: { id: randomUUID(), role: g.role, userId: u.id, schoolId: g.schoolId, branchId: g.branchId ?? null, revokedAt: g.revokedAt ?? null, isMainOwner: g.role === 'SCHOOL_OWNER_MANAGER' },
      });
    }
    tokens[label] = jwt.sign({
      sub: u.id,
      email: u.email,
      grants: grants.filter((g) => !g.revokedAt).map((g) => ({ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: g.branchId ?? null })),
    });
    return u.id;
  }

  /** A style of three rungs, 10 classes and 30 days each. */
  async function style(schoolId: string, name: string, archived = false) {
    const discipline = await superuser.discipline.create({ data: { id: randomUUID(), schoolId, name, archivedAt: archived ? new Date() : null } });
    const rank = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: discipline.id, schoolId, order: 0, name: 'White', primaryColour: '#FFFFFF' } });
    const rungs: Array<{ id: string }> = [];
    for (let t = 0; t < 3; t++) {
      rungs.push(
        await superuser.rankStripeTier.create({
          data: { id: randomUUID(), rankId: rank.id, schoolId, order: t, count: t, colour: '#000000', name: `White ${t}`, classesRequired: 10, minimumDaysInRank: 30 },
        }),
      );
    }
    return { discipline, rank, rungs };
  }

  async function makeSchool(label: string, timezone: string) {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: `Dashboard Tiles ${label}`, ranksToggle: true, timezone } });
    schoolIds.push(school.id);
    const north = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'North' } });
    const south = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'South' } });
    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Monthly', price: 1000 } });
    const friendPlan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'FRIEND_PASS', title: 'Friend', price: 500 } });
    await person(`${label}-owner`, [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school.id }]);
    return { school, north, south, plan, friendPlan, timezone };
  }

  /** An enrolled student on rung 0 of `st`, with `classes` toward the next and their rank `daysAgo` old. */
  async function student(
    s: SchoolFixture,
    label: string,
    st: Awaited<ReturnType<typeof style>> | null,
    opts: { home?: string; classes?: number; daysAgo?: number; attending?: boolean; revoked?: boolean } = {},
  ) {
    const id = users[label] ?? (await person(label, [{ role: 'STUDENT', schoolId: s.school.id, revokedAt: opts.revoked ? new Date() : undefined }]));
    if (opts.home && !(await superuser.studentHomeBranch.findFirst({ where: { studentId: id, schoolId: s.school.id } }))) {
      await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.school.id, studentId: id, branchId: opts.home } });
    }
    if (opts.attending && !(await superuser.membership.findFirst({ where: { studentId: id, schoolId: s.school.id } }))) {
      await superuser.membership.create({ data: { id: randomUUID(), studentId: id, membershipPlanId: s.plan.id, schoolId: s.school.id, status: 'ACTIVE', frequency: 'RECURRING' } });
    }
    if (st) {
      await superuser.studentRank.create({
        data: {
          id: randomUUID(),
          studentId: id,
          disciplineId: st.discipline.id,
          schoolId: s.school.id,
          currentRankId: st.rank.id,
          currentStripeId: st.rungs[0].id,
          classesAttendedTowardCheckpoint: opts.classes ?? 0,
          dateOfCurrentRank: new Date(Date.now() - (opts.daysAgo ?? 0) * DAY),
        },
      });
    }
    return id;
  }

  /** A 60-minute class starting at `start`. */
  const klass = (s: SchoolFixture, start: Date, branchId: string | null) =>
    superuser.class.create({ data: { id: randomUUID(), schoolId: s.school.id, branchId, title: 'Class', membershipInclusion: true, startDate: start, endDate: new Date(start.getTime() + 60 * MIN) } });

  const booking = (s: SchoolFixture, studentLabel: string, cls: { id: string; branchId: string | null }, status: 'UPCOMING' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED') =>
    superuser.booking.create({ data: { id: randomUUID(), studentId: users[studentLabel], classId: cls.id, schoolId: s.school.id, branchId: cls.branchId, status, checkInMethod: status === 'COMPLETED' ? 'INSTRUCTOR_MANUAL' : null } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    A = await makeSchool('A', ZONE_A);
    B = await makeSchool('B', 'UTC');

    // --- Ready to grade, School A -------------------------------------------
    const bjj = await style(A.school.id, 'BJJ');
    const judo = await style(A.school.id, 'Judo');
    const retired = await style(A.school.id, 'Retired', true);
    await student(A, 'ana', bjj, { home: A.north.id, classes: 10, daysAgo: 40, attending: true }); // 100%: ready
    await student(A, 'ben', bjj, { home: A.south.id, classes: 7, daysAgo: 45, attending: true }); // 85%: ready
    await student(A, 'cara', bjj, { home: A.north.id, classes: 2, daysAgo: 3, attending: true }); // not ready
    await student(A, 'dan', bjj, { home: A.north.id, classes: 10, daysAgo: 40 }); // ready, but not currently attending
    await student(A, 'eve', bjj, { classes: 10, daysAgo: 40, attending: true }); // ready, no home Branch: the owner's alone
    await student(A, 'left', bjj, { home: A.north.id, classes: 10, daysAgo: 40, attending: true, revoked: true }); // left the School
    await student(A, 'fay', judo, { home: A.north.id, classes: 9, daysAgo: 40, attending: true }); // ready in Judo
    await student(A, 'ana', retired, { classes: 10, daysAgo: 40 }); // ready in an archived style: not graded

    // Staff of School A.
    await person('northStaff', [{ role: 'BRANCH_STAFF', schoolId: A.school.id, branchId: A.north.id }]);
    await person('northStaffNoStats', [{ role: 'BRANCH_STAFF', schoolId: A.school.id, branchId: A.north.id }]);
    await person('northCoach', [{ role: 'INSTRUCTOR', schoolId: A.school.id, branchId: A.north.id }]);
    await person('southCoach', [{ role: 'INSTRUCTOR', schoolId: A.school.id, branchId: A.south.id }]);
    await superuser.gradingPermission.createMany({
      data: [
        { id: randomUUID(), schoolId: A.school.id, userId: users.northStaff, disciplineId: bjj.discipline.id },
        { id: randomUUID(), schoolId: A.school.id, userId: users.southCoach, disciplineId: bjj.discipline.id },
        { id: randomUUID(), schoolId: A.school.id, userId: users.southCoach, disciplineId: judo.discipline.id },
      ],
    });
    await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId: A.school.id, userId: users.northStaff, canSeeAttendanceStats: true } });

    // --- Ready to grade, School B: one ready student -------------------------
    const bBjj = await style(B.school.id, 'BJJ');
    await student(B, 'bReady', bBjj, { home: B.north.id, classes: 10, daysAgo: 40, attending: true });

    // --- Check-ins today, School A (its own clock) ---------------------------
    const startA = DateTime.now().setZone(ZONE_A).startOf('day');
    const at = (minutes: number) => startA.plus({ minutes }).toJSDate();
    for (const label of ['gil', 'hal', 'ivy', 'jon', 'kim', 'lou']) await student(A, label, null);
    const northEarly = await klass(A, at(1), A.north.id); // the first minute of today
    const southLate = await klass(A, at(23 * 60 + 50), A.south.id); // the last class of today, checked in early
    const wholeSchool = await klass(A, at(120), null); // a School-wide class
    const yesterday = await klass(A, at(-1), A.north.id); // the last minute of yesterday
    const tomorrow = await klass(A, at(24 * 60), A.north.id); // the first minute of tomorrow
    const withGuests = await booking(A, 'gil', northEarly, 'COMPLETED');
    await booking(A, 'hal', northEarly, 'COMPLETED');
    await booking(A, 'ivy', northEarly, 'UPCOMING'); // booked, not checked in
    await booking(A, 'jon', northEarly, 'NO_SHOW');
    await booking(A, 'kim', northEarly, 'CANCELLED');
    await booking(A, 'lou', southLate, 'COMPLETED');
    await booking(A, 'kim', wholeSchool, 'COMPLETED');
    await booking(A, 'jon', yesterday, 'COMPLETED');
    await booking(A, 'ivy', tomorrow, 'COMPLETED');
    // gil brought two guests on Friend Passes: one checked in, one not yet.
    const guestPass = await superuser.membership.create({
      data: { id: randomUUID(), studentId: users.hal, membershipPlanId: A.friendPlan.id, schoolId: A.school.id, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 2 },
    });
    await superuser.bookingAttendee.create({ data: { id: randomUUID(), bookingId: withGuests.id, schoolId: A.school.id, membershipId: guestPass.id, checkedInAt: new Date() } });
    await superuser.bookingAttendee.create({ data: { id: randomUUID(), bookingId: withGuests.id, schoolId: A.school.id, membershipId: guestPass.id } });

    // --- Check-ins today, School B: two at North ----------------------------
    const startB = DateTime.now().setZone('UTC').startOf('day');
    for (const label of ['bOne', 'bTwo']) await student(B, label, null);
    const bClass = await klass(B, startB.plus({ minutes: 1 }).toJSDate(), B.north.id);
    await booking(B, 'bOne', bClass, 'COMPLETED');
    await booking(B, 'bTwo', bClass, 'COMPLETED');

    await person('aStudent', [{ role: 'STUDENT', schoolId: A.school.id }]);
  });

  afterAll(async () => {
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.booking.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.class.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membership.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentRank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.gradingPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('Ready to grade', () => {
    it("the owner: every open style's Ready to Grade column, currently attending students only", async () => {
      const res = await ready(A, 'A-owner');
      expect(res.status).toBe(200);
      const bjj = (await superuser.discipline.findFirstOrThrow({ where: { schoolId: A.school.id, name: 'BJJ' } })).id;
      const judo = (await superuser.discipline.findFirstOrThrow({ where: { schoolId: A.school.id, name: 'Judo' } })).id;
      // Not: cara (not ready), dan (not attending), left (left the School), ana's archived style.
      expect(readyIds(res)).toEqual([`${users.ana}:${bjj}`, `${users.ben}:${bjj}`, `${users.eve}:${bjj}`, `${users.fay}:${judo}`].sort());
      expect(res.body.total).toBe(4);
      // Highest progress first, and the rung they are working toward.
      expect(res.body.items[0]).toMatchObject({ studentId: users.ana, progressPercent: 100, disciplineName: 'BJJ' });
      expect(res.body.items.every((i: { nextRungId: string; currentStripeId: string }) => i.nextRungId && i.currentStripeId)).toBe(true);
    });

    it("matches the Grading Board's Ready to Grade column with \"Currently attending only\" on", async () => {
      const bjj = (await superuser.discipline.findFirstOrThrow({ where: { schoolId: A.school.id, name: 'BJJ' } })).id;
      const board = await get(`/v1/schools/${A.school.id}/grading-board?disciplineId=${bjj}&activeOnly=true`, 'A-owner');
      const onBoard = (board.body.items as Array<{ studentId: string; eligibility: { boardColumn: string } }>)
        .filter((i) => i.eligibility.boardColumn === 'READY_TO_GRADE')
        .map((i) => i.studentId)
        .sort();
      const listed = ((await ready(A, 'A-owner')).body.items as Array<{ studentId: string; disciplineId: string }>)
        .filter((i) => i.disciplineId === bjj)
        .map((i) => i.studentId)
        .sort();
      expect(listed).toEqual(onBoard);
    });

    it("Branch Staff and coaches: only the styles they may grade, and only their own Branches' students", async () => {
      const bjj = (await superuser.discipline.findFirstOrThrow({ where: { schoolId: A.school.id, name: 'BJJ' } })).id;
      const judo = (await superuser.discipline.findFirstOrThrow({ where: { schoolId: A.school.id, name: 'Judo' } })).id;
      // North staff grade BJJ only: ana (North). Not fay (Judo), ben (South), eve (no Branch).
      const north = await ready(A, 'northStaff');
      expect(north.status).toBe(200);
      expect(readyIds(north)).toEqual([`${users.ana}:${bjj}`]);
      expect(north.body.total).toBe(1);
      // South coach grades BJJ and Judo: ben (South) only.
      expect(readyIds(await ready(A, 'southCoach'))).toEqual([`${users.ben}:${bjj}`]);
      expect(readyIds(await ready(A, 'southCoach'))).not.toContain(`${users.fay}:${judo}`);
      // A coach with no grading permission sees no one.
      const none = await ready(A, 'northCoach');
      expect(none.status).toBe(200);
      expect(none.body).toEqual({ total: 0, items: [] });
    });

    it('a student is refused', async () => {
      expect([403, 404]).toContain((await ready(A, 'aStudent')).status);
    });

    it("School A never sees School B's students, and the reverse", async () => {
      const a = await ready(A, 'A-owner');
      const b = await ready(B, 'B-owner');
      expect(b.status).toBe(200);
      expect(b.body.items.map((i: { studentId: string }) => i.studentId)).toEqual([users.bReady]);
      expect(a.body.items.map((i: { studentId: string }) => i.studentId)).not.toContain(users.bReady);
      expect([403, 404]).toContain((await ready(B, 'A-owner')).status);
      expect([403, 404]).toContain((await ready(A, 'B-owner')).status);
      expect([403, 404]).toContain((await ready(B, 'northStaff')).status);
    });
  });

  describe('Check-ins today', () => {
    it("the owner: every check-in to today's classes on the School's clock, guests included", async () => {
      const res = await today(A, 'A-owner');
      expect(res.status).toBe(200);
      // gil + hal + gil's checked-in guest (North), lou (South, late today), kim (School-wide).
      // Not: ivy (upcoming), jon (no-show), kim at North (cancelled), the guest not yet in,
      // yesterday's last class or tomorrow's first.
      expect(res.body).toEqual({ date: DateTime.now().setZone(ZONE_A).toISODate(), timeZone: ZONE_A, branchIds: null, checkIns: 5, classes: 3 });
    });

    it('the Branch filter: only the classes held at that Branch', async () => {
      expect((await today(A, 'A-owner', A.north.id)).body).toMatchObject({ branchIds: [A.north.id], checkIns: 3, classes: 1 });
      expect((await today(A, 'A-owner', A.south.id)).body).toMatchObject({ branchIds: [A.south.id], checkIns: 1, classes: 1 });
    });

    it('Branch Staff with "See attendance statistics": their own Branches only; everyone else is refused', async () => {
      const north = await today(A, 'northStaff');
      expect(north.status).toBe(200);
      expect(north.body).toMatchObject({ branchIds: [A.north.id], checkIns: 3, classes: 1 });
      expect((await today(A, 'northStaff', A.north.id)).body).toMatchObject({ checkIns: 3 });
      expect((await today(A, 'northStaff', A.south.id)).status).toBe(403);
      expect((await today(A, 'northStaffNoStats')).status).toBe(403);
      expect((await today(A, 'northCoach')).status).toBe(403);
      expect([403, 404]).toContain((await today(A, 'aStudent')).status);
    });

    it("School A never sees School B's check-ins, and the reverse", async () => {
      expect((await today(B, 'B-owner')).body).toMatchObject({ timeZone: 'UTC', checkIns: 2, classes: 1 });
      expect((await today(A, 'A-owner')).body.checkIns).toBe(5);
      expect([403, 404]).toContain((await today(B, 'A-owner')).status);
      expect([403, 404]).toContain((await today(A, 'B-owner')).status);
      expect([403, 404]).toContain((await today(B, 'northStaff')).status);
      // Another School's Branch can't be named either.
      expect([400, 403, 404]).toContain((await today(A, 'A-owner', B.north.id)).status);
    });
  });
});
