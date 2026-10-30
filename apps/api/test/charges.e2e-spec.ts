import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

/**
 * Staff-created charges and the member balance, step 1 of 6 (v1.3 backlog
 * §3.6; Decisions 303, 338, 411): tax worked out from the School's settings
 * and kept on the charge, gap-free invoice numbers, who may create, cancel
 * and take payments, part payments, credit from an overpayment and from a
 * cancelled charge, the member's and Guardian's view, notifications, and the
 * tenant boundary. Against a real Postgres, with the real notification
 * worker.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[charges.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const DAY = 24 * 60 * 60 * 1000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

describeIfDb('Staff-created charges and the member balance (Decisions 303, 338, 411)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let otherSchool: { id: string };
  let branchA: { id: string };
  let branchB: { id: string };
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const userIds: string[] = [];
  const schoolIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: Record<string, unknown> = {}) => http().post(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url: string, body: Record<string, unknown>) => http().put(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: Record<string, unknown> = {}) => http().patch(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const sign = (user: { id: string; email: string }, role: string | null, schoolId: string | null, branchId: string | null = null) =>
    jwt.sign({ sub: user.id, email: user.email, grants: role ? [{ role, franchiseId: null, schoolId, branchId }] : [] });

  async function mkUser(label: string) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `charges-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Charges',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    users[label] = user;
    return user;
  }

  async function mkStudent(label: string, homeBranchId: string | null = branchA.id, schoolId = school.id) {
    const user = await mkUser(label);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId } });
    if (homeBranchId) await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId, studentId: user.id, branchId: homeBranchId } });
    tokens[label] = sign(user, 'STUDENT', schoolId);
    return user;
  }

  async function mkStaff(label: string, role: 'BRANCH_STAFF' | 'INSTRUCTOR', branchId: string) {
    const user = await mkUser(label);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId: school.id, branchId } });
    tokens[label] = sign(user, role, school.id, branchId);
    return user;
  }

  const setTax = (body: Record<string, unknown>) => as(tokens.owner).patch(`/v1/schools/${school.id}`, body);
  const createCharge = (studentId: string, body: Record<string, unknown>, token = tokens.owner) =>
    as(token).post(`/v1/schools/${school.id}/students/${studentId}/charges`, { dueDate: day(7), ...body });
  const pay = (studentId: string, body: Record<string, unknown>, token = tokens.owner) =>
    as(token).post(`/v1/schools/${school.id}/students/${studentId}/charge-payments`, { paymentMethod: 'CASH', ...body });
  const cancel = (chargeId: string, reason: string | undefined, token = tokens.owner) =>
    as(token).post(`/v1/schools/${school.id}/charges/${chargeId}/cancel`, reason === undefined ? {} : { reason });
  const ledger = (studentId: string, token = tokens.owner) => as(token).get(`/v1/schools/${school.id}/students/${studentId}/charges`);

  /** The notification worker writes the in-app rows. */
  async function notices(userId: string, expected: number) {
    for (let i = 0; i < 60; i++) {
      const rows = await superuser.notification.findMany({ where: { userId, type: 'CHARGE' }, orderBy: { createdAt: 'asc' } });
      if (rows.length >= expected) return rows;
      await new Promise((r) => setTimeout(r, 100));
    }
    return superuser.notification.findMany({ where: { userId, type: 'CHARGE' }, orderBy: { createdAt: 'asc' } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Charges School', defaultCurrency: 'BRL' } });
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Other Charges School', defaultCurrency: 'BRL' } });
    schoolIds.push(school.id, otherSchool.id);
    branchA = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Branch A' } });
    branchB = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Branch B' } });
    await superuser.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'CASH', accountTitle: 'Desk', country: 'BR' } });

    const owner = await mkUser('owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true } });
    tokens.owner = sign(owner, 'SCHOOL_OWNER_MANAGER', school.id);
    const otherOwner = await mkUser('otherOwner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: otherOwner.id, schoolId: otherSchool.id, isMainOwner: true } });
    tokens.otherOwner = sign(otherOwner, 'SCHOOL_OWNER_MANAGER', otherSchool.id);
    await mkStaff('staffA', 'BRANCH_STAFF', branchA.id);
    await mkStaff('coachA', 'INSTRUCTOR', branchA.id);
  });

  afterEach(async () => {
    await superuser.school.update({
      where: { id: school.id },
      data: { taxCountry: null, taxRateBasisPoints: 0, taxInclusive: true, chargeCancelReasonRequired: true, branchStaffCanRecordPayments: false },
    });
  });

  afterAll(async () => {
    const where = { schoolId: { in: schoolIds } };
    await superuser.chargeAllocation.deleteMany({ where });
    await superuser.balanceEntry.deleteMany({ where });
    await superuser.transaction.deleteMany({ where });
    await superuser.charge.deleteMany({ where });
    await superuser.staffActivity.deleteMany({ where });
    await superuser.staffPermission.deleteMany({ where });
    await superuser.paymentAccount.deleteMany({ where });
    await superuser.studentHomeBranch.deleteMany({ where });
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: { in: userIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.branch.deleteMany({ where });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await appDb.$disconnect();
    await app.close();
  });

  describe('tax (Decision 411)', () => {
    it('lists ULTM8\'s standard rates, with no pre-fill for the US', async () => {
      const res = await as(tokens.owner).get('/v1/tax-rates');
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual(expect.arrayContaining([{ country: 'GB', rateBasisPoints: 2000, national: true }, { country: 'US', rateBasisPoints: 0, national: false }]));
    });

    it('the owner sets the country, rate and inclusive switch; staff cannot', async () => {
      const res = await setTax({ taxCountry: 'gb', taxRateBasisPoints: 2000, taxInclusive: false, taxId: ' GB123 ', chargeCancelReasonRequired: false });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ taxCountry: 'GB', taxRateBasisPoints: 2000, taxInclusive: false, taxId: 'GB123', chargeCancelReasonRequired: false });
      expect((await setTax({ taxRateBasisPoints: 10001 })).status).toBe(400);
      expect((await setTax({ taxCountry: 'GBR' })).status).toBe(400);
      expect((await as(tokens.staffA).patch(`/v1/schools/${school.id}`, { taxRateBasisPoints: 0 })).status).toBe(403);
    });

    it('adds tax on top, or takes it out of an inclusive price, after the discount', async () => {
      const student = await mkStudent('taxStudent');
      await setTax({ taxRateBasisPoints: 2000, taxInclusive: false });
      const onTop = await createCharge(student.id, { description: 'Rash guard', amount: 12000, discountType: 'PERCENT', discountValue: 1250 });
      expect(onTop.status).toBe(201);
      expect(onTop.body).toMatchObject({ unitAmount: 12000, discountAmount: 1500, netAmount: 10500, taxAmount: 2100, grossAmount: 12600, taxRateBasisPoints: 2000, taxInclusive: false, currency: 'BRL', status: 'OPEN' });

      await setTax({ taxInclusive: true });
      const inclusive = await createCharge(student.id, { description: 'Gloves', amount: 12000, discountType: 'FIXED', discountValue: 2000 });
      expect(inclusive.body).toMatchObject({ discountAmount: 2000, netAmount: 8333, taxAmount: 1667, grossAmount: 10000, taxInclusive: true });

      const tooBig = await createCharge(student.id, { description: 'Free', amount: 1000, discountType: 'FIXED', discountValue: 1000 });
      expect(tooBig.status).toBe(400);
      expect(tooBig.body.error.code).toBe('CHARGE_DISCOUNT_TOO_BIG');
      expect((await createCharge(student.id, { description: 'Half', amount: 1000, discountType: 'PERCENT' })).status).toBe(400);
    });

    it('keeps the tax a charge was created with when the settings change', async () => {
      const student = await mkStudent('snapshot');
      await setTax({ taxCountry: 'GB', taxRateBasisPoints: 2000, taxInclusive: false });
      const created = await createCharge(student.id, { description: 'Belt', amount: 5000 });
      expect(created.body).toMatchObject({ netAmount: 5000, taxAmount: 1000, grossAmount: 6000, taxCountry: 'GB' });
      await setTax({ taxCountry: 'DE', taxRateBasisPoints: 1900, taxInclusive: true });
      const after = await ledger(student.id);
      expect(after.body.charges[0]).toMatchObject({ id: created.body.id, taxCountry: 'GB', taxRateBasisPoints: 2000, taxInclusive: false, netAmount: 5000, taxAmount: 1000, grossAmount: 6000 });
      expect(after.body.balances).toEqual([{ schoolId: school.id, currency: 'BRL', owed: 6000, credit: 0, net: 6000, overdue: 0 }]);
    });

    it('refuses a charge while the School has no currency', async () => {
      const student = await mkStudent('noCurrency');
      await superuser.school.update({ where: { id: school.id }, data: { defaultCurrency: null } });
      try {
        const res = await createCharge(student.id, { description: 'Belt', amount: 5000 });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('CHARGE_NO_CURRENCY');
      } finally {
        await superuser.school.update({ where: { id: school.id }, data: { defaultCurrency: 'BRL' } });
      }
    });
  });

  describe('invoice numbers (Decision 338 item 4)', () => {
    it('run one after another per School, with no gaps or repeats, under concurrency', async () => {
      const students = await Promise.all([0, 1, 2, 3, 4].map((i) => mkStudent(`concurrent${i}`)));
      const before = (await superuser.charge.aggregate({ where: { schoolId: school.id }, _max: { invoiceNumber: true } }))._max.invoiceNumber ?? 0;
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) => createCharge(students[i % 5].id, { description: `Item ${i}`, amount: 1000 + i })),
      );
      expect(results.map((r) => r.status)).toEqual(Array(12).fill(201));
      const numbers = results.map((r) => r.body.invoiceNumber).sort((a, b) => a - b);
      expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => before + i + 1));
      expect(results[0].body.invoiceLabel).toMatch(/^#\d{7}$/);

      // Another School starts at #0000001.
      const other = await mkStudent('otherSchoolStudent', null, otherSchool.id);
      const first = await as(tokens.otherOwner).post(`/v1/schools/${otherSchool.id}/students/${other.id}/charges`, { description: 'Belt', amount: 1000, dueDate: day(1) });
      expect(first.body).toMatchObject({ invoiceNumber: 1, invoiceLabel: '#0000001' });
    });

    it('refuses the same charge twice within a minute', async () => {
      const student = await mkStudent('repeat');
      expect((await createCharge(student.id, { description: 'Belt', amount: 1500 })).status).toBe(201);
      const again = await createCharge(student.id, { description: 'Belt', amount: 1500 });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('DESK_REPEAT');
    });
  });

  describe('who may create, cancel and take payments (Decisions 303, 338, 347)', () => {
    it('Branch Staff create for their own branches\' students only', async () => {
      const mine = await mkStudent('staffMine', branchA.id);
      const theirs = await mkStudent('staffTheirs', branchB.id);
      expect((await createCharge(mine.id, { description: 'Belt', amount: 1000 }, tokens.staffA)).status).toBe(201);
      const refused = await createCharge(theirs.id, { description: 'Belt', amount: 1000 }, tokens.staffA);
      expect(refused.status).toBe(403);
      expect((await ledger(theirs.id, tokens.staffA)).status).toBe(403);
      const seen = await ledger(mine.id, tokens.staffA);
      expect(seen.status).toBe(200);
      expect(seen.body.can).toEqual({ create: true, cancel: false, recordPayment: false });
    });

    it('a coach needs "Can create charges"; the switch is logged', async () => {
      const student = await mkStudent('coachStudent', branchA.id);
      const off = await createCharge(student.id, { description: 'Belt', amount: 1000 }, tokens.coachA);
      expect(off.status).toBe(403);
      expect(off.body.error.code).toBe('STAFF_ACCESS_OFF');

      const list = await as(tokens.owner).get(`/v1/schools/${school.id}/charge-permissions`);
      expect(list.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: users.coachA.id, roles: ['INSTRUCTOR'], canCreateCharges: false, canCancelCharges: false }),
          expect.objectContaining({ userId: users.staffA.id, roles: ['BRANCH_STAFF'], canCreateCharges: true, canCancelCharges: false }),
        ]),
      );
      expect((await as(tokens.staffA).put(`/v1/schools/${school.id}/charge-permissions/${users.coachA.id}`, { canCreateCharges: true, canCancelCharges: false })).status).toBe(403);
      const on = await as(tokens.owner).put(`/v1/schools/${school.id}/charge-permissions/${users.coachA.id}`, { canCreateCharges: true, canCancelCharges: false });
      expect(on.status).toBe(200);
      expect(on.body).toMatchObject({ canCreateCharges: true, canCancelCharges: false });
      expect((await createCharge(student.id, { description: 'Belt', amount: 1000 }, tokens.coachA)).status).toBe(201);

      const log = await superuser.staffActivity.findFirst({ where: { schoolId: school.id, targetUserId: users.coachA.id, action: 'CHARGE_ACCESS_CHANGED' } });
      expect(log?.details).toEqual({ changes: [{ switch: 'createCharges', on: true }] });
      // Saving the same switches again writes no line.
      await as(tokens.owner).put(`/v1/schools/${school.id}/charge-permissions/${users.coachA.id}`, { canCreateCharges: true, canCancelCharges: false });
      expect(await superuser.staffActivity.count({ where: { schoolId: school.id, targetUserId: users.coachA.id, action: 'CHARGE_ACCESS_CHANGED' } })).toBe(1);

      // A coach never takes payments.
      expect((await pay(student.id, { amount: 100 }, tokens.coachA)).status).toBe(403);
      // Only staff of this School are listed.
      expect((await as(tokens.owner).put(`/v1/schools/${school.id}/charge-permissions/${users.otherOwner.id}`, { canCreateCharges: true, canCancelCharges: true })).status).toBe(400);
    });

    it('only the owner and staff with "Can cancel charges" cancel', async () => {
      const student = await mkStudent('cancelPerm', branchA.id);
      const charge = await createCharge(student.id, { description: 'Belt', amount: 1000 });
      const refused = await cancel(charge.body.id, 'Wrong item', tokens.staffA);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('STAFF_ACCESS_OFF');
      await as(tokens.owner).put(`/v1/schools/${school.id}/charge-permissions/${users.staffA.id}`, { canCreateCharges: true, canCancelCharges: true });
      try {
        const ok = await cancel(charge.body.id, 'Wrong item', tokens.staffA);
        expect(ok.status).toBe(201);
        expect(ok.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Wrong item', owedAmount: 0 });
        expect((await cancel(charge.body.id, 'Again')).body.error.code).toBe('CHARGE_ALREADY_CANCELLED');
      } finally {
        await as(tokens.owner).put(`/v1/schools/${school.id}/charge-permissions/${users.staffA.id}`, { canCreateCharges: true, canCancelCharges: false });
      }
    });

    it('Branch Staff take desk payments only when the School lets them (Decision 347)', async () => {
      const student = await mkStudent('staffPays', branchA.id);
      await createCharge(student.id, { description: 'Belt', amount: 1000 });
      expect((await pay(student.id, { amount: 1000 }, tokens.staffA)).status).toBe(403);
      await superuser.school.update({ where: { id: school.id }, data: { branchStaffCanRecordPayments: true } });
      const ok = await pay(student.id, { amount: 1000, paymentMethod: 'PIX' }, tokens.staffA);
      expect(ok.status).toBe(201);
      expect(ok.body.payment).toMatchObject({ amount: 1000, paymentMethod: 'PIX', creditAmount: 0 });
    });

    it('a reason is required to cancel unless the owner makes it optional', async () => {
      const student = await mkStudent('reason');
      const a = await createCharge(student.id, { description: 'A', amount: 1000 });
      const missing = await cancel(a.body.id, '  ');
      expect(missing.status).toBe(400);
      expect(missing.body.error.code).toBe('CHARGE_CANCEL_REASON_REQUIRED');
      await setTax({ chargeCancelReasonRequired: false });
      expect((await cancel(a.body.id, undefined)).status).toBe(201);
    });
  });

  describe('the balance (Decisions 303, 338)', () => {
    it('part payments leave the rest owed; overdue shows past the due date', async () => {
      const student = await mkStudent('partPay');
      const charge = await createCharge(student.id, { description: 'Rash guard', amount: 12000, dueDate: day(-2) });
      expect(charge.body).toMatchObject({ overdue: true, status: 'OPEN' });
      const part = await pay(student.id, { chargeId: charge.body.id, amount: 5000 });
      expect(part.status).toBe(201);
      expect(part.body.payment).toMatchObject({ amount: 5000, paymentMethod: 'CASH', allocations: [{ chargeId: charge.body.id, amount: 5000 }], creditAmount: 0 });
      expect(part.body.balances).toEqual([{ schoolId: school.id, currency: 'BRL', owed: 7000, credit: 0, net: 7000, overdue: 7000 }]);
      const view = await ledger(student.id);
      expect(view.body.charges[0]).toMatchObject({ status: 'PART_PAID', paidAmount: 5000, owedAmount: 7000 });

      // The desk payment is on the Transactions page, naming its charge.
      const tx = await as(tokens.owner).get(`/v1/schools/${school.id}/transactions?kind=CHARGE_PAYMENT`);
      expect(tx.body.items.find((t: { id: string }) => t.id === part.body.payment.id)).toMatchObject({
        kind: 'CHARGE_PAYMENT',
        status: 'SUCCESSFUL',
        amount: 5000,
        paymentMethod: 'CASH',
        recordedById: users.owner.id,
        chargeDescription: 'Rash guard',
        chargeInvoiceLabel: charge.body.invoiceLabel,
      });

      // The same payment again within a minute is refused.
      expect((await pay(student.id, { chargeId: charge.body.id, amount: 5000 })).body.error.code).toBe('DESK_REPEAT');
      const rest = await pay(student.id, { chargeId: charge.body.id, amount: 7000, paymentMethod: 'CARD_TERMINAL' });
      expect(rest.body.balances[0]).toMatchObject({ owed: 0, credit: 0, net: 0, overdue: 0 });
      expect((await pay(student.id, { chargeId: charge.body.id, amount: 100 })).body.error.code).toBe('CHARGE_ALREADY_PAID');
    });

    it('an overpayment becomes credit, used automatically on the next charge', async () => {
      const student = await mkStudent('overpay');
      const first = await createCharge(student.id, { description: 'Belt', amount: 12000 });
      const paid = await pay(student.id, { chargeId: first.body.id, amount: 15000 });
      expect(paid.body.payment).toMatchObject({ allocations: [{ chargeId: first.body.id, amount: 12000 }], creditAmount: 3000 });
      expect(paid.body.balances[0]).toMatchObject({ owed: 0, credit: 3000, net: -3000 });

      const next = await createCharge(student.id, { description: 'Patch', amount: 2000 });
      expect(next.body).toMatchObject({ status: 'PAID', paidAmount: 2000, owedAmount: 0 });
      const third = await createCharge(student.id, { description: 'Gloves', amount: 5000 });
      expect(third.body).toMatchObject({ status: 'PART_PAID', paidAmount: 1000, owedAmount: 4000 });
      const view = await ledger(student.id);
      expect(view.body.balances[0]).toMatchObject({ owed: 4000, credit: 0, net: 4000 });
      const credits = await superuser.chargeAllocation.findMany({ where: { studentId: student.id, transactionId: null } });
      expect(credits.map((c) => c.amount).sort()).toEqual([1000, 2000]);
    });

    it('a payment toward the balance pays the oldest due first; prepaying puts it in credit', async () => {
      const student = await mkStudent('balancePay');
      const later = await createCharge(student.id, { description: 'Later', amount: 3000, dueDate: day(10) });
      const sooner = await createCharge(student.id, { description: 'Sooner', amount: 2000, dueDate: day(2) });
      const res = await pay(student.id, { amount: 4000, paymentMethod: 'BANK_TRANSFER' });
      expect(res.body.payment.allocations).toEqual([
        { chargeId: sooner.body.id, invoiceLabel: sooner.body.invoiceLabel, amount: 2000 },
        { chargeId: later.body.id, invoiceLabel: later.body.invoiceLabel, amount: 2000 },
      ]);
      expect(res.body.balances[0]).toMatchObject({ owed: 1000, net: 1000 });

      const prepaid = await mkStudent('prepaid');
      const pre = await pay(prepaid.id, { amount: 2500 });
      expect(pre.body.balances[0]).toMatchObject({ owed: 0, credit: 2500, net: -2500 });
    });

    it('cancelling a part-paid charge puts what was paid onto the balance as credit', async () => {
      const student = await mkStudent('cancelPaid');
      const charge = await createCharge(student.id, { description: 'Rash guard', amount: 12000 });
      await pay(student.id, { chargeId: charge.body.id, amount: 5000 });
      const res = await cancel(charge.body.id, 'Out of stock');
      expect(res.body).toMatchObject({ status: 'CANCELLED', paidAmount: 5000, owedAmount: 0 });
      const view = await ledger(student.id);
      expect(view.body.balances[0]).toMatchObject({ owed: 0, credit: 5000, net: -5000 });
      expect(view.body.charges.find((c: { id: string }) => c.id === charge.body.id)).toMatchObject({ cancelReason: 'Out of stock', cancelledByName: 'owner Charges' });
      // A charge is never deleted.
      expect(await superuser.charge.count({ where: { id: charge.body.id } })).toBe(1);
      // The credit pays the next charge.
      const next = await createCharge(student.id, { description: 'Gloves', amount: 4000 });
      expect(next.body.status).toBe('PAID');
    });
  });

  describe('the member, the Guardian and the tenant boundary', () => {
    it('the student and their Guardian read the charges, without staff-only details', async () => {
      const student = await mkStudent('member');
      const guardian = await mkUser('guardian');
      await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: guardian.id, studentId: student.id } });
      const charge = await createCharge(student.id, { description: 'Rash guard', amount: 12000 });
      await pay(student.id, { chargeId: charge.body.id, amount: 2000 });
      const other = await createCharge(student.id, { description: 'Wrong', amount: 1000 });
      await cancel(other.body.id, 'Staff only reason');
      await setTax({ taxId: 'BR-123' });

      const mine = await as(tokens.member).get(`/v1/students/${student.id}/charges`);
      expect(mine.status).toBe(200);
      expect(mine.body.schools).toHaveLength(1);
      const s = mine.body.schools[0];
      expect(s).toMatchObject({ schoolId: school.id, schoolName: 'Charges School', taxId: 'BR-123' });
      expect(s.balances[0]).toMatchObject({ owed: 10000, net: 10000 });
      expect(s.charges.map((c: { status: string }) => c.status)).toEqual(['PART_PAID', 'CANCELLED']);
      expect(s.charges[1]).toMatchObject({ cancelReason: null, cancelledByName: null, createdByName: null });
      expect(s.payments[0]).toMatchObject({ amount: 2000, recordedByName: null });

      const theirs = await as(sign(guardian, null, null)).get(`/v1/students/${student.id}/charges`);
      expect(theirs.status).toBe(200);
      expect(theirs.body.schools[0].charges).toHaveLength(2);

      const stranger = await mkStudent('stranger');
      expect((await as(tokens.stranger).get(`/v1/students/${student.id}/charges`)).status).toBe(403);
    });

    it('another School cannot read or act on them (API and RLS)', async () => {
      const student = await mkStudent('isolated');
      const charge = await createCharge(student.id, { description: 'Belt', amount: 1000 });
      expect((await as(tokens.otherOwner).get(`/v1/schools/${school.id}/students/${student.id}/charges`)).status).toBe(403);
      expect((await as(tokens.otherOwner).post(`/v1/schools/${otherSchool.id}/charges/${charge.body.id}/cancel`, { reason: 'x' })).status).toBe(404);
      expect((await as(tokens.otherOwner).post(`/v1/schools/${otherSchool.id}/students/${student.id}/charge-payments`, { amount: 100, paymentMethod: 'CASH' })).status).toBe(400);

      const asUser = <T>(userId: string, fn: (tx: PrismaClient) => Promise<T>) =>
        appDb.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
          return fn(tx as unknown as PrismaClient);
        });
      expect(await asUser(users.otherOwner.id, (tx) => tx.charge.count({ where: { id: charge.body.id } }))).toBe(0);
      expect(await asUser(users.otherOwner.id, (tx) => tx.balanceEntry.count({ where: { studentId: student.id } }))).toBe(0);
      expect(await asUser(users.owner.id, (tx) => tx.charge.count({ where: { id: charge.body.id } }))).toBe(1);
      expect(await asUser(student.id, (tx) => tx.charge.count({ where: { id: charge.body.id } }))).toBe(1);
      // Staff of another branch don't see a student who isn't theirs.
      const elsewhere = await mkStudent('elsewhere', branchB.id);
      const hidden = await createCharge(elsewhere.id, { description: 'Belt', amount: 1000 });
      expect(await asUser(users.staffA.id, (tx) => tx.charge.count({ where: { id: hidden.body.id } }))).toBe(0);
      expect(await asUser(users.staffA.id, (tx) => tx.charge.count({ where: { id: charge.body.id } }))).toBe(1);
      // The app connection can't write charges at all.
      await expect(asUser(users.owner.id, (tx) => tx.charge.updateMany({ where: { id: charge.body.id }, data: { grossAmount: 1 } }))).rejects.toThrow();
    });
  });

  describe('notifications (Decision 338 items 1, 5, 9)', () => {
    it('a new invoice, a receipt (unless unticked) and a cancelled charge', async () => {
      const student = await mkStudent('notified');
      const due = day(5);
      const charge = await createCharge(student.id, { description: 'Rash guard', amount: 12000, dueDate: due });
      await pay(student.id, { chargeId: charge.body.id, amount: 2000 });
      await pay(student.id, { chargeId: charge.body.id, amount: 1000, sendReceipt: false });
      await cancel(charge.body.id, 'Out of stock');
      const rows = await notices(student.id, 3);
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => [r.title, r.body])).toEqual(expect.arrayContaining([
        ['New invoice', `Invoice ${charge.body.invoiceLabel} for Rash guard: 120.00 BRL, due ${due}.`],
        ['Payment received', 'Your payment of 20.00 BRL was received.'],
        ['Charge cancelled', "Your charge 'Rash guard, 120.00 BRL' was cancelled. Nothing to pay. The 30.00 BRL already paid is now credit on your balance."],
      ]));
      expect(rows.find((r) => r.title === 'New invoice')).toMatchObject({ schoolId: school.id, targetType: 'PAYMENT', targetId: charge.body.id });
    });
  });
});
