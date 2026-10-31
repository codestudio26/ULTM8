/**
 * Students → Import (Decision 315 items 12 and 13; backlog 5.13) over real HTTP:
 * - members: a preview changes nothing; adults are made as Add manually
 *   makes them (temporary passcode, home branch, belts through grading); a
 *   row whose email already has an account is skipped and listed; a child is
 *   added with their Guardian's email (new Guardian: an account; existing
 *   Guardian: an invite to accept); gender Female/Male/empty only;
 * - memberships: recorded against the School's own plans, no money moves, a
 *   Subscription is refused;
 * - past attendance: logged as "Log attendance" does, 30 days back, never twice;
 * - a batch sent again returns the same results and imports nothing twice;
 * - the owner, and Branch Staff with "Import data" for their own branches;
 * - no School's import reaches another School's students, plans or classes.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { Queue } from 'bullmq';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.JWT_ACCESS_SECRET && process.env.QR_CLASS_TOKEN_SECRET && process.env.QR_STUDENT_TOKEN_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[data-imports.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const ACCESS_DEFAULTS = {
  classes: false, bookings: true, students: true, cancelClasses: true, staffList: false, inviteCoaches: false,
  disciplines: false, checkInRules: false, exportStudents: false, freezeMemberships: false, attendanceStats: false, memberFiles: false, importData: false,
};

type Row = Record<string, string>;

describeIfDb('Spreadsheet imports (Decision 315 items 12, 13)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  const tag = `imports-${randomUUID().slice(0, 8)}`;
  const http = () => request(app.getHttpServer());
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  let sent: Array<{ to: string; subject: string; body: string }> = [];

  let school: string;
  let otherSchool: string;
  let main: string;
  let other: string;
  let bjj: string;
  let white0: string;
  let blue0: string;
  let packPlan: string;

  const as = (who: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${tokens[who]}`),
    put: (url: string) => http().put(url).set('Authorization', `Bearer ${tokens[who]}`),
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const rowsOf = (rows: Row[]) => rows.map((values, i) => ({ rowNumber: i + 2, values }));
  const preview = (who: string, kind: string, rows: Row[], schoolId = school) => as(who).post(`/v1/schools/${schoolId}/imports/preview`).send({ kind, rows: rowsOf(rows) });
  /** Starts an import and sends all its rows in one batch. */
  async function runImport(who: string, kind: string, rows: Row[], schoolId = school) {
    const started = await as(who).post(`/v1/schools/${schoolId}/imports`).send({ kind, totalRows: rows.length, fileName: `${kind}.csv` });
    expect(started.status).toBe(201);
    const res = await as(who).post(`/v1/schools/${schoolId}/imports/${started.body.id}/rows`).send({ rows: rowsOf(rows) });
    return { importId: started.body.id as string, res };
  }
  const setAccess = (who: string, access: Partial<typeof ACCESS_DEFAULTS>) =>
    as('owner').put(`/v1/schools/${school}/staff/${users[who].id}/access`).send({ ...ACCESS_DEFAULTS, ...access });
  const email = (label: string) => `${tag}-${label}@example.test`.toLowerCase();

  async function person(label: string, grants: Array<{ role: 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT'; schoolId: string; branchId?: string | null }>, dateOfBirth = '1985-01-01') {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: email(label),
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Import',
        passcodeHash: 'x',
        dateOfBirth: new Date(dateOfBirth),
        phoneVerifiedAt: new Date(),
      },
    });
    users[label] = { id: u.id, email: u.email };
    for (const g of grants) {
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: g.role, userId: u.id, schoolId: g.schoolId, branchId: g.branchId ?? null, isMainOwner: g.role === 'SCHOOL_OWNER_MANAGER' } });
    }
    tokens[label] = jwt.sign({ sub: u.id, email: u.email, grants: grants.map((g) => ({ role: g.role, franchiseId: null, schoolId: g.schoolId, branchId: g.branchId ?? null })) });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    jest.spyOn(Queue.prototype, 'add').mockResolvedValue(undefined as never);
    jest.spyOn(NotificationDeliveryService.prototype, 'sendEmail').mockImplementation(async (to: string, subject: string, body: string) => {
      sent.push({ to, subject, body });
    });

    school = (await superuser.school.create({ data: { id: randomUUID(), name: `${tag} Dojo`, timezone: 'UTC', ranksToggle: true } })).id;
    otherSchool = (await superuser.school.create({ data: { id: randomUUID(), name: `${tag} Other Dojo`, timezone: 'UTC', ranksToggle: true } })).id;
    main = (await superuser.branch.create({ data: { id: randomUUID(), schoolId: school, name: 'Main' } })).id;
    other = (await superuser.branch.create({ data: { id: randomUUID(), schoolId: school, name: 'Other' } })).id;

    await person('owner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: school }]);
    await person('staff', [{ role: 'BRANCH_STAFF', schoolId: school, branchId: main }]);
    await person('coach', [{ role: 'INSTRUCTOR', schoolId: school, branchId: main }]);
    await person('ana', [{ role: 'STUDENT', schoolId: school }]);
    await person('bob', [{ role: 'STUDENT', schoolId: school }]);
    await person('otherOwner', [{ role: 'SCHOOL_OWNER_MANAGER', schoolId: otherSchool }]);
    await person('otherStudent', [{ role: 'STUDENT', schoolId: otherSchool }]);
    await person('existingGuardian', []);
    await superuser.studentHomeBranch.createMany({
      data: [
        { id: randomUUID(), schoolId: school, studentId: users.ana.id, branchId: main },
        { id: randomUUID(), schoolId: school, studentId: users.bob.id, branchId: other },
      ],
    });

    bjj = (await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school, name: 'BJJ', classTypesOffered: [] } })).id;
    const white = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj, schoolId: school, order: 0, name: 'White', primaryColour: '#FFFFFF' } });
    const blue = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj, schoolId: school, order: 1, name: 'Blue', primaryColour: '#0000FF' } });
    white0 = (await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: white.id, schoolId: school, order: 0, count: 0, colour: '#000', name: 'White 0', classesRequired: 40 } })).id;
    blue0 = (await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: blue.id, schoolId: school, order: 0, count: 0, colour: '#000', name: 'Blue 0', classesRequired: 40 } })).id;
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: users.ana.id, disciplineId: bjj, schoolId: school, currentRankId: white.id, currentStripeId: white0, dateOfCurrentRank: new Date('2026-01-01'), countingSince: new Date('2026-01-01') },
    });

    packPlan = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school, type: 'CLASS_PACK', title: '10 Class Pack', price: 10000, classesIncluded: 10 } })).id;
    await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school, type: 'SUBSCRIPTION', title: 'Monthly', price: 5000 } });
    // The same plan name at the other School.
    await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: otherSchool, type: 'CLASS_PACK', title: '10 Class Pack', price: 10000, classesIncluded: 10 } });
  });

  afterAll(async () => {
    const schoolIds = [school, otherSchool];
    const made = await superuser.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } });
    const minors = await superuser.guardianLink.findMany({ where: { guardianId: { in: made.map((m) => m.id) } }, select: { studentId: true } });
    const all = [...new Set([...made.map((m) => m.id), ...minors.map((m) => m.studentId)])];
    await superuser.dataImport.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.childInvite.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.trainingLog.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.booking.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membership.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.class.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.promotionEvent.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentRank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.rank.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.discipline.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.waiverSignature.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffActivity.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.notification.deleteMany({ where: { userId: { in: all } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: all } } });
    await superuser.guardianLink.deleteMany({ where: { OR: [{ guardianId: { in: all } }, { studentId: { in: all } }] } });
    await superuser.refreshToken.deleteMany({ where: { userId: { in: all } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: all } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  beforeEach(() => {
    sent = [];
  });

  describe('members', () => {
    const adult = (label: string, over: Row = {}): Row => ({
      first_name: label, last_name: 'Imported', email: email(label), phone: '+44 7911 123456', date_of_birth: '1990-05-06', gender: 'Female', join_date: '2024-02-01', belts: 'bjj: blue', branch: 'main', ...over,
    });

    it('the preview checks every row and changes nothing', async () => {
      const res = await preview('owner', 'MEMBERS', [
        adult('pAdult'),
        adult('pDup', { email: email('pAdult') }),
        adult('pExisting', { email: users.ana.email }),
        adult('pGender', { gender: 'Other' }),
        adult('pStyle', { belts: 'Karate: Blue' }),
        adult('pBelt', { belts: 'BJJ: Purple' }),
        adult('pBranch', { branch: '' }),
        adult('pFuture', { join_date: '2999-01-01' }),
        { first_name: 'Kid', last_name: 'New', date_of_birth: '2016-03-04', gender: '', branch: 'Main', guardian_email: email('pNewGuardian'), guardian_first_name: 'Gia', guardian_last_name: 'New' },
        { first_name: 'Kid', last_name: 'Known', date_of_birth: '2016-03-04', branch: 'Main', email: users.existingGuardian.email },
        { first_name: 'Kid', last_name: 'NoName', date_of_birth: '2016-03-04', branch: 'Main', guardian_email: email('pNoName') },
      ]);
      expect(res.status).toBe(201);
      const by = (n: number) => res.body.rows.find((r: { rowNumber: number }) => r.rowNumber === n);
      expect(by(2)).toMatchObject({ outcome: 'READY', code: 'NEW_MEMBER' });
      expect(by(3)).toMatchObject({ outcome: 'SKIPPED', code: 'DUPLICATE_IN_FILE' });
      expect(by(4)).toMatchObject({ outcome: 'SKIPPED', code: 'EMAIL_EXISTS', column: 'email' });
      expect(by(5)).toMatchObject({ outcome: 'ERROR', code: 'INVALID_GENDER', column: 'gender' });
      expect(by(6)).toMatchObject({ outcome: 'ERROR', code: 'UNKNOWN_STYLE' });
      expect(by(7)).toMatchObject({ outcome: 'ERROR', code: 'UNKNOWN_BELT' });
      expect(by(8)).toMatchObject({ outcome: 'ERROR', code: 'BRANCH_REQUIRED' });
      expect(by(9)).toMatchObject({ outcome: 'ERROR', code: 'FUTURE_DATE' });
      expect(by(10)).toMatchObject({ outcome: 'READY', code: 'NEW_CHILD_NEW_GUARDIAN' });
      expect(by(11)).toMatchObject({ outcome: 'READY', code: 'NEW_CHILD_GUARDIAN_INVITED' });
      expect(by(12)).toMatchObject({ outcome: 'ERROR', code: 'GUARDIAN_NAME_REQUIRED' });
      expect(res.body.counts).toEqual({ ok: 3, skipped: 2, errors: 6 });
      expect(await superuser.user.count({ where: { email: { in: [email('pAdult'), email('pNewGuardian')] } } })).toBe(0);
      expect(sent).toHaveLength(0);
    });

    it('imports adults as Add manually does, children with their Guardian, and skips an email that has an account', async () => {
      const { importId, res } = await runImport('owner', 'MEMBERS', [
        adult('mAdult'),
        adult('mExisting', { email: users.ana.email }),
        { first_name: 'Kit', last_name: 'Young', date_of_birth: '2016-03-04', gender: 'male', branch: 'Main', guardian_email: email('mGuardian'), guardian_first_name: 'Gwen', guardian_last_name: 'Young', belts: 'BJJ: White' },
        { first_name: 'Kim', last_name: 'Known', date_of_birth: '2015-07-08', branch: 'Other', email: users.existingGuardian.email, join_date: '2023-09-01' },
      ]);
      expect(res.status).toBe(201);
      expect(res.body.rows.map((r: { outcome: string; code: string }) => [r.outcome, r.code])).toEqual([
        ['CREATED', 'NEW_MEMBER'],
        ['SKIPPED', 'EMAIL_EXISTS'],
        ['CREATED', 'NEW_CHILD_NEW_GUARDIAN'],
        ['CREATED', 'NEW_CHILD_GUARDIAN_INVITED'],
      ]);

      // The adult: a temporary passcode, enrolled at Main, Blue in BJJ; the
      // phone kept with the import, not on the account.
      const made = await superuser.user.findUniqueOrThrow({ where: { email: email('mAdult') } });
      expect(made).toMatchObject({ mustChangePasscode: true, temporaryPasscodeSchoolId: school, gender: 'FEMALE', phone: null });
      expect(await superuser.roleGrant.count({ where: { userId: made.id, schoolId: school, role: 'STUDENT', revokedAt: null } })).toBe(1);
      expect((await superuser.studentHomeBranch.findFirstOrThrow({ where: { studentId: made.id, schoolId: school } })).branchId).toBe(main);
      expect((await superuser.studentRank.findFirstOrThrow({ where: { studentId: made.id, disciplineId: bjj } })).currentStripeId).toBe(blue0);
      expect(sent.find((m) => m.to === email('mAdult'))?.body).toMatch(/Temporary passcode: \d{6}/);
      const kept = await superuser.dataImportRow.findUniqueOrThrow({ where: { importId_rowNumber: { importId, rowNumber: 2 } } });
      expect(kept).toMatchObject({ studentId: made.id, phone: '+447911123456' });
      // Decision 315 item 4: the join date given, on StudentJoinDate as Add manually sets it.
      expect((await superuser.studentJoinDate.findFirstOrThrow({ where: { studentId: made.id, schoolId: school } })).joinedOn.toISOString().slice(0, 10)).toBe('2024-02-01');

      // A new Guardian: their account (temporary passcode), the child linked and enrolled, with the belt.
      const guardian = await superuser.user.findUniqueOrThrow({ where: { email: email('mGuardian') } });
      expect(guardian.mustChangePasscode).toBe(true);
      const link = await superuser.guardianLink.findFirstOrThrow({ where: { guardianId: guardian.id } });
      expect(await superuser.roleGrant.count({ where: { userId: link.studentId, schoolId: school, role: 'STUDENT', revokedAt: null } })).toBe(1);
      expect((await superuser.studentRank.findFirstOrThrow({ where: { studentId: link.studentId, disciplineId: bjj } })).currentStripeId).toBe(white0);

      // An existing Guardian: an invite to accept in the app, nothing enrolled yet.
      const invite = await superuser.childInvite.findFirstOrThrow({ where: { guardianId: users.existingGuardian.id, schoolId: school } });
      expect(invite).toMatchObject({ status: 'PENDING', childFirstName: 'Kim', branchId: other });
      expect(invite.joinedOn?.toISOString().slice(0, 10)).toBe('2023-09-01');
      expect(await superuser.guardianLink.count({ where: { guardianId: users.existingGuardian.id } })).toBe(0);

      // Sent again (a retry): the same results, nothing made twice, no more emails.
      sent = [];
      const again = await as('owner').post(`/v1/schools/${school}/imports/${importId}/rows`).send({
        rows: rowsOf([adult('mAdult'), adult('mExisting', { email: users.ana.email })]),
      });
      expect(again.status).toBe(201);
      expect(again.body.rows.map((r: { code: string }) => r.code)).toEqual(['NEW_MEMBER', 'EMAIL_EXISTS']);
      expect(await superuser.user.count({ where: { email: email('mAdult') } })).toBe(1);
      expect(sent).toHaveLength(0);

      const summary = await as('owner').get(`/v1/schools/${school}/imports/${importId}`);
      expect(summary.status).toBe(200);
      expect(summary.body).toMatchObject({ kind: 'MEMBERS', totalRows: 4, rowsDone: 4, counts: { ok: 3, skipped: 1, errors: 0 } });

      // A new import of the same file: the adult is now an existing email.
      const second = await runImport('owner', 'MEMBERS', [adult('mAdult')]);
      expect(second.res.body.rows[0]).toMatchObject({ outcome: 'SKIPPED', code: 'EMAIL_EXISTS' });
    });

    it('caps the rows of an import and of a request', async () => {
      const big = await as('owner').post(`/v1/schools/${school}/imports`).send({ kind: 'MEMBERS', totalRows: 2001 });
      expect(big.status).toBe(400);
      const many = await as('owner').post(`/v1/schools/${school}/imports/preview`).send({ kind: 'MEMBERS', rows: Array.from({ length: 101 }, (_, i) => ({ rowNumber: i + 2, values: {} })) });
      expect(many.status).toBe(400);
      const { importId } = await runImport('owner', 'MEMBERS', [adult('capOne')]);
      const beyond = await as('owner').post(`/v1/schools/${school}/imports/${importId}/rows`).send({ rows: [{ rowNumber: 3, values: adult('capTwo') }] });
      expect(beyond.status).toBe(400);
    });
  });

  describe('memberships', () => {
    it('records a plan of this School with its dates and no payment; refuses a Subscription and anyone not a student here', async () => {
      const { importId, res } = await runImport('owner', 'MEMBERSHIPS', [
        { email: users.ana.email, plan: '10 class pack', start_date: '2026-09-01', end_date: '2099-12-31', classes_left: '6' },
        { email: users.ana.email, plan: 'Monthly', start_date: '2026-09-01' },
        { email: users.ana.email, plan: 'Gold', start_date: '2026-09-01' },
        { email: users.otherStudent.email, plan: '10 Class Pack', start_date: '2026-09-01' },
        { email: users.ana.email, plan: '10 Class Pack', start_date: '2026-09-01', end_date: '2026-08-01' },
      ]);
      expect(res.status).toBe(201);
      expect(res.body.rows.map((r: { code: string }) => r.code)).toEqual(['NEW_MEMBERSHIP', 'PLAN_IS_SUBSCRIPTION', 'UNKNOWN_PLAN', 'NOT_A_MEMBER', 'END_BEFORE_START']);
      const kept = await superuser.dataImportRow.findUniqueOrThrow({ where: { importId_rowNumber: { importId, rowNumber: 2 } } });
      const membership = await superuser.membership.findUniqueOrThrow({ where: { id: kept.membershipId! } });
      expect(membership).toMatchObject({ studentId: users.ana.id, schoolId: school, membershipPlanId: packPlan, classesRemaining: 6, frequency: 'ONE_TIME', status: 'ACTIVE' });
      expect(membership.startDate.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      expect(membership.expiryDate?.toISOString()).toBe('2100-01-01T00:00:00.000Z');
      expect(await superuser.transaction.count({ where: { membershipId: membership.id } })).toBe(0);
      // Nothing for the other School's student.
      expect(await superuser.membership.count({ where: { studentId: users.otherStudent.id } })).toBe(0);

      // The same membership again, in a new import: skipped.
      const again = await runImport('owner', 'MEMBERSHIPS', [{ email: users.ana.email, plan: '10 Class Pack', start_date: '2026-09-01' }]);
      expect(again.res.body.rows[0]).toMatchObject({ outcome: 'SKIPPED', code: 'ALREADY_IMPORTED' });
      expect(await superuser.membership.count({ where: { studentId: users.ana.id, membershipPlanId: packPlan } })).toBe(1);
    });
  });

  describe('past attendance', () => {
    it('logs a class as "Log attendance" does (a Class Pack credit, the grading count), 30 days back, never twice', async () => {
      const start = DateTime.utc().minus({ days: 3 }).set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
      const cls = await superuser.class.create({
        data: { id: randomUUID(), schoolId: school, branchId: main, title: 'Fundamentals', membershipInclusion: true, styles: [{ disciplineId: bjj, classType: null }], startDate: start.toJSDate(), endDate: start.plus({ hours: 1 }).toJSDate() },
      });
      const old = DateTime.utc().minus({ days: 40 }).set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
      await superuser.class.create({
        data: { id: randomUUID(), schoolId: school, branchId: main, title: 'Fundamentals', membershipInclusion: true, styles: [], startDate: old.toJSDate(), endDate: old.plus({ hours: 1 }).toJSDate() },
      });
      const pack = await superuser.membership.findFirstOrThrow({ where: { studentId: users.ana.id, membershipPlanId: packPlan } });
      const before = (await superuser.studentRank.findFirstOrThrow({ where: { studentId: users.ana.id, disciplineId: bjj } })).classesAttendedTowardCheckpoint;

      const row = { email: users.ana.email, date: start.toISODate()!, time: '18:00', class: 'fundamentals' };
      const { importId, res } = await runImport('owner', 'ATTENDANCE', [
        row,
        { ...row },
        { email: users.ana.email, date: old.toISODate()!, time: '18:00', class: 'Fundamentals' },
        { email: users.ana.email, date: start.toISODate()!, time: '19:00', class: 'Fundamentals' },
      ]);
      expect(res.status).toBe(201);
      expect(res.body.rows.map((r: { code: string }) => r.code)).toEqual(['NEW_ATTENDANCE', 'DUPLICATE_IN_FILE', 'OUT_OF_RANGE', 'UNKNOWN_CLASS']);
      const booking = await superuser.booking.findFirstOrThrow({ where: { studentId: users.ana.id, classId: cls.id } });
      expect(booking).toMatchObject({ status: 'COMPLETED', checkInMethod: 'STAFF_LOGGED', checkedInById: users.owner.id, sourceMembershipId: pack.id });
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: pack.id } })).classesRemaining).toBe(pack.classesRemaining! - 1);
      expect((await superuser.studentRank.findFirstOrThrow({ where: { studentId: users.ana.id, disciplineId: bjj } })).classesAttendedTowardCheckpoint).toBe(before + 1);

      // Sent again, and imported again: never counted twice.
      const retry = await as('owner').post(`/v1/schools/${school}/imports/${importId}/rows`).send({ rows: rowsOf([row]) });
      expect(retry.body.rows[0]).toMatchObject({ outcome: 'CREATED', code: 'NEW_ATTENDANCE' });
      const again = await runImport('owner', 'ATTENDANCE', [row]);
      expect(again.res.body.rows[0]).toMatchObject({ outcome: 'SKIPPED', code: 'ALREADY_ATTENDED' });
      expect(await superuser.booking.count({ where: { studentId: users.ana.id, classId: cls.id } })).toBe(1);
      expect((await superuser.studentRank.findFirstOrThrow({ where: { studentId: users.ana.id, disciplineId: bjj } })).classesAttendedTowardCheckpoint).toBe(before + 1);
    });
  });

  describe('who may import', () => {
    it('Branch Staff need "Import data", and then only reach their own branch; a child stays the owner\'s; coaches never', async () => {
      const off = await preview('staff', 'MEMBERS', [{ first_name: 'S', last_name: 'One', email: email('sOne'), date_of_birth: '1990-01-01', branch: 'Main' }]);
      expect(off.status).toBe(403);
      expect(off.body.error.code).toBe('STAFF_ACCESS_OFF');
      expect((await as('coach').get(`/v1/schools/${school}/imports/limits`)).status).toBe(403);

      expect((await setAccess('staff', { importData: true })).status).toBe(200);
      const limits = await as('staff').get(`/v1/schools/${school}/imports/limits`);
      expect(limits.status).toBe(200);
      expect(limits.body).toMatchObject({ maxRows: 2000, maxRowsPerRequest: 100, attendanceMaxDaysBack: 30 });

      const { importId, res } = await runImport('staff', 'MEMBERS', [
        { first_name: 'S', last_name: 'One', email: email('sOne'), date_of_birth: '1990-01-01', branch: 'Main', belts: 'BJJ: White' },
        { first_name: 'S', last_name: 'Two', email: email('sTwo'), date_of_birth: '1990-01-01', branch: 'Other' },
        { first_name: 'S', last_name: 'Kid', date_of_birth: '2016-01-01', branch: 'Main', guardian_email: email('sGuardian'), guardian_first_name: 'G', guardian_last_name: 'S' },
      ]);
      expect(res.body.rows.map((r: { code: string }) => r.code)).toEqual(['NEW_MEMBER', 'NOT_YOUR_BRANCH', 'CHILD_OWNER_ONLY']);
      // No grading permission for BJJ: the member is made, the belt is not.
      expect(res.body.rows[0].warnings.map((w: { code: string }) => w.code)).toContain('BELT_NOT_SET');
      const made = await superuser.user.findUniqueOrThrow({ where: { email: email('sOne') } });
      expect((await superuser.studentHomeBranch.findFirstOrThrow({ where: { studentId: made.id, schoolId: school } })).branchId).toBe(main);
      expect(await superuser.user.count({ where: { email: email('sTwo') } })).toBe(0);

      // Memberships: only their own branch's students.
      const ms = await runImport('staff', 'MEMBERSHIPS', [
        { email: users.bob.email, plan: '10 Class Pack', start_date: '2026-09-01' },
      ]);
      expect(ms.res.body.rows[0]).toMatchObject({ outcome: 'ERROR', code: 'NOT_YOUR_BRANCH' });

      // The owner sees the staff member's import; another staff member's import is theirs alone.
      expect((await as('owner').get(`/v1/schools/${school}/imports/${importId}`)).status).toBe(200);
    });

    it("never reaches another School: its owner can't read or add to this School's imports, and its rows only match its own students", async () => {
      const { importId } = await runImport('owner', 'MEMBERSHIPS', [{ email: users.bob.email, plan: '10 Class Pack', start_date: '2026-10-01' }]);
      const read = await as('otherOwner').get(`/v1/schools/${school}/imports/${importId}`);
      expect([403, 404]).toContain(read.status);
      const viaOwn = await as('otherOwner').get(`/v1/schools/${otherSchool}/imports/${importId}`);
      expect(viaOwn.status).toBe(404);
      const add = await as('otherOwner').post(`/v1/schools/${otherSchool}/imports/${importId}/rows`).send({ rows: rowsOf([{ email: users.ana.email, plan: '10 Class Pack', start_date: '2026-10-02' }]) });
      expect(add.status).toBe(404);
      expect([403, 404]).toContain((await preview('otherOwner', 'MEMBERSHIPS', [{ email: users.ana.email, plan: '10 Class Pack', start_date: '2026-10-02' }])).status);

      // In its own School, this School's student isn't a member there.
      const own = await runImport('otherOwner', 'MEMBERSHIPS', [{ email: users.ana.email, plan: '10 Class Pack', start_date: '2026-10-02' }], otherSchool);
      expect(own.res.body.rows[0]).toMatchObject({ outcome: 'ERROR', code: 'NOT_A_MEMBER' });
      expect(await superuser.membership.count({ where: { studentId: users.ana.id, schoolId: otherSchool } })).toBe(0);
    });
  });
});
