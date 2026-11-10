/**
 * Decision 449, access:
 * - item 6: refusals are clear for people connected to the School and "not
 *   found" only for strangers. On every page an owner's switch (or the
 *   payments area) guards: paused staff get 403 ACCESS_PAUSED; members,
 *   former members or staff, and Guardians of its students get 403
 *   NO_PERMISSION; staff keep STAFF_ACCESS_OFF / NOT_FOR_COACHES; someone
 *   with no link (another School's owner) and an unknown School get 404.
 *   The payment account record (Decision 448 item 9) follows the same rule.
 * - item 7: the main owner can give a coach "Manage students" (off by
 *   default), which lets them edit a student's profile.
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

describeIfDb('Decision 449: clear refusals for people connected to the School; coaches can manage students', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const schoolId = randomUUID();
  const otherSchoolId = randomUUID();
  let branchId: string;
  let otherBranchId: string;
  const users: Record<string, { id: string; email: string }> = {};
  const roles: Record<string, Array<{ role: Role; schoolId: string; branchId: string | null }>> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

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
        email: `d449-${label}-${randomUUID()}@example.test`,
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

  async function grant(label: string, role: Role, extra: { school?: string; branchId?: string; isMainOwner?: boolean; grantedAt?: Date; paused?: boolean; revoked?: boolean } = {}) {
    const ended = extra.paused || extra.revoked ? new Date() : null;
    await superuser.roleGrant.create({
      data: {
        id: randomUUID(),
        role,
        userId: users[label].id,
        schoolId: extra.school ?? schoolId,
        branchId: extra.branchId ?? null,
        isMainOwner: extra.isMainOwner ?? false,
        grantedAt: extra.grantedAt ?? new Date(),
        revokedAt: ended,
        pausedAt: extra.paused ? ended : null,
      },
    });
    // A paused or ended role is not in the token (it is built from live grants).
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

    await superuser.school.create({ data: { id: schoolId, name: 'Decision 449 School', defaultCurrency: 'BRL', branchStaffCanRecordPayments: false } });
    await superuser.school.create({ data: { id: otherSchoolId, name: 'Decision 449 Other School', defaultCurrency: 'BRL' } });
    branchId = (await superuser.branch.create({ data: { id: randomUUID(), schoolId, name: 'North' } })).id;
    otherBranchId = (await superuser.branch.create({ data: { id: randomUUID(), schoolId, name: 'South' } })).id;
    for (const label of [
      'main',
      'coOwner',
      'staffOn',
      'staffNoPay',
      'coach',
      'southCoach',
      'pausedStaff',
      'pausedCoach',
      'removedStaff',
      'ana',
      'formerMember',
      'parent',
      'otherOwner',
      'stranger',
    ]) {
      await mkUser(label);
    }
    await grant('main', 'SCHOOL_OWNER_MANAGER', { isMainOwner: true, grantedAt: new Date('2026-01-01') });
    await grant('coOwner', 'SCHOOL_OWNER_MANAGER');
    await grant('staffOn', 'BRANCH_STAFF', { branchId });
    await grant('staffNoPay', 'BRANCH_STAFF', { branchId });
    await grant('coach', 'INSTRUCTOR', { branchId });
    await grant('southCoach', 'INSTRUCTOR', { branchId: otherBranchId });
    await grant('pausedStaff', 'BRANCH_STAFF', { branchId, paused: true });
    await grant('pausedCoach', 'INSTRUCTOR', { branchId, paused: true });
    await grant('removedStaff', 'BRANCH_STAFF', { branchId, revoked: true });
    await grant('ana', 'STUDENT');
    await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId, studentId: users.ana.id, branchId } });
    await grant('formerMember', 'STUDENT', { revoked: true });
    // A Guardian of a student here, with no role of their own at the School.
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: users.parent.id, studentId: users.ana.id } });
    // Another School's owner: no link to this School at all.
    await grant('otherOwner', 'SCHOOL_OWNER_MANAGER', { school: otherSchoolId, isMainOwner: true });
    await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId, userId: users.staffNoPay.id, canCreateCharges: false, canCancelCharges: false, canConnectStripe: false } });
    await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId, provider: 'STRIPE', accountTitle: 'Decision 449 School', country: 'BR', stripeConnectedAccountId: `acct_d449_${randomUUID().slice(0, 8)}` },
    });
  });

  afterAll(async () => {
    await superuser.staffActivity.deleteMany({ where: { schoolId } }).catch(() => undefined);
    await superuser.staffPermission.deleteMany({ where: { schoolId } });
    await superuser.paymentAccount.deleteMany({ where: { schoolId } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: users.parent.id } });
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

  describe('item 6: switch-gated pages', () => {
    const studentPath = (s: string) => `/v1/schools/${s}/students/${users.ana.id}`;
    const gated: Array<[string, (school: string) => request.Test]> = [
      ['check-in rules', (s) => http().get(`/v1/schools/${s}/check-in-rules`)],
      ['payroll report', (s) => http().get(`/v1/schools/${s}/payroll/report`)],
      ['attendance stats', (s) => http().get(`/v1/schools/${s}/attendance/stats`)],
      ['attendance log classes', (s) => http().get(`/v1/schools/${s}/attendance/log-classes`)],
      ['freeze list', (s) => http().get(`/v1/schools/${s}/freezes`)],
      ['charge reports', (s) => http().get(`/v1/schools/${s}/charge-reports/overview`)],
      ['custom status assignments', (s) => http().get(`/v1/schools/${s}/custom-member-statuses/students`)],
      ['rosters', (s) => http().post(`/v1/schools/${s}/rosters`).send({ name: 'Team' })],
      ['student charges', (s) => http().get(`${studentPath(s)}/charges`)],
      ['recurring charges', (s) => http().get(`${studentPath(s)}/recurring-charges`)],
      ['medical information', (s) => http().get(`${studentPath(s)}/medical-info`)],
      ['member files', (s) => http().get(`${studentPath(s)}/files`)],
      ['Stripe status', (s) => http().get(`/v1/schools/${s}/payment-account/connect-status`)],
      ['payment account', (s) => http().get(`/v1/schools/${s}/payment-account`)],
      ['student export', (s) => http().get(`/v1/schools/${s}/students/export`)],
      ['data imports', (s) => http().get(`/v1/schools/${s}/imports/limits`)],
      ['new class', (s) => http().post(`/v1/schools/${s}/classes`).send({ title: 'Open mat', startDate: '2027-01-04T18:00:00.000Z', endDate: '2027-01-04T19:00:00.000Z' })],
    ];

    it.each(gated)('%s: paused staff are told their access is paused', async (_name, call) => {
      for (const who of ['pausedStaff', 'pausedCoach']) {
        const res = await call(schoolId).set(as(who));
        expect([who, res.status, res.body.error?.code]).toEqual([who, 403, 'ACCESS_PAUSED']);
        expect(res.body.error.message).toBe('Your access to this School has been paused. Please contact the School owner.');
      }
    });

    it.each(gated)('%s: members, former members and staff, and Guardians are told they have no permission', async (_name, call) => {
      for (const who of ['ana', 'formerMember', 'removedStaff', 'parent']) {
        const res = await call(schoolId).set(as(who));
        expect([who, res.status, res.body.error?.code]).toEqual([who, 403, 'NO_PERMISSION']);
        expect(res.body.error.message).toBe("You don't have permission to view this page.");
      }
    });

    it.each(gated)('%s: someone with no link to the School, and an unknown School, still get 404', async (_name, call) => {
      for (const who of ['otherOwner', 'stranger']) {
        const res = await call(schoolId).set(as(who));
        expect([who, res.status]).toEqual([who, 404]);
        expect(JSON.stringify(res.body)).not.toContain('acct_d449_');
      }
      // Not even a Guardian, paused staff or a member learns about another School.
      for (const who of ['parent', 'pausedStaff', 'ana']) {
        expect([who, (await call(otherSchoolId).set(as(who))).status]).toEqual([who, 404]);
        expect([who, (await call(randomUUID()).set(as(who))).status]).toEqual([who, 404]);
      }
    });

    it('staff refused by a switch keep their own message', async () => {
      const payroll = await http().get(`/v1/schools/${schoolId}/payroll/report`).set(as('staffOn'));
      expect(payroll.status).toBe(403);
      expect(payroll.body.error.code).toBe('STAFF_ACCESS_OFF');
      const coach = await http().get(`/v1/schools/${schoolId}/payroll/report`).set(as('coach'));
      expect(coach.status).toBe(403);
      expect(coach.body.error.code).toBe('NOT_FOR_COACHES');
    });

    it('the payment account: staff without a payments permission and coaches are told they have no permission; the record stays hidden', async () => {
      for (const who of ['staffNoPay', 'coach']) {
        const res = await http().get(`/v1/schools/${schoolId}/payment-account`).set(as(who));
        expect([who, res.status, res.body.error?.code]).toEqual([who, 403, 'NO_PERMISSION']);
        expect(JSON.stringify(res.body)).not.toContain('acct_d449_');
      }
      const ok = await http().get(`/v1/schools/${schoolId}/payment-account`).set(as('staffOn'));
      expect(ok.status).toBe(200);
      expect(ok.body.stripeConnectedAccountId).toMatch(/^acct_d449_/);
    });

    it('an unpaused staff member is let back in at once', async () => {
      await superuser.roleGrant.updateMany({ where: { userId: users.pausedStaff.id, schoolId }, data: { revokedAt: null, pausedAt: null } });
      try {
        const res = await http().get(`/v1/schools/${schoolId}/payroll/report`).set(as('pausedStaff'));
        expect(res.body.error?.code).toBe('STAFF_ACCESS_OFF');
      } finally {
        const now = new Date();
        await superuser.roleGrant.updateMany({ where: { userId: users.pausedStaff.id, schoolId }, data: { revokedAt: now, pausedAt: now } });
      }
    });
  });

  describe('item 7: a coach can be given "Manage students"', () => {
    const edit = (who: string, studentId = users.ana.id) =>
      http().patch(`/v1/schools/${schoolId}/students/${studentId}/profile`).set(as(who)).send({ nationality: 'BR' });
    const setCoach = (who: string, userId: string, manageStudents: boolean) =>
      http().put(`/v1/schools/${schoolId}/staff/${userId}/coach-access`).set(as(who)).send({ manageStudents });
    const myAccess = (who: string) => http().get(`/v1/schools/${schoolId}/staff/me/access`).set(as(who));
    const listed = async (userId: string) =>
      (await http().get(`/v1/schools/${schoolId}/staff`).set(as('main'))).body.items.find((p: { userId: string }) => p.userId === userId);

    it('is off by default: the coach is refused as a coach', async () => {
      const res = await edit('coach');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NOT_FOR_COACHES');
      expect((await myAccess('coach')).body).toMatchObject({ editStudents: false });
      expect(await listed(users.coach.id)).toMatchObject({ coachAccess: { manageStudents: false }, access: null });
    });

    it('only the main owner sets it', async () => {
      const coOwner = await setCoach('coOwner', users.coach.id, true);
      expect(coOwner.status).toBe(403);
      expect(coOwner.body.error.code).toBe('STAFF_SWITCHES_MAIN_OWNER_ONLY');
      for (const who of ['staffOn', 'coach', 'otherOwner']) expect([who, (await setCoach(who, users.coach.id, true)).status]).toEqual([who, 403]);
      expect((await edit('coach')).status).toBe(403);
    });

    it('is for coaches only', async () => {
      const res = await setCoach('main', users.staffOn.id, true);
      expect(res.status).toBe(400);
      expect((await setCoach('main', users.ana.id, true)).status).toBe(400);
    });

    it('once given, the coach edits their own branches\' students, and staff/me/access says so', async () => {
      const res = await setCoach('main', users.coach.id, true);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: users.coach.id, coachAccess: { manageStudents: true } });
      expect((await edit('coach')).status).toBe(200);
      expect((await myAccess('coach')).body).toMatchObject({ editStudents: true });
      expect(await listed(users.coach.id)).toMatchObject({ coachAccess: { manageStudents: true } });
      // Logged, like the other switches.
      const logged = await superuser.staffActivity.findFirst({ where: { schoolId, targetUserId: users.coach.id, action: 'ACCESS_CHANGED' } });
      expect(logged?.details).toEqual({ changes: [{ switch: 'coachManageStudents', on: true }] });
      // A coach at another branch with it on still doesn't cover this student.
      expect((await setCoach('main', users.southCoach.id, true)).status).toBe(200);
      expect((await edit('southCoach')).status).toBe(403);
      // The birth date rule for staff (Decision 342) still applies: only an owner turns an adult into a child.
      const dob = await http().patch(`/v1/schools/${schoolId}/students/${users.ana.id}/profile`).set(as('coach')).send({ dateOfBirth: '2015-01-01' });
      expect(dob.status).toBe(403);
    });

    it('taken away, or the coach role removed, it is off again', async () => {
      expect((await setCoach('main', users.coach.id, false)).status).toBe(200);
      expect((await edit('coach')).status).toBe(403);
      expect((await setCoach('main', users.coach.id, true)).status).toBe(200);
      const removed = await http().post(`/v1/schools/${schoolId}/staff/${users.coach.id}/remove`).set(as('main')).send({});
      expect(removed.status).toBe(201);
      const row = await superuser.staffPermission.findUnique({ where: { schoolId_userId: { schoolId, userId: users.coach.id } } });
      expect(row?.canManageStudentsAsCoach).toBe(false);
    });
  });
});
