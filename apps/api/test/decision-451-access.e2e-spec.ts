/**
 * Decision 451 (stress test round 7), access items:
 * - item 2 (R-1): paused staff are told their access is paused on every
 *   School page, not only the switch-gated ones, and nothing of the page is
 *   returned to them; the School Portal can ask which Schools those are.
 * - item 3 (S-3): a student's profile gives paused or removed staff the
 *   Decision 449 messages, not "School not found".
 * - item 4 (S-1): starting front-desk mode never tells a stranger whether a
 *   School or Branch exists.
 * - item 6 (S-4): the student tags list uses the Decision 449 split.
 * - item 7 (S-2): the plans-on-sale screen gives the School's own staff "no
 *   permission".
 * - item 8 (S-5): an out-of-range bookings-list cursor is a 400.
 * - item 10 (R-3): too many sign-in tries answer a plain sentence.
 * - item 14: a member's birth date is owner-only; coaches with "Manage
 *   students" and Branch Staff change the join date, not the birth date.
 * Someone with no link to the School keeps getting exactly what a missing
 * School gets.
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

type Role = 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT';

const PAUSED = 'Your access to this School has been paused. Please contact the School owner.';

describeIfDb('Decision 451: paused staff told everywhere, clear refusals, owner-only birth date', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const schoolId = randomUUID();
  const otherSchoolId = randomUUID();
  let branchId: string;
  const users: Record<string, { id: string; email: string }> = {};
  const roles: Record<string, Array<{ role: Role; schoolId: string; branchId: string | null }>> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const outcome = (res: request.Response) => [res.status, res.body.error?.code];

  function sign(label: string) {
    tokens[label] = jwt.sign({
      sub: users[label].id,
      email: users[label].email,
      grants: roles[label].map((g) => ({ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: g.branchId })),
    });
  }

  async function mkUser(label: string) {
    users[label] = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `d451-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Access',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-04-02'),
        phoneVerifiedAt: new Date(),
      },
    });
    roles[label] = [];
    sign(label);
  }

  async function grant(label: string, role: Role, extra: { school?: string; branchId?: string; isMainOwner?: boolean; paused?: boolean; revoked?: boolean } = {}) {
    const ended = extra.paused || extra.revoked ? new Date() : null;
    await superuser.roleGrant.create({
      data: {
        id: randomUUID(),
        role,
        userId: users[label].id,
        schoolId: extra.school ?? schoolId,
        branchId: extra.branchId ?? null,
        isMainOwner: extra.isMainOwner ?? false,
        revokedAt: ended,
        pausedAt: extra.paused ? ended : null,
      },
    });
    if (!ended) roles[label].push({ role, schoolId: extra.school ?? schoolId, branchId: extra.branchId ?? null });
    sign(label);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.create({ data: { id: schoolId, name: 'Decision 451 School', defaultCurrency: 'GBP' } });
    await superuser.school.create({ data: { id: otherSchoolId, name: 'Decision 451 Other School', defaultCurrency: 'GBP' } });
    branchId = (await superuser.branch.create({ data: { id: randomUUID(), schoolId, name: 'North' } })).id;
    for (const label of ['main', 'staffOn', 'coach', 'pausedStaff', 'pausedCoachMember', 'removedCoach', 'ana', 'member', 'otherOwner', 'stranger']) {
      await mkUser(label);
    }
    await grant('main', 'SCHOOL_OWNER_MANAGER', { isMainOwner: true });
    await grant('staffOn', 'BRANCH_STAFF', { branchId });
    await grant('coach', 'INSTRUCTOR', { branchId });
    await grant('pausedStaff', 'BRANCH_STAFF', { branchId, paused: true });
    // A coach who is paused here but is also a member of the School.
    await grant('pausedCoachMember', 'INSTRUCTOR', { branchId, paused: true });
    await grant('pausedCoachMember', 'STUDENT');
    await grant('removedCoach', 'INSTRUCTOR', { branchId, revoked: true });
    await grant('ana', 'STUDENT');
    await grant('member', 'STUDENT');
    await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId, studentId: users.ana.id, branchId } });
    // Ana hasn't signed in herself yet, so her name and birth date are still the School's to fix (Decision 430 item 13).
    await superuser.user.update({ where: { id: users.ana.id }, data: { mustChangePasscode: true } });
    await grant('otherOwner', 'SCHOOL_OWNER_MANAGER', { school: otherSchoolId, isMainOwner: true });
    await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId, userId: users.staffOn.id, canManageStudents: true } });
    await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId, userId: users.coach.id, canManageStudentsAsCoach: true } });
  });

  afterAll(async () => {
    await superuser.staffActivity.deleteMany({ where: { schoolId } }).catch(() => undefined);
    await superuser.studentJoinDate.deleteMany({ where: { schoolId } }).catch(() => undefined);
    await superuser.staffPermission.deleteMany({ where: { schoolId } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: [schoolId, otherSchoolId] } } });
    await superuser.branch.deleteMany({ where: { schoolId } });
    for (const id of [schoolId, otherSchoolId]) await superuser.school.delete({ where: { id } }).catch(() => undefined);
    const ids = Object.values(users).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: ids } } });
    await superuser.user.deleteMany({ where: { id: { in: ids } } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('item 2: paused staff are told their access is paused on every School page', () => {
    const pages = [
      '',
      '/students',
      '/branches',
      '/classes',
      '/waivers',
      '/membership-plans',
      '/transactions',
      '/sign-ups',
      '/staff',
      '/student-tags',
      '/plan-availability',
      `/students/${'{ana}'}/profile`,
    ];
    const path = (school: string, page: string) => `/v1/schools/${school}${page.replace('{ana}', users.ana.id)}`;

    it.each(pages)('GET /schools/:id%s answers ACCESS_PAUSED and nothing else', async (page) => {
      const res = await http().get(path(schoolId, page)).set(as('pausedStaff'));
      expect(outcome(res)).toEqual([403, 'ACCESS_PAUSED']);
      expect(res.body.error.message).toBe(PAUSED);
      expect(Object.keys(res.body)).toEqual(['error']);
      expect(JSON.stringify(res.body)).not.toContain('Decision 451 School');
    });

    it.each(pages)('GET /schools/:id%s: someone with no link gets what a missing School gets', async (page) => {
      for (const who of ['stranger', 'otherOwner']) {
        const real = await http().get(path(schoolId, page)).set(as(who));
        const missing = await http().get(path(randomUUID(), page)).set(as(who));
        expect([who, real.status, real.body.error?.code]).toEqual([who, missing.status, missing.body.error?.code]);
        expect(real.body.error?.code).not.toBe('ACCESS_PAUSED');
      }
      // Paused here says nothing about another School.
      const other = await http().get(path(otherSchoolId, page)).set(as('pausedStaff'));
      expect(other.body.error?.code).not.toBe('ACCESS_PAUSED');
    });

    it('writes are refused the same way, and nothing is done', async () => {
      const res = await http().post(`/v1/schools/${schoolId}/branches`).set(as('pausedStaff')).send({ name: 'Sneaky' });
      expect(outcome(res)).toEqual([403, 'ACCESS_PAUSED']);
      expect(await superuser.branch.count({ where: { schoolId, name: 'Sneaky' } })).toBe(0);
    });

    it('a paused coach who is also a member keeps what being a member gives them', async () => {
      const school = await http().get(`/v1/schools/${schoolId}`).set(as('pausedCoachMember'));
      expect(school.status).toBe(200);
      // A staff page still tells them their staff access is paused.
      const profile = await http().get(`/v1/schools/${schoolId}/students/${users.ana.id}/profile`).set(as('pausedCoachMember'));
      expect(outcome(profile)).toEqual([403, 'ACCESS_PAUSED']);
    });

    it('joining a School with its code is left as it was', async () => {
      const res = await http().post(`/v1/schools/${schoolId}/join`).set(as('pausedStaff')).send({});
      expect(res.body.error?.code).not.toBe('ACCESS_PAUSED');
    });

    it('GET /users/me/paused-schools lists the Schools where the caller is paused, for sign-in', async () => {
      const mine = async (who: string) => {
        const res = await http().get('/v1/users/me/paused-schools').set(as(who));
        expect(res.status).toBe(200);
        return res.body.schoolIds;
      };
      expect(await mine('pausedStaff')).toEqual([schoolId]);
      expect(await mine('pausedCoachMember')).toEqual([schoolId]);
      for (const who of ['staffOn', 'coach', 'removedCoach', 'ana', 'stranger', 'otherOwner']) expect([who, await mine(who)]).toEqual([who, []]);
    });

    it('unpaused, the same person is let back in at once', async () => {
      await superuser.roleGrant.updateMany({ where: { userId: users.pausedStaff.id, schoolId }, data: { revokedAt: null, pausedAt: null } });
      try {
        expect((await http().get(`/v1/schools/${schoolId}`).set(as('pausedStaff'))).status).toBe(200);
        expect((await http().get('/v1/users/me/paused-schools').set(as('pausedStaff'))).body.schoolIds).toEqual([]);
      } finally {
        const now = new Date();
        await superuser.roleGrant.updateMany({ where: { userId: users.pausedStaff.id, schoolId }, data: { revokedAt: now, pausedAt: now } });
      }
    });
  });

  describe("item 3: a student's profile", () => {
    const open = (who: string, school = schoolId) => http().get(`/v1/schools/${school}/students/${users.ana.id}/profile`).set(as(who));
    const save = (who: string, school = schoolId) => http().patch(`/v1/schools/${school}/students/${users.ana.id}/profile`).set(as(who)).send({ nationality: 'BR' });

    it('paused staff are told their access is paused; removed staff and members that they have no permission', async () => {
      for (const call of [open, save]) {
        expect(outcome(await call('pausedStaff'))).toEqual([403, 'ACCESS_PAUSED']);
        expect(outcome(await call('removedCoach'))).toEqual([403, 'NO_PERMISSION']);
        expect(outcome(await call('member'))).toEqual([403, 'NO_PERMISSION']);
      }
    });

    it('someone with no link gets 404, the same as for a missing School', async () => {
      for (const call of [open, save]) {
        for (const who of ['stranger', 'otherOwner']) {
          const real = await call(who);
          const missing = await call(who, randomUUID());
          expect([who, real.status, real.body]).toEqual([who, 404, missing.body]);
        }
      }
    });

    it('staff who may still open it', async () => {
      expect((await open('staffOn')).status).toBe(200);
      expect((await open('coach')).status).toBe(200);
    });
  });

  describe('item 4: starting front-desk mode', () => {
    const start = (who: string, school: string, body: Record<string, unknown>) => http().post(`/v1/schools/${school}/front-desk/sessions`).set(as(who)).send(body);

    it('a stranger always gets 404, whatever School or Branch they send', async () => {
      for (const who of ['stranger', 'otherOwner']) {
        const answers = [
          await start(who, schoolId, {}),
          await start(who, schoolId, { branchId }),
          await start(who, schoolId, { branchId: randomUUID() }),
          await start(who, randomUUID(), {}),
          await start(who, randomUUID(), { branchId: randomUUID() }),
        ];
        for (const res of answers) expect([who, res.status, res.body]).toEqual([who, 404, answers[3].body]);
      }
      expect(await superuser.frontDeskSession.count({ where: { schoolId } })).toBe(0);
    });

    it('people connected to the School are told why', async () => {
      expect(outcome(await start('ana', schoolId, {}))).toEqual([403, 'NO_PERMISSION']);
      expect(outcome(await start('pausedStaff', schoolId, {}))).toEqual([403, 'ACCESS_PAUSED']);
      const coach = await start('coach', schoolId, { branchId });
      expect(coach.status).toBe(403);
      expect(coach.body.error.message).toBe('Only the School owner, or Branch Staff at this Branch, can start front-desk mode.');
      // The owner still has to pick one of the School's Branches.
      expect((await start('main', schoolId, {})).status).toBe(400);
    });
  });

  describe('item 6: the student tags list', () => {
    const list = (who: string, school = schoolId) => http().get(`/v1/schools/${school}/student-tags`).set(as(who));

    it('uses the Decision 449 split', async () => {
      expect((await list('staffOn')).status).toBe(200);
      expect(outcome(await list('pausedStaff'))).toEqual([403, 'ACCESS_PAUSED']);
      expect(outcome(await list('ana'))).toEqual([403, 'NO_PERMISSION']);
      expect(outcome(await list('removedCoach'))).toEqual([403, 'NO_PERMISSION']);
      for (const who of ['stranger', 'otherOwner']) {
        expect([who, (await list(who)).status, (await list(who, randomUUID())).status]).toEqual([who, 404, 404]);
      }
    });
  });

  describe("item 7: the plans on sale (member app)", () => {
    const plans = (who: string, school = schoolId) => http().get(`/v1/schools/${school}/plan-availability`).set(as(who));

    it("gives the School's own coach and staff no permission, and strangers not found", async () => {
      expect((await plans('ana')).status).toBe(200);
      for (const who of ['coach', 'staffOn', 'main', 'removedCoach']) expect([who, ...outcome(await plans(who))]).toEqual([who, 403, 'NO_PERMISSION']);
      expect(outcome(await plans('pausedStaff'))).toEqual([403, 'ACCESS_PAUSED']);
      for (const who of ['stranger', 'otherOwner']) {
        const real = await plans(who);
        expect([who, real.status, real.body]).toEqual([who, 404, (await plans(who, randomUUID())).body]);
      }
    });
  });

  describe('item 8: an out-of-range bookings-list cursor', () => {
    const cursor = (raw: Record<string, unknown>) => Buffer.from(JSON.stringify(raw)).toString('base64url');

    it.each([
      ['a start date in the year -5000', { p: 'up', at: '2026-11-10T21:00:00.000Z', s: '-005000-01-01T00:00:00.000Z', id: 'x' }],
      ['a start date in the year 275760', { p: 'up', at: '2026-11-10T21:00:00.000Z', s: '+275760-09-13T00:00:00.000Z', id: 'x' }],
      ['a reference date in the year -271821', { p: 'past', at: '-271821-04-20T00:00:00.000Z', s: '2026-11-10T21:00:00.000Z', id: 'x' }],
      ['a "gone" cursor in the year 10000', { p: 'gone', at: '+010000-01-01T00:00:00.000Z', id: 'x' }],
    ])('%s is a 400, never a server error', async (_label, raw) => {
      const res = await http().get('/v1/bookings/me').query({ cursor: cursor(raw) }).set(as('ana'));
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('cursor is not valid');
    });
  });

  describe('item 14: a member\'s birth date is owner-only', () => {
    const edit = (who: string, body: Record<string, unknown>) => http().patch(`/v1/schools/${schoolId}/students/${users.ana.id}/profile`).set(as(who)).send(body);
    const birthDate = async () => (await superuser.user.findUniqueOrThrow({ where: { id: users.ana.id } })).dateOfBirth?.toISOString().slice(0, 10);

    it('a coach with "Manage students", and Branch Staff, change the join date but not the birth date, even within the same age group', async () => {
      for (const who of ['coach', 'staffOn']) {
        const res = await edit(who, { dateOfBirth: '1991-05-06' });
        expect([who, res.status]).toEqual([who, 403]);
        expect(res.body.error.message).toBe("Only the School owner can change a member's birth date.");
        expect(await birthDate()).toBe('1990-04-02');
        // The birth date they already have, sent back with the form, is not a change.
        expect([who, (await edit(who, { dateOfBirth: '1990-04-02', nationality: 'PT' })).status]).toEqual([who, 200]);
        const joined = await edit(who, { joinedOn: '2024-02-03' });
        expect([who, joined.status, joined.body.joinedOn]).toEqual([who, 200, '2024-02-03']);
      }
    });

    it('the owner can change it', async () => {
      expect((await edit('main', { dateOfBirth: '1991-05-06' })).status).toBe(200);
      expect(await birthDate()).toBe('1991-05-06');
      expect((await edit('main', { dateOfBirth: '1990-04-02' })).status).toBe(200);
    });
  });

  describe('item 10: too many sign-in tries', () => {
    it('answers a plain sentence, never the library\'s "ThrottlerException"', async () => {
      const email = `d451-throttle-${randomUUID()}@example.test`;
      let last: request.Response | undefined;
      for (let i = 0; i < 6; i++) last = await http().post('/v1/auth/login').send({ email, passcode: '000000' });
      expect(last!.status).toBe(429);
      expect(last!.body.error).toEqual({ code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please wait a moment and try again.' });
    });
  });
});
