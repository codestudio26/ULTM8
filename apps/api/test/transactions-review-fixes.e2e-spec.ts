/**
 * Decision 339 — the Transactions review fixes (T1–T3, T8–T11, and Cancel for
 * a Pending Cash/Bank payment), proven over real HTTP against a real Postgres.
 * T12 (payment_intent.canceled) lives in stripe-webhook-processing.e2e-spec.ts
 * with the other webhook events.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET, REDIS_URL.
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

describeIfDb('Transactions review fixes (Decision 339)', () => {
  let app: INestApplication;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const TAG = 'tx-review-';

  type Person = { id: string; email: string };
  const token = (u: Person, role: string, schoolId: string, branchId: string | null = null) =>
    jwt.sign({ sub: u.id, email: u.email, grants: [{ role, franchiseId: null, schoolId, branchId }] });
  const mkUser = (label: string) =>
    su.user.create({
      data: {
        id: randomUUID(),
        email: `${TAG}${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Tester',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });

  /** A School with an Owner, a Student, a Branch Staff member, a Cash account and a plan. */
  async function seedSchool(provider: 'CASH' | 'STRIPE' = 'CASH') {
    const school = await su.school.create({ data: { id: randomUUID(), name: `Tx review ${randomUUID().slice(0, 6)}` } });
    schoolIds.push(school.id);
    const branch = await su.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Main' } });
    const owner = await mkUser('owner');
    const student = await mkUser('student');
    const staff = await mkUser('staff');
    const studentGrantId = randomUUID();
    await su.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: studentGrantId, role: 'STUDENT', userId: student.id, schoolId: school.id },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: staff.id, schoolId: school.id, branchId: branch.id },
      ],
    });
    // The student's home branch is the staff member's, so the staff member
    // covers them (Decision 168) when "Can cancel charges" is on.
    await su.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: student.id, branchId: branch.id } });
    const account = await su.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider, accountTitle: 'Desk', country: 'GB' },
    });
    const plan = await su.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '10-Class Pack', price: 15000, classesIncluded: 10, currency: 'GBP' },
    });
    return {
      school,
      plan,
      account,
      owner,
      student,
      staff,
      studentGrantId,
      ownerToken: token(owner, 'SCHOOL_OWNER_MANAGER', school.id),
      studentToken: token(student, 'STUDENT', school.id),
      staffToken: token(staff, 'BRANCH_STAFF', school.id, branch.id),
    };
  }
  type Seeded = Awaited<ReturnType<typeof seedSchool>>;

  const http = () => request(app.getHttpServer());
  const buy = (s: Seeded) => http().post(`/v1/membership-plans/${s.plan.id}/purchase`).set('Authorization', `Bearer ${s.studentToken}`).send({});
  const confirm = (s: Seeded, id: string, tok = s.ownerToken) => http().patch(`/v1/transactions/${id}/confirm`).set('Authorization', `Bearer ${tok}`);
  const cancel = (s: Seeded, id: string, tok = s.ownerToken, reason: string | null = 'Never came in') =>
    http()
      .patch(`/v1/transactions/${id}/cancel`)
      .set('Authorization', `Bearer ${tok}`)
      .send(reason === null ? {} : { reason });

  /** Notification fan-out runs on the queue; wait for it rather than sleeping blind. */
  async function noticesFor(userId: string, title: string, expected = 1) {
    for (let i = 0; i < 50; i++) {
      const rows = await su.notification.findMany({ where: { userId, title } });
      if (rows.length >= expected) return rows;
      await new Promise((r) => setTimeout(r, 100));
    }
    return su.notification.findMany({ where: { userId, title } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    const where = { schoolId: { in: schoolIds } };
    const users = { email: { startsWith: TAG } };
    await su.notification.deleteMany({ where: { user: users } });
    await su.transaction.deleteMany({ where });
    await su.staffPermission.deleteMany({ where });
    await su.studentHomeBranch.deleteMany({ where });
    await su.membership.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.roleGrant.deleteMany({ where });
    await su.branch.deleteMany({ where });
    await su.user.deleteMany({ where: users });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await su.$disconnect();
  });

  describe('the ledger (T1, T2, T3)', () => {
    let s: Seeded;
    beforeAll(async () => {
      s = await seedSchool();
      // 25 rows a day apart, newest = day 0; currency case mixed, as old rows were.
      for (let i = 0; i < 25; i++) {
        await su.transaction.create({
          data: {
            id: randomUUID(),
            schoolId: s.school.id,
            studentId: s.student.id,
            paymentAccountId: s.account.id,
            membershipPlanId: s.plan.id,
            amount: 1000,
            currency: i % 2 ? 'gbp' : 'GBP',
            status: i === 0 ? 'PENDING' : i === 24 ? 'FAILED' : 'SUCCESSFUL',
            paymentMethod: 'CASH',
            billingDate: new Date(Date.now() - i * 86_400_000),
          },
        });
      }
    });

    it('lists newest first and pages through every row with the cursor', async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const res = await http()
          .get(`/v1/schools/${s.school.id}/transactions`)
          .query({ limit: 10, ...(cursor ? { cursor } : {}) })
          .set('Authorization', `Bearer ${s.ownerToken}`);
        expect(res.status).toBe(200);
        seen.push(...res.body.items.map((t: { billingDate: string }) => t.billingDate));
        cursor = res.body.nextCursor ?? undefined;
      } while (cursor);
      expect(seen).toHaveLength(25);
      expect(seen).toEqual([...seen].sort().reverse());
    });

    it('the first page starts with the newest (Pending) payment, currency in capitals', async () => {
      const res = await http().get(`/v1/schools/${s.school.id}/transactions`).set('Authorization', `Bearer ${s.ownerToken}`);
      expect(res.body.items).toHaveLength(20);
      expect(res.body.items[0].status).toBe('PENDING');
      expect(new Set(res.body.items.map((t: { currency: string }) => t.currency))).toEqual(new Set(['GBP']));
    });

    it('a cursor that was not issued by the server is a 400, not a 500', async () => {
      const res = await http()
        .get(`/v1/schools/${s.school.id}/transactions`)
        .query({ cursor: 'not-a-cursor' })
        .set('Authorization', `Bearer ${s.ownerToken}`);
      expect(res.status).toBe(400);
    });

    it('the summary counts the whole ledger, one revenue figure per currency whatever its case', async () => {
      const res = await http().get(`/v1/schools/${s.school.id}/transactions/summary`).set('Authorization', `Bearer ${s.ownerToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        total: 25,
        successful: 23,
        pending: 1,
        failedOrDisputed: 1,
        cancelled: 0,
        revenue: [{ currency: 'GBP', amount: 23_000 }],
      });
    });

    it('the summary is Owner/Manager only, like the ledger', async () => {
      const staff = await http().get(`/v1/schools/${s.school.id}/transactions/summary`).set('Authorization', `Bearer ${s.staffToken}`);
      expect(staff.status).toBe(403);
      const student = await http().get(`/v1/schools/${s.school.id}/transactions/summary`).set('Authorization', `Bearer ${s.studentToken}`);
      expect(student.status).toBe(403);
    });
  });

  describe('a cash purchase (T10, T11)', () => {
    it('a second Buy of the same plan returns the payment already waiting instead of another one', async () => {
      const s = await seedSchool();
      const first = await buy(s);
      expect(first.body.outcome).toBe('pending_confirmation');
      const again = await Promise.all([buy(s), buy(s)]);
      for (const res of again) expect(res.body.transactionId).toBe(first.body.transactionId);
      expect(await su.transaction.count({ where: { schoolId: s.school.id } })).toBe(1);
      const row = await su.transaction.findUniqueOrThrow({ where: { id: first.body.transactionId } });
      expect(row.currency).toBe('GBP');
    });

    it('once that payment is confirmed, buying again starts a new one', async () => {
      const s = await seedSchool();
      const first = await buy(s);
      expect((await confirm(s, first.body.transactionId)).status).toBe(200);
      const second = await buy(s);
      expect(second.body.transactionId).not.toBe(first.body.transactionId);
    });

    it('tells the Owner a cash payment is waiting, and the Student when it is confirmed', async () => {
      const s = await seedSchool();
      const p = await buy(s);
      const waiting = await noticesFor(s.owner.id, 'Cash payment waiting');
      expect(waiting).toHaveLength(1);
      expect(waiting[0].body).toBe(
        'student Tester chose to pay 150.00 GBP for 10-Class Pack by cash or bank transfer. Mark it as paid on the Transactions page once the money arrives.',
      );
      await confirm(s, p.body.transactionId);
      const confirmed = await noticesFor(s.student.id, 'Payment confirmed');
      expect(confirmed[0].body).toBe('Your payment of 150.00 GBP for 10-Class Pack was confirmed. Your membership is now active.');
    });
  });

  describe('confirm (T8, T9)', () => {
    it('refuses a Student who has left the School, and Cancel clears the payment instead', async () => {
      const s = await seedSchool();
      const p = await buy(s);
      await su.roleGrant.update({ where: { id: s.studentGrantId }, data: { revokedAt: new Date() } });
      const res = await confirm(s, p.body.transactionId);
      expect(res.status).toBe(409);
      expect(await su.membership.count({ where: { schoolId: s.school.id } })).toBe(0);
      const cancelled = await cancel(s, p.body.transactionId);
      expect(cancelled.status).toBe(200);
      expect((await su.transaction.findUniqueOrThrow({ where: { id: p.body.transactionId } })).status).toBe('FAILED');
    });

    it('refuses at a closed School', async () => {
      const s = await seedSchool();
      const p = await buy(s);
      await su.school.update({ where: { id: s.school.id }, data: { archivedAt: new Date() } });
      expect((await confirm(s, p.body.transactionId)).status).toBe(403);
      expect((await cancel(s, p.body.transactionId)).status).toBe(403);
      expect(await su.membership.count({ where: { schoolId: s.school.id } })).toBe(0);
    });

    it("still confirms cash taken before the School's ULTM8 subscription was cancelled", async () => {
      const s = await seedSchool();
      const p = await buy(s);
      await su.school.update({ where: { id: s.school.id }, data: { platformSubscriptionStatus: 'CANCELED' } });
      const res = await confirm(s, p.body.transactionId);
      expect(res.status).toBe(200);
      expect(res.body.membershipCreated).toBe(true);
    });
  });

  describe('cancel a Pending cash payment', () => {
    it('Branch Staff without "Can cancel charges" and the Student are refused', async () => {
      const s = await seedSchool();
      const p = await buy(s);
      const staff = await cancel(s, p.body.transactionId, s.staffToken);
      expect(staff.status).toBe(403);
      expect(staff.body.error.code).toBe('STAFF_ACCESS_OFF');
      expect((await cancel(s, p.body.transactionId, s.studentToken)).status).toBe(403);
      expect((await su.transaction.findUniqueOrThrow({ where: { id: p.body.transactionId } })).status).toBe('PENDING');
    });

    it('marks it Failed, tells the Student, and a second Cancel changes nothing', async () => {
      const s = await seedSchool();
      const p = await buy(s);
      const first = await cancel(s, p.body.transactionId);
      expect(first.status).toBe(200);
      expect(first.body.cancelled).toBe(true);
      const second = await cancel(s, p.body.transactionId);
      expect(second.body.cancelled).toBe(false);
      expect(await noticesFor(s.student.id, 'Payment cancelled')).toHaveLength(1);
      // A cancelled payment can't then be confirmed into a Membership, and says
      // so (billing stress test, B1).
      const late = await confirm(s, p.body.transactionId);
      expect(late.status).toBe(409);
      expect(await su.membership.count({ where: { schoolId: s.school.id } })).toBe(0);
    });

    it('a card payment cannot be cancelled here — Stripe settles it', async () => {
      const s = await seedSchool('STRIPE');
      const row = await su.transaction.create({
        data: {
          id: randomUUID(),
          schoolId: s.school.id,
          studentId: s.student.id,
          paymentAccountId: s.account.id,
          membershipPlanId: s.plan.id,
          amount: 15000,
          currency: 'GBP',
          status: 'PENDING',
          paymentMethod: 'STRIPE',
          stripePaymentIntentId: `pi_${randomUUID()}`,
        },
      });
      expect((await cancel(s, row.id)).status).toBe(400);
    });
  });

  describe('cancelling follows the charge rule (Decision 338 item 1)', () => {
    const allowStaffToCancel = (s: Seeded) =>
      su.staffPermission.create({ data: { id: randomUUID(), schoolId: s.school.id, userId: s.staff.id, canCancelCharges: true } });

    it('the owner cancels with a reason: stored FAILED with who, when and why', async () => {
      const s = await seedSchool();
      const p = await buy(s);
      const res = await cancel(s, p.body.transactionId, s.ownerToken, 'Changed their mind');
      expect(res.status).toBe(200);
      expect(res.body.cancelled).toBe(true);
      const row = await su.transaction.findUniqueOrThrow({ where: { id: p.body.transactionId } });
      expect(row.status).toBe('FAILED');
      expect(row.cancelledAt).not.toBeNull();
      expect(row.cancelledById).toBe(s.owner.id);
      expect(row.cancelReason).toBe('Changed their mind');
      // The member's notice never carries the reason.
      const notice = await noticesFor(s.student.id, 'Payment cancelled');
      expect(notice[0].body).toBe('Your School cancelled your cash or bank payment of 150.00 GBP for 10-Class Pack.');
    });

    it('Branch Staff with "Can cancel charges" who cover the student can cancel', async () => {
      const s = await seedSchool();
      await allowStaffToCancel(s);
      const p = await buy(s);
      const res = await cancel(s, p.body.transactionId, s.staffToken, 'Wrong plan');
      expect(res.status).toBe(200);
      expect(res.body.cancelled).toBe(true);
      const row = await su.transaction.findUniqueOrThrow({ where: { id: p.body.transactionId } });
      expect(row.status).toBe('FAILED');
      expect(row.cancelledById).toBe(s.staff.id);
      expect(row.cancelReason).toBe('Wrong plan');
    });

    it('...but not for a student of a branch they are not assigned to', async () => {
      const s = await seedSchool();
      await allowStaffToCancel(s);
      const other = await su.branch.create({ data: { id: randomUUID(), schoolId: s.school.id, name: 'Other' } });
      await su.studentHomeBranch.update({ where: { schoolId_studentId: { schoolId: s.school.id, studentId: s.student.id } }, data: { branchId: other.id } });
      const p = await buy(s);
      expect((await cancel(s, p.body.transactionId, s.staffToken)).status).toBe(403);
      expect((await su.transaction.findUniqueOrThrow({ where: { id: p.body.transactionId } })).status).toBe('PENDING');
    });

    it('a reason is required by default, and optional when the School says so', async () => {
      const s = await seedSchool();
      const p = await buy(s);
      for (const reason of [null, '', '   ']) {
        const res = await cancel(s, p.body.transactionId, s.ownerToken, reason);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('PAYMENT_CANCEL_REASON_REQUIRED');
      }
      expect((await su.transaction.findUniqueOrThrow({ where: { id: p.body.transactionId } })).status).toBe('PENDING');
      await su.school.update({ where: { id: s.school.id }, data: { chargeCancelReasonRequired: false } });
      const res = await cancel(s, p.body.transactionId, s.ownerToken, null);
      expect(res.status).toBe(200);
      const row = await su.transaction.findUniqueOrThrow({ where: { id: p.body.transactionId } });
      expect(row.status).toBe('FAILED');
      expect(row.cancelledAt).not.toBeNull();
      expect(row.cancelReason).toBeNull();
    });

    it("another School's owner can't cancel it, or learn it exists", async () => {
      const s = await seedSchool();
      const other = await seedSchool();
      const p = await buy(s);
      expect((await cancel(s, p.body.transactionId, other.ownerToken)).status).toBe(404);
      expect((await cancel(s, randomUUID(), other.ownerToken)).status).toBe(404);
      expect((await su.transaction.findUniqueOrThrow({ where: { id: p.body.transactionId } })).status).toBe('PENDING');
    });

    it('the member sees it cancelled, with the date, never who or why', async () => {
      const s = await seedSchool();
      const p = await buy(s);
      await cancel(s, p.body.transactionId, s.ownerToken, 'Staff-only reason');
      const mine = await http().get('/v1/transactions/me').set('Authorization', `Bearer ${s.studentToken}`);
      expect(mine.status).toBe(200);
      const row = mine.body.items.find((t: { id: string }) => t.id === p.body.transactionId);
      expect(row.status).toBe('FAILED');
      expect(row.cancelledAt).toBeTruthy();
      expect(row.cancelReason).toBeNull();
      expect(row.cancelledById).toBeNull();
      expect(row.cancelledByName).toBeNull();
      expect(JSON.stringify(mine.body)).not.toContain('Staff-only reason');
    });

    it('the ledger shows who cancelled and why; Failed leaves it out, Cancelled finds it, and the tiles count it apart', async () => {
      const s = await seedSchool();
      const p = await buy(s);
      await cancel(s, p.body.transactionId, s.ownerToken, 'No show');
      const failedId = randomUUID();
      await su.transaction.create({
        data: {
          id: failedId,
          schoolId: s.school.id,
          studentId: s.student.id,
          paymentAccountId: s.account.id,
          membershipPlanId: s.plan.id,
          amount: 1000,
          currency: 'GBP',
          status: 'FAILED',
          paymentMethod: 'CASH',
        },
      });
      const list = (query: Record<string, string>) =>
        http().get(`/v1/schools/${s.school.id}/transactions`).query(query).set('Authorization', `Bearer ${s.ownerToken}`);
      const all = await list({});
      const row = all.body.items.find((t: { id: string }) => t.id === p.body.transactionId);
      expect(row.cancelReason).toBe('No show');
      expect(row.cancelledByName).toBe('owner Tester');
      const failed = await list({ status: 'FAILED' });
      expect(failed.body.items.map((t: { id: string }) => t.id)).toEqual([failedId]);
      const cancelled = await list({ status: 'CANCELLED' });
      expect(cancelled.body.items.map((t: { id: string }) => t.id)).toEqual([p.body.transactionId]);
      const summary = await http().get(`/v1/schools/${s.school.id}/transactions/summary`).set('Authorization', `Bearer ${s.ownerToken}`);
      expect(summary.body).toMatchObject({ total: 2, failedOrDisputed: 1, cancelled: 1 });
      const cancelledSummary = await http()
        .get(`/v1/schools/${s.school.id}/transactions/summary`)
        .query({ status: 'CANCELLED' })
        .set('Authorization', `Bearer ${s.ownerToken}`);
      expect(cancelledSummary.body).toMatchObject({ total: 1, failedOrDisputed: 0, cancelled: 1 });
    });

    it("the student's Payments card lists it for staff who may cancel, and for no one else", async () => {
      const s = await seedSchool();
      const p = await buy(s);
      const card = (tok: string) => http().get(`/v1/schools/${s.school.id}/students/${s.student.id}/charges`).set('Authorization', `Bearer ${tok}`);
      // Branch Staff may create charges by default, but not cancel: no rows.
      const before = await card(s.staffToken);
      expect(before.status).toBe(200);
      expect(before.body.deskMembershipPayments).toEqual([]);
      await allowStaffToCancel(s);
      const pending = await card(s.staffToken);
      expect(pending.body.deskMembershipPayments).toEqual([
        expect.objectContaining({ id: p.body.transactionId, status: 'PENDING', membershipPlanTitle: '10-Class Pack', amount: 15000, currency: 'GBP' }),
      ]);
      await cancel(s, p.body.transactionId, s.staffToken, 'Paid elsewhere');
      const after = await card(s.ownerToken);
      expect(after.body.deskMembershipPayments).toEqual([
        expect.objectContaining({ id: p.body.transactionId, status: 'CANCELLED', cancelledByName: 'staff Tester', cancelReason: 'Paid elsewhere' }),
      ]);
    });
  });
});
