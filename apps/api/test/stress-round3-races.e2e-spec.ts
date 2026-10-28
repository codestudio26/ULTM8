/**
 * Regression gate for the races the round-3 stress test of 27 Oct 2026 found,
 * each driven with parallel HTTP requests:
 *
 * - bookings racing a whole-class cancel stayed Upcoming on the cancelled class;
 * - a whole-class cancel left half done couldn't be finished ("already cancelled");
 * - closing a Branch while people booked its classes deadlocked (HTTP 500);
 * - a style could be archived while classes using it were being created;
 * - the same Student booked and checked in from two desks at once deadlocked
 *   (HTTP 500).
 *
 * - a desk sale created its Membership after the School's close had answered.
 *
 * Plus the product owner's rules of 28 Oct 2026: one attendance per Student per
 * Class, a desk sale or Friend Pass clicked twice, and a Friend Pass covering
 * only a guest.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET (and REDIS_URL for the queues).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[stress-round3-races.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const MIN = 60_000;
const HOUR = 3_600_000;

describeIfDb('Round-3 stress-test races', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const school = { id: randomUUID() };
  type U = { id: string; email: string; token: string };
  let owner: U;
  const students: U[] = [];
  let packPlanId: string;
  let paymentAccountId: string;

  const http = () => request(app.getHttpServer());
  const at = (ms: number) => new Date(Date.now() + ms);
  const mkClass = (data: Record<string, unknown>) =>
    superuser.class.create({ data: { membershipInclusion: true, id: randomUUID(), schoolId: school.id, title: 'Race fixture', startDate: at(2 * HOUR), endDate: at(3 * HOUR), ...data } });
  const mkBranch = (name: string) => superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: `${name} ${randomUUID().slice(0, 8)}` } });
  const post = (path: string, who: U, body: Record<string, unknown> = {}) => http().post(`/v1${path}`).set('Authorization', `Bearer ${who.token}`).send(body);
  const book = (classId: string, who: U, body: Record<string, unknown> = {}) => post(`/classes/${classId}/book`, who, body);
  const statuses = (rs: Array<{ status: number }>) => rs.map((r) => r.status);

  async function mkUser(label: string, role: 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'STUDENT'): Promise<U> {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `r3-races-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Race',
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
    // These races take hundreds of requests from one address within a minute,
    // past the default per-IP limit (60). Read when AppModule loads, hence the
    // late import. The per-user booking limits still apply.
    process.env.THROTTLE_IP_LIMIT_PER_MINUTE = '100000';
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    // Listening once: an unbound server makes supertest open a new listener per
    // request, and many at once then reset each other's connections.
    await app.listen(0);

    await superuser.school.create({ data: { id: school.id, name: 'Round 3 Races School', timezone: 'UTC', ranksToggle: true } });
    owner = await mkUser('owner', 'SCHOOL_OWNER_MANAGER');
    // For the paid desk sales below.
    paymentAccountId = (await superuser.paymentAccount.create({
      data: { id: randomUUID(), schoolId: school.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: 'acct_fixture' },
    })).id;
    const subscriptionPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } })).id;
    packPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: 'Pack', price: 3000, classesIncluded: 50 } })).id;
    for (let i = 0; i < 12; i++) {
      const s = await mkUser(`student${i}`, 'STUDENT');
      students.push(s);
      // Half on a Subscription, half on a Class Pack (the pack's credit is a row lock too).
      await superuser.membership.create({
        data: i % 2 === 0
          ? { id: randomUUID(), studentId: s.id, schoolId: school.id, membershipPlanId: subscriptionPlanId, frequency: 'RECURRING' }
          : { id: randomUUID(), studentId: s.id, schoolId: school.id, membershipPlanId: packPlanId, frequency: 'ONE_TIME', classesRemaining: 50 },
      });
    }
  });

  afterAll(async () => {
    const userIds = (await superuser.user.findMany({ where: { email: { contains: 'r3-races-' } }, select: { id: true } })).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.trainingLog.deleteMany({ where: { schoolId: school.id } });
    await superuser.waitlistEntry.deleteMany({ where: { schoolId: school.id } });
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.transaction.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.paymentAccount.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.timetableSlot.deleteMany({ where: { schoolId: school.id } });
    await superuser.discipline.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.branch.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('bookings racing a whole-class cancel', () => {
    for (const capacity of [40, null]) {
      it(`no booking stays Upcoming on the cancelled class (capacity ${capacity ?? 'none'})`, async () => {
        for (let round = 0; round < 4; round++) {
          const cls = await mkClass({ capacity });
          const [cancel, ...bookings] = await Promise.all([
            post(`/classes/${cls.id}/cancel`, owner),
            ...students.slice(0, 10).map((s) => book(cls.id, s)),
          ]);
          expect(cancel.status).toBe(201);
          for (const b of bookings) expect([201, 409]).toContain(b.status);
          const refused = bookings.filter((b) => b.status === 409);
          for (const b of refused) expect(b.body.error.message).toBe('This class has been cancelled by the school.');
          expect(await superuser.booking.count({ where: { classId: cls.id, status: 'UPCOMING' } })).toBe(0);
          // Every booking that got in was cancelled with the class.
          expect(await superuser.booking.count({ where: { classId: cls.id, status: 'CANCELLED' } })).toBe(bookings.length - refused.length);
        }
      });
    }
  });

  describe('a whole-class cancel left half done', () => {
    it('calling cancel again finishes it, then says "already cancelled"', async () => {
      const cls = await mkClass({ capacity: 10 });
      const [a, b, c] = students;
      for (const s of [a, b, c]) expect((await book(cls.id, s)).status).toBe(201);
      const waiter = await superuser.waitlistEntry.create({ data: { id: randomUUID(), classId: cls.id, studentId: students[3].id, schoolId: school.id, position: 1 } });
      // The first call marked the class, cancelled one booking, then failed.
      const markedAt = new Date();
      await superuser.class.update({ where: { id: cls.id }, data: { cancelledAt: markedAt, cancelledById: owner.id, cancellationReason: 'Flooded hall' } });
      await superuser.booking.updateMany({ where: { classId: cls.id, studentId: a.id }, data: { status: 'CANCELLED' } });

      const again = await post(`/classes/${cls.id}/cancel`, owner, { reason: 'ignored' });
      expect(again.status).toBe(201);
      expect(again.body.cancellationReason).toBe('Flooded hall');
      expect(new Date(again.body.cancelledAt).getTime()).toBe(markedAt.getTime());
      expect(await superuser.booking.count({ where: { classId: cls.id, status: 'UPCOMING' } })).toBe(0);
      expect((await superuser.waitlistEntry.findUniqueOrThrow({ where: { id: waiter.id } })).status).toBe('CANCELLED');
      // The packs used for b's or c's seat got their credit back (the School's default).
      for (const s of [b, c]) {
        const seat = await superuser.booking.findFirstOrThrow({ where: { classId: cls.id, studentId: s.id } });
        expect(seat.refundResolution).not.toBeNull();
      }

      const done = await post(`/classes/${cls.id}/cancel`, owner);
      expect(done.status).toBe(409);
      expect(done.body.error.message).toBe('This class is already cancelled.');
    });
  });

  describe('closing a Branch while people book its classes', () => {
    it('neither the close nor any booking fails with a 5xx', async () => {
      for (let round = 0; round < 4; round++) {
        const [closing, target] = await Promise.all([mkBranch('Closing'), mkBranch('Target')]);
        const capped = await mkClass({ branchId: closing.id, capacity: 40 });
        const open = await mkClass({ branchId: closing.id, capacity: null });
        const results = await Promise.all([
          ...students.slice(0, 5).map((s) => book(capped.id, s)),
          post(`/branches/${closing.id}/close`, owner, { classesTo: target.id }),
          ...students.slice(5, 10).map((s) => book(open.id, s)),
        ]);
        expect(statuses(results).filter((st) => st >= 500)).toEqual([]);
        const close = results[5];
        expect(close.status).toBe(201);
        // Whatever got booked moved with its class.
        expect(await superuser.booking.count({ where: { classId: { in: [capped.id, open.id] }, branchId: closing.id } })).toBe(0);
        await superuser.booking.deleteMany({ where: { classId: { in: [capped.id, open.id] } } });
      }
    });
  });

  describe('bookings racing a slot switched off with its booked classes cancelled', () => {
    it('no booking stays Upcoming on a class the slot change cancelled', async () => {
      for (let round = 0; round < 4; round++) {
        const start = at(2 * HOUR);
        const weekdays = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;
        const slot = await superuser.timetableSlot.create({
          data: {
            id: randomUUID(), schoolId: school.id, weekday: weekdays[start.getUTCDay()], title: 'Race slot', membershipInclusion: true, capacity: 40,
            startTime: new Date(Date.UTC(1970, 0, 1, start.getUTCHours(), start.getUTCMinutes())),
            endTime: new Date(Date.UTC(1970, 0, 1, (start.getUTCHours() + 1) % 24, start.getUTCMinutes())),
          },
        });
        const cls = await mkClass({ capacity: 40, timetableSlotId: slot.id, occurrenceDate: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) });
        // Booked, so switching the slot off needs the CANCEL choice.
        expect((await book(cls.id, students[0])).status).toBe(201);
        const [off, ...bookings] = await Promise.all([
          http().patch(`/v1/timetable/${slot.id}`).set('Authorization', `Bearer ${owner.token}`).send({ status: 'OFF', bookedClasses: 'CANCEL' }),
          ...students.slice(1, 10).map((s) => book(cls.id, s)),
        ]);
        expect(off.status).toBe(200);
        expect(statuses(bookings).filter((st) => st >= 500)).toEqual([]);
        expect(await superuser.booking.count({ where: { classId: cls.id, status: 'UPCOMING' } })).toBe(0);
        const after = await superuser.class.findUniqueOrThrow({ where: { id: cls.id } });
        expect(after.cancelledAt).not.toBeNull();
        expect(after.archivedAt).not.toBeNull();
      }
    });
  });

  describe('archiving a style while classes using it are created', () => {
    it('the style is never archived with an upcoming class using it', async () => {
      for (let round = 0; round < 6; round++) {
        const style = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: `Race style ${randomUUID().slice(0, 8)}`, classTypesOffered: [] } });
        const create = () => post(`/schools/${school.id}/classes`, owner, {
          title: 'Race class', styles: [{ disciplineId: style.id }], startDate: at(2 * HOUR).toISOString(), endDate: at(3 * HOUR).toISOString(), membershipInclusion: true,
        });
        const [archive, ...creates] = await Promise.all([post(`/disciplines/${style.id}/archive`, owner), ...Array.from({ length: 5 }, create)]);
        expect([201, 409]).toContain(archive.status);
        for (const c of creates) expect([201, 400]).toContain(c.status);
        const archived = (await superuser.discipline.findUniqueOrThrow({ where: { id: style.id } })).archivedAt !== null;
        const using = await superuser.class.count({ where: { schoolId: school.id, archivedAt: null, styles: { array_contains: [{ disciplineId: style.id }] } } });
        expect(archived && using > 0).toBe(false);
        expect(archived).toBe(archive.status === 201);
      }
    });
  });

  describe('the same Student booked and checked in from two desks at once', () => {
    it('never a 5xx; a duplicate booking is a 409; each Student attends once', async () => {
      // A class with a style: its check-in writes a training log, whose key-share
      // lock on the Class was half of the deadlock.
      const style = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: `Desk style ${randomUUID().slice(0, 8)}`, classTypesOffered: [] } });
      for (let round = 0; round < 4; round++) {
        // Two fresh desks a round: each staff member may book 20 a minute.
        const desks = [await mkUser(`desk${round}a`, 'BRANCH_STAFF'), await mkUser(`desk${round}b`, 'BRANCH_STAFF')];
        // Started 5 minutes ago, so check-in is open.
        const cls = await mkClass({ capacity: 40, startDate: at(-5 * MIN), endDate: at(55 * MIN), styles: [{ disciplineId: style.id, classType: null }], activities: [style.name] });
        const results = await Promise.all(students.map((s) => Promise.all(desks.map(async (desk) => {
          const b = await book(cls.id, desk, { studentId: s.id });
          const scan = await post(`/classes/${cls.id}/attendance-scan`, desk, { studentId: s.id });
          return { book: b, scan };
        }))));
        const flat = results.flat();
        expect(statuses(flat.map((r) => r.book)).filter((st) => st >= 500)).toEqual([]);
        expect(statuses(flat.map((r) => r.scan)).filter((st) => st >= 500)).toEqual([]);
        for (const r of flat) {
          expect([201, 409]).toContain(r.book.status);
          // Refused while the other desk's booking is Upcoming, or once it's checked in.
          if (r.book.status === 409) {
            expect(['This Student already has an active Booking for this Class.', 'This student has already attended this class.']).toContain(r.book.body.error.message);
          }
        }
        for (const s of students) {
          // Every Student ends up checked in, exactly once.
          expect(await superuser.booking.count({ where: { classId: cls.id, studentId: s.id, status: 'COMPLETED' } })).toBe(1);
          expect(await superuser.booking.count({ where: { classId: cls.id, studentId: s.id } })).toBe(1);
        }
      }
    });
  });

  describe('one attendance per Student per Class (product owner, 28 Oct 2026)', () => {
    const ATTENDED = 'This student has already attended this class.';
    let desk: U;
    beforeAll(async () => {
      desk = await mkUser('attend-desk', 'BRANCH_STAFF');
    });
    // Started 5 minutes ago, so check-in is open.
    const startedClass = () => mkClass({ capacity: 40, startDate: at(-5 * MIN), endDate: at(55 * MIN) });
    const checkIn = (classId: string, s: U) => post(`/classes/${classId}/attendance-scan`, desk, { studentId: s.id });

    it('after check-in, a second booking, waitlist place or claim is refused', async () => {
      const s = students[0];
      const cls = await startedClass();
      expect((await book(cls.id, desk, { studentId: s.id })).status).toBe(201);
      expect((await checkIn(cls.id, s)).status).toBe(201);

      for (const res of [await book(cls.id, desk, { studentId: s.id }), await book(cls.id, s), await post(`/classes/${cls.id}/waitlist`, desk, { studentId: s.id })]) {
        expect(res.status).toBe(409);
        expect(res.body.error.message).toBe(ATTENDED);
      }
      const offered = await superuser.waitlistEntry.create({
        data: { id: randomUUID(), classId: cls.id, studentId: s.id, schoolId: school.id, position: 1, status: 'NOTIFIED', claimByDeadline: at(HOUR) },
      });
      const claim = await post(`/waitlist/${offered.id}/claim`, s);
      expect(claim.status).toBe(409);
      expect(claim.body.error.message).toBe(ATTENDED);
      expect(await superuser.booking.count({ where: { classId: cls.id, studentId: s.id } })).toBe(1);
    });

    it('two desks booking the checked-in Student again at once: both refused, one attendance', async () => {
      const s = students[1];
      const cls = await startedClass();
      expect((await book(cls.id, desk, { studentId: s.id })).status).toBe(201);
      const [scan, ...again] = await Promise.all([checkIn(cls.id, s), ...Array.from({ length: 4 }, () => book(cls.id, owner, { studentId: s.id }))]);
      expect(scan.status).toBe(201);
      for (const r of again) expect(r.status).toBe(409);
      expect(await superuser.booking.count({ where: { classId: cls.id, studentId: s.id } })).toBe(1);
      expect(await superuser.booking.count({ where: { classId: cls.id, studentId: s.id, status: 'COMPLETED' } })).toBe(1);
    });

    it('a cancelled booking does not block booking again', async () => {
      const s = students[2];
      const cls = await mkClass({ capacity: 40 });
      const first = await book(cls.id, desk, { studentId: s.id });
      expect(first.status).toBe(201);
      const cancelled = await http().patch(`/v1/bookings/${first.body.id}/cancel`).set('Authorization', `Bearer ${owner.token}`).send({});
      expect(cancelled.status).toBe(200);
      expect((await book(cls.id, desk, { studentId: s.id })).status).toBe(201);
    });
  });

  describe('a Friend Pass covers a guest, never its holder (product owner, 28 Oct 2026)', () => {
    let friendPassPlanId: string;
    beforeAll(async () => {
      friendPassPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'FRIEND_PASS', title: 'Friend Pass', price: 0, classesIncluded: 1 } })).id;
    });
    const mkFriendPass = (studentId: string, expiryDate?: Date) => superuser.membership.create({
      data: { id: randomUUID(), studentId, schoolId: school.id, membershipPlanId: friendPassPlanId, frequency: 'ONE_TIME', classesRemaining: 1, expiryDate, giftedById: owner.id },
    });

    it('a Student with only a Friend Pass can\'t book or claim their own seat with it', async () => {
      const s = await mkUser('fp-only', 'STUDENT');
      const pass = await mkFriendPass(s.id);
      const cls = await mkClass({ capacity: 40 });
      for (const res of [await book(cls.id, s), await book(cls.id, owner, { studentId: s.id })]) {
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe('This Student has no Active Membership eligible to fund this Booking.');
      }
      const offered = await superuser.waitlistEntry.create({
        data: { id: randomUUID(), classId: cls.id, studentId: s.id, schoolId: school.id, position: 1, status: 'NOTIFIED', claimByDeadline: at(HOUR) },
      });
      const claim = await post(`/waitlist/${offered.id}/claim`, s);
      expect(claim.status).toBe(400);
      expect(claim.body.error.message).toBe('This Student has no Active Membership eligible to fund this Booking.');
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: pass.id } })).classesRemaining).toBe(1);
    });

    it('still covers a guest, while the holder\'s own seat uses their other plan', async () => {
      const s = await mkUser('fp-guest', 'STUDENT');
      const pack = await superuser.membership.create({
        data: { id: randomUUID(), studentId: s.id, schoolId: school.id, membershipPlanId: packPlanId, frequency: 'ONE_TIME', classesRemaining: 5, expiryDate: at(30 * 24 * HOUR) },
      });
      // Expires first, so it would have been picked first for the own seat.
      const pass = await mkFriendPass(s.id, at(24 * HOUR));
      const cls = await mkClass({ capacity: 40 });
      const res = await book(cls.id, s, { attendeeMembershipIds: [pass.id] });
      expect(res.status).toBe(201);
      const booking = await superuser.booking.findUniqueOrThrow({ where: { id: res.body.id }, include: { attendees: true } });
      expect(booking.sourceMembershipId).toBe(pack.id);
      expect(booking.attendees.map((a) => a.membershipId)).toEqual([pass.id]);
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: pack.id } })).classesRemaining).toBe(4);
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: pass.id } })).classesRemaining).toBe(0);
    });
  });

  describe('a desk sale or Friend Pass clicked twice (product owner, 28 Oct 2026)', () => {
    const JUST_RECORDED = 'This was just recorded. Check before adding another.';
    let otherPackPlanId: string;
    let friendPassPlanId: string;
    beforeAll(async () => {
      // A paid desk sale needs a currency.
      await superuser.membershipPlan.update({ where: { id: packPlanId }, data: { currency: 'GBP' } });
      otherPackPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: 'Pack of 10', price: 9000, currency: 'GBP', classesIncluded: 10 } })).id;
      friendPassPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'FRIEND_PASS', title: 'Desk Friend Pass', price: 0, classesIncluded: 1 } })).id;
    });
    const sell = (s: U, planId: string) => post(`/schools/${school.id}/students/${s.id}/memberships/sell`, owner, { membershipPlanId: planId, paymentMethod: 'CASH' });
    const gift = (s: U) => post(`/schools/${school.id}/students/${s.id}/memberships/gift`, owner, { membershipPlanId: friendPassPlanId });
    const deskPayment = (s: U, planId: string) => post(`/schools/${school.id}/desk-payments`, owner, { studentId: s.id, membershipPlanId: planId, paymentMethod: 'CASH' });
    const expectOneAndRepeat = (rs: Array<{ status: number; body: { error?: { message?: string } } }>) => {
      expect(statuses(rs).sort()).toEqual([201, 409]);
      expect(rs.find((r) => r.status === 409)!.body.error?.message).toBe(JUST_RECORDED);
    };
    const backdate = (studentId: string, planId: string) =>
      superuser.membership.updateMany({ where: { studentId, membershipPlanId: planId }, data: { createdAt: new Date(Date.now() - 61_000) } });

    it('Sell at the desk: one sale and a 409; another plan, or the same after a minute, is fine', async () => {
      const s = await mkUser('sell-twice', 'STUDENT');
      expectOneAndRepeat(await Promise.all([sell(s, packPlanId), sell(s, packPlanId)]));
      expect(await superuser.membership.count({ where: { studentId: s.id, membershipPlanId: packPlanId } })).toBe(1);
      expect(await superuser.transaction.count({ where: { studentId: s.id, membershipPlanId: packPlanId } })).toBe(1);
      expect((await sell(s, otherPackPlanId)).status).toBe(201);
      await backdate(s.id, packPlanId);
      expect((await sell(s, packPlanId)).status).toBe(201);
    });

    it('Record a payment: one payment and a 409', async () => {
      const s = await mkUser('pay-twice', 'STUDENT');
      expectOneAndRepeat(await Promise.all([deskPayment(s, packPlanId), deskPayment(s, packPlanId)]));
      expect(await superuser.transaction.count({ where: { studentId: s.id, membershipPlanId: packPlanId } })).toBe(1);
      // The Student's page and Record a payment are the same desk sale.
      const viaPage = await sell(s, packPlanId);
      expect(viaPage.status).toBe(409);
      expect(viaPage.body.error.message).toBe(JUST_RECORDED);
    });

    it('Give a Friend Pass: one pass and a 409; another after a minute is fine', async () => {
      const s = await mkUser('gift-twice', 'STUDENT');
      expectOneAndRepeat(await Promise.all([gift(s), gift(s)]));
      expect(await superuser.membership.count({ where: { studentId: s.id, membershipPlanId: friendPassPlanId } })).toBe(1);
      await backdate(s.id, friendPassPlanId);
      expect((await gift(s)).status).toBe(201);
    });

    it('the Student\'s own purchase a moment ago doesn\'t block a desk sale', async () => {
      const s = await mkUser('own-then-desk', 'STUDENT');
      const own = await superuser.membership.create({
        data: { id: randomUUID(), studentId: s.id, schoolId: school.id, membershipPlanId: packPlanId, frequency: 'ONE_TIME', classesRemaining: 50 },
      });
      await superuser.transaction.create({
        data: { id: randomUUID(), schoolId: school.id, studentId: s.id, paymentAccountId, membershipPlanId: packPlanId, membershipId: own.id, amount: 3000, currency: 'gbp', status: 'SUCCESSFUL', paymentMethod: 'STRIPE' },
      });
      expect((await sell(s, packPlanId)).status).toBe(201);
    });
  });

  describe('writes racing the School\'s close', () => {
    const closing = { id: randomUUID() };
    const CLOSED = 'This School has been closed and no longer accepts new or updated records.';
    let closingOwner: U;
    let pupil: U;
    let planId: string;
    let classId: string;
    let pendingId: string;

    beforeAll(async () => {
      await superuser.school.create({ data: { id: closing.id, name: 'Round 3 Closing School', timezone: 'UTC' } });
      const grant = async (label: string, role: 'SCHOOL_OWNER_MANAGER' | 'STUDENT'): Promise<U> => {
        const u = await mkUser(label, role);
        await superuser.roleGrant.updateMany({ where: { userId: u.id }, data: { schoolId: closing.id } });
        return { ...u, token: jwt.sign({ sub: u.id, email: u.email, grants: [{ role, franchiseId: null, schoolId: closing.id, branchId: null }] }) };
      };
      closingOwner = await grant('closing-owner', 'SCHOOL_OWNER_MANAGER');
      pupil = await grant('closing-pupil', 'STUDENT');
      const account = await superuser.paymentAccount.create({
        data: { id: randomUUID(), schoolId: closing.id, provider: 'STRIPE', accountTitle: 'Fixture', country: 'GB', stripeConnectedAccountId: 'acct_closing' },
      });
      planId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: closing.id, type: 'CLASS_PACK', title: 'Pack', price: 3000, currency: 'GBP', classesIncluded: 10 } })).id;
      // The pack the booking below uses.
      await superuser.membership.create({
        data: { id: randomUUID(), studentId: pupil.id, schoolId: closing.id, membershipPlanId: planId, frequency: 'ONE_TIME', classesRemaining: 10, createdAt: new Date(Date.now() - 5 * MIN) },
      });
      pendingId = (await superuser.transaction.create({
        data: { id: randomUUID(), schoolId: closing.id, studentId: pupil.id, paymentAccountId: account.id, membershipPlanId: planId, amount: 3000, currency: 'gbp', status: 'PENDING', paymentMethod: 'CASH' },
      })).id;
      classId = (await superuser.class.create({ data: { membershipInclusion: true, id: randomUUID(), schoolId: closing.id, title: 'Closing class', startDate: at(2 * HOUR), endDate: at(3 * HOUR) } })).id;
    });

    afterAll(async () => {
      await superuser.booking.deleteMany({ where: { schoolId: closing.id } });
      await superuser.transaction.deleteMany({ where: { schoolId: closing.id } });
      await superuser.membership.deleteMany({ where: { schoolId: closing.id } });
      await superuser.paymentAccount.deleteMany({ where: { schoolId: closing.id } });
      await superuser.membershipPlan.deleteMany({ where: { schoolId: closing.id } });
      await superuser.class.deleteMany({ where: { schoolId: closing.id } });
      await superuser.roleGrant.deleteMany({ where: { schoolId: closing.id } });
      await superuser.user.deleteMany({ where: { id: { in: [closingOwner.id, pupil.id] } } });
      await superuser.school.delete({ where: { id: closing.id } });
    });

    it('a desk sale, a cash confirm and a booking sent while the close commits are refused, and write nothing', async () => {
      const membershipsBefore = await superuser.membership.count({ where: { schoolId: closing.id } });
      // The close in flight: the School row is updated but not yet committed.
      // Each write already passed its check before the transaction (the School
      // still looked open), so only a check inside its own transaction can see it.
      let racing: Array<Promise<{ status: number; body: { error?: { message?: string } } }>> = [];
      await superuser.$transaction(async (tx) => {
        await tx.school.update({ where: { id: closing.id }, data: { archivedAt: new Date() } });
        racing = [
          post(`/schools/${closing.id}/desk-payments`, closingOwner, { studentId: pupil.id, membershipPlanId: planId, paymentMethod: 'CASH' }).then((r) => r),
          http().patch(`/v1/transactions/${pendingId}/confirm`).set('Authorization', `Bearer ${closingOwner.token}`).send({}).then((r) => r),
          book(classId, pupil).then((r) => r),
        ];
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }, { timeout: 10_000 });
      const [desk, confirm, booking] = await Promise.all(racing);
      for (const r of [desk, confirm, booking]) {
        expect(r.status).toBe(403);
        expect(r.body.error?.message).toBe(CLOSED);
      }
      expect(await superuser.membership.count({ where: { schoolId: closing.id } })).toBe(membershipsBefore);
      expect((await superuser.transaction.findUniqueOrThrow({ where: { id: pendingId } })).status).toBe('PENDING');
      expect(await superuser.booking.count({ where: { schoolId: closing.id } })).toBe(0);
    });
  });
});
