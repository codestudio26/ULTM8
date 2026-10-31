/**
 * Reminders (Decision 317 item 7), over a real Postgres with the real jobs
 * and notification worker:
 * - the expiry reminder to the member 7 days before a membership ends (a
 *   child's Guardian gets "For {name}: …"), once per end date;
 * - the absence alert to the School's owners when a member hasn't checked in
 *   for the School's number of weeks, once per absence, never across Schools;
 * - the School setting (off by default).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MembershipPlanType, PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { MembershipExpiryReminderProcessor } from '../src/jobs/membership-expiry-reminder.processor';
import { StudentAbsenceAlertProcessor } from '../src/jobs/student-absence-alert.processor';

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;
/** Noon UTC today, so day arithmetic never crosses midnight mid-test. */
const NOW = new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00.000Z`);
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const day = (days: number) => at(days).toISOString().slice(0, 10);
const dateOnly = (days: number) => new Date(`${day(days)}T00:00:00.000Z`);

describeIfDb('Reminders (Decision 317 item 7)', () => {
  let app: INestApplication;
  let expiryJob: MembershipExpiryReminderProcessor;
  let absenceJob: StudentAbsenceAlertProcessor;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  const schoolId = randomUUID();
  const quietSchoolId = randomUUID();
  /** The absence alert's own School, so the expiry tests' members don't count. */
  const absSchoolId = randomUUID();
  const userIds: string[] = [];
  const plans: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  let owner: { id: string };
  let coOwner: { id: string };
  let quietOwner: { id: string };

  async function mkUser(label: string, dateOfBirth = '1990-01-01') {
    const user = await su.user.create({
      data: {
        id: randomUUID(),
        email: `reminders-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Rem',
        passcodeHash: 'x',
        dateOfBirth: new Date(dateOfBirth),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }
  async function mkStudent(label: string, sid = schoolId) {
    const user = await mkUser(label);
    await su.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.id, schoolId: sid } });
    return user;
  }
  async function mkMembership(
    studentId: string,
    type: MembershipPlanType,
    extra: { expiryDate?: Date; cancelAt?: Date; classesRemaining?: number; createdAt?: Date; startDate?: Date; sid?: string } = {},
  ) {
    const sid = extra.sid ?? schoolId;
    const key = `${sid}:${type}`;
    plans[key] ??= (await su.membershipPlan.create({ data: { id: randomUUID(), schoolId: sid, type, title: `${type} plan`, price: 5000, currency: 'GBP' } })).id;
    return su.membership.create({
      data: {
        id: randomUUID(),
        studentId,
        membershipPlanId: plans[key],
        schoolId: sid,
        frequency: type === 'SUBSCRIPTION' ? 'RECURRING' : 'ONE_TIME',
        expiryDate: extra.expiryDate,
        cancelAt: extra.cancelAt,
        classesRemaining: extra.classesRemaining,
        createdAt: extra.createdAt ?? at(-30),
        startDate: extra.startDate ?? extra.createdAt ?? at(-30),
      },
    });
  }
  async function freeze(m: { id: string; studentId: string; schoolId: string }, from: number, back: number) {
    return su.membershipFreeze.create({
      data: { id: randomUUID(), membershipId: m.id, schoolId: m.schoolId, studentId: m.studentId, startsAt: dateOnly(from), endsAt: dateOnly(back), status: 'APPROVED' },
    });
  }
  /** A class `days` from NOW the student attended (a check-in). */
  async function checkIn(studentId: string, membershipId: string, days: number, sid = schoolId) {
    const cls = await su.class.create({ data: { id: randomUUID(), schoolId: sid, title: 'Reminders class', startDate: at(days), endDate: new Date(at(days).getTime() + 3600_000) } });
    await su.booking.create({ data: { id: randomUUID(), studentId, classId: cls.id, schoolId: sid, sourceMembershipId: membershipId, status: 'COMPLETED' } });
  }

  async function notices(userId: string, title: string, expected: number) {
    for (let i = 0; i < 60; i++) {
      const rows = await su.notification.findMany({ where: { userId, title }, orderBy: { createdAt: 'asc' } });
      if (rows.length >= expected) return rows;
      await new Promise((r) => setTimeout(r, 100));
    }
    return su.notification.findMany({ where: { userId, title }, orderBy: { createdAt: 'asc' } });
  }
  /** Lets the notification worker catch up before checking that nothing came. */
  const settle = () => new Promise((r) => setTimeout(r, 1500));
  const count = (userId: string, title: string) => su.notification.count({ where: { userId, title } });
  const EXPIRY = 'Membership ending soon';
  const ABSENT = 'Member absent';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    expiryJob = app.get(MembershipExpiryReminderProcessor);
    absenceJob = app.get(StudentAbsenceAlertProcessor);

    await su.school.createMany({
      data: [
        { id: schoolId, name: 'Reminders School', timezone: 'UTC' },
        { id: quietSchoolId, name: 'Reminders Quiet School', timezone: 'UTC' },
        { id: absSchoolId, name: 'Reminders Absence School', timezone: 'UTC' },
      ],
    });
    owner = await mkUser('owner');
    coOwner = await mkUser('coOwner');
    quietOwner = await mkUser('quietOwner');
    await su.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId, isMainOwner: true },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: coOwner.id, schoolId },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: absSchoolId },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: coOwner.id, schoolId: absSchoolId },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: quietOwner.id, schoolId: quietSchoolId, isMainOwner: true },
      ],
    });
    tokens.owner = jwt.sign({
      sub: owner.id,
      email: 'x',
      grants: [schoolId, absSchoolId].map((sid) => ({ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: sid, branchId: null })),
    });
  });

  afterAll(async () => {
    const where = { schoolId: { in: [schoolId, quietSchoolId, absSchoolId] } };
    await su.notification.deleteMany({ where: { userId: { in: userIds } } });
    await su.booking.deleteMany({ where });
    await su.class.deleteMany({ where });
    await su.membershipFreeze.deleteMany({ where });
    await su.membership.deleteMany({ where });
    await su.membershipPlan.deleteMany({ where });
    await su.guardianLink.deleteMany({ where: { studentId: { in: userIds } } });
    await su.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await su.school.deleteMany({ where: { id: { in: [schoolId, quietSchoolId, absSchoolId] } } });
    await su.user.deleteMany({ where: { id: { in: userIds } } });
    await su.$disconnect();
    await app.close();
  });

  describe('Expiry reminder: 7 days before a membership ends', () => {
    it('goes once to the member, from 7 days before the end; not before, and not twice', async () => {
      const ana = await mkStudent('ana');
      const m = await mkMembership(ana.id, 'WEEKLY_PASS', { expiryDate: at(8) });
      await expiryJob.run(NOW);
      await settle();
      expect(await count(ana.id, EXPIRY)).toBe(0);

      await expiryJob.run(at(1));
      await expiryJob.run(at(1));
      const rows = await notices(ana.id, EXPIRY, 1);
      expect(rows[0]).toMatchObject({ body: `Your WEEKLY_PASS plan membership ends on ${day(8)}.`, type: 'MEMBERSHIP_EXPIRY', schoolId });
      // A missed day catches up, but never sends again for the same end.
      await expiryJob.run(at(3));
      await settle();
      expect(await count(ana.id, EXPIRY)).toBe(1);
      expect(await su.membershipExpiryReminder.count({ where: { membershipId: m.id } })).toBe(1);

      // A freeze that moves the end later (Decision 404) gets a reminder for the new end.
      await su.membership.update({ where: { id: m.id }, data: { expiryDate: at(18) } });
      await expiryJob.run(at(4));
      await settle();
      expect(await count(ana.id, EXPIRY)).toBe(1);
      await expiryJob.run(at(11));
      expect((await notices(ana.id, EXPIRY, 2))[1].body).toBe(`Your WEEKLY_PASS plan membership ends on ${day(18)}.`);
    });

    it("a cancelled Subscription is reminded of the day it ends; a renewing one isn't", async () => {
      const ben = await mkStudent('ben');
      await mkMembership(ben.id, 'SUBSCRIPTION', { cancelAt: at(5) });
      const cara = await mkStudent('cara');
      await mkMembership(cara.id, 'SUBSCRIPTION');
      await expiryJob.run(NOW);
      expect((await notices(ben.id, EXPIRY, 1))[0].body).toBe(`Your SUBSCRIPTION plan membership ends on ${day(5)}.`);
      await settle();
      expect(await count(cara.id, EXPIRY)).toBe(0);
    });

    it("a child's Guardian gets the reminder as \"For {name}: …\"", async () => {
      const kid = await mkStudent('kid');
      const parent = await mkUser('parent');
      await su.guardianLink.create({ data: { id: randomUUID(), guardianId: parent.id, studentId: kid.id } });
      await mkMembership(kid.id, 'TRIAL_MEMBERSHIP', { expiryDate: at(6) });
      await expiryJob.run(NOW);
      expect((await notices(parent.id, EXPIRY, 1))[0].body).toBe(`For kid: Your TRIAL_MEMBERSHIP plan membership ends on ${day(6)}.`);
    });

    it('skips Friend Passes, visit passes, used-up packs, memberships made within the last 7 days, students who left, and frozen days', async () => {
      const dan = await mkStudent('dan');
      await mkMembership(dan.id, 'FRIEND_PASS', { expiryDate: at(5) });
      await mkMembership(dan.id, 'VISIT_PASS', { expiryDate: at(5) });
      await mkMembership(dan.id, 'CLASS_PACK', { expiryDate: at(5), classesRemaining: 0 });
      await mkMembership(dan.id, 'WEEKLY_PASS', { expiryDate: at(5), createdAt: at(-1) });
      const eve = await mkStudent('eve');
      await mkMembership(eve.id, 'CLASS_PACK', { expiryDate: at(5), classesRemaining: 3 });
      await su.roleGrant.updateMany({ where: { userId: eve.id }, data: { revokedAt: new Date() } });
      const fay = await mkStudent('fay');
      const frozen = await mkMembership(fay.id, 'WEEKLY_PASS', { expiryDate: at(6) });
      await freeze(frozen, -1, 2);

      await expiryJob.run(NOW);
      await settle();
      expect(await count(dan.id, EXPIRY)).toBe(0);
      expect(await count(eve.id, EXPIRY)).toBe(0);
      expect(await count(fay.id, EXPIRY)).toBe(0);
      // Once the freeze is over, the reminder goes.
      await expiryJob.run(at(3));
      expect(await notices(fay.id, EXPIRY, 1)).toHaveLength(1);
    });
  });

  describe('Absence alert to staff after N weeks (the School sets N)', () => {
    it('the owner sets the number of weeks on the School page; off by default', async () => {
      const read = await request(app.getHttpServer()).get(`/v1/schools/${absSchoolId}`).set('Authorization', `Bearer ${tokens.owner}`);
      expect(read.status).toBe(200);
      expect(read.body.absenceAlertWeeks).toBeNull();
      const patch = (absenceAlertWeeks: unknown) =>
        request(app.getHttpServer()).patch(`/v1/schools/${absSchoolId}`).set('Authorization', `Bearer ${tokens.owner}`).send({ absenceAlertWeeks });
      expect((await patch(0)).status).toBe(400);
      expect((await patch(53)).status).toBe(400);
      const set = await patch(2);
      expect(set.status).toBe(200);
      expect(set.body.absenceAlertWeeks).toBe(2);
    });

    it("tells every owner once when a member hasn't checked in for N weeks; never a recent member, visitor or frozen member", async () => {
      const gil = await mkStudent('gil', absSchoolId);
      const gilM = await mkMembership(gil.id, 'SUBSCRIPTION', { startDate: at(-60), sid: absSchoolId });
      await checkIn(gil.id, gilM.id, -40, absSchoolId);
      await checkIn(gil.id, gilM.id, -20, absSchoolId);
      const hal = await mkStudent('hal', absSchoolId);
      const halM = await mkMembership(hal.id, 'SUBSCRIPTION', { startDate: at(-60), sid: absSchoolId });
      await checkIn(hal.id, halM.id, -5, absSchoolId);
      const ivy = await mkStudent('ivy', absSchoolId);
      await mkMembership(ivy.id, 'CLASS_PACK', { classesRemaining: 5, startDate: at(-30), sid: absSchoolId });
      const jon = await mkStudent('jon', absSchoolId);
      await mkMembership(jon.id, 'SUBSCRIPTION', { startDate: at(-3), createdAt: at(-3), sid: absSchoolId });
      const kim = await mkStudent('kim', absSchoolId);
      await mkMembership(kim.id, 'VISIT_PASS', { expiryDate: at(10), startDate: at(-30), sid: absSchoolId });
      const lea = await mkStudent('lea', absSchoolId);
      const leaM = await mkMembership(lea.id, 'SUBSCRIPTION', { startDate: at(-60), sid: absSchoolId });
      await freeze(leaM, -10, 5);

      await absenceJob.run(NOW);
      await absenceJob.run(NOW);
      const toOwner = await notices(owner.id, ABSENT, 2);
      expect(toOwner.map((n) => n.body).sort()).toEqual(["gil Rem hasn't checked in since " + day(-20) + '.', "ivy Rem hasn't checked in yet."].sort());
      expect(toOwner.every((n) => n.type === 'STUDENT_ABSENCE' && n.schoolId === absSchoolId)).toBe(true);
      expect(await notices(coOwner.id, ABSENT, 2)).toHaveLength(2);
      await settle();
      expect(await count(owner.id, ABSENT)).toBe(2);
      for (const s of [hal, jon, kim, lea]) {
        expect(await su.studentAbsenceAlert.count({ where: { studentId: s.id } })).toBe(0);
      }
      // Nothing to the members themselves, or to another School's owner.
      expect(await count(gil.id, ABSENT)).toBe(0);
      expect(await count(quietOwner.id, ABSENT)).toBe(0);

      // A new check-in starts a new absence: nothing until N weeks after it.
      await checkIn(gil.id, gilM.id, 1, absSchoolId);
      await absenceJob.run(at(10));
      await settle();
      expect((await notices(owner.id, ABSENT, 3)).filter((n) => n.body.startsWith('gil'))).toHaveLength(1);
      await absenceJob.run(at(15));
      // By then Hal (last in 20 days before) and Jon (a member for 18 days) are due too.
      const later = await notices(owner.id, ABSENT, 5);
      expect(later.map((n) => n.body.split(' ')[0]).sort()).toEqual(['gil', 'gil', 'hal', 'ivy', 'jon']);
      const again = later.filter((n) => n.body.startsWith('gil'));
      expect(again.map((n) => n.body)).toEqual([`gil Rem hasn't checked in since ${day(-20)}.`, `gil Rem hasn't checked in since ${day(1)}.`]);
    });

    it("a School that hasn't set N sends none", async () => {
      const max = await mkStudent('max', quietSchoolId);
      await mkMembership(max.id, 'SUBSCRIPTION', { startDate: at(-200), sid: quietSchoolId });
      await absenceJob.run(NOW);
      await settle();
      expect(await count(quietOwner.id, ABSENT)).toBe(0);
      expect(await su.studentAbsenceAlert.count({ where: { schoolId: quietSchoolId } })).toBe(0);
    });
  });
});
