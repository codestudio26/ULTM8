import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { StepUpService } from '../src/auth/step-up.service';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';
import { PrismaAppService } from '../src/common/prisma/prisma-app.service';
import { MembershipsService } from '../src/memberships/memberships.service';
import { MembershipFreezesService } from '../src/memberships/freeze/membership-freezes.service';
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';
import { ChargeAutoPayProcessor } from '../src/jobs/charge-auto-pay.processor';
import { BookingNoShowProcessingProcessor } from '../src/jobs/booking-no-show-processing.processor';
import { PlanSwitchProcessor } from '../src/jobs/plan-switch.processor';
import { PlanWaitlistProcessor } from '../src/jobs/plan-waitlist.processor';

/**
 * Decision 447 items 4-5 (the follow-ups of #518), over a real Postgres with
 * Stripe faked:
 *
 * - item 4: no-show fees, freeze fees, saved-card purchases and plan switches
 *   are written (Pending, or for a no-show fee its Booking's amount) before
 *   the card is charged and tagged on the PaymentIntent (metadata and
 *   idempotency key). A crash after Stripe answered (simulated: the first
 *   database write after Stripe's answer throws, as a worker killed then never
 *   makes it) loses nothing: Stripe's webhook, or charge-auto-pay's
 *   stale-attempt sweep, settles it, and a purchase's Membership is created
 *   exactly once whichever gets there first.
 * - item 5: the waiting-list offer and the plan switch take the plan's lock
 *   (lockPlanPlaces) and count its member limit again inside: shown by holding
 *   the lock while another place is taken, then letting go.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET && process.env.REDIS_URL);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[off-session-crash-safety.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET / REDIS_URL not set.');
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const isoDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

type MadeIntent = { id: string; status: string; customer?: string; created: number; metadata: Record<string, string>; idempotencyKey?: string; amount: number };

describeIfDb('Off-session card attempts survive a crash (Decision 447 items 4-5)', () => {
  let app: INestApplication;
  let webhook: StripeWebhookProcessingProcessor;
  let autoPay: ChargeAutoPayProcessor;
  let noShows: BookingNoShowProcessingProcessor;
  let switcher: PlanSwitchProcessor;
  let waitlist: PlanWaitlistProcessor;
  let memberships: MembershipsService;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const acct = `acct_${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  const eventIds: string[] = [];
  let school: { id: string };
  let accountId: string;
  let tokenOwner: string;

  // The fake Stripe. A key used again gets the same PaymentIntent, as on Stripe.
  const madeIntents: MadeIntent[] = [];
  const refunds: Array<{ payment_intent: string; idempotencyKey?: string }> = [];
  let stripeUnreachable = false;
  let crashAfterStripe = false;
  let crashNextWrite = false;
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({
      paymentIntents: {
        create: jest.fn(async (params: { amount: number; customer?: string; metadata?: Record<string, string> }, opts?: { idempotencyKey?: string }) => {
          if (stripeUnreachable) throw new Error('connect ETIMEDOUT');
          const again = opts?.idempotencyKey ? madeIntents.find((i) => i.idempotencyKey === opts.idempotencyKey) : undefined;
          const made: MadeIntent = again ?? {
            id: `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
            status: 'succeeded',
            customer: params.customer,
            created: Math.floor(Date.now() / 1000),
            metadata: params.metadata ?? {},
            idempotencyKey: opts?.idempotencyKey,
            amount: params.amount,
          };
          if (!again) madeIntents.push(made);
          if (crashAfterStripe) {
            crashAfterStripe = false;
            crashNextWrite = true;
          }
          return { id: made.id, status: made.status };
        }),
        retrieve: jest.fn(async (id: string) => madeIntents.find((i) => i.id === id)),
        list: jest.fn(async (params: { customer: string; created: { gte: number } }) => ({
          data: madeIntents.filter((i) => i.customer === params.customer && i.created >= params.created.gte).reverse(),
          has_more: false,
        })),
      },
      customers: { retrieve: jest.fn(async () => ({ invoice_settings: { default_payment_method: 'pm_saved' } })) },
      refunds: {
        create: jest.fn(async (params: { payment_intent: string }, opts?: { idempotencyKey?: string }) => {
          refunds.push({ ...params, idempotencyKey: opts?.idempotencyKey });
          return { id: `re_${randomUUID()}` };
        }),
      },
    })),
    platformClient: jest.fn(),
    constructWebhookEvent: jest.fn(),
  };

  /** The crash: the next write on this client after Stripe answered throws. */
  function crashOn<T extends object>(client: T, method: keyof T) {
    const real = (client[method] as unknown as (...a: unknown[]) => unknown).bind(client);
    jest.spyOn(client, method as never).mockImplementation(((...args: unknown[]) => {
      if (crashNextWrite) {
        crashNextWrite = false;
        return Promise.reject(new Error('worker killed (simulated)'));
      }
      return real(...args);
    }) as never);
  }

  const http = () => request(app.getHttpServer());
  const sign = (user: { id: string; email: string }, role: string, schoolId: string) =>
    jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId, branchId: null }] });

  async function mkUser(label: string) {
    const user = await su.user.create({
      data: {
        id: randomUUID(),
        email: `crash-safety-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Crash',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }
  async function mkStudent(label: string, savedCard = true) {
    const user = await mkUser(label);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId: school.id } });
    if (savedCard) await su.studentPaymentMethod.create({ data: { id: randomUUID(), studentId: user.id, schoolId: school.id, stripeCustomerId: `cus_${randomUUID().slice(0, 12)}` } });
    return user;
  }
  const mkPlan = (data: Record<string, unknown>) =>
    su.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, title: `Plan ${randomUUID().slice(0, 6)}`, currency: 'GBP', price: 3000, type: 'CLASS_PACK', classesIncluded: 5, ...data } as never });

  async function event(eventType: string, objectId: string, metadata: Record<string, string>) {
    const stripeEventId = `evt_${randomUUID()}`;
    eventIds.push(stripeEventId);
    await webhook.process({ data: { stripeEventId, eventType, objectId, stripeAccountId: acct, ...metadata }, attemptsMade: 1, opts: { attempts: 3 } } as never);
  }
  const madeFor = (key: string, value: string) => madeIntents.filter((i) => i.metadata[key] === value);
  async function notices(userId: string, title: string, atLeast = 1) {
    let rows: Array<{ body: string }> = [];
    for (let i = 0; i < 50 && rows.length < atLeast; i++) {
      rows = await su.notification.findMany({ where: { userId, title }, select: { body: true } });
      if (rows.length < atLeast) await new Promise((r) => setTimeout(r, 100));
    }
    return rows;
  }
  const later = () => new Date(Date.now() + 2 * HOUR);
  /** A member whose intro pass ended a minute ago, agreed to switch to `next`, told two days back. */
  async function endedSwitch(label: string, next: { id: string }) {
    const student = await mkStudent(label);
    const intro = await mkPlan({ type: 'WEEKLY_PASS', classesIncluded: null, expiryDurationDays: 7, price: 2000, switchToPlanId: next.id, title: `${label} intro` });
    return su.membership.create({
      data: {
        id: randomUUID(),
        studentId: student.id,
        membershipPlanId: intro.id,
        schoolId: school.id,
        frequency: 'ONE_TIME',
        startDate: new Date(Date.now() - 7 * DAY - 60_000),
        expiryDate: new Date(Date.now() - 60_000),
        switchToPlanId: next.id,
        switchAgreedAt: new Date(Date.now() - 7 * DAY),
        switchNoticeSentAt: new Date(Date.now() - 2 * DAY),
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(fakeStripeClient).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    webhook = app.get(StripeWebhookProcessingProcessor);
    autoPay = app.get(ChargeAutoPayProcessor);
    noShows = app.get(BookingNoShowProcessingProcessor);
    switcher = app.get(PlanSwitchProcessor);
    waitlist = app.get(PlanWaitlistProcessor);
    memberships = app.get(MembershipsService);
    jest.spyOn(app.get(StepUpService), 'assertVerified').mockImplementation(() => undefined);
    // Each caller's own client (each module has its own PrismaJobsService).
    const jobsOf = (o: object) => (o as { prismaJobs: PrismaJobsService }).prismaJobs;
    for (const client of new Set([jobsOf(noShows), jobsOf(switcher), jobsOf(app.get(MembershipFreezesService))])) crashOn(client, '$transaction');
    crashOn((memberships as unknown as { prismaApp: PrismaAppService }).prismaApp, 'withTenantContext');

    school = await su.school.create({
      data: { id: randomUUID(), name: 'Crash Safety School', defaultCurrency: 'GBP', addressCountry: 'GB', timezone: 'UTC', noShowFee: 800, freezeFeeAmount: 1500, freezeMaxDaysPer12Months: 90 },
    });
    accountId = (
      await su.paymentAccount.create({ data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Card', country: 'GB', stripeAccountReady: true, stripeConnectedAccountId: acct } })
    ).id;
    const owner = await mkUser('owner');
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id, isMainOwner: true } });
    tokenOwner = sign(owner, 'SCHOOL_OWNER_MANAGER', school.id);
  });

  afterEach(() => {
    stripeUnreachable = false;
    crashAfterStripe = false;
    crashNextWrite = false;
  });

  afterAll(async () => {
    const where = { schoolId: school.id };
    await su.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await su.membershipFreeze.deleteMany({ where });
    await su.booking.deleteMany({ where });
    await su.class.deleteMany({ where });
    await su.transaction.deleteMany({ where });
    await su.membership.updateMany({ where, data: { switchedToMembershipId: null } });
    await su.membership.deleteMany({ where });
    await su.planWaitlistEntry.deleteMany({ where });
    await su.membershipPlan.updateMany({ where, data: { switchToPlanId: null } });
    await su.membershipPlan.deleteMany({ where });
    await su.studentPaymentMethod.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.notification.deleteMany({ where: { userId: { in: userIds } } });
    await su.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await su.user.deleteMany({ where: { id: { in: userIds } } });
    await su.school.delete({ where: { id: school.id } });
    await su.$disconnect();
    await app.close();
  });

  describe('the no-show fee (no ledger row: its Booking is the attempt)', () => {
    async function overdueBooking(label: string) {
      const student = await mkStudent(label);
      const cls = await su.class.create({
        data: { id: randomUUID(), schoolId: school.id, title: 'Missed class', startDate: new Date(Date.now() - 3 * HOUR), endDate: new Date(Date.now() - 2 * HOUR) },
      });
      return su.booking.create({ data: { id: randomUUID(), studentId: student.id, classId: cls.id, schoolId: school.id, status: 'UPCOMING' } });
    }
    const booking = (id: string) => su.booking.findUniqueOrThrow({ where: { id } });

    it("tags Stripe's payment with the Booking and saves the outcome", async () => {
      const b = await overdueBooking('noShowTagged');
      await noShows.process({} as never);
      const [made] = madeFor('noShowBookingId', b.id);
      expect(made).toMatchObject({ idempotencyKey: `no-show-fee-${b.id}`, amount: 800 });
      expect(await booking(b.id)).toMatchObject({ status: 'NO_SHOW', noShowFeeOutcome: 'CHARGED', noShowFeeAmount: 800, stripeNoShowPaymentIntentId: made.id });
    });

    it("a crash after Stripe took the fee: Stripe's webhook saves it, by the Booking id in the metadata", async () => {
      const b = await overdueBooking('noShowCrash');
      crashAfterStripe = true;
      await expect(noShows.process({} as never)).rejects.toThrow('worker killed');
      const [made] = madeFor('noShowBookingId', b.id);
      expect(made.status).toBe('succeeded');
      expect(await booking(b.id)).toMatchObject({ status: 'NO_SHOW', noShowFeeAmount: 800, noShowFeeOutcome: null, stripeNoShowPaymentIntentId: null });

      await event('payment_intent.succeeded', made.id, { noShowBookingId: b.id });
      expect(await booking(b.id)).toMatchObject({ noShowFeeOutcome: 'CHARGED', stripeNoShowPaymentIntentId: made.id });
      // Never charged twice: the next run leaves it.
      await noShows.process({} as never);
      expect(madeFor('noShowBookingId', b.id)).toHaveLength(1);
    });

    it('with no webhook, the sweep asks Stripe: taken is Charged, never made is Failed', async () => {
      const lost = await overdueBooking('noShowSweep');
      crashAfterStripe = true;
      await expect(noShows.process({} as never)).rejects.toThrow('worker killed');
      const unknown = await overdueBooking('noShowUnreachable');
      stripeUnreachable = true;
      await noShows.process({} as never);
      stripeUnreachable = false;
      expect(await booking(unknown.id)).toMatchObject({ noShowFeeAmount: 800, noShowFeeOutcome: null });

      // Not stale yet: left.
      await autoPay.resolveStaleAttempts(new Date());
      expect((await booking(lost.id)).noShowFeeOutcome).toBeNull();
      await autoPay.resolveStaleAttempts(later());
      expect(await booking(lost.id)).toMatchObject({ noShowFeeOutcome: 'CHARGED', stripeNoShowPaymentIntentId: madeFor('noShowBookingId', lost.id)[0].id });
      expect(await booking(unknown.id)).toMatchObject({ noShowFeeOutcome: 'FAILED', stripeNoShowPaymentIntentId: null });
    });
  });

  describe('the freeze fee', () => {
    async function freezeWithFee(label: string) {
      const student = await mkStudent(label);
      const plan = await mkPlan({ type: 'WEEKLY_PASS', classesIncluded: null, expiryDurationDays: 30 });
      const m = await su.membership.create({
        data: { id: randomUUID(), studentId: student.id, membershipPlanId: plan.id, schoolId: school.id, frequency: 'ONE_TIME', expiryDate: new Date(Date.now() + 30 * DAY) },
      });
      const res = await http().post(`/v1/schools/${school.id}/memberships/${m.id}/freezes`).set('Authorization', `Bearer ${tokenOwner}`).send({ startsAt: isoDay(2), endsAt: isoDay(9) });
      expect(res.status).toBe(201);
      return { freezeId: res.body.id as string, membershipId: m.id };
    }
    const feeOf = async (freezeId: string) => {
      const f = await su.membershipFreeze.findUniqueOrThrow({ where: { id: freezeId } });
      return f.feeTransactionId ? su.transaction.findUniqueOrThrow({ where: { id: f.feeTransactionId } }) : null;
    };

    it("is written Pending first and tagged; a crash after Stripe took it is settled by Stripe's webhook", async () => {
      crashAfterStripe = true;
      const f = await freezeWithFee('freezeCrash');
      const attempt = (await feeOf(f.freezeId))!;
      expect(attempt).toMatchObject({ kind: 'FREEZE_FEE', status: 'PENDING', paymentMethod: 'STRIPE', amount: 1500, stripePaymentIntentId: null });
      const [made] = madeFor('transactionId', attempt.id);
      expect(made).toMatchObject({ idempotencyKey: `membership-freeze-fee-${f.freezeId}`, status: 'succeeded' });

      await event('payment_intent.succeeded', made.id, { transactionId: attempt.id });
      expect(await feeOf(f.freezeId)).toMatchObject({ id: attempt.id, status: 'SUCCESSFUL', stripePaymentIntentId: made.id });
      expect(await su.transaction.count({ where: { membershipId: f.membershipId, kind: 'FREEZE_FEE' } })).toBe(1);
    });

    it('with no answer and no webhook, the sweep finds no payment: Failed, and a pending desk charge becomes the fee', async () => {
      stripeUnreachable = true;
      const f = await freezeWithFee('freezeUnreachable');
      stripeUnreachable = false;
      const attempt = (await feeOf(f.freezeId))!;
      expect(attempt).toMatchObject({ status: 'PENDING', paymentMethod: 'STRIPE' });

      await autoPay.resolveStaleAttempts(later());
      expect(await su.transaction.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({ status: 'FAILED' });
      expect(await feeOf(f.freezeId)).toMatchObject({ kind: 'FREEZE_FEE', status: 'PENDING', paymentMethod: 'CASH', amount: 1500 });
      // Settled once: another check changes nothing.
      await autoPay.resolveStaleAttempts(later());
      expect(await su.transaction.count({ where: { membershipId: f.membershipId, kind: 'FREEZE_FEE' } })).toBe(2);
    });
  });

  describe('a saved-card purchase', () => {
    const buy = (studentId: string, planId: string) => memberships.purchase(studentId, planId, { payWithSavedCard: true } as never, 'step-up');
    const rowOf = (studentId: string, planId: string) => su.transaction.findFirstOrThrow({ where: { studentId, membershipPlanId: planId } });

    it('is written Pending first and tagged, then settled with its Membership', async () => {
      const plan = await mkPlan({});
      const student = await mkStudent('buyTagged');
      const res = (await buy(student.id, plan.id)) as { outcome: string; transactionId: string };
      expect(res.outcome).toBe('active');
      const [made] = madeFor('transactionId', res.transactionId);
      expect(made.idempotencyKey).toBe(`membership-saved-card-${res.transactionId}`);
      const row = await rowOf(student.id, plan.id);
      expect(row).toMatchObject({ status: 'SUCCESSFUL', offSessionAttempt: true, stripePaymentIntentId: made.id });
      expect(await su.membership.count({ where: { studentId: student.id, membershipPlanId: plan.id } })).toBe(1);
    });

    it("a crash after Stripe took the money: Stripe's webhook creates the Membership, once, and the sweep after changes nothing", async () => {
      const plan = await mkPlan({});
      const student = await mkStudent('buyCrash');
      crashAfterStripe = true;
      await expect(buy(student.id, plan.id)).rejects.toThrow('worker killed');
      const row = await rowOf(student.id, plan.id);
      expect(row).toMatchObject({ status: 'PENDING', offSessionAttempt: true, stripePaymentIntentId: null, membershipId: null });
      expect(await su.membership.count({ where: { studentId: student.id } })).toBe(0);
      const [made] = madeFor('transactionId', row.id);

      await event('payment_intent.succeeded', made.id, { transactionId: row.id });
      await event('payment_intent.succeeded', made.id, { transactionId: row.id });
      const settled = await rowOf(student.id, plan.id);
      expect(settled).toMatchObject({ status: 'SUCCESSFUL', stripePaymentIntentId: made.id });
      const bought = await su.membership.findMany({ where: { studentId: student.id } });
      expect(bought).toHaveLength(1);
      expect(bought[0]).toMatchObject({ id: settled.membershipId, membershipPlanId: plan.id, classesRemaining: 5 });
      await autoPay.resolveStaleAttempts(later());
      expect(await su.membership.count({ where: { studentId: student.id } })).toBe(1);
    });

    it("with no webhook, the sweep creates it once; Stripe's webhook after changes nothing", async () => {
      const plan = await mkPlan({});
      const student = await mkStudent('buySweep');
      crashAfterStripe = true;
      await expect(buy(student.id, plan.id)).rejects.toThrow('worker killed');
      const row = await rowOf(student.id, plan.id);
      await autoPay.resolveStaleAttempts(new Date());
      expect((await rowOf(student.id, plan.id)).status).toBe('PENDING');

      await autoPay.resolveStaleAttempts(later());
      await autoPay.resolveStaleAttempts(later());
      const [made] = madeFor('transactionId', row.id);
      expect(await rowOf(student.id, plan.id)).toMatchObject({ status: 'SUCCESSFUL', stripePaymentIntentId: made.id });
      await event('payment_intent.succeeded', made.id, { transactionId: row.id });
      expect(await su.membership.count({ where: { studentId: student.id, membershipPlanId: plan.id } })).toBe(1);
    });

    it('refused when it settles (general access held meanwhile): refunded once, with one key for all', async () => {
      const pass = await mkPlan({ type: 'WEEKLY_PASS', classesIncluded: null, expiryDurationDays: 7 });
      const student = await mkStudent('buyRefused');
      crashAfterStripe = true;
      await expect(buy(student.id, pass.id)).rejects.toThrow('worker killed');
      const row = await rowOf(student.id, pass.id);
      // Another Weekly Pass was sold to them at the desk meanwhile.
      await su.membership.create({ data: { id: randomUUID(), studentId: student.id, membershipPlanId: pass.id, schoolId: school.id, frequency: 'ONE_TIME', expiryDate: new Date(Date.now() + 7 * DAY) } });

      await autoPay.resolveStaleAttempts(later());
      const [made] = madeFor('transactionId', row.id);
      expect(await rowOf(student.id, pass.id)).toMatchObject({ status: 'REFUNDED', refundedAmount: 3000, stripePaymentIntentId: made.id });
      expect(refunds.filter((r) => r.payment_intent === made.id)).toEqual([{ payment_intent: made.id, idempotencyKey: `off-session-purchase-refund-${row.id}` }]);
      expect(await su.membership.count({ where: { studentId: student.id } })).toBe(1);
      expect((await notices(student.id, 'Refund')).map((n) => n.body)).toEqual(["30.00 GBP was refunded to your card: " + pass.title + " couldn't be bought."]);
    });
  });

  describe('a plan switch', () => {
    const switchRow = (membershipId: string) => su.transaction.findFirstOrThrow({ where: { planSwitchFromMembershipId: membershipId } });

    it('a crash after Stripe took the money: the sweep starts the next plan, once, records the switch and tells the member', async () => {
      const next = await mkPlan({ price: 6000, classesIncluded: 10, title: 'Ten classes' });
      const m = await endedSwitch('switchSweep', next);
      crashAfterStripe = true;
      await switcher.run(new Date());
      const row = await switchRow(m.id);
      expect(row).toMatchObject({ status: 'PENDING', offSessionAttempt: true, amount: 6000, membershipId: null });
      const [made] = madeFor('transactionId', row.id);
      expect(made.idempotencyKey).toBe(`plan-switch-${m.id}`);
      expect((await su.membership.findUniqueOrThrow({ where: { id: m.id } })).switchOutcome).toBeNull();

      await autoPay.resolveStaleAttempts(later());
      const done = await su.membership.findUniqueOrThrow({ where: { id: m.id } });
      expect(done.switchOutcome).toBe('SWITCHED');
      expect(await su.membership.findUniqueOrThrow({ where: { id: done.switchedToMembershipId! } })).toMatchObject({ membershipPlanId: next.id, classesRemaining: 10 });
      expect(await switchRow(m.id)).toMatchObject({ status: 'SUCCESSFUL', membershipId: done.switchedToMembershipId, stripePaymentIntentId: made.id });
      // Stripe's webhook after, and another run: nothing more.
      await event('payment_intent.succeeded', made.id, { transactionId: row.id });
      await switcher.run(new Date());
      expect(await su.membership.count({ where: { studentId: m.studentId, membershipPlanId: next.id } })).toBe(1);
      expect(madeFor('transactionId', row.id)).toHaveLength(1);
      expect(await notices(m.studentId, 'Your plan has changed')).toHaveLength(1);
    });

    it("a crash after Stripe took the money: Stripe's webhook starts the next plan, once", async () => {
      const next = await mkPlan({ price: 6000, classesIncluded: 10, title: 'Ten classes' });
      const m = await endedSwitch('switchWebhook', next);
      crashAfterStripe = true;
      await switcher.run(new Date());
      const row = await switchRow(m.id);
      const [made] = madeFor('transactionId', row.id);
      await event('payment_intent.succeeded', made.id, { transactionId: row.id });
      await event('payment_intent.succeeded', made.id, { transactionId: row.id });
      await autoPay.resolveStaleAttempts(later());
      const done = await su.membership.findUniqueOrThrow({ where: { id: m.id } });
      expect(done.switchOutcome).toBe('SWITCHED');
      expect(await su.membership.count({ where: { studentId: m.studentId, membershipPlanId: next.id } })).toBe(1);
      expect(await notices(m.studentId, 'Your plan has changed')).toHaveLength(1);
    });
  });

  describe("a plan's member limit under its lock (item 5)", () => {
    /** Holds the plan's lock (as an order being placed), takes the last
     * place inside, starts `job`, waits until it queues on the lock, then
     * lets go. Returns the job's result. */
    async function racePlace<T>(planId: string, takePlace: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<unknown>, job: () => Promise<T>) {
      let running!: Promise<T>;
      await su.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`plan-places:${planId}`}, 0))`;
          await takePlace(tx);
          running = job();
          for (let i = 0; i < 100; i++) {
            const [{ waiting }] = await su.$queryRaw<Array<{ waiting: number }>>`SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
            if (waiting > 0) return;
            await new Promise((r) => setTimeout(r, 50));
          }
          throw new Error('the job never waited for the plan lock');
        },
        { timeout: 20_000 },
      );
      return running;
    }

    it('the waiting-list offer counts again under the lock: a place taken meanwhile is not offered twice', async () => {
      const plan = await mkPlan({ memberLimit: 1 });
      const waiting = await mkStudent('waitlisted', false);
      const entry = await su.planWaitlistEntry.create({ data: { id: randomUUID(), membershipPlanId: plan.id, schoolId: school.id, studentId: waiting.id, joinedById: waiting.id, status: 'WAITING' } });
      const buyer = await mkStudent('cashBuyer', false);
      const outcome = await racePlace(
        plan.id,
        (tx) =>
          tx.transaction.create({
            data: { id: randomUUID(), schoolId: school.id, studentId: buyer.id, paymentAccountId: accountId, membershipPlanId: plan.id, amount: 3000, currency: 'GBP', status: 'PENDING', paymentMethod: 'CASH' },
          }),
        () => waitlist.run(new Date()),
      );
      expect(outcome.offered).toBe(0);
      expect((await su.planWaitlistEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('WAITING');
    });

    it('the plan switch counts again under the lock when it starts: filled meanwhile, it is refunded and simply ends', async () => {
      const next = await mkPlan({ memberLimit: 1, price: 5000, classesIncluded: 8, title: 'Small group' });
      const m = await endedSwitch('switchFull', next);
      const other = await mkStudent('switchFullOther', false);
      await racePlace(
        next.id,
        (tx) => tx.membership.create({ data: { id: randomUUID(), studentId: other.id, membershipPlanId: next.id, schoolId: school.id, frequency: 'ONE_TIME', classesRemaining: 8 } }),
        () => switcher.run(new Date()),
      );
      const done = await su.membership.findUniqueOrThrow({ where: { id: m.id } });
      expect(done.switchOutcome).toBe('NOT_SOLD');
      const row = await su.transaction.findFirstOrThrow({ where: { planSwitchFromMembershipId: m.id } });
      expect(row).toMatchObject({ status: 'REFUNDED', refundedAmount: 5000 });
      expect(refunds.filter((r) => r.payment_intent === row.stripePaymentIntentId)).toEqual([{ payment_intent: row.stripePaymentIntentId, idempotencyKey: `off-session-purchase-refund-${row.id}` }]);
      expect(await su.membership.count({ where: { membershipPlanId: next.id } })).toBe(1);
      expect(await notices(m.studentId, 'Membership ended')).toHaveLength(1);
    });
  });
});
