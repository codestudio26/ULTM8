/**
 * Decision 442 items 4 and 5, over real HTTP against a real Postgres.
 *
 * Item 4: the "Cash payment waiting" notice for a member's Pix, cash or
 * bank-transfer order also goes to the Branch Staff who may confirm it (the
 * School lets Branch Staff record payments, and the student is one of their
 * branches' students: mayConfirmDeskOrder, Decision 441 item 2), not only to
 * the owners.
 *
 * Item 5: freezing a monthly plan billed to the balance (Decision 441 item 1)
 * pauses its monthly charge as freezing a card Subscription does (Decision
 * 404): the next month moves later by the freeze's length, nothing is charged
 * inside the freeze, and ending the freeze early moves it back.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET, REDIS_URL.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ChargeRecurringProcessor } from '../src/jobs/charge-recurring.processor';
import { NOTIFICATION_FANOUT_QUEUE } from '../src/jobs/queue.constants';
import { addDays, occurrenceDay } from '../src/charges/recurring-schedule';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[order-notice-staff-and-freeze-pause.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const TAG = 'd442-';
const PRICE = 15000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
/** Noon UTC on a YYYY-MM-DD day (the Schools' zone is UTC). */
const noon = (day: string) => new Date(`${day}T12:00:00.000Z`);
const addMonths = (day: string, n: number) => occurrenceDay(day, 'MONTHLY', n);

