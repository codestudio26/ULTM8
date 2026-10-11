/**
 * Grading engine, roadmap Phase 2b: attendance counted toward the next rung
 * through the engine (Decisions 140, 149, 170, 171, 172). Every check-in here
 * goes through the real Instructor roll-call endpoint (manual mode), so the
 * counting runs inside the real check-in transaction and tenant context.
 *
 * Requires the same environment as attendance.e2e-spec.ts.
 */
import { DateTime } from 'luxon';
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
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET && process.env.QR_CLASS_TOKEN_SECRET && process.env.QR_STUDENT_TOKEN_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[grading-attendance.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

// 2026-09-07 is a Monday. The School is in Australia/Sydney (UTC+10 in
// September), so 10:00 UTC is 20:00 the same local day.
const at = (day: string, hourUtc = 10) => new Date(`${day}T${String(hourUtc).padStart(2, '0')}:00:00Z`);
const COUNTING_SINCE = new Date('2026-09-01T00:00:00Z');

describeIfDb('Grading — attendance counted through the engine (Phase 2b)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let student: { id: string };
  let instructor: { id: string; email: string };
  let owner: { id: string; email: string };
  let tokenInstructor: string;
  let tokenOwner: string;
  let membershipId: string;
  let bjj: { id: string };
  let judo: { id: string };
  let tier0: { id: string };
  let tier1: { id: string };
  let timeOnlyTier: { id: string };
  let judoTier0: { id: string };
  const userIds: string[] = [];

  async function setNextRung(data: {
    eligibleClassTypes?: string[];
    weeklyClassCountCap?: number | null;
    classCountMode?: 'ANY_TYPE' | 'EACH_TYPE';
    classTypeRequirements?: Array<{ classType: string; classesRequired: number }>;
  }) {
    await superuser.rankStripeTier.update({
      where: { id: tier1.id },
      data: { eligibleClassTypes: [], weeklyClassCountCap: null, classCountMode: 'ANY_TYPE', classTypeRequirements: [], ...data },
    });
  }

  /** Clean slate: no bookings, the student back on the first rung, nothing counted. */
  async function reset(currentStripeId = tier0.id) {
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.updateMany({
      where: { studentId: student.id },
      data: { classesAttendedTowardCheckpoint: 0, classesAttendedByType: {}, countingSince: COUNTING_SINCE },
    });
    await superuser.studentRank.update({
      where: { studentId_disciplineId: { studentId: student.id, disciplineId: bjj.id } },
      data: { currentStripeId, currentRankId: (await superuser.rankStripeTier.findUniqueOrThrow({ where: { id: currentStripeId } })).rankId },
    });
  }

  /** Books the student into a class and checks them in through the Instructor roll call. */
  async function attend(startDate: Date, styles: Array<{ disciplineId: string; classType: string | null }>, branchId?: string) {
    const cls = await superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        branchId,
        title: 'Counted Class',
        activities: ['BJJ'],
        styles,
        startDate,
        endDate: new Date(startDate.getTime() + 3_600_000),
        qrAttendanceEndAt: new Date(Date.now() + 86_400_000),
      },
    });
    await superuser.booking.create({
      data: { id: randomUUID(), studentId: student.id, classId: cls.id, schoolId: school.id, sourceMembershipId: membershipId, status: 'UPCOMING' },
    });
    const res = await request(app.getHttpServer())
      .post(`/v1/classes/${cls.id}/attendance-scan`)
      .set('Authorization', `Bearer ${tokenInstructor}`)
      .send({ studentId: student.id });
    expect(res.status).toBe(201);
  }

  const bjjClass = (classType: string | null) => [{ disciplineId: bjj.id, classType }];

  async function counted(disciplineId = bjj.id) {
    const sr = await superuser.studentRank.findUniqueOrThrow({ where: { studentId_disciplineId: { studentId: student.id, disciplineId } } });
    return { total: sr.classesAttendedTowardCheckpoint, byType: sr.classesAttendedByType, countingSince: sr.countingSince };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Grading Attendance School', timezone: 'Australia/Sydney', ranksToggle: true } });
    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `grading-attendance-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });
    student = await mkUser('student');
    instructor = await mkUser('instructor');
    owner = await mkUser('owner');
    userIds.push(student.id, instructor.id, owner.id);
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: instructor.id, schoolId: school.id },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
      ],
    });
    tokenInstructor = jwt.sign({ sub: instructor.id, email: instructor.email, grants: [{ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: null }] });
    tokenOwner = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });

    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
    const membership = await superuser.membership.create({
      data: { id: randomUUID(), studentId: student.id, membershipPlanId: plan.id, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null },
    });
    membershipId = membership.id;

    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: ['Fundamentals', 'Sparring'] } });
    const white = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order: 0, name: 'White Belt', primaryColour: '#FFFFFF' } });
    const tier = (rankId: string, order: number, extra: object = {}) =>
      superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId, schoolId: school.id, order, count: order, colour: '#000000', name: `Rung ${order}`, ...extra } });
    tier0 = await tier(white.id, 0);
    tier1 = await tier(white.id, 1, { classesRequired: 30 });
    const black = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order: 1, name: 'Black Belt', primaryColour: '#000000' } });
    timeOnlyTier = await tier(black.id, 0, { timeOnly: true, minimumDaysInRank: 1095 });
    await tier(black.id, 1, { timeOnly: true, minimumDaysInRank: 1095 });

    judo = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Judo' } });
    const judoWhite = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: judo.id, schoolId: school.id, order: 0, name: 'Judo White', primaryColour: '#FFFFFF' } });
    judoTier0 = await tier(judoWhite.id, 0);
    await tier(judoWhite.id, 1, { classesRequired: 10 });

    for (const [disciplineId, rankId, stripeId] of [
      [bjj.id, white.id, tier0.id],
      [judo.id, judoWhite.id, judoTier0.id],
    ]) {
      await superuser.studentRank.create({
        data: { id: randomUUID(), studentId: student.id, disciplineId, schoolId: school.id, currentRankId: rankId, currentStripeId: stripeId },
      });
    }
  });

  afterAll(async () => {
    await superuser.booking.deleteMany({ where: { schoolId: school.id } });
    await superuser.membership.deleteMany({ where: { schoolId: school.id } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: school.id } });
    await superuser.promotionEvent.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentRank.deleteMany({ where: { schoolId: school.id } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: school.id } });
    await superuser.rank.deleteMany({ where: { schoolId: school.id } });
    await superuser.discipline.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    // FOUND ON REVIEW: a real check-in here can free a waitlisted seat, which
    // fans out a real Notification row via NOTIFICATION_FANOUT_QUEUE's live
    // worker — racy (depends on whether that worker has written it yet),
    // which is why this wasn't always caught. Same lookup-then-delete-
    // Notification-first convention waivers.e2e-spec.ts and ranks.e2e-spec.ts
    // already established for their own queue-triggered notifications.
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('only class types ticked on the next rung count, and the per-type tally follows (Decision 140)', async () => {
    await reset();
    await setNextRung({ eligibleClassTypes: ['Fundamentals'] });
    await attend(at('2026-09-07'), bjjClass('Sparring'));
    expect(await counted()).toMatchObject({ total: 0, byType: {} });
    await attend(at('2026-09-08'), bjjClass('Fundamentals'));
    expect(await counted()).toMatchObject({ total: 1, byType: { Fundamentals: 1 } });
  });

  it('nothing ticked: every class counts, including one with no class type (Decision 171)', async () => {
    await reset();
    await setNextRung({});
    await attend(at('2026-09-07'), bjjClass('Sparring'));
    await attend(at('2026-09-08'), bjjClass(null));
    expect(await counted()).toMatchObject({ total: 2, byType: { Sparring: 1 } });
  });

  it('weekly cap: Monday–Sunday weeks, extras ignored, a new week counts again (Decision 171)', async () => {
    await reset();
    await setNextRung({ weeklyClassCountCap: 2 });
    await attend(at('2026-09-07'), bjjClass('Fundamentals'));
    await attend(at('2026-09-09'), bjjClass('Fundamentals'));
    await attend(at('2026-09-13'), bjjClass('Fundamentals')); // Sunday, same week: the extra
    expect((await counted()).total).toBe(2);
    await attend(at('2026-09-14'), bjjClass('Fundamentals')); // next Monday
    expect((await counted()).total).toBe(3);
  });

  it('the week is the School\'s local week, not UTC\'s (Decision 172)', async () => {
    await reset();
    await setNextRung({ weeklyClassCountCap: 1 });
    await attend(at('2026-09-07'), bjjClass('Fundamentals'));
    // Sunday 15:00 UTC is Monday 01:00 in Sydney: a new local week, so it counts.
    await attend(at('2026-09-13', 15), bjjClass('Fundamentals'));
    expect((await counted()).total).toBe(2);
  });

  it('a class checked in late for an earlier day takes its place under the cap; the total never passes the cap', async () => {
    await reset();
    await setNextRung({
      eligibleClassTypes: ['Fundamentals', 'Sparring'],
      classCountMode: 'EACH_TYPE',
      classTypeRequirements: [
        { classType: 'Fundamentals', classesRequired: 20 },
        { classType: 'Sparring', classesRequired: 10 },
      ],
      weeklyClassCountCap: 2,
    });
    await attend(at('2026-09-08'), bjjClass('Fundamentals'));
    await attend(at('2026-09-09'), bjjClass('Fundamentals'));
    expect(await counted()).toMatchObject({ total: 2, byType: { Fundamentals: 2 } });
    // Monday's Sparring class, checked in afterwards: the first two of the week
    // are now Monday's Sparring and Tuesday's Fundamentals.
    await attend(at('2026-09-07'), bjjClass('Sparring'));
    expect(await counted()).toMatchObject({ total: 2, byType: { Fundamentals: 1, Sparring: 1 } });
  });

  it('the cap only looks at classes since counting toward the current rung began', async () => {
    await reset();
    await setNextRung({ weeklyClassCountCap: 1 });
    await attend(at('2026-09-07'), bjjClass('Fundamentals'));
    // A rank change on Tuesday restarts counting toward a new rung.
    await superuser.studentRank.update({
      where: { studentId_disciplineId: { studentId: student.id, disciplineId: bjj.id } },
      data: { classesAttendedTowardCheckpoint: 0, classesAttendedByType: {}, countingSince: at('2026-09-08') },
    });
    await attend(at('2026-09-09'), bjjClass('Fundamentals'));
    expect((await counted()).total).toBe(1);
  });

  it('a class listing two styles counts once toward each (Decision 170)', async () => {
    await reset();
    await setNextRung({});
    await attend(at('2026-09-07'), [
      { disciplineId: bjj.id, classType: 'Sparring' },
      { disciplineId: judo.id, classType: null },
    ]);
    expect((await counted(bjj.id)).total).toBe(1);
    expect((await counted(judo.id)).total).toBe(1);
  });

  it('a class with no styles counts toward nothing (the free-text name bridge is gone)', async () => {
    await reset();
    await setNextRung({});
    await attend(at('2026-09-07'), []);
    expect((await counted()).total).toBe(0);
  });

  it('a time-only current rung counts no classes (Decision 128, item 3)', async () => {
    await reset(timeOnlyTier.id);
    await attend(at('2026-09-07'), bjjClass('Fundamentals'));
    expect((await counted()).total).toBe(0);
  });

  it('a stripe award restarts counting: the tally empties and countingSince moves to now', async () => {
    await reset();
    await setNextRung({});
    await attend(at('2026-09-07'), bjjClass('Fundamentals'));
    expect((await counted()).total).toBe(1);
    const before = Date.now();
    const res = await request(app.getHttpServer())
      .post(`/v1/students/${student.id}/ranks/${bjj.id}/stripe-award`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({});
    expect(res.status).toBe(201);
    const after = await counted();
    expect(after).toMatchObject({ total: 0, byType: {} });
    expect(after.countingSince.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('a class at another branch counts like any other when the student could book it (Decision 148.1)', async () => {
    const home = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Downtown' } });
    const away = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Riverside' } });
    await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: student.id, branchId: home.id } });
    try {
      await reset();
      await setNextRung({ eligibleClassTypes: [] });
      await attend(at('2026-09-07'), bjjClass('Sparring'), home.id);
      await attend(at('2026-09-08'), bjjClass('Sparring'), away.id);
      expect((await counted()).total).toBe(2);
    } finally {
      await superuser.booking.deleteMany({ where: { schoolId: school.id } });
      await superuser.class.deleteMany({ where: { schoolId: school.id } });
      await superuser.studentHomeBranch.deleteMany({ where: { schoolId: school.id } });
      await superuser.branch.deleteMany({ where: { schoolId: school.id } });
    }
  });

  describe('readiness from the engine — GET /students/{id}/eligibility (Phase 2c)', () => {
    async function eligibility() {
      const res = await request(app.getHttpServer())
        .get(`/v1/students/${student.id}/eligibility?schoolId=${school.id}`)
        .set('Authorization', `Bearer ${tokenOwner}`);
      expect(res.status).toBe(200);
      return res.body.items.find((i: { disciplineId: string }) => i.disciplineId === bjj.id).eligibility;
    }
    async function setCounts(total: number, byType: Record<string, number> = {}, daysAgo = 400) {
      await superuser.studentRank.update({
        where: { studentId_disciplineId: { studentId: student.id, disciplineId: bjj.id } },
        // `daysAgo` calendar days in the School's own time zone, at local noon:
        // a fixed 24 h × N drifts a day across a DST change (Sydney, 4 Oct).
        data: {
          classesAttendedTowardCheckpoint: total,
          classesAttendedByType: byType,
          dateOfCurrentRank: DateTime.now().setZone('Australia/Sydney').startOf('day').minus({ days: daysAgo }).plus({ hours: 12 }).toJSDate(),
        },
      });
    }

    it('progress and board column follow the next rung\'s classes (22/30 = 73%, then 30/30 ready)', async () => {
      await reset();
      await setNextRung({});
      await superuser.rankStripeTier.update({ where: { id: tier1.id }, data: { classesRequired: 30, minimumDaysInRank: 0 } });
      await setCounts(22);
      expect(await eligibility()).toMatchObject({
        hasNext: true, nextRungId: tier1.id, requiredClasses: 30, countedClasses: 22, progressPercent: 73, boardColumn: 'READY_TO_GRADE', classesOk: false, eligible: false,
      });
      await setCounts(9);
      expect(await eligibility()).toMatchObject({ progressPercent: 30, boardColumn: 'JUST_STARTING' });
      await setCounts(30);
      expect(await eligibility()).toMatchObject({ progressPercent: 100, classesOk: true, eligible: true });
    });

    it('"each type required": combined progress, each type capped at its own number (Decision 171)', async () => {
      await reset();
      await setNextRung({
        eligibleClassTypes: ['Fundamentals', 'Sparring'],
        classCountMode: 'EACH_TYPE',
        classTypeRequirements: [
          { classType: 'Fundamentals', classesRequired: 20 },
          { classType: 'Sparring', classesRequired: 10 },
        ],
      });
      await setCounts(22, { Fundamentals: 18, Sparring: 4 });
      expect(await eligibility()).toMatchObject({
        requiredClasses: 30,
        progressPercent: 73,
        classesOk: false,
        byType: [
          { classType: 'Fundamentals', required: 20, counted: 18 },
          { classType: 'Sparring', required: 10, counted: 4 },
        ],
      });
    });

    it('minimum days are a gate but not part of the %', async () => {
      await reset();
      await setNextRung({});
      await superuser.rankStripeTier.update({ where: { id: tier1.id }, data: { classesRequired: 30, minimumDaysInRank: 60 } });
      await setCounts(30, {}, 10);
      expect(await eligibility()).toMatchObject({ progressPercent: 100, requiredDays: 60, elapsedDays: 10, daysOk: false, eligible: false });
    });

    it('a required skill not signed off blocks eligibility and is listed', async () => {
      await reset();
      await setNextRung({});
      await superuser.rankStripeTier.update({ where: { id: tier1.id }, data: { classesRequired: 0, minimumDaysInRank: 0 } });
      const skill = await superuser.skill.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, name: 'Armbar' } });
      await superuser.rankStripeTierRequiredSkill.create({ data: { stripeTierId: tier1.id, skillId: skill.id } });
      try {
        expect(await eligibility()).toMatchObject({ skillsOk: false, missingSkillIds: [skill.id], eligible: false });
      } finally {
        await superuser.rankStripeTierRequiredSkill.deleteMany({ where: { skillId: skill.id } });
        await superuser.skill.delete({ where: { id: skill.id } });
      }
    });

    it('a time-only current rung: days only, no classes', async () => {
      await reset(timeOnlyTier.id);
      await setCounts(0, {}, 400);
      expect(await eligibility()).toMatchObject({ hasNext: true, timeOnly: true, requiredDays: 1095, requiredClasses: 0, progressPercent: 37, eligible: false });
    });
  });
});
