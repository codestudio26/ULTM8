/**
 * Decision 226 — proves EntityOffboardingPurgeProcessor's own three-way
 * outcome for the 7 entity-level tenant-offboarding entities (Branch, Class,
 * TimetableSlot, Instructor, Rank, Waiver, Lesson): hard-delete in the
 * common case, a logged FK-restrict skip (retried forever, no anonymize
 * fallback — unlike School/Franchise's own purge job), and Waiver's own
 * deliberate "never purged, ever" exception. Triggers the processor
 * directly (calling .process() against a fake Job), same approach
 * tenant-lifecycle-purge.e2e-spec.ts already established for a scheduled
 * sweep with no HTTP surface of its own.
 *
 * Requires DATABASE_URL, DATABASE_URL_JOBS. Skips with a warning if either
 * is unset, same convention as every other job spec here.
 */
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { EntityOffboardingPurgeProcessor } from '../src/jobs/entity-offboarding-purge.processor';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_JOBS);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[entity-offboarding-purge.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_JOBS not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('entity-offboarding-purge job (Decision 226)', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  let processor: EntityOffboardingPurgeProcessor;

  let school: { id: string };
  const branchIds: string[] = [];
  const classIds: string[] = [];
  const timetableSlotIds: string[] = [];
  const instructorIds: string[] = [];
  const userIds: string[] = [];
  const disciplineIds: string[] = [];
  const rankIds: string[] = [];
  const waiverIds: string[] = [];
  const lessonIds: string[] = [];
  const membershipPlanIds: string[] = [];
  const membershipIds: string[] = [];
  const bookingIds: string[] = [];
  const studentRankIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [EntityOffboardingPurgeProcessor, PrismaJobsService] }).compile();
    processor = moduleRef.get(EntityOffboardingPurgeProcessor);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Entity Offboarding Purge Job School' } });
  });

  afterAll(async () => {
    // Best-effort — several fixtures are deliberately expected to already be
    // gone (the hard-delete case); `deleteMany` on a leftover id is a safe
    // no-op either way.
    await superuser.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await superuser.studentRank.deleteMany({ where: { id: { in: studentRankIds } } });
    await superuser.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await superuser.membershipPlan.deleteMany({ where: { id: { in: membershipPlanIds } } });
    await superuser.lesson.deleteMany({ where: { id: { in: lessonIds } } });
    await superuser.rank.deleteMany({ where: { id: { in: rankIds } } });
    await superuser.discipline.deleteMany({ where: { id: { in: disciplineIds } } });
    // WaiverSignature.waiverId is ON DELETE RESTRICT (this file's own header
    // comment) — any surviving signature (the "left alone" test cases) would
    // otherwise block the Waiver cleanup below.
    await superuser.waiverSignature.deleteMany({ where: { schoolId: school.id } });
    await superuser.waiver.deleteMany({ where: { id: { in: waiverIds } } });
    await superuser.instructor.deleteMany({ where: { id: { in: instructorIds } } });
    await superuser.timetableSlot.deleteMany({ where: { id: { in: timetableSlotIds } } });
    await superuser.class.deleteMany({ where: { id: { in: classIds } } });
    await superuser.branch.deleteMany({ where: { id: { in: branchIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
  });

  function fakeJob() {
    return { data: {}, attemptsMade: 1, opts: { attempts: 3 } } as never;
  }

  const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // ===========================================================================
  // Plain delete — one representative "the common case just works" test per
  // entity, same shape as tenant-lifecycle-purge.e2e-spec.ts's own School/
  // Franchise coverage.
  // ===========================================================================

  it('a Branch past purgeAt with no dependents is hard-deleted', async () => {
    const branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Purge — plain Branch', archivedAt: PAST, purgeAt: PAST } });
    branchIds.push(branch.id);

    await processor.process(fakeJob());

    expect(await superuser.branch.findUnique({ where: { id: branch.id } })).toBeNull();
  });

  // Decision 280 — every FK pointing at Branch is CASCADE or SET NULL, so
  // nothing in the database stops the purge; the job rechecks the archive
  // dependents rule itself.
  it('an archived Branch that gained a home-branch Student after archiving is left archived, and the Student keeps their home branch', async () => {
    const branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Purge — Branch with a Student', archivedAt: PAST, purgeAt: PAST } });
    branchIds.push(branch.id);
    const student = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `purge-home-branch-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Purge',
        surname: 'HomeBranch',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
      },
    });
    userIds.push(student.id);
    const home = await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: student.id, branchId: branch.id } });

    try {
      await processor.process(fakeJob());

      expect(await superuser.branch.findUnique({ where: { id: branch.id } })).not.toBeNull();
      expect(await superuser.studentHomeBranch.findUnique({ where: { id: home.id } })).not.toBeNull();
    } finally {
      await superuser.studentHomeBranch.deleteMany({ where: { id: home.id } });
    }
  });

  it('an archived Branch with a weekly timetable slot still on it is left archived, and the slot keeps its Branch', async () => {
    const branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Purge — Branch with a slot', archivedAt: PAST, purgeAt: PAST } });
    branchIds.push(branch.id);
    const slot = await superuser.timetableSlot.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        branchId: branch.id,
        weekday: 'THURSDAY',
        startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)),
        title: 'Purge — slot on an archived Branch',
        activities: ['Yoga'],
      },
    });
    timetableSlotIds.push(slot.id);

    await processor.process(fakeJob());

    expect(await superuser.branch.findUnique({ where: { id: branch.id } })).not.toBeNull();
    expect((await superuser.timetableSlot.findUnique({ where: { id: slot.id } }))?.branchId).toBe(branch.id);
  });

  it('a Class past purgeAt with no Booking/WaitlistEntry is hard-deleted', async () => {
    const cls = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Purge — plain Class', startDate: FUTURE, endDate: FUTURE, archivedAt: PAST, purgeAt: PAST },
    });
    classIds.push(cls.id);

    await processor.process(fakeJob());

    expect(await superuser.class.findUnique({ where: { id: cls.id } })).toBeNull();
  });

  it('a TimetableSlot past purgeAt is hard-deleted', async () => {
    const slot = await superuser.timetableSlot.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        weekday: 'WEDNESDAY',
        startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)),
        title: 'Purge — plain Slot',
        archivedAt: PAST,
        purgeAt: PAST,
      },
    });
    timetableSlotIds.push(slot.id);

    await processor.process(fakeJob());

    expect(await superuser.timetableSlot.findUnique({ where: { id: slot.id } })).toBeNull();
  });

  it('an Instructor profile past purgeAt is hard-deleted — never touches the underlying User', async () => {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `purge-instructor-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Purge',
        surname: 'Instructor',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
      },
    });
    userIds.push(user.id);
    const profile = await superuser.instructor.create({ data: { id: randomUUID(), userId: user.id, schoolId: school.id, archivedAt: PAST, purgeAt: PAST } });
    instructorIds.push(profile.id);

    await processor.process(fakeJob());

    expect(await superuser.instructor.findUnique({ where: { id: profile.id } })).toBeNull();
    expect(await superuser.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  it('a Lesson past purgeAt is hard-deleted', async () => {
    const lesson = await superuser.lesson.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Purge — plain Lesson', format: 'PRERECORDED', archivedAt: PAST, purgeAt: PAST },
    });
    lessonIds.push(lesson.id);

    await processor.process(fakeJob());

    expect(await superuser.lesson.findUnique({ where: { id: lesson.id } })).toBeNull();
  });

  it('a Rank past purgeAt with nobody holding it, no grading history, and no instructor declaration is hard-deleted', async () => {
    const discipline = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Purge Style — plain Rank' } });
    disciplineIds.push(discipline.id);
    const rank = await superuser.rank.create({
      data: { id: randomUUID(), disciplineId: discipline.id, schoolId: school.id, order: 0, name: 'Purge — plain Rank', primaryColour: 'white', archivedAt: PAST, purgeAt: PAST },
    });
    rankIds.push(rank.id);

    await processor.process(fakeJob());

    expect(await superuser.rank.findUnique({ where: { id: rank.id } })).toBeNull();
  });

  // ===========================================================================
  // Blocked — logged and skipped, never anonymized (no fallback for these 7,
  // unlike School/Franchise's own job), retried on the next sweep.
  // ===========================================================================

  it('a Class past purgeAt with ANY Booking (even one not UPCOMING — RESTRICT doesn\'t care about status) is skipped, not force-deleted', async () => {
    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Purge Test Plan', price: 1000 } });
    membershipPlanIds.push(plan.id);
    const student = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `purge-booking-student-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Purge',
        surname: 'BookingStudent',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
      },
    });
    userIds.push(student.id);
    const membership = await superuser.membership.create({
      data: { id: randomUUID(), studentId: student.id, membershipPlanId: plan.id, schoolId: school.id, status: 'EXPIRED', frequency: 'RECURRING' },
    });
    membershipIds.push(membership.id);
    const cls = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Purge — Class with historical Booking', startDate: PAST, endDate: PAST, archivedAt: PAST, purgeAt: PAST },
    });
    classIds.push(cls.id);
    const booking = await superuser.booking.create({
      data: { id: randomUUID(), studentId: student.id, classId: cls.id, schoolId: school.id, sourceMembershipId: membership.id, status: 'COMPLETED' },
    });
    bookingIds.push(booking.id);

    await processor.process(fakeJob());

    const after = await superuser.class.findUnique({ where: { id: cls.id } });
    expect(after).not.toBeNull();
    expect(after?.purgedAt).toBeNull();
  });

  it('a Rank past purgeAt that a Student now holds (created AFTER archiving) is skipped, not force-deleted — the purge job re-derives safety, it does not trust the archive-time check to still hold', async () => {
    const discipline = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Purge Style — Rank gains a holder' } });
    disciplineIds.push(discipline.id);
    const rank = await superuser.rank.create({
      data: { id: randomUUID(), disciplineId: discipline.id, schoolId: school.id, order: 0, name: 'Purge — Rank gains a holder', primaryColour: 'blue', archivedAt: PAST, purgeAt: PAST },
    });
    rankIds.push(rank.id);
    const student = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `purge-rank-holder-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Purge',
        surname: 'RankHolder',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
      },
    });
    userIds.push(student.id);
    const studentRank = await superuser.studentRank.create({
      data: { id: randomUUID(), studentId: student.id, disciplineId: discipline.id, schoolId: school.id, currentRankId: rank.id },
    });
    studentRankIds.push(studentRank.id);

    await processor.process(fakeJob());

    const after = await superuser.rank.findUnique({ where: { id: rank.id } });
    expect(after).not.toBeNull();
    expect(after?.purgedAt).toBeNull();
  });

  it('a Rank whose purgeAt has NOT elapsed yet is left completely untouched', async () => {
    const discipline = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Purge Style — not due yet' } });
    disciplineIds.push(discipline.id);
    const rank = await superuser.rank.create({
      data: { id: randomUUID(), disciplineId: discipline.id, schoolId: school.id, order: 0, name: 'Purge — not due yet', primaryColour: 'green', archivedAt: new Date(), purgeAt: FUTURE },
    });
    rankIds.push(rank.id);

    await processor.process(fakeJob());

    const after = await superuser.rank.findUnique({ where: { id: rank.id } });
    expect(after).not.toBeNull();
    expect(after?.purgedAt).toBeNull();
  });

  it('a Branch already marked purgedAt is never reprocessed', async () => {
    const purgedAt = new Date('2026-01-01T00:00:00Z');
    const branch = await superuser.branch.create({
      data: { id: randomUUID(), schoolId: school.id, name: 'Purge — already purged', archivedAt: PAST, purgeAt: PAST, purgedAt },
    });
    branchIds.push(branch.id);

    await processor.process(fakeJob());

    const after = await superuser.branch.findUnique({ where: { id: branch.id } });
    expect(after?.purgedAt?.toISOString()).toBe(purgedAt.toISOString());
  });

  // ===========================================================================
  // Waiver — NEVER purged, at any purgeAt, with or without a signature. The
  // one deliberate, explicitly-logged exception in this whole job.
  // ===========================================================================

  it('a Waiver past purgeAt with NO signatures is still NOT purged — the legal-record exception applies unconditionally, not only when a signature exists', async () => {
    const waiver = await superuser.waiver.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Purge — Waiver, no signatures', body: 'Terms.', archivedAt: PAST, purgeAt: PAST },
    });
    waiverIds.push(waiver.id);

    await processor.process(fakeJob());

    const after = await superuser.waiver.findUnique({ where: { id: waiver.id } });
    expect(after).not.toBeNull();
    expect(after?.purgedAt).toBeNull();
  });

  it('a Waiver whose purgeAt has NOT elapsed yet is also left alone (nothing to log)', async () => {
    const waiver = await superuser.waiver.create({
      data: { id: randomUUID(), schoolId: school.id, title: 'Purge — Waiver, not due yet', body: 'Terms.', archivedAt: new Date(), purgeAt: FUTURE },
    });
    waiverIds.push(waiver.id);

    await processor.process(fakeJob());

    const after = await superuser.waiver.findUnique({ where: { id: waiver.id } });
    expect(after).not.toBeNull();
  });

  // ===========================================================================
  // WaiverSignature — Decision 269's retention numbers, dynamically computed.
  // A fresh Waiver template + School-scoped STUDENT RoleGrant history per
  // test, so each test's own revokedAt/dateOfBirth fixture is the only
  // variable that determines the outcome.
  // ===========================================================================

  function yearsAgo(years: number): Date {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    return d;
  }

  async function mkSigner(label: string, dateOfBirth: Date) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `purge-sig-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Purge',
        surname: label,
        passcodeHash: 'x',
        dateOfBirth,
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function mkWaiverAndSignature(opts: { signedById: string; studentId: string }) {
    const waiver = await superuser.waiver.create({
      data: { id: randomUUID(), schoolId: school.id, title: `Purge Signature Test Waiver ${randomUUID()}`, body: 'Terms.' },
    });
    waiverIds.push(waiver.id);
    const signature = await superuser.waiverSignature.create({
      data: {
        id: randomUUID(),
        waiverId: waiver.id,
        studentId: opts.studentId,
        signedById: opts.signedById,
        schoolId: school.id,
        signerFullName: 'Purge Test Signer',
        signatureText: 'Purge Test Signer',
        signedDate: new Date(),
        status: 'SIGNED',
      },
    });
    return signature;
  }

  it('an adult (self-signed) WaiverSignature is purged 7 years after the Student departs (Decision 269)', async () => {
    const student = await mkSigner('AdultDeparted', new Date('1990-01-01'));
    const signature = await mkWaiverAndSignature({ signedById: student.id, studentId: student.id });
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id, revokedAt: yearsAgo(8) },
    });

    await processor.process(fakeJob());

    expect(await superuser.waiverSignature.findUnique({ where: { id: signature.id } })).toBeNull();
  });

  it('an adult (self-signed) WaiverSignature is left alone when departure was LESS than 7 years ago', async () => {
    const student = await mkSigner('AdultRecentDeparture', new Date('1990-01-01'));
    const signature = await mkWaiverAndSignature({ signedById: student.id, studentId: student.id });
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id, revokedAt: yearsAgo(1) },
    });

    await processor.process(fakeJob());

    expect(await superuser.waiverSignature.findUnique({ where: { id: signature.id } })).not.toBeNull();
  });

  it('an adult (self-signed) WaiverSignature is left alone while the Student is still actively enrolled (no departure to measure from)', async () => {
    const student = await mkSigner('AdultStillEnrolled', new Date('1990-01-01'));
    const signature = await mkWaiverAndSignature({ signedById: student.id, studentId: student.id });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id, revokedAt: null } });

    await processor.process(fakeJob());

    expect(await superuser.waiverSignature.findUnique({ where: { id: signature.id } })).not.toBeNull();
  });

  it('a minor\'s (Guardian-signed) WaiverSignature is purged once the Student has been 18+ for at least 6 more years', async () => {
    const guardian = await mkSigner('Guardian1', new Date('1980-01-01'));
    const minor = await mkSigner('NowGrownUp', yearsAgo(25)); // currently 25 — well past 18+6=24
    const signature = await mkWaiverAndSignature({ signedById: guardian.id, studentId: minor.id });

    await processor.process(fakeJob());

    expect(await superuser.waiverSignature.findUnique({ where: { id: signature.id } })).toBeNull();
  });

  it('a minor\'s (Guardian-signed) WaiverSignature is left alone before the Student reaches 18+6 years old', async () => {
    const guardian = await mkSigner('Guardian2', new Date('1980-01-01'));
    const youngAdult = await mkSigner('NotYet24', yearsAgo(20)); // currently 20 — short of 18+6=24
    const signature = await mkWaiverAndSignature({ signedById: guardian.id, studentId: youngAdult.id });

    await processor.process(fakeJob());

    expect(await superuser.waiverSignature.findUnique({ where: { id: signature.id } })).not.toBeNull();
  });

  it('a minor\'s (Guardian-signed) WaiverSignature is left alone when the Student has no dateOfBirth on file — never guessed', async () => {
    const guardian = await mkSigner('Guardian3', new Date('1980-01-01'));
    const minorNoDob = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `purge-sig-minor-no-dob-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Purge',
        surname: 'MinorNoDob',
        passcodeHash: 'x',
        dateOfBirth: null,
      },
    });
    userIds.push(minorNoDob.id);
    const signature = await mkWaiverAndSignature({ signedById: guardian.id, studentId: minorNoDob.id });

    await processor.process(fakeJob());

    expect(await superuser.waiverSignature.findUnique({ where: { id: signature.id } })).not.toBeNull();
  });

  it('an UNSIGNED assignment-placeholder WaiverSignature is never touched by this sweep, regardless of anything else', async () => {
    const student = await mkSigner('UnsignedPlaceholder', new Date('1990-01-01'));
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id, revokedAt: yearsAgo(10) },
    });
    const waiver = await superuser.waiver.create({
      data: { id: randomUUID(), schoolId: school.id, title: `Purge Unsigned Test Waiver ${randomUUID()}`, body: 'Terms.' },
    });
    waiverIds.push(waiver.id);
    const signature = await superuser.waiverSignature.create({
      data: { id: randomUUID(), waiverId: waiver.id, studentId: student.id, signedById: null, schoolId: school.id, status: 'UNSIGNED' },
    });

    await processor.process(fakeJob());

    expect(await superuser.waiverSignature.findUnique({ where: { id: signature.id } })).not.toBeNull();
  });
});
