/**
 * Decision 448, access and privacy:
 * - item 6: only the School's main owner sets staff access switches (the
 *   Access window, charge permissions, open mat, "Can manage disciplines",
 *   grading permissions); a co-owner gets 403 STAFF_SWITCHES_MAIN_OWNER_ONLY.
 * - item 7: no charge, recurring charge or restart for a member whose
 *   deletion is pending (403 ACCOUNT_CLOSING).
 * - item 9: the School's payment account record is for the payments area
 *   only; everyone at the School reads whether it takes cards.
 * - item 11: editing a student's profile is for owners and Branch Staff with
 *   "Manage students"; a coach can still open it.
 * - item 17: endpoints refused by an owner's switch answer 404 to someone
 *   with no role at the School, or for a School that doesn't exist.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { STAFF_ACCESS } from '../src/tenants/tenant-authorization.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

type Role = 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT';

describeIfDb('Decision 448: staff switches, payment account, profiles, outsiders', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const schoolId = randomUUID();
  let branchId: string;
  let disciplineId: string;
  const users: Record<string, { id: string; email: string }> = {};
  const roles: Record<string, Array<{ role: Role; branchId: string | null }>> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

  async function mkUser(label: string) {
    users[label] = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `d448-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Access',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-04-02'),
        phoneVerifiedAt: new Date(),
      },
    });
    roles[label] = [];
    tokens[label] = jwt.sign({ sub: users[label].id, email: users[label].email, grants: [] });
  }

  async function grant(label: string, role: Role, extra: { branchId?: string; isMainOwner?: boolean; grantedAt?: Date } = {}) {
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role, userId: users[label].id, schoolId, branchId: extra.branchId ?? null, isMainOwner: extra.isMainOwner ?? false, grantedAt: extra.grantedAt ?? new Date() },
    });
    roles[label].push({ role, branchId: extra.branchId ?? null });
    tokens[label] = jwt.sign({
      sub: users[label].id,
      email: users[label].email,
      grants: roles[label].map((g) => ({ role: g.role, franchiseId: null, schoolId, branchId: g.branchId })),
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.create({ data: { id: schoolId, name: 'Decision 448 School', defaultCurrency: 'BRL', branchStaffCanRecordPayments: false } });
    branchId = (await superuser.branch.create({ data: { id: randomUUID(), schoolId, name: 'North' } })).id;
    disciplineId = (await superuser.discipline.create({ data: { id: randomUUID(), schoolId, name: 'BJJ', classTypesOffered: [] } })).id;
    for (const label of ['main', 'coOwner', 'staffOn', 'staffOff', 'staffNoPay', 'coach', 'ana', 'leaving', 'outsider']) await mkUser(label);
    await grant('main', 'SCHOOL_OWNER_MANAGER', { isMainOwner: true, grantedAt: new Date('2026-01-01') });
    await grant('coOwner', 'SCHOOL_OWNER_MANAGER');
    await grant('staffOn', 'BRANCH_STAFF', { branchId });
    await grant('staffOff', 'BRANCH_STAFF', { branchId });
    await grant('staffNoPay', 'BRANCH_STAFF', { branchId });
    await grant('coach', 'INSTRUCTOR', { branchId });
    for (const s of ['ana', 'leaving']) {
      await grant(s, 'STUDENT');
      await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId, studentId: users[s].id, branchId } });
    }
    // staffOff: "Manage students" off. staffNoPay: no payments permission at all.
    await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId, userId: users.staffOff.id, canManageStudents: false } });
    await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId, userId: users.staffNoPay.id, canCreateCharges: false, canCancelCharges: false, canConnectStripe: false } });
    await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId, provider: 'STRIPE', accountTitle: 'Decision 448 School', country: 'BR', stripeConnectedAccountId: `acct_d448_${randomUUID().slice(0, 8)}` },
    });
    // A member who asked for their account to be deleted (Decision 436).
    await superuser.user.update({ where: { id: users.leaving.id }, data: { deletionRequestedAt: new Date() } });
  });

  afterAll(async () => {
    await superuser.staffActivity.deleteMany({ where: { schoolId } }).catch(() => undefined);
    await superuser.recurringCharge.deleteMany({ where: { schoolId } });
    await superuser.gradingPermission.deleteMany({ where: { schoolId } });
    await superuser.staffPermission.deleteMany({ where: { schoolId } });
    await superuser.paymentAccount.deleteMany({ where: { schoolId } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId } });
    await superuser.roleGrant.deleteMany({ where: { schoolId } });
    await superuser.discipline.deleteMany({ where: { schoolId } });
    await superuser.branch.deleteMany({ where: { schoolId } });
    await superuser.school.delete({ where: { id: schoolId } }).catch(() => undefined);
    const ids = Object.values(users).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: ids } } });
    await superuser.user.deleteMany({ where: { id: { in: ids } } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('item 6: only the main owner sets staff switches', () => {
    const allOn = () => Object.fromEntries(STAFF_ACCESS.map((k) => [k, true]));
    const setters: Array<[string, (who: string) => request.Test]> = [
      ['Access window', (who) => http().put(`/v1/schools/${schoolId}/staff/${users.staffOn.id}/access`).set(as(who)).send({ ...allOn(), payroll: false, connectStripe: false })],
      ['charge permissions', (who) => http().put(`/v1/schools/${schoolId}/charge-permissions/${users.staffOn.id}`).set(as(who)).send({ canCreateCharges: true, canCancelCharges: false })],
      ['open mat', (who) => http().put(`/v1/schools/${schoolId}/open-mats/permissions/${users.staffOn.id}`).set(as(who)).send({ canStartOpenMat: false })],
      ['manage disciplines', (who) => http().put(`/v1/schools/${schoolId}/staff-permissions/${users.staffOn.id}`).set(as(who)).send({ canManageDisciplines: false })],
      ['grading permissions', (who) => http().put(`/v1/schools/${schoolId}/grading-permissions/${users.coach.id}`).set(as(who)).send({ disciplineIds: [disciplineId] })],
    ];

    it.each(setters)('%s: a co-owner is refused, the main owner saves', async (_name, call) => {
      const refused = await call('coOwner');
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('STAFF_SWITCHES_MAIN_OWNER_ONLY');
      expect((await call('main')).status).toBe(200);
    });

    it('Branch Staff and outsiders get the owner-only refusal, as before', async () => {
      for (const who of ['staffOn', 'outsider']) {
        const res = await setters[0][1](who);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });

    it('staff/me/access tells the co-owner they are not the main owner', async () => {
      const res = await http().get(`/v1/schools/${schoolId}/staff/me/access`).set(as('coOwner'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ owner: true, mainOwner: false, editStudents: true });
    });
  });

  describe('item 7: no charges for a member whose deletion is pending', () => {
    const charge = { description: 'Gi', amount: 10000, dueDate: '2027-12-01' };
    const recurring = { description: 'Locker', amount: 2000, frequency: 'MONTHLY', firstDate: '2027-12-01' };

    it('refuses a charge and a recurring charge with ACCOUNT_CLOSING', async () => {
      const one = await http().post(`/v1/schools/${schoolId}/students/${users.leaving.id}/charges`).set(as('main')).send(charge);
      expect(one.status).toBe(403);
      expect(one.body.error.code).toBe('ACCOUNT_CLOSING');
      const series = await http().post(`/v1/schools/${schoolId}/students/${users.leaving.id}/recurring-charges`).set(as('main')).send(recurring);
      expect(series.status).toBe(403);
      expect(series.body.error.code).toBe('ACCOUNT_CLOSING');
      expect(await superuser.charge.count({ where: { schoolId, studentId: users.leaving.id } })).toBe(0);
    });

    it('refuses restarting a stopped recurring charge', async () => {
      const series = await superuser.recurringCharge.create({
        data: {
          id: randomUUID(),
          schoolId,
          studentId: users.leaving.id,
          description: 'Old locker',
          unitAmount: 2000,
          currency: 'BRL',
          frequency: 'MONTHLY',
          firstDate: new Date('2027-01-01'),
          nextDate: new Date('2027-02-01'),
          stoppedAt: new Date(),
          stoppedReason: 'STAFF',
          createdById: users.main.id,
        },
      });
      const res = await http().post(`/v1/schools/${schoolId}/recurring-charges/${series.id}/restart`).set(as('main'));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_CLOSING');
    });

    it('still charges other members', async () => {
      const res = await http().post(`/v1/schools/${schoolId}/students/${users.ana.id}/charges`).set(as('main')).send(charge);
      expect(res.status).toBe(201);
      await superuser.chargeAllocation.deleteMany({ where: { schoolId } }).catch(() => undefined);
      await superuser.balanceEntry.deleteMany({ where: { schoolId } });
      await superuser.charge.deleteMany({ where: { schoolId } });
    });
  });

  describe('item 9: the payment account record is for the payments area', () => {
    const account = (who: string) => http().get(`/v1/schools/${schoolId}/payment-account`).set(as(who));

    it('owners and Branch Staff with a payments permission read it', async () => {
      for (const who of ['main', 'coOwner', 'staffOn']) {
        const res = await account(who);
        expect(res.status).toBe(200);
        expect(res.body.stripeConnectedAccountId).toMatch(/^acct_d448_/);
      }
    });

    it('other staff, coaches and members are told they have no permission, the record hidden (Decision 449 item 6)', async () => {
      for (const who of ['staffNoPay', 'coach', 'ana']) {
        const res = await account(who);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('NO_PERMISSION');
        expect(JSON.stringify(res.body)).not.toContain('acct_d448_');
      }
      // Someone with no link to the School still gets 404.
      expect((await account('outsider')).status).toBe(404);
    });

    it('anyone at the School reads whether it takes cards; an outsider gets 404', async () => {
      for (const who of ['staffNoPay', 'coach', 'ana']) {
        const res = await http().get(`/v1/schools/${schoolId}/card-payments`).set(as(who));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ hasPaymentAccount: true, cardPayments: false });
      }
      expect((await http().get(`/v1/schools/${schoolId}/card-payments`).set(as('outsider'))).status).toBe(404);
    });
  });

  describe('item 11: editing a student is for owners and staff with "Manage students"', () => {
    const edit = (who: string) => http().patch(`/v1/schools/${schoolId}/students/${users.ana.id}/profile`).set(as(who)).send({ nationality: 'BR' });

    it('the owner and Branch Staff with the switch edit', async () => {
      expect((await edit('main')).status).toBe(200);
      expect((await edit('staffOn')).status).toBe(200);
    });

    it('a coach is refused as a coach, but still opens the profile', async () => {
      const res = await edit('coach');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('NOT_FOR_COACHES');
      expect((await http().get(`/v1/schools/${schoolId}/students/${users.ana.id}/profile`).set(as('coach'))).status).toBe(200);
      const me = await http().get(`/v1/schools/${schoolId}/staff/me/access`).set(as('coach'));
      expect(me.body).toMatchObject({ editStudents: false, access: { students: true } });
    });

    it('Branch Staff with the switch off are refused', async () => {
      const res = await edit('staffOff');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('STAFF_ACCESS_OFF');
    });
  });

  describe('item 17: outsiders get 404 from switch-gated endpoints', () => {
    const studentPath = () => `/v1/schools/${schoolId}/students/${users.ana.id}`;
    const gated: Array<[string, (school: string) => request.Test]> = [
      ['check-in rules', (s) => http().get(`/v1/schools/${s}/check-in-rules`)],
      ['payroll report', (s) => http().get(`/v1/schools/${s}/payroll/report`)],
      ['attendance stats', (s) => http().get(`/v1/schools/${s}/attendance/stats`)],
      ['attendance log classes', (s) => http().get(`/v1/schools/${s}/attendance/log-classes`)],
      ['freeze list', (s) => http().get(`/v1/schools/${s}/freezes`)],
      ['charge reports', (s) => http().get(`/v1/schools/${s}/charge-reports/overview`)],
      ['custom status assignments', (s) => http().get(`/v1/schools/${s}/custom-member-statuses/students`)],
      ['rosters', (s) => http().post(`/v1/schools/${s}/rosters`).send({ name: 'Team' })],
      ['student charges', (s) => http().get(`${studentPath().replace(schoolId, s)}/charges`)],
      ['recurring charges', (s) => http().get(`${studentPath().replace(schoolId, s)}/recurring-charges`)],
      ['medical information', (s) => http().get(`${studentPath().replace(schoolId, s)}/medical-info`)],
      ['member files', (s) => http().get(`${studentPath().replace(schoolId, s)}/files`)],
      ['Stripe status', (s) => http().get(`/v1/schools/${s}/payment-account/connect-status`)],
    ];

    it.each(gated)('%s: 404 for no role here and for an unknown School; 403 for the School\'s own', async (_name, call) => {
      const outsider = await call(schoolId).set(as('outsider'));
      expect(outsider.status).toBe(404);
      const unknown = await call(randomUUID()).set(as('staffNoPay'));
      expect(unknown.status).toBe(404);
      const member = await call(schoolId).set(as('ana'));
      expect(member.status).toBe(403);
    });
  });
});
