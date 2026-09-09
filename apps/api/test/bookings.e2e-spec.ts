/**
 * HTTP-level gate for Phase 11 (ClassesModule: booking + waitlist) — booking
 * creation gates (Active Membership + spend-order, Signed Waiver, rank-eligibility +
 * Staff override, capacity->Full), cancellation (refund vs withhold, credit
 * restoration), the one-active-Booking-per-Student-per-Class guard, the override
 * amendment endpoint, and the full waitlist join/withdraw/claim flow. Same ground
 * rule as every other e2e spec in this repo: prove over real HTTP, not just by
 * reading the code.
 *
 * Also includes direct-Prisma RLS tests (not HTTP) for this phase's own asymmetric
 * narrow-plus-broad Booking/WaitlistEntry policy (Decision 89/migration's own
 * comment) — no HTTP endpoint exposes another Student's raw Booking row, and the
 * broad Staff-read policy specifically needs proving against real Postgres, the same
 * reasoning every prior phase's own RLS test documents.
 *
 * A real BullMQ/Redis worker is NOT exercised here (booking-no-show-processing,
 * waitlist-cascade-processing) — the waitlist-claim test instead directly flips a
 * WaitlistEntry to NOTIFIED via the superuser client to simulate what the cascade
 * job would have done, matching this codebase's established "e2e proves the HTTP
 * surface and RLS, not the BullMQ worker infrastructure itself" boundary (no prior
 * phase's e2e spec spins up a real queue worker either).
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
    '[bookings.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('ClassesModule: booking + waitlist — HTTP-level gates, cancellation, and RLS', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let owner: { id: string; email: string };
  let studentA: { id: string; email: string };
  let studentB: { id: string; email: string };
  let branchStaff: { id: string; email: string };
  let outsider: { id: string; email: string };
  let tokenOwner: string;
  let tokenStudentA: string;
  let tokenStudentB: string;
  let tokenBranchStaff: string;
  let tokenOutsider: string;

  let subscriptionPlanId: string;
  let classPackPlanId: string;
  let waiver: { id: string };
  let discipline: { id: string };
  let rank: { id: string };
  let stripeTier: { id: string };

  let classBasic: { id: string };
  let classWaiverGated: { id: string };
  let classRankGated: { id: string };
  let classFull: { id: string };
  let classPastCutoff: { id: string };

  const bookingIds: string[] = [];
  const waitlistEntryIds: string[] = [];
  const membershipIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  async function withUser<T>(userId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return appDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
      return fn(tx as unknown as PrismaClient);
    });
  }

  async function mkActiveMembership(studentId: string, planId: string, classesRemaining: number | null) {
    const membership = await superuser.membership.create({
      data: {
        id: randomUUID(),
        studentId,
        membershipPlanId: planId,
        schoolId: school.id,
        status: 'ACTIVE',
        frequency: classesRemaining === null ? 'RECURRING' : 'ONE_TIME',
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

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Bookings HTTP School', waitlistClaimWindowMinutes: 120 } });

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `bookings-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    owner = await mkUser('owner');
    studentA = await mkUser('student-a');
    studentB = await mkUser('student-b');
    branchStaff = await mkUser('branch-staff');
    outsider = await mkUser('outsider');

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentA.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentB.id, schoolId: school.id },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: branchStaff.id, schoolId: school.id },
      ],
    });

    tokenOwner = signAccessToken(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentA = signAccessToken(studentA, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentB = signAccessToken(studentB, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenBranchStaff = signAccessToken(branchStaff, [{ role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenOutsider = signAccessToken(outsider, []);

    const subscriptionPlan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 },
    });
    subscriptionPlanId = subscriptionPlan.id;
    const classPackPlan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: '5-Class Pack', price: 3000, classesIncluded: 5 },
    });
    classPackPlanId = classPackPlan.id;

    waiver = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title: 'Liability', body: 'Risks acknowledged.' } });

    discipline = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Judo' } });
    rank = await superuser.rank.create({
      data: { id: randomUUID(), disciplineId: discipline.id, schoolId: school.id, order: 0, primaryColour: 'white' },
    });
    stripeTier = await superuser.rankStripeTier.create({
      data: { id: randomUUID(), rankId: rank.id, schoolId: school.id, order: 0, count: 1, colour: 'white', eligibleClassTypes: ['Judo'] },
    });

    const future = new Date(Date.now() + 24 * 3_600_000);
    const past = new Date(Date.now() - 24 * 3_600_000);

    classBasic = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Open Mat', startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
    });
    classWaiverGated = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Sparring', startDate: future, endDate: new Date(future.getTime() + 3_600_000), termsWaiverRequired: true },
    });
    classRankGated = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Judo Fundamentals', activities: ['Judo'], startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
    });
    classFull = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Small Group', capacity: 1, startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
    });
    classPastCutoff = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Already Cutoff', startDate: future, endDate: new Date(future.getTime() + 3_600_000), refundFeeDate: past },
    });
  });

  afterAll(async () => {
    // Phase 15 — creating a Waiver above for real enqueues waiver-signature-
    // requests, which (unlike its old log-only-stub self) now fans out a real
    // Notification row per Student at this School via a live worker consuming
    // real CI Redis, asynchronously, outside this test's own control. Found
    // when this exact cleanup step started failing on Notification's own
    // ON DELETE RESTRICT foreign key. Queried by the same email pattern the
    // final `user.deleteMany` below already trusts (not a hand-maintained
    // list of the two named Students) — this file also creates at least one
    // additional Student dynamically further down, which a hardcoded
    // [studentA.id, studentB.id] list would have missed.
    const createdUserIds = (
      await superuser.user.findMany({ where: { email: { contains: 'bookings-http-' } }, select: { id: true } })
    ).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
    await superuser.bookingAttendee.deleteMany({ where: { schoolId: school.id } });
    await superuser.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await superuser.waitlistEntry.deleteMany({ where: { id: { in: waitlistEntryIds } } });
    await superuser.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.waiverSignature.deleteMany({ where: { schoolId: school.id } });
    await superuser.waiver.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: school.id } });
    await superuser.rank.deleteMany({ where: { schoolId: school.id } });
    await superuser.discipline.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { email: { contains: 'bookings-http-' } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await appDb.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Creation gates
  // ---------------------------------------------------------------------------

  it('a Student with NO Active Membership cannot book — 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${classBasic.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('a Student with an Active general-access Membership CAN book — no credit spent', async () => {
    const membership = await mkActiveMembership(studentA.id, subscriptionPlanId, null);

    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${classBasic.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('UPCOMING');
    expect(res.body.sourceMembershipId).toBe(membership.id);
    bookingIds.push(res.body.id);

    const meRes = await request(app.getHttpServer()).get('/v1/bookings/me').set('Authorization', `Bearer ${tokenStudentA}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.items.some((b: { id: string }) => b.id === res.body.id)).toBe(true);
  });

  it('a duplicate active Booking for the same Student/Class is rejected — 409', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${classBasic.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(res.status).toBe(409);
  });

  it('spend order: a Class Pack credit is spent when it is the ONLY eligible Membership, and classesRemaining decrements', async () => {
    const classPack = await mkActiveMembership(studentB.id, classPackPlanId, 2);

    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${classBasic.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentB}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.sourceMembershipId).toBe(classPack.id);
    bookingIds.push(res.body.id);

    const after = await superuser.membership.findUniqueOrThrow({ where: { id: classPack.id } });
    expect(after.classesRemaining).toBe(1);
  });

  it('a waiver-required Class blocks an unsigned Student — 400 — and admits them once Signed', async () => {
    const blocked = await request(app.getHttpServer())
      .post(`/v1/classes/${classWaiverGated.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(blocked.status).toBe(400);

    const signRes = await request(app.getHttpServer())
      .post(`/v1/waivers/${waiver.id}/sign`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ signerFullName: 'Student A', signatureText: 'Student A' });
    expect(signRes.status).toBe(201);

    const allowed = await request(app.getHttpServer())
      .post(`/v1/classes/${classWaiverGated.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(allowed.status).toBe(201);
    bookingIds.push(allowed.body.id);
  });

  it('a rank-gated Class blocks a Student with no matching StudentRank — 403 — and a Staff override bypasses it', async () => {
    const blocked = await request(app.getHttpServer())
      .post(`/v1/classes/${classRankGated.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentB}`)
      .send({});
    expect(blocked.status).toBe(403);

    // Staff self-override is rejected — a Student may never self-override.
    const selfOverride = await request(app.getHttpServer())
      .post(`/v1/classes/${classRankGated.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentB}`)
      .send({ overrideReason: 'Trying to self-override' });
    expect(selfOverride.status).toBe(403);

    const staffOverride = await request(app.getHttpServer())
      .post(`/v1/classes/${classRankGated.id}/book`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ studentId: studentB.id, overrideReason: 'Trial class, cleared verbally by coach' });
    expect(staffOverride.status).toBe(201);
    expect(staffOverride.body.overriddenById).toBe(owner.id);
    expect(staffOverride.body.overrideReason).toBe('Trial class, cleared verbally by coach');
    bookingIds.push(staffOverride.body.id);
  });

  it('a Student WITH a matching StudentRank whose stripe tier covers the activity CAN book without an override', async () => {
    await superuser.studentRank.create({
      data: {
        id: randomUUID(),
        studentId: studentA.id,
        disciplineId: discipline.id,
        schoolId: school.id,
        currentRankId: rank.id,
        currentStripeId: stripeTier.id,
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${classRankGated.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.overriddenById).toBeNull();
    bookingIds.push(res.body.id);
  });

  it('PATCH /bookings/{id}/override lets Staff amend an existing override\'s justification, but not a non-overridden Booking', async () => {
    // studentB's own Class Pack from the earlier "spend order"/rank-gated-override
    // tests is already fully exhausted (0 remaining) — fund this attempt with a
    // fresh one so it actually reaches the one-active-Booking guard (via the
    // create()-time P2002 check) rather than failing earlier on insufficient funds.
    await mkActiveMembership(studentB.id, classPackPlanId, 1);

    // studentB already holds an UPCOMING, Staff-overridden Booking on
    // classRankGated from the previous test — a second create attempt for the same
    // Student/Class correctly hits the one-active-Booking guard (409) regardless of
    // the override fields, proving the amend path (not a second create) is the only
    // way to touch that override's justification text.
    const secondCreateAttempt = await request(app.getHttpServer())
      .post(`/v1/classes/${classRankGated.id}/book`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ studentId: studentB.id, overrideReason: 'initial reason' });
    expect(secondCreateAttempt.status).toBe(409);

    const overriddenBookings = await withUser(owner.id, (tx) => tx.booking.findMany({ where: { classId: classRankGated.id, overriddenById: owner.id } }));
    expect(overriddenBookings.length).toBeGreaterThan(0);
    const targetId = overriddenBookings[0].id;

    const amendRes = await request(app.getHttpServer())
      .patch(`/v1/bookings/${targetId}/override`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ overrideReason: 'Amended: cleared in writing after all' });
    expect(amendRes.status).toBe(200);
    expect(amendRes.body.overrideReason).toBe('Amended: cleared in writing after all');

    const nonOverriddenId = bookingIds[0];
    const rejectAmend = await request(app.getHttpServer())
      .patch(`/v1/bookings/${nonOverriddenId}/override`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ overrideReason: 'Should be rejected' });
    expect(rejectAmend.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Capacity -> Full -> Waitlist
  // ---------------------------------------------------------------------------

  it('CONCURRENCY: two simultaneous bookClass calls for a capacity=1 Class never both succeed (the FOR UPDATE lock fix)', async () => {
    const classConcurrency = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Concurrency Check', capacity: 1, startDate: new Date(Date.now() + 24 * 3_600_000), endDate: new Date(Date.now() + 25 * 3_600_000) },
    });
    const mkRacer = async (label: string) => {
      const user = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `bookings-http-race-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
          firstName: label,
          surname: 'Racer',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId: school.id } });
      await mkActiveMembership(user.id, subscriptionPlanId, null);
      const token = signAccessToken(user, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
      return { user, token };
    };

    const racer1 = await mkRacer('one');
    const racer2 = await mkRacer('two');

    const [res1, res2] = await Promise.all([
      request(app.getHttpServer()).post(`/v1/classes/${classConcurrency.id}/book`).set('Authorization', `Bearer ${racer1.token}`).send({}),
      request(app.getHttpServer()).post(`/v1/classes/${classConcurrency.id}/book`).set('Authorization', `Bearer ${racer2.token}`).send({}),
    ]);
    const statuses = [res1.status, res2.status].sort();
    // Exactly one succeeds (201); the other is rejected as Full (409) — never both
    // 201, which is exactly what the pre-fix race allowed.
    expect(statuses).toEqual([201, 409]);
    const winner = res1.status === 201 ? res1 : res2;
    bookingIds.push(winner.body.id);

    const finalCount = await superuser.booking.count({ where: { classId: classConcurrency.id, status: 'UPCOMING' } });
    expect(finalCount).toBe(1);
  });

  it('a full Class rejects a new Booking (409) and directs the caller to the waitlist; joining the waitlist then succeeds', async () => {
    // studentA already holds an Active general-access Membership from the earlier
    // "CAN book — no credit spent" test (general-access is never consumed, so it's
    // still valid here) — creating a second one would violate the one-active-
    // general-access-per-School guard, so this reuses the existing one rather than
    // minting another.
    const firstRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classFull.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(firstRes.status).toBe(201);
    bookingIds.push(firstRes.body.id);

    const secondRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classFull.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentB}`)
      .send({});
    expect(secondRes.status).toBe(409);

    const waitlistRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classFull.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenStudentB}`);
    expect(waitlistRes.status).toBe(201);
    expect(waitlistRes.body.status).toBe('WAITING');
    expect(waitlistRes.body.position).toBe(1);
    waitlistEntryIds.push(waitlistRes.body.id);

    const duplicateJoin = await request(app.getHttpServer())
      .post(`/v1/classes/${classFull.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenStudentB}`);
    expect(duplicateJoin.status).toBe(409);
  });

  it('withdrawing frees the Student to rejoin the same Class\'s waitlist', async () => {
    const entryId = waitlistEntryIds[0];
    const withdrawRes = await request(app.getHttpServer()).delete(`/v1/waitlist/${entryId}`).set('Authorization', `Bearer ${tokenStudentB}`);
    expect(withdrawRes.status).toBe(204);

    const rejoinRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classFull.id}/waitlist`)
      .set('Authorization', `Bearer ${tokenStudentB}`);
    expect(rejoinRes.status).toBe(201);
    waitlistEntryIds.push(rejoinRes.body.id);
  });

  it('claiming a Notified entry creates a real Booking and spends a credit; claiming a non-Notified entry is rejected', async () => {
    // studentB's own Class Pack from the earlier "spend order"/rank-gated-override
    // tests is already fully exhausted (0 remaining) by this point in the suite —
    // fund this claim with a FRESH Class Pack, not a general-access Membership: a
    // general-access one would also get picked (and never touched) by the LATER
    // "cancelling BEFORE cutoff" test's own spend-order preference, silently
    // breaking that test's own classesRemaining assertions.
    await mkActiveMembership(studentB.id, classPackPlanId, 1);

    const entryId = waitlistEntryIds[waitlistEntryIds.length - 1];

    const tooEarly = await request(app.getHttpServer()).post(`/v1/waitlist/${entryId}/claim`).set('Authorization', `Bearer ${tokenStudentB}`);
    expect(tooEarly.status).toBe(400);

    // Simulate what waitlist-cascade-processing would have done on a freed seat —
    // no real BullMQ worker runs in this suite (see the file's own header comment).
    await superuser.waitlistEntry.update({
      where: { id: entryId },
      data: { status: 'NOTIFIED', notifiedAt: new Date(), claimByDeadline: new Date(Date.now() + 3_600_000) },
    });

    // Free up the one seat classFull had — cancel Student A's Booking there first.
    const studentABookingOnFull = await withUser(studentA.id, (tx) => tx.booking.findFirst({ where: { classId: classFull.id, studentId: studentA.id } }));
    await request(app.getHttpServer()).patch(`/v1/bookings/${studentABookingOnFull!.id}/cancel`).set('Authorization', `Bearer ${tokenStudentA}`);

    const claimRes = await request(app.getHttpServer()).post(`/v1/waitlist/${entryId}/claim`).set('Authorization', `Bearer ${tokenStudentB}`);
    expect(claimRes.status).toBe(201);
    expect(claimRes.body.studentId).toBe(studentB.id);
    bookingIds.push(claimRes.body.id);

    const claimedEntry = await superuser.waitlistEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(claimedEntry.status).toBe('CLAIMED');
    expect(claimedEntry.claimedBookingId).toBe(claimRes.body.id);
  });

  // ---------------------------------------------------------------------------
  // Cancellation — refund vs withhold
  // ---------------------------------------------------------------------------

  it('cancelling BEFORE the refund cutoff restores the spent credit (REFUNDED)', async () => {
    // studentB has accumulated several Class Pack Memberships from earlier tests in
    // this suite, some still holding a positive balance — since spend-order only
    // guarantees "prefer general-access first," among MULTIPLE simultaneously-active
    // Class Packs the selection order is otherwise unspecified. Expiring all of
    // studentB's prior ones first makes the fresh Membership created below the only
    // eligible candidate, so this test's own classesRemaining assertions are
    // deterministic rather than depending on exactly which earlier test left which
    // balance behind.
    await superuser.membership.updateMany({ where: { studentId: studentB.id, classesRemaining: { not: null } }, data: { status: 'EXPIRED' } });

    const membership = await mkActiveMembership(studentB.id, classPackPlanId, 3);
    const bookRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classWaiverGated.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentB}`)
      .send({});
    // studentB has no Signed waiver yet for this School's Waiver in this test's own
    // isolated flow — sign first.
    if (bookRes.status === 400) {
      await request(app.getHttpServer())
        .post(`/v1/waivers/${waiver.id}/sign`)
        .set('Authorization', `Bearer ${tokenStudentB}`)
        .send({ signerFullName: 'Student B', signatureText: 'Student B' });
    }
    const res = bookRes.status === 400
      ? await request(app.getHttpServer()).post(`/v1/classes/${classWaiverGated.id}/book`).set('Authorization', `Bearer ${tokenStudentB}`).send({})
      : bookRes;
    expect(res.status).toBe(201);
    bookingIds.push(res.body.id);

    const afterBook = await superuser.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(afterBook.classesRemaining).toBe(2);

    const cancelRes = await request(app.getHttpServer()).patch(`/v1/bookings/${res.body.id}/cancel`).set('Authorization', `Bearer ${tokenStudentB}`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.status).toBe('CANCELLED');
    expect(cancelRes.body.refundResolution).toBe('REFUNDED');

    const afterCancel = await superuser.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(afterCancel.classesRemaining).toBe(3);

    const doubleCancel = await request(app.getHttpServer()).patch(`/v1/bookings/${res.body.id}/cancel`).set('Authorization', `Bearer ${tokenStudentB}`);
    expect(doubleCancel.status).toBe(409);
  });

  it('cancelling AFTER the refund cutoff withholds the credit (WITHHELD)', async () => {
    // studentA's own general-access Membership (from the very first booking test)
    // is still Active and would otherwise always be preferred over a fresh Class
    // Pack per the spend-order rule (general-access first) — meaning the Class Pack
    // created below would never actually be selected/decremented, and this test
    // would silently stop testing credit-withholding at all. Expiring it here is
    // safe: nothing later in this suite depends on studentA still holding it.
    await superuser.membership.updateMany({ where: { studentId: studentA.id, classesRemaining: null }, data: { status: 'EXPIRED' } });

    const membership = await mkActiveMembership(studentA.id, classPackPlanId, 3);
    const bookRes = await request(app.getHttpServer())
      .post(`/v1/classes/${classPastCutoff.id}/book`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({});
    expect(bookRes.status).toBe(201);
    bookingIds.push(bookRes.body.id);

    const cancelRes = await request(app.getHttpServer()).patch(`/v1/bookings/${bookRes.body.id}/cancel`).set('Authorization', `Bearer ${tokenStudentA}`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.refundResolution).toBe('WITHHELD');

    const after = await superuser.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(after.classesRemaining).toBe(2); // still decremented, never restored
  });

  // ---------------------------------------------------------------------------
  // RLS — Booking/WaitlistEntry's asymmetric narrow-plus-broad shape (Decision 89)
  // ---------------------------------------------------------------------------

  it('RLS: Student B cannot read Student A\'s Booking rows directly, even sharing a School', async () => {
    const asStudentB = await withUser(studentB.id, (tx) => tx.booking.findMany({ where: { studentId: studentA.id } }));
    expect(asStudentB).toHaveLength(0);

    const asOwner = await withUser(owner.id, (tx) => tx.booking.findMany({ where: { studentId: studentA.id } }));
    expect(asOwner.length).toBeGreaterThan(0);
  });

  it('RLS: Branch Staff CAN read every Student\'s Booking rows at the School (the new broad Staff-read policy) but cannot write one directly', async () => {
    const asBranchStaffRead = await withUser(branchStaff.id, (tx) => tx.booking.findMany({ where: { schoolId: school.id } }));
    expect(asBranchStaffRead.length).toBeGreaterThan(0);

    const someBookingId = asBranchStaffRead[0].id;
    await expect(
      withUser(branchStaff.id, (tx) => tx.booking.update({ where: { id: someBookingId }, data: { overrideReason: 'direct write attempt' } })),
    ).rejects.toThrow();
  });

  it('RLS: an outsider with no RoleGrant at this School sees nothing', async () => {
    const asOutsider = await withUser(outsider.id, (tx) => tx.booking.findMany({ where: { schoolId: school.id } }));
    expect(asOutsider).toHaveLength(0);
  });
});
