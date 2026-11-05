/**
 * Stress test round 5, privacy/staff/races panel (Decision 432):
 *
 * - PRIV-4: Branch Staff with "Bookings and check-in" off can't read a
 *   class's roll call or waitlist (Decision 425 Q1).
 * - PRIV-5: a coach refused a Branch Staff switch's action gets 403
 *   NOT_FOR_COACHES, not "the owner hasn't let you" (Decision 425 Q6).
 * - PRIV-7: Book and Cancel resent at once never answer 5xx (the cancel takes
 *   the same per-Student-and-Class lock as booking).
 * - PRIV-8: the tablet locks at 20 wrong member codes in 30 minutes, right
 *   codes between them or not (amends Decision 417 item 4).
 * - PRIV-9: a School or Franchise with no roles at all is readable only in
 *   the minute after it was created.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET and REDIS_URL.
 */
import { HttpException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { FrontDeskSessionsService, FRONT_DESK_MAX_WRONG_MEMBER_CODES_IN_WINDOW } from '../src/front-desk/front-desk-sessions.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[stress-round5-privacy.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const HOUR = 3_600_000;
type Role = 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT';

describeIfDb('Round-5 stress test: privacy, staff and races (Decision 432)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const tag = randomUUID().slice(0, 8);
  const school = { id: randomUUID() };
  let branchId: string;
  type U = { id: string; email: string; token: string };
  let owner: U;
  let staff: U;
  let coach: U;
  let planId: string;

  const http = () => request(app.getHttpServer());
  const at = (ms: number) => new Date(Date.now() + ms);
  const get = (path: string, who: U) => http().get(`/v1${path}`).set('Authorization', `Bearer ${who.token}`);
  const post = (path: string, who: U, body: Record<string, unknown> = {}) => http().post(`/v1${path}`).set('Authorization', `Bearer ${who.token}`).send(body);
  const patch = (path: string, who: U, body: Record<string, unknown> = {}) => http().patch(`/v1${path}`).set('Authorization', `Bearer ${who.token}`).send(body);
  const put = (path: string, who: U, body: Record<string, unknown> = {}) => http().put(`/v1${path}`).set('Authorization', `Bearer ${who.token}`).send(body);
  const mkClass = (data: Record<string, unknown> = {}) =>
    superuser.class.create({ data: { membershipInclusion: true, id: randomUUID(), schoolId: school.id, branchId, title: 'R5 fixture', startDate: at(2 * HOUR), endDate: at(3 * HOUR), ...data } });

  async function mkUser(label: string, role: Role, grantBranchId: string | null = null): Promise<U> {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `r5-priv-${label}-${tag}-${randomUUID().slice(0, 6)}@example.test`,
        phone: `+1558${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Priv',
        passcodeHash: 'x',
        dateOfBirth: new Date('1994-03-03'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId: school.id, branchId: grantBranchId, isMainOwner: role === 'SCHOOL_OWNER_MANAGER' } });
    const token = jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId: grantBranchId }] });
    return { id: user.id, email: user.email, token };
  }
  async function mkStudent(label: string): Promise<U> {
    const s = await mkUser(label, 'STUDENT');
    await superuser.membership.create({ data: { id: randomUUID(), studentId: s.id, schoolId: school.id, membershipPlanId: planId, frequency: 'RECURRING' } });
    return s;
  }

  beforeAll(async () => {
    // Many requests from one address within a minute (PRIV-7's races).
    process.env.THROTTLE_IP_LIMIT_PER_MINUTE = '100000';
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);

    await superuser.school.create({ data: { id: school.id, name: `Round 5 Privacy ${tag}`, timezone: 'UTC' } });
    branchId = (await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: `Main ${tag}` } })).id;
    owner = await mkUser('owner', 'SCHOOL_OWNER_MANAGER');
    staff = await mkUser('staff', 'BRANCH_STAFF', branchId);
    coach = await mkUser('coach', 'INSTRUCTOR', branchId);
    planId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } })).id;
  });

  afterAll(async () => {
    const userIds = (await superuser.user.findMany({ where: { email: { contains: tag } }, select: { id: true } })).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.waitlistEntry.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.frontDeskSession.deleteMany({ where: { schoolId: school.id } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: school.id } });
    await superuser.staffActivity.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.branch.deleteMany({ where: { schoolId: school.id } });
    await superuser.school.deleteMany({ where: { name: { contains: tag } } });
    await superuser.franchise.deleteMany({ where: { name: { contains: tag } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.$disconnect();
    await appDb.$disconnect();
    await app.close();
  });

  const ALL_OFF = { classes: false, bookings: false, students: false, cancelClasses: false, staffList: false, disciplines: false, checkInRules: false, exportStudents: false, freezeMemberships: false, attendanceStats: false, memberFiles: false, importData: false, seeMedicalInfo: false };

  describe('PRIV-4: the roll call and waitlist follow the bookings switch', () => {
    it('Branch Staff with Bookings off get 403; with it on, and coaches and owners, 200', async () => {
      const cls = await mkClass();
      expect((await put(`/schools/${school.id}/staff/${staff.id}/access`, owner, ALL_OFF)).status).toBe(200);
      for (const path of [`/classes/${cls.id}/bookings`, `/classes/${cls.id}/waitlist`]) {
        const res = await get(path, staff);
        expect(res.status).toBe(403);
        expect(res.body.error).toMatchObject({ code: 'STAFF_ACCESS_OFF', message: "The School owner hasn't let you manage bookings and check-in here." });
        expect((await get(path, coach)).status).toBe(200);
        expect((await get(path, owner)).status).toBe(200);
      }
      expect((await put(`/schools/${school.id}/staff/${staff.id}/access`, owner, { ...ALL_OFF, bookings: true })).status).toBe(200);
      expect((await get(`/classes/${cls.id}/bookings`, staff)).status).toBe(200);
      expect((await get(`/classes/${cls.id}/waitlist`, staff)).status).toBe(200);
    });
  });

  describe('PRIV-5: coaches are told an action is not for coaches', () => {
    it('a coach gets NOT_FOR_COACHES; Branch Staff with the switch off still get STAFF_ACCESS_OFF', async () => {
      const start = at(48 * HOUR);
      const body = { title: 'Open mat', activities: ['Judo'], branchId, startDate: start.toISOString(), endDate: new Date(start.getTime() + HOUR).toISOString() };
      const byCoach = await post(`/schools/${school.id}/classes`, coach, body);
      expect(byCoach.status).toBe(403);
      expect(byCoach.body.error).toMatchObject({ code: 'NOT_FOR_COACHES', message: "Coaches can't do this. Ask the School owner." });
      const exportByCoach = await get(`/schools/${school.id}/students/export`, coach);
      expect(exportByCoach.status).toBe(403);
      expect(exportByCoach.body.error.code).toBe('NOT_FOR_COACHES');

      expect((await put(`/schools/${school.id}/staff/${staff.id}/access`, owner, ALL_OFF)).status).toBe(200);
      const byStaff = await post(`/schools/${school.id}/classes`, staff, body);
      expect(byStaff.status).toBe(403);
      expect(byStaff.body.error).toMatchObject({ code: 'STAFF_ACCESS_OFF', message: "The School owner hasn't let you manage classes and the timetable here." });
      expect((await get(`/schools/${school.id}/students/export`, staff)).body.error.code).toBe('STAFF_ACCESS_OFF');
    });
  });

  describe('PRIV-7: Book and Cancel resent together', () => {
    it('never a 5xx, and the Student ends with at most one upcoming booking', async () => {
      const students: U[] = [];
      for (let i = 0; i < 6; i++) students.push(await mkStudent(`racer${i}`));
      for (let trial = 0; trial < 4; trial++) {
        const cls = await mkClass({ capacity: 30 });
        const first = await Promise.all(students.map((s) => post(`/classes/${cls.id}/book`, s)));
        expect(first.map((r) => r.status)).toEqual(students.map(() => 201));
        const results = await Promise.all(
          students.flatMap((s, i) => [
            ...Array.from({ length: 5 }, () => post(`/classes/${cls.id}/book`, s)),
            ...Array.from({ length: 5 }, () => patch(`/bookings/${first[i].body.id}/cancel`, s)),
          ]),
        );
        const fives = results.filter((r) => r.status >= 500).map((r) => `${r.status} ${JSON.stringify(r.body)}`);
        expect(fives).toEqual([]);
        for (const s of students) {
          expect(await superuser.booking.count({ where: { classId: cls.id, studentId: s.id, status: 'UPCOMING' } })).toBeLessThanOrEqual(1);
          // The first booking was cancelled exactly once.
          expect(results.filter((r) => r.status === 200 && r.body.studentId === s.id && r.body.status === 'CANCELLED')).toHaveLength(1);
        }
      }
    });
  });

  describe('PRIV-8: 20 wrong member codes in 30 minutes lock the tablet', () => {
    it('locks on the 20th wrong code even with a right code every 9 guesses', async () => {
      const started = await post(`/schools/${school.id}/front-desk/sessions`, owner, { branchId });
      expect(started.status).toBe(201);
      const sessions = app.get(FrontDeskSessionsService);
      const session = { id: started.body.sessionId as string, schoolId: school.id, branchId, startedById: owner.id, expiresAt: new Date(started.body.expiresAt), lockedAt: null };
      const wrong = () => sessions.countWrongMemberCode(session);
      // 9 wrong, then a right one (which resets "in a row"), twice: 18 wrong, no lock.
      for (let round = 0; round < 2; round++) {
        for (let i = 0; i < 9; i++) await wrong();
        await sessions.resetWrongMemberCodes(session);
      }
      await wrong(); // 19
      expect((await superuser.frontDeskSession.findUniqueOrThrow({ where: { id: session.id } })).lockedAt).toBeNull();
      const locking = await wrong().then(() => null, (err: unknown) => err);
      expect(locking).toBeInstanceOf(HttpException);
      expect((locking as HttpException).getStatus()).toBe(423);
      expect((await superuser.frontDeskSession.findUniqueOrThrow({ where: { id: session.id } })).lockedAt).not.toBeNull();
    });
    it('the window is FRONT_DESK_MAX_WRONG_MEMBER_CODES_IN_WINDOW = 20', () => {
      expect(FRONT_DESK_MAX_WRONG_MEMBER_CODES_IN_WINDOW).toBe(20);
    });
  });

  describe('PRIV-9: a School or Franchise with no roles is readable only while it is being created', () => {
    const readAs = (userId: string, fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<unknown>) =>
      appDb.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
        return fn(tx);
      });

    it('a grant-less School or Franchise older than a minute is hidden from another signed-in user', async () => {
      const outsider = await mkUser('outsider', 'STUDENT');
      const old = await superuser.school.create({ data: { id: randomUUID(), name: `Orphan ${tag}`, createdAt: new Date(Date.now() - 5 * 60_000) } });
      const fresh = await superuser.school.create({ data: { id: randomUUID(), name: `Bootstrap ${tag}` } });
      expect(await readAs(outsider.id, (tx) => tx.school.findUnique({ where: { id: old.id }, select: { id: true } }))).toBeNull();
      expect(await readAs(outsider.id, (tx) => tx.school.findUnique({ where: { id: fresh.id }, select: { id: true } }))).toEqual({ id: fresh.id });

      const oldFranchise = await superuser.franchise.create({ data: { id: randomUUID(), name: `Orphan F ${tag}`, createdAt: new Date(Date.now() - 5 * 60_000) } });
      expect(await readAs(outsider.id, (tx) => tx.franchise.findUnique({ where: { id: oldFranchise.id }, select: { id: true } }))).toBeNull();
    });

    it('creating a School through the API still works (it reads the new row back before its owner grant exists)', async () => {
      const creator = await mkUser('creator', 'STUDENT');
      const res = await post('/schools', creator, { name: `Created ${tag}` });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe(`Created ${tag}`);
    });
  });
});
