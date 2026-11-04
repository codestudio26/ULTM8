/**
 * Student portal review (Decision 427): what the mobile app needs to show
 * bookings, memberships and waitlist places by name, not by id.
 * - SP4: GET /bookings/me carries the class's name and times and the School's name.
 * - SP5: GET /memberships/me carries the plan's and the School's names.
 * - SP3: GET /waitlist/me lists the caller's own live waitlist places, so the
 *   app can offer a freed spot to claim.
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

describeIfDb('Student portal review (Decision 427)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, { id: string; startDate: Date; endDate: Date }> = {};
  const entries: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const get = (who: string, path: string) => http().get(path).set('Authorization', `Bearer ${tokens[who]}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Review Dojo' } });
    for (const label of ['ana', 'ben']) {
      users[label] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `spr-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Review',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: users[label].id, schoolId: school.id } });
      tokens[label] = jwt.sign({
        sub: users[label].id,
        email: users[label].email,
        grants: [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }],
      });
    }
    const day = 86_400_000;
    for (const [key, title, inDays] of [['booked', 'Adult Fundamentals', 2], ['soon', 'Advanced No-Gi', 3], ['later', 'Open Mat', 5], ['past', 'Yesterday Class', -1]] as const) {
      const startDate = new Date(Date.now() + inDays * day);
      const endDate = new Date(startDate.getTime() + 3_600_000);
      classes[key] = await superuser.class.create({ data: { membershipInclusion: true, id: randomUUID(), schoolId: school.id, title, startDate, endDate } });
    }
    await superuser.booking.create({ data: { id: randomUUID(), studentId: users.ana.id, classId: classes.booked.id, schoolId: school.id, status: 'UPCOMING' } });
    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '10-Class Pack', price: 15000 } });
    await superuser.membership.create({
      data: { id: randomUUID(), studentId: users.ana.id, membershipPlanId: plan.id, schoolId: school.id, status: 'ACTIVE', frequency: 'ONE_TIME', classesRemaining: 7 },
    });
    const deadline = new Date(Date.now() + 3_600_000);
    const entry = (key: string, studentId: string, classId: string, data: Record<string, unknown>) =>
      superuser.waitlistEntry
        .create({ data: { id: randomUUID(), studentId, classId, schoolId: school.id, position: 1, ...data } })
        .then((e) => (entries[key] = e.id));
    await entry('anaLater', users.ana.id, classes.later.id, { position: 2 });
    await entry('anaSoon', users.ana.id, classes.soon.id, { status: 'NOTIFIED', notifiedAt: new Date(), claimByDeadline: deadline });
    await entry('anaPast', users.ana.id, classes.past.id, {});
    await entry('anaExpired', users.ana.id, classes.later.id, { status: 'EXPIRED', position: 3 });
    await entry('benSoon', users.ben.id, classes.soon.id, { position: 2 });
  });

  afterAll(async () => {
    await superuser.waitlistEntry.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('SP4: my bookings carry the class name, times and School name', async () => {
    const res = await get('ana', '/v1/bookings/me');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      classId: classes.booked.id,
      classTitle: 'Adult Fundamentals',
      classStartsAt: classes.booked.startDate.toISOString(),
      classEndsAt: classes.booked.endDate.toISOString(),
      schoolName: 'Review Dojo',
    });
  });

  it('SP5: my memberships carry the plan and School names', async () => {
    const res = await get('ana', '/v1/memberships/me');
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ planTitle: '10-Class Pack', schoolName: 'Review Dojo', visitPass: false });
  });

  it('SP3: my waitlist lists only my own live places for classes still to come, soonest first', async () => {
    const res = await get('ana', '/v1/waitlist/me');
    expect(res.status).toBe(200);
    expect(res.body.items.map((e: { id: string }) => e.id)).toEqual([entries.anaSoon, entries.anaLater]);
    expect(res.body.items[0]).toMatchObject({
      classTitle: 'Advanced No-Gi',
      schoolName: 'Review Dojo',
      status: 'NOTIFIED',
      claimByDeadline: expect.any(String),
    });
    expect(res.body.items[1]).toMatchObject({ classTitle: 'Open Mat', status: 'WAITING', position: 2, claimByDeadline: null });
  });

  it('SP3: another student sees only their own place', async () => {
    const res = await get('ben', '/v1/waitlist/me');
    expect(res.body.items.map((e: { id: string }) => e.id)).toEqual([entries.benSoon]);
  });

  it('SP3: needs a signed-in caller', async () => {
    const res = await http().get('/v1/waitlist/me');
    expect(res.status).toBe(401);
  });
});
