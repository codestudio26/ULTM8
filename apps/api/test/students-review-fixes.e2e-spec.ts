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
import { StripeClientService } from '../src/payments/stripe-client.service';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as bcrypt from 'bcryptjs';
import { NOTIFICATION_FANOUT_QUEUE } from '../src/jobs/queue.constants';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';

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
  let noticeAdd: jest.SpyInstance;

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
    // Notices are checked as enqueued, not delivered (no fanout worker here).
    noticeAdd = jest.spyOn(moduleRef.get<Queue>(getQueueToken(NOTIFICATION_FANOUT_QUEUE)), 'add').mockResolvedValue(undefined as never);

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
    await superuser.waitlistEntry.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.paymentAccount.deleteMany({ where: { schoolId: { in: schoolIds } } });
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

      noticeAdd.mockClear();
      const back = await join('owner', schoolId, { studentId: id.leaver, branchId: south });
      expect(back.status).toBe(201);
      // Decision 366 (Q5): re-enrolling tells the student, no accept step.
      expect(noticeAdd).toHaveBeenCalledWith(
        'notify',
        expect.objectContaining({ userId: id.leaver, title: 'Added to a School', body: "You've been added to Students Fixes Dojo.", schoolId }),
        expect.objectContaining({ jobId: `student-added-${back.body.id}` }),
      );
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
  describe('S2: revoking ends upcoming bookings and waitlist places (Decision 343)', () => {
    it('the Revoke dialog summary lists what is live; revoke cancels bookings under the credit rule and stops the Subscription at period end', async () => {
      const periodEnd = new Date(Date.now() + 20 * 86_400_000);
      const stripeUpdate = jest.fn().mockResolvedValue({ cancel_at: Math.floor(periodEnd.getTime() / 1000), items: { data: [] } });
      // Every StripeClientService instance (TenantsModule registers its own).
      const spy = jest.spyOn(StripeClientService.prototype, 'scopedClient').mockReturnValue({ subscriptions: { update: stripeUpdate } } as never);
      await superuser.paymentAccount.create({ data: { id: randomUUID(), schoolId, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: 'acct_fixture' } });
      await person('quitter', [{ role: 'STUDENT', schoolId }], { home: { schoolId, branchId: north } });
      await person('stayer', [{ role: 'STUDENT', schoolId }], { home: { schoolId, branchId: north } });
      const at = (hours: number) => new Date(Date.now() + hours * 3_600_000);
      const packPlan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId, type: 'CLASS_PACK', title: 'Ten pack', price: 9000, classesIncluded: 10 } });
      const subPlan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId, type: 'SUBSCRIPTION', title: 'Monthly', price: 5000 } });
      const pack = await superuser.membership.create({ data: { id: randomUUID(), studentId: id.quitter, membershipPlanId: packPlan.id, schoolId, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 5 } });
      const sub = await superuser.membership.create({
        data: { id: randomUUID(), studentId: id.quitter, membershipPlanId: subPlan.id, schoolId, status: 'ACTIVE', frequency: 'RECURRING', stripeSubscriptionId: `sub_test_${randomUUID()}` },
      });
      // A used-up pack is not live, so it isn't listed.
      await superuser.membership.create({ data: { id: randomUUID(), studentId: id.quitter, membershipPlanId: packPlan.id, schoolId, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 0 } });
      const cls = async (title: string, start: number, extra: Record<string, unknown> = {}) =>
        superuser.class.create({ data: { id: randomUUID(), schoolId, branchId: north, title, startDate: at(start), endDate: at(start + 1), ...extra } });
      const early = await cls('S2 early', 48);
      const late = await cls('S2 past cut-off', 24, { refundFeeDate: at(-1) });
      const ended = await cls('S2 ended', -3);
      const full = await cls('S2 full', 30);
      const offered = await cls('S2 offered', 36);
      const book = (studentId: string, classId: string, membershipId: string) =>
        superuser.booking.create({ data: { id: randomUUID(), studentId, classId, schoolId, branchId: north, sourceMembershipId: membershipId } });
      const bEarly = await book(id.quitter, early.id, pack.id);
      const bLate = await book(id.quitter, late.id, pack.id);
      const bEnded = await book(id.quitter, ended.id, pack.id);
      const stayerPlan = await superuser.membership.create({ data: { id: randomUUID(), studentId: id.stayer, membershipPlanId: subPlan.id, schoolId, status: 'ACTIVE', frequency: 'RECURRING' } });
      const bStayer = await book(id.stayer, early.id, stayerPlan.id);
      const waiting = await superuser.waitlistEntry.create({ data: { id: randomUUID(), studentId: id.quitter, classId: full.id, schoolId, branchId: north, position: 1 } });
      const notified = await superuser.waitlistEntry.create({
        data: { id: randomUUID(), studentId: id.quitter, classId: offered.id, schoolId, branchId: north, position: 1, status: 'NOTIFIED', notifiedAt: new Date(), claimByDeadline: at(2) },
      });

      const summary = await http().get(`/v1/schools/${schoolId}/students/${id.quitter}/leaving-summary`).set(as('owner'));
      expect(summary.status).toBe(200);
      expect(summary.body.upcomingBookings).toBe(2);
      expect(summary.body.waitlistPlaces).toBe(2);
      expect(summary.body.memberships).toHaveLength(2);
      expect(summary.body.memberships).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: pack.id, planTitle: 'Ten pack', type: 'CLASS_PACK', classesRemaining: 5, renews: false }),
          expect.objectContaining({ id: sub.id, planTitle: 'Monthly', type: 'SUBSCRIPTION', classesRemaining: null, renews: true, cancelAt: null }),
        ]),
      );
      // Owner only, like Revoke.
      expect((await http().get(`/v1/schools/${schoolId}/students/${id.quitter}/leaving-summary`).set(as('northStaff'))).status).toBe(403);

      const grant = await superuser.roleGrant.findFirstOrThrow({ where: { userId: id.quitter, schoolId, role: 'STUDENT' } });
      expect((await http().delete(`/v1/users/${id.quitter}/role-grants/${grant.id}`).set(as('owner'))).status).toBe(200);

      const booking = (b: { id: string }) => superuser.booking.findUniqueOrThrow({ where: { id: b.id } });
      expect(await booking(bEarly)).toMatchObject({ status: 'CANCELLED', refundResolution: 'REFUNDED', resolvedById: id.owner });
      expect(await booking(bLate)).toMatchObject({ status: 'CANCELLED', refundResolution: 'WITHHELD' });
      expect((await booking(bEnded)).status).toBe('UPCOMING');
      expect((await booking(bStayer)).status).toBe('UPCOMING');
      // One credit back (the early class), none for the one past its cut-off.
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: pack.id } })).classesRemaining).toBe(6);
      expect((await superuser.waitlistEntry.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe('CANCELLED');
      expect((await superuser.waitlistEntry.findUniqueOrThrow({ where: { id: notified.id } })).status).toBe('CANCELLED');
      // No refund. The Subscription runs to the end of the paid period, then stops.
      const stopped = await superuser.membership.findUniqueOrThrow({ where: { id: sub.id } });
      expect(stopped).toMatchObject({ status: 'ACTIVE', cancelledById: id.owner });
      expect(stopped.cancelAt?.getTime()).toBe(Math.floor(periodEnd.getTime() / 1000) * 1000);
      expect(stripeUpdate).toHaveBeenCalledTimes(1);
      expect(stripeUpdate).toHaveBeenCalledWith(sub.stripeSubscriptionId, { cancel_at_period_end: true });
      // The stayer's (non-Stripe) membership is untouched.
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: stayerPlan.id } })).cancelAt).toBeNull();
      spy.mockRestore();
    });

    it('if Stripe refuses to stop the Subscription, nothing is revoked and the owner is told', async () => {
      const spy = jest.spyOn(StripeClientService.prototype, 'scopedClient').mockReturnValue({ subscriptions: { update: jest.fn().mockRejectedValue(new Error('stripe down')) } } as never);
      await person('stuck', [{ role: 'STUDENT', schoolId }], { home: { schoolId, branchId: north } });
      const plan = await superuser.membershipPlan.findFirstOrThrow({ where: { schoolId, title: 'Monthly' } });
      await superuser.membership.create({
        data: { id: randomUUID(), studentId: id.stuck, membershipPlanId: plan.id, schoolId, status: 'ACTIVE', frequency: 'RECURRING', stripeSubscriptionId: `sub_test_${randomUUID()}` },
      });
      const grant = await superuser.roleGrant.findFirstOrThrow({ where: { userId: id.stuck, schoolId, role: 'STUDENT' } });
      const res = await http().delete(`/v1/users/${id.stuck}/role-grants/${grant.id}`).set(as('owner'));
      expect(res.status).toBe(503);
      expect(res.body.error.message).toBe("Stripe couldn't stop this student's Subscription, so they haven't been removed. Please try again in a moment.");
      expect((await superuser.roleGrant.findUniqueOrThrow({ where: { id: grant.id } })).revokedAt).toBeNull();
      spy.mockRestore();

      const after = await http().get(`/v1/schools/${schoolId}/students/${id.quitter}/leaving-summary`).set(as('owner'));
      expect(after.body).toMatchObject({ upcomingBookings: 0, waitlistPlaces: 0 });
    });
  });
  describe('Decision 366: Add manually, home branch on the list, Guardian names', () => {
    const addManually = (label: string, body: Record<string, unknown>) => http().post(`/v1/schools/${schoolId}/students/add-manually`).set(as(label)).send(body);
    const adult = () => ({ firstName: ' Ada ', surname: 'Lovelace', email: `Add-Manually-${randomUUID()}@Example.test`, dateOfBirth: '1990-05-01', branchId: north });

    it('the owner adds an adult: a new account that must change its passcode, enrolled at the branch, emailed a temporary passcode', async () => {
      const send = jest.spyOn(NotificationDeliveryService.prototype, 'sendEmail').mockResolvedValue(undefined);
      noticeAdd.mockClear();
      const body = adult();
      const res = await addManually('owner', body);
      expect(res.status).toBe(201);
      userIds.push(res.body.id);
      expect(res.body).toMatchObject({ firstName: 'Ada', surname: 'Lovelace', email: body.email.toLowerCase(), emailSent: true, temporaryPasscode: null });

      const user = await superuser.user.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(user.mustChangePasscode).toBe(true);
      expect(await superuser.roleGrant.count({ where: { userId: user.id, schoolId, role: 'STUDENT', revokedAt: null } })).toBe(1);
      expect((await superuser.studentHomeBranch.findFirstOrThrow({ where: { studentId: user.id, schoolId } })).branchId).toBe(north);

      expect(send).toHaveBeenCalledTimes(1);
      const [to, subject, text] = send.mock.calls[0];
      expect(to).toBe(user.email);
      expect(subject).toBe("You've been added to Students Fixes Dojo on ULTM8");
      const temp = /Temporary passcode: (\d{6})/.exec(text)![1];
      expect(await bcrypt.compare(temp, user.passcodeHash)).toBe(true);
      // The email already says it: no second, in-app "added" notice.
      expect(noticeAdd).not.toHaveBeenCalled();
      send.mockRestore();

      // No email: the owner is given the passcode to hand over.
      const failing = jest.spyOn(NotificationDeliveryService.prototype, 'sendEmail').mockRejectedValue(new Error('not configured'));
      const offline = await addManually('owner', adult());
      expect(offline.status).toBe(201);
      userIds.push(offline.body.id);
      expect(offline.body.emailSent).toBe(false);
      const offlineUser = await superuser.user.findUniqueOrThrow({ where: { id: offline.body.id } });
      expect(await bcrypt.compare(offline.body.temporaryPasscode, offlineUser.passcodeHash)).toBe(true);
      failing.mockRestore();

      const again = await addManually('owner', { ...adult(), email: body.email });
      expect(again.status).toBe(409);
      expect(again.body.error.message).toBe('An account with this email already exists — use "Invite" instead.');
    });

    it('is owner only, adults only, and needs a branch at a School with branches', async () => {
      const send = jest.spyOn(NotificationDeliveryService.prototype, 'sendEmail').mockResolvedValue(undefined);
      expect((await addManually('northStaff', adult())).status).toBe(403);
      const child = await addManually('owner', { ...adult(), dateOfBirth: '2015-01-01' });
      expect(child.status).toBe(400);
      expect(child.body.error.message).toBe("Add manually is for adults (18 or over). A child joins through their Guardian's app.");
      const noBranch = await addManually('owner', { ...adult(), branchId: undefined });
      expect(noBranch.status).toBe(400);
      expect(noBranch.body.error.message).toBe('This School has branches: choose your home branch (branchId).');
      expect(send).not.toHaveBeenCalled();
      send.mockRestore();
    });

    it('roster rows carry the home branch; staff see their own branch\'s', async () => {
      const owner = await roster('owner');
      const row = (res: request.Response, name: string) => (res.body.items as Array<{ firstName: string; homeBranchId: string | null; homeBranchName: string | null }>).find((r) => r.firstName === name);
      expect(row(owner, 'sam')).toMatchObject({ homeBranchId: south, homeBranchName: 'South' });
      expect(row(owner, 'homeless')).toMatchObject({ homeBranchId: null, homeBranchName: null });
      const staff = await roster('northStaff');
      expect(row(staff, 'nora')).toMatchObject({ homeBranchId: north, homeBranchName: 'North' });
    });

    it('a child\'s page names their active Guardians, for staff who can read the child', async () => {
      await person('parent', []);
      await person('formerParent', []);
      await superuser.guardianLink.create({ data: { guardianId: id.parent, studentId: id.kid } });
      await superuser.guardianLink.create({ data: { guardianId: id.formerParent, studentId: id.kid, revokedAt: new Date() } });
      try {
        const res = await http().get(`/v1/schools/${schoolId}/students/${id.kid}/guardians`).set(as('northStaff'));
        expect(res.status).toBe(200);
        expect(res.body.items).toEqual([{ id: id.parent, firstName: 'parent', surname: 'Tester' }]);
        // South's student isn't North staff's to read.
        expect((await http().get(`/v1/schools/${schoolId}/students/${id.sam}/guardians`).set(as('northStaff'))).status).toBe(403);
        expect((await http().get(`/v1/schools/${schoolId}/students/${id.sam}/guardians`).set(as('owner'))).body.items).toEqual([]);
      } finally {
        await superuser.guardianLink.deleteMany({ where: { studentId: id.kid } });
      }
    });
  });
});
