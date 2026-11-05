/**
 * Decision 427 (Student portal review SP6): the app shows a class's times on
 * the class's own clock — its Branch's time zone, else the School's — not the
 * phone's. Every read the app's class rows use now carries that zone:
 * - GET /academies/:id (discovery role): `timezone` on each upcoming class;
 * - GET /bookings/me, GET /waitlist/me, GET /guardians/me/minors/:id/bookings:
 *   `classTimezone`.
 * The discovery role was given exactly three columns for it (School.timezone,
 * Branch.timezone, Class.branchId) and nothing more.
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
const DATABASE_URL_DISCOVERY = process.env.DATABASE_URL_DISCOVERY;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_DISCOVERY && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb("Class times on the class's own clock (Decision 427, SP6)", () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const discovery = new PrismaClient({ datasourceUrl: DATABASE_URL_DISCOVERY });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let plainSchool: { id: string };
  let branch: { id: string };
  let plainBranch: { id: string };
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, { id: string }> = {};
  const http = () => request(app.getHttpServer());
  const get = (who: string, path: string) => http().get(path).set('Authorization', `Bearer ${tokens[who]}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Zone Dojo', timezone: 'America/New_York' } });
    plainSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Zoneless Dojo' } });
    branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Shibuya', timezone: 'Asia/Tokyo', address: '1 Secret St' } });
    plainBranch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Annex' } });
    for (const label of ['ana', 'parent', 'kid']) {
      users[label] = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `ctz-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Zone',
          passcodeHash: 'x',
          dateOfBirth: new Date(label === 'kid' ? '2016-01-01' : '2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
    }
    for (const who of ['ana', 'kid']) {
      for (const schoolId of [school.id, plainSchool.id]) {
        await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: users[who].id, schoolId } });
      }
    }
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: users.parent.id, studentId: users.kid.id } });
    for (const who of Object.keys(users)) {
      tokens[who] = jwt.sign({
        sub: users[who].id,
        email: users[who].email,
        grants: who === 'parent' ? [] : [school.id, plainSchool.id].map((schoolId) => ({ role: 'STUDENT', franchiseId: null, schoolId, branchId: null })),
      });
    }
    const day = 86_400_000;
    const make = async (key: string, schoolId: string, branchId: string | null, inDays: number) => {
      const startDate = new Date(Date.now() + inDays * day);
      classes[key] = await superuser.class.create({
        data: { membershipInclusion: true, id: randomUUID(), schoolId, branchId, title: key, startDate, endDate: new Date(startDate.getTime() + 3_600_000) },
      });
    };
    await make('tokyo', school.id, branch.id, 2);
    await make('annex', school.id, plainBranch.id, 3);
    await make('wholeSchool', school.id, null, 4);
    await make('noZone', plainSchool.id, null, 5);
    for (const who of ['ana', 'kid']) {
      for (const key of ['tokyo', 'annex', 'wholeSchool']) {
        await superuser.booking.create({ data: { id: randomUUID(), studentId: users[who].id, classId: classes[key].id, schoolId: school.id, branchId: null, status: 'UPCOMING' } });
      }
      await superuser.booking.create({ data: { id: randomUUID(), studentId: users[who].id, classId: classes.noZone.id, schoolId: plainSchool.id, status: 'UPCOMING' } });
    }
    await superuser.waitlistEntry.create({ data: { id: randomUUID(), studentId: users.ana.id, classId: classes.tokyo.id, schoolId: school.id, position: 1 } });
  });

  afterAll(async () => {
    const schoolIds = [school.id, plainSchool.id];
    await superuser.waitlistEntry.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.booking.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.class.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: users.parent.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await discovery.$disconnect();
    await app.close();
  });

  const expected = () => ({
    [classes.tokyo.id]: 'Asia/Tokyo',
    [classes.annex.id]: 'America/New_York',
    [classes.wholeSchool.id]: 'America/New_York',
    [classes.noZone.id]: null,
  });

  it("a School's page gives each upcoming class its Branch's zone, else the School's", async () => {
    const res = await get('ana', `/v1/academies/${school.id}`);
    expect(res.status).toBe(200);
    const zones = Object.fromEntries(res.body.upcomingClasses.map((c: { id: string; timezone: string | null }) => [c.id, c.timezone]));
    expect(zones).toEqual({ [classes.tokyo.id]: 'Asia/Tokyo', [classes.annex.id]: 'America/New_York', [classes.wholeSchool.id]: 'America/New_York' });
    // Only the zone is added: no Branch id on a class, no zone on the Branch list.
    expect(res.body.upcomingClasses[0]).not.toHaveProperty('branchId');
    expect(res.body.branches).toEqual(expect.arrayContaining([{ id: branch.id, name: 'Shibuya' }]));
    expect(res.body).not.toHaveProperty('timezone');

    const plain = await get('ana', `/v1/academies/${plainSchool.id}`);
    expect(plain.body.upcomingClasses).toEqual([expect.objectContaining({ id: classes.noZone.id, timezone: null })]);
  });

  it('my bookings and my waitlist carry each class zone', async () => {
    const bookings = await get('ana', '/v1/bookings/me');
    expect(bookings.status).toBe(200);
    expect(Object.fromEntries(bookings.body.items.map((b: { classId: string; classTimezone: string | null }) => [b.classId, b.classTimezone]))).toEqual(expected());
    const waitlist = await get('ana', '/v1/waitlist/me');
    expect(waitlist.body.items).toEqual([expect.objectContaining({ classId: classes.tokyo.id, classTimezone: 'Asia/Tokyo' })]);
  });

  it("a parent's list of their child's bookings carries each class zone", async () => {
    const res = await get('parent', `/v1/guardians/me/minors/${users.kid.id}/bookings`);
    expect(res.status).toBe(200);
    expect(Object.fromEntries(res.body.items.map((b: { classId: string; classTimezone: string | null }) => [b.classId, b.classTimezone]))).toEqual(expected());
  });

  it('the discovery role reads only the three new columns, nothing else on those tables', async () => {
    const ok = await discovery.$queryRaw<Array<{ timezone: string | null }>>`SELECT "timezone" FROM "Branch" WHERE id = ${branch.id}`;
    expect(ok).toEqual([{ timezone: 'Asia/Tokyo' }]);
    await expect(discovery.$queryRaw`SELECT "branchId" FROM "Class" WHERE id = ${classes.tokyo.id}`).resolves.toEqual([{ branchId: branch.id }]);
    await expect(discovery.$queryRaw`SELECT "timezone" FROM "School" WHERE id = ${school.id}`).resolves.toEqual([{ timezone: 'America/New_York' }]);
    await expect(discovery.$queryRaw`SELECT "address" FROM "Branch" WHERE id = ${branch.id}`).rejects.toThrow(/permission denied/);
    await expect(discovery.$queryRaw`SELECT "instructorId" FROM "Class" WHERE id = ${classes.tokyo.id}`).rejects.toThrow(/permission denied/);
    await expect(discovery.$queryRaw`SELECT "createdAt" FROM "School" WHERE id = ${school.id}`).rejects.toThrow(/permission denied/);
  });
});
