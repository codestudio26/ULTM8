/**
 * Automatic grading (Decision 321; handover B12): requirement tick boxes per
 * style, hours / days attended / minimum age, the averaged progress %,
 * automatic promotion (stripes only or all ranks) that waits for a fee, the
 * coach's undo, and the first belt on the first check-in. Real HTTP, real
 * check-in endpoint, real tenant context. The automatic promotion itself is
 * GradingService.autoPromote(), called here directly (the grading job calls
 * the same method after each check-in and in its daily sweep).
 *
 * Requires the same environment as attendance.e2e-spec.ts.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { GradingService } from '../src/ranks/grading.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET && process.env.QR_CLASS_TOKEN_SECRET && process.env.QR_STUDENT_TOKEN_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[grading-automatic.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const DAY = 86_400_000;
const MIN = 60_000;

describeIfDb('Automatic grading (Decision 321)', () => {
  let app: INestApplication;
  let grading: GradingService;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const http = () => request(app.getHttpServer());

  let school: { id: string };
  let otherSchool: { id: string };
  let membershipId: string;
  let bjj: { id: string };
  let judo: { id: string };
  const rung: Record<string, { id: string; rankId: string }> = {};
  const user: Record<string, { id: string }> = {};
  const token: Record<string, string> = {};
  const userIds: string[] = [];

  const sign = (id: string, role: string, schoolId: string) =>
    jwt.sign({ sub: id, email: `${id}@example.test`, grants: [{ role, franchiseId: null, schoolId, branchId: null }] });

  async function mkUser(label: string, dateOfBirth = new Date('2000-01-01')) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `auto-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Auto',
        passcodeHash: 'x',
        dateOfBirth,
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    user[label] = u;
    return u;
  }

  async function checkIn(studentId: string, start: Date, styles: Array<{ disciplineId: string; classType: string | null }>) {
    const cls = await superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: school.id,
        title: 'Auto Class',
        activities: ['BJJ'],
        styles,
        startDate: start,
        endDate: new Date(start.getTime() + 60 * MIN),
        qrAttendanceEndAt: new Date(Date.now() + DAY),
      },
    });
    await superuser.booking.create({
      data: { id: randomUUID(), studentId, classId: cls.id, schoolId: school.id, sourceMembershipId: membershipId, status: 'UPCOMING' },
    });
    const res = await http().post(`/v1/classes/${cls.id}/attendance-scan`).set('Authorization', `Bearer ${token.coach}`).send({ studentId });
    expect(res.status).toBe(201);
  }

  const settings = (who: string, disciplineId: string, body: Record<string, unknown>) =>
    http()
      .put(`/v1/disciplines/${disciplineId}/grading-requirements`)
      .set('Authorization', `Bearer ${token[who]}`)
      .send({
        requireClasses: true,
        requireDaysInRank: true,
        requireSkills: true,
        requireHours: false,
        requireDaysAttended: false,
        requireMinimumAge: false,
        promotionMode: 'MANUAL',
        autoAssignFirstRank: false,
        ...body,
      });

  const styleRow = async (studentId: string, disciplineId: string) => {
    const res = await http().get(`/v1/students/${studentId}/eligibility?schoolId=${school.id}`).set('Authorization', `Bearer ${token.owner}`);
    expect(res.status).toBe(200);
    return (res.body.items as Array<Record<string, any>>).find((i) => i.disciplineId === disciplineId)!;
  };

  /** Puts ana on a rung with a fresh history and nothing counted. */
  async function placeAna(rungKey: string, opts: { classes?: number; rankDate?: Date } = {}) {
    await superuser.promotionFeeRequest.deleteMany({ where: { schoolId: school.id } });
    await superuser.trainingLog.deleteMany({ where: { schoolId: school.id } });
    await superuser.promotionEvent.deleteMany({ where: { schoolId: school.id, studentId: user.ana.id } });
    await superuser.studentRank.updateMany({
      where: { studentId: user.ana.id, disciplineId: bjj.id },
      data: {
        currentRankId: rung[rungKey].rankId,
        currentStripeId: rung[rungKey].id,
        classesAttendedTowardCheckpoint: opts.classes ?? 0,
        classesAttendedByType: {},
        dateOfCurrentRank: opts.rankDate ?? new Date(Date.now() - 400 * DAY),
        countingSince: opts.rankDate ?? new Date(Date.now() - 400 * DAY),
        readyNotifiedAt: null,
      },
    });
  }

  const anaRung = async () => (await superuser.studentRank.findUniqueOrThrow({ where: { studentId_disciplineId: { studentId: user.ana.id, disciplineId: bjj.id } } })).currentStripeId;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    grading = app.get(GradingService);

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Automatic Grading School', timezone: 'UTC', ranksToggle: true, defaultCurrency: 'GBP' } });
    otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Automatic Grading Other School', timezone: 'UTC', ranksToggle: true } });

    await mkUser('ana');
    await mkUser('kid', new Date(Date.now() - 10 * 365.25 * DAY));
    await mkUser('newbie');
    await mkUser('owner');
    await mkUser('coach'); // INSTRUCTOR who may promote in BJJ
    await mkUser('noPromote'); // INSTRUCTOR who may only sign off skills
    await mkUser('otherOwner');
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'STUDENT', userId: user.ana.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: user.kid.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: user.newbie.id, schoolId: school.id },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: user.owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: user.coach.id, schoolId: school.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: user.noPromote.id, schoolId: school.id },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: user.otherOwner.id, schoolId: otherSchool.id },
      ],
    });
    for (const k of ['ana', 'kid', 'newbie']) token[k] = sign(user[k].id, 'STUDENT', school.id);
    token.owner = sign(user.owner.id, 'SCHOOL_OWNER_MANAGER', school.id);
    token.coach = sign(user.coach.id, 'INSTRUCTOR', school.id);
    token.noPromote = sign(user.noPromote.id, 'INSTRUCTOR', school.id);
    token.otherOwner = sign(user.otherOwner.id, 'SCHOOL_OWNER_MANAGER', otherSchool.id);

    const plan = await superuser.membershipPlan.create({ data: { id: randomUUID(), schoolId: school.id, type: 'SUBSCRIPTION', title: 'Unlimited', price: 5000 } });
    for (const k of ['ana', 'kid', 'newbie']) {
      const m = await superuser.membership.create({
        data: { id: randomUUID(), studentId: user[k].id, membershipPlanId: plan.id, schoolId: school.id, status: 'ACTIVE', frequency: 'RECURRING', classesRemaining: null },
      });
      if (k === 'ana') membershipId = m.id;
    }

    // BJJ: White 0 -> White 1 (a stripe: 10 classes, 30 days, 2 hours, 3 days
    // attended) -> Blue 0 (a belt: 10 classes, minimum age 16).
    bjj = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'BJJ', classTypesOffered: ['Fundamentals'] } });
    const white = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order: 0, name: 'White', primaryColour: '#FFFFFF' } });
    const blue = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: bjj.id, schoolId: school.id, order: 1, name: 'Blue', primaryColour: '#0000FF' } });
    const tier = async (key: string, rankId: string, order: number, data: Record<string, unknown>) => {
      const t = await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId, schoolId: school.id, order, count: order, colour: '#000', name: key, ...data } });
      rung[key] = { id: t.id, rankId };
    };
    await tier('w0', white.id, 0, {});
    await tier('w1', white.id, 1, { classesRequired: 10, minimumDaysInRank: 30, hoursRequired: 2, daysAttendedRequired: 3 });
    await tier('b0', blue.id, 0, { classesRequired: 10, minimumAge: 16 });

    // Judo: no one holds a rank; its first rung is given on the first check-in when switched on.
    judo = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: school.id, name: 'Judo', classTypesOffered: [] } });
    const jw = await superuser.rank.create({ data: { id: randomUUID(), disciplineId: judo.id, schoolId: school.id, order: 0, name: 'Judo White', primaryColour: '#FFFFFF' } });
    const jw0 = await superuser.rankStripeTier.create({ data: { id: randomUUID(), rankId: jw.id, schoolId: school.id, order: 0, count: 0, colour: '#000', name: 'Judo White 0' } });
    rung.jw0 = { id: jw0.id, rankId: jw.id };

    await superuser.studentRank.createMany({
      data: [
        { id: randomUUID(), studentId: user.ana.id, disciplineId: bjj.id, schoolId: school.id, currentRankId: white.id, currentStripeId: rung.w0.id },
        { id: randomUUID(), studentId: user.kid.id, disciplineId: bjj.id, schoolId: school.id, currentRankId: white.id, currentStripeId: rung.w1.id, dateOfCurrentRank: new Date(Date.now() - 400 * DAY), classesAttendedTowardCheckpoint: 50 },
      ],
    });
    await superuser.gradingPermission.createMany({
      data: [
        { id: randomUUID(), schoolId: school.id, userId: user.coach.id, disciplineId: bjj.id },
        { id: randomUUID(), schoolId: school.id, userId: user.noPromote.id, disciplineId: bjj.id, canPromote: false },
      ],
    });
  });

  afterAll(async () => {
    const ids = { in: [school.id, otherSchool.id] };
    await superuser.promotionFeeRequest.deleteMany({ where: { schoolId: ids } });
    await superuser.trainingLog.deleteMany({ where: { schoolId: ids } });
    await superuser.booking.deleteMany({ where: { schoolId: ids } });
    await superuser.membership.deleteMany({ where: { schoolId: ids } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: ids } });
    await superuser.promotionEvent.deleteMany({ where: { schoolId: ids } });
    await superuser.studentRankSkillStatus.deleteMany({ where: { schoolId: ids } });
    await superuser.studentRank.deleteMany({ where: { schoolId: ids } });
    await superuser.gradingPermission.deleteMany({ where: { schoolId: ids } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: ids } });
    await superuser.rank.deleteMany({ where: { schoolId: ids } });
    await superuser.class.deleteMany({ where: { schoolId: ids } });
    await superuser.discipline.deleteMany({ where: { schoolId: ids } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: ids } });
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: ids } });
    await superuser.$disconnect();
    await app.close();
  });

  describe('the settings (owner only)', () => {
    it('the owner sets the tick boxes, the promotion mode and the first-belt switch; the defaults are what every style did before', async () => {
      const before = await superuser.discipline.findUniqueOrThrow({ where: { id: bjj.id } });
      expect([before.requireClasses, before.requireDaysInRank, before.requireSkills, before.requireHours, before.requireDaysAttended, before.requireMinimumAge]).toEqual([
        true, true, true, false, false, false,
      ]);
      expect([before.promotionMode, before.autoAssignFirstRank]).toEqual(['MANUAL', false]);
      const res = await settings('owner', bjj.id, { requireHours: true, promotionMode: 'AUTO_STRIPES' });
      expect(res.status).toBe(200);
      expect([res.body.requireHours, res.body.promotionMode]).toEqual([true, 'AUTO_STRIPES']);
      await settings('owner', bjj.id, {});
    });

    it('a coach, even one who may grade, may not; nor another School\'s owner', async () => {
      expect((await settings('coach', bjj.id, { promotionMode: 'AUTO_ALL' })).status).toBe(403);
      expect([403, 404]).toContain((await settings('otherOwner', bjj.id, { promotionMode: 'AUTO_ALL' })).status);
      expect((await superuser.discipline.findUniqueOrThrow({ where: { id: bjj.id } })).promotionMode).toBe('MANUAL');
    });
  });

  describe('ticked requirements and the averaged %', () => {
    it('hours and days attended count only when ticked; two classes on one day are one day', async () => {
      await placeAna('w0', { classes: 10 });
      const day1 = new Date(Date.now() - 3 * DAY);
      await checkIn(user.ana.id, day1, [{ disciplineId: bjj.id, classType: 'Fundamentals' }]);
      await checkIn(user.ana.id, new Date(day1.getTime() + 2 * 3600_000), [{ disciplineId: bjj.id, classType: 'Fundamentals' }]);

      // Defaults: classes and days only (no skills on this rung): 12/10 and 400/30 days.
      let row = await styleRow(user.ana.id, bjj.id);
      expect(row.eligibility.requiredHours).toBe(0);
      expect(row.eligibility.progressPercent).toBe(100);
      expect(row.progressBreakdown.hours).toBeNull();

      await settings('owner', bjj.id, { requireHours: true, requireDaysAttended: true });
      row = await styleRow(user.ana.id, bjj.id);
      // 2 hours of 2, 1 day of 3: (100 + 100 + 100 + 33) / 4 = 83.
      expect(row.eligibility.minutesTrained).toBe(120);
      expect(row.eligibility.daysAttended).toBe(1);
      expect(row.eligibility.eligible).toBe(false);
      expect(row.eligibility.progressPercent).toBe(83);
      expect(row.progressBreakdown.daysAttended).toEqual({ attended: 1, required: 3, percent: 33 });

      // Unticking Days attended stops checking it, though the rung still holds 3.
      await settings('owner', bjj.id, { requireHours: true });
      row = await styleRow(user.ana.id, bjj.id);
      expect([row.eligibility.eligible, row.eligibility.progressPercent, row.progressBreakdown.daysAttended]).toEqual([true, 100, null]);
      await settings('owner', bjj.id, {});
    });

    it('minimum age: a student at 100% who is too young waits, and can\'t be promoted by hand', async () => {
      await settings('owner', bjj.id, { requireMinimumAge: true });
      const row = await styleRow(user.kid.id, bjj.id);
      expect(row.eligibility.progressPercent).toBe(100);
      expect([row.eligibility.minimumAge, row.eligibility.ageOk, row.eligibility.eligible, row.eligibility.waitingForAge]).toEqual([16, false, false, 16]);
      const res = await http().post(`/v1/students/${user.kid.id}/ranks/${bjj.id}/promote`).set('Authorization', `Bearer ${token.coach}`).send({});
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/at least 16/);
      await settings('owner', bjj.id, {});
    });
  });

  describe('automatic promotion', () => {
    it('MANUAL never promotes', async () => {
      await placeAna('w0', { classes: 10 });
      expect(await grading.autoPromote(user.ana.id, bjj.id)).toBe('NOT_AUTOMATIC');
      expect(await anaRung()).toBe(rung.w0.id);
    });

    it('AUTO_STRIPES gives the stripe once every ticked requirement is met, as automatic with no performer, and tells the student', async () => {
      await settings('owner', bjj.id, { promotionMode: 'AUTO_STRIPES' });
      await placeAna('w0', { classes: 9 });
      expect(await grading.autoPromote(user.ana.id, bjj.id)).toBe('NOT_AUTOMATIC'); // 9 of 10 classes
      await placeAna('w0', { classes: 10 });
      expect(await grading.autoPromote(user.ana.id, bjj.id)).toBe('PROMOTED');
      expect(await anaRung()).toBe(rung.w1.id);
      const event = await superuser.promotionEvent.findFirstOrThrow({ where: { studentId: user.ana.id, toStripeTierId: rung.w1.id } });
      expect([event.automatic, event.performedById, event.type]).toEqual([true, null, 'STRIPE_AWARD']);
    });

    it('AUTO_STRIPES leaves belts to the coach; AUTO_ALL gives them too', async () => {
      await placeAna('w1', { classes: 10 });
      expect(await grading.autoPromote(user.ana.id, bjj.id)).toBe('NOT_AUTOMATIC');
      await settings('owner', bjj.id, { promotionMode: 'AUTO_ALL' });
      expect(await grading.autoPromote(user.ana.id, bjj.id)).toBe('PROMOTED');
      expect(await anaRung()).toBe(rung.b0.id);
    });

    it('never promotes someone too young for the next rank', async () => {
      await settings('owner', bjj.id, { promotionMode: 'AUTO_ALL', requireMinimumAge: true });
      expect(await grading.autoPromote(user.kid.id, bjj.id)).toBe('NOT_AUTOMATIC');
      await settings('owner', bjj.id, { promotionMode: 'AUTO_ALL' });
    });

    it('a priced rank waits for its fee, even with "grade before paid" on, and a cancelled fee never promotes', async () => {
      await superuser.school.update({ where: { id: school.id }, data: { promotionFeeEnabled: true, promotionFeeGradeBeforePaid: true } });
      await superuser.rankStripeTier.update({ where: { id: rung.w1.id }, data: { promotionFeeMinor: 2500 } });
      try {
        await placeAna('w0', { classes: 10 });
        expect(await grading.autoPromote(user.ana.id, bjj.id)).toBe('WAITING_FOR_FEE');
        expect(await anaRung()).toBe(rung.w0.id);
        const fee = await superuser.promotionFeeRequest.findFirstOrThrow({ where: { studentId: user.ana.id } });
        expect([fee.promotionWaits, fee.gradedById, (fee.pendingGrade as { automatic?: boolean }).automatic]).toEqual([true, null, true]);
        // A second check makes no second request.
        expect(await grading.autoPromote(user.ana.id, bjj.id)).toBe('NOT_AUTOMATIC');
        expect(await superuser.promotionFeeRequest.count({ where: { studentId: user.ana.id } })).toBe(1);

        // Waived: the waiting automatic promotion applies, still automatic.
        const waived = await http().post(`/v1/promotion-fee-requests/${fee.id}/waive`).set('Authorization', `Bearer ${token.owner}`).send({});
        expect([200, 201]).toContain(waived.status);
        expect(await anaRung()).toBe(rung.w1.id);
        const event = await superuser.promotionEvent.findFirstOrThrow({ where: { studentId: user.ana.id, toStripeTierId: rung.w1.id } });
        expect([event.automatic, event.performedById]).toEqual([true, null]);

        // Cancelled instead: nothing applies, and the step is not tried again.
        await placeAna('w0', { classes: 10 });
        expect(await grading.autoPromote(user.ana.id, bjj.id)).toBe('WAITING_FOR_FEE');
        const second = await superuser.promotionFeeRequest.findFirstOrThrow({ where: { studentId: user.ana.id } });
        const cancelled = await http().post(`/v1/promotion-fee-requests/${second.id}/cancel`).set('Authorization', `Bearer ${token.owner}`).send({});
        expect([200, 201]).toContain(cancelled.status);
        expect(await grading.autoPromote(user.ana.id, bjj.id)).toBe('NOT_AUTOMATIC');
        expect(await anaRung()).toBe(rung.w0.id);
      } finally {
        await superuser.rankStripeTier.update({ where: { id: rung.w1.id }, data: { promotionFeeMinor: null } });
        await superuser.school.update({ where: { id: school.id }, data: { promotionFeeEnabled: false, promotionFeeGradeBeforePaid: false } });
      }
    });

    it('a coach who may promote undoes it, recorded in the history; that step is not given automatically again', async () => {
      await placeAna('w0', { classes: 10 });
      expect(await grading.autoPromote(user.ana.id, bjj.id)).toBe('PROMOTED');
      const event = await superuser.promotionEvent.findFirstOrThrow({ where: { studentId: user.ana.id, toStripeTierId: rung.w1.id, automatic: true } });
      const undo = (who: string) =>
        http().post(`/v1/students/${user.ana.id}/rank-history/${event.id}/undo-automatic?schoolId=${school.id}`).set('Authorization', `Bearer ${token[who]}`).send({});
      expect((await undo('noPromote')).status).toBe(403);
      expect((await undo('otherOwner')).status).toBe(403);
      const res = await undo('coach');
      expect(res.status).toBe(201);
      expect(await anaRung()).toBe(rung.w0.id);
      const marked = await superuser.promotionEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect([marked.automaticUndoneById, marked.automaticUndoneAt !== null]).toEqual([user.coach.id, true]);
      const back = await superuser.promotionEvent.findFirstOrThrow({ where: { studentId: user.ana.id, type: 'DOWNGRADE' } });
      expect([back.systemNote, back.performedById]).toEqual(['Automatic promotion undone.', user.coach.id]);
      expect((await undo('coach')).status).toBe(409);

      await superuser.studentRank.updateMany({ where: { studentId: user.ana.id, disciplineId: bjj.id }, data: { classesAttendedTowardCheckpoint: 10, dateOfCurrentRank: new Date(Date.now() - 400 * DAY) } });
      expect(await grading.autoPromote(user.ana.id, bjj.id)).toBe('NOT_AUTOMATIC');
    });

    it('a step that asks for nothing is never given automatically', async () => {
      await superuser.rankStripeTier.update({ where: { id: rung.w1.id }, data: { classesRequired: null, minimumDaysInRank: null } });
      try {
        await placeAna('w0');
        expect(await grading.autoPromote(user.ana.id, bjj.id)).toBe('NOT_AUTOMATIC');
      } finally {
        await superuser.rankStripeTier.update({ where: { id: rung.w1.id }, data: { classesRequired: 10, minimumDaysInRank: 30 } });
        await settings('owner', bjj.id, {});
      }
    });
  });

  describe('auto-assign first belt', () => {
    it('off: a check-in gives no rank', async () => {
      await checkIn(user.newbie.id, new Date(Date.now() - DAY), [{ disciplineId: judo.id, classType: null }]);
      expect(await superuser.studentRank.count({ where: { studentId: user.newbie.id, disciplineId: judo.id } })).toBe(0);
    });

    it('on: the first check-in to a class of the style gives its first rung, verified, recorded as automatic', async () => {
      expect((await settings('owner', judo.id, { autoAssignFirstRank: true })).status).toBe(200);
      await checkIn(user.newbie.id, new Date(Date.now() - DAY / 2), [{ disciplineId: judo.id, classType: null }]);
      const sr = await superuser.studentRank.findUniqueOrThrow({ where: { studentId_disciplineId: { studentId: user.newbie.id, disciplineId: judo.id } } });
      expect([sr.currentStripeId, sr.verificationStatus, sr.classesAttendedTowardCheckpoint]).toEqual([rung.jw0.id, 'VERIFIED', 0]);
      const events = await superuser.promotionEvent.findMany({ where: { studentRankId: sr.id } });
      expect(events.map((e) => [e.type, e.automatic, e.performedById, e.fromStripeTierId])).toEqual([['PROMOTION', true, null, null]]);

      // A second check-in gives nothing more.
      await checkIn(user.newbie.id, new Date(Date.now() - DAY / 4), [{ disciplineId: judo.id, classType: null }]);
      expect(await superuser.promotionEvent.count({ where: { studentRankId: sr.id } })).toBe(1);
    });
  });
});
