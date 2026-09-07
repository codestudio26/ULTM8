/**
 * Proves the class-occurrence-generation job (Phase 5) actually materializes Class
 * rows from an active TimetableSlot — the one piece of this phase a passing build
 * genuinely cannot substitute for, same reasoning as classes.e2e-spec.ts's RLS proof
 * in Phase 4. Triggers the processor directly (calling .process() against a fake Job)
 * rather than going through the real queue/cron schedule, same approach the Phase 5
 * kickoff prompt called for.
 *
 * Requires DATABASE_URL, DATABASE_URL_JOBS (the ultm8_jobs role this job actually runs
 * as — NOT DATABASE_URL_APP), and DATABASE_URL_APP (for RLS-scoped fixture cleanup
 * reads). Skips with a warning if any are unset.
 */
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ClassOccurrenceGenerationProcessor } from '../src/jobs/class-occurrence-generation.processor';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_JOBS);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[class-occurrence-generation.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_JOBS not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('class-occurrence-generation job', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  let processor: ClassOccurrenceGenerationProcessor;

  let school: { id: string };
  let branch: { id: string };
  let slot: { id: string; weekday: string };

  // A branch EAST of UTC (positive offset) — code review caught that occurrenceDate
  // was computed via a method that only ever manifested wrong for positive-offset
  // zones; America/New_York (negative offset) above could never have caught it.
  let branchTokyo: { id: string };
  let slotZeroCutoff: { id: string };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ClassOccurrenceGenerationProcessor, PrismaJobsService],
    }).compile();
    processor = moduleRef.get(ClassOccurrenceGenerationProcessor);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Occurrence-Gen Fixture School' } });
    branch = await superuser.branch.create({
      data: { id: randomUUID(), schoolId: school.id, name: 'Occurrence-Gen Fixture Branch', timezone: 'America/New_York' },
    });
    slot = await superuser.timetableSlot.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        branchId: branch.id,
        weekday: 'MONDAY',
        startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)),
        status: 'ON',
        title: 'Fixture Occurrence Class',
        activities: ['BJJ'],
        capacity: 20,
        bookingCutoffMinutesBeforeStart: 60,
      },
    });

    branchTokyo = await superuser.branch.create({
      data: { id: randomUUID(), schoolId: school.id, name: 'Occurrence-Gen Fixture Branch Tokyo', timezone: 'Asia/Tokyo' },
    });
    slotZeroCutoff = await superuser.timetableSlot.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        branchId: branchTokyo.id,
        weekday: 'MONDAY',
        startTime: new Date(Date.UTC(1970, 0, 1, 20, 0)), // late enough local that midnight->this instant crosses a UTC day boundary
        endTime: new Date(Date.UTC(1970, 0, 1, 21, 0)),
        status: 'ON',
        title: 'Fixture Zero-Cutoff Class',
        activities: ['BJJ'],
        bookingCutoffMinutesBeforeStart: 0, // "bookable right up to start" — must NOT be treated as unset
      },
    });
  });

  afterAll(async () => {
    await superuser.class.deleteMany({ where: { timetableSlotId: { in: [slot.id, slotZeroCutoff.id] } } });
    await superuser.timetableSlot.deleteMany({ where: { id: { in: [slot.id, slotZeroCutoff.id] } } });
    await superuser.branch.deleteMany({ where: { id: { in: [branch.id, branchTokyo.id] } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
  });

  it('materializes 4 weeks of Class occurrences from an active TimetableSlot, copying template fields and resolving the timezone-aware start/end time', async () => {
    await processor.process({ id: 'test-run-1', data: {} } as never);

    const generated = await superuser.class.findMany({
      where: { timetableSlotId: slot.id },
      orderBy: { startDate: 'asc' },
    });
    expect(generated.length).toBe(4);
    for (const cls of generated) {
      expect(cls.title).toBe('Fixture Occurrence Class');
      expect(cls.activities).toEqual(['BJJ']);
      expect(cls.capacity).toBe(20);
      expect(cls.schoolId).toBe(school.id);
      expect(cls.branchId).toBe(branch.id);
      expect(cls.occurrenceDate).not.toBeNull();
      // 18:00 America/New_York is 22:00 or 23:00 UTC depending on DST — either way,
      // never 18:00 UTC, which is what a naive (non-timezone-aware) implementation
      // would have produced.
      expect(cls.startDate.getUTCHours()).not.toBe(18);
      expect(cls.bookingEndAt).not.toBeNull();
    }
  });

  it('running it again does not create duplicate occurrences (the unique constraint, not just application logic)', async () => {
    await processor.process({ id: 'test-run-2', data: {} } as never);
    const generated = await superuser.class.findMany({ where: { timetableSlotId: slot.id } });
    expect(generated.length).toBe(4); // still 4, not 8
  });

  it('occurrenceDate matches startDate\'s local calendar day for a Branch east of UTC (regression: was off by one)', async () => {
    await processor.process({ id: 'test-run-tokyo', data: {} } as never);
    const generated = await superuser.class.findMany({ where: { timetableSlotId: slotZeroCutoff.id } });
    expect(generated.length).toBe(4);
    for (const cls of generated) {
      const localStart = new Date(cls.startDate.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
      expect(cls.occurrenceDate).not.toBeNull();
      expect(cls.occurrenceDate!.getUTCFullYear()).toBe(localStart.getFullYear());
      expect(cls.occurrenceDate!.getUTCMonth()).toBe(localStart.getMonth());
      expect(cls.occurrenceDate!.getUTCDate()).toBe(localStart.getDate());
    }
  });

  it('bookingCutoffMinutesBeforeStart: 0 produces a real bookingEndAt, not null (regression: was treated as unset)', async () => {
    await processor.process({ id: 'test-run-zero-cutoff', data: {} } as never); // idempotent — don't rely on test order
    const generated = await superuser.class.findMany({
      where: { timetableSlotId: slotZeroCutoff.id },
      orderBy: { startDate: 'asc' },
    });
    expect(generated.length).toBeGreaterThan(0);
    for (const cls of generated) {
      expect(cls.bookingEndAt).not.toBeNull();
      expect(cls.bookingEndAt!.getTime()).toBe(cls.startDate.getTime()); // 0 minutes before = exactly at start
    }
  });
});
