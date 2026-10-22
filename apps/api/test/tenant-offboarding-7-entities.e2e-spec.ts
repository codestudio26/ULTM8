/**
 * Decision 226 (POST-SPEC-55-DECISION-LOG.md) — entity-level tenant
 * offboarding for the 7 entities with no delete/archive mechanism before
 * this build: Branch, Class, TimetableSlot, Instructor, Rank, Waiver,
 * Lesson. Direct HTTP coverage of each entity's `POST .../{id}/archive` and
 * `.../unarchive`: happy-path archive/unarchive, School-Owner-only gate,
 * blocked-by-active-dependents (409), idempotency, and cross-School
 * isolation (404 for another School's owner).
 *
 * The purge half of the lifecycle (EntityOffboardingPurgeProcessor) has its
 * own dedicated spec — entity-offboarding-purge.e2e-spec.ts — not repeated
 * here.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, and JWT_ACCESS_SECRET — skips
 * with a warning if any are unset, same convention as every other e2e spec
 * in this repo.
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
    '[tenant-offboarding-7-entities.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('Decision 226 — entity-level tenant offboarding (7 entities)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  // Two independent Schools throughout — A is where every happy-path/409/
  // idempotency test runs, B exists only to prove cross-tenant isolation.
  let schoolA: { id: string };
  let schoolB: { id: string };
  let ownerA: { id: string; email: string };
  let ownerB: { id: string; email: string };
  let outsiderStudentA: { id: string; email: string }; // holds a non-owner role at School A, for the owner-only gate
  let tokenOwnerA: string;
  let tokenOwnerB: string;
  let tokenOutsiderStudentA: string;

  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const branchIds: string[] = [];
  const classIds: string[] = [];
  const timetableSlotIds: string[] = [];
  const instructorIds: string[] = [];
  const disciplineIds: string[] = [];
  const rankIds: string[] = [];
  const waiverIds: string[] = [];
  const lessonIds: string[] = [];
  const membershipPlanIds: string[] = [];
  const membershipIds: string[] = [];
  const bookingIds: string[] = [];
  const waitlistEntryIds: string[] = [];
  const studentHomeBranchIds: string[] = [];
  const waiverSignatureIds: string[] = [];
  const studentRankIds: string[] = [];
  const instructorBeltIds: string[] = [];

  function randomPhone(): string {
    return `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`.slice(0, 15);
  }

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `offboarding-${label}-${randomUUID()}@example.test`,
        phone: randomPhone(),
        firstName: label,
        surname: 'Offboarding',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    return u;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    schoolA = await superuser.school.create({ data: { id: randomUUID(), name: 'Offboarding School A', ranksToggle: true } });
    schoolB = await superuser.school.create({ data: { id: randomUUID(), name: 'Offboarding School B', ranksToggle: true } });
    schoolIds.push(schoolA.id, schoolB.id);

    ownerA = await mkUser('owner-a');
    ownerB = await mkUser('owner-b');
    outsiderStudentA = await mkUser('student-a');

    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerA.id, schoolId: schoolA.id } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerB.id, schoolId: schoolB.id } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: outsiderStudentA.id, schoolId: schoolA.id } });

    tokenOwnerA = jwt.sign({ sub: ownerA.id, email: ownerA.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolA.id, branchId: null }] });
    tokenOwnerB = jwt.sign({ sub: ownerB.id, email: ownerB.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolB.id, branchId: null }] });
    tokenOutsiderStudentA = jwt.sign({ sub: outsiderStudentA.id, email: outsiderStudentA.email, grants: [{ role: 'STUDENT', franchiseId: null, schoolId: schoolA.id, branchId: null }] });

    // One MembershipPlan + Membership per Student, shared by the Class/
    // TimetableSlot dependents tests below (a Booking's own sourceMembershipId
    // is a required FK).
    const plan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: schoolA.id, type: 'SUBSCRIPTION', title: 'Offboarding Test Plan', price: 1000 },
    });
    membershipPlanIds.push(plan.id);
    const membership = await superuser.membership.create({
      data: { id: randomUUID(), studentId: outsiderStudentA.id, membershipPlanId: plan.id, schoolId: schoolA.id, status: 'ACTIVE', frequency: 'RECURRING' },
    });
    membershipIds.push(membership.id);

    // Keep a handle for the per-entity blocks below.
    (globalThis as Record<string, unknown>).__offboardingMembershipId = membership.id;
  });

  afterAll(async () => {
    await superuser.waiverSignature.deleteMany({ where: { id: { in: waiverSignatureIds } } });
    await superuser.instructorBelt.deleteMany({ where: { id: { in: instructorBeltIds } } });
    await superuser.studentRank.deleteMany({ where: { id: { in: studentRankIds } } });
    await superuser.waitlistEntry.deleteMany({ where: { id: { in: waitlistEntryIds } } });
    await superuser.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await superuser.studentHomeBranch.deleteMany({ where: { id: { in: studentHomeBranchIds } } });
    await superuser.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await superuser.membershipPlan.deleteMany({ where: { id: { in: membershipPlanIds } } });
    await superuser.lesson.deleteMany({ where: { id: { in: lessonIds } } });
    await superuser.rank.deleteMany({ where: { id: { in: rankIds } } });
    await superuser.discipline.deleteMany({ where: { id: { in: disciplineIds } } });
    await superuser.waiver.deleteMany({ where: { id: { in: waiverIds } } });
    await superuser.instructor.deleteMany({ where: { id: { in: instructorIds } } });
    await superuser.timetableSlot.deleteMany({ where: { id: { in: timetableSlotIds } } });
    await superuser.class.deleteMany({ where: { id: { in: classIds } } });
    await superuser.branch.deleteMany({ where: { id: { in: branchIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  function expectRetentionWindow(purgeAt: string, archivedAt: string) {
    const diffDays = (new Date(purgeAt).getTime() - new Date(archivedAt).getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(89.9);
    expect(diffDays).toBeLessThan(90.1);
  }

  // ===========================================================================
  // Branch
  // ===========================================================================
  describe('Branch', () => {
    it('School Owner can archive and unarchive; sets the full archivedAt/purgeAt/purgedAt trio', async () => {
      const created = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolA.id}/branches`)
        .set('Authorization', `Bearer ${tokenOwnerA}`)
        .send({ name: 'Offboarding Branch — happy path' });
      expect(created.status).toBe(201);
      branchIds.push(created.body.id);

      const archived = await request(app.getHttpServer()).post(`/v1/branches/${created.body.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(archived.status).toBe(201);
      expect(archived.body.archivedAt).toBeTruthy();
      expect(archived.body.purgedAt).toBeNull();
      expectRetentionWindow(archived.body.purgeAt, archived.body.archivedAt);

      // Idempotent — archiving again is a no-op, not an error.
      const archivedAgain = await request(app.getHttpServer()).post(`/v1/branches/${created.body.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(archivedAgain.status).toBe(201);
      expect(archivedAgain.body.archivedAt).toBe(archived.body.archivedAt);

      const unarchived = await request(app.getHttpServer()).post(`/v1/branches/${created.body.id}/unarchive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(unarchived.status).toBe(201);
      expect(unarchived.body.archivedAt).toBeNull();
      expect(unarchived.body.purgeAt).toBeNull();

      // Idempotent the other way too.
      const unarchivedAgain = await request(app.getHttpServer()).post(`/v1/branches/${created.body.id}/unarchive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(unarchivedAgain.status).toBe(201);
    });

    it('a non-owner (Student) cannot archive a Branch', async () => {
      const created = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'Offboarding Branch — owner gate' } });
      branchIds.push(created.id);

      const res = await request(app.getHttpServer()).post(`/v1/branches/${created.id}/archive`).set('Authorization', `Bearer ${tokenOutsiderStudentA}`);
      expect(res.status).toBe(403);
    });

    it("another School's owner cannot archive this Branch (404, not 403 — RLS-blocked and genuinely-missing are indistinguishable by design)", async () => {
      const created = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'Offboarding Branch — cross-tenant' } });
      branchIds.push(created.id);

      const res = await request(app.getHttpServer()).post(`/v1/branches/${created.id}/archive`).set('Authorization', `Bearer ${tokenOwnerB}`);
      expect(res.status).toBe(404);
    });

    it('is blocked (409) while it still has a Class pointing at it, and succeeds once that dependent is gone', async () => {
      const branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'Offboarding Branch — has a Class' } });
      branchIds.push(branch.id);
      const future = new Date(Date.now() + 24 * 3_600_000);
      const cls = await superuser.class.create({
        data: { id: randomUUID(), schoolId: schoolA.id, branchId: branch.id, title: 'Blocks Branch Archive', startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
      });
      classIds.push(cls.id);

      const blocked = await request(app.getHttpServer()).post(`/v1/branches/${branch.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(blocked.status).toBe(409);

      await superuser.class.delete({ where: { id: cls.id } });
      classIds.splice(classIds.indexOf(cls.id), 1);

      const succeeds = await request(app.getHttpServer()).post(`/v1/branches/${branch.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(succeeds.status).toBe(201);
      expect(succeeds.body.archivedAt).toBeTruthy();
    });

    // Decision 293 — the class-occurrence-generation job copies a slot's
    // branchId onto every Class it creates, so a slot left on an archived
    // Branch would keep adding Classes to it.
    it('is blocked (409) while a weekly timetable slot still points at it, and succeeds once the slot is gone', async () => {
      const branch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'Offboarding Branch — has a slot' } });
      branchIds.push(branch.id);
      const slot = await superuser.timetableSlot.create({
        data: {
          id: randomUUID(),
          schoolId: schoolA.id,
          branchId: branch.id,
          weekday: 'TUESDAY',
          startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)),
          endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)),
          title: 'Blocks Branch Archive',
          activities: ['Yoga'],
        },
      });
      timetableSlotIds.push(slot.id);

      const blocked = await request(app.getHttpServer()).post(`/v1/branches/${branch.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.message).toContain('1 weekly timetable slot');

      await superuser.timetableSlot.delete({ where: { id: slot.id } });
      timetableSlotIds.splice(timetableSlotIds.indexOf(slot.id), 1);

      const succeeds = await request(app.getHttpServer()).post(`/v1/branches/${branch.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(succeeds.status).toBe(201);
    });
  });

  // ===========================================================================
  // Class
  // ===========================================================================
  describe('Class', () => {
    it('School Owner can archive and unarchive', async () => {
      const future = new Date(Date.now() + 24 * 3_600_000);
      const cls = await superuser.class.create({
        data: { id: randomUUID(), schoolId: schoolA.id, title: 'Offboarding Class — happy path', startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
      });
      classIds.push(cls.id);

      const archived = await request(app.getHttpServer()).post(`/v1/classes/${cls.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(archived.status).toBe(201);
      expect(archived.body.archivedAt).toBeTruthy();
      expectRetentionWindow(archived.body.purgeAt, archived.body.archivedAt);

      const archivedAgain = await request(app.getHttpServer()).post(`/v1/classes/${cls.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(archivedAgain.status).toBe(201);

      const unarchived = await request(app.getHttpServer()).post(`/v1/classes/${cls.id}/unarchive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(unarchived.status).toBe(201);
      expect(unarchived.body.archivedAt).toBeNull();
    });

    it('a non-owner (Student) cannot archive a Class', async () => {
      const future = new Date(Date.now() + 24 * 3_600_000);
      const cls = await superuser.class.create({
        data: { id: randomUUID(), schoolId: schoolA.id, title: 'Offboarding Class — owner gate', startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
      });
      classIds.push(cls.id);
      const res = await request(app.getHttpServer()).post(`/v1/classes/${cls.id}/archive`).set('Authorization', `Bearer ${tokenOutsiderStudentA}`);
      expect(res.status).toBe(403);
    });

    it("another School's owner cannot archive this Class (404)", async () => {
      const future = new Date(Date.now() + 24 * 3_600_000);
      const cls = await superuser.class.create({
        data: { id: randomUUID(), schoolId: schoolA.id, title: 'Offboarding Class — cross-tenant', startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
      });
      classIds.push(cls.id);
      const res = await request(app.getHttpServer()).post(`/v1/classes/${cls.id}/archive`).set('Authorization', `Bearer ${tokenOwnerB}`);
      expect(res.status).toBe(404);
    });

    it('is blocked (409) by an UPCOMING Booking, and succeeds once it is cancelled', async () => {
      const future = new Date(Date.now() + 24 * 3_600_000);
      const cls = await superuser.class.create({
        data: { id: randomUUID(), schoolId: schoolA.id, title: 'Offboarding Class — has a Booking', startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
      });
      classIds.push(cls.id);
      const membershipId = (globalThis as Record<string, unknown>).__offboardingMembershipId as string;
      const booking = await superuser.booking.create({
        data: { id: randomUUID(), studentId: outsiderStudentA.id, classId: cls.id, schoolId: schoolA.id, sourceMembershipId: membershipId, status: 'UPCOMING' },
      });
      bookingIds.push(booking.id);

      const blocked = await request(app.getHttpServer()).post(`/v1/classes/${cls.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(blocked.status).toBe(409);

      await superuser.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });

      const succeeds = await request(app.getHttpServer()).post(`/v1/classes/${cls.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(succeeds.status).toBe(201);
    });
  });

  // ===========================================================================
  // TimetableSlot
  // ===========================================================================
  describe('TimetableSlot', () => {
    function mkSlotData(title: string) {
      return {
        id: randomUUID(),
        schoolId: schoolA.id,
        weekday: 'MONDAY' as const,
        startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)),
        title,
        activities: ['Yoga'],
      };
    }

    it('School Owner can archive and unarchive', async () => {
      const slot = await superuser.timetableSlot.create({ data: mkSlotData('Offboarding Slot — happy path') });
      timetableSlotIds.push(slot.id);

      const archived = await request(app.getHttpServer()).post(`/v1/timetable/${slot.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(archived.status).toBe(201);
      expect(archived.body.archivedAt).toBeTruthy();
      expectRetentionWindow(archived.body.purgeAt, archived.body.archivedAt);

      const archivedAgain = await request(app.getHttpServer()).post(`/v1/timetable/${slot.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(archivedAgain.status).toBe(201);

      const unarchived = await request(app.getHttpServer()).post(`/v1/timetable/${slot.id}/unarchive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(unarchived.status).toBe(201);
      expect(unarchived.body.archivedAt).toBeNull();
    });

    it('a non-owner (Student) cannot archive a TimetableSlot', async () => {
      const slot = await superuser.timetableSlot.create({ data: mkSlotData('Offboarding Slot — owner gate') });
      timetableSlotIds.push(slot.id);
      const res = await request(app.getHttpServer()).post(`/v1/timetable/${slot.id}/archive`).set('Authorization', `Bearer ${tokenOutsiderStudentA}`);
      expect(res.status).toBe(403);
    });

    it("another School's owner cannot archive this TimetableSlot (404)", async () => {
      const slot = await superuser.timetableSlot.create({ data: mkSlotData('Offboarding Slot — cross-tenant') });
      timetableSlotIds.push(slot.id);
      const res = await request(app.getHttpServer()).post(`/v1/timetable/${slot.id}/archive`).set('Authorization', `Bearer ${tokenOwnerB}`);
      expect(res.status).toBe(404);
    });

    it('is blocked (409) by an UPCOMING Booking against a generated Class, and succeeds once it is cancelled', async () => {
      const slot = await superuser.timetableSlot.create({ data: mkSlotData('Offboarding Slot — has a Booking') });
      timetableSlotIds.push(slot.id);
      const future = new Date(Date.now() + 24 * 3_600_000);
      const generatedClass = await superuser.class.create({
        data: {
          id: randomUUID(),
          schoolId: schoolA.id,
          title: 'Generated From Offboarding Slot',
          startDate: future,
          endDate: new Date(future.getTime() + 3_600_000),
          timetableSlotId: slot.id,
          occurrenceDate: future,
        },
      });
      classIds.push(generatedClass.id);
      const membershipId = (globalThis as Record<string, unknown>).__offboardingMembershipId as string;
      const booking = await superuser.booking.create({
        data: { id: randomUUID(), studentId: outsiderStudentA.id, classId: generatedClass.id, schoolId: schoolA.id, sourceMembershipId: membershipId, status: 'UPCOMING' },
      });
      bookingIds.push(booking.id);

      const blocked = await request(app.getHttpServer()).post(`/v1/timetable/${slot.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(blocked.status).toBe(409);

      await superuser.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });

      const succeeds = await request(app.getHttpServer()).post(`/v1/timetable/${slot.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(succeeds.status).toBe(201);
    });
  });

  // ===========================================================================
  // Instructor
  // ===========================================================================
  describe('Instructor', () => {
    async function mkInstructorProfile(label: string) {
      const user = await mkUser(label);
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: user.id, schoolId: schoolA.id } });
      const profile = await superuser.instructor.create({ data: { id: randomUUID(), userId: user.id, schoolId: schoolA.id } });
      instructorIds.push(profile.id);
      return { user, profile };
    }

    it('School Owner can archive and unarchive; never touches the underlying User or RoleGrant', async () => {
      const { user, profile } = await mkInstructorProfile('instructor-happy');

      const archived = await request(app.getHttpServer()).post(`/v1/instructors/${profile.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(archived.status).toBe(201);
      expect(archived.body.archivedAt).toBeTruthy();
      expectRetentionWindow(archived.body.purgeAt, archived.body.archivedAt);

      const grant = await superuser.roleGrant.findFirst({ where: { userId: user.id, schoolId: schoolA.id, role: 'INSTRUCTOR' } });
      expect(grant?.revokedAt).toBeNull();
      const userAfter = await superuser.user.findUnique({ where: { id: user.id } });
      expect(userAfter).not.toBeNull();

      const archivedAgain = await request(app.getHttpServer()).post(`/v1/instructors/${profile.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(archivedAgain.status).toBe(201);

      const unarchived = await request(app.getHttpServer()).post(`/v1/instructors/${profile.id}/unarchive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(unarchived.status).toBe(201);
      expect(unarchived.body.archivedAt).toBeNull();
    });

    it('a non-owner (Student) cannot archive an Instructor profile', async () => {
      const { profile } = await mkInstructorProfile('instructor-owner-gate');
      const res = await request(app.getHttpServer()).post(`/v1/instructors/${profile.id}/archive`).set('Authorization', `Bearer ${tokenOutsiderStudentA}`);
      expect(res.status).toBe(403);
    });

    it("another School's owner cannot archive this Instructor profile (404)", async () => {
      const { profile } = await mkInstructorProfile('instructor-cross-tenant');
      const res = await request(app.getHttpServer()).post(`/v1/instructors/${profile.id}/archive`).set('Authorization', `Bearer ${tokenOwnerB}`);
      expect(res.status).toBe(404);
    });

    it('is blocked (409) while assigned to an upcoming Class, and succeeds once reassigned', async () => {
      const { user, profile } = await mkInstructorProfile('instructor-has-class');
      const future = new Date(Date.now() + 24 * 3_600_000);
      const cls = await superuser.class.create({
        data: { id: randomUUID(), schoolId: schoolA.id, instructorId: user.id, title: 'Blocks Instructor Archive', startDate: future, endDate: new Date(future.getTime() + 3_600_000) },
      });
      classIds.push(cls.id);

      const blocked = await request(app.getHttpServer()).post(`/v1/instructors/${profile.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(blocked.status).toBe(409);

      await superuser.class.update({ where: { id: cls.id }, data: { instructorId: null } });

      const succeeds = await request(app.getHttpServer()).post(`/v1/instructors/${profile.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(succeeds.status).toBe(201);
    });
  });

  // ===========================================================================
  // Rank
  // ===========================================================================
  describe('Rank', () => {
    async function mkDisciplineAndRank(label: string) {
      const discipline = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: `Offboarding Style ${label}`, classTypesOffered: ['Fundamentals'] } });
      disciplineIds.push(discipline.id);
      const rank = await superuser.rank.create({
        data: { id: randomUUID(), disciplineId: discipline.id, schoolId: schoolA.id, order: 0, name: `Offboarding Belt ${label}`, primaryColour: 'white' },
      });
      rankIds.push(rank.id);
      return { discipline, rank };
    }

    it('School Owner can archive and unarchive, coexisting with the already-shipped DELETE /ranks/{id}', async () => {
      const { rank } = await mkDisciplineAndRank('happy');

      const archived = await request(app.getHttpServer()).post(`/v1/ranks/${rank.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(archived.status).toBe(201);
      expect(archived.body.archivedAt).toBeTruthy();
      expectRetentionWindow(archived.body.purgeAt, archived.body.archivedAt);

      const archivedAgain = await request(app.getHttpServer()).post(`/v1/ranks/${rank.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(archivedAgain.status).toBe(201);

      const unarchived = await request(app.getHttpServer()).post(`/v1/ranks/${rank.id}/unarchive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(unarchived.status).toBe(201);
      expect(unarchived.body.archivedAt).toBeNull();

      // Still really unused — the already-shipped hard-delete (Decision 198) still works too.
      const deleted = await request(app.getHttpServer()).delete(`/v1/ranks/${rank.id}`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(deleted.status).toBe(204);
      rankIds.splice(rankIds.indexOf(rank.id), 1);
    });

    it('a non-owner (Student) cannot archive a Rank', async () => {
      const { rank } = await mkDisciplineAndRank('owner-gate');
      const res = await request(app.getHttpServer()).post(`/v1/ranks/${rank.id}/archive`).set('Authorization', `Bearer ${tokenOutsiderStudentA}`);
      expect(res.status).toBe(403);
    });

    it("another School's owner cannot archive this Rank (404)", async () => {
      const { rank } = await mkDisciplineAndRank('cross-tenant');
      const res = await request(app.getHttpServer()).post(`/v1/ranks/${rank.id}/archive`).set('Authorization', `Bearer ${tokenOwnerB}`);
      expect(res.status).toBe(404);
    });

    it('is blocked (409) while a Student currently holds it, and succeeds once they are moved off it', async () => {
      const { discipline, rank } = await mkDisciplineAndRank('has-holder');
      const studentRank = await superuser.studentRank.create({
        data: { id: randomUUID(), studentId: outsiderStudentA.id, disciplineId: discipline.id, schoolId: schoolA.id, currentRankId: rank.id },
      });
      studentRankIds.push(studentRank.id);

      const blocked = await request(app.getHttpServer()).post(`/v1/ranks/${rank.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(blocked.status).toBe(409);

      await superuser.studentRank.delete({ where: { id: studentRank.id } });
      studentRankIds.splice(studentRankIds.indexOf(studentRank.id), 1);

      const succeeds = await request(app.getHttpServer()).post(`/v1/ranks/${rank.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(succeeds.status).toBe(201);
    });

    it('is also blocked (409) while an instructor has declared it — the same rule deleteRank() already enforces (Decision 198), reused for consistency', async () => {
      const { discipline, rank } = await mkDisciplineAndRank('has-declared');
      const stripeTier = await superuser.rankStripeTier.create({
        data: { id: randomUUID(), rankId: rank.id, schoolId: schoolA.id, order: 0, count: 1, colour: 'white', name: 'Offboarding Rung' },
      });
      const declaringUser = await mkUser('declares-belt');
      await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: declaringUser.id, schoolId: schoolA.id } });
      const belt = await superuser.instructorBelt.create({
        data: { id: randomUUID(), schoolId: schoolA.id, userId: declaringUser.id, disciplineId: discipline.id, rankId: rank.id, stripeTierId: stripeTier.id },
      });
      instructorBeltIds.push(belt.id);

      const blocked = await request(app.getHttpServer()).post(`/v1/ranks/${rank.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(blocked.status).toBe(409);

      await superuser.instructorBelt.delete({ where: { id: belt.id } });
      instructorBeltIds.splice(instructorBeltIds.indexOf(belt.id), 1);

      const succeeds = await request(app.getHttpServer()).post(`/v1/ranks/${rank.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(succeeds.status).toBe(201);
    });
  });

  // ===========================================================================
  // Waiver
  // ===========================================================================
  describe('Waiver', () => {
    it('School Owner can archive and unarchive', async () => {
      const waiver = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: schoolA.id, title: 'Offboarding Waiver — happy path', body: 'Terms.' } });
      waiverIds.push(waiver.id);

      const archived = await request(app.getHttpServer()).post(`/v1/waivers/${waiver.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(archived.status).toBe(201);
      expect(archived.body.archivedAt).toBeTruthy();
      expectRetentionWindow(archived.body.purgeAt, archived.body.archivedAt);

      const archivedAgain = await request(app.getHttpServer()).post(`/v1/waivers/${waiver.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(archivedAgain.status).toBe(201);

      const unarchived = await request(app.getHttpServer()).post(`/v1/waivers/${waiver.id}/unarchive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(unarchived.status).toBe(201);
      expect(unarchived.body.archivedAt).toBeNull();
    });

    it('a non-owner (Student) cannot archive a Waiver', async () => {
      const waiver = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: schoolA.id, title: 'Offboarding Waiver — owner gate', body: 'Terms.' } });
      waiverIds.push(waiver.id);
      const res = await request(app.getHttpServer()).post(`/v1/waivers/${waiver.id}/archive`).set('Authorization', `Bearer ${tokenOutsiderStudentA}`);
      expect(res.status).toBe(403);
    });

    it("another School's owner cannot archive this Waiver (404)", async () => {
      const waiver = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: schoolA.id, title: 'Offboarding Waiver — cross-tenant', body: 'Terms.' } });
      waiverIds.push(waiver.id);
      const res = await request(app.getHttpServer()).post(`/v1/waivers/${waiver.id}/archive`).set('Authorization', `Bearer ${tokenOwnerB}`);
      expect(res.status).toBe(404);
    });

    it('is blocked (409) by ANY WaiverSignature row, including an Unsigned assignment row (not just a completed signature)', async () => {
      const waiver = await superuser.waiver.create({ data: { id: randomUUID(), schoolId: schoolA.id, title: 'Offboarding Waiver — has a signature', body: 'Terms.' } });
      waiverIds.push(waiver.id);
      const signature = await superuser.waiverSignature.create({
        data: { id: randomUUID(), waiverId: waiver.id, studentId: outsiderStudentA.id, schoolId: schoolA.id, status: 'UNSIGNED' },
      });
      waiverSignatureIds.push(signature.id);

      const blocked = await request(app.getHttpServer()).post(`/v1/waivers/${waiver.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(blocked.status).toBe(409);

      await superuser.waiverSignature.delete({ where: { id: signature.id } });
      waiverSignatureIds.splice(waiverSignatureIds.indexOf(signature.id), 1);

      const succeeds = await request(app.getHttpServer()).post(`/v1/waivers/${waiver.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(succeeds.status).toBe(201);
    });

    // Regression test: GET .../waivers previously bound the whole query
    // string to the shared, non-extended PaginationQueryDto via
    // `@Query() query: PaginationQueryDto` while ALSO separately extracting
    // `@Query('includeArchived', ...)` as its own parameter. NestJS's global
    // ValidationPipe({ forbidNonWhitelisted: true }) validates the whole
    // incoming query string against whatever class `@Query()` is bound to —
    // it does not "subtract" a parameter extracted separately — so this
    // request used to be rejected outright with "property includeArchived
    // should not exist," breaking the Waivers list page entirely (caught via
    // Playwright, not this suite, since this suite never exercised the list
    // endpoint's query string before now). Fixed by WaiversQueryDto, the
    // same per-entity query-DTO shape every other one of the 7 entities
    // already used.
    it('GET .../waivers?includeArchived=true is accepted, not rejected by whitelist validation', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/schools/${schoolA.id}/waivers?includeArchived=true`)
        .set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  // ===========================================================================
  // Lesson
  // ===========================================================================
  describe('Lesson', () => {
    async function mkLesson(label: string) {
      const lesson = await superuser.lesson.create({
        data: { id: randomUUID(), schoolId: schoolA.id, title: `Offboarding Lesson ${label}`, format: 'PRERECORDED' },
      });
      lessonIds.push(lesson.id);
      return lesson;
    }

    it('School Owner can archive and unarchive, coexisting with the already-shipped DELETE /lessons/{id}', async () => {
      const lesson = await mkLesson('happy');

      const archived = await request(app.getHttpServer()).post(`/v1/lessons/${lesson.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(archived.status).toBe(201);
      expect(archived.body.archivedAt).toBeTruthy();
      expectRetentionWindow(archived.body.purgeAt, archived.body.archivedAt);

      const archivedAgain = await request(app.getHttpServer()).post(`/v1/lessons/${lesson.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(archivedAgain.status).toBe(201);

      const unarchived = await request(app.getHttpServer()).post(`/v1/lessons/${lesson.id}/unarchive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(unarchived.status).toBe(201);
      expect(unarchived.body.archivedAt).toBeNull();

      // Decision 198's own unconditional hard-delete still works, untouched.
      const deleted = await request(app.getHttpServer()).delete(`/v1/lessons/${lesson.id}`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(deleted.status).toBe(204);
      lessonIds.splice(lessonIds.indexOf(lesson.id), 1);
    });

    it('a non-owner (Student) cannot archive a Lesson', async () => {
      const lesson = await mkLesson('owner-gate');
      const res = await request(app.getHttpServer()).post(`/v1/lessons/${lesson.id}/archive`).set('Authorization', `Bearer ${tokenOutsiderStudentA}`);
      expect(res.status).toBe(403);
    });

    it("another School's owner cannot archive this Lesson (404)", async () => {
      const lesson = await mkLesson('cross-tenant');
      const res = await request(app.getHttpServer()).post(`/v1/lessons/${lesson.id}/archive`).set('Authorization', `Bearer ${tokenOwnerB}`);
      expect(res.status).toBe(404);
    });

    it('has no dependents to check today — archiving always succeeds regardless of category/skills', async () => {
      const lesson = await mkLesson('no-dependents');
      const archived = await request(app.getHttpServer()).post(`/v1/lessons/${lesson.id}/archive`).set('Authorization', `Bearer ${tokenOwnerA}`);
      expect(archived.status).toBe(201);
    });
  });
});
