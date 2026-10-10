/**
 * Grading and coaching security hardening (Phase 7 security review): a coach
 * invite stops working once its sender may no longer invite or the School
 * closes; cancelling races accepting cleanly; database rules narrowed for
 * home branches, coach invites and the branchless-staff student read; invite
 * sending is rate-limited. Real HTTP and real Postgres RLS (the app role).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
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
  console.warn('[grading-security-hardening.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Grading and coaching security hardening (Phase 7)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appRole = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const previousBaseUrl = process.env.PORTAL_BASE_URL;
  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const token: Record<string, string> = {};
  const user: Record<string, { id: string; email: string }> = {};
  let school: { id: string };
  let north: { id: string };
  let south: { id: string };
  let staffGrant: { id: string };

  async function mkUser(label: string) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `sec-hardening-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Security',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    user[label] = { id: u.id, email: u.email };
    return u;
  }
  const sign = async (label: string) => {
    const grants = await superuser.roleGrant.findMany({ where: { userId: user[label].id, revokedAt: null } });
    token[label] = jwt.sign({
      sub: user[label].id,
      email: user[label].email,
      grants: grants.map((g) => ({ role: g.role, franchiseId: g.franchiseId, schoolId: g.schoolId, branchId: g.branchId })),
    });
  };
  const http = () => request(app.getHttpServer());
  const as = (label: string) => ({
    post: (url: string) => http().post(url).set('Authorization', `Bearer ${token[label]}`),
    put: (url: string) => http().put(url).set('Authorization', `Bearer ${token[label]}`),
    del: (url: string) => http().delete(url).set('Authorization', `Bearer ${token[label]}`),
  });
  /** An invite as the API makes it, sent by `inviter`; returns the link's token. */
  async function invite(inviter: string, email: string, branchId: string) {
    const link = randomBytes(32).toString('base64url');
    const row = await superuser.coachInvite.create({
      data: {
        id: randomUUID(), schoolId: school.id, branchId, email, invitedById: user[inviter].id,
        tokenHash: createHash('sha256').update(link).digest('hex'), expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    return { link, id: row.id };
  }
  /** Runs `fn` as the app's database role with this user's context, as the API does. */
  async function asAppRole<T>(userId: string, fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>) {
    return appRole.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
      return fn(tx);
    });
  }

  beforeAll(async () => {
    process.env.PORTAL_BASE_URL = 'https://portal.example.test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationDeliveryService)
      .useValue({ sendEmail: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Security Dojo' } });
    schoolIds.push(school.id);
    north = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'North' } });
    south = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'South' } });
    for (const label of ['owner', 'staff', 'invitee', 'invitee2', 'invitee3', 'student', 'flood']) await mkUser(label);
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: user.owner.id, schoolId: school.id } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: user.flood.id, schoolId: school.id } });
    staffGrant = await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: user.staff.id, schoolId: school.id, branchId: north.id } });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: user.student.id, schoolId: school.id } });
    await superuser.studentHomeBranch.create({ data: { id: randomUUID(), schoolId: school.id, studentId: user.student.id, branchId: north.id } });
    await superuser.staffPermission.create({ data: { id: randomUUID(), schoolId: school.id, userId: user.staff.id, canInviteCoaches: true } });
    for (const label of Object.keys(user)) await sign(label);
  });

  afterAll(async () => {
    process.env.PORTAL_BASE_URL = previousBaseUrl;
    await superuser.coachInvite.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await appRole.$disconnect();
    await app.close();
  });

  it('an invite stops working once its sender may no longer invite there, even if nothing cancelled it', async () => {
    const { link } = await invite('staff', user.invitee.email, north.id);
    expect((await http().get(`/v1/coach-invite-links/${link}`)).body.status).toBe('PENDING');
    // Taken away directly (not through the API, so nothing cancels the invite).
    await superuser.staffPermission.update({ where: { schoolId_userId: { schoolId: school.id, userId: user.staff.id } }, data: { canInviteCoaches: false } });
    expect((await http().get(`/v1/coach-invite-links/${link}`)).body.status).toBe('CANCELLED');
    const res = await as('invitee').post(`/v1/coach-invite-links/${link}/accept`);
    expect(res.status).toBe(410);
    expect(await superuser.roleGrant.count({ where: { userId: user.invitee.id, role: 'INSTRUCTOR' } })).toBe(0);
    await superuser.staffPermission.update({ where: { schoolId_userId: { schoolId: school.id, userId: user.staff.id } }, data: { canInviteCoaches: true } });
  });

  it('turning "Can invite coaches" off, or removing the staff role, cancels that person\'s open invites', async () => {
    const first = await invite('staff', user.invitee2.email, north.id);
    const off = await as('owner').put(`/v1/schools/${school.id}/staff-permissions/${user.staff.id}`).send({ canInviteCoaches: false });
    expect(off.status).toBe(200);
    expect((await superuser.coachInvite.findUniqueOrThrow({ where: { id: first.id } })).cancelledAt).not.toBeNull();

    await as('owner').put(`/v1/schools/${school.id}/staff-permissions/${user.staff.id}`).send({ canInviteCoaches: true });
    const second = await invite('staff', user.invitee2.email, north.id);
    const revoked = await as('owner').del(`/v1/users/${user.staff.id}/role-grants/${staffGrant.id}`);
    expect(revoked.status).toBe(200);
    expect((await superuser.coachInvite.findUniqueOrThrow({ where: { id: second.id } })).cancelledAt).not.toBeNull();
    expect((await as('invitee2').post(`/v1/coach-invite-links/${second.link}/accept`)).status).toBe(410);
  });

  it('an invite to a closed School can\'t be accepted', async () => {
    const { link } = await invite('owner', user.invitee3.email, south.id);
    await superuser.school.update({ where: { id: school.id }, data: { archivedAt: new Date() } });
    try {
      expect((await http().get(`/v1/coach-invite-links/${link}`)).body.status).toBe('CANCELLED');
      expect((await as('invitee3').post(`/v1/coach-invite-links/${link}/accept`)).status).toBe(410);
    } finally {
      await superuser.school.update({ where: { id: school.id }, data: { archivedAt: null } });
    }
    expect((await as('invitee3').post(`/v1/coach-invite-links/${link}/accept`)).status).toBe(201);
  });

  it('cancelling while it is being accepted is a 409, never a 500', async () => {
    for (let i = 0; i < 5; i++) {
      const u = await mkUser(`race${i}`);
      await sign(`race${i}`);
      const { link, id } = await invite('owner', u.email, south.id);
      const [accepted, cancelled] = await Promise.all([
        as(`race${i}`).post(`/v1/coach-invite-links/${link}/accept`),
        as('owner').post(`/v1/coach-invites/${id}/cancel`),
      ]);
      expect([201, 409, 410]).toContain(accepted.status);
      expect([201, 409]).toContain(cancelled.status);
      expect(accepted.status === 201 && cancelled.status === 201).toBe(false);
    }
  });

  it('a student can read their home branch but not change it; only the owner reassigns', async () => {
    const changed = await asAppRole(user.student.id, (tx) =>
      tx.studentHomeBranch.updateMany({ where: { studentId: user.student.id }, data: { branchId: south.id } }),
    );
    expect(changed.count).toBe(0);
    const mine = await asAppRole(user.student.id, (tx) => tx.studentHomeBranch.findMany({ where: { studentId: user.student.id } }));
    expect(mine).toHaveLength(1);
    expect(mine[0].branchId).toBe(north.id);
    const byOwner = await asAppRole(user.owner.id, (tx) =>
      tx.studentHomeBranch.updateMany({ where: { studentId: user.student.id }, data: { branchId: south.id } }),
    );
    expect(byOwner.count).toBe(1);
  });

  it('a sent invite\'s email, branch and token can\'t be changed, only its outcome', async () => {
    const { id } = await invite('owner', 'locked@example.test', south.id);
    await expect(asAppRole(user.owner.id, (tx) => tx.coachInvite.update({ where: { id }, data: { email: 'attacker@example.test' } }))).rejects.toThrow();
    const cancelled = await asAppRole(user.owner.id, (tx) => tx.coachInvite.update({ where: { id }, data: { cancelledAt: new Date(), cancelledById: user.owner.id } }));
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  it('coaches at a School without branches see current students only, not former ones', async () => {
    const plain = await superuser.school.create({ data: { id: randomUUID(), name: 'No Branches Dojo' } });
    schoolIds.push(plain.id);
    const coach = await mkUser('plainCoach');
    const current = await mkUser('current');
    const former = await mkUser('former');
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'INSTRUCTOR', userId: coach.id, schoolId: plain.id },
        { id: randomUUID(), role: 'STUDENT', userId: current.id, schoolId: plain.id },
        { id: randomUUID(), role: 'STUDENT', userId: former.id, schoolId: plain.id, revokedAt: new Date() },
      ],
    });
    const seen = await asAppRole(coach.id, (tx) => tx.roleGrant.findMany({ where: { schoolId: plain.id, role: 'STUDENT' }, select: { userId: true } }));
    expect(seen.map((g) => g.userId)).toEqual([current.id]);
  });

  it('sending invites is limited to 20 an hour per account', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await as('flood').post(`/v1/schools/${school.id}/coach-invites`).send({ email: `flood${i}@example.test`, branchId: south.id });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});
