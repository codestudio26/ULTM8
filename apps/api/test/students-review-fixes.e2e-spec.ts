/**
 * Students page review fixes (Decision 341): who sees and edits which
 * students, the join checks, profile validation, the next-booking read and
 * home branches on revoke. Real HTTP, real Postgres/RLS.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { isAdultOn, isBirthDate } from '../src/common/decorators/is-birth-date.decorator';

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[students-review-fixes.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

type Role = 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT';

describe('isBirthDate', () => {
  const today = new Date('2026-10-26T12:00:00Z');
  it('accepts real past dates up to today and 120 years back', () => {
    expect(isBirthDate('2015-06-01', today)).toBe(true);
    expect(isBirthDate('2026-10-26', today)).toBe(true);
    expect(isBirthDate('1906-10-26', today)).toBe(true);
    expect(isBirthDate('2024-02-29', today)).toBe(true);
  });
  it('refuses future, too old and impossible dates', () => {
    expect(isBirthDate('2026-10-27', today)).toBe(false);
    expect(isBirthDate('2099-01-01', today)).toBe(false);
    expect(isBirthDate('1906-10-25', today)).toBe(false);
    expect(isBirthDate('2021-02-30', today)).toBe(false);
    expect(isBirthDate('2023-02-29', today)).toBe(false);
    expect(isBirthDate('not a date', today)).toBe(false);
  });
});

describe('isAdultOn', () => {
  const today = new Date('2026-10-26T12:00:00Z');
  it('is 18 from the birthday itself', () => {
    expect(isAdultOn(new Date('2008-10-26'), today)).toBe(true);
    expect(isAdultOn(new Date('2008-10-27'), today)).toBe(false);
    expect(isAdultOn(null, today)).toBe(false);
  });
});

describeIfDb('Students page review fixes (Decision 341)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const id: Record<string, string> = {};
  const token: Record<string, string> = {};
  let schoolId: string;
  let branchless: string;
  let north: string;
  let south: string;
  let shut: string;

  async function person(label: string, grants: Array<{ role: Role; schoolId: string; branchId?: string }>, opts: { email?: string; home?: { schoolId: string; branchId: string } } = {}) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: opts.email ?? `students-fixes-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Tester',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
        language: 'en-GB',
      },
    });
    userIds.push(u.id);
    id[label] = u.id;
    for (const g of grants) {
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: g.role, userId: u.id, schoolId: g.schoolId, branchId: g.branchId ?? null } });
    }
    if (opts.home) {
      await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: opts.home.schoolId, studentId: u.id, branchId: opts.home.branchId } });
    }
    token[label] = jwt.sign({ sub: u.id, email: u.email, grants: grants.map((g) => ({ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: g.branchId ?? null })) });
  }

  const http = () => request(app.getHttpServer());
  const as = (label: string) => ({ Authorization: `Bearer ${token[label]}` });
  const roster = (label: string, status = 'ACTIVE', school = schoolId) =>
    http().get(`/v1/schools/${school}/students?status=${status}`).set(as(label));
  const profile = (label: string, student: string) => http().get(`/v1/schools/${schoolId}/students/${id[student]}/profile`).set(as(label));
  const patch = (label: string, student: string, body: Record<string, unknown>) =>
    http().patch(`/v1/schools/${schoolId}/students/${id[student]}/profile`).set(as(label)).send(body);
  const join = (label: string, school: string, body: Record<string, unknown> = {}) => http().post(`/v1/schools/${school}/join`).set(as(label)).send(body);
  const names = (res: request.Response) => (res.body.items as Array<{ firstName: string }>).map((s) => s.firstName).sort();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    schoolId = (await superuser.school.create({ data: { id: randomUUID(), name: 'Students Fixes Dojo' } })).id;
    branchless = (await superuser.school.create({ data: { id: randomUUID(), name: 'Students Fixes Branchless Dojo' } })).id;
    shut = (await superuser.school.create({ data: { id: randomUUID(), name: 'Students Fixes Closed Dojo', archivedAt: new Date() } })).id;
    schoolIds.push(schoolId, branchless, shut);
    north = (await superuser.branch.create({ data: { id: randomUUID(), schoolId, name: 'North' } })).id;
    south = (await superuser.branch.create({ data: { id: randomUUID(), schoolId, name: 'South' } })).id;

    await person('owner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId }, { role: 'SCHOOL_OWNER_MANAGER', schoolId: branchless }, { role: 'SCHOOL_OWNER_MANAGER', schoolId: shut }]);
    await person('northCoach', [{ role: 'INSTRUCTOR', schoolId, branchId: north }]);
    await person('northStaff', [{ role: 'BRANCH_STAFF', schoolId, branchId: north }]);
    await person('anyBranchStaff', [{ role: 'BRANCH_STAFF', schoolId }]);
    await person('soloCoach', [{ role: 'INSTRUCTOR', schoolId: branchless }]);
    await person('nora', [{ role: 'STUDENT', schoolId }, { role: 'STUDENT', schoolId: branchless }], { home: { schoolId, branchId: north } });
    await person('sam', [{ role: 'STUDENT', schoolId }], { home: { schoolId, branchId: south } });
    await person('homeless', [{ role: 'STUDENT', schoolId }]);
    await person('kid', [{ role: 'STUDENT', schoolId }], { email: `minor+${randomUUID()}@guardian-managed.ultm8.internal`, home: { schoolId, branchId: north } });
    await person('newcomer', []);
  });

  afterAll(async () => {
    await superuser.booking.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.class.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membership.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.waiverSignature.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('S1: branch staff see and edit their own branch\'s students', () => {
    it('the owner sees every student; North staff see only North\'s', async () => {
      expect(names(await roster('owner'))).toEqual(['homeless', 'kid', 'nora', 'sam']);
      expect(names(await roster('northCoach'))).toEqual(['kid', 'nora']);
      expect(names(await roster('northStaff', 'ALL'))).toEqual(['kid', 'nora']);
      expect(names(await roster('northCoach', 'INACTIVE'))).toEqual([]);
    });

    it('a staff grant with no branch covers no students at a School with branches', async () => {
      expect(names(await roster('anyBranchStaff'))).toEqual([]);
    });

    it('a School without branches: every coach sees every student (Decision 177, unchanged)', async () => {
      expect(names(await roster('soloCoach', 'ACTIVE', branchless))).toEqual(['nora']);
    });

    it('North staff can read and edit a North student, not a South one or one with no home branch', async () => {
      expect((await profile('northCoach', 'nora')).status).toBe(200);
      const edited = await patch('northStaff', 'nora', { surname: 'Edited' });
      expect(edited.status).toBe(200);
      expect(edited.body.surname).toBe('Edited');

      const south = await patch('northCoach', 'sam', { surname: 'Nope' });
      expect(south.status).toBe(403);
      expect(south.body.error.message).toBe('This student belongs to a branch you are not assigned to.');
      const none = await profile('northCoach', 'homeless');
      expect(none.status).toBe(403);
      expect(none.body.error.message).toMatch(/no home branch yet/);
      expect((await superuser.user.findUniqueOrThrow({ where: { id: id.sam } })).surname).toBe('Tester');
    });
  });

  describe('S9: the staff edit form reads the full profile', () => {
    it('returns the stored profile, and null really clears a field', async () => {
      await superuser.user.update({ where: { id: id.sam }, data: { nationality: 'Brazilian', kimonoSize: 'A2' } });
      const res = await profile('owner', 'sam');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: id.sam, nationality: 'Brazilian', kimonoSize: 'A2', language: 'en-GB' });
      expect(res.body.passcodeHash).toBeUndefined();

      expect((await patch('owner', 'sam', { nationality: null })).status).toBe(200);
      expect((await superuser.user.findUniqueOrThrow({ where: { id: id.sam } })).nationality).toBeNull();
    });
  });

  describe('S5 part 1, S7, S8: profile values', () => {
    it.each([
      ['a future date of birth', { dateOfBirth: '2099-01-01' }, /not in the future/],
      ['a date that does not exist', { dateOfBirth: '2021-02-30' }, /not in the future/],
      ['a date over 120 years ago', { dateOfBirth: '1890-01-01' }, /not more than 120 years ago/],
      ['a first name of spaces', { firstName: '   ' }, /First name can't be blank/],
      ['a surname of spaces', { surname: '  ' }, /Surname can't be blank/],
      ['a language not on the list', { language: 'Klingon!!' }, /Choose a language from the list/],
      ['a currency not on the list', { currency: 'BANANAS' }, /Choose a currency from the list/],
    ])('refuses %s', async (_label, body, message) => {
      const res = await patch('owner', 'sam', body);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(message);
    });

    it('trims names, and accepts listed language and currency codes', async () => {
      const res = await patch('owner', 'sam', { firstName: '  Samuel ', language: 'pt-BR', currency: 'BRL', dateOfBirth: '2012-05-04' });
      expect(res.status).toBe(200);
      const saved = await superuser.user.findUniqueOrThrow({ where: { id: id.sam } });
      expect(saved).toMatchObject({ firstName: 'Samuel', language: 'pt-BR', currency: 'BRL' });
      expect(saved.dateOfBirth?.toISOString().slice(0, 10)).toBe('2012-05-04');
      await superuser.user.update({ where: { id: id.sam }, data: { firstName: 'sam' } });
    });

    it('self-service also refuses impossible dates and blank names', async () => {
      const res = await http().patch('/v1/users/me').set(as('sam')).send({ dateOfBirth: '2021-02-30' });
      expect(res.status).toBe(400);
      const blank = await http().patch('/v1/users/me').set(as('sam')).send({ firstName: ' ' });
      expect(blank.status).toBe(400);
    });
  });

  describe('S5 part 2: only the owner changes a birth date across 18 (Decision 342)', () => {
    it('staff can correct a date that keeps the same side of 18, not one that crosses it', async () => {
      expect((await patch('northStaff', 'nora', { dateOfBirth: '1999-03-04' })).status).toBe(200);
      const crossing = await patch('northStaff', 'nora', { dateOfBirth: '2015-03-04' });
      expect(crossing.status).toBe(403);
      expect(crossing.body.error.message).toBe('Only the School owner can change a birth date that makes someone an adult or a child.');
      expect((await superuser.user.findUniqueOrThrow({ where: { id: id.nora } })).dateOfBirth?.toISOString().slice(0, 10)).toBe('1999-03-04');
    });

    it('the owner can make that change', async () => {
      expect((await patch('owner', 'nora', { dateOfBirth: '2015-03-04' })).status).toBe(200);
      expect((await patch('owner', 'nora', { dateOfBirth: '2000-01-01' })).status).toBe(200);
    });
  });

  describe('S10: a Guardian-managed child shows no placeholder email', () => {
    it('blanks the email and flags the row', async () => {
      const rows = (await roster('owner')).body.items as Array<{ firstName: string; email: string; guardianManaged: boolean }>;
      expect(rows.find((r) => r.firstName === 'kid')).toMatchObject({ email: '', guardianManaged: true });
      expect(rows.find((r) => r.firstName === 'nora')).toMatchObject({ guardianManaged: false });
      expect(rows.find((r) => r.firstName === 'nora')!.email).toMatch(/@example\.test$/);
    });
  });

  describe('S4, S6, S11: joining', () => {
    it('S11: staff who aren\'t the owner get the owner-only reason', async () => {
      const res = await join('northStaff', schoolId, { studentId: id.newcomer, branchId: north });
      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe('Only the School owner can enrol students.');
    });

    it('S4: a closed School takes no new students, by Invite or by joining', async () => {
      const invite = await join('owner', shut, { studentId: id.newcomer });
      expect(invite.status).toBe(403);
      expect(invite.body.error.message).toMatch(/has been closed/);
      const self = await join('newcomer', shut);
      expect(self.status).toBe(403);
      expect(await superuser.roleGrant.count({ where: { userId: id.newcomer, schoolId: shut } })).toBe(0);
    });

    it('S6: an archived branch can\'t be chosen; with every branch archived none is needed', async () => {
      await superuser.branch.update({ where: { id: south }, data: { archivedAt: new Date() } });
      try {
        const res = await join('owner', schoolId, { studentId: id.newcomer, branchId: south });
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe('This branch has been archived. Choose another branch.');

        await superuser.branch.update({ where: { id: north }, data: { archivedAt: new Date() } });
        const ok = await join('owner', schoolId, { studentId: id.newcomer });
        expect(ok.status).toBe(201);
        expect(await superuser.studentHomeBranch.count({ where: { studentId: id.newcomer, schoolId } })).toBe(0);
      } finally {
        await superuser.branch.updateMany({ where: { id: { in: [north, south] } }, data: { archivedAt: null } });
        await superuser.roleGrant.deleteMany({ where: { userId: id.newcomer, schoolId } });
      }
    });
  });

  describe('S13: revoking removes the home branch, so re-enrolling works', () => {
    it('revoke → home branch gone → the owner can enrol them again with a new one', async () => {
      await person('leaver', [{ role: 'STUDENT', schoolId }], { home: { schoolId, branchId: north } });
      const grant = await superuser.roleGrant.findFirstOrThrow({ where: { userId: id.leaver, schoolId, role: 'STUDENT' } });
      const revoked = await http().delete(`/v1/users/${id.leaver}/role-grants/${grant.id}`).set(as('owner'));
      expect(revoked.status).toBe(200);
      expect(await superuser.studentHomeBranch.count({ where: { studentId: id.leaver, schoolId } })).toBe(0);

      const back = await join('owner', schoolId, { studentId: id.leaver, branchId: south });
      expect(back.status).toBe(201);
      expect((await superuser.studentHomeBranch.findFirstOrThrow({ where: { studentId: id.leaver, schoolId } })).branchId).toBe(south);
    });
  });

  describe('S14: the next upcoming booking', () => {
    it('is the soonest class not yet started, whatever the id order, with the count of the rest', async () => {
      const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
      const m = await superuser.membership.create({ data: { id: randomUUID(), studentId: id.nora, membershipPlanId: plan.id, schoolId, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null } });
      const at = (hours: number) => new Date(Date.now() + hours * 3_600_000);
      // 25 bookings: ids sorted so the soonest class gets the LAST id, and one
      // class that has already started (still UPCOMING, not yet marked).
      const hours = [-0.5, ...Array.from({ length: 24 }, (_, i) => 100 - i * 2)];
      const ids = hours.map(() => randomUUID()).sort();
      for (const [i, h] of hours.entries()) {
        const cls = await superuser.class.create({ data: { id: randomUUID(), schoolId, branchId: north, title: `Class in ${h}h`, startDate: at(h), endDate: at(h + 1) } });
        await superuser.booking.create({ data: { id: ids[i], studentId: id.nora, classId: cls.id, schoolId, sourceMembershipId: m.id } });
      }
      const res = await http().get(`/v1/students/${id.nora}/bookings/next?schoolId=${schoolId}`).set(as('northCoach'));
      expect(res.status).toBe(200);
      expect(res.body.next.classTitle).toBe('Class in 54h');
      expect(res.body.moreUpcoming).toBe(23);

      const blocked = await http().get(`/v1/students/${id.sam}/bookings/next?schoolId=${schoolId}`).set(as('northCoach'));
      expect(blocked.status).toBe(403);
      const none = await http().get(`/v1/students/${id.sam}/bookings/next?schoolId=${schoolId}`).set(as('owner'));
      expect(none.body).toEqual({ next: null, moreUpcoming: 0 });
    });
  });
});
