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
import { EntityOffboardingPurgeProcessor, WAIVER_RETENTION_BATCH_SIZE } from '../src/jobs/entity-offboarding-purge.processor';
import { R2ClientService } from '../src/common/object-storage/r2-client.service';
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
  // Stands in for R2: the purge deletes a signature's drawn image first.
  const r2 = {
    isConfigured: () => true,
    deleteObject: jest.fn(async (_key: string) => undefined),
    deletePublicPhotoByUrl: jest.fn(async (_url: string) => true),
  };

  let school: { id: string };
  // Other Schools a test makes (cross-tenant, closed Schools).
  const extraSchoolIds: string[] = [];
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
    const moduleRef = await Test.createTestingModule({
      providers: [EntityOffboardingPurgeProcessor, PrismaJobsService, { provide: R2ClientService, useValue: r2 }],
    }).compile();
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
    // WaiverSignature.waiverId and studentId are ON DELETE RESTRICT
    // (Decision 426) — any surviving signature (the "kept" test cases) would
    // otherwise block the Waiver and User cleanup below.
    const allSchoolIds = [school.id, ...extraSchoolIds];
    await superuser.waiverSignature.deleteMany({ where: { schoolId: { in: allSchoolIds } } });
    await superuser.waiver.deleteMany({ where: { id: { in: waiverIds } } });
    await superuser.instructor.deleteMany({ where: { id: { in: instructorIds } } });
    await superuser.timetableSlot.deleteMany({ where: { id: { in: timetableSlotIds } } });
    await superuser.class.deleteMany({ where: { id: { in: classIds } } });
    await superuser.branch.deleteMany({ where: { id: { in: branchIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: allSchoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: allSchoolIds } } });
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

  // Decision 293 — every FK pointing at Branch is CASCADE or SET NULL, so
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

  // Decision 330 (fix 7) — a closed Branch with history is kept for good:
  // deleting it would set its past Classes' branchId to null.
  it('an archived Branch past purgeAt with a past Class is kept, and its purgeAt is cleared', async () => {
    const branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Purge — Branch with history', archivedAt: PAST, purgeAt: PAST } });
    branchIds.push(branch.id);
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const cls = await superuser.class.create({
      data: { id: randomUUID(), schoolId: school.id, branchId: branch.id, title: 'Purge — past class', startDate: past, endDate: new Date(past.getTime() + 60 * 60 * 1000) },
    });
    classIds.push(cls.id);

    await processor.process(fakeJob());

    const kept = await superuser.branch.findUnique({ where: { id: branch.id } });
    expect(kept).not.toBeNull();
    expect(kept?.purgeAt).toBeNull();
    expect(kept?.archivedAt).not.toBeNull();
    expect((await superuser.class.findUnique({ where: { id: cls.id } }))?.branchId).toBe(branch.id);
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

  describe('Decision 448 item 10: an archived coach profile goes with its stored files', () => {
    const mkCoach = async () => {
      const user = await superuser.user.create({
        data: {
          id: randomUUID(),
          email: `purge-coach-files-${randomUUID()}@example.test`,
          phone: null,
          firstName: 'Purge',
          surname: 'Coach',
          passcodeHash: 'x',
        },
      });
      userIds.push(user.id);
      return user;
    };
    const coachPhoto = () => `https://ci-test-public-photos.example.test/public-photos/instructor/${school.id}/${randomUUID()}/${randomUUID()}.jpg`;
    const profile = async (userId: string, data: { photoUrl?: string; certificationKey?: string; archived?: boolean; schoolId?: string }) => {
      const row = await superuser.instructor.create({
        data: {
          id: randomUUID(),
          userId,
          schoolId: data.schoolId ?? school.id,
          photoUrl: data.photoUrl,
          certificationKey: data.certificationKey,
          ...(data.archived === false ? {} : { archivedAt: PAST, purgeAt: PAST }),
        },
      });
      instructorIds.push(row.id);
      return row;
    };

    beforeEach(() => {
      r2.deleteObject.mockClear();
      r2.deletePublicPhotoByUrl.mockClear();
    });

    it('the certification file and the coach-profile photo are deleted with the profile', async () => {
      const coach = await mkCoach();
      const photoUrl = coachPhoto();
      const certificationKey = `certifications/${randomUUID()}.pdf`;
      const row = await profile(coach.id, { photoUrl, certificationKey });

      await processor.process(fakeJob());

      expect(await superuser.instructor.findUnique({ where: { id: row.id } })).toBeNull();
      expect(r2.deleteObject).toHaveBeenCalledWith(certificationKey);
      expect(r2.deletePublicPhotoByUrl).toHaveBeenCalledWith(photoUrl);
    });

    it("a file the coach's other (open) profile still uses is kept, and a photo that isn't a coach-profile upload is never deleted", async () => {
      const coach = await mkCoach();
      const sharedPhoto = coachPhoto();
      const sharedKey = `certifications/${randomUUID()}.pdf`;
      const purged = await profile(coach.id, { photoUrl: sharedPhoto, certificationKey: sharedKey });
      // completeMyProfile sets the same files on the coach's profile at another School.
      const otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Purge Coach Files Other School' } });
      extraSchoolIds.push(otherSchool.id);
      const open = await profile(coach.id, { photoUrl: sharedPhoto, certificationKey: sharedKey, archived: false, schoolId: otherSchool.id });
      const pasted = await profile((await mkCoach()).id, { photoUrl: `https://ci-test-public-photos.example.test/public-photos/school/${school.id}/logo.png` });

      await processor.process(fakeJob());

      expect(await superuser.instructor.findUnique({ where: { id: purged.id } })).toBeNull();
      expect(await superuser.instructor.findUnique({ where: { id: pasted.id } })).toBeNull();
      expect(await superuser.instructor.findUniqueOrThrow({ where: { id: open.id } })).toMatchObject({ photoUrl: sharedPhoto, certificationKey: sharedKey });
      expect(r2.deleteObject).not.toHaveBeenCalledWith(sharedKey);
      expect(r2.deletePublicPhotoByUrl).not.toHaveBeenCalled();
    });

    it('if a file cannot be deleted, the profile waits for the next run', async () => {
      const coach = await mkCoach();
      const certificationKey = `certifications/${randomUUID()}.pdf`;
      const row = await profile(coach.id, { certificationKey });

      r2.deleteObject.mockImplementation(async (k: string) => {
        if (k === certificationKey) throw new Error('R2 down');
      });
      await processor.process(fakeJob());
      r2.deleteObject.mockImplementation(async () => undefined);
      expect(await superuser.instructor.findUnique({ where: { id: row.id } })).not.toBeNull();

      await processor.process(fakeJob());
      expect(await superuser.instructor.findUnique({ where: { id: row.id } })).toBeNull();
      expect(r2.deleteObject).toHaveBeenCalledWith(certificationKey);
    });
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
  // WaiverSignature — Decision 426's retention rule (src/waivers/
  // waiver-retention.ts has the unit tests for every branch; these prove the
  // sweep reads the right inputs from the database and acts on them). A fresh
  // Waiver template + School-scoped STUDENT RoleGrant history per test, so
  // each test's own revokedAt/dateOfBirth fixture decides the outcome.
  // ===========================================================================

  function yearsAgo(years: number, extraDays = 0): Date {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    d.setUTCDate(d.getUTCDate() - extraDays);
    return d;
  }

  async function mkSigner(label: string, dateOfBirth: Date | null) {
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

  async function mkSchool(label: string, data: { archivedAt?: Date; purgeAt?: Date; purgedAt?: Date } = {}) {
    const s = await superuser.school.create({ data: { id: randomUUID(), name: `Purge Signature ${label}`, ...data } });
    extraSchoolIds.push(s.id);
    return s;
  }

  async function grant(userId: string, revokedAt: Date | null, schoolId = school.id) {
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId, schoolId, revokedAt } });
  }

  async function mkWaiverAndSignature(opts: {
    signedById: string | null;
    studentId: string;
    signatureImageKey?: string;
    signedDate?: Date;
    schoolId?: string;
    status?: 'SIGNED' | 'EXPIRED' | 'UNSIGNED' | 'PENDING';
    method?: 'ONLINE' | 'PAPER';
    mergedIntoStudentId?: string;
  }) {
    const schoolId = opts.schoolId ?? school.id;
    const waiver = await superuser.waiver.create({
      data: { id: randomUUID(), schoolId, title: `Purge Signature Test Waiver ${randomUUID()}`, body: 'Terms.' },
    });
    waiverIds.push(waiver.id);
    const unsigned = opts.status === 'UNSIGNED' || opts.status === 'PENDING';
    return superuser.waiverSignature.create({
      data: {
        id: randomUUID(),
        waiverId: waiver.id,
        studentId: opts.studentId,
        signedById: unsigned ? null : opts.signedById,
        schoolId,
        signerFullName: unsigned ? null : 'Purge Test Signer',
        signatureText: unsigned ? null : 'Purge Test Signer',
        signedDate: unsigned ? null : (opts.signedDate ?? new Date()),
        status: opts.status ?? 'SIGNED',
        method: opts.method ?? 'ONLINE',
        signatureImageKey: opts.signatureImageKey,
        signedWaiverSha256: unsigned ? null : 'a'.repeat(64),
        mergedIntoStudentId: opts.mergedIntoStudentId,
      },
    });
  }

  const exists = async (id: string) => (await superuser.waiverSignature.findUnique({ where: { id } })) !== null;

  it('an adult who left 7+ years ago: purged, with exactly one purge-log line and no personal data in it', async () => {
    const student = await mkSigner('AdultDeparted', new Date('1990-01-01'));
    const signature = await mkWaiverAndSignature({ signedById: student.id, studentId: student.id, signedDate: yearsAgo(12) });
    await grant(student.id, yearsAgo(8));

    await processor.process(fakeJob());
    await processor.process(fakeJob()); // a second run finds nothing more to log

    expect(await exists(signature.id)).toBe(false);
    const log = await superuser.waiverSignaturePurgeLog.findMany({ where: { signatureId: signature.id } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: 'MEMBER', schoolId: school.id, waiverId: signature.waiverId, rule: 'ADULT_LEFT', signedWaiverSha256: 'a'.repeat(64) });
    expect(log[0].retainUntil!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(Object.keys(log[0]).sort()).toEqual(['id', 'kind', 'purgedAt', 'retainUntil', 'rule', 'schoolId', 'signatureId', 'signedWaiverSha256', 'waiverId']);
  });

  it('a purged signature takes its drawn image with it; if the image delete fails, the row waits for the next run', async () => {
    const student = await mkSigner('AdultDepartedImage', new Date('1990-01-01'));
    const key = `${school.id}/image-${randomUUID()}.png`;
    const signature = await mkWaiverAndSignature({ signedById: student.id, studentId: student.id, signatureImageKey: key, signedDate: yearsAgo(12) });
    await grant(student.id, yearsAgo(8));

    r2.deleteObject.mockImplementation(async (k: string) => {
      if (k === key) throw new Error('R2 down');
    });
    await processor.process(fakeJob());
    r2.deleteObject.mockImplementation(async () => undefined);
    expect(await exists(signature.id)).toBe(true);
    expect(await superuser.waiverSignaturePurgeLog.count({ where: { signatureId: signature.id } })).toBe(0);

    await processor.process(fakeJob());
    expect(r2.deleteObject).toHaveBeenCalledWith(key);
    expect(await exists(signature.id)).toBe(false);
    expect(await superuser.waiverSignaturePurgeLog.count({ where: { signatureId: signature.id } })).toBe(1);
  });

  it('an adult who left LESS than 7 years ago, or is still a member, is kept', async () => {
    const recent = await mkSigner('AdultRecentDeparture', new Date('1990-01-01'));
    const enrolled = await mkSigner('AdultStillEnrolled', new Date('1990-01-01'));
    const rejoined = await mkSigner('AdultRejoined', new Date('1990-01-01'));
    const s1 = await mkWaiverAndSignature({ signedById: recent.id, studentId: recent.id, signedDate: yearsAgo(12) });
    const s2 = await mkWaiverAndSignature({ signedById: enrolled.id, studentId: enrolled.id, signedDate: yearsAgo(30) });
    const s3 = await mkWaiverAndSignature({ signedById: rejoined.id, studentId: rejoined.id, signedDate: yearsAgo(30) });
    await grant(recent.id, yearsAgo(6, 300));
    await grant(enrolled.id, null);
    await grant(rejoined.id, yearsAgo(20));
    await grant(rejoined.id, null);

    await processor.process(fakeJob());

    expect(await exists(s1.id)).toBe(true);
    expect(await exists(s2.id)).toBe(true);
    expect(await exists(s3.id)).toBe(true);
  });

  it('a child: kept until the later of 7 years after leaving and age 25 (18 + 7)', async () => {
    const guardian = await mkSigner('Guardian1', new Date('1980-01-01'));
    const now26 = await mkSigner('ChildNow26', yearsAgo(26));
    const now24 = await mkSigner('ChildNow24', yearsAgo(24, 30)); // 18 + 6 was enough before Decision 426
    const purged = await mkWaiverAndSignature({ signedById: guardian.id, studentId: now26.id, signedDate: yearsAgo(15) });
    const kept = await mkWaiverAndSignature({ signedById: guardian.id, studentId: now24.id, signedDate: yearsAgo(15) });
    await grant(now26.id, yearsAgo(9));
    await grant(now24.id, yearsAgo(9));

    await processor.process(fakeJob());

    expect(await exists(purged.id)).toBe(false);
    expect(await exists(kept.id)).toBe(true);
    expect((await superuser.waiverSignaturePurgeLog.findFirst({ where: { signatureId: purged.id } }))?.rule).toBe('CHILD_LEFT');
  });

  it('W16 (Decision 354): a Guardian-signed WaiverSignature is kept while the Student is still enrolled, and until 7 years after they leave', async () => {
    const guardian = await mkSigner('GuardianW16', new Date('1980-01-01'));
    const enrolled = await mkSigner('W16Enrolled', yearsAgo(30));
    const leftRecently = await mkSigner('W16LeftRecently', yearsAgo(30));
    const leftLongAgo = await mkSigner('W16LeftLongAgo', yearsAgo(30));
    await grant(enrolled.id, null);
    await grant(leftRecently.id, yearsAgo(2));
    await grant(leftLongAgo.id, yearsAgo(8));
    const kept1 = await mkWaiverAndSignature({ signedById: guardian.id, studentId: enrolled.id, signedDate: yearsAgo(15) });
    const kept2 = await mkWaiverAndSignature({ signedById: guardian.id, studentId: leftRecently.id, signedDate: yearsAgo(15) });
    const purged = await mkWaiverAndSignature({ signedById: guardian.id, studentId: leftLongAgo.id, signedDate: yearsAgo(15) });

    await processor.process(fakeJob());

    expect(await exists(kept1.id)).toBe(true);
    expect(await exists(kept2.id)).toBe(true);
    expect(await exists(purged.id)).toBe(false);
  });

  it('a paper signature follows the same rules (a child\'s when the Student was under 18 on the date signed)', async () => {
    const grownUp = await mkSigner('PaperMinorGrownUp', yearsAgo(26));
    const stillYoung = await mkSigner('PaperMinorStill24', yearsAgo(24, 30));
    const adultLeft = await mkSigner('PaperAdultLeft', yearsAgo(40));
    await grant(grownUp.id, yearsAgo(9));
    await grant(stillYoung.id, yearsAgo(9));
    await grant(adultLeft.id, yearsAgo(8));
    const minorPaper = await mkWaiverAndSignature({ signedById: null, method: 'PAPER', studentId: grownUp.id, signedDate: yearsAgo(10) });
    const youngPaper = await mkWaiverAndSignature({ signedById: null, method: 'PAPER', studentId: stillYoung.id, signedDate: yearsAgo(10) });
    const adultPaper = await mkWaiverAndSignature({ signedById: null, method: 'PAPER', studentId: adultLeft.id, signedDate: yearsAgo(12) });

    await processor.process(fakeJob());

    expect(await exists(minorPaper.id)).toBe(false);
    expect(await exists(youngPaper.id)).toBe(true);
    expect(await exists(adultPaper.id)).toBe(false);
  });

  it('never a member of that School: counts from the signing date', async () => {
    const guardian = await mkSigner('GuardianNever', new Date('1980-01-01'));
    const adultOld = await mkSigner('NeverMemberOld', new Date('1990-01-01'));
    const adultNew = await mkSigner('NeverMemberNew', new Date('1990-01-01'));
    const child = await mkSigner('NeverMemberChild', yearsAgo(20));
    const old = await mkWaiverAndSignature({ signedById: adultOld.id, studentId: adultOld.id, signedDate: yearsAgo(8) });
    const recent = await mkWaiverAndSignature({ signedById: adultNew.id, studentId: adultNew.id, signedDate: yearsAgo(1) });
    const childSig = await mkWaiverAndSignature({ signedById: guardian.id, studentId: child.id, signedDate: yearsAgo(8) });

    await processor.process(fakeJob());

    expect(await exists(old.id)).toBe(false);
    expect((await superuser.waiverSignaturePurgeLog.findFirst({ where: { signatureId: old.id } }))?.rule).toBe('ADULT_NEVER_MEMBER');
    expect(await exists(recent.id)).toBe(true);
    expect(await exists(childSig.id)).toBe(true); // 20 now: not before 25
  });

  it('a Guardian-signed waiver with no date of birth on file is kept — never guessed — and is filled once a date of birth is added', async () => {
    const guardian = await mkSigner('Guardian3', new Date('1980-01-01'));
    const minorNoDob = await mkSigner('MinorNoDob', null);
    await grant(minorNoDob.id, yearsAgo(30));
    const signature = await mkWaiverAndSignature({ signedById: guardian.id, studentId: minorNoDob.id, signedDate: yearsAgo(31) });
    expect((await superuser.waiverSignature.findUniqueOrThrow({ where: { id: signature.id } })).studentMajorityDate).toBeNull();

    await processor.process(fakeJob());
    expect(await exists(signature.id)).toBe(true);

    // The owner adds the date of birth: the next run saves the 18th birthday
    // on the signature and applies the rule (a child at signing, 30+ now).
    await superuser.user.update({ where: { id: minorNoDob.id }, data: { dateOfBirth: yearsAgo(40) } });
    await processor.process(fakeJob());
    expect(await exists(signature.id)).toBe(false);
  });

  it('the 18th birthday is saved on the signature when it is signed, and a later date-of-birth change does not move it', async () => {
    const student = await mkSigner('MajoritySaved', new Date('2008-02-29'));
    const unsigned = await mkWaiverAndSignature({ signedById: null, studentId: student.id, status: 'UNSIGNED' });
    expect((await superuser.waiverSignature.findUniqueOrThrow({ where: { id: unsigned.id } })).studentMajorityDate).toBeNull();

    // Signing (any path: the trigger runs on the row) saves it; a leap-day
    // birthday reaches 18 on 1 March.
    await superuser.waiverSignature.update({ where: { id: unsigned.id }, data: { status: 'SIGNED', signedById: student.id, signedDate: new Date(), signerFullName: 'S', signatureText: 'S' } });
    expect((await superuser.waiverSignature.findUniqueOrThrow({ where: { id: unsigned.id } })).studentMajorityDate?.toISOString().slice(0, 10)).toBe('2026-03-01');

    await superuser.user.update({ where: { id: student.id }, data: { dateOfBirth: new Date('1990-01-01') } });
    await superuser.waiverSignature.update({ where: { id: unsigned.id }, data: { lastRemindedAt: new Date() } });
    await processor.process(fakeJob());
    expect((await superuser.waiverSignature.findUniqueOrThrow({ where: { id: unsigned.id } })).studentMajorityDate?.toISOString().slice(0, 10)).toBe('2026-03-01');
  });

  it('an unsigned or pending entry of someone who has left is deleted (with its image); a current member\'s is kept', async () => {
    const leaver = await mkSigner('UnsignedLeaver', new Date('1990-01-01'));
    const pendingLeaver = await mkSigner('PendingLeaver', new Date('1990-01-01'));
    const member = await mkSigner('UnsignedMember', new Date('1990-01-01'));
    await grant(leaver.id, yearsAgo(0, 1));
    await grant(pendingLeaver.id, yearsAgo(0, 1));
    await grant(member.id, null);
    const key = `${school.id}/paper-${randomUUID()}.png`;
    const gone = await mkWaiverAndSignature({ signedById: null, studentId: leaver.id, status: 'UNSIGNED', signatureImageKey: key });
    const gonePending = await mkWaiverAndSignature({ signedById: null, studentId: pendingLeaver.id, status: 'PENDING' });
    const kept = await mkWaiverAndSignature({ signedById: null, studentId: member.id, status: 'UNSIGNED' });

    await processor.process(fakeJob());

    expect(await exists(gone.id)).toBe(false);
    expect(await exists(gonePending.id)).toBe(false);
    expect(await exists(kept.id)).toBe(true);
    expect(r2.deleteObject).toHaveBeenCalledWith(key);
    expect((await superuser.waiverSignaturePurgeLog.findFirst({ where: { signatureId: gone.id } }))).toMatchObject({ rule: 'LEFT_UNSIGNED', retainUntil: null });
  });

  it('cross-tenant: left School A 8 years ago, active at School B — A\'s is purged, B\'s kept, and B\'s role never protects A\'s row', async () => {
    const schoolB = await mkSchool('B');
    const person = await mkSigner('TwoSchools', new Date('1990-01-01'));
    await grant(person.id, yearsAgo(8)); // School A (the shared fixture School)
    await grant(person.id, null, schoolB.id);
    const atA = await mkWaiverAndSignature({ signedById: person.id, studentId: person.id, signedDate: yearsAgo(12) });
    const atB = await mkWaiverAndSignature({ signedById: person.id, studentId: person.id, signedDate: yearsAgo(12), schoolId: schoolB.id });

    await processor.process(fakeJob());

    expect(await exists(atA.id)).toBe(false);
    expect(await exists(atB.id)).toBe(true);
    expect((await superuser.waiverSignaturePurgeLog.findFirst({ where: { signatureId: atA.id } }))?.schoolId).toBe(school.id);
  });

  it('a closed School counts as every member leaving on the day it closed', async () => {
    const closedLongAgo = await mkSchool('ClosedLongAgo', { archivedAt: yearsAgo(8), purgeAt: yearsAgo(8), purgedAt: yearsAgo(7, 300) });
    const closedRecently = await mkSchool('ClosedRecently', { archivedAt: yearsAgo(1), purgeAt: yearsAgo(1), purgedAt: yearsAgo(0, 270) });
    const closingNow = await mkSchool('ClosingNow', { archivedAt: yearsAgo(0, 10), purgeAt: new Date(Date.now() + 80 * 24 * 3600 * 1000) });
    const a = await mkSigner('ClosedMemberA', new Date('1990-01-01'));
    const b = await mkSigner('ClosedMemberB', new Date('1990-01-01'));
    const c = await mkSigner('ClosedMemberC', new Date('1990-01-01'));
    await grant(a.id, null, closedLongAgo.id);
    await grant(b.id, null, closedRecently.id);
    await grant(c.id, null, closingNow.id);
    const signedA = await mkWaiverAndSignature({ signedById: a.id, studentId: a.id, signedDate: yearsAgo(10), schoolId: closedLongAgo.id });
    const signedB = await mkWaiverAndSignature({ signedById: b.id, studentId: b.id, signedDate: yearsAgo(10), schoolId: closedRecently.id });
    const unsignedB = await mkWaiverAndSignature({ signedById: null, studentId: b.id, status: 'UNSIGNED', schoolId: closedRecently.id });
    const unsignedC = await mkWaiverAndSignature({ signedById: null, studentId: c.id, status: 'UNSIGNED', schoolId: closingNow.id });

    await processor.process(fakeJob());

    expect(await exists(signedA.id)).toBe(false); // closed 8 years ago
    expect(await exists(signedB.id)).toBe(true); // closed 1 year ago
    expect(await exists(unsignedB.id)).toBe(false); // closure final: an unsigned entry goes
    expect(await exists(unsignedC.id)).toBe(true); // can still be reopened: kept
  });

  it('a signature left on a merged-away duplicate is kept while the kept record is a member, and follows the kept record\'s leaving', async () => {
    const kept = await mkSigner('MergeKept', new Date('1990-01-01'));
    const dup = await mkSigner('MergeDuplicate', new Date('1990-01-01'));
    const keptLeft = await mkSigner('MergeKeptLeft', new Date('1990-01-01'));
    const dup2 = await mkSigner('MergeDuplicate2', new Date('1990-01-01'));
    await grant(dup.id, yearsAgo(10)); // revoked at the merge
    await grant(kept.id, null);
    await grant(dup2.id, yearsAgo(10));
    await grant(keptLeft.id, yearsAgo(8));
    const onDup = await mkWaiverAndSignature({ signedById: dup.id, studentId: dup.id, signedDate: yearsAgo(12), mergedIntoStudentId: kept.id });
    const onDup2 = await mkWaiverAndSignature({ signedById: dup2.id, studentId: dup2.id, signedDate: yearsAgo(12), mergedIntoStudentId: keptLeft.id });

    await processor.process(fakeJob());

    expect(await exists(onDup.id)).toBe(true);
    expect(await exists(onDup2.id)).toBe(false);
  });

  it('an expired signature follows the same rules as a signed one', async () => {
    const left = await mkSigner('ExpiredLeft', new Date('1990-01-01'));
    const member = await mkSigner('ExpiredMember', new Date('1990-01-01'));
    await grant(left.id, yearsAgo(8));
    await grant(member.id, null);
    const purged = await mkWaiverAndSignature({ signedById: left.id, studentId: left.id, signedDate: yearsAgo(12), status: 'EXPIRED' });
    const kept = await mkWaiverAndSignature({ signedById: member.id, studentId: member.id, signedDate: yearsAgo(12), status: 'EXPIRED' });

    await processor.process(fakeJob());

    expect(await exists(purged.id)).toBe(false);
    expect(await exists(kept.id)).toBe(true);
  });

  it('works through more than one batch of 500 rows, logging each deletion once', async () => {
    const student = await mkSigner('Batch', new Date('1990-01-01'));
    await grant(student.id, yearsAgo(8));
    const waiver = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: school.id, title: `Batch ${randomUUID()}`, body: 'Terms.' } });
    waiverIds.push(waiver.id);
    // Expired rows: the one-live-signature index doesn't apply, so one
    // person and one waiver can hold them all.
    const ids = Array.from({ length: WAIVER_RETENTION_BATCH_SIZE * 2 + 37 }, () => randomUUID());
    await superuser.waiverSignature.createMany({
      data: ids.map((id) => ({ id, waiverId: waiver.id, studentId: student.id, signedById: student.id, schoolId: school.id, signerFullName: 'B', signatureText: 'B', signedDate: yearsAgo(12), status: 'EXPIRED' as const })),
    });

    await processor.process(fakeJob());

    expect(await superuser.waiverSignature.count({ where: { id: { in: ids } } })).toBe(0);
    expect(await superuser.waiverSignaturePurgeLog.count({ where: { signatureId: { in: ids } } })).toBe(ids.length);
  });

  it('the database refuses to delete a User or Waiver that still has a signature (ON DELETE RESTRICT)', async () => {
    const student = await mkSigner('Restrict', new Date('1990-01-01'));
    await grant(student.id, null);
    // On paper, so no signedById: only studentId and waiverId point at the two rows.
    const signature = await mkWaiverAndSignature({ signedById: null, method: 'PAPER', studentId: student.id });

    await expect(superuser.user.delete({ where: { id: student.id } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(superuser.waiver.delete({ where: { id: signature.waiverId } })).rejects.toMatchObject({ code: 'P2003' });
    expect(await exists(signature.id)).toBe(true);
  });

  it('the purge log: the jobs role may only add to it; the app role has no access at all', async () => {
    const asRole = (role: string, sql: string) =>
      superuser.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        return tx.$executeRawUnsafe(sql);
      });
    const insert = `INSERT INTO "WaiverSignaturePurgeLog" ("id", "kind", "schoolId", "signatureId", "waiverId", "rule") VALUES ('${randomUUID()}', 'MEMBER', '${school.id}', 'x', 'y', 'ADULT_LEFT')`;
    await expect(asRole('ultm8_app', 'SELECT 1 FROM "WaiverSignaturePurgeLog" LIMIT 1')).rejects.toThrow(/permission denied/);
    await expect(asRole('ultm8_app', insert)).rejects.toThrow(/permission denied/);
    await expect(asRole('ultm8_jobs', 'SELECT 1 FROM "WaiverSignaturePurgeLog" LIMIT 1')).rejects.toThrow(/permission denied/);
    await expect(asRole('ultm8_jobs', 'DELETE FROM "WaiverSignaturePurgeLog"')).rejects.toThrow(/permission denied/);
    await expect(asRole('ultm8_jobs', 'UPDATE "WaiverSignaturePurgeLog" SET "rule" = \'CHILD_LEFT\'')).rejects.toThrow(/permission denied/);
    await expect(asRole('ultm8_jobs', insert)).resolves.toBe(1);
  });
});
