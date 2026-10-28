import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PaymentsService } from '../src/payments/payments.service';

/**
 * Decision 381 — a late cancellation charges the Class's own cancellation
 * charge, or, when the Class has none, the charge on the plan the Booking
 * used. One fee per Booking. Stripe's off-session charge is stubbed; the rest
 * runs against a real Postgres.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[late-cancellation-plan-fee.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const HOUR = 60 * 60 * 1000;

describeIfDb('Late-cancellation fee from the plan (Decision 381)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  const userIds: string[] = [];
  let chargeOffSession: jest.SpyInstance;

  async function mkStudent() {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `late-cancel-plan-fee-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Late',
        surname: 'Canceller',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId: school.id } });
    const token = jwt.sign({ sub: user.id, email: user.email, grants: [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }] });
    return { user, token };
  }

  /** A Class Pack on a plan with the given charge, and a Class starting tomorrow. */
  async function setUp(opts: { planCharge: number | null; classCharge: number | null; pastCutoff?: boolean }) {
    const { user, token } = await mkStudent();
    const plan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, title: `Pack ${randomUUID().slice(0, 6)}`, type: 'CLASS_PACK', price: 6000, currency: 'GBP', classesIncluded: 10, cancellationCharge: opts.planCharge },
    });
    await superuser.membership.create({
      data: { id: randomUUID(), studentId: user.id, membershipPlanId: plan.id, schoolId: school.id, frequency: 'ONE_TIME', classesRemaining: 10 },
    });
    const start = new Date(Date.now() + 24 * HOUR);
    const cls = await superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        title: 'Evening class',
        membershipInclusion: true,
        startDate: start,
        endDate: new Date(start.getTime() + HOUR),
        refundFeeDate: opts.pastCutoff === false ? new Date(start.getTime() - HOUR) : new Date(Date.now() - HOUR),
        cancellationCharge: opts.classCharge,
      },
    });
    const booked = await http().post(`/v1/classes/${cls.id}/book`).set('Authorization', `Bearer ${token}`).send({});
    expect(booked.status).toBe(201);
    return { user, token, bookingId: booked.body.id as string };
  }

  const http = () => request(app.getHttpServer());
  const cancel = (bookingId: string, token: string) => http().patch(`/v1/bookings/${bookingId}/cancel`).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);

    chargeOffSession = jest.spyOn(app.get(PaymentsService), 'chargeOffSession')
      .mockImplementation(async () => ({ succeeded: true, paymentIntentId: `pi_${randomUUID()}` }));

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Late Cancel Plan Fee School', cancellationPolicyChosenAt: new Date() } });
    await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: 'acct_fixture' },
    });
  });

  beforeEach(() => chargeOffSession.mockClear());

  afterAll(async () => {
    const where = { schoolId: school.id };
    await superuser.transaction.deleteMany({ where });
    await superuser.bookingAttendee.deleteMany({ where: { booking: { schoolId: school.id } } });
    await superuser.booking.deleteMany({ where });
    await superuser.class.deleteMany({ where });
    await superuser.membership.deleteMany({ where });
    await superuser.membershipPlan.deleteMany({ where });
    await superuser.paymentAccount.deleteMany({ where });
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it("charges the plan's fee, in the plan's currency, when the Class has none", async () => {
    const { user, token, bookingId } = await setUp({ planCharge: 700, classCharge: null });
    const res = await cancel(bookingId, token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cancellationChargeOutcome: 'CHARGED', cancellationChargeAmount: 700 });
    expect(chargeOffSession).toHaveBeenCalledTimes(1);
    expect(chargeOffSession).toHaveBeenCalledWith(user.id, school.id, 700, 'GBP', 'Late-cancellation fee');
    const tx = await superuser.transaction.findFirstOrThrow({ where: { bookingId } });
    expect(tx).toMatchObject({ kind: 'LATE_CANCEL_FEE', amount: 700, currency: 'GBP', status: 'SUCCESSFUL' });
  });

  it("charges only the Class's own fee when both have one", async () => {
    const { token, bookingId } = await setUp({ planCharge: 700, classCharge: 500 });
    const res = await cancel(bookingId, token);
    expect(res.body).toMatchObject({ cancellationChargeOutcome: 'CHARGED', cancellationChargeAmount: 500 });
    expect(chargeOffSession).toHaveBeenCalledTimes(1);
    expect(chargeOffSession.mock.calls[0][2]).toBe(500);
  });

  it('charges nothing when the Class sets its charge to 0, or neither has one', async () => {
    for (const fees of [{ planCharge: 700, classCharge: 0 }, { planCharge: null, classCharge: null }]) {
      const { token, bookingId } = await setUp(fees);
      const res = await cancel(bookingId, token);
      expect(res.status).toBe(200);
      expect(res.body.cancellationChargeOutcome).toBeNull();
    }
    expect(chargeOffSession).not.toHaveBeenCalled();
  });

  it("charges nothing before the cutoff, or when the School's late-fee switch is off", async () => {
    const early = await setUp({ planCharge: 700, classCharge: null, pastCutoff: false });
    expect((await cancel(early.bookingId, early.token)).body.cancellationChargeOutcome).toBeNull();

    await superuser.school.update({ where: { id: school.id }, data: { chargeLateCancellationFee: false } });
    try {
      const late = await setUp({ planCharge: 700, classCharge: null });
      expect((await cancel(late.bookingId, late.token)).body.cancellationChargeOutcome).toBeNull();
    } finally {
      await superuser.school.update({ where: { id: school.id }, data: { chargeLateCancellationFee: true } });
    }
    expect(chargeOffSession).not.toHaveBeenCalled();
  });
});
