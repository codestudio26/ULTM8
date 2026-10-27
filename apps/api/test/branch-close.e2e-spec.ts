/**
 * Decision 330 — closing a Branch (Branches review fixes 5 to 7):
 * - only things still in use block it (past and archived Classes don't);
 * - "Close branch" moves them in one go, then archives;
 * - a closed Branch with history is kept for good (purgeAt null).
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, and JWT_ACCESS_SECRET — skips
 * with a warning if any are unset, same convention as every other e2e spec.
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
  console.warn('[branch-close.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describeIfDb('Decision 330 — closing a Branch', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let schoolA: { id: string };
  let schoolB: { id: string };
  let ownerA: { id: string; email: string };
  let student: { id: string; email: string };
  let coach: { id: string; email: string };
  let membershipId: string;
  let tokenOwnerA: string;
  let tokenOwnerB: string;
  let tokenStudent: string;
  const userIds: string[] = [];

  function randomPhone(): string {
    return `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`.slice(0, 15);
  }

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `branch-close-${label}-${randomUUID()}@example.test`,
        phone: randomPhone(),
        firstName: label,
        surname: 'BranchClose',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    return u;
  }

  const mkBranch = (name: string, schoolId = schoolA.id, extra: Record<string, unknown> = {}) =>
    superuser.branch.create({ data: { id: randomUUID(), schoolId, name, ...extra } });

  const mkClass = (branchId: string, startsIn: number, extra: Record<string, unknown> = {}) => {
    const start = new Date(Date.now() + startsIn);
    return superuser.class.create({
      data: { id: randomUUID(), schoolId: schoolA.id, branchId, title: 'Close test class', startDate: start, endDate: new Date(start.getTime() + HOUR), ...extra },
    });
  };

  const mkSlot = (branchId: string, extra: Record<string, unknown> = {}) =>
    superuser.timetableSlot.create({
      data: {
        id: randomUUID(),
        schoolId: schoolA.id,
        branchId,
        weekday: 'TUESDAY',
        startTime: new Date(Date.UTC(1970, 0, 1, 18, 0)),
        endTime: new Date(Date.UTC(1970, 0, 1, 19, 0)),
        title: 'Close test slot',
        ...extra,
      },
    });

  const post = (path: string, token: string, body: object = {}) =>
    request(app.getHttpServer()).post(`/v1${path}`).set('Authorization', `Bearer ${token}`).send(body);
  const get = (path: string, token: string) => request(app.getHttpServer()).get(`/v1${path}`).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    schoolA = await superuser.school.create({ data: { id: randomUUID(), name: 'Branch Close School A' } });
    schoolB = await superuser.school.create({ data: { id: randomUUID(), name: 'Branch Close School B' } });
    ownerA = await mkUser('owner-a');
    const ownerB = await mkUser('owner-b');
    student = await mkUser('student');
    coach = await mkUser('coach');

    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerA.id, schoolId: schoolA.id } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerB.id, schoolId: schoolB.id } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId: schoolA.id } });

    const grant = (sub: string, email: string, role: string, schoolId: string) =>
      jwt.sign({ sub, email, grants: [{ role, franchiseId: null, schoolId, branchId: null }] });
    tokenOwnerA = grant(ownerA.id, ownerA.email, 'SCHOOL_OWNER_MANAGER', schoolA.id);
    tokenOwnerB = grant(ownerB.id, ownerB.email, 'SCHOOL_OWNER_MANAGER', schoolB.id);
    tokenStudent = grant(student.id, student.email, 'STUDENT', schoolA.id);

    const plan = await superuser.membershipPlan.create({
      data: { id: randomUUID(), schoolId: schoolA.id, type: 'SUBSCRIPTION', title: 'Branch Close Plan', price: 1000 },
    });
    const membership = await superuser.membership.create({
      data: { id: randomUUID(), studentId: student.id, membershipPlanId: plan.id, schoolId: schoolA.id, status: 'ACTIVE', frequency: 'RECURRING' },
    });
    membershipId = membership.id;
  });

  afterAll(async () => {
    const schools = { schoolId: { in: [schoolA.id, schoolB.id] } };
    await superuser.waitlistEntry.deleteMany({ where: schools });
    await superuser.booking.deleteMany({ where: schools });
    await superuser.studentHomeBranch.deleteMany({ where: schools });
    await superuser.coachInvite.deleteMany({ where: schools });
    await superuser.membership.deleteMany({ where: schools });
    await superuser.membershipPlan.deleteMany({ where: schools });
    await superuser.instructor.deleteMany({ where: schools });
    await superuser.class.deleteMany({ where: schools });
    await superuser.timetableSlot.deleteMany({ where: schools });
    await superuser.roleGrant.deleteMany({ where: schools });
    await superuser.branch.deleteMany({ where: schools });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await superuser.$disconnect();
    await app.close();
  });

  // Fix 5 — only live things block.
  it('a past Class or an archived slot no longer blocks; the Branch is kept for good because it has history', async () => {
    const branch = await mkBranch('Close — history only');
    await mkClass(branch.id, -2 * DAY);
    await mkSlot(branch.id, { archivedAt: new Date() });

    const res = await post(`/branches/${branch.id}/archive`, tokenOwnerA);
    expect(res.status).toBe(201);
    expect(res.body.archivedAt).toBeTruthy();
    expect(res.body.purgeAt).toBeNull(); // fix 7 — never purged
  });

  it('an empty Branch closes and is set to be removed after 90 days', async () => {
    const branch = await mkBranch('Close — empty');
    const res = await post(`/branches/${branch.id}/close`, tokenOwnerA);
    expect(res.status).toBe(201);
    const purgeIn = new Date(res.body.purgeAt).getTime() - Date.now();
    expect(purgeIn).toBeGreaterThan(89 * DAY);
    expect(purgeIn).toBeLessThan(91 * DAY);

    // Reopen still works.
    const reopened = await post(`/branches/${branch.id}/unarchive`, tokenOwnerA);
    expect(reopened.status).toBe(201);
    expect(reopened.body.archivedAt).toBeNull();
  });

  it('the preview counts only what is still in use, and says whether there is history', async () => {
    const branch = await mkBranch('Close — preview');
    await mkClass(branch.id, DAY);
    await mkClass(branch.id, -DAY);
    await mkClass(branch.id, DAY, { archivedAt: new Date() });
    await mkSlot(branch.id);
    await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: schoolA.id, studentId: student.id, branchId: branch.id } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: coach.id, schoolId: schoolA.id, branchId: branch.id } });
    await superuser.coachInvite.create({
      data: { id: randomUUID(), schoolId: schoolA.id, branchId: branch.id, email: 'invitee@example.test', tokenHash: randomUUID(), expiresAt: new Date(Date.now() + DAY) },
    });

    const res = await get(`/branches/${branch.id}/close-preview`, tokenOwnerA);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ upcomingClasses: 1, timetableSlots: 1, instructors: 0, students: 1, staffRoles: 1, pendingCoachInvites: 1, hasHistory: true });

    // Tidy the shared Student's home row and role so later tests start clean.
    await superuser.studentHomeBranch.deleteMany({ where: { branchId: branch.id } });
    await superuser.roleGrant.deleteMany({ where: { branchId: branch.id } });
  });

  it('without a target for something still in use it is refused (409) and nothing changes', async () => {
    const branch = await mkBranch('Close — no target');
    const target = await mkBranch('Close — no target, target');
    const cls = await mkClass(branch.id, DAY);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: coach.id, schoolId: schoolA.id, branchId: branch.id } });

    const res = await post(`/branches/${branch.id}/close`, tokenOwnerA, { classesTo: target.id });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('active staff/instructor role grant');
    expect((await superuser.class.findUnique({ where: { id: cls.id } }))?.branchId).toBe(branch.id); // rolled back
    expect((await superuser.branch.findUnique({ where: { id: branch.id } }))?.archivedAt).toBeNull();
    await superuser.roleGrant.deleteMany({ where: { branchId: branch.id } });
  });

  // Fix 6 — Close branch moves everything still in use.
  it('moves upcoming classes (with bookings and waitlist), slots, Students, Instructor profiles and staff roles, cancels invites, keeps the past', async () => {
    const branch = await mkBranch('Close — full move');
    const target = await mkBranch('Close — full move, target');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: schoolA.id, branchId: branch.id } });
    const future = await mkClass(branch.id, DAY, { instructorId: coach.id });
    const past = await mkClass(branch.id, -DAY);
    const booking = await superuser.booking.create({
      data: { id: randomUUID(), studentId: student.id, classId: future.id, schoolId: schoolA.id, branchId: branch.id, sourceMembershipId: membershipId },
    });
    const pastBooking = await superuser.booking.create({
      data: { id: randomUUID(), studentId: student.id, classId: past.id, schoolId: schoolA.id, branchId: branch.id, sourceMembershipId: membershipId, status: 'COMPLETED' },
    });
    const waiting = await superuser.waitlistEntry.create({
      data: { id: randomUUID(), studentId: student.id, classId: future.id, schoolId: schoolA.id, branchId: branch.id, position: 1 },
    });
    const slot = await mkSlot(branch.id, { instructorId: coach.id });
    const home = await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: schoolA.id, studentId: student.id, branchId: branch.id } });
    const profile = await superuser.instructor.create({ data: { id: randomUUID(), userId: coach.id, schoolId: schoolA.id, branchId: branch.id } });
    const invite = await superuser.coachInvite.create({
      data: { id: randomUUID(), schoolId: schoolA.id, branchId: branch.id, email: 'invitee2@example.test', tokenHash: randomUUID(), expiresAt: new Date(Date.now() + DAY) },
    });

    const res = await post(`/branches/${branch.id}/close`, tokenOwnerA, {
      classesTo: target.id,
      studentsTo: target.id,
      instructorsTo: 'WHOLE_SCHOOL',
      staffTo: target.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.archivedAt).toBeTruthy();
    expect(res.body.purgeAt).toBeNull(); // has history (the past class, the old role)

    expect((await superuser.class.findUnique({ where: { id: future.id } }))?.branchId).toBe(target.id);
    expect((await superuser.booking.findUnique({ where: { id: booking.id } }))?.branchId).toBe(target.id);
    expect((await superuser.waitlistEntry.findUnique({ where: { id: waiting.id } }))?.branchId).toBe(target.id);
    expect((await superuser.timetableSlot.findUnique({ where: { id: slot.id } }))?.branchId).toBe(target.id);
    expect((await superuser.studentHomeBranch.findUnique({ where: { id: home.id } }))?.branchId).toBe(target.id);
    expect((await superuser.instructor.findUnique({ where: { id: profile.id } }))?.branchId).toBeNull();
    expect((await superuser.coachInvite.findUnique({ where: { id: invite.id } }))?.cancelledAt).toBeTruthy();
    // The past stays where it happened.
    expect((await superuser.class.findUnique({ where: { id: past.id } }))?.branchId).toBe(branch.id);
    expect((await superuser.booking.findUnique({ where: { id: pastBooking.id } }))?.branchId).toBe(branch.id);
    // Old role revoked (history), same role granted at the target.
    const grants = await superuser.roleGrant.findMany({ where: { userId: coach.id, schoolId: schoolA.id, role: 'INSTRUCTOR' } });
    expect(grants.find((g) => g.branchId === branch.id)?.revokedAt).toBeTruthy();
    expect(grants.find((g) => g.branchId === target.id && g.revokedAt === null)).toBeTruthy();

    // Tidy: the shared coach's profile and role, the Student's home row.
    await superuser.instructor.deleteMany({ where: { id: profile.id } });
    await superuser.studentHomeBranch.deleteMany({ where: { id: home.id } });
    await superuser.roleGrant.updateMany({ where: { userId: coach.id, schoolId: schoolA.id, revokedAt: null }, data: { revokedAt: new Date() } });
  });

  it('"Whole School" for Students clears their home Branch', async () => {
    const branch = await mkBranch('Close — students to whole School');
    const home = await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: schoolA.id, studentId: student.id, branchId: branch.id } });
    const res = await post(`/branches/${branch.id}/close`, tokenOwnerA, { studentsTo: 'WHOLE_SCHOOL' });
    expect(res.status).toBe(201);
    expect(await superuser.studentHomeBranch.findUnique({ where: { id: home.id } })).toBeNull();
  });

  it('refuses a move that would leave a coach teaching at a Branch where they have no coach role', async () => {
    const branch = await mkBranch('Close — stranded coach');
    const classesGo = await mkBranch('Close — stranded coach, classes');
    const staffGo = await mkBranch('Close — stranded coach, staff');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: schoolA.id, branchId: branch.id } });
    const cls = await mkClass(branch.id, DAY, { instructorId: coach.id });

    const res = await post(`/branches/${branch.id}/close`, tokenOwnerA, { classesTo: classesGo.id, staffTo: staffGo.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BRANCH_CLOSE_COACH_NOT_AT_TARGET');
    // Rolled back: class, role and Branch untouched.
    expect((await superuser.class.findUnique({ where: { id: cls.id } }))?.branchId).toBe(branch.id);
    expect(await superuser.roleGrant.count({ where: { userId: coach.id, branchId: branch.id, revokedAt: null } })).toBe(1);
    expect((await superuser.branch.findUnique({ where: { id: branch.id } }))?.archivedAt).toBeNull();

    // "Whole School" for the classes is fine: anyone with a coach role here may teach a School-wide class.
    const ok = await post(`/branches/${branch.id}/close`, tokenOwnerA, { classesTo: 'WHOLE_SCHOOL', staffTo: staffGo.id });
    expect(ok.status).toBe(201);
    await superuser.roleGrant.updateMany({ where: { userId: coach.id, schoolId: schoolA.id, revokedAt: null }, data: { revokedAt: new Date() } });
  });

  it('rejects bad targets: staff to the whole School, the Branch itself, a closed Branch, another School’s Branch', async () => {
    const branch = await mkBranch('Close — bad targets');
    const closed = await mkBranch('Close — bad targets, closed', schoolA.id, { archivedAt: new Date() });
    const foreign = await mkBranch('Close — bad targets, other School', schoolB.id);

    for (const body of [{ staffTo: 'WHOLE_SCHOOL' }, { classesTo: branch.id }, { studentsTo: closed.id }, { instructorsTo: foreign.id }, { classesTo: randomUUID() }]) {
      const res = await post(`/branches/${branch.id}/close`, tokenOwnerA, body);
      expect(res.status).toBe(400);
    }
    expect((await superuser.branch.findUnique({ where: { id: branch.id } }))?.archivedAt).toBeNull();
  });

  it('is owner-only, and another School cannot see the Branch', async () => {
    const branch = await mkBranch('Close — gates');
    expect((await post(`/branches/${branch.id}/close`, tokenStudent)).status).toBe(403);
    expect((await get(`/branches/${branch.id}/close-preview`, tokenStudent)).status).toBe(403);
    expect((await post(`/branches/${branch.id}/close`, tokenOwnerB)).status).toBe(404);
    expect((await get(`/branches/${branch.id}/close-preview`, tokenOwnerB)).status).toBe(404);
  });

  it('closing an already-closed Branch is a no-op', async () => {
    const branch = await mkBranch('Close — twice');
    expect((await post(`/branches/${branch.id}/close`, tokenOwnerA)).status).toBe(201);
    const again = await post(`/branches/${branch.id}/close`, tokenOwnerA, { classesTo: 'WHOLE_SCHOOL' });
    expect(again.status).toBe(201);
    expect(again.body.archivedAt).toBeTruthy();
  });
});