describeIfDb('Decision 442 items 4 and 5', () => {
  let app: INestApplication;
  let job: ChargeRecurringProcessor;
  let notify: jest.SpyInstance;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];

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
  const http = () => request(app.getHttpServer());

  /** A School that takes no cards (Brazil, Decision 437): Pix and cash only. */
  async function mkSchool(name: string) {
    const school = await su.school.create({ data: { id: randomUUID(), name: `${name} ${randomUUID().slice(0, 6)}`, defaultCurrency: 'BRL', timezone: 'UTC', addressCountry: 'BR' } });
    schoolIds.push(school.id);
    await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'BANK_TRANSFER', accountTitle: 'Pix', country: 'BR' } });
    const owner = await mkUser('owner');
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true } });
    return { school, owner, ownerToken: token(owner, 'SCHOOL_OWNER_MANAGER', school.id) };
  }

  async function mkStudent(label: string, schoolId: string) {
    const user = await mkUser(label);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId } });
    return { user, token: token(user, 'STUDENT', schoolId) };
  }

  const buy = (planId: string, tok: string) => http().post(`/v1/membership-plans/${planId}/purchase`).set('Authorization', `Bearer ${tok}`).send({});

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    job = app.get(ChargeRecurringProcessor);
    notify = jest.spyOn(app.get<Queue>(getQueueToken(NOTIFICATION_FANOUT_QUEUE)), 'add').mockResolvedValue(undefined as never);
  });

  afterAll(async () => {
    await app.close();
    const where = { schoolId: { in: schoolIds } };
    await su.chargeAllocation.deleteMany({ where });
    await su.balanceEntry.deleteMany({ where });
    await su.transaction.deleteMany({ where });
    await su.charge.deleteMany({ where });
    await su.recurringCharge.deleteMany({ where });
    await su.membershipFreeze.deleteMany({ where });
    await su.membership.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.studentHomeBranch.deleteMany({ where });
    await su.notification.deleteMany({ where: { user: { email: { startsWith: TAG } } } });
    await su.roleGrant.deleteMany({ where });
    await su.branch.deleteMany({ where });
    await su.user.deleteMany({ where: { email: { startsWith: TAG } } });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await su.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Item 4: the "new order waiting" notice
  // ---------------------------------------------------------------------------

  describe('item 4: the order-waiting notice reaches the Branch Staff who may confirm it', () => {
    let s: Awaited<ReturnType<typeof mkSchool>>;
    let pack: { id: string };
    let north: { id: string };
    let staff: Person;
    let otherStaff: Person;
    let coach: Person;
    let foreignStaff: Person;

    /** Who was sent "Cash payment waiting" for this order, with each one's notice. */
    function waitingNotices(transactionId: string) {
      return notify.mock.calls
        .map((c) => c[1] as { notificationId: string; userId: string; title: string; body: string; targetType?: string; targetId?: string })
        .filter((d) => d.notificationId.startsWith(`cash-payment-waiting-${transactionId}-`));
    }

    async function order(label: string, homeBranchId: string | null) {
      const student = await mkStudent(label, s.school.id);
      if (homeBranchId) await su.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.school.id, studentId: student.user.id, branchId: homeBranchId } });
      const res = await buy(pack.id, student.token);
      expect(res.status).toBe(201);
      expect(res.body.outcome).toBe('pending_confirmation');
      return { student, transactionId: res.body.transactionId as string };
    }

    beforeAll(async () => {
      s = await mkSchool('Ordem');
      north = await su.branch.create({ data: { id: randomUUID(), schoolId: s.school.id, name: 'Norte' } });
      const south = await su.branch.create({ data: { id: randomUUID(), schoolId: s.school.id, name: 'Sul' } });
      [staff, otherStaff, coach] = await Promise.all(['staff', 'other-staff', 'coach'].map(mkUser));
      await su.roleGrant.createMany({
        data: [
          { id: randomUUID(), role: 'BRANCH_STAFF', userId: staff.id, schoolId: s.school.id, branchId: north.id },
          { id: randomUUID(), role: 'BRANCH_STAFF', userId: otherStaff.id, schoolId: s.school.id, branchId: south.id },
          { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: s.school.id, branchId: north.id },
        ],
      });
      // Branch Staff of another School, whose own switch is on: never told.
      const other = await mkSchool('Outra');
      const otherBranch = await su.branch.create({ data: { id: randomUUID(), schoolId: other.school.id, name: 'Norte' } });
      foreignStaff = await mkUser('foreign-staff');
      await su.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: foreignStaff.id, schoolId: other.school.id, branchId: otherBranch.id } });
      await su.school.update({ where: { id: other.school.id }, data: { branchStaffCanRecordPayments: true } });
      pack = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.school.id, type: 'CLASS_PACK', title: '10 aulas', price: 10500, classesIncluded: 10, currency: 'BRL' } });
    });

    beforeEach(async () => {
      notify.mockClear();
      await su.school.update({ where: { id: s.school.id }, data: { branchStaffCanRecordPayments: true } });
    });

    it("with the switch on, the student's own branch staff get it too, pointing to the student", async () => {
      const { student, transactionId } = await order('north-student', north.id);
      const notices = waitingNotices(transactionId);
      expect(notices.map((n) => n.userId).sort()).toEqual([s.owner.id, staff.id].sort());
      const owner = notices.find((n) => n.userId === s.owner.id)!;
      expect(owner).toMatchObject({ title: 'Cash payment waiting', targetType: 'PAYMENT' });
      expect(owner.body).toContain('Mark it as paid on the Transactions page');
      const forStaff = notices.find((n) => n.userId === staff.id)!;
      expect(forStaff).toMatchObject({ title: 'Cash payment waiting', targetType: 'STUDENT', targetId: student.user.id });
      expect(forStaff.body).toBe(`north-student Tester chose to pay 105.00 BRL for 10 aulas by cash or bank transfer. Mark it as paid on their Payments card once the money arrives.`);
      // The staff member told can indeed confirm it.
      const confirmed = await http().patch(`/v1/transactions/${transactionId}/confirm`).set('Authorization', `Bearer ${token(staff, 'BRANCH_STAFF', s.school.id, north.id)}`);
      expect(confirmed.status).toBe(200);
    });

    it('with the switch off, only the owners are told', async () => {
      await su.school.update({ where: { id: s.school.id }, data: { branchStaffCanRecordPayments: false } });
      const { transactionId } = await order('switch-off', north.id);
      expect(waitingNotices(transactionId).map((n) => n.userId)).toEqual([s.owner.id]);
    });

    it('a student with no home branch is the owners\' to confirm: only they are told', async () => {
      const { transactionId } = await order('no-branch', null);
      expect(waitingNotices(transactionId).map((n) => n.userId)).toEqual([s.owner.id]);
    });

    it('paused or removed staff are not told', async () => {
      await su.roleGrant.updateMany({ where: { userId: staff.id, schoolId: s.school.id }, data: { revokedAt: new Date() } });
      try {
        const { transactionId } = await order('staff-gone', north.id);
        expect(waitingNotices(transactionId).map((n) => n.userId)).toEqual([s.owner.id]);
      } finally {
        await su.roleGrant.updateMany({ where: { userId: staff.id, schoolId: s.school.id }, data: { revokedAt: null } });
      }
    });

    it('never coaches, staff of other branches, or staff of another School', async () => {
      const { transactionId } = await order('scoped', north.id);
      const told = waitingNotices(transactionId).map((n) => n.userId);
      expect(told).not.toContain(coach.id);
      expect(told).not.toContain(otherStaff.id);
      expect(told).not.toContain(foreignStaff.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Item 5: freezing a monthly plan billed to the balance
  // ---------------------------------------------------------------------------

  describe('item 5: freezing a monthly plan billed to the balance pauses its monthly charge', () => {
    let s: Awaited<ReturnType<typeof mkSchool>>;
    let monthly: { id: string };

    const seriesOf = (membershipId: string) => su.recurringCharge.findUniqueOrThrow({ where: { membershipId } });
    const chargesOf = (seriesId: string) => su.charge.findMany({ where: { recurringChargeId: seriesId }, orderBy: { dueDate: 'asc' } });
    const freeze = (membershipId: string, startsAt: string, endsAt: string) =>
      http().post(`/v1/schools/${s.school.id}/memberships/${membershipId}/freezes`).set('Authorization', `Bearer ${s.ownerToken}`).send({ startsAt, endsAt });
    const endFreeze = (freezeId: string) => http().post(`/v1/schools/${s.school.id}/freezes/${freezeId}/end`).set('Authorization', `Bearer ${s.ownerToken}`);

    /** Buys the monthly plan in the app and has the owner confirm it: the
     * months after the first are on the balance. */
    async function member(label: string) {
      const student = await mkStudent(label, s.school.id);
      const res = await buy(monthly.id, student.token);
      expect(res.status).toBe(201);
      expect((await http().patch(`/v1/transactions/${res.body.transactionId}/confirm`).set('Authorization', `Bearer ${s.ownerToken}`)).status).toBe(200);
      const membership = await su.membership.findFirstOrThrow({ where: { studentId: student.user.id } });
      expect(membership.billedToBalance).toBe(true);
      const series = await seriesOf(membership.id);
      return { student, membership, series, next: dayOf(series.nextDate!) };
    }

    beforeAll(async () => {
      s = await mkSchool('Mensal');
      monthly = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.school.id, type: 'SUBSCRIPTION', title: 'Mensal', price: PRICE, currency: 'BRL' } });
    });

    it('the next month moves later by the freeze length; nothing is charged inside it; the months after follow from the new day', async () => {
      const { membership, series, next } = await member('paused');
      const startsAt = addDays(next, -5);
      const endsAt = addDays(startsAt, 30);
      const res = await freeze(membership.id, startsAt, endsAt);
      expect(res.status).toBe(201);

      const moved = await seriesOf(membership.id);
      const resumes = addDays(next, 30);
      expect(dayOf(moved.nextDate!)).toBe(resumes);
      expect(await su.membershipFreeze.findUniqueOrThrow({ where: { id: res.body.id } })).toMatchObject({ billingShiftAppliedAt: expect.any(Date), billingRestoredAt: null });

      // The old billing day and every day of the freeze: nothing.
      await job.run(noon(next));
      await job.run(noon(addDays(endsAt, -1)));
      expect(await chargesOf(series.id)).toHaveLength(0);

      // Billing resumes on the moved day, then monthly from it.
      await job.run(noon(resumes));
      await job.run(noon(addMonths(resumes, 1)));
      const charges = await chargesOf(series.id);
      expect(charges.map((c) => dayOf(c.dueDate))).toEqual([resumes, addMonths(resumes, 1)]);
      expect(charges.every((c) => c.grossAmount === PRICE)).toBe(true);

      // A second run changes nothing (the move is made once).
      await job.run(noon(addMonths(resumes, 1)));
      expect(await chargesOf(series.id)).toHaveLength(2);
    });

    it('a month due before the first frozen day is charged first; the month after it moves', async () => {
      const { membership, series, next } = await member('renewal-first');
      const startsAt = addDays(next, 2);
      const endsAt = addDays(startsAt, 14);
      expect((await freeze(membership.id, startsAt, endsAt)).status).toBe(201);
      // Nothing moves yet: the month on `next` falls before the freeze.
      expect(dayOf((await seriesOf(membership.id)).nextDate!)).toBe(next);

      await job.run(noon(next));
      const moved = addDays(addMonths(dayOf(series.firstDate), 2), 14);
      expect(dayOf((await seriesOf(membership.id)).nextDate!)).toBe(moved);
      await job.run(noon(addMonths(dayOf(series.firstDate), 2)));
      await job.run(noon(moved));
      expect((await chargesOf(series.id)).map((c) => dayOf(c.dueDate))).toEqual([next, moved]);
    });

    it('ending the freeze early moves the month back: here, ended before it started, to where it was', async () => {
      const { membership, series, next } = await member('ended-early');
      const startsAt = addDays(next, -5);
      const res = await freeze(membership.id, startsAt, addDays(startsAt, 30));
      expect(res.status).toBe(201);
      expect(dayOf((await seriesOf(membership.id)).nextDate!)).toBe(addDays(next, 30));

      const ended = await endFreeze(res.body.id);
      expect(ended.status).toBe(201);
      expect(dayOf((await seriesOf(membership.id)).nextDate!)).toBe(next);
      expect(await su.membershipFreeze.findUniqueOrThrow({ where: { id: res.body.id } })).toMatchObject({ billingRestoredAt: expect.any(Date) });

      await job.run(noon(next));
      expect((await chargesOf(series.id)).map((c) => dayOf(c.dueDate))).toEqual([next]);
    });

    it('cancelling during a freeze ends the plan on the moved billing day', async () => {
      const { student, membership, series, next } = await member('cancel-frozen');
      const startsAt = addDays(next, -5);
      expect((await freeze(membership.id, startsAt, addDays(startsAt, 30))).status).toBe(201);
      const resumes = addDays(next, 30);
      const cancelled = await http().post(`/v1/memberships/${membership.id}/cancel`).set('Authorization', `Bearer ${student.token}`).send({});
      expect(cancelled.status).toBe(201);
      expect(cancelled.body.cancelAt).toBe(new Date(`${resumes}T00:00:00.000Z`).toISOString());
      await job.run(noon(resumes));
      expect(await chargesOf(series.id)).toHaveLength(0);
    });

    it('the charge-recurring job applies a freeze the approval could not (a series set up late)', async () => {
      const { membership, series, next } = await member('healed-late');
      await su.recurringCharge.delete({ where: { id: series.id } });
      const startsAt = addDays(next, -5);
      expect((await freeze(membership.id, startsAt, addDays(startsAt, 30))).status).toBe(201);
      // The job sets the series up and moves it before it charges anything.
      await job.run(noon(next));
      const again = await seriesOf(membership.id);
      expect(dayOf(again.nextDate!)).toBe(addDays(next, 30));
      expect(await chargesOf(again.id)).toHaveLength(0);
    });
  });
});
