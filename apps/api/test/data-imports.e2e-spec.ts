/**
 * Students → Import (Decision 315 items 12 and 13; backlog 5.13) over real HTTP:
 * - members: a preview changes nothing; adults are made as Add manually
 *   makes them (temporary passcode, home branch, belts through grading); a
 *   row whose email already has an account is skipped and listed; a child is
 *   added with their Guardian's email (new Guardian: an account; existing
 *   Guardian: an invite to accept); gender Female/Male/empty only;
 * - memberships: recorded against the School's own plans, no money moves, a
 *   Subscription is refused;
 * - past attendance (Decision 422 item 6): of any age, never in the future or
 *   before 1900, never twice; it counts toward belt progress by grading's own
 *   rules, uses no pack or class credit and needs no membership;
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
  classes: false, bookings: true, students: true, cancelClasses: true, staffList: false,
  disciplines: false, checkInRules: false, exportStudents: false, freezeMemberships: false, attendanceStats: false, memberFiles: false, importData: false, seeMedicalInfo: false, payroll: false,
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
  let judo: string;
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
    // Past attendance of any age (Decision 422 item 6): Cara has been a white
    // belt since 2010, so years of classes count; Dan has no membership; Eve
    // takes the large import.
    await person('cara', [{ role: 'STUDENT', schoolId: school }]);
    await person('dan', [{ role: 'STUDENT', schoolId: school }]);
    await person('eve', [{ role: 'STUDENT', schoolId: school }]);
    for (const label of ['cara', 'eve']) {
      await superuser.studentRank.create({
        data: { id: randomUUID(), studentId: users[label].id, disciplineId: bjj, schoolId: school, currentRankId: white.id, currentStripeId: white0, dateOfCurrentRank: new Date('2010-01-01'), countingSince: new Date('2010-01-01') },
      });
    }
    // Judo: Yellow counts Gi classes only, at most one a week.
    judo = (await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school, name: 'Judo', classTypesOffered: ['Gi', 'No-Gi'] } })).id;
    const judoWhite = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: judo, schoolId: school, order: 0, name: 'White', primaryColour: '#FFFFFF' } });
    const judoYellow = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: judo, schoolId: school, order: 1, name: 'Yellow', primaryColour: '#FFFF00' } });
    const judoWhite0 = (await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: judoWhite.id, schoolId: school, order: 0, count: 0, colour: '#000', name: 'White 0', classesRequired: 40 } })).id;
    await superuser.rankStripeTier.create({
      data: { id: randomUUID(), rankId: judoYellow.id, schoolId: school, order: 0, count: 0, colour: '#000', name: 'Yellow 0', classesRequired: 40, eligibleClassTypes: ['Gi'], weeklyClassCountCap: 1 },
    });
    await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: users.cara.id, disciplineId: judo, schoolId: school, currentRankId: judoWhite.id, currentStripeId: judoWhite0, dateOfCurrentRank: new Date('2010-01-01'), countingSince: new Date('2010-01-01') },
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
      // Decision 423: past attendance allows 10,000 rows per file; the others stay at 2,000.
      expect((await as('owner').post(`/v1/schools/${school}/imports`).send({ kind: 'MEMBERSHIPS', totalRows: 2001 })).status).toBe(400);
      expect((await as('owner').post(`/v1/schools/${school}/imports`).send({ kind: 'ATTENDANCE', totalRows: 10_001 })).status).toBe(400);
      const long = await as('owner').post(`/v1/schools/${school}/imports`).send({ kind: 'ATTENDANCE', totalRows: 10_000 });
      expect(long.status).toBe(201);
      // Its last rows can be sent (row 10,001 is the file's last line).
      const last = await as('owner').post(`/v1/schools/${school}/imports/${long.body.id}/rows`).send({ rows: [{ rowNumber: 10_001, values: { email: users.ana.email, date: '2020-01-01', time: '07:00', class: 'None' } }] });
      expect(last.status).toBe(201);
      expect(last.body.rows[0]).toMatchObject({ rowNumber: 10_001, code: 'UNKNOWN_CLASS' });
      const limits = await as('owner').get(`/v1/schools/${school}/imports/limits`);
      expect(limits.body).toMatchObject({ maxRows: 2000, maxRowsPerRequest: 100, maxRowsByKind: { MEMBERS: 2000, MEMBERSHIPS: 2000, ATTENDANCE: 10_000 } });
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
    /** A class of this School (or another): `daysAgo` days back at 18:00 UTC, or at `when`. */
    async function pastClass(when: number | DateTime, opts: { schoolId?: string; branchId?: string | null; title?: string; styles?: Array<{ disciplineId: string; classType: string | null }>; capacity?: number } = {}) {
      const start = (typeof when === 'number' ? DateTime.utc().minus({ days: when }) : when).set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
      const cls = await superuser.class.create({
        data: {
          id: randomUUID(),
          schoolId: opts.schoolId ?? school,
          branchId: opts.branchId === undefined ? main : opts.branchId,
          title: opts.title ?? 'Fundamentals',
          membershipInclusion: true,
          capacity: opts.capacity ?? null,
          styles: opts.styles ?? [{ disciplineId: bjj, classType: null }],
          startDate: start.toJSDate(),
          endDate: start.plus({ hours: 1 }).toJSDate(),
        },
      });
      return { cls, row: (who: { email: string }, over: Row = {}): Row => ({ email: who.email, date: start.toISODate()!, time: '18:00', class: cls.title, ...over }) };
    }
    const rankOf = (studentId: string, disciplineId = bjj) => superuser.studentRank.findFirstOrThrow({ where: { studentId, disciplineId } });

    it('imports visits from two and ten years ago: they count toward belt progress, use no credit and need no membership', async () => {
      // A pack with credits left; a student with no membership at all.
      const pack = await superuser.membership.create({
        data: { id: randomUUID(), studentId: users.cara.id, schoolId: school, membershipPlanId: packPlan, frequency: 'ONE_TIME', startDate: new Date('2024-01-01'), classesRemaining: 5 },
      });
      const twoYears = await pastClass(730);
      const fortyDays = await pastClass(40);
      const recent = await pastClass(3);
      const tenYears = await pastClass(3653);
      const before = (await rankOf(users.cara.id)).classesAttendedTowardCheckpoint;

      const { importId, res } = await runImport('owner', 'ATTENDANCE', [
        twoYears.row(users.cara),
        fortyDays.row(users.cara),
        recent.row(users.cara),
        tenYears.row(users.cara),
        twoYears.row(users.dan),
      ]);
      expect(res.status).toBe(201);
      expect(res.body.rows.map((r: { outcome: string; code: string }) => [r.outcome, r.code])).toEqual(Array(5).fill(['CREATED', 'NEW_ATTENDANCE']));

      // Checked in, by the importer, funded by no membership.
      const bookings = await superuser.booking.findMany({ where: { studentId: { in: [users.cara.id, users.dan.id] }, classId: { in: [twoYears.cls.id, fortyDays.cls.id, recent.cls.id, tenYears.cls.id] } } });
      expect(bookings).toHaveLength(5);
      for (const b of bookings) expect(b).toMatchObject({ status: 'COMPLETED', checkInMethod: 'STAFF_LOGGED', checkedInById: users.owner.id, sourceMembershipId: null });
      const kept = await superuser.dataImportRow.findUniqueOrThrow({ where: { importId_rowNumber: { importId, rowNumber: 2 } } });
      expect(bookings.map((b) => b.id)).toContain(kept.bookingId);

      // No credits: the pack still has 5 classes; no new membership anywhere.
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: pack.id } })).classesRemaining).toBe(5);
      expect(await superuser.membership.count({ where: { studentId: users.dan.id } })).toBe(0);

      // Belt progress: all four of Cara's classes are after her last rank change (2010).
      expect((await rankOf(users.cara.id)).classesAttendedTowardCheckpoint).toBe(before + 4);
      // Hours trained: each class's length, as a check-in.
      expect(await superuser.trainingLog.count({ where: { studentId: users.cara.id, source: 'CHECK_IN', bookingId: { in: bookings.map((b) => b.id) } } })).toBe(4);
      // The student's progress, as staff see it on the student's grading page.
      const eligibility = await as('owner').get(`/v1/students/${users.cara.id}/eligibility?schoolId=${school}`);
      expect(eligibility.status).toBe(200);
      const bjjRow = eligibility.body.items.find((i: { disciplineId: string }) => i.disciplineId === bjj);
      expect(bjjRow.progressBreakdown.classes.counted).toBe(before + 4);
      // And on the Grading Board.
      const board = await as('owner').get(`/v1/schools/${school}/grading-board?disciplineId=${bjj}`);
      expect(board.status).toBe(200);
      const card = (board.body.items as Array<{ studentId: string; eligibility: { countedClasses?: number } }>).find((i) => i.studentId === users.cara.id);
      expect(card?.eligibility.countedClasses).toBe(before + 4);

      // Sent again, and imported again: never twice.
      const retry = await as('owner').post(`/v1/schools/${school}/imports/${importId}/rows`).send({ rows: rowsOf([twoYears.row(users.cara)]) });
      expect(retry.body.rows[0]).toMatchObject({ outcome: 'CREATED', code: 'NEW_ATTENDANCE' });
      const again = await runImport('owner', 'ATTENDANCE', [twoYears.row(users.cara)]);
      expect(again.res.body.rows[0]).toMatchObject({ outcome: 'SKIPPED', code: 'ALREADY_ATTENDED' });
      expect(await superuser.booking.count({ where: { studentId: users.cara.id, classId: twoYears.cls.id } })).toBe(1);
      expect((await rankOf(users.cara.id)).classesAttendedTowardCheckpoint).toBe(before + 4);
    });

    it('an existing booking for the class is checked in, not paid for again', async () => {
      const pack = await superuser.membership.create({
        data: { id: randomUUID(), studentId: users.dan.id, schoolId: school, membershipPlanId: packPlan, frequency: 'ONE_TIME', startDate: new Date('2026-01-01'), classesRemaining: 3 },
      });
      const { cls, row } = await pastClass(2);
      // Booked (its credit spent then) and marked No-Show by the sweep.
      const booked = await superuser.booking.create({ data: { id: randomUUID(), studentId: users.dan.id, classId: cls.id, schoolId: school, branchId: main, sourceMembershipId: pack.id, status: 'NO_SHOW' } });
      const { res } = await runImport('owner', 'ATTENDANCE', [row(users.dan)]);
      expect(res.body.rows[0]).toMatchObject({ outcome: 'CREATED', code: 'NEW_ATTENDANCE' });
      expect(await superuser.booking.findUniqueOrThrow({ where: { id: booked.id } })).toMatchObject({ status: 'COMPLETED', sourceMembershipId: pack.id, checkInMethod: 'STAFF_LOGGED' });
      expect(await superuser.booking.count({ where: { studentId: users.dan.id, classId: cls.id } })).toBe(1);
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: pack.id } })).classesRemaining).toBe(3);
    });

    it('refuses a future date, a date before 1900 and a date that does not exist', async () => {
      const tomorrow = DateTime.utc().plus({ days: 1 }).toISODate()!;
      const future = await superuser.class.create({
        data: { id: randomUUID(), schoolId: school, branchId: main, title: 'Tomorrow', membershipInclusion: true, styles: [], startDate: new Date(`${tomorrow}T18:00:00Z`), endDate: new Date(`${tomorrow}T19:00:00Z`) },
      });
      const res = await preview('owner', 'ATTENDANCE', [
        { email: users.cara.email, date: tomorrow, time: '18:00', class: future.title },
        { email: users.cara.email, date: '2999-01-01', time: '18:00', class: 'Fundamentals' },
        { email: users.cara.email, date: '1899-12-31', time: '18:00', class: 'Fundamentals' },
        { email: users.cara.email, date: '2025-02-30', time: '18:00', class: 'Fundamentals' },
        { email: users.cara.email, date: '20/10/2025', time: '18:00', class: 'Fundamentals' },
        { email: users.cara.email, date: '1900-01-01', time: '18:00', class: 'Fundamentals' },
      ]);
      expect(res.status).toBe(201);
      expect(res.body.rows.map((r: { code: string; column: string | null }) => [r.code, r.column])).toEqual([
        ['FUTURE_DATE', 'date'],
        ['FUTURE_DATE', 'date'],
        ['OUT_OF_RANGE', 'date'],
        ['INVALID_DATE', 'date'],
        ['INVALID_DATE', 'date'],
        // The earliest day itself is accepted: there is just no class then.
        ['UNKNOWN_CLASS', 'class'],
      ]);
      const limits = await as('owner').get(`/v1/schools/${school}/imports/limits`);
      expect(limits.body.attendanceEarliestDay).toBe('1900-01-01');
      expect(limits.body.attendanceMaxDaysBack).toBeUndefined();
    });

    it("respects the grading rules: only classes since the last rank change, the next rank's class types and its weekly cap", async () => {
      // Ana's last rank change was 1 Jan 2026: a class before it belongs to the previous rung.
      const beforeChange = await pastClass(DateTime.fromISO('2025-06-02T00:00:00Z', { zone: 'utc' }));
      const anaBefore = (await rankOf(users.ana.id)).classesAttendedTowardCheckpoint;
      // Judo: Yellow counts Gi classes only, at most 1 a week.
      const monday = DateTime.utc().minus({ days: 730 }).startOf('week');
      const judoClass = (when: DateTime, classType: string) => pastClass(when, { title: `Judo ${classType}`, styles: [{ disciplineId: judo, classType }] });
      const gi1 = await judoClass(monday, 'Gi');
      const gi2 = await judoClass(monday.plus({ days: 2 }), 'Gi');
      const noGi = await judoClass(monday.plus({ days: 3 }), 'No-Gi');
      const giNextWeek = await judoClass(monday.plus({ days: 8 }), 'Gi');
      const judoBefore = await rankOf(users.cara.id, judo);

      const { res } = await runImport('owner', 'ATTENDANCE', [
        beforeChange.row(users.ana),
        gi1.row(users.cara),
        gi2.row(users.cara),
        noGi.row(users.cara),
        giNextWeek.row(users.cara),
      ]);
      expect(res.body.rows.every((r: { code: string }) => r.code === 'NEW_ATTENDANCE')).toBe(true);
      // Imported, but before Ana's last rank change: it counts toward nothing.
      expect((await rankOf(users.ana.id)).classesAttendedTowardCheckpoint).toBe(anaBefore);
      // Gi only, one a week: the two Gi classes of the first week count once, No-Gi not at all.
      const judoAfter = await rankOf(users.cara.id, judo);
      expect(judoAfter.classesAttendedTowardCheckpoint).toBe(judoBefore.classesAttendedTowardCheckpoint + 2);
      expect(judoAfter.classesAttendedByType).toMatchObject({ Gi: 2 });
    });

    it('imports a large history in batches of 100 rows quickly, each class once', async () => {
      // 100 weekly classes going back two years, one batch.
      const classes: Array<Awaited<ReturnType<typeof pastClass>>> = [];
      for (let w = 1; w <= 100; w++) classes.push(await pastClass(7 * w + 1, { title: 'History', styles: [{ disciplineId: bjj, classType: null }] }));
      const before = (await rankOf(users.eve.id)).classesAttendedTowardCheckpoint;
      const started = Date.now();
      const checked = await preview('owner', 'ATTENDANCE', classes.map((c) => c.row(users.eve)));
      const previewMs = Date.now() - started;
      expect(checked.body.counts).toEqual({ ok: 100, skipped: 0, errors: 0 });
      const t = Date.now();
      const { res } = await runImport('owner', 'ATTENDANCE', classes.map((c) => c.row(users.eve)));
      const importMs = Date.now() - t;
      // eslint-disable-next-line no-console
      console.log(`[data-imports.e2e-spec] 100 attendance rows: preview ${previewMs} ms, import ${importMs} ms`);
      expect(res.status).toBe(201);
      expect(res.body.rows.filter((r: { code: string }) => r.code === 'NEW_ATTENDANCE')).toHaveLength(100);
      expect(importMs).toBeLessThan(30_000);
      expect((await rankOf(users.eve.id)).classesAttendedTowardCheckpoint).toBe(before + 100);
      // The ready-to-grade check: once for the student, not once per row.
      const readyChecks = (Queue.prototype.add as jest.Mock).mock.calls.filter(([name, data]) => name === 'ready-check' && (data as { studentId: string }).studentId === users.eve.id);
      expect(readyChecks).toHaveLength(1);
    });

    it("counts from the belt's own awarded date: a belt imported with a date two years ago counts later visits, not earlier ones (Decision 423)", async () => {
      const awarded = DateTime.utc().minus({ years: 2 }).toISODate()!;
      const members = await runImport('owner', 'MEMBERS', [
        { first_name: 'Gil', last_name: 'Dated', email: email('gil'), date_of_birth: '1990-01-01', branch: 'Main', belts: `BJJ: White (${awarded})` },
        { first_name: 'Hal', last_name: 'Dated', email: email('hal'), date_of_birth: '1990-01-01', branch: 'Main', belts: 'BJJ: White (2999-01-01)' },
        { first_name: 'Ivy', last_name: 'Dated', email: email('ivy'), date_of_birth: '1990-01-01', branch: 'Main', belts: 'BJJ: White (1/2/2024)' },
      ]);
      expect(members.res.body.rows.map((r: { code: string; column: string | null }) => [r.code, r.column])).toEqual([['NEW_MEMBER', null], ['FUTURE_DATE', 'belts'], ['INVALID_DATE', 'belts']]);
      const gil = await superuser.user.findUniqueOrThrow({ where: { email: email('gil') } });
      const rank = await rankOf(gil.id);
      // The belt's date is the one given; counting toward the next belt in ULTM8 began at the import.
      expect(rank.dateOfCurrentRank.toISOString().slice(0, 10)).toBe(awarded);
      expect(rank.countingSince.getTime()).toBeGreaterThan(Date.now() - 60 * 60_000);
      expect(rank.classesAttendedTowardCheckpoint).toBe(0);

      const beforeAward = await pastClass(DateTime.utc().minus({ years: 2, days: 10 }), { title: 'Dated' });
      const onAward = await pastClass(DateTime.fromISO(awarded, { zone: 'utc' }), { title: 'Dated' });
      const afterAward = await pastClass(DateTime.utc().minus({ years: 1 }), { title: 'Dated' });
      const { res } = await runImport('owner', 'ATTENDANCE', [beforeAward.row(gil), onAward.row(gil), afterAward.row(gil)]);
      expect(res.body.rows.map((r: { code: string }) => r.code)).toEqual(['NEW_ATTENDANCE', 'NEW_ATTENDANCE', 'NEW_ATTENDANCE']);
      // All three are logged as attended; only the two on or after the award day count.
      expect(await superuser.booking.count({ where: { studentId: gil.id, status: 'COMPLETED' } })).toBe(3);
      expect((await rankOf(gil.id)).classesAttendedTowardCheckpoint).toBe(2);
      const eligibility = await as('owner').get(`/v1/students/${gil.id}/eligibility?schoolId=${school}`);
      expect(eligibility.body.items.find((i: { disciplineId: string }) => i.disciplineId === bjj).progressBreakdown.classes.counted).toBe(2);
    });

    it('imports a long file in many batches of 100 with flat time per batch', async () => {
      // IMPORT_STRESS_ROWS=10000 runs a full-size file; the suite uses 500.
      const total = Number(process.env.IMPORT_STRESS_ROWS ?? 500);
      const students = 10;
      const perStudent = Math.ceil(total / students);
      const labels = Array.from({ length: students }, (_, i) => `stress${i}`);
      for (const label of labels) {
        await person(label, [{ role: 'STUDENT', schoolId: school }]);
        const white = await superuser.studentRank.findFirstOrThrow({ where: { studentId: users.cara.id, disciplineId: bjj } });
        await superuser.studentRank.create({
          data: { id: randomUUID(), studentId: users[label].id, disciplineId: bjj, schoolId: school, currentRankId: white.currentRankId, currentStripeId: white.currentStripeId, dateOfCurrentRank: new Date('2000-01-01'), countingSince: new Date('2000-01-01') },
        });
      }
      // One class a day at 07:00, going back far enough for every student.
      const days = Array.from({ length: perStudent }, (_, d) => DateTime.utc().minus({ days: d + 2 }).set({ hour: 7, minute: 0, second: 0, millisecond: 0 }));
      await superuser.class.createMany({
        data: days.map((start) => ({ id: randomUUID(), schoolId: school, branchId: main, title: 'Stress', membershipInclusion: true, styles: [{ disciplineId: bjj, classType: null }], startDate: start.toJSDate(), endDate: start.plus({ hours: 1 }).toJSDate() })),
      });
      const rows: Row[] = labels.flatMap((label) => days.map((start) => ({ email: users[label].email, date: start.toISODate()!, time: '07:00', class: 'Stress' }))).slice(0, total);

      const started = await as('owner').post(`/v1/schools/${school}/imports`).send({ kind: 'ATTENDANCE', totalRows: rows.length });
      expect(started.status).toBe(201);
      const times: number[] = [];
      const heapBefore = process.memoryUsage().heapUsed;
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100).map((values, j) => ({ rowNumber: i + j + 2, values }));
        const t = Date.now();
        const res = await as('owner').post(`/v1/schools/${school}/imports/${started.body.id}/rows`).send({ rows: batch });
        times.push(Date.now() - t);
        expect(res.status).toBe(201);
        expect(res.body.rows.every((r: { code: string }) => r.code === 'NEW_ATTENDANCE')).toBe(true);
      }
      const t = Date.now();
      const summary = await as('owner').get(`/v1/schools/${school}/imports/${started.body.id}`);
      const summaryMs = Date.now() - t;
      const heapMb = Math.round((process.memoryUsage().heapUsed - heapBefore) / 1e6);
      const first = times.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, times.length);
      const lastThree = times.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, times.length);
      // eslint-disable-next-line no-console
      console.log(`[data-imports.e2e-spec] ${rows.length} rows in ${times.length} batches: ${Math.round(times.reduce((a, b) => a + b, 0) / 1000)} s; first batches ${Math.round(first)} ms, last ${Math.round(lastThree)} ms; results ${summaryMs} ms; heap +${heapMb} MB`);
      expect(summary.body).toMatchObject({ totalRows: rows.length, rowsDone: rows.length, counts: { ok: rows.length, skipped: 0, errors: 0 } });
      expect(Math.max(...times)).toBeLessThan(30_000);
      // Each batch only looks at its own rows: later batches are not slower.
      expect(lastThree).toBeLessThan(first * 3 + 2000);
      expect(await superuser.booking.count({ where: { studentId: { in: labels.map((l) => users[l].id) }, status: 'COMPLETED', sourceMembershipId: null } })).toBe(rows.length);
    }, 30 * 60_000);

    it("never reaches another School: not its classes, not its students, and no class of this School from there", async () => {
      // The same title and time at both Schools; the other School's student.
      const here = await pastClass(400, { title: 'Twin' });
      const there = await pastClass(400, { title: 'Twin', schoolId: otherSchool, branchId: null, styles: [] });
      const { res } = await runImport('owner', 'ATTENDANCE', [
        here.row(users.otherStudent),
        here.row(users.cara),
        { ...here.row(users.cara), class: 'Only There' },
      ]);
      expect(res.body.rows.map((r: { code: string }) => r.code)).toEqual(['NOT_A_MEMBER', 'NEW_ATTENDANCE', 'UNKNOWN_CLASS']);
      // Cara's row matched this School's class, never the other School's twin.
      expect(await superuser.booking.count({ where: { classId: there.cls.id } })).toBe(0);
      expect(await superuser.booking.count({ where: { studentId: users.otherStudent.id } })).toBe(0);

      // From the other School: this School's student isn't a member there, and
      // the row can only match the other School's own class.
      const own = await runImport('otherOwner', 'ATTENDANCE', [there.row(users.ana), there.row(users.otherStudent)], otherSchool);
      expect(own.res.body.rows.map((r: { code: string }) => r.code)).toEqual(['NOT_A_MEMBER', 'NEW_ATTENDANCE']);
      expect(await superuser.booking.count({ where: { studentId: users.ana.id, classId: { in: [here.cls.id, there.cls.id] } } })).toBe(0);
      const otherBooking = await superuser.booking.findFirstOrThrow({ where: { studentId: users.otherStudent.id } });
      expect(otherBooking).toMatchObject({ classId: there.cls.id, schoolId: otherSchool, sourceMembershipId: null });
      // And this School's owner can't send rows into the other School's import.
      const theirs = await as('otherOwner').post(`/v1/schools/${otherSchool}/imports`).send({ kind: 'ATTENDANCE', totalRows: 1 });
      const sneak = await as('owner').post(`/v1/schools/${otherSchool}/imports/${theirs.body.id}/rows`).send({ rows: rowsOf([there.row(users.otherStudent)]) });
      expect([403, 404]).toContain(sneak.status);
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
      expect(limits.body).toMatchObject({ maxRows: 2000, maxRowsPerRequest: 100, attendanceEarliestDay: '1900-01-01' });

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
