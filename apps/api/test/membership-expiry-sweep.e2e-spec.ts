/**
 * Proves the membership-expiry-sweep job actually closes the gap Decision 122's
 * own "What this does NOT resolve" note flagged by name: a Membership whose
 * EXPIRED-by-date is live-computed-only (Decision 26) never had its Student's
 * still-UPCOMING Bookings cancelled the way the Stripe-driven force-Expiry
 * paths already are. Triggers the processor directly (calling .process()
 * against a fake Job) against a real Postgres, with WAITLIST_CASCADE_PROCESSING_QUEUE
 * faked and controllable — same approach stripe-webhook-processing.e2e-spec.ts
 * and waitlist-cascade-processing.e2e-spec.ts already established.
 *
 * FOUND ON REVIEW, before merge: an earlier draft of this job persisted
 * Membership.status = EXPIRED, directly contradicting Decision 26's confirmed
 * "live-computed predicate... not a scheduled batch flip" rule, and silently
 * changing what franchise-fee-usage-reporting bills Franchises for monthly.
 * Every assertion below now explicitly proves `status` stays 'ACTIVE' — this
 * job touches only its own private `bookingCancellationSweptAt` bookkeeping
 * column and the funded Booking rows, never the live-computed status itself.
 *
 * Requires DATABASE_URL and DATABASE_URL_JOBS. Skips with a warning if either is unset.
 */
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { MembershipExpirySweepProcessor } from '../src/jobs/membership-expiry-sweep.processor';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';
import { WAITLIST_CASCADE_PROCESSING_QUEUE } from '../src/jobs/queue.constants';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_JOBS);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[membership-expiry-sweep.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_JOBS not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('membership-expiry-sweep job — closes the date-based Membership-expiry gap (Decision 122 follow-up), without violating Decision 26', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  let processor: MembershipExpirySweepProcessor;
  const fakeWaitlistCascadeQueue = { add: jest.fn().mockResolvedValue(undefined) };

  let school: { id: string };
  let plan: { id: string };
  const studentIds: string[] = [];
  const classIds: string[] = [];
  const bookingIds: string[] = [];
  const membershipIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MembershipExpirySweepProcessor,
        PrismaJobsService,
        { provide: getQueueToken(WAITLIST_CASCADE_PROCESSING_QUEUE), useValue: fakeWaitlistCascadeQueue },
      ],
    }).compile();
    processor = moduleRef.get(MembershipExpirySweepProcessor);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Membership Sweep Fixture School' } });
    plan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: school.id, type: 'CLASS_PACK', title: 'Fixture Class Pack', price: 5000 },
    });
  });

  afterEach(() => {
    fakeWaitlistCascadeQueue.add.mockClear();
  });

  afterAll(async () => {
    await superuser.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await superuser.class.deleteMany({ where: { id: { in: classIds } } });
    await superuser.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await superuser.user.deleteMany({ where: { id: { in: studentIds } } });
    await superuser.membershipPlan.delete({ where: { id: plan.id } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
  });

  function fakeJob() {
    return {} as never;
  }

  async function mkStudent(label: string) {
    const student = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `membership-sweep-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Fixture',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    studentIds.push(student.id);
    return student;
  }

  async function mkMembership(
    studentId: string,
    overrides: { expiryDate?: Date | null; status?: 'ACTIVE' | 'EXPIRED'; bookingCancellationSweptAt?: Date | null } = {},
  ) {
    // `'expiryDate' in overrides`, not `overrides.expiryDate ?? default` — the
    // latter would treat an explicitly-passed `null` (the no-expiry-date case
    // this test suite needs to express) identically to "not provided," since
    // `??` only falls through on null/undefined.
    const expiryDate = 'expiryDate' in overrides ? overrides.expiryDate : new Date(Date.now() - 3_600_000);
    const membership = await superuser.membership.create({
      data: {
        id: randomUUID(),
        studentId,
        membershipPlanId: plan.id,
        schoolId: school.id,
        frequency: 'ONE_TIME',
        status: overrides.status ?? 'ACTIVE',
        expiryDate,
        bookingCancellationSweptAt: overrides.bookingCancellationSweptAt,
      },
    });
    membershipIds.push(membership.id);
    return membership;
  }

  async function mkFutureBooking(studentId: string, membershipId: string) {
    const cls = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Sweep Fixture Future Class', startDate: new Date(Date.now() + 86_400_000), endDate: new Date(Date.now() + 90_000_000) },
    });
    classIds.push(cls.id);
    const booking = await superuser.booking.create({
      data: { id: randomUUID(), studentId, classId: cls.id, schoolId: school.id, sourceMembershipId: membershipId, status: 'UPCOMING' },
    });
    bookingIds.push(booking.id);
    return { cls, booking };
  }

  it('an Active Membership past its own expiryDate has its future Booking cancelled and a seat-freed job enqueued, with status left exactly ACTIVE', async () => {
    const student = await mkStudent('overdue');
    const membership = await mkMembership(student.id);
    const { cls, booking } = await mkFutureBooking(student.id, membership.id);

    await processor.process(fakeJob());

    const membershipAfter = await superuser.membership.findUniqueOrThrow({ where: { id: membership.id } });
    // The core Decision 26 assertion — this job must NEVER touch status.
    expect(membershipAfter.status).toBe('ACTIVE');
    expect(membershipAfter.bookingCancellationSweptAt).not.toBeNull();

    const bookingAfter = await superuser.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(bookingAfter.status).toBe('CANCELLED');
    expect(bookingAfter.refundResolution).toBe('WITHHELD');

    expect(fakeWaitlistCascadeQueue.add).toHaveBeenCalledWith('seat-freed', { classId: cls.id });
  });

  it('a Membership not yet past its expiryDate is left untouched', async () => {
    const student = await mkStudent('future-expiry');
    const membership = await mkMembership(student.id, { expiryDate: new Date(Date.now() + 86_400_000) });

    await processor.process(fakeJob());

    const after = await superuser.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(after.status).toBe('ACTIVE');
    expect(after.bookingCancellationSweptAt).toBeNull();
  });

  it('an Active Membership with no expiryDate at all (e.g. a Subscription) is left untouched', async () => {
    const student = await mkStudent('no-expiry');
    const membership = await mkMembership(student.id, { expiryDate: null });

    await processor.process(fakeJob());

    const after = await superuser.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(after.status).toBe('ACTIVE');
    expect(after.bookingCancellationSweptAt).toBeNull();
  });

  it('an Active Membership past expiry with no Bookings is still stamped swept, status still ACTIVE, with no seat-freed job enqueued for it', async () => {
    const student = await mkStudent('no-bookings');
    const membership = await mkMembership(student.id);

    await processor.process(fakeJob());

    const after = await superuser.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(after.status).toBe('ACTIVE');
    expect(after.bookingCancellationSweptAt).not.toBeNull();
    expect(fakeWaitlistCascadeQueue.add).not.toHaveBeenCalled();
  });

  it('a Membership already swept on a prior run is skipped entirely — no re-processing, no duplicate seat-freed job', async () => {
    const student = await mkStudent('already-swept');
    const membership = await mkMembership(student.id, { bookingCancellationSweptAt: new Date(Date.now() - 60_000) });
    // A Booking created AFTER the prior sweep already ran — if this job
    // re-scanned an already-swept Membership, this would wrongly get cancelled.
    const { booking } = await mkFutureBooking(student.id, membership.id);

    await processor.process(fakeJob());

    const bookingAfter = await superuser.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(bookingAfter.status).toBe('UPCOMING');
    expect(fakeWaitlistCascadeQueue.add).not.toHaveBeenCalled();
  });

  it('CONCURRENCY: two simultaneous sweep runs never double-cancel the one future Booking or double-enqueue its seat-freed job', async () => {
    const student = await mkStudent('race');
    const membership = await mkMembership(student.id);
    const { cls, booking } = await mkFutureBooking(student.id, membership.id);

    await Promise.all([processor.process(fakeJob()), processor.process(fakeJob())]);

    const membershipAfter = await superuser.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(membershipAfter.status).toBe('ACTIVE');

    const bookingAfter = await superuser.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(bookingAfter.status).toBe('CANCELLED');

    const seatFreedCalls = fakeWaitlistCascadeQueue.add.mock.calls.filter(([name, data]) => name === 'seat-freed' && data.classId === cls.id);
    expect(seatFreedCalls).toHaveLength(1);
  });
});
