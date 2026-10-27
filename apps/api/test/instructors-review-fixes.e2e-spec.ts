/**
 * Instructors review fixes (Decision 311, I1–I14) over real HTTP and a real
 * Postgres: every bug the 23 Oct 2026 review reproduced, now asserted fixed.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, and JWT_ACCESS_SECRET — skips with a
 * warning if any are unset, same convention as every other e2e spec in this repo.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[instructors-review-fixes.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

const ARCHIVED_INSTRUCTOR = 'This instructor is archived. Unarchive them on the Instructors page, or pick another instructor.';
const NO_LONGER_INSTRUCTOR = 'This person is no longer an instructor at this School.';
const BRANCH_ONLY_ROLE = "Their Instructor role is for certain branches only, so their profile can't be for the whole School. Choose their branch.";
const ROLE_NOT_FOR_BRANCH = "Their Instructor role doesn't cover this branch. Give them the role there on the Staff page first, or choose their branch.";
const ARCHIVED_BRANCH = 'This branch has been archived. Choose another branch.';

describeIfDb('Instructors review fixes (Decision 311)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const schoolA = randomUUID();
  const schoolC = randomUUID();
  const branchA1 = randomUUID();
  const branchA2 = randomUUID();
  const branchArchived = randomUUID();
  let owner: { id: string; email: string };
  let token: string;

  const mkUser = (label: string) =>
    superuser.user.create({
      data: { id: randomUUID(), email: `instr-fixes-${label}-${randomUUID()}@example.test`, firstName: label, surname: 'Fixes', passcodeHash: 'x', dateOfBirth: new Date('1990-01-01') },
    });
  const grant = (userId: string, schoolId: string, branchId: string | null = null, role: 'INSTRUCTOR' | 'SCHOOL_OWNER_MANAGER' = 'INSTRUCTOR') =>
    superuser.roleGrant.create({ data: { id: randomUUID(), role, userId, schoolId, branchId } });
  const profile = (userId: string, schoolId: string, branchId: string | null = null, archivedAt: Date | null = null) =>
    superuser.instructor.create({ data: { id: randomUUID(), userId, schoolId, branchId, archivedAt } });
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);
  const http = () => app.getHttpServer();
  const asOwner = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const classBody = (instructorId: string, extra: Record<string, unknown> = {}) => ({
    title: 'Fixes class',
    activities: ['Fixes'],
    instructorId,
    startDate: inDays(3).toISOString(),
    endDate: new Date(inDays(3).getTime() + 3_600_000).toISOString(),
    ...extra,
  });

  beforeAll(async () => {
    process.env.PORTAL_BASE_URL = 'https://portal.example.test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationDeliveryService)
      .useValue({ sendEmail: async () => undefined, sendPush: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.create({ data: { id: schoolA, name: 'Instructor fixes A', ranksToggle: true } });
    await superuser.school.create({ data: { id: schoolC, name: 'Instructor fixes C' } });
    await superuser.branch.create({ data: { id: branchA1, schoolId: schoolA, name: 'Fixes A1' } });
    await superuser.branch.create({ data: { id: branchA2, schoolId: schoolA, name: 'Fixes A2' } });
    await superuser.branch.create({ data: { id: branchArchived, schoolId: schoolA, name: 'Fixes archived', archivedAt: new Date() } });
    owner = await mkUser('owner');
    await grant(owner.id, schoolA, null, 'SCHOOL_OWNER_MANAGER');
    await grant(owner.id, schoolC, null, 'SCHOOL_OWNER_MANAGER');
    token = jwt.sign({
      sub: owner.id,
      email: owner.email,
      grants: [
        { role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolA, branchId: null },
        { role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolC, branchId: null },
      ],
    });
  });

  afterAll(async () => {
    const schools = { in: [schoolA, schoolC] };
    await superuser.instructorBelt.deleteMany({ where: { schoolId: schools } });
    await superuser.rankStripeTier.deleteMany({ where: { schoolId: schools } });
    await superuser.rank.deleteMany({ where: { schoolId: schools } });
    await superuser.lesson.deleteMany({ where: { schoolId: schools } });
    await superuser.discipline.deleteMany({ where: { schoolId: schools } });
    await superuser.class.deleteMany({ where: { schoolId: schools } });
    await superuser.timetableSlot.deleteMany({ where: { schoolId: schools } });
    await superuser.instructor.deleteMany({ where: { schoolId: schools } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: schools } });
    await superuser.branch.deleteMany({ where: { schoolId: schools } });
    await superuser.user.deleteMany({ where: { email: { startsWith: 'instr-fixes-' } } });
    await superuser.school.deleteMany({ where: { id: schools } });
    await superuser.$disconnect();
    await app.close();
  });

  it('I1: the belts list skips a revoked instructor instead of failing, and their belt can no longer be verified', async () => {
    const coach = await mkUser('belt-coach');
    const roleGrant = await grant(coach.id, schoolA);
    const stays = await mkUser('belt-stays');
    await grant(stays.id, schoolA);
    const style = await superuser.discipline.create({ data: { id: randomUUID(), schoolId: schoolA, name: `Fixes style ${randomUUID().slice(0, 6)}` } });
    const rank = await superuser.rank.create({ data: { id: randomUUID(), schoolId: schoolA, disciplineId: style.id, order: 0, name: 'White', primaryColour: '#ffffff' } });
    const tier = await superuser.rankStripeTier.create({ data: { id: randomUUID(), schoolId: schoolA, rankId: rank.id, order: 0, count: 0, colour: '#ffffff', name: 'White Belt' } });
    for (const userId of [coach.id, stays.id]) {
      await superuser.instructorBelt.create({ data: { id: randomUUID(), schoolId: schoolA, userId, disciplineId: style.id, rankId: rank.id, stripeTierId: tier.id } });
    }

    const revoke = await asOwner(request(http()).delete(`/v1/users/${coach.id}/role-grants/${roleGrant.id}`));
    expect(revoke.status).toBe(200);

    const list = await asOwner(request(http()).get(`/v1/schools/${schoolA}/instructor-belts`));
    expect(list.status).toBe(200);
    const userIds = list.body.items.map((b: { userId: string }) => b.userId);
    expect(userIds).toContain(stays.id);
    expect(userIds).not.toContain(coach.id);

    const verify = await asOwner(request(http()).post(`/v1/schools/${schoolA}/instructor-belts/${coach.id}/${style.id}/verify`)).send({});
    expect(verify.status).toBe(404);
    expect(verify.body.error.message).toBe(NO_LONGER_INSTRUCTOR);
  });

  describe('I2: an archived instructor gets no new work', () => {
    let archived: { id: string };

    beforeAll(async () => {
      archived = await mkUser('archived');
      await grant(archived.id, schoolA);
      await profile(archived.id, schoolA, null, new Date());
    });

    it('refuses them on a new Class, a new timetable slot and a new lesson', async () => {
      const cls = await asOwner(request(http()).post(`/v1/schools/${schoolA}/classes`)).send(classBody(archived.id));
      expect(cls.status).toBe(400);
      expect(cls.body.error.message).toBe(ARCHIVED_INSTRUCTOR);

      const slot = await asOwner(request(http()).post(`/v1/schools/${schoolA}/timetable`)).send({
        title: 'Fixes slot', activities: ['Fixes'], weekday: 'MONDAY', startTime: '18:00', endTime: '19:00', instructorId: archived.id,
      });
      expect(slot.status).toBe(400);
      expect(slot.body.error.message).toBe(ARCHIVED_INSTRUCTOR);

      const lesson = await asOwner(request(http()).post(`/v1/schools/${schoolA}/curriculum/lessons`)).send({
        title: 'Fixes lesson', format: 'PRERECORDED', instructorId: archived.id, skillIds: [randomUUID()],
      });
      expect(lesson.status).toBe(400);
      expect(lesson.body.error.message).toBe(ARCHIVED_INSTRUCTOR);
    });

    it('refuses switching an existing Class to them, but a Class that already has them stays editable', async () => {
      const other = await mkUser('other-coach');
      await grant(other.id, schoolA);
      const mine = await superuser.class.create({ data: { id: randomUUID(), schoolId: schoolA, title: 'Past class', instructorId: archived.id, startDate: inDays(-7), endDate: inDays(-6.9) } });
      const theirs = await superuser.class.create({ data: { id: randomUUID(), schoolId: schoolA, title: 'Other class', instructorId: other.id, startDate: inDays(4), endDate: inDays(4.1) } });

      const rename = await asOwner(request(http()).patch(`/v1/classes/${mine.id}`)).send({ title: 'Past class, renamed', instructorId: archived.id });
      expect(rename.status).toBe(200);

      const switchTo = await asOwner(request(http()).patch(`/v1/classes/${theirs.id}`)).send({ instructorId: archived.id });
      expect(switchTo.status).toBe(400);
      expect(switchTo.body.error.message).toBe(ARCHIVED_INSTRUCTOR);
    });

    it('someone with the role but no profile yet can still be assigned', async () => {
      const noProfile = await mkUser('no-profile');
      await grant(noProfile.id, schoolC);
      // School C has no styles, so free-text activities are accepted.
      const cls = await asOwner(request(http()).post(`/v1/schools/${schoolC}/classes`)).send(classBody(noProfile.id));
      expect(cls.status).toBe(201);
    });
  });

  describe('I4: archived branches', () => {
    it('Add manually, Add instructor and Edit refuse an archived branch', async () => {
      const manual = await asOwner(request(http()).post(`/v1/schools/${schoolA}/instructors/add-manually`)).send({
        firstName: 'Arc', surname: 'Hived', email: `instr-fixes-manual-${randomUUID()}@example.test`, branchId: branchArchived,
      });
      expect(manual.status).toBe(400);
      expect(manual.body.error.message).toBe(ARCHIVED_BRANCH);

      const wide = await mkUser('wide');
      await grant(wide.id, schoolA);
      const create = await asOwner(request(http()).post(`/v1/schools/${schoolA}/instructors`)).send({ userId: wide.id, branchId: branchArchived });
      expect(create.status).toBe(400);
      expect(create.body.error.message).toBe(ARCHIVED_BRANCH);

      const moved = await profile(wide.id, schoolA, branchA1);
      const patch = await asOwner(request(http()).patch(`/v1/instructors/${moved.id}`)).send({ branchId: branchArchived });
      expect(patch.status).toBe(400);
      expect(patch.body.error.message).toBe(ARCHIVED_BRANCH);
    });

    it('a profile already on a branch that was archived later stays editable', async () => {
      const u = await mkUser('on-archived');
      await grant(u.id, schoolA);
      const p = await profile(u.id, schoolA, branchArchived);
      const patch = await asOwner(request(http()).patch(`/v1/instructors/${p.id}`)).send({ bio: 'Still here', branchId: branchArchived });
      expect(patch.status).toBe(200);
      expect(patch.body.bio).toBe('Still here');
    });
  });

  it('I5: after a revoke, their upcoming Class can still be renamed, and can be moved to another instructor', async () => {
    const leaver = await mkUser('leaver');
    const leaverGrant = await grant(leaver.id, schoolA);
    const next = await mkUser('next');
    await grant(next.id, schoolA);
    const cls = await superuser.class.create({ data: { id: randomUUID(), schoolId: schoolA, title: 'Upcoming', instructorId: leaver.id, startDate: inDays(2), endDate: inDays(2.1) } });
    await superuser.roleGrant.update({ where: { id: leaverGrant.id }, data: { revokedAt: new Date() } });

    const rename = await asOwner(request(http()).patch(`/v1/classes/${cls.id}`)).send({ title: 'Upcoming, renamed', instructorId: leaver.id, branchId: null });
    expect(rename.status).toBe(200);

    const moveBranch = await asOwner(request(http()).patch(`/v1/classes/${cls.id}`)).send({ branchId: branchA1 });
    expect(moveBranch.status).toBe(400);

    const reassign = await asOwner(request(http()).patch(`/v1/classes/${cls.id}`)).send({ instructorId: next.id });
    expect(reassign.status).toBe(200);
    expect(reassign.body.instructorId).toBe(next.id);
  });

  describe('I6: what blocks archiving', () => {
    it('an archived Class and a Class at another School do not block it', async () => {
      const u = await mkUser('archive-me');
      await grant(u.id, schoolA);
      await grant(u.id, schoolC);
      const p = await profile(u.id, schoolA);
      await superuser.class.create({ data: { id: randomUUID(), schoolId: schoolA, title: 'Archived upcoming', instructorId: u.id, startDate: inDays(5), endDate: inDays(5.1), archivedAt: new Date() } });
      await superuser.class.create({ data: { id: randomUUID(), schoolId: schoolC, title: 'Other School', instructorId: u.id, startDate: inDays(5), endDate: inDays(5.1) } });
      const res = await asOwner(request(http()).post(`/v1/instructors/${p.id}/archive`));
      expect(res.status).toBe(201);
      expect(res.body.archivedAt).not.toBeNull();
    });

    it('a live upcoming Class at this School still blocks it', async () => {
      const u = await mkUser('busy');
      await grant(u.id, schoolA);
      const p = await profile(u.id, schoolA);
      await superuser.class.create({ data: { id: randomUUID(), schoolId: schoolA, title: 'Live upcoming', instructorId: u.id, startDate: inDays(5), endDate: inDays(5.1) } });
      const res = await asOwner(request(http()).post(`/v1/instructors/${p.id}/archive`));
      expect(res.status).toBe(409);
    });
  });

  it('I8: a revoked instructor\'s profile can still be edited; moving it to another branch says why it can\'t', async () => {
    const u = await mkUser('revoked-edit');
    const g = await grant(u.id, schoolA);
    const p = await profile(u.id, schoolA);
    await superuser.roleGrant.update({ where: { id: g.id }, data: { revokedAt: new Date() } });

    const bio = await asOwner(request(http()).patch(`/v1/instructors/${p.id}`)).send({ bio: 'Left in October', branchId: null });
    expect(bio.status).toBe(200);
    expect(bio.body.bio).toBe('Left in October');

    const move = await asOwner(request(http()).patch(`/v1/instructors/${p.id}`)).send({ branchId: branchA1 });
    expect(move.status).toBe(400);
    expect(move.body.error.message).toBe(NO_LONGER_INSTRUCTOR);
  });

  it('I10: Add manually refuses names that are only spaces, and trims the rest', async () => {
    const blank = await asOwner(request(http()).post(`/v1/schools/${schoolA}/instructors/add-manually`)).send({
      firstName: '   ', surname: ' ', email: `instr-fixes-blank-${randomUUID()}@example.test`, branchId: branchA1,
    });
    expect(blank.status).toBe(400);

    const padded = await asOwner(request(http()).post(`/v1/schools/${schoolA}/instructors/add-manually`)).send({
      firstName: '  Pat ', surname: ' Lee  ', email: `instr-fixes-padded-${randomUUID()}@example.test`, branchId: branchA1,
    });
    expect(padded.status).toBe(201);
    expect(padded.body.firstName).toBe('Pat');
    expect(padded.body.surname).toBe('Lee');
  });

  describe('I13: the profile\'s branch must be one their role covers', () => {
    it('a branch-only role can\'t have a whole-School profile, on create or edit', async () => {
      const u = await mkUser('branch-only');
      await grant(u.id, schoolA, branchA1);
      const create = await asOwner(request(http()).post(`/v1/schools/${schoolA}/instructors`)).send({ userId: u.id });
      expect(create.status).toBe(400);
      expect(create.body.error.message).toBe(BRANCH_ONLY_ROLE);

      const ok = await asOwner(request(http()).post(`/v1/schools/${schoolA}/instructors`)).send({ userId: u.id, branchId: branchA1 });
      expect(ok.status).toBe(201);

      const widen = await asOwner(request(http()).patch(`/v1/instructors/${ok.body.id}`)).send({ branchId: null });
      expect(widen.status).toBe(400);
      expect(widen.body.error.message).toBe(BRANCH_ONLY_ROLE);

      const other = await asOwner(request(http()).patch(`/v1/instructors/${ok.body.id}`)).send({ branchId: branchA2 });
      expect(other.status).toBe(400);
      expect(other.body.error.message).toBe(ROLE_NOT_FOR_BRANCH);
    });

    it('a whole-School role can have a profile at any branch or the whole School', async () => {
      const u = await mkUser('whole-school');
      await grant(u.id, schoolA);
      const create = await asOwner(request(http()).post(`/v1/schools/${schoolA}/instructors`)).send({ userId: u.id, branchId: branchA2 });
      expect(create.status).toBe(201);
      const widen = await asOwner(request(http()).patch(`/v1/instructors/${create.body.id}`)).send({ branchId: null });
      expect(widen.status).toBe(200);
      expect(widen.body.branchId).toBeNull();
    });
  });

  it('I14: an instructor\'s class list leaves out archived Classes', async () => {
    const u = await mkUser('class-list');
    await grant(u.id, schoolA);
    const p = await profile(u.id, schoolA);
    const live = await superuser.class.create({ data: { id: randomUUID(), schoolId: schoolA, title: 'Live', instructorId: u.id, startDate: inDays(1), endDate: inDays(1.1) } });
    const gone = await superuser.class.create({ data: { id: randomUUID(), schoolId: schoolA, title: 'Archived', instructorId: u.id, startDate: inDays(1), endDate: inDays(1.1), archivedAt: new Date() } });
    const res = await asOwner(request(http()).get(`/v1/instructors/${p.id}/classes`));
    expect(res.status).toBe(200);
    const ids = res.body.items.map((c: { id: string }) => c.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(gone.id);
  });
});
