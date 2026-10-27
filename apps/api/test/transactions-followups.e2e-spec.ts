/**
 * Decision 346 — the Transactions follow-ups: renewal rows (G4), late-cancel
 * fee rows (G5), filters (G3) and desk payments (G7), over real HTTP against a
 * real Postgres. Stripe is faked: invoices.retrieve for the renewal webhooks and
 * PaymentsService.chargeOffSession for the late-cancellation fee.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET, REDIS_URL.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { Job } from 'bullmq';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { StripeClientService } from '../src/payments/stripe-client.service';
import { PaymentsService } from '../src/payments/payments.service';
import { StripeWebhookProcessingProcessor } from '../src/jobs/stripe-webhook-processing.processor';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Transactions follow-ups (Decision 346)', () => {
  let app: INestApplication;
  let processor: StripeWebhookProcessingProcessor;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolIds: string[] = [];
  const eventIds: string[] = [];
  const TAG = 'tx-followups-';

  /** The invoice each test hands the webhook job, by id. */
  const invoices = new Map<string, object>();
  const fakeStripeClient = {
    scopedClient: jest.fn(() => ({
      invoices: { retrieve: jest.fn(async (id: string) => invoices.get(id)) },
    })),
    platformClient: jest.fn(),
  };

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
    const school = await su.school.create({ data: { id: randomUUID(), name: `Tx followups ${randomUUID().slice(0, 6)}` } });
    schoolIds.push(school.id);
    const branch = await su.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Main' } });
    const owner = await mkUser('owner');
    const student = await mkUser('student');
    const staff = await mkUser('staff');
    await su.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: staff.id, schoolId: school.id, branchId: branch.id },
      ],
    });
    const account = await su.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Card', country: 'GB', stripeConnectedAccountId: `acct_${randomUUID().slice(0, 8)}` },
    });
    const pack = await su.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '10-Class Pack', price: 15000, classesIncluded: 10, currency: 'GBP' },
    });
    const monthly = await su.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Monthly', price: 6000, currency: 'GBP' },
    });
    return {
      school,
      branch,
      account,
      pack,
      monthly,
      owner,
      student,
      staff,
      ownerToken: token(owner, 'SCHOOL_OWNER_MANAGER', school.id),
      studentToken: token(student, 'STUDENT', school.id),
      staffToken: token(staff, 'BRANCH_STAFF', school.id, branch.id),
    };
  }
  type Seeded = Awaited<ReturnType<typeof seedSchool>>;

  const http = () => request(app.getHttpServer());
  const ledger = (s: Seeded, query = '') => http().get(`/v1/schools/${s.school.id}/transactions${query}`).set('Authorization', `Bearer ${s.ownerToken}`);
  const summary = (s: Seeded, query = '') => http().get(`/v1/schools/${s.school.id}/transactions/summary${query}`).set('Authorization', `Bearer ${s.ownerToken}`);

  /** A Subscription Membership with its first payment already on the ledger, as a purchase leaves it. */
  async function subscribe(s: Seeded) {
    const subscriptionId = `sub_${randomUUID()}`;
    const membership = await su.membership.create({
      data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: s.monthly.id, schoolId: s.school.id, frequency: 'RECURRING', stripeSubscriptionId: subscriptionId },
    });
    await su.transaction.create({
      data: {
        id: randomUUID(), schoolId: s.school.id, studentId: s.student.id, paymentAccountId: s.account.id, membershipPlanId: s.monthly.id,
        membershipId: membership.id, amount: 6000, currency: 'GBP', status: 'SUCCESSFUL', paymentMethod: 'STRIPE',
        stripePaymentIntentId: `pi_first_${randomUUID()}`, stripeSubscriptionId: subscriptionId, billingDate: new Date(Date.now() - 31 * 86_400_000),
      },
    });
    return { subscriptionId, membership };
  }

  async function invoiceEvent(s: Seeded, eventType: 'invoice.paid' | 'invoice.payment_failed', invoice: Record<string, unknown>) {
    invoices.set(invoice.id as string, invoice);
    const stripeEventId = `evt_${randomUUID()}`;
    eventIds.push(stripeEventId);
    await processor.process({ data: { stripeEventId, eventType, objectId: invoice.id, stripeAccountId: s.account.stripeConnectedAccountId } } as unknown as Job);
  }
  const renewalInvoice = (subscriptionId: string, opts: { id?: string; pi?: string; reason?: string; paid?: number } = {}) => ({
    id: opts.id ?? `in_${randomUUID()}`,
    billing_reason: opts.reason ?? 'subscription_cycle',
    amount_paid: opts.paid ?? 6000,
    amount_due: 6000,
    currency: 'gbp',
    created: Math.floor(Date.now() / 1000),
    status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
    parent: { subscription_details: { subscription: subscriptionId } },
    payments: { data: opts.pi ? [{ payment: { type: 'payment_intent', payment_intent: opts.pi } }] : [] },
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StripeClientService).useValue(fakeStripeClient).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    processor = app.get(StripeWebhookProcessingProcessor);
  });

  afterAll(async () => {
    await app.close();
    const where = { schoolId: { in: schoolIds } };
    const users = { email: { startsWith: TAG } };
    await su.notification.deleteMany({ where: { user: users } });
    await su.transaction.deleteMany({ where });
    await su.booking.deleteMany({ where });
    await su.class.deleteMany({ where });
    await su.membership.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.paymentAccount.deleteMany({ where });
    await su.roleGrant.deleteMany({ where });
    await su.branch.deleteMany({ where });
    await su.processedStripeEvent.deleteMany({ where: { stripeEventId: { in: eventIds } } });
    await su.notification.deleteMany({ where: { user: users } });
    await su.user.deleteMany({ where: users });
    await su.school.deleteMany({ where: { id: { in: schoolIds } } });
    await su.$disconnect();
  });

  // ---- G4: renewals -------------------------------------------------------

  it('a renewal invoice adds one Successful RENEWAL row; a redelivery adds none', async () => {
    const s = await seedSchool();
    const { subscriptionId, membership } = await subscribe(s);
    const invoice = renewalInvoice(subscriptionId, { pi: `pi_${randomUUID()}` });
    await invoiceEvent(s, 'invoice.paid', invoice);
    await invoiceEvent(s, 'invoice.paid', invoice); // a second, distinct event for the same invoice

    const rows = await su.transaction.findMany({ where: { schoolId: s.school.id, kind: 'RENEWAL' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'SUCCESSFUL', amount: 6000, currency: 'GBP', membershipId: membership.id, membershipPlanId: s.monthly.id, stripeInvoiceId: invoice.id });

    const res = await ledger(s);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({ kind: 'RENEWAL', membershipPlanTitle: 'Monthly' });
  });

  it("the first invoice (subscription_create) is not added again: the purchase's row already covers it", async () => {
    const s = await seedSchool();
    const { subscriptionId } = await subscribe(s);
    await invoiceEvent(s, 'invoice.paid', renewalInvoice(subscriptionId, { reason: 'subscription_create', pi: `pi_${randomUUID()}` }));
    expect(await su.transaction.count({ where: { schoolId: s.school.id } })).toBe(1);
  });

  it('a failed renewal shows as Failed, and turns Successful on the same row when a retry pays', async () => {
    const s = await seedSchool();
    const { subscriptionId } = await subscribe(s);
    const id = `in_${randomUUID()}`;
    const pi = `pi_${randomUUID()}`;
    await invoiceEvent(s, 'invoice.payment_failed', renewalInvoice(subscriptionId, { id, pi, paid: 0 }));
    let rows = await su.transaction.findMany({ where: { stripeInvoiceId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'RENEWAL', status: 'FAILED', amount: 6000 });

    await invoiceEvent(s, 'invoice.paid', renewalInvoice(subscriptionId, { id, pi }));
    rows = await su.transaction.findMany({ where: { stripeInvoiceId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('SUCCESSFUL');

    // A late failure notice for an invoice already paid changes nothing.
    await invoiceEvent(s, 'invoice.payment_failed', renewalInvoice(subscriptionId, { id, pi, paid: 0 }));
    expect((await su.transaction.findFirstOrThrow({ where: { stripeInvoiceId: id } })).status).toBe('SUCCESSFUL');
  });

  it("a renewal's payment_intent.succeeded never creates a second Membership", async () => {
    const s = await seedSchool();
    const { subscriptionId } = await subscribe(s);
    const pi = `pi_${randomUUID()}`;
    await invoiceEvent(s, 'invoice.paid', renewalInvoice(subscriptionId, { pi }));
    const stripeEventId = `evt_${randomUUID()}`;
    eventIds.push(stripeEventId);
    await processor.process({ data: { stripeEventId, eventType: 'payment_intent.succeeded', objectId: pi, stripeAccountId: s.account.stripeConnectedAccountId } } as unknown as Job);
    expect(await su.membership.count({ where: { schoolId: s.school.id } })).toBe(1);
  });

  // ---- G5: late-cancellation fees ----------------------------------------

  async function bookAndCancelLate(s: Seeded) {
    const start = new Date(Date.now() + 2 * 86_400_000);
    const cls = await su.class.create({
      data: {
        id: randomUUID(), schoolId: s.school.id, title: 'Evening BJJ', startDate: start, endDate: new Date(start.getTime() + 3_600_000),
        refundFeeDate: new Date(Date.now() - 3_600_000), cancellationCharge: 1000, membershipInclusion: true,
      },
    });
    await su.membership.create({
      data: { id: randomUUID(), studentId: s.student.id, membershipPlanId: s.pack.id, schoolId: s.school.id, frequency: 'ONE_TIME', classesRemaining: 5 },
    });
    const booked = await http().post(`/v1/classes/${cls.id}/book`).set('Authorization', `Bearer ${s.studentToken}`).send({});
    expect(booked.status).toBe(201);
    const cancelled = await http().patch(`/v1/bookings/${booked.body.id}/cancel`).set('Authorization', `Bearer ${s.studentToken}`);
    expect(cancelled.status).toBe(200);
    return { bookingId: booked.body.id as string, cancelled };
  }

  it('a charged late-cancellation fee is a Successful LATE_CANCEL_FEE row naming the class', async () => {
    const s = await seedSchool();
    const spy = jest.spyOn(app.get(PaymentsService), 'chargeOffSession').mockResolvedValueOnce({ succeeded: true, paymentIntentId: `pi_${randomUUID()}` } as never);
    const { bookingId, cancelled } = await bookAndCancelLate(s);
    spy.mockRestore();
    expect(cancelled.body.cancellationChargeOutcome).toBe('CHARGED');

    const row = await su.transaction.findUniqueOrThrow({ where: { bookingId } });
    expect(row).toMatchObject({ kind: 'LATE_CANCEL_FEE', status: 'SUCCESSFUL', amount: 1000, currency: 'GBP', membershipPlanId: null, paymentMethod: 'STRIPE' });
    const res = await ledger(s);
    expect(res.body.items[0]).toMatchObject({ kind: 'LATE_CANCEL_FEE', bookingClassTitle: 'Evening BJJ', membershipPlanTitle: null });
    const tiles = await summary(s);
    expect(tiles.body.revenue).toEqual([{ currency: 'GBP', amount: 1000 }]);
  });

  it('a declined fee is a Failed row; no saved card means no row', async () => {
    const s = await seedSchool();
    const spy = jest.spyOn(app.get(PaymentsService), 'chargeOffSession').mockResolvedValueOnce({ succeeded: false, paymentIntentId: `pi_${randomUUID()}` } as never);
    const declined = await bookAndCancelLate(s);
    spy.mockRestore();
    expect((await su.transaction.findUniqueOrThrow({ where: { bookingId: declined.bookingId } })).status).toBe('FAILED');

    const s2 = await seedSchool(); // no saved card: the real chargeOffSession throws NoSavedPaymentMethodError
    const none = await bookAndCancelLate(s2);
    expect(none.cancelled.body.cancellationChargeOutcome).toBe('NO_SAVED_PAYMENT_METHOD');
    expect(await su.transaction.count({ where: { bookingId: none.bookingId } })).toBe(0);
  });

  // ---- G3: filters ---------------------------------------------------------

  it('filters narrow the ledger and its tiles together', async () => {
    const s = await seedSchool();
    const row = (status: 'SUCCESSFUL' | 'FAILED', method: 'STRIPE' | 'CASH', daysAgo: number, amount: number) =>
      su.transaction.create({
        data: {
          id: randomUUID(), schoolId: s.school.id, studentId: s.student.id, paymentAccountId: s.account.id, membershipPlanId: s.pack.id,
          amount, currency: 'GBP', status, paymentMethod: method, billingDate: new Date(Date.UTC(2026, 9, 20 - daysAgo, 12)),
        },
      });
    await row('SUCCESSFUL', 'STRIPE', 0, 100); // 20 Oct
    await row('SUCCESSFUL', 'CASH', 1, 200); // 19 Oct
    await row('FAILED', 'STRIPE', 5, 400); // 15 Oct

    expect((await ledger(s, '?status=SUCCESSFUL')).body.items).toHaveLength(2);
    expect((await ledger(s, '?paymentMethod=CASH')).body.items.map((t: { amount: number }) => t.amount)).toEqual([200]);
    expect((await ledger(s, '?from=2026-10-19&to=2026-10-20')).body.items).toHaveLength(2);
    expect((await ledger(s, '?to=2026-10-15')).body.items.map((t: { amount: number }) => t.amount)).toEqual([400]);
    expect((await ledger(s, `?membershipPlanId=${s.monthly.id}`)).body.items).toHaveLength(0);

    const tiles = await summary(s, '?paymentMethod=STRIPE');
    expect(tiles.body).toMatchObject({ total: 2, successful: 1, failedOrDisputed: 1, revenue: [{ currency: 'GBP', amount: 100 }] });

    expect((await ledger(s, '?from=2026-10-20&to=2026-10-19')).status).toBe(400);
    expect((await ledger(s, '?status=LOST')).status).toBe(400);
    expect((await ledger(s, '?from=yesterday')).status).toBe(400);
  });

  // ---- G7: desk payments ---------------------------------------------------

  const desk = (s: Seeded, body: object, tok = s.ownerToken) =>
    http().post(`/v1/schools/${s.school.id}/desk-payments`).set('Authorization', `Bearer ${tok}`).send(body);

  it('the owner records a desk payment: a Successful row with who recorded it, and an Active membership', async () => {
    const s = await seedSchool();
    const res = await desk(s, { studentId: s.student.id, membershipPlanId: s.pack.id, paymentMethod: 'CASH' });
    expect(res.status).toBe(201);
    const row = await su.transaction.findUniqueOrThrow({ where: { id: res.body.transactionId } });
    expect(row).toMatchObject({ status: 'SUCCESSFUL', paymentMethod: 'CASH', amount: 15000, currency: 'GBP', recordedById: s.owner.id, membershipId: res.body.membershipId });
    const membership = await su.membership.findUniqueOrThrow({ where: { id: res.body.membershipId } });
    expect(membership).toMatchObject({ status: 'ACTIVE', classesRemaining: 10, studentId: s.student.id });
  });

  it('desk payments: Branch Staff and students are refused; Subscriptions, Friend Passes, non-students and closed Schools too', async () => {
    const s = await seedSchool();
    const body = { studentId: s.student.id, membershipPlanId: s.pack.id, paymentMethod: 'CASH' };
    expect((await desk(s, body, s.staffToken)).status).toBe(403);
    expect((await desk(s, body, s.studentToken)).status).toBe(403);
    expect((await desk(s, { ...body, membershipPlanId: s.monthly.id })).status).toBe(400);
    const friend = await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: s.school.id, type: 'FRIEND_PASS', title: 'Friend', price: 0, classesIncluded: 1 } });
    expect((await desk(s, { ...body, membershipPlanId: friend.id })).status).toBe(400);
    const outsider = await mkUser('outsider');
    expect((await desk(s, { ...body, studentId: outsider.id })).status).toBe(400);
    expect((await desk(s, { ...body, paymentMethod: 'STRIPE' })).status).toBe(400);

    const other = await seedSchool();
    expect((await desk(s, { ...body, membershipPlanId: other.pack.id })).status).toBe(404);

    await su.school.update({ where: { id: s.school.id }, data: { archivedAt: new Date() } });
    expect((await desk(s, body)).status).toBe(403);
    expect(await su.transaction.count({ where: { schoolId: s.school.id } })).toBe(0);
  });
  it('Branch Staff record desk payments only once the owner switches it on (Decision 347)', async () => {
    const s = await seedSchool();
    const body = { studentId: s.student.id, membershipPlanId: s.pack.id, paymentMethod: 'CASH' };
    const refused = await desk(s, body, s.staffToken);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toBe('The School owner has not let Branch Staff record payments.');

    // Only the owner can flip the switch.
    const patch = (tok: string, value: boolean) =>
      http().patch(`/v1/schools/${s.school.id}`).set('Authorization', `Bearer ${tok}`).send({ branchStaffCanRecordPayments: value });
    expect((await patch(s.staffToken, true)).status).toBe(403);
    const on = await patch(s.ownerToken, true);
    expect(on.status).toBe(200);
    expect(on.body.branchStaffCanRecordPayments).toBe(true);

    // A student of another branch (or none yet) isn't theirs to record for.
    expect((await desk(s, body, s.staffToken)).status).toBe(400);
    const options = (tok: string) => http().get(`/v1/schools/${s.school.id}/desk-payments/options`).set('Authorization', `Bearer ${tok}`);
    expect((await options(s.staffToken)).body.students).toEqual([]);
    // Plans that can be paid once in cash only: the pack, not the Subscription.
    expect((await options(s.staffToken)).body.plans.map((p: { id: string }) => p.id)).toEqual([s.pack.id]);
    await su.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: s.school.id, studentId: s.student.id, branchId: s.branch.id } });
    expect((await options(s.staffToken)).body.students.map((x: { id: string }) => x.id)).toEqual([s.student.id]);
    expect((await options(s.ownerToken)).body.students.map((x: { id: string }) => x.id)).toEqual([s.student.id]);
    expect((await options(s.studentToken)).status).toBe(403);

    const res = await desk(s, body, s.staffToken);
    expect(res.status).toBe(201);
    const row = await su.transaction.findUniqueOrThrow({ where: { id: res.body.transactionId } });
    expect(row).toMatchObject({ status: 'SUCCESSFUL', recordedById: s.staff.id });
    // Still no view of the ledger itself.
    expect((await http().get(`/v1/schools/${s.school.id}/transactions`).set('Authorization', `Bearer ${s.staffToken}`)).status).toBe(403);
    // Students and the owner are unaffected by the switch.
    expect((await desk(s, body, s.studentToken)).status).toBe(403);

    expect((await patch(s.ownerToken, false)).status).toBe(200);
    expect((await desk(s, { ...body, studentId: s.student.id }, s.staffToken)).status).toBe(403);
  });
});
