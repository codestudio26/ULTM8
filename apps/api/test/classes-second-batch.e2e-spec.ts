/**
 * Regression gate for the Classes review's second batch (Decision 345), over
 * real HTTP:
 *
 * - C1: a one-off Class needs its own ticket unless "Included in membership" is
 *   ticked; Timetable Classes stay covered by general access;
 * - C5: moving a booked Class tells booked and waiting Students, and can't move
 *   it into the past;
 * - C14: a booked Class can't move to another Branch, and a booking stranded by
 *   an earlier move can still be cancelled by the owner;
 * - a Class that has already ended can't be created.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET (and REDIS_URL for the queues).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { NOTIFICATION_FANOUT_QUEUE, WAITLIST_CASCADE_PROCESSING_QUEUE } from '../src/jobs/queue.constants';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[classes-second-batch.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describeIfDb('Classes review second batch (Decision 345)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  let notify: jest.SpyInstance;

  const school = { id: randomUUID() };
  const north = { id: randomUUID() };
  const south = { id: randomUUID() };
  type U = { id: string; token: string };
  let owner: U;
  let subscriptionPlanId: string;
  let generalPackPlanId: string;

  const http = () => request(app.getHttpServer());
  const at = (ms: number) => new Date(Date.now() + ms);
  const mkClass = (data: Record<string, unknown> = {}) =>
    superuser.class.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Fixture', startDate: at(DAY), endDate: at(DAY + HOUR), ...data } });
  const patch = (classId: string, body: Record<string, unknown>) => http().patch(`/v1/classes/${classId}`).set('Authorization', `Bearer ${owner.token}`).send(body);
  const book = (classId: string, who: U) => http().post(`/v1/classes/${classId}/book`).set('Authorization', `Bearer ${who.token}`).send({});

  async function mkUser(label: string, role: 'SCHOOL_OWNER_MANAGER' | 'STUDENT', branchId: string | null = null): Promise<U> {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `classes-batch2-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Batch',
        passcodeHash: 'x',
        dateOfBirth: new Date('1995-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId: school.id, branchId } });
    const token = jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId }] });
    return { id: user.id, token };
  }

  async function mkStudent(label: string, planId: string | null = subscriptionPlanId, branchId: string | null = null): Promise<U> {
    const s = await mkUser(label, 'STUDENT', branchId);
    if (planId) {
      await superuser.membership.create({ data: { id: randomUUID(), studentId: s.id, schoolId: school.id, membershipPlanId: planId, frequency: 'RECURRING' } });
    }
    return s;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    jest.spyOn(app.get<Queue>(getQueueToken(WAITLIST_CASCADE_PROCESSING_QUEUE)), 'add').mockResolvedValue(undefined as never);
    notify = jest.spyOn(app.get<Queue>(getQueueToken(NOTIFICATION_FANOUT_QUEUE)), 'add').mockResolvedValue(undefined as never);

    await superuser.school.create({ data: { id: school.id, name: 'Classes Batch 2 School', timezone: 'UTC' } });
    await superuser.branch.create({ data: { id: north.id, schoolId: school.id, name: 'North' } });
    await superuser.branch.create({ data: { id: south.id, schoolId: school.id, name: 'South' } });
    owner = await mkUser('owner', 'SCHOOL_OWNER_MANAGER');
    subscriptionPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } })).id;
    generalPackPlanId = (await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '10 classes', price: 9000, classesIncluded: 10 } })).id;
  });

  afterAll(async () => {
    const userIds = (await superuser.user.findMany({ where: { email: { contains: 'classes-batch2-' } }, select: { id: true } })).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.waitlistEntry.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.branch.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('"Included in membership" on one-off Classes (C1)', () => {
    it('a one-off Class needs its own ticket: a Subscription or a general Class Pack is refused', async () => {
      const seminar = await mkClass({ title: 'Seminar' });
      const subscriber = await mkStudent('subscriber');
      const packHolder = await mkStudent('pack', null);
      await superuser.membership.create({
        data: { id: randomUUID(), studentId: packHolder.id, schoolId: school.id, membershipPlanId: generalPackPlanId, frequency: 'ONE_TIME', classesRemaining: 10 },
      });

      const bySubscription = await book(seminar.id, subscriber);
      expect(bySubscription.status).toBe(400);
      expect(bySubscription.body.error.code).toBe('TICKET_REQUIRED');
      const byPack = await book(seminar.id, packHolder);
      expect(byPack.status).toBe(400);
      expect(byPack.body.error.code).toBe('TICKET_REQUIRED');
      // The general pack kept its credits.
      const pack = await superuser.membership.findFirstOrThrow({ where: { studentId: packHolder.id } });
      expect(pack.classesRemaining).toBe(10);
    });

    it('a ticket scoped to the Class books it and spends its one credit', async () => {
      const seminar = await mkClass({ title: 'Ticketed seminar' });
      const ticketPlan = await superuser.membershipPlan.create({
        data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: 'Seminar ticket', price: 2000, classesIncluded: 1, scopedClassId: seminar.id },
      });
      const holder = await mkStudent('ticket', null);
      const ticket = await superuser.membership.create({
        data: { id: randomUUID(), studentId: holder.id, schoolId: school.id, membershipPlanId: ticketPlan.id, frequency: 'ONE_TIME', classesRemaining: 1, scopedClassId: seminar.id },
      });

      const res = await book(seminar.id, holder);
      expect(res.status).toBe(201);
      expect(res.body.sourceMembershipId).toBe(ticket.id);
      expect((await superuser.membership.findUniqueOrThrow({ where: { id: ticket.id } })).classesRemaining).toBe(0);
    });

    it('ticking "Included in membership" lets any membership book the one-off Class', async () => {
      const openSeminar = await mkClass({ title: 'Open seminar', membershipInclusion: true });
      const subscriber = await mkStudent('included');
      expect((await book(openSeminar.id, subscriber)).status).toBe(201);
    });

    it('Timetable Classes stay covered, also after their slot is gone', async () => {
      const subscriber = await mkStudent('timetable');
      // A Class the Timetable made keeps its occurrenceDate; deleting its slot
      // only clears timetableSlotId (SET NULL).
      const fromTimetable = await mkClass({ title: 'Monday BJJ', occurrenceDate: new Date('2030-01-07') });
      expect((await book(fromTimetable.id, subscriber)).status).toBe(201);
    });
  });

  describe('moving a booked Class to a new time (C5)', () => {
    it('booked and waiting Students are told, and the bookings move with the Class', async () => {
      const cls = await mkClass({ title: 'Moving class', capacity: 1, membershipInclusion: true });
      const booked = await mkStudent('moved-booked');
      const waiting = await mkStudent('moved-waiting');
      expect((await book(cls.id, booked)).status).toBe(201);
      await superuser.waitlistEntry.create({ data: { id: randomUUID(), classId: cls.id, studentId: waiting.id, schoolId: school.id, position: 1 } });
      notify.mockClear();

      const newStart = at(2 * DAY);
      const res = await patch(cls.id, { startDate: newStart.toISOString(), endDate: new Date(newStart.getTime() + HOUR).toISOString() });
      expect(res.status).toBe(200);
      const told = notify.mock.calls.map(([, data]) => data as { userId: string; title: string; type: string; body: string });
      expect(told.map((d) => d.userId).sort()).toEqual([booked.id, waiting.id].sort());
      expect(told.every((d) => d.title === 'Class moved' && d.type === 'CLASS_MOVED' && d.body.startsWith('Moving class has moved to '))).toBe(true);
      expect(await superuser.booking.count({ where: { classId: cls.id, status: 'UPCOMING' } })).toBe(1);
    });

    it('a booked Class can not move to a time that has passed', async () => {
      const cls = await mkClass({ title: 'No past move', membershipInclusion: true });
      expect((await book(cls.id, await mkStudent('past-booked'))).status).toBe(201);
      notify.mockClear();

      const res = await patch(cls.id, { startDate: at(-2 * HOUR).toISOString(), endDate: at(-HOUR).toISOString() });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CLASS_MOVED_TO_PAST');
      expect((await superuser.class.findUniqueOrThrow({ where: { id: cls.id } })).startDate.getTime()).toBe(cls.startDate.getTime());
      expect(notify).not.toHaveBeenCalled();
    });

    it('a Class nobody booked can still be moved freely, without notices', async () => {
      const cls = await mkClass({ title: 'Empty class' });
      notify.mockClear();
      const res = await patch(cls.id, { startDate: at(3 * DAY).toISOString(), endDate: at(3 * DAY + HOUR).toISOString() });
      expect(res.status).toBe(200);
      expect(notify).not.toHaveBeenCalled();
    });
  });

  describe('moving a booked Class to another Branch (C14)', () => {
    it('is refused while Students are booked or waiting, and allowed once they are not', async () => {
      const cls = await mkClass({ title: 'North class', branchId: north.id, membershipInclusion: true });
      const student = await mkStudent('north', subscriptionPlanId, north.id);
      const booked = await book(cls.id, student);
      expect(booked.status).toBe(201);

      const refused = await patch(cls.id, { branchId: south.id });
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('CLASS_BRANCH_BOOKED');

      const waitingOnly = await mkClass({ title: 'North waitlist', branchId: north.id });
      await superuser.waitlistEntry.create({ data: { id: randomUUID(), classId: waitingOnly.id, studentId: student.id, schoolId: school.id, position: 1 } });
      expect((await patch(waitingOnly.id, { branchId: south.id })).body.error.code).toBe('CLASS_BRANCH_BOOKED');

      const cancelled = await http().patch(`/v1/bookings/${booked.body.id}/cancel`).set('Authorization', `Bearer ${owner.token}`).send({});
      expect(cancelled.status).toBe(200);
      expect((await patch(cls.id, { branchId: south.id })).status).toBe(200);
    });

    it('the owner can still cancel a booking stranded by a move made before this rule', async () => {
      const cls = await mkClass({ title: 'Stranded class', branchId: north.id, membershipInclusion: true });
      const student = await mkStudent('stranded', subscriptionPlanId, north.id);
      const booked = await book(cls.id, student);
      expect(booked.status).toBe(201);
      // The old behaviour: moved with the booking still on it.
      await superuser.class.update({ where: { id: cls.id }, data: { branchId: south.id } });

      const res = await http().patch(`/v1/bookings/${booked.body.id}/cancel`).set('Authorization', `Bearer ${owner.token}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
    });
  });

  describe('creating a Class that has already ended', () => {
    it('is refused', async () => {
      const res = await http()
        .post(`/v1/schools/${school.id}/classes`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ title: 'Last week', activities: ['BJJ'], startDate: at(-7 * DAY).toISOString(), endDate: at(-7 * DAY + HOUR).toISOString() });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CLASS_ALREADY_ENDED');
    });

    it('a Class already under way can still be created (a walk-in session)', async () => {
      const res = await http()
        .post(`/v1/schools/${school.id}/classes`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ title: 'Started', activities: ['BJJ'], startDate: at(-HOUR).toISOString(), endDate: at(HOUR).toISOString() });
      expect(res.status).toBe(201);
    });
  });
});
