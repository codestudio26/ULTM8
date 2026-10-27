/**
 * Decision 353 (Q8) — closure dates (Decision 319 §3):
 *
 * - the owner closes the School or a Branch for some dates; classes on those
 *   local dates are cancelled under the School's normal rule and students are
 *   told; a Branch closure leaves other Branches' and School-wide classes alone;
 * - new slots, the nightly generation and the calendar's later dates skip
 *   closed dates; removing a closure brings the skipped dates back;
 * - any staff member reads the closures they cover; only the owner writes.
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
import { ClassOccurrenceGenerationProcessor } from '../src/jobs/class-occurrence-generation.processor';

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

describeIfDb('Timetable closures (Decision 353, Q8; Decision 319 §3)', () => {
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
        email: `tt-clo-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Closure',
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

    await superuser.school.create({ data: { id: school.id, name: 'Closure School', timezone: 'Asia/Tokyo' } });
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
    const userIds = (await superuser.user.findMany({ where: { email: { contains: 'tt-clo-' } }, select: { id: true } })).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.waitlistEntry.deleteMany({ where: { schoolId: school.id } });
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.closure.deleteMany({ where: { schoolId: school.id } });
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
    await superuser.closure.deleteMany({ where: { schoolId: school.id } });
  });

  const auth = (who: U) => `Bearer ${who.token}`;
  const close = (who: U, body: Record<string, unknown>) => http().post(`/v1/schools/${school.id}/closures`).set('Authorization', auth(who)).send(body);
  const localDate = (cls: { occurrenceDate: Date | null }) => isoDate(cls.occurrenceDate!);

  it('cancels the closed Branch\'s classes on those dates, tells the booked students, and leaves the rest', async () => {
    const [slotA, slotB, slotAll] = [await mkSlot({ title: 'Close A', branchId: branchA.id }), await mkSlot({ title: 'Close B', branchId: branchB.id }), await mkSlot({ title: 'Close All' })];
    const [a, b, all] = await Promise.all([firstClassOf(slotA), firstClassOf(slotB), firstClassOf(slotAll)]);
    await http().post(`/v1/classes/${a.id}/book`).set('Authorization', auth(student)).send({}).expect(201);
    const day = localDate(a);

    const res = await close(owner, { startDate: day, endDate: day, reason: 'Flooded mats', branchId: branchA.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ branchId: branchA.id, startDate: day, endDate: day, reason: 'Flooded mats', cancelledClasses: 1 });

    expect((await superuser.class.findUniqueOrThrow({ where: { id: a.id } })).cancelledAt).not.toBeNull();
    expect((await superuser.booking.findFirstOrThrow({ where: { classId: a.id } })).status).toBe('CANCELLED');
    const notice = await superuser.notification.findFirst({ where: { userId: student.id, type: 'CLASS_CANCELLED' } });
    expect(notice?.body).toContain('Flooded mats');
    for (const other of [b, all]) expect((await superuser.class.findUniqueOrThrow({ where: { id: other.id } })).cancelledAt).toBeNull();

    // The calendar shows the closure and the cancelled class.
    const cal = await calendar(owner, day, day);
    expect(cal.body.closures).toEqual([expect.objectContaining({ id: res.body.id, reason: 'Flooded mats' })]);
    expect(cal.body.classes.find((c: { id: string }) => c.id === a.id).cancelledAt).not.toBeNull();
  });

  it('skips closed dates for new slots, the nightly run and later dates, and brings them back when removed', async () => {
    const probe = await firstClassOf(await mkSlot({ title: 'Probe' }));
    const closedDay = isoDate(new Date(probe.occurrenceDate!.getTime() + 14 * DAY));
    const laterDay = isoDate(new Date(probe.occurrenceDate!.getTime() + 35 * DAY));
    const res = await close(owner, { startDate: closedDay, endDate: laterDay, reason: 'Renovation' });
    expect(res.status).toBe(201);

    const slotId = await mkSlot({ title: 'After Closure' });
    await app.get(ClassOccurrenceGenerationProcessor).process({} as never);
    const dates = async () => (await superuser.class.findMany({ where: { timetableSlotId: slotId }, select: { occurrenceDate: true } })).map((c) => isoDate(c.occurrenceDate!)).sort();
    const before = await dates();
    expect(before).not.toContain(closedDay);
    expect(before).toHaveLength(2);

    const cal = await calendar(owner, isoDate(new Date()), laterDay);
    expect(cal.body.later.filter((l: { slotId: string }) => l.slotId === slotId)).toEqual([]);

    await http().delete(`/v1/closures/${res.body.id}`).set('Authorization', auth(owner)).expect(204);
    const after = await dates();
    expect(after).toContain(closedDay);
    expect(after).toHaveLength(4);
  });

  it('lets staff read the closures they cover, and only the owner add or remove them', async () => {
    const day = isoDate(new Date(Date.now() + 60 * DAY));
    const atB = (await close(owner, { startDate: day, endDate: day, reason: 'B only', branchId: branchB.id })).body;
    const whole = (await close(owner, { startDate: day, endDate: day, reason: 'Everyone' })).body;

    const list = await http().get(`/v1/schools/${school.id}/closures`).set('Authorization', auth(staffA));
    expect(list.status).toBe(200);
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([whole.id]);
    expect((await http().get(`/v1/schools/${school.id}/closures`).set('Authorization', auth(student))).status).toBe(403);

    expect((await close(staffA, { startDate: day, endDate: day, reason: 'Nope', branchId: branchA.id })).status).toBe(403);
    expect((await http().delete(`/v1/closures/${whole.id}`).set('Authorization', auth(staffA))).status).toBe(403);
    expect((await http().delete(`/v1/closures/${atB.id}`).set('Authorization', auth(staffA))).status).toBe(404);
  });

  it('refuses backwards, past or overlong dates and another School\'s branch', async () => {
    const day = isoDate(new Date(Date.now() + 10 * DAY));
    expect((await close(owner, { startDate: day, endDate: '2020-01-01', reason: 'x' })).status).toBe(400);
    expect((await close(owner, { startDate: '2020-01-01', endDate: '2020-01-02', reason: 'x' })).status).toBe(400);
    expect((await close(owner, { startDate: day, endDate: isoDate(new Date(Date.now() + 400 * DAY)), reason: 'x' })).status).toBe(400);
    expect((await close(owner, { startDate: day, endDate: day, reason: '   ' })).status).toBe(400);
    expect((await close(owner, { startDate: day, endDate: day, reason: 'x', branchId: randomUUID() })).status).toBe(400);
  });
});
