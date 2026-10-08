/**
 * Proves the waitlist-cascade-processing job actually notifies a Student when a
 * seat frees up — the gap this fix closes: before it, flipping a WaitlistEntry to
 * NOTIFIED was the only observable effect, with no Notification row, no email, no
 * push, nothing short of reopening the app and checking again. Triggers the
 * processor directly (calling .process() against a fake Job) against a real
 * Postgres, with NOTIFICATION_FANOUT_QUEUE faked and controllable — same approach
 * stripe-webhook-processing.e2e-spec.ts already established for a job that fans
 * out to a sibling queue rather than running the full BullMQ/Redis round trip.
 *
 * Requires DATABASE_URL and DATABASE_URL_JOBS. Skips with a warning if either is unset.
 */
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { WaitlistCascadeProcessingProcessor } from '../src/jobs/waitlist-cascade-processing.processor';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';
import { NOTIFICATION_FANOUT_QUEUE } from '../src/jobs/queue.constants';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_JOBS);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[waitlist-cascade-processing.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_JOBS not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('waitlist-cascade-processing job — notifies the Student a seat freed up', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  let processor: WaitlistCascadeProcessingProcessor;
  const fakeNotificationQueue = { add: jest.fn().mockResolvedValue(undefined) };

  let school: { id: string };
  const studentIds: string[] = [];
  const classIds: string[] = [];
  const waitlistEntryIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        WaitlistCascadeProcessingProcessor,
        PrismaJobsService,
        { provide: getQueueToken(NOTIFICATION_FANOUT_QUEUE), useValue: fakeNotificationQueue },
      ],
    }).compile();
    processor = moduleRef.get(WaitlistCascadeProcessingProcessor);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Waitlist Job Fixture School', waitlistClaimWindowMinutes: 120 } });
  });

  afterEach(() => {
    fakeNotificationQueue.add.mockClear();
  });

  afterAll(async () => {
    await superuser.waitlistEntry.deleteMany({ where: { id: { in: waitlistEntryIds } } });
    await superuser.class.deleteMany({ where: { id: { in: classIds } } });
    await superuser.user.deleteMany({ where: { id: { in: studentIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
  });

  function fakeJob(data: { classId?: string }, name: 'seat-freed' | 'sweep-expired' = 'seat-freed') {
    return { name, data } as never;
  }

  async function mkStudent(label: string) {
    const student = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `waitlist-job-${label}-${randomUUID()}@example.test`,
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

  async function mkClass(title: string) {
    const future = new Date(Date.now() + 24 * 3_600_000);
    const cls = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title, startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
    });
    classIds.push(cls.id);
    return cls;
  }

  async function mkWaitingEntry(classId: string, studentId: string, position: number) {
    const entry = await superuser.waitlistEntry.create({
      data: { id: randomUUID(), classId, studentId, schoolId: school.id, position, status: 'WAITING' },
    });
    waitlistEntryIds.push(entry.id);
    return entry;
  }

  it('flips the next Waiting entry to Notified and enqueues a real notification for that Student', async () => {
    const student = await mkStudent('next');
    const cls = await mkClass('Seat-Freed Fixture Class');
    const entry = await mkWaitingEntry(cls.id, student.id, 1);

    await processor.process(fakeJob({ classId: cls.id }));

    const row = await superuser.waitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.status).toBe('NOTIFIED');
    expect(row.notifiedAt).not.toBeNull();
    expect(row.claimByDeadline).not.toBeNull();

    expect(fakeNotificationQueue.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = fakeNotificationQueue.add.mock.calls[0];
    expect(name).toBe('notify');
    expect(data).toMatchObject({
      notificationId: `waitlist-notified-${entry.id}`,
      userId: student.id,
      type: 'WAITLIST_SPOT_OPENED',
    });
    expect(data.body).toContain('Seat-Freed Fixture Class');
    expect(opts.jobId).toBe(`waitlist-notified-${entry.id}`);
  });

  it('no Waiting entry for the Class — enqueues nothing', async () => {
    const cls = await mkClass('Empty Waitlist Fixture Class');

    await processor.process(fakeJob({ classId: cls.id }));

    expect(fakeNotificationQueue.add).not.toHaveBeenCalled();
  });

  it('CONCURRENCY: two simultaneous seat-freed runs for the same Class never double-notify the one Waiting entry', async () => {
    const student = await mkStudent('race');
    const cls = await mkClass('Race Fixture Class');
    await mkWaitingEntry(cls.id, student.id, 1);

    await Promise.all([processor.process(fakeJob({ classId: cls.id })), processor.process(fakeJob({ classId: cls.id }))]);

    // The updateMany guard inside notifyNextWaitingEntry() makes the loser a
    // no-op before it ever reaches the enqueue call — exactly one notification,
    // not two, for the one real transition that happened.
    expect(fakeNotificationQueue.add).toHaveBeenCalledTimes(1);
  });

  it('sweep-expired cascades an overdue Notified entry to the next Waiting one, and notifies only that one', async () => {
    const studentA = await mkStudent('overdue');
    const studentB = await mkStudent('cascaded');
    const cls = await mkClass('Sweep Fixture Class');

    const overdue = await superuser.waitlistEntry.create({
      data: {
        id: randomUUID(),
        classId: cls.id,
        studentId: studentA.id,
        schoolId: school.id,
        position: 1,
        status: 'NOTIFIED',
        notifiedAt: new Date(Date.now() - 3_600_000),
        claimByDeadline: new Date(Date.now() - 1_800_000),
      },
    });
    waitlistEntryIds.push(overdue.id);
    const waiting = await mkWaitingEntry(cls.id, studentB.id, 2);

    await processor.process(fakeJob({}, 'sweep-expired'));

    const overdueRow = await superuser.waitlistEntry.findUniqueOrThrow({ where: { id: overdue.id } });
    expect(overdueRow.status).toBe('EXPIRED');
    const waitingRow = await superuser.waitlistEntry.findUniqueOrThrow({ where: { id: waiting.id } });
    expect(waitingRow.status).toBe('NOTIFIED');

    expect(fakeNotificationQueue.add).toHaveBeenCalledTimes(1);
    const [, data] = fakeNotificationQueue.add.mock.calls[0];
    expect(data.userId).toBe(studentB.id);
  });
});
