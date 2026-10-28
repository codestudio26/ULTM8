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
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
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
    it('never a 5xx; a duplicate booking is the usual 409', async () => {
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
          if (r.book.status === 409) expect(r.book.body.error.message).toBe('This Student already has an active Booking for this Class.');
        }
        for (const s of students) {
          // Every Student ends up checked in.
          expect(await superuser.booking.count({ where: { classId: cls.id, studentId: s.id, status: 'COMPLETED' } })).toBeGreaterThanOrEqual(1);
        }
      }
    });
  });
});
