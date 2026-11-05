/**
 * Stress test round 5, privacy/staff/races panel (Decision 432), staff and
 * member-data items:
 *
 * - PRIV-6: anyone may give up their own co-owner, coach or Branch Staff role,
 *   never the main owner's (amends Decision 423 item 10); a Full Platform
 *   Admin can pause a School's coach or Branch Staff, audit-logged.
 * - PRIV-10: the owner's "Download this member's data", logged.
 * - PRIV-11: the ALL student export leaves a former member's phone and birth
 *   date blank.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_PLATFORM_ADMIN,
 * PLATFORM_ADMIN_JWT_SECRET and JWT_ACCESS_SECRET.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const DATABASE_URL_PLATFORM_ADMIN = process.env.DATABASE_URL_PLATFORM_ADMIN;
const PLATFORM_ADMIN_JWT_SECRET = process.env.PLATFORM_ADMIN_JWT_SECRET;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_PLATFORM_ADMIN && PLATFORM_ADMIN_JWT_SECRET && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[stress-round5-staff-data.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_PLATFORM_ADMIN / PLATFORM_ADMIN_JWT_SECRET / JWT_ACCESS_SECRET not set.');
}

const HOUR = 3_600_000;
type Role = 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT';

describeIfDb('Round-5 stress test: staff and member data (Decision 432)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const adminJwt = new JwtService({ secret: PLATFORM_ADMIN_JWT_SECRET });
  const tag = randomUUID().slice(0, 8);
  const school = { id: randomUUID() };
  const adminIds: string[] = [];
  let branchId: string;
  type U = { id: string; email: string; token: string; grantId: string };
  let main: U;

  const http = () => request(app.getHttpServer());
  const as = (who: { token: string }) => ({
    get: (path: string) => http().get(`/v1${path}`).set('Authorization', `Bearer ${who.token}`),
    post: (path: string) => http().post(`/v1${path}`).set('Authorization', `Bearer ${who.token}`).send({}),
    delete: (path: string) => http().delete(`/v1${path}`).set('Authorization', `Bearer ${who.token}`),
  });

  async function mkUser(label: string, role: Role, opts: { grantBranchId?: string | null; isMainOwner?: boolean; revokedAt?: Date } = {}): Promise<U> {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `r5-staff-${label}-${tag}-${randomUUID().slice(0, 6)}@example.test`,
        phone: `+1557${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Staff',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-05-05'),
        phoneVerifiedAt: new Date(),
      },
    });
    const branch = opts.grantBranchId ?? null;
    const grant = await superuser.roleGrant.create({
      data: { id: randomUUID(), role, userId: user.id, schoolId: school.id, branchId: branch, isMainOwner: opts.isMainOwner ?? false, revokedAt: opts.revokedAt ?? null },
    });
    const token = jwt.sign({ sub: user.id, email: user.email, grants: [{ role, franchiseId: null, schoolId: school.id, branchId: branch }] });
    return { id: user.id, email: user.email, token, grantId: grant.id };
  }
  const seedAdmin = async (subRole: 'SUPPORT' | 'FULL_ADMIN') => {
    const admin = await superuser.adminUser.create({
      data: { id: randomUUID(), email: `r5-staff-admin-${tag}-${randomUUID()}@example.test`, name: 'R5 Admin', subRole, ssoSubject: `cognito-sub-${randomUUID()}` },
    });
    adminIds.push(admin.id);
    return { id: admin.id, token: adminJwt.sign({ sub: admin.id, email: admin.email, subRole }) };
  };

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await superuser.school.create({ data: { id: school.id, name: `Round 5 Staff ${tag}`, timezone: 'UTC' } });
    branchId = (await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: `Main ${tag}` } })).id;
    main = await mkUser('main', 'SCHOOL_OWNER_MANAGER', { isMainOwner: true });
  });

  afterAll(async () => {
    const userIds = (await superuser.user.findMany({ where: { email: { contains: tag } }, select: { id: true } })).map((u) => u.id);
    await superuser.auditLogEntry.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await superuser.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await superuser.studentNote.deleteMany({ where: { schoolId: school.id } });
    await superuser.studentExportLog.deleteMany({ where: { schoolId: school.id } });
    await superuser.class.deleteMany({ where: { schoolId: school.id } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: school.id } });
    await superuser.staffActivity.deleteMany({ where: { schoolId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.branch.deleteMany({ where: { schoolId: school.id } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  const revokedAt = async (grantId: string) => (await superuser.roleGrant.findUniqueOrThrow({ where: { id: grantId } })).revokedAt;

  describe('PRIV-6: giving up your own role', () => {
    it('a co-owner, Branch Staff and a coach with no classes give up their own role; it is logged as stepping down', async () => {
      const co = await mkUser('co', 'SCHOOL_OWNER_MANAGER');
      const staff = await mkUser('staff', 'BRANCH_STAFF', { grantBranchId: branchId });
      const coach = await mkUser('coach', 'INSTRUCTOR', { grantBranchId: branchId });
      for (const who of [co, staff, coach]) {
        const res = await as(who).delete(`/users/${who.id}/role-grants/${who.grantId}`);
        expect(res.status).toBe(200);
        expect(await revokedAt(who.grantId)).not.toBeNull();
        const line = await superuser.staffActivity.findFirst({ where: { schoolId: school.id, targetUserId: who.id, action: 'ROLE_REMOVED' } });
        expect(line).toMatchObject({ actorId: who.id, details: expect.objectContaining({ self: true }) });
        // Again: already ended, nothing more happens.
        expect((await as(who).delete(`/users/${who.id}/role-grants/${who.grantId}`)).status).toBe(200);
        expect(await superuser.staffActivity.count({ where: { schoolId: school.id, targetUserId: who.id, action: 'ROLE_REMOVED' } })).toBe(1);
      }
    });

    it('never the main owner, and never someone else’s role', async () => {
      const self = await as(main).delete(`/users/${main.id}/role-grants/${main.grantId}`);
      expect(self.status).toBe(403);
      expect(self.body.error.code).toBe('MAIN_OWNER');
      expect(await revokedAt(main.grantId)).toBeNull();

      const coach = await mkUser('coach2', 'INSTRUCTOR', { grantBranchId: branchId });
      const other = await mkUser('coach3', 'INSTRUCTOR', { grantBranchId: branchId });
      const res = await as(coach).delete(`/users/${other.id}/role-grants/${other.grantId}`);
      expect([403, 404]).toContain(res.status);
      expect(await revokedAt(other.grantId)).toBeNull();
    });

    it('a coach who still teaches an upcoming class is asked to have the owner hand it over first', async () => {
      const coach = await mkUser('teacher', 'INSTRUCTOR', { grantBranchId: branchId });
      await superuser.class.create({
        data: { id: randomUUID(), schoolId: school.id, branchId, title: 'R5 taught', instructorId: coach.id, membershipInclusion: true, startDate: new Date(Date.now() + 2 * HOUR), endDate: new Date(Date.now() + 3 * HOUR) },
      });
      const res = await as(coach).delete(`/users/${coach.id}/role-grants/${coach.grantId}`);
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('You still teach upcoming classes or weekly timetable slots here. Ask the School owner to hand them over first.');
      expect(await revokedAt(coach.grantId)).toBeNull();
    });
  });

  describe('PRIV-6: ULTM8 support pauses staff', () => {
    it('any admin lists the staff; only a Full Platform Admin pauses, never an owner; both audit-logged', async () => {
      const support = await seedAdmin('SUPPORT');
      const full = await seedAdmin('FULL_ADMIN');
      const coach = await mkUser('paused', 'INSTRUCTOR', { grantBranchId: branchId });
      const co = await mkUser('co2', 'SCHOOL_OWNER_MANAGER');

      const list = await as(support).get(`/platform-admin/schools/${school.id}/staff`);
      expect(list.status).toBe(200);
      expect(list.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ userId: coach.id, paused: false, roles: [{ role: 'INSTRUCTOR', branchName: `Main ${tag}` }] })]));
      expect(list.body.items.some((p: { userId: string }) => p.userId === main.id)).toBe(false);
      expect(await superuser.auditLogEntry.count({ where: { adminUserId: support.id, action: 'VIEW_SCHOOL_STAFF', targetId: school.id } })).toBe(1);

      const bySupport = await as(support).post(`/platform-admin/schools/${school.id}/staff/${coach.id}/pause`);
      expect(bySupport.status).toBe(403);
      expect(await revokedAt(coach.grantId)).toBeNull();

      const owner = await as(full).post(`/platform-admin/schools/${school.id}/staff/${co.id}/pause`);
      expect(owner.status).toBe(400);
      expect(await revokedAt(co.grantId)).toBeNull();

      const paused = await as(full).post(`/platform-admin/schools/${school.id}/staff/${coach.id}/pause`);
      expect(paused.status).toBe(200);
      expect(paused.body).toMatchObject({ userId: coach.id, pausedRoles: 1 });
      const grant = await superuser.roleGrant.findUniqueOrThrow({ where: { id: coach.grantId } });
      expect(grant.revokedAt).not.toBeNull();
      expect(grant.pausedAt).not.toBeNull();
      expect(grant.pausedById).toBeNull();
      expect(await superuser.auditLogEntry.count({ where: { adminUserId: full.id, action: 'PAUSE_SCHOOL_STAFF', targetId: coach.id } })).toBe(1);
      const line = await superuser.staffActivity.findFirst({ where: { schoolId: school.id, targetUserId: coach.id, action: 'PAUSED' } });
      expect(line).toMatchObject({ actorId: null, details: expect.objectContaining({ byUltm8Support: true }) });

      // Shown as paused; pausing again is a conflict; the main owner unpauses.
      const after = await as(support).get(`/platform-admin/schools/${school.id}/staff`);
      expect(after.body.items.find((p: { userId: string }) => p.userId === coach.id)).toMatchObject({ paused: true });
      expect((await as(full).post(`/platform-admin/schools/${school.id}/staff/${coach.id}/pause`)).status).toBe(409);
      expect((await as(main).post(`/schools/${school.id}/staff/${coach.id}/unpause`)).status).toBe(201);
      expect(await revokedAt(coach.grantId)).toBeNull();
    });
  });

  describe('PRIV-10: Download this member’s data', () => {
    it('the owner gets one member’s data, logged; staff are refused and a non-member is 404', async () => {
      const student = await mkUser('member', 'STUDENT');
      const coach = await mkUser('looker', 'INSTRUCTOR', { grantBranchId: branchId });
      const co = await mkUser('co3', 'SCHOOL_OWNER_MANAGER');
      await superuser.studentNote.create({ data: { id: randomUUID(), schoolId: school.id, studentId: student.id, authorId: main.id, body: 'Knee injury 2025' } });

      const res = await as(co).get(`/schools/${school.id}/students/${student.id}/data-export`);
      expect(res.status).toBe(200);
      expect(res.body.profile).toMatchObject({ firstName: 'member', email: student.email, dateOfBirth: '1990-05-05' });
      expect(res.body.enrolment).toHaveLength(1);
      expect(res.body.notes).toEqual([expect.objectContaining({ body: 'Knee injury 2025' })]);
      expect(await superuser.studentExportLog.count({ where: { schoolId: school.id, exportedById: co.id, filter: 'MEMBER_DATA', studentId: student.id } })).toBe(1);

      expect((await as(coach).get(`/schools/${school.id}/students/${student.id}/data-export`)).status).toBe(403);
      expect((await as(main).get(`/schools/${school.id}/students/${coach.id}/data-export`)).status).toBe(404);
    });
  });

  describe('PRIV-11: a former member’s phone and birth date stay out of the export', () => {
    it('blank for the former member, filled for the current one', async () => {
      const current = await mkUser('current', 'STUDENT');
      const former = await mkUser('former', 'STUDENT', { revokedAt: new Date(Date.now() - HOUR) });
      const res = await as(main).get(`/schools/${school.id}/students/export?filter=ALL`);
      expect(res.status).toBe(200);
      const row = (id: string) => res.body.items.find((r: { id: string }) => r.id === id);
      expect(row(current.id)).toMatchObject({ dateOfBirth: '1990-05-05' });
      expect(row(current.id).phone).toEqual(expect.any(String));
      expect(row(former.id)).toMatchObject({ status: 'INACTIVE', phone: null, dateOfBirth: null });
    });
  });
});
