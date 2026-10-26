/**
 * Regression gate for the booking/schedule stress test of 26 Oct 2026
 * (docs/handover/BOOKING-SCHEDULE-STRESS-TEST.md, Decision 322). Each block pins one
 * finding that the stress run proved over real HTTP:
 *
 * - booking gates: an expired-but-ACTIVE Membership, a passed booking cut-off
 *   (Students stopped, Staff walk-ins allowed), an ended or archived Class;
 * - check-in opens a School-set number of minutes before the start (default 30);
 * - waitlist: only a full Class takes entries, never from someone already booked,
 *   and while anyone is queued Students can't book past the queue;
 * - capacity can't be cut below the seats taken;
 * - the School's late-cancel setting (default: no refund once started);
 * - timetable slot edits reach the 4 weeks already generated (ask, MOVE, CANCEL);
 * - a booking burst on one Class fills it exactly, with no 5xx.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET (and REDIS_URL for the queues).
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

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[booking-schedule-stress-fixes.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;
const MIN = 60_000;
const HOUR = 3_600_000;

describeIfDb('Booking/schedule stress-test fixes (Decision 322)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const school = { id: randomUUID() };
  type U = { id: string; email: string; token: string };
  let owner: U;
  let staff: U;
  const students: U[] = [];
  let subscriptionPlanId: string;
  let packPlanId: string;

  const http = () => request(app.getHttpServer());
  const at = (ms: number) => new Date(Date.now() + ms);
  const mkClass = (data: Record<string, unknown>) =>
    superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Fixture', startDate: at(2 * HOUR), endDate: at(3 * HOUR), ...data } });
  const book = (classId: string, who: U, body: Record<string, unknown> = {}) => http().post(`/v1/classes/${classId}/book`).set('Authorization', `Bearer ${who.token}`).send(body);
  const upcoming = (classId: string) => superuser.booking.count({ where: { classId, status: 'UPCOMING' } });
  const setSchool = (data: Record<string, unknown>) => superuser.school.update({ where: { id: school.id }, data });

  async function mkUser(label: string, role: 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'STUDENT'): Promise<U> {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `stress-fixes-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Stress',
        passcodeHash: 'x',
        dateOfBirth: new Date('1995-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId: school.id } });
    const token = jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId: null }] });
    return { id: user.id, email: user.email, token };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.create({ data: { id: school.id, name: 'Stress Fixes School', timezone: 'UTC', waitlistClaimWindowMinutes: 60 } });
    owner = await mkUser('owner', 'SCHOOL_OWNER_MANAGER');
    staff = await mkUser('staff', 'BRANCH_STAFF');
    subscriptionPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } })).id;
    packPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: 'Pack', price: 3000, classesIncluded: 5 } })).id;
    for (let i = 0; i < 40; i++) {
      const s = await mkUser(`student${i}`, 'STUDENT');
      students.push(s);
      await superuser.membership.create({ data: { id: randomUUID(), studentId: s.id, schoolId: school.id, membershipPlanId: subscriptionPlanId, frequency: 'RECURRING' } });
    }
  });

  afterAll(async () => {
    const userIds = (await superuser.user.findMany({ where: { email: { contains: 'stress-fixes-' } }, select: { id: true } })).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.waitlistEntry.deleteMany({ where: { schoolId: school.id } });
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.timetableSlot.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('booking gates', () => {
    it('an ACTIVE Membership past its expiryDate no longer funds a booking — 400', async () => {
      const s = students[0];
      await superuser.membership.updateMany({ where: { studentId: s.id, schoolId: school.id }, data: { expiryDate: at(-HOUR) } });
      const cls = await mkClass({});
      expect((await book(cls.id, s)).status).toBe(400);
      await superuser.membership.updateMany({ where: { studentId: s.id, schoolId: school.id }, data: { expiryDate: null } });
      expect((await book(cls.id, s)).status).toBe(201);
    });

    it('after the booking cut-off a Student is refused, Staff can still book a walk-in', async () => {
      const cls = await mkClass({ bookingEndAt: at(-MIN) });
      const res = await book(cls.id, students[1]);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Booking for this Class has closed/);
      expect(res.body.error.code).toBe('BOOKING_CLOSED');
      expect((await book(cls.id, staff, { studentId: students[1].id })).status).toBe(201);
    });

    it('nobody can book a Class that has ended, or an archived one', async () => {
      const ended = await mkClass({ startDate: at(-3 * HOUR), endDate: at(-2 * HOUR) });
      expect((await book(ended.id, students[2])).status).toBe(400);
      expect((await book(ended.id, staff, { studentId: students[2].id })).status).toBe(400);
      const archived = await mkClass({ archivedAt: new Date() });
      expect((await book(archived.id, students[2])).status).toBe(400);
    });
  });

  describe('check-in opening', () => {
    it('check-in opens the School-set minutes before the start (default 30)', async () => {
      const s = students[3];
      const cls = await mkClass({ startDate: at(2 * HOUR), endDate: at(3 * HOUR) });
      expect((await book(cls.id, s)).status).toBe(201);
      const early = await http().post(`/v1/classes/${cls.id}/attendance-scan`).set('Authorization', `Bearer ${owner.token}`).send({ studentId: s.id });
      expect(early.status).toBe(400);
      expect(early.body.error.message).toMatch(/hasn't opened yet/);
      expect(early.body.error.code).toBe('CHECK_IN_NOT_OPEN');

      const patched = await http().patch(`/v1/schools/${school.id}`).set('Authorization', `Bearer ${owner.token}`).send({ checkInOpensMinutesBeforeStart: 180 });
      expect(patched.status).toBe(200);
      expect(patched.body.checkInOpensMinutesBeforeStart).toBe(180);
      const ok = await http().post(`/v1/classes/${cls.id}/attendance-scan`).set('Authorization', `Bearer ${owner.token}`).send({ studentId: s.id });
      expect(ok.status).toBe(201);
      await setSchool({ checkInOpensMinutesBeforeStart: 30 });
    });
  });

  describe('waitlist first', () => {
    it('only a full Class takes waitlist entries, never from someone booked into it, and the queue comes first', async () => {
      const cls = await mkClass({ capacity: 2 });
      const join = (who: U) => http().post(`/v1/classes/${cls.id}/waitlist`).set('Authorization', `Bearer ${who.token}`).send({});
      expect((await join(students[4])).status).toBe(409); // still has space
      const first = await book(cls.id, students[5]);
      expect(first.status).toBe(201);
      expect((await join(students[5])).status).toBe(409); // already booked
      expect((await book(cls.id, students[6])).status).toBe(201);
      expect((await join(students[7])).status).toBe(201); // full now

      // A seat frees up: a Student who books straight away can't jump the queue
      // (whether the waitlist job has offered the seat yet or not).
      const cancel = await http().patch(`/v1/bookings/${first.body.id}/cancel`).set('Authorization', `Bearer ${students[5].token}`).send({});
      expect(cancel.status).toBe(200);
      const jump = await book(cls.id, students[8]);
      expect(jump.status).toBe(409);
    });

    it('while Students wait, Staff can still book a walk-in into a free seat that is not held', async () => {
      // A free seat with a Waiting entry the waitlist job hasn't offered yet.
      const cls = await mkClass({ capacity: 2 });
      expect((await book(cls.id, students[18])).status).toBe(201);
      await superuser.waitlistEntry.create({ data: { id: randomUUID(), studentId: students[19].id, classId: cls.id, schoolId: school.id, position: 1 } });
      const jump = await book(cls.id, students[20]);
      expect(jump.status).toBe(409);
      expect(jump.body.error.message).toMatch(/waiting for this Class/);
      expect(jump.body.error.code).toBe('WAITLIST_FIRST');
      expect((await book(cls.id, staff, { studentId: students[20].id })).status).toBe(201);
    });

    it('a seat offered to a notified Student is held for them', async () => {
      const cls = await mkClass({ capacity: 1 });
      const holder = await book(cls.id, students[9]);
      const entry = await http().post(`/v1/classes/${cls.id}/waitlist`).set('Authorization', `Bearer ${students[10].token}`).send({});
      expect(entry.status).toBe(201);
      await superuser.booking.update({ where: { id: holder.body.id }, data: { status: 'CANCELLED', refundResolution: 'REFUNDED' } });
      await superuser.waitlistEntry.update({ where: { id: entry.body.id }, data: { status: 'NOTIFIED', notifiedAt: new Date(), claimByDeadline: at(HOUR) } });
      expect((await book(cls.id, staff, { studentId: students[11].id })).status).toBe(409); // held, even for Staff
      const claim = await http().post(`/v1/waitlist/${entry.body.id}/claim`).set('Authorization', `Bearer ${students[10].token}`).send({});
      expect(claim.status).toBe(201);
    });
  });

  describe('capacity', () => {
    it("can't be cut below the seats already taken", async () => {
      const cls = await mkClass({ capacity: 10 });
      for (const s of students.slice(12, 16)) expect((await book(cls.id, s)).status).toBe(201);
      const cut = await http().patch(`/v1/classes/${cls.id}`).set('Authorization', `Bearer ${owner.token}`).send({ capacity: 3 });
      expect(cut.status).toBe(409);
      expect(cut.body.error.message).toMatch(/4 students are booked/);
      expect(cut.body.error.code).toBe('CAPACITY_BELOW_BOOKED');
      expect((await http().patch(`/v1/classes/${cls.id}`).set('Authorization', `Bearer ${owner.token}`).send({ capacity: 4 })).status).toBe(200);
    });

    it('a burst of 25 bookings fills a 10-seat Class exactly, with no server error', async () => {
      const cls = await mkClass({ capacity: 10 });
      const res = await Promise.all(students.slice(15, 40).map((s) => book(cls.id, s)));
      expect(res.filter((r) => r.status === 201)).toHaveLength(10);
      expect(res.filter((r) => r.status >= 500)).toHaveLength(0);
      expect(await upcoming(cls.id)).toBe(10);
    });
  });

  describe('late cancellation (School setting)', () => {
    // A new School's cancellation policy is Manual (Decision 291), which leaves a
    // refunded seat for staff to resolve. Auto-credit gives it straight back, so
    // these checks see the credit count move.
    beforeAll(() => setSchool({ classCancellationPolicy: 'AUTO_CREDIT' }));
    afterAll(() => setSchool({ classCancellationPolicy: 'MANUAL' }));

    async function packStudentBooking(cls: { id: string }) {
      const s = await mkUser(`pack${randomUUID().slice(0, 6)}`, 'STUDENT');
      const m = await superuser.membership.create({ data: { id: randomUUID(), studentId: s.id, schoolId: school.id, membershipPlanId: packPlanId, frequency: 'ONE_TIME', classesRemaining: 4 } });
      const b = await superuser.booking.create({ data: { id: randomUUID(), studentId: s.id, classId: cls.id, schoolId: school.id, sourceMembershipId: m.id } });
      const cancel = () => http().patch(`/v1/bookings/${b.id}/cancel`).set('Authorization', `Bearer ${s.token}`).send({});
      const credits = async () => (await superuser.membership.findUniqueOrThrow({ where: { id: m.id } })).classesRemaining;
      return { cancel, credits };
    }

    it('default: no refund once the Class has started; no cancelling after it ends', async () => {
      const started = await mkClass({ startDate: at(-10 * MIN), endDate: at(50 * MIN) });
      const a = await packStudentBooking(started);
      expect((await a.cancel()).status).toBe(200);
      expect(await a.credits()).toBe(4);

      const ended = await mkClass({ startDate: at(-2 * HOUR), endDate: at(-HOUR) });
      const b = await packStudentBooking(ended);
      expect((await b.cancel()).status).toBe(409);
    });

    it('REFUND_UNTIL_END refunds a started Class; ALWAYS_REFUND also refunds after the end', async () => {
      await setSchool({ lateCancelRefundPolicy: 'REFUND_UNTIL_END' });
      const started = await mkClass({ startDate: at(-10 * MIN), endDate: at(50 * MIN) });
      const a = await packStudentBooking(started);
      expect((await a.cancel()).status).toBe(200);
      expect(await a.credits()).toBe(5);

      await setSchool({ lateCancelRefundPolicy: 'ALWAYS_REFUND' });
      const ended = await mkClass({ startDate: at(-2 * HOUR), endDate: at(-HOUR) });
      const b = await packStudentBooking(ended);
      expect((await b.cancel()).status).toBe(200);
      expect(await b.credits()).toBe(5);
      await setSchool({ lateCancelRefundPolicy: 'NO_REFUND_ONCE_STARTED' });
    });
  });

  describe('timetable slot edits reach the generated Classes', () => {
    const tomorrow = WEEKDAYS[new Date(Date.now() + 24 * HOUR).getUTCDay()];
    const upcomingOf = (slotId: string) =>
      superuser.class.findMany({ where: { timetableSlotId: slotId, archivedAt: null, startDate: { gt: new Date() } }, orderBy: { startDate: 'asc' } });
    const patchSlot = (slotId: string, body: Record<string, unknown>) => http().patch(`/v1/timetable/${slotId}`).set('Authorization', `Bearer ${owner.token}`).send(body);

    async function mkSlot() {
      const res = await http()
        .post(`/v1/schools/${school.id}/timetable`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ weekday: tomorrow, startTime: '18:00', endTime: '19:00', title: 'Evening', activities: ['BJJ'], capacity: 20 });
      expect(res.status).toBe(201);
      // Any edit fills the next 4 weeks (the same builder as the daily job).
      expect((await patchSlot(res.body.id, { title: 'Evening BJJ' })).status).toBe(200);
      return res.body.id as string;
    }

    it('a change that moves booked Classes asks first; MOVE re-times them and the bookings follow', async () => {
      const slot = await mkSlot();
      const classes = await upcomingOf(slot);
      expect(classes).toHaveLength(4);
      expect(classes.every((c) => c.title === 'Evening BJJ')).toBe(true);
      expect((await book(classes[0].id, students[16])).status).toBe(201);

      const ask = await patchSlot(slot, { startTime: '17:00', endTime: '18:00' });
      expect(ask.status).toBe(409);
      expect(ask.body.error.code).toBe('BOOKED_CLASSES_CHOICE_REQUIRED');
      const impact = await http().get(`/v1/timetable/${slot}/upcoming-impact`).set('Authorization', `Bearer ${owner.token}`);
      expect(impact.body).toEqual({ upcomingClasses: 4, bookedClasses: 1, bookedStudents: 1, mostTaken: 1 });

      expect((await patchSlot(slot, { startTime: '17:00', endTime: '18:00', bookedClasses: 'MOVE' })).status).toBe(200);
      const moved = await upcomingOf(slot);
      expect(moved).toHaveLength(4);
      expect(moved.every((c) => c.startDate.getUTCHours() === 17)).toBe(true);
      expect(await superuser.booking.count({ where: { studentId: students[16].id, classId: classes[0].id, status: 'UPCOMING' } })).toBe(1);
    });

    it('switching a slot off with CANCEL removes its upcoming Classes and refunds the bookings', async () => {
      const slot = await mkSlot();
      const [first] = await upcomingOf(slot);
      const booked = await book(first.id, students[17]);
      expect(booked.status).toBe(201);
      expect((await patchSlot(slot, { status: 'OFF', bookedClasses: 'MOVE' })).status).toBe(400);
      expect((await patchSlot(slot, { status: 'OFF', bookedClasses: 'CANCEL' })).status).toBe(200);
      expect(await upcomingOf(slot)).toHaveLength(0);
      const b = await superuser.booking.findUniqueOrThrow({ where: { id: booked.body.id } });
      expect(b.status).toBe('CANCELLED');
      expect(b.refundResolution).toBe('REFUNDED');
    });

    it('archiving a slot takes its unbooked upcoming Classes off the schedule', async () => {
      const slot = await mkSlot();
      expect(await upcomingOf(slot)).toHaveLength(4);
      expect((await http().post(`/v1/timetable/${slot}/archive`).set('Authorization', `Bearer ${owner.token}`).send({})).status).toBe(201);
      expect(await upcomingOf(slot)).toHaveLength(0);
    });
  });
});
