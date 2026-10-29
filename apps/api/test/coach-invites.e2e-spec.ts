/**
 * Coach invites and "Can invite coaches" (Decision 183): one person, by email,
 * single use, 7 days, cancellable; accepting adds the coach role and keeps the
 * student role; the owner, or Branch Staff given the permission for their own
 * branches, can invite. Real HTTP, real Postgres RLS.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service';

const DATABASE_URL = process.env.DATABASE_URL;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[coach-invites.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

describeIfDb('Coach invites (Decision 183)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const sent: Array<{ to: string; subject: string; body: string }> = [];
  let failEmail = false;
  const previousBaseUrl = process.env.PORTAL_BASE_URL;

  const schoolIds: string[] = [];
  const userIds: string[] = [];
  const token: Record<string, string> = {};
  const user: Record<string, { id: string; email: string }> = {};
  let school: { id: string };
  let north: { id: string };
  let south: { id: string };
  let other: { id: string };

  async function mkUser(label: string, email = `coach-invites-${label}-${randomUUID()}@example.test`) {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Invites',
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
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token[label]}`),
    put: (url: string) => http().put(url).set('Authorization', `Bearer ${token[label]}`),
  });
  const invite = (who: string, body: object, schoolId = school.id) => as(who).post(`/v1/schools/${schoolId}/coach-invites`).send(body);
  const lastLinkToken = () => {
    const m = sent[sent.length - 1].body.match(/\/coach-invite\/([A-Za-z0-9_-]+)/);
    return m![1];
  };

  beforeAll(async () => {
    process.env.PORTAL_BASE_URL = 'https://portal.example.test/';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationDeliveryService)
      .useValue({
        sendEmail: async (to: string, subject: string, body: string) => {
          // Only invite emails: this app's job worker also delivers
          // notification emails queued by other test files running at the
          // same time on the shared Redis, which would land here too.
          if (!subject.startsWith("You're invited to")) return;
          if (failEmail) throw new Error('mail is down');
          sent.push({ to, subject, body });
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Invite Dojo' } });
    other = await superuser.school.create({ data: { id: randomUUID(), name: 'Other Dojo' } });
    schoolIds.push(school.id, other.id);
    north = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'North' } });
    south = await superuser.branch.create({ data: { id: randomUUID(), schoolId: school.id, name: 'South' } });

    await mkUser('owner');
    await mkUser('staff');
    await mkUser('coach');
    await mkUser('student', `Student-${randomUUID()}@Example.test`);
    await mkUser('newbie');
    await mkUser('otherOwner');
    await mkUser('hire');
    // A second owner for the Decision 396 tests: sending invites is limited
    // per account (20 an hour).
    await mkUser('owner2');
    await mkUser('hire2');
    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: user.owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'BRANCH_STAFF', userId: user.staff.id, schoolId: school.id, branchId: north.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: user.coach.id, schoolId: school.id, branchId: north.id },
        { id: randomUUID(), role: 'STUDENT', userId: user.student.id, schoolId: school.id },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: user.otherOwner.id, schoolId: other.id },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: user.owner2.id, schoolId: school.id },
      ],
    });
    for (const label of Object.keys(user)) await sign(label);
  });

  afterAll(async () => {
    process.env.PORTAL_BASE_URL = previousBaseUrl;
    await superuser.coachInvite.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('the owner invites by email; the link is emailed and only its hash is stored', async () => {
    const res = await invite('owner', { email: `  ${user.newbie.email.toUpperCase()} `, branchId: north.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: user.newbie.email, branchId: north.id, branchName: 'North', status: 'PENDING', emailSent: true, invitedByName: 'owner Invites' });
    const days = (new Date(res.body.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: user.newbie.email, subject: "You're invited to coach at Invite Dojo" });
    expect(sent[0].body).toContain('https://portal.example.test/coach-invite/');
    expect(sent[0].body).toContain('Invite Dojo (North)');
    const link = lastLinkToken();
    const row = await superuser.coachInvite.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).not.toContain(link);
  });

  it('a School with branches needs a branch of its own; one pending invite per branch and email', async () => {
    expect((await invite('owner', { email: 'someone@example.test' })).status).toBe(400);
    const foreign = await superuser.branch.create({ data: { id: randomUUID(), schoolId: other.id, name: 'Elsewhere' } });
    expect((await invite('owner', { email: 'someone@example.test', branchId: foreign.id })).status).toBe(400);
    const dup = await invite('owner', { email: user.newbie.email, branchId: north.id });
    expect(dup.status).toBe(409);
    expect((await invite('owner', { email: 'not-an-email', branchId: north.id })).status).toBe(400);
  });

  it('an inviter whose phone isn\'t verified is refused, and nothing is sent (Decision 81, 183.6)', async () => {
    const before = sent.length;
    const email = `unverified-inviter-${randomUUID()}@example.test`;
    await superuser.user.update({ where: { id: user.owner.id }, data: { phoneVerifiedAt: null } });
    try {
      const res = await invite('owner', { email, branchId: south.id });
      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('phone verification');
    } finally {
      await superuser.user.update({ where: { id: user.owner.id }, data: { phoneVerifiedAt: new Date() } });
    }
    expect(sent).toHaveLength(before);
    expect(await superuser.coachInvite.count({ where: { email } })).toBe(0);
  });

  it('anyone with the link sees the School and branch; a bad link is 404', async () => {
    const res = await http().get(`/v1/coach-invite-links/${lastLinkToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ schoolName: 'Invite Dojo', branchName: 'North', email: user.newbie.email, status: 'PENDING' });
    expect((await http().get('/v1/coach-invite-links/nope')).status).toBe(404);
  });

  it('accepting needs the invited email, gives the coach role, and works once', async () => {
    const link = lastLinkToken();
    const wrong = await as('student').post(`/v1/coach-invite-links/${link}/accept`);
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.message).toContain(user.newbie.email);
    expect((await http().post(`/v1/coach-invite-links/${link}/accept`)).status).toBe(401);

    const ok = await as('newbie').post(`/v1/coach-invite-links/${link}/accept`);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ schoolId: school.id, branchId: north.id });
    const claims = jwt.decode(ok.body.accessToken) as { grants: Array<{ role: string; schoolId: string; branchId: string }> };
    expect(claims.grants).toContainEqual({ role: 'INSTRUCTOR', franchiseId: null, schoolId: school.id, branchId: north.id });
    const grant = await superuser.roleGrant.findFirstOrThrow({ where: { userId: user.newbie.id, role: 'INSTRUCTOR' } });
    expect(grant.grantedById).toBe(user.owner.id);

    expect((await as('newbie').post(`/v1/coach-invite-links/${link}/accept`)).status).toBe(409);
    expect((await http().get(`/v1/coach-invite-links/${link}`)).body.status).toBe('ACCEPTED');
    const list = await as('owner').get(`/v1/schools/${school.id}/coach-invites`);
    expect(list.body.items[0]).toMatchObject({ email: user.newbie.email, status: 'ACCEPTED' });
  });

  it('a student who accepts keeps the student role (email matched case-insensitively)', async () => {
    const res = await invite('owner', { email: user.student.email, branchId: south.id });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(user.student.email.toLowerCase());
    const ok = await as('student').post(`/v1/coach-invite-links/${lastLinkToken()}/accept`);
    expect(ok.status).toBe(201);
    const roles = (await superuser.roleGrant.findMany({ where: { userId: user.student.id, schoolId: school.id, revokedAt: null } })).map((g) => g.role).sort();
    expect(roles).toEqual(['INSTRUCTOR', 'STUDENT']);
  });

  it('a cancelled or expired link stops working; an accepted invite can\'t be cancelled', async () => {
    const res = await invite('owner', { email: 'cancel-me@example.test', branchId: north.id });
    const link = lastLinkToken();
    const cancelled = await as('owner').post(`/v1/coach-invites/${res.body.id}/cancel`);
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect((await http().get(`/v1/coach-invite-links/${link}`)).body.status).toBe('CANCELLED');
    expect((await as('newbie').post(`/v1/coach-invite-links/${link}/accept`)).status).toBe(410);
    // A new invite can go out once the old one is cancelled.
    expect((await invite('owner', { email: 'cancel-me@example.test', branchId: north.id })).status).toBe(201);

    const late = await invite('owner', { email: 'late@example.test', branchId: north.id });
    await superuser.coachInvite.update({ where: { id: late.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await http().get(`/v1/coach-invite-links/${lastLinkToken()}`)).body.status).toBe('EXPIRED');
    expect((await as('newbie').post(`/v1/coach-invite-links/${lastLinkToken()}/accept`)).status).toBe(410);

    const accepted = await superuser.coachInvite.findFirstOrThrow({ where: { schoolId: school.id, acceptedAt: { not: null } } });
    expect((await as('owner').post(`/v1/coach-invites/${accepted.id}/cancel`)).status).toBe(409);
  });

  it('an invite whose email fails is still created, with emailSent false', async () => {
    failEmail = true;
    const res = await invite('owner', { email: 'bounce@example.test', branchId: south.id });
    failEmail = false;
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'PENDING', emailSent: false });
  });

  it('staff need "Can invite coaches", and then only for their own branches', async () => {
    expect((await invite('staff', { email: 'by-staff@example.test', branchId: north.id })).status).toBe(403);
    expect((await as('staff').get(`/v1/schools/${school.id}/coach-invites`)).status).toBe(403);

    // Only the owner sets it, and only for Branch Staff (no coach may invite coaches).
    expect((await as('staff').put(`/v1/schools/${school.id}/staff-permissions/${user.staff.id}`).send({ canInviteCoaches: true })).status).toBe(403);
    const forCoach = await as('owner').put(`/v1/schools/${school.id}/staff-permissions/${user.coach.id}`).send({ canInviteCoaches: true });
    expect(forCoach.status).toBe(400);
    const given = await as('owner').put(`/v1/schools/${school.id}/staff-permissions/${user.staff.id}`).send({ canInviteCoaches: true });
    expect(given.status).toBe(200);
    expect(given.body).toMatchObject({ userId: user.staff.id, branchIds: [north.id], canInviteCoaches: true });
    const perms = await as('owner').get(`/v1/schools/${school.id}/staff-permissions`);
    expect(perms.body.items).toEqual([expect.objectContaining({ userId: user.staff.id, firstName: 'staff', canInviteCoaches: true })]);

    const own = await invite('staff', { email: 'by-staff@example.test', branchId: north.id });
    expect(own.status).toBe(201);
    const elsewhere = await invite('staff', { email: 'by-staff@example.test', branchId: south.id });
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.body.error.message).toContain('your own branches');

    // Staff see and cancel only their own branches' invites.
    const seen = (await as('staff').get(`/v1/schools/${school.id}/coach-invites`)).body.items as Array<{ branchId: string }>;
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((i) => i.branchId === north.id)).toBe(true);
    const southInvite = await superuser.coachInvite.findFirstOrThrow({ where: { branchId: south.id, acceptedAt: null, cancelledAt: null } });
    expect((await as('staff').post(`/v1/coach-invites/${southInvite.id}/cancel`)).status).toBe(404);
    expect((await as('staff').post(`/v1/coach-invites/${own.body.id}/cancel`)).status).toBe(201);

    // Taking the permission away stops them.
    await as('owner').put(`/v1/schools/${school.id}/staff-permissions/${user.staff.id}`).send({ canInviteCoaches: false });
    expect((await invite('staff', { email: 'again@example.test', branchId: north.id })).status).toBe(403);
  });

  it('coaches and students can\'t invite; another School\'s owner can\'t see or cancel', async () => {
    expect((await invite('coach', { email: 'x@example.test', branchId: north.id })).status).toBe(403);
    expect((await invite('student', { email: 'x@example.test', branchId: north.id })).status).toBe(403);
    expect((await invite('otherOwner', { email: 'x@example.test', branchId: north.id })).status).toBe(404);
    expect((await as('otherOwner').get(`/v1/schools/${school.id}/coach-invites`)).status).toBe(403);
    const mine = await superuser.coachInvite.findFirstOrThrow({ where: { schoolId: school.id } });
    expect((await as('otherOwner').post(`/v1/coach-invites/${mine.id}/cancel`)).status).toBe(404);
    expect((await as('otherOwner').get(`/v1/schools/${school.id}/staff-permissions`)).status).toBe(403);
  });

  it('each person can read their own invite rights (for the portal)', async () => {
    const mine = (who: string) => as(who).get(`/v1/schools/${school.id}/staff-permissions/me`);
    expect((await mine('owner')).body).toEqual({ isOwner: true, canInviteCoaches: true, canManageDisciplines: true, branchIds: [] });
    expect((await mine('coach')).body).toEqual({ isOwner: false, canInviteCoaches: false, canManageDisciplines: false, branchIds: [] });
    await superuser.staffPermission.update({ where: { schoolId_userId: { schoolId: school.id, userId: user.staff.id } }, data: { canInviteCoaches: true } });
    expect((await mine('staff')).body).toEqual({ isOwner: false, canInviteCoaches: true, canManageDisciplines: false, branchIds: [north.id] });
    // A plain student (not the one who accepted an invite above).
    const pupil = await mkUser('pupil');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: pupil.id, schoolId: school.id } });
    await sign('pupil');
    expect((await mine('pupil')).status).toBe(403);
    expect((await mine('otherOwner')).status).toBe(403);
  });

  it('the same person can have a pending invite at each branch, but only one per branch (Decision 229)', async () => {
    const email = `two-branches-${randomUUID()}@example.test`;
    expect((await invite('owner', { email, branchId: north.id })).status).toBe(201);
    expect((await invite('owner', { email, branchId: south.id })).status).toBe(201);
    expect((await invite('owner', { email, branchId: south.id })).status).toBe(409);
    expect(await superuser.coachInvite.count({ where: { email, acceptedAt: null, cancelledAt: null } })).toBe(2);
  });

  it('without PORTAL_BASE_URL no invite is made', async () => {
    delete process.env.PORTAL_BASE_URL;
    const res = await invite('owner', { email: 'nourl@example.test', branchId: north.id });
    process.env.PORTAL_BASE_URL = 'https://portal.example.test';
    expect(res.status).toBe(503);
    expect(await superuser.coachInvite.count({ where: { email: 'nourl@example.test' } })).toBe(0);
  });

  it('someone paused at the School can\'t accept an invite there; Unpause gives their roles back (Decision 390)', async () => {
    const coachGrant = await superuser.roleGrant.findFirstOrThrow({ where: { userId: user.coach.id, schoolId: school.id, role: 'INSTRUCTOR', revokedAt: null } });
    const now = new Date();
    await superuser.roleGrant.update({ where: { id: coachGrant.id }, data: { revokedAt: now, pausedAt: now, pausedById: user.owner.id } });
    try {
      expect((await invite('owner', { email: user.coach.email, branchId: south.id })).status).toBe(201);
      const res = await as('coach').post(`/v1/coach-invite-links/${lastLinkToken()}/accept`);
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('Your roles at this School are paused. Ask the School to unpause you.');
      expect(await superuser.roleGrant.count({ where: { userId: user.coach.id, schoolId: school.id, revokedAt: null } })).toBe(0);
      expect((await superuser.coachInvite.findFirstOrThrow({ where: { email: user.coach.email, branchId: south.id } })).acceptedAt).toBeNull();
    } finally {
      await superuser.roleGrant.update({ where: { id: coachGrant.id }, data: { revokedAt: null, pausedAt: null, pausedById: null } });
    }
  });

  describe('"New staff must accept first" (Decision 396)', () => {
    const settings = () => `/v1/schools/${school.id}/staff/settings`;
    const giveRole = (userId: string, body: object) => as('owner').post(`/v1/users/${userId}/role-grants`).send({ schoolId: school.id, ...body });

    afterAll(async () => {
      await superuser.school.update({ where: { id: school.id }, data: { staffMustAcceptFirst: false } });
    });

    it('is off by default; only the owner reads or changes it', async () => {
      expect((await as('owner').get(settings())).body).toEqual({ mustAcceptFirst: false });
      expect((await as('staff').get(settings())).status).toBe(403);
      expect((await as('staff').put(settings()).send({ mustAcceptFirst: true })).status).toBe(403);
      expect((await as('otherOwner').put(settings()).send({ mustAcceptFirst: true })).status).toBe(403);
      expect((await as('owner').put(settings()).send({ mustAcceptFirst: 'yes' })).status).toBe(400);
      const on = await as('owner').put(settings()).send({ mustAcceptFirst: true });
      expect(on.status).toBe(200);
      expect(on.body).toEqual({ mustAcceptFirst: true });
    });

    it('when on, "Give role" for a coach or Branch Staff is refused with STAFF_MUST_ACCEPT; a co-owner is still immediate', async () => {
      for (const body of [{ role: 'INSTRUCTOR', branchId: north.id }, { role: 'BRANCH_STAFF', branchId: north.id }]) {
        const res = await giveRole(user.hire.id, body);
        expect(res.status).toBe(409);
        expect(res.body.error).toMatchObject({ code: 'STAFF_MUST_ACCEPT', message: 'This School asks new staff to accept first. Send them an invite instead.' });
      }
      expect(await superuser.roleGrant.count({ where: { userId: user.hire.id, schoolId: school.id } })).toBe(0);
      const coOwner = await giveRole(user.hire2.id, { role: 'SCHOOL_OWNER_MANAGER' });
      expect(coOwner.status).toBe(201);
      await superuser.roleGrant.deleteMany({ where: { userId: user.hire2.id, schoolId: school.id } });
    });

    it('a Branch Staff invite is the owner\'s, needs a branch, and accepting it gives the Branch Staff role', async () => {
      expect((await invite('owner2', { email: user.hire.email, role: 'BRANCH_STAFF' })).status).toBe(400);
      expect((await invite('owner2', { email: user.hire.email, role: 'SCHOOL_OWNER_MANAGER', branchId: north.id })).status).toBe(400);
      const res = await invite('owner2', { email: user.hire.email, role: 'BRANCH_STAFF', branchId: north.id });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ role: 'BRANCH_STAFF', branchName: 'North', status: 'PENDING', emailSent: true });
      expect(sent[sent.length - 1]).toMatchObject({ to: user.hire.email, subject: "You're invited to join the staff at Invite Dojo" });
      // A coach invite to the same person and branch is a separate invite.
      const coachInvite = await invite('owner2', { email: user.hire.email, role: 'INSTRUCTOR', branchId: north.id });
      expect(coachInvite.status).toBe(201);
      expect((await invite('owner2', { email: user.hire.email, role: 'BRANCH_STAFF', branchId: north.id })).status).toBe(409);

      const link = sent.find((m) => m.subject.startsWith("You're invited to join the staff"))!.body.match(/\/coach-invite\/([A-Za-z0-9_-]+)/)![1];
      expect((await http().get(`/v1/coach-invite-links/${link}`)).body).toMatchObject({ role: 'BRANCH_STAFF', branchName: 'North', status: 'PENDING' });
      await sign('hire');
      const ok = await as('hire').post(`/v1/coach-invite-links/${link}/accept`);
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ schoolId: school.id, branchId: north.id, role: 'BRANCH_STAFF' });
      const claims = jwt.decode(ok.body.accessToken) as { grants: Array<{ role: string; schoolId: string; branchId: string }> };
      expect(claims.grants).toContainEqual({ role: 'BRANCH_STAFF', franchiseId: null, schoolId: school.id, branchId: north.id });
      expect(await superuser.roleGrant.count({ where: { userId: user.hire.id, schoolId: school.id, role: 'INSTRUCTOR', revokedAt: null } })).toBe(0);
      await superuser.coachInvite.update({ where: { id: coachInvite.body.id }, data: { cancelledAt: new Date() } });
    });

    it('staff with "Can invite coaches" can\'t send, see or cancel a Branch Staff invite', async () => {
      await superuser.staffPermission.upsert({
        where: { schoolId_userId: { schoolId: school.id, userId: user.staff.id } },
        create: { id: randomUUID(), schoolId: school.id, userId: user.staff.id, canInviteCoaches: true },
        update: { canInviteCoaches: true },
      });
      const refused = await invite('staff', { email: user.hire2.email, role: 'BRANCH_STAFF', branchId: north.id });
      expect(refused.status).toBe(403);
      expect(refused.body.error.message).toBe('Only the School owner can invite Branch Staff.');
      const mine = await invite('owner2', { email: user.hire2.email, role: 'BRANCH_STAFF', branchId: north.id });
      expect(mine.status).toBe(201);
      const seen = (await as('staff').get(`/v1/schools/${school.id}/coach-invites`)).body.items as Array<{ id: string; role: string }>;
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((i) => i.role === 'INSTRUCTOR')).toBe(true);
      expect((await as('staff').post(`/v1/coach-invites/${mine.body.id}/cancel`)).status).toBe(404);
      expect((await as('owner').post(`/v1/coach-invites/${mine.body.id}/cancel`)).status).toBe(201);
    });

    it('a Branch Staff invite from a coach-inviting staff member would not count: only an owner\'s does', async () => {
      // Written straight to the table: the API never lets staff send one.
      const raw = 'x'.repeat(43);
      await superuser.coachInvite.create({
        data: {
          id: randomUUID(), schoolId: school.id, branchId: north.id, email: user.hire2.email, role: 'BRANCH_STAFF',
          tokenHash: createHash('sha256').update(raw).digest('hex'), invitedById: user.staff.id, expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      expect((await http().get(`/v1/coach-invite-links/${raw}`)).body.status).toBe('CANCELLED');
      expect((await as('hire2').post(`/v1/coach-invite-links/${raw}/accept`)).status).toBe(410);
    });

    it('turned off again, "Give role" is immediate', async () => {
      expect((await as('owner').put(settings()).send({ mustAcceptFirst: false })).body).toEqual({ mustAcceptFirst: false });
      expect((await giveRole(user.hire2.id, { role: 'INSTRUCTOR', branchId: south.id })).status).toBe(201);
    });
  });
});
