/**
 * Decision 353 — the Timetable calendar reads the real Classes (T7, Q5) and a
 * slot's break is copied onto its Classes for the class details (Q6):
 *
 * - GET /schools/:schoolId/timetable/calendar returns generated and one-off
 *   Classes with their local date and times, seats taken and waiting count;
 *   cancelled classes stay on it, removed ones don't; dates past the 4-week
 *   horizon come back as `later`;
 * - Branch Staff see their own Branch plus School-wide classes, and are refused
 *   another Branch's; Students are refused; a range over 62 days is refused;
 * - a slot's break reaches its Classes, moves with their times, and shows on the
 *   class details (staff and student side).
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
  console.warn('[timetable-calendar.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;
const DAY = 24 * 3_600_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

describeIfDb('Timetable calendar and class breaks (Decision 353)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  // Tokyo, so a class's local date and times differ from UTC.
  const school = { id: randomUUID() };
  const branchA = { id: randomUUID() };
  const branchB = { id: randomUUID() };
  type U = { id: string; token: string };
  let owner: U;
  let staffA: U;
  let student: U;
  let student2: U;

  const http = () => request(app.getHttpServer());
  const as = (who: U) => ({ get: (path: string) => http().get(path).set('Authorization', `Bearer ${who.token}`) });
  const tomorrow = () => new Date(Date.now() + DAY);
  const calendar = (who: U, from: string, to: string, extra = '') => as(who).get(`/v1/schools/${school.id}/timetable/calendar?from=${from}&to=${to}${extra}`);

  async function mkUser(label: string, role: 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'STUDENT', branchId: string | null = null): Promise<U> {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `tt-cal-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Calendar',
        passcodeHash: 'x',
        dateOfBirth: new Date('1995-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: user.id, schoolId: school.id, branchId } });
    return { id: user.id, token: jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId }] }) };
  }

  async function mkSlot(body: Record<string, unknown>): Promise<string> {
    const res = await http()
      .post(`/v1/schools/${school.id}/timetable`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ weekday: WEEKDAYS[tomorrow().getUTCDay()], startTime: '18:00', endTime: '19:00', title: 'Evening', activities: ['BJJ'], capacity: 10, ...body });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  const firstClassOf = (slotId: string) =>
    superuser.class.findFirstOrThrow({ where: { timetableSlotId: slotId, archivedAt: null }, orderBy: { startDate: 'asc' } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.create({ data: { id: school.id, name: 'Calendar School', timezone: 'Asia/Tokyo' } });
    await superuser.branch.create({ data: { id: branchA.id, schoolId: school.id, name: 'Branch A' } });
    await superuser.branch.create({ data: { id: branchB.id, schoolId: school.id, name: 'Branch B' } });
    owner = await mkUser('owner', 'SCHOOL_OWNER_MANAGER');
    staffA = await mkUser('staffA', 'BRANCH_STAFF', branchA.id);
    student = await mkUser('student', 'STUDENT');
    student2 = await mkUser('student2', 'STUDENT');
    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
    for (const s of [student, student2]) {
      await superuser.membership.create({ data: { id: randomUUID(), studentId: s.id, schoolId: school.id, membershipPlanId: plan.id, frequency: 'RECURRING' } });
    }
  });

  afterAll(async () => {
    const userIds = (await superuser.user.findMany({ where: { email: { contains: 'tt-cal-' } }, select: { id: true } })).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.waitlistEntry.deleteMany({ where: { schoolId: school.id } });
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.timetableSlot.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.branch.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  afterEach(async () => {
    await superuser.timetableSlot.updateMany({ where: { schoolId: school.id }, data: { status: 'OFF' } });
  });

  it('shows real classes with local date, times and seats taken, one-offs too, and later dates past 4 weeks', async () => {
    const slotId = await mkSlot({ title: 'Real Class', branchId: branchA.id });
    const cls = await firstClassOf(slotId);
    await http().post(`/v1/classes/${cls.id}/book`).set('Authorization', `Bearer ${student.token}`).send({}).expect(201);
    const oneOffStart = new Date(Date.now() + 2 * DAY);
    const oneOff = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Seminar', startDate: oneOffStart, endDate: new Date(oneOffStart.getTime() + 3_600_000), capacity: 5 },
    });

    const from = isoDate(new Date());
    const to = isoDate(new Date(Date.now() + 40 * DAY));
    const res = await calendar(owner, from, to);
    expect(res.status).toBe(200);
    const mine = res.body.classes.find((c: { id: string }) => c.id === cls.id);
    // 18:00 in Tokyo, on the class's own Tokyo date.
    expect(mine).toMatchObject({ timetableSlotId: slotId, startTime: '18:00', endTime: '19:00', seatsTaken: 1, waiting: 0, capacity: 10, branchId: branchA.id });
    expect(mine.date).toBe(isoDate(new Date(cls.startDate.getTime() + 9 * 3_600_000)));
    expect(res.body.classes.some((c: { id: string }) => c.id === oneOff.id)).toBe(true);
    // Four weeks are generated; the fifth and sixth week of the slot are later.
    const laterDates = res.body.later.filter((l: { slotId: string }) => l.slotId === slotId).map((l: { date: string }) => l.date);
    const generated = await superuser.class.findMany({ where: { timetableSlotId: slotId }, select: { occurrenceDate: true } });
    const lastGenerated = generated.map((g) => isoDate(g.occurrenceDate!)).sort().pop()!;
    expect(laterDates.length).toBeGreaterThan(0);
    expect(laterDates.every((d: string) => d > lastGenerated)).toBe(true);
  });

  it('keeps a cancelled class on the calendar and drops one that was only removed', async () => {
    const bookedSlot = await mkSlot({ title: 'Will Cancel' });
    const booked = await firstClassOf(bookedSlot);
    await http().post(`/v1/classes/${booked.id}/book`).set('Authorization', `Bearer ${student2.token}`).send({}).expect(201);
    const emptySlot = await mkSlot({ title: 'Will Remove' });
    const empty = await firstClassOf(emptySlot);
    for (const id of [bookedSlot, emptySlot]) {
      await http().patch(`/v1/timetable/${id}`).set('Authorization', `Bearer ${owner.token}`).send({ status: 'OFF', bookedClasses: 'CANCEL' }).expect(200);
    }

    const res = await calendar(owner, isoDate(new Date()), isoDate(new Date(Date.now() + 3 * DAY)));
    expect(res.status).toBe(200);
    const cancelled = res.body.classes.find((c: { id: string }) => c.id === booked.id);
    expect(cancelled?.cancelledAt).toBeTruthy();
    expect(res.body.classes.some((c: { id: string }) => c.id === empty.id)).toBe(false);
  });

  it('lets Branch Staff see their own Branch and School-wide classes only, and refuses others', async () => {
    const slotA = await mkSlot({ title: 'At A', branchId: branchA.id });
    const slotB = await mkSlot({ title: 'At B', branchId: branchB.id });
    const slotAll = await mkSlot({ title: 'Everywhere' });
    const [a, b, all] = await Promise.all([firstClassOf(slotA), firstClassOf(slotB), firstClassOf(slotAll)]);
    const from = isoDate(new Date());
    const to = isoDate(new Date(Date.now() + 8 * DAY));

    const res = await calendar(staffA, from, to);
    expect(res.status).toBe(200);
    const ids = res.body.classes.map((c: { id: string }) => c.id);
    expect(ids).toEqual(expect.arrayContaining([a.id, all.id]));
    expect(ids).not.toContain(b.id);

    expect((await calendar(staffA, from, to, `&branchId=${branchB.id}`)).status).toBe(403);
    expect((await calendar(student, from, to)).status).toBe(403);
    // The owner can narrow to one Branch: its classes plus School-wide ones.
    const narrowed = (await calendar(owner, from, to, `&branchId=${branchB.id}`)).body.classes.map((c: { id: string }) => c.id);
    expect(narrowed).toEqual(expect.arrayContaining([b.id, all.id]));
    expect(narrowed).not.toContain(a.id);
  });

  it('refuses a range over 62 days or backwards', async () => {
    expect((await calendar(owner, '2026-01-01', '2026-03-15')).status).toBe(400);
    expect((await calendar(owner, '2026-02-01', '2026-01-01')).status).toBe(400);
  });

  it("copies the slot's break onto its classes, moves it with the times, and shows it on the class details", async () => {
    const slotId = await mkSlot({ title: 'With Break', breakStart: '18:20', breakEnd: '18:30' });
    let cls = await firstClassOf(slotId);
    expect(cls.breakStartAt!.getTime() - cls.startDate.getTime()).toBe(20 * 60_000);
    expect(cls.breakEndAt!.getTime() - cls.startDate.getTime()).toBe(30 * 60_000);

    const detail = await as(owner).get(`/v1/classes/${cls.id}`);
    expect(detail.body.breakStartAt).toBe(cls.breakStartAt!.toISOString());
    const cal = await calendar(owner, isoDate(new Date()), isoDate(new Date(Date.now() + 8 * DAY)));
    expect(cal.body.classes.find((c: { id: string }) => c.id === cls.id)).toMatchObject({ breakStart: '18:20', breakEnd: '18:30' });

    // A booked class still takes a changed break: it has no effect on bookings.
    await http().post(`/v1/classes/${cls.id}/book`).set('Authorization', `Bearer ${student.token}`).send({}).expect(201);
    await http().patch(`/v1/timetable/${slotId}`).set('Authorization', `Bearer ${owner.token}`).send({ breakStart: '18:40', breakEnd: '18:45' }).expect(200);
    cls = await superuser.class.findUniqueOrThrow({ where: { id: cls.id } });
    expect(cls.breakStartAt!.getTime() - cls.startDate.getTime()).toBe(40 * 60_000);

    // Moving the times moves the break with them; removing it clears it.
    await http().patch(`/v1/timetable/${slotId}`).set('Authorization', `Bearer ${owner.token}`).send({ startTime: '17:00', endTime: '18:50', bookedClasses: 'MOVE' }).expect(200);
    cls = await superuser.class.findUniqueOrThrow({ where: { id: cls.id } });
    expect(cls.breakStartAt!.getTime() - cls.startDate.getTime()).toBe(100 * 60_000);
    await http().patch(`/v1/timetable/${slotId}`).set('Authorization', `Bearer ${owner.token}`).send({ breakStart: null, breakEnd: null }).expect(200);
    cls = await superuser.class.findUniqueOrThrow({ where: { id: cls.id } });
    expect(cls.breakStartAt).toBeNull();
    expect(cls.breakEndAt).toBeNull();
  });

  it('shows the break on the student-facing class card', async () => {
    const slotId = await mkSlot({ title: 'Student Break', breakStart: '18:15', breakEnd: '18:25' });
    const cls = await firstClassOf(slotId);
    const res = await as(student).get(`/v1/academies/${school.id}`);
    expect(res.status).toBe(200);
    const card = res.body.upcomingClasses.find((c: { id: string }) => c.id === cls.id);
    expect(card?.breakStartAt).toBe(cls.breakStartAt!.toISOString());
  });
});
