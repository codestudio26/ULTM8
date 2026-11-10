/**
 * Decision 441 item 2 — Branch Staff whose School lets them record payments
 * (Decision 347) can also confirm a member's Pix, cash or bank-transfer order
 * (PATCH /transactions/{id}/confirm), for their own branches' students only,
 * the scope of Record a payment (desk_payment_students()). Over real HTTP
 * against a real Postgres.
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

describeIfDb('Branch Staff confirm a member order (Decision 441 item 2)', () => {
  let app: INestApplication;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const TAG = 'staff-confirm-';

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

  async function seedSchool() {
    const school = await su.school.create({ data: { id: randomUUID(), name: `Staff confirm ${randomUUID().slice(0, 6)}`, defaultCurrency: 'BRL', addressCountry: 'BR' } });
    schoolIds.push(school.id);
    const branch = await su.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Centro' } });
    const otherBranch = await su.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Norte' } });
    const [owner, student, staff, otherStaff, coach] = await Promise.all(['owner', 'student', 'staff', 'other-staff', 'coach'].map(mkUser));
    await su.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: staff.id, schoolId: school.id, branchId: branch.id },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: otherStaff.id, schoolId: school.id, branchId: otherBranch.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: school.id, branchId: branch.id },
      ],
    });
    // A School that takes no cards (Brazil, Decision 437): cash and bank transfer only.
    const account = await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'BANK_TRANSFER', accountTitle: 'Pix', country: 'BR' } });
    const pack = await su.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '10 aulas', price: 10500, classesIncluded: 10, currency: 'BRL' },
    });
    return {
      school,
      branch,
      account,
      pack,
      owner,
      student,
      ownerToken: token(owner, 'SCHOOL_OWNER_MANAGER', school.id),
      studentToken: token(student, 'STUDENT', school.id),
      staffToken: token(staff, 'BRANCH_STAFF', school.id, branch.id),
      otherStaffToken: token(otherStaff, 'BRANCH_STAFF', school.id, otherBranch.id),
      coachToken: token(coach, 'INSTRUCTOR', school.id, branch.id),
    };
  }
  type Seeded = Awaited<ReturnType<typeof seedSchool>>;

  /** The member's Pix order, waiting for the School to confirm it. */
  const order = (s: Seeded, studentId = s.student.id) =>
    su.transaction.create({
      data: {
        id: randomUUID(), schoolId: s.school.id, studentId, paymentAccountId: s.account.id, membershipPlanId: s.pack.id,
        amount: 10500, currency: 'BRL', status: 'PENDING', paymentMethod: 'BANK_TRANSFER',
      },
    });

  /** The notices go through the notification-fanout job, so they land a
   * moment after the answer. */
  async function waitFor<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 8000): Promise<T> {
    const start = Date.now();
    for (;;) {
      const v = await fn();
      if (done(v) || Date.now() - start > timeoutMs) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const http = () => request(app.getHttpServer());
  const confirm = (id: string, tok: string) => http().patch(`/v1/transactions/${id}/confirm`).set('Authorization', `Bearer ${tok}`);
  const refusal = async (res: request.Test) => {
    const r = await res;
    return [r.status, r.body.error?.code];
  };
  const card = (s: Seeded, tok: string) => http().get(`/v1/schools/${s.school.id}/students/${s.student.id}/charges`).set('Authorization', `Bearer ${tok}`);
  const switchOn = (s: Seeded, on: boolean) => su.school.update({ where: { id: s.school.id }, data: { branchStaffCanRecordPayments: on } });
  const homeBranch = (s: Seeded) => su.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.school.id, studentId: s.student.id, branchId: s.branch.id } });

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
    await su.membership.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.studentHomeBranch.deleteMany({ where });
    await su.roleGrant.deleteMany({ where });
    await su.branch.deleteMany({ where });
    await su.user.deleteMany({ where: users });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await su.$disconnect();
  });

  it("Branch Staff confirm their own branch's student's order once the School lets them record payments", async () => {
    const s = await seedSchool();
    const tx = await order(s);

    // Switch on, but the student has no home branch yet: not theirs. Decision
    // 451 item 9 (Decision 449 item 6): the School's own staff are told they
    // have no permission, never "not found".
    await switchOn(s, true);
    expect(await refusal(confirm(tx.id, s.staffToken))).toEqual([403, 'NO_PERMISSION']);

    // Switch off: Branch Staff are told the School doesn't let them, as on Cancel.
    await homeBranch(s);
    await switchOn(s, false);
    expect(await refusal(confirm(tx.id, s.staffToken))).toEqual([403, 'STAFF_ACCESS_OFF']);
    const offCard = await card(s, s.staffToken);
    expect(offCard.status).toBe(200);
    expect(offCard.body.can.confirmPayment).toBe(false);
    expect(offCard.body.deskMembershipPayments).toEqual([]);

    await switchOn(s, true);
    // Another branch's staff and the branch's coach still can't.
    expect(await refusal(confirm(tx.id, s.otherStaffToken))).toEqual([403, 'NO_PERMISSION']);
    expect(await refusal(confirm(tx.id, s.coachToken))).toEqual([403, 'NOT_FOR_COACHES']);
    expect(await su.transaction.findUniqueOrThrow({ where: { id: tx.id } })).toMatchObject({ status: 'PENDING', membershipId: null });

    // The Payments card offers it to them.
    const onCard = await card(s, s.staffToken);
    expect(onCard.body.can.confirmPayment).toBe(true);
    expect(onCard.body.can.cancel).toBe(false);
    expect(onCard.body.deskMembershipPayments.map((p: { id: string; status: string }) => [p.id, p.status])).toEqual([[tx.id, 'PENDING']]);

    const res = await confirm(tx.id, s.staffToken);
    expect(res.status).toBe(200);
    expect(res.body.membershipCreated).toBe(true);
    const row = await su.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(row.status).toBe('SUCCESSFUL');
    const membership = await su.membership.findUniqueOrThrow({ where: { id: row.membershipId! } });
    expect(membership).toMatchObject({ studentId: s.student.id, membershipPlanId: s.pack.id, status: 'ACTIVE', classesRemaining: 10 });
    // The member is told, as when the owner confirms.
    expect(await waitFor(() => su.notification.count({ where: { userId: s.student.id } }), (n) => n > 0)).toBeGreaterThan(0);

    // Idempotent: a second click changes nothing.
    const again = await confirm(tx.id, s.staffToken);
    expect(again.status).toBe(200);
    expect(again.body.membershipCreated).toBe(false);
    expect(await su.membership.count({ where: { studentId: s.student.id, schoolId: s.school.id } })).toBe(1);
    // Still no view of the ledger itself (Decision 347 item 4).
    expect((await http().get(`/v1/schools/${s.school.id}/transactions`).set('Authorization', `Bearer ${s.staffToken}`)).status).toBe(403);
  });

  it('the owner still confirms, members still cannot, and other Schools never see the order', async () => {
    const s = await seedSchool();
    const other = await seedSchool();
    await switchOn(other, true);
    const tx = await order(s);
    expect((await confirm(tx.id, s.studentToken)).status).toBe(403);
    expect((await confirm(tx.id, other.staffToken)).status).toBe(404);
    expect((await confirm(tx.id, other.ownerToken)).status).toBe(404);
    expect((await card(s, s.ownerToken)).body.can.confirmPayment).toBe(true);
    const res = await confirm(tx.id, s.ownerToken);
    expect(res.status).toBe(200);
    expect(res.body.membershipCreated).toBe(true);
  });

  it('Branch Staff get the same refusals as the owner: a cancelled order, a student who left', async () => {
    const s = await seedSchool();
    await switchOn(s, true);
    await homeBranch(s);
    const cancelled = await order(s);
    await su.transaction.update({ where: { id: cancelled.id }, data: { status: 'FAILED', cancelledAt: new Date(), cancelledById: s.owner.id } });
    expect((await confirm(cancelled.id, s.staffToken)).status).toBe(409);

    const tx = await order(s);
    await su.roleGrant.updateMany({ where: { userId: s.student.id, schoolId: s.school.id, role: 'STUDENT' }, data: { revokedAt: new Date() } });
    // A student who has left is no longer one of theirs, as for Record a payment.
    expect(await refusal(confirm(tx.id, s.staffToken))).toEqual([403, 'NO_PERMISSION']);
    expect((await confirm(tx.id, s.ownerToken)).status).toBe(409);
    expect(await su.transaction.findUniqueOrThrow({ where: { id: tx.id } })).toMatchObject({ status: 'PENDING' });
  });

  it("round 6 P-2: a locked (deleting) member's waiting order can't be confirmed by staff or the owner; it can be cancelled, and confirmed again once the deletion is cancelled", async () => {
    const s = await seedSchool();
    await switchOn(s, true);
    await homeBranch(s);
    const tx = await order(s);
    const second = await order(s);
    const lock = (on: boolean) =>
      su.user.update({
        where: { id: s.student.id },
        data: on
          ? { deletionRequestedAt: new Date(), deletionDueAt: new Date(Date.now() + 30 * 86_400_000), deletionRequestedById: s.student.id }
          : { deletionRequestedAt: null, deletionDueAt: null, deletionRequestedById: null },
      });
    await lock(true);
    for (const tok of [s.staffToken, s.ownerToken]) {
      const res = await confirm(tx.id, tok);
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('ACCOUNT_CLOSING');
    }
    // No plan started, nothing sent to the member, the order still waiting.
    expect(await su.transaction.findUniqueOrThrow({ where: { id: tx.id } })).toMatchObject({ status: 'PENDING', membershipId: null });
    expect(await su.membership.count({ where: { studentId: s.student.id, schoolId: s.school.id } })).toBe(0);
    expect(await su.notification.count({ where: { userId: s.student.id } })).toBe(0);

    // Cancelling still works.
    const cancel = await http().patch(`/v1/transactions/${second.id}/cancel`).set('Authorization', `Bearer ${s.ownerToken}`).send({ reason: 'Member is leaving' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.cancelled).toBe(true);

    // Signing back in cancels the deletion: the order can be confirmed again.
    await lock(false);
    const res = await confirm(tx.id, s.staffToken);
    expect(res.status).toBe(200);
    expect(res.body.membershipCreated).toBe(true);
    // One "Payment confirmed", from this confirm only (and the cancel's notice).
    const confirmed = () => su.notification.findMany({ where: { userId: s.student.id, title: 'Payment confirmed' } });
    expect(await waitFor(confirmed, (n) => n.length > 0)).toHaveLength(1);
  });

  it('round 6 P-5: Branch Staff get back only the order id, status, amount and the membership it started; the owner gets the whole answer', async () => {
    const s = await seedSchool();
    await switchOn(s, true);
    await homeBranch(s);
    const tx = await order(s);
    const res = await confirm(tx.id, s.staffToken);
    expect(res.status).toBe(200);
    const membershipId = (await su.transaction.findUniqueOrThrow({ where: { id: tx.id } })).membershipId;
    expect(membershipId).toBeTruthy();
    expect(res.body).toEqual({ transaction: { id: tx.id, status: 'SUCCESSFUL', amount: 10500, membershipId }, membershipCreated: true });
    // The idempotent repeat is trimmed too.
    expect((await confirm(tx.id, s.staffToken)).body).toEqual({ transaction: { id: tx.id, status: 'SUCCESSFUL', amount: 10500, membershipId }, membershipCreated: false });

    const t = await seedSchool();
    const ownerTx = await order(t);
    const own = await confirm(ownerTx.id, t.ownerToken);
    expect(own.status).toBe(200);
    expect(own.body.transaction).toMatchObject({ id: ownerTx.id, paymentAccountId: t.account.id, currency: 'BRL' });
    expect(own.body.membership).toMatchObject({ studentId: t.student.id, status: 'ACTIVE' });
  });
});
