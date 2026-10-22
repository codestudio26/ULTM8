/**
 * Decision 291 — the School's "Class cancellations" settings, over real HTTP:
 * the policy (Manual / Auto-refund / Auto-credit), when it applies (before the
 * cutoff or any time), the late fee switch, the School's default cutoff, the
 * cancel-whole-class action, and the staff "to resolve" list — plus the two
 * fixed rules (a Friend Pass only ever gets its credit back; only an
 * Owner/Manager can send money back).
 *
 * Stripe itself is not reached: PaymentsService.refundPayment is spied on, the
 * same "prove the HTTP surface and RLS, not the vendor" boundary every other
 * e2e spec here keeps. Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Prisma, PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PaymentsService } from '../src/payments/payments.service';
import { BookingNoShowProcessingProcessor } from '../src/jobs/booking-no-show-processing.processor';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[class-cancellation-policy.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

describeIfDb('Decision 291 — class cancellation settings', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  let refundSpy: jest.SpyInstance;
  let chargeSpy: jest.SpyInstance;
  let noShowProcessor: BookingNoShowProcessingProcessor;

  let school: { id: string };
  let paymentAccountId: string;
  let owner: { id: string; email: string };
  let staff: { id: string; email: string };
  let instructor: { id: string; email: string };
  let student: { id: string; email: string };
  let tokenOwner: string;
  let tokenStaff: string;
  let tokenInstructor: string;
  let tokenStudent: string;
  let packPlanId: string;
  let thirdsPlanId: string;
  let friendPlanId: string;

  const sign = (user: { id: string; email: string }, role: string) =>
    jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId: null }] });

  const setSchool = (data: Prisma.SchoolUpdateInput) => superuser.school.update({ where: { id: school.id }, data });

  async function mkClass(extra: Partial<Prisma.ClassUncheckedCreateInput> = {}) {
    const start = new Date(Date.now() + 24 * 3_600_000);
    return superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: `Class ${randomUUID().slice(0, 6)}`, startDate: start, endDate: new Date(start.getTime() + 3_600_000), ...extra },
    });
  }

  /** A fresh paid Class Pack for `student`, with its purchase Transaction. */
  async function mkPack(opts: { planId?: string; method?: 'CASH' | 'STRIPE'; amount?: number; classes?: number } = {}) {
    const membership = await superuser.membership.create({
      data: { id: randomUUID(), studentId: student.id, membershipPlanId: opts.planId ?? packPlanId, schoolId: school.id, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: opts.classes ?? 5 },
    });
    if (opts.amount !== 0) {
      await superuser.transaction.create({
        data: {
          id: randomUUID(),
          schoolId: school.id,
          studentId: student.id,
          paymentAccountId,
          membershipPlanId: opts.planId ?? packPlanId,
          membershipId: membership.id,
          amount: opts.amount ?? 3000,
          status: 'SUCCESSFUL',
          paymentMethod: opts.method ?? 'CASH',
          stripePaymentIntentId: opts.method === 'STRIPE' ? `pi_${randomUUID()}` : null,
        },
      });
    }
    return membership;
  }

  async function book(classId: string, token = tokenStudent) {
    const res = await request(app.getHttpServer()).post(`/v1/classes/${classId}/book`).set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  const cancel = (bookingId: string, token = tokenStudent) =>
    request(app.getHttpServer()).patch(`/v1/bookings/${bookingId}/cancel`).set('Authorization', `Bearer ${token}`).send({});

  const credits = async (membershipId: string) => (await superuser.membership.findUniqueOrThrow({ where: { id: membershipId } })).classesRemaining;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    refundSpy = jest.spyOn(moduleRef.get(PaymentsService), 'refundPayment').mockResolvedValue('re_test_refund');
    chargeSpy = jest.spyOn(moduleRef.get(PaymentsService), 'chargeOffSession').mockResolvedValue({ succeeded: true, paymentIntentId: 'pi_test_no_show' });
    noShowProcessor = moduleRef.get(BookingNoShowProcessingProcessor);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Cancellation Policy School' } });
    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `cancel-policy-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Tester',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
    owner = await mkUser('owner');
    staff = await mkUser('staff');
    instructor = await mkUser('instructor');
    student = await mkUser('student');
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: staff.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: instructor.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id },
      ],
    });
    tokenOwner = sign(owner, 'SCHOOL_OWNER_MANAGER');
    tokenStaff = sign(staff, 'BRANCH_STAFF');
    tokenInstructor = sign(instructor, 'INSTRUCTOR');
    tokenStudent = sign(student, 'STUDENT');

    paymentAccountId = (
      await superuser.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'CASH', accountTitle: 'Front desk', country: 'GB' } })
    ).id;
    packPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '5-Class Pack', price: 3000, classesIncluded: 5, currency: 'gbp' } })).id;
    thirdsPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '3-Class Pack', price: 1000, classesIncluded: 3 } })).id;
    friendPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'FRIEND_PASS', title: 'Friend Pass', price: 0, classesIncluded: 1 } })).id;
  });

  // Each test owns its pack; drop any still-active ones so selection is deterministic.
  beforeEach(async () => {
    await superuser.membership.updateMany({ where: { studentId: student.id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
    await setSchool({ classCancellationPolicy: 'MANUAL', classCancellationPolicyWindow: 'BEFORE_CUTOFF', chargeLateCancellationFee: true, schoolCancelledClassResolution: 'CREDIT_ALL', defaultRefundCutoffHours: null, noShowFee: null });
  });

  afterAll(async () => {
    const userIds = (await superuser.user.findMany({ where: { email: { contains: 'cancel-policy-' } }, select: { id: true } })).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.waitlistEntry.deleteMany({ where: { schoolId: school.id } });
    await superuser.transaction.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.paymentAccount.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('School settings round-trip through PATCH /schools/:id, with Manual / before-cutoff / charge / credit-all / no default cutoff / no no-show fee as defaults', async () => {
    const fresh = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(fresh.noShowFee).toBeNull();
    const res = await request(app.getHttpServer())
      .patch(`/v1/schools/${school.id}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ classCancellationPolicyWindow: 'ANY_TIME', chargeLateCancellationFee: false, schoolCancelledClassResolution: 'FOLLOW_POLICY', defaultRefundCutoffHours: 12, noShowFee: 500 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ classCancellationPolicy: 'MANUAL', classCancellationPolicyWindow: 'ANY_TIME', chargeLateCancellationFee: false, schoolCancelledClassResolution: 'FOLLOW_POLICY', defaultRefundCutoffHours: 12, noShowFee: 500 });
    const cleared = await request(app.getHttpServer()).patch(`/v1/schools/${school.id}`).set('Authorization', `Bearer ${tokenOwner}`).send({ defaultRefundCutoffHours: null, noShowFee: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.defaultRefundCutoffHours).toBeNull();
    expect(cleared.body.noShowFee).toBeNull();
  });

  it('Manual: the seat waits for staff (no credit back yet), shows in the list, and the Owner can give the credit back', async () => {
    const pack = await mkPack();
    const cls = await mkClass();
    const booking = await book(cls.id);
    expect(await credits(pack.id)).toBe(4);

    const res = await cancel(booking.id);
    expect(res.status).toBe(200);
    expect(res.body.refundResolution).toBe('PENDING');
    expect(await credits(pack.id)).toBe(4);

    const list = await request(app.getHttpServer()).get(`/v1/schools/${school.id}/cancellations`).set('Authorization', `Bearer ${tokenOwner}`);
    expect(list.status).toBe(200);
    const row = list.body.find((r: { bookingId: string }) => r.bookingId === booking.id);
    expect(row).toMatchObject({ resolution: 'PENDING', planTitle: '5-Class Pack', paymentMethod: 'CASH', studentName: 'student Tester' });

    const resolved = await request(app.getHttpServer()).patch(`/v1/bookings/${booking.id}/resolution`).set('Authorization', `Bearer ${tokenOwner}`).send({ action: 'CREDIT' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.refundResolution).toBe('REFUNDED');
    expect(await credits(pack.id)).toBe(5);

    const again = await request(app.getHttpServer()).patch(`/v1/bookings/${booking.id}/resolution`).set('Authorization', `Bearer ${tokenOwner}`).send({ action: 'KEEP' });
    expect(again.status).toBe(409);
  });

  it('Branch Staff see the list without plan/payment details, may give credit back, but may not refund money; Instructors and Students may not use the list', async () => {
    await mkPack();
    const booking = await book((await mkClass()).id);
    await cancel(booking.id);

    const list = await request(app.getHttpServer()).get(`/v1/schools/${school.id}/cancellations`).set('Authorization', `Bearer ${tokenStaff}`);
    expect(list.status).toBe(200);
    const row = list.body.find((r: { bookingId: string }) => r.bookingId === booking.id);
    expect(row.planTitle).toBeNull();
    expect(row.paymentMethod).toBeNull();

    const refund = await request(app.getHttpServer()).patch(`/v1/bookings/${booking.id}/resolution`).set('Authorization', `Bearer ${tokenStaff}`).send({ action: 'REFUND' });
    expect(refund.status).toBe(403);
    for (const token of [tokenInstructor, tokenStudent]) {
      const res = await request(app.getHttpServer()).get(`/v1/schools/${school.id}/cancellations`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    }
    const credit = await request(app.getHttpServer()).patch(`/v1/bookings/${booking.id}/resolution`).set('Authorization', `Bearer ${tokenStaff}`).send({ action: 'CREDIT' });
    expect(credit.status).toBe(200);
  });

  it('Auto-refund, paid in cash: one class\'s share is owed (credit not also restored), and the Owner marks it paid', async () => {
    await setSchool({ classCancellationPolicy: 'AUTO_REFUND' });
    const pack = await mkPack();
    const booking = await book((await mkClass()).id);
    const res = await cancel(booking.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ refundResolution: 'REFUND_OWED', refundAmount: 600 });
    expect(await credits(pack.id)).toBe(4);

    const staffPaid = await request(app.getHttpServer()).patch(`/v1/bookings/${booking.id}/resolution`).set('Authorization', `Bearer ${tokenStaff}`).send({ action: 'MARK_PAID' });
    expect(staffPaid.status).toBe(403);
    const paid = await request(app.getHttpServer()).patch(`/v1/bookings/${booking.id}/resolution`).set('Authorization', `Bearer ${tokenOwner}`).send({ action: 'MARK_PAID' });
    expect(paid.status).toBe(200);
    expect(paid.body.refundResolution).toBe('MONEY_REFUNDED');
    const txn = await superuser.transaction.findFirstOrThrow({ where: { membershipId: pack.id } });
    expect(txn.refundedAmount).toBe(600);
  });

  it('Auto-refund shares are cumulative and rounded once: a £10.00 3-class pack refunds 333, then 334', async () => {
    await setSchool({ classCancellationPolicy: 'AUTO_REFUND' });
    await mkPack({ planId: thirdsPlanId, amount: 1000, classes: 3 });
    const first = await cancel((await book((await mkClass()).id)).id);
    const second = await cancel((await book((await mkClass()).id)).id);
    expect(first.body.refundAmount).toBe(333);
    expect(second.body.refundAmount).toBe(334);
  });

  it('Auto-refund, paid by card: Stripe is asked for exactly the share, keyed by the booking, and the seat is MONEY_REFUNDED', async () => {
    await setSchool({ classCancellationPolicy: 'AUTO_REFUND' });
    refundSpy.mockClear();
    const pack = await mkPack({ method: 'STRIPE' });
    const booking = await book((await mkClass()).id);
    const res = await cancel(booking.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ refundResolution: 'MONEY_REFUNDED', refundAmount: 600 });
    expect(refundSpy).toHaveBeenCalledWith(student.id, school.id, expect.stringMatching(/^pi_/), 600, `booking-refund-${booking.id}`);
    const txn = await superuser.transaction.findFirstOrThrow({ where: { membershipId: pack.id } });
    expect(txn.refundedAmount).toBe(600);
  });

  it('Auto-refund triggered by Branch Staff or an Instructor waits for the Owner instead (fixed rule)', async () => {
    await setSchool({ classCancellationPolicy: 'AUTO_REFUND' });
    await mkPack();
    const booking = await book((await mkClass()).id);
    const res = await cancel(booking.id, tokenInstructor);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ refundResolution: 'PENDING', refundAmount: 600 });
  });

  it('A Friend Pass always gets its credit back, even under Auto-refund (fixed rule)', async () => {
    await setSchool({ classCancellationPolicy: 'AUTO_REFUND' });
    const pass = await mkPack({ planId: friendPlanId, amount: 0, classes: 1 });
    const res = await cancel((await book((await mkClass()).id)).id);
    expect(res.body.refundResolution).toBe('REFUNDED');
    expect(await credits(pass.id)).toBe(1);
  });

  it('Past the cutoff: kept when the policy applies before the cutoff only; credited when it applies any time; the late fee follows its own switch', async () => {
    await setSchool({ classCancellationPolicy: 'AUTO_CREDIT', chargeLateCancellationFee: false });
    await mkPack();
    const past = new Date(Date.now() - 3_600_000);
    const kept = await cancel((await book((await mkClass({ refundFeeDate: past, cancellationCharge: 1000 })).id)).id);
    expect(kept.body.refundResolution).toBe('WITHHELD');
    // Fee switched off: no charge was even attempted.
    expect(kept.body.cancellationChargeOutcome).toBeNull();

    await setSchool({ classCancellationPolicyWindow: 'ANY_TIME' });
    const credited = await cancel((await book((await mkClass({ refundFeeDate: past })).id)).id);
    expect(credited.body.refundResolution).toBe('REFUNDED');
  });

  it('The School\'s default cutoff applies to a class that has none of its own', async () => {
    await setSchool({ classCancellationPolicy: 'AUTO_CREDIT', defaultRefundCutoffHours: 48 });
    await mkPack();
    // Starts in 24h, so a 48h default cutoff has already passed.
    const res = await cancel((await book((await mkClass()).id)).id);
    expect(res.body.refundResolution).toBe('WITHHELD');
  });

  it('Cancel whole class: Owner/Branch Staff only, every booking resolved by the class setting, waitlist closed, no rebooking, no second cancel', async () => {
    await setSchool({ classCancellationPolicy: 'MANUAL', schoolCancelledClassResolution: 'CREDIT_ALL' });
    const pack = await mkPack();
    const cls = await mkClass({ capacity: 1 });
    const booking = await book(cls.id);
    const waiter = await superuser.waitlistEntry.create({ data: { id: randomUUID(), classId: cls.id, schoolId: school.id, studentId: owner.id, position: 1 } });

    for (const token of [tokenInstructor, tokenStudent]) {
      const res = await request(app.getHttpServer()).post(`/v1/classes/${cls.id}/cancel`).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(403);
    }
    const res = await request(app.getHttpServer()).post(`/v1/classes/${cls.id}/cancel`).set('Authorization', `Bearer ${tokenStaff}`).send({ reason: 'Coach is ill' });
    expect(res.status).toBe(201);
    expect(res.body.cancellationReason).toBe('Coach is ill');
    expect(res.body.cancelledAt).toBeTruthy();

    const after = await superuser.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(after).toMatchObject({ status: 'CANCELLED', refundResolution: 'REFUNDED', cancellationChargeOutcome: null });
    expect(await credits(pack.id)).toBe(5);
    expect((await superuser.waitlistEntry.findUniqueOrThrow({ where: { id: waiter.id } })).status).toBe('CANCELLED');

    const rebook = await request(app.getHttpServer()).post(`/v1/classes/${cls.id}/book`).set('Authorization', `Bearer ${tokenStudent}`).send({});
    expect(rebook.status).toBe(409);
    const twice = await request(app.getHttpServer()).post(`/v1/classes/${cls.id}/cancel`).set('Authorization', `Bearer ${tokenOwner}`).send({});
    expect(twice.status).toBe(409);
  });

  it('Cancel whole class with "refund everyone" by Branch Staff leaves the refunds for the Owner (fixed rule); by the Owner they go straight through', async () => {
    await setSchool({ schoolCancelledClassResolution: 'REFUND_ALL' });
    await mkPack();
    const byStaff = await mkClass();
    const b1 = await book(byStaff.id);
    await request(app.getHttpServer()).post(`/v1/classes/${byStaff.id}/cancel`).set('Authorization', `Bearer ${tokenStaff}`).send({});
    expect(await superuser.booking.findUniqueOrThrow({ where: { id: b1.id } })).toMatchObject({ refundResolution: 'PENDING', refundAmount: 600 });

    const byOwner = await mkClass();
    const b2 = await book(byOwner.id);
    await request(app.getHttpServer()).post(`/v1/classes/${byOwner.id}/cancel`).set('Authorization', `Bearer ${tokenOwner}`).send({});
    expect((await superuser.booking.findUniqueOrThrow({ where: { id: b2.id } })).refundResolution).toBe('REFUND_OWED');

    // The Owner can now refund the one Branch Staff couldn't.
    const refund = await request(app.getHttpServer()).patch(`/v1/bookings/${b1.id}/resolution`).set('Authorization', `Bearer ${tokenOwner}`).send({ action: 'REFUND' });
    expect(refund.status).toBe(200);
    expect(refund.body.refundResolution).toBe('REFUND_OWED');
  });

  it('No-show fee: charged to the saved card only when the School sets one, recorded on the booking', async () => {
    const pack = await mkPack();
    const ended = async () => {
      const start = new Date(Date.now() - 3 * 3_600_000);
      const cls = await mkClass({ startDate: start, endDate: new Date(start.getTime() + 3_600_000) });
      return superuser.booking.create({ data: { id: randomUUID(), studentId: student.id, classId: cls.id, schoolId: school.id, sourceMembershipId: pack.id, status: 'UPCOMING' } });
    };
    const noFee = await ended();
    await noShowProcessor.process({} as never);
    expect(await superuser.booking.findUniqueOrThrow({ where: { id: noFee.id } })).toMatchObject({ status: 'NO_SHOW', noShowFeeOutcome: null, noShowFeeAmount: null });
    expect(chargeSpy.mock.calls.filter((c) => c[1] === school.id)).toHaveLength(0);

    await setSchool({ noShowFee: 500 });
    const withFee = await ended();
    await noShowProcessor.process({} as never);
    expect(await superuser.booking.findUniqueOrThrow({ where: { id: withFee.id } })).toMatchObject({
      status: 'NO_SHOW',
      noShowFeeOutcome: 'CHARGED',
      noShowFeeAmount: 500,
      stripeNoShowPaymentIntentId: 'pi_test_no_show',
    });
    expect(chargeSpy.mock.calls.filter((c) => c[1] === school.id)).toEqual([[student.id, school.id, 500, expect.any(String), 'No-show fee']]);

    // A second sweep never charges the same booking twice.
    await noShowProcessor.process({} as never);
    expect(chargeSpy.mock.calls.filter((c) => c[1] === school.id)).toHaveLength(1);
    await setSchool({ noShowFee: null });
  });
});
