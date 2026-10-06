/**
 * HTTP-level gate for Decision 123 (Guardian "Kid Mode" booking delegation) —
 * grant/withdraw/list, the kid-mode-token mint, the live BookingDelegation
 * re-check inside BookingsController (never trust the JWT claim alone), the
 * JwtStrategy route/body restriction on a Kid-Mode token (only
 * POST /classes/:id/book, only for the one studentId it was minted for, never
 * with overrideReason), the pendingGuardianReview flagging on withdrawal, and
 * the review-queue list/confirm. Same ground rule as every other e2e spec in
 * this repo: prove over real HTTP, not just by reading the code.
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
    '[booking-delegation.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('Decision 123 — Guardian Kid Mode booking delegation: HTTP-level gates and RLS', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let guardianA: { id: string; email: string };
  let guardianB: { id: string; email: string };
  let minor: { id: string; email: string };
  let tokenGuardianA: string;
  let tokenGuardianB: string;

  let classPackPlanId: string;
  let cls: { id: string };

  const membershipIds: string[] = [];
  const bookingIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>> = []) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  async function mkActiveMembership(studentId: string, classesRemaining: number) {
    const membership = await superuser.membership.create({
      data: {
        id: randomUUID(),
        studentId,
        membershipPlanId: classPackPlanId,
        schoolId: school.id,
        status: 'ACTIVE',
        frequency: 'ONE_TIME',
        classesRemaining,
      },
    });
    membershipIds.push(membership.id);
    return membership;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Kid Mode HTTP School' } });

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `kid-mode-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2012-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    guardianA = await mkUser('guardian-a');
    guardianB = await mkUser('guardian-b');
    minor = await mkUser('minor');

    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: minor.id, schoolId: school.id } });
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: guardianA.id, studentId: minor.id } });

    tokenGuardianA = signAccessToken(guardianA, [{ role: 'GUARDIAN', franchiseId: null, schoolId: null, branchId: null }]);
    tokenGuardianB = signAccessToken(guardianB, [{ role: 'GUARDIAN', franchiseId: null, schoolId: null, branchId: null }]);

    const classPackPlan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '5-Class Pack', price: 3000, classesIncluded: 5 },
    });
    classPackPlanId = classPackPlan.id;

    const future = new Date(Date.now() + 24 * 3_600_000);
    cls = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Kid Mode Fixture Class', startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
    });
  });

  afterAll(async () => {
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await superuser.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.bookingDelegation.deleteMany({ where: { guardianId: { in: [guardianA.id, guardianB.id] } } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: { in: [guardianA.id, guardianB.id] } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { email: { contains: 'kid-mode-http-' } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('a Guardian with no active delegation cannot mint a Kid-Mode token — 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/guardians/me/minors/${minor.id}/kid-mode-token`)
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('a Guardian with NO active GuardianLink cannot grant delegation for the minor — 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/guardians/me/minors/${minor.id}/booking-delegation`)
      .set('Authorization', `Bearer ${tokenGuardianB}`)
      .send({});
    expect(res.status).toBe(400);
  });

  let delegationId: string;

  it('the linked Guardian CAN grant booking delegation for their minor', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/guardians/me/minors/${minor.id}/booking-delegation`)
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACTIVE');
    delegationId = res.body.id;

    const listRes = await request(app.getHttpServer())
      .get('/v1/guardians/me/booking-delegation')
      .set('Authorization', `Bearer ${tokenGuardianA}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items.some((d: { id: string }) => d.id === delegationId)).toBe(true);
  });

  let kidModeToken: string;

  it('mints a Kid-Mode token once delegation is ACTIVE', async () => {
    await mkActiveMembership(minor.id, 5);

    const res = await request(app.getHttpServer())
      .post(`/v1/guardians/me/minors/${minor.id}/kid-mode-token`)
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    kidModeToken = res.body.accessToken;

    const decoded = jwt.decode(kidModeToken) as { sub: string; kidMode?: { studentId: string } };
    expect(decoded.sub).toBe(guardianA.id); // never a separate minor identity
    expect(decoded.kidMode?.studentId).toBe(minor.id);
  });

  it('a Kid-Mode token is rejected on every endpoint except POST /classes/:id/book — 403', async () => {
    const res = await request(app.getHttpServer()).get('/v1/bookings/me').set('Authorization', `Bearer ${kidModeToken}`);
    expect(res.status).toBe(403);
  });

  it('a Kid-Mode token is rejected if the request names a different studentId than it was minted for — 403', async () => {
    const outsider = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `kid-mode-http-outsider-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'outsider',
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2012-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${cls.id}/book`)
      .set('Authorization', `Bearer ${kidModeToken}`)
      .send({ studentId: outsider.id });
    expect(res.status).toBe(403);
    await superuser.user.delete({ where: { id: outsider.id } });
  });

  it('a Kid-Mode token is rejected if the request supplies overrideReason — 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${cls.id}/book`)
      .set('Authorization', `Bearer ${kidModeToken}`)
      .send({ studentId: minor.id, overrideReason: 'trying to sneak an override in' });
    expect(res.status).toBe(403);
  });

  let kidModeBookingId: string;

  it('a Kid-Mode token CAN book the one linked minor it was minted for — the Booking is bookedViaKidMode', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${cls.id}/book`)
      .set('Authorization', `Bearer ${kidModeToken}`)
      .send({ studentId: minor.id });
    expect(res.status).toBe(201);
    expect(res.body.studentId).toBe(minor.id);
    kidModeBookingId = res.body.id;
    bookingIds.push(kidModeBookingId);

    const row = await superuser.booking.findUniqueOrThrow({ where: { id: kidModeBookingId } });
    expect(row.bookedViaKidMode).toBe(true);
    expect(row.pendingGuardianReview).toBe(false);
  });

  it('revoking delegation AFTER a token is minted blocks a further booking attempt — the live re-check, not just the claim', async () => {
    // Cancel the first booking so a fresh one is possible under the same
    // Membership credit, then withdraw delegation and try again with the
    // SAME still-unexpired kidModeToken.
    await request(app.getHttpServer())
      .patch(`/v1/bookings/${kidModeBookingId}/cancel`)
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({ studentId: minor.id });

    const withdrawRes = await request(app.getHttpServer())
      .patch(`/v1/guardians/me/booking-delegation/${delegationId}/withdraw`)
      .set('Authorization', `Bearer ${tokenGuardianA}`);
    expect(withdrawRes.status).toBe(200);
    expect(withdrawRes.body.status).toBe('WITHDRAWN');

    const bookRes = await request(app.getHttpServer())
      .post(`/v1/classes/${cls.id}/book`)
      .set('Authorization', `Bearer ${kidModeToken}`)
      .send({ studentId: minor.id });
    expect(bookRes.status).toBe(403);
  });

  let secondBookingId: string;

  it('withdrawing delegation flags the (re-granted + re-booked) Kid-Mode Booking as pendingGuardianReview, surfaced in the review queue', async () => {
    // Re-grant, mint a fresh token, book again, then withdraw a second time —
    // this time proving the flagging side effect on an UPCOMING Kid-Mode Booking.
    await request(app.getHttpServer())
      .post(`/v1/guardians/me/minors/${minor.id}/booking-delegation`)
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({});
    const mintRes = await request(app.getHttpServer())
      .post(`/v1/guardians/me/minors/${minor.id}/kid-mode-token`)
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({});
    const freshToken = mintRes.body.accessToken;

    const bookRes = await request(app.getHttpServer())
      .post(`/v1/classes/${cls.id}/book`)
      .set('Authorization', `Bearer ${freshToken}`)
      .send({ studentId: minor.id });
    expect(bookRes.status).toBe(201);
    secondBookingId = bookRes.body.id;
    bookingIds.push(secondBookingId);

    const listDelegations = await request(app.getHttpServer())
      .get('/v1/guardians/me/booking-delegation')
      .set('Authorization', `Bearer ${tokenGuardianA}`);
    const activeDelegationId = listDelegations.body.items.find((d: { status: string }) => d.status === 'ACTIVE').id;

    const withdrawRes = await request(app.getHttpServer())
      .patch(`/v1/guardians/me/booking-delegation/${activeDelegationId}/withdraw`)
      .set('Authorization', `Bearer ${tokenGuardianA}`);
    expect(withdrawRes.status).toBe(200);

    const row = await superuser.booking.findUniqueOrThrow({ where: { id: secondBookingId } });
    expect(row.pendingGuardianReview).toBe(true);

    const reviewRes = await request(app.getHttpServer())
      .get('/v1/guardians/me/bookings-pending-review')
      .set('Authorization', `Bearer ${tokenGuardianA}`);
    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.items.some((b: { id: string }) => b.id === secondBookingId)).toBe(true);

    const confirmRes = await request(app.getHttpServer())
      .patch(`/v1/guardians/me/bookings-pending-review/${secondBookingId}/confirm`)
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({ studentId: minor.id });
    expect(confirmRes.status).toBe(200);

    const rowAfterConfirm = await superuser.booking.findUniqueOrThrow({ where: { id: secondBookingId } });
    expect(rowAfterConfirm.pendingGuardianReview).toBe(false);
  });

  it('a Guardian booking directly (not via Kid Mode) is NOT flagged bookedViaKidMode', async () => {
    // The minor still holds the confirmed-but-not-cancelled Booking from the
    // previous test on this same Class — cancel it first so the one-active-
    // Booking-per-Student-per-Class guard doesn't 409 this fresh booking.
    await request(app.getHttpServer())
      .patch(`/v1/bookings/${secondBookingId}/cancel`)
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({ studentId: minor.id });

    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${cls.id}/book`)
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({ studentId: minor.id });
    expect(res.status).toBe(201);
    bookingIds.push(res.body.id);
    const row = await superuser.booking.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.bookedViaKidMode).toBe(false);
  });

  it('RLS: a second Guardian cannot see or withdraw the first Guardian\'s BookingDelegation', async () => {
    const regrant = await request(app.getHttpServer())
      .post(`/v1/guardians/me/minors/${minor.id}/booking-delegation`)
      .set('Authorization', `Bearer ${tokenGuardianA}`)
      .send({});
    const ownDelegationId = regrant.body.id;

    const listAsB = await request(app.getHttpServer())
      .get('/v1/guardians/me/booking-delegation')
      .set('Authorization', `Bearer ${tokenGuardianB}`);
    expect(listAsB.body.items.some((d: { id: string }) => d.id === ownDelegationId)).toBe(false);

    const withdrawAsB = await request(app.getHttpServer())
      .patch(`/v1/guardians/me/booking-delegation/${ownDelegationId}/withdraw`)
      .set('Authorization', `Bearer ${tokenGuardianB}`);
    expect(withdrawAsB.status).toBe(404);
  });
});
