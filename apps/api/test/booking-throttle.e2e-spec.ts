/**
 * HTTP-level gate for the Decision 17 fix — the per-user/per-IP throttling already
 * used on auth endpoints, extended to class-booking, waitlist-claim, and
 * credit-restore (apps/api/src/common/throttle/identity-trackers.ts, consumed by
 * BookingsController's BOOKING_ACTION_THROTTLE and WaitlistController's
 * WAITLIST_CLAIM_THROTTLE). Before this fix these three routes had NO throttle at
 * all (confirmed by grep — zero `@Throttle` usage anywhere under src/bookings/),
 * a volumetric-abuse gap Round 1's stress test report flagged.
 *
 * Deliberately minimal fixtures — the throttle guard runs before BookingsService's
 * own business-rule checks (membership/waiver/capacity), so these tests only need a
 * Class id and an authenticated Student token to reach it; whether the underlying
 * booking itself would succeed is irrelevant to proving the 429 fires at the right
 * request count.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET.
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
  console.warn(
    '[booking-throttle.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('BookingsController/WaitlistController — per-user throttle (Decision 17)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let classes: Array<{ id: string }> = [];
  const userIds: string[] = [];

  const mkStudent = async (label: string) => {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `booking-throttle-http-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Student',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId: school.id } });
    return jwt.sign({
      sub: user.id,
      email: user.email,
      grants: [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }],
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Booking Throttle School' } });

    const future = new Date(Date.now() + 24 * 3_600_000);
    classes = await Promise.all(
      Array.from({ length: 22 }, (_, i) =>
        superuser.class.create({
          data: {
            id: randomUUID(),
            schoolId: school.id,
            title: `Throttle Probe ${i}`,
            startDate: new Date(future.getTime() + i * 60_000),
            endDate: new Date(future.getTime() + i * 60_000 + 3_600_000),
          },
        }),
      ),
    );
  });

  afterAll(async () => {
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('POST /classes/:id/book — the 21st rapid attempt by the SAME user is throttled (limit 20/60s)', async () => {
    const token = await mkStudent('book');
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      // A different Class each time — proves the throttle is keyed by the caller's
      // identity, not by the specific Class/route param, matching how a real
      // volumetric-booking abuser would vary targets to dodge a narrower key.
      const res = await request(app.getHttpServer())
        .post(`/v1/classes/${classes[i].id}/book`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20)).not.toContain(429);
    expect(statuses[20]).toBe(429);
  });

  it('POST /waitlist/:id/claim — the 21st rapid attempt by the SAME user is throttled (limit 20/60s)', async () => {
    const token = await mkStudent('claim');
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await request(app.getHttpServer())
        .post(`/v1/waitlist/${randomUUID()}/claim`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20)).not.toContain(429);
    expect(statuses[20]).toBe(429);
  });
});
