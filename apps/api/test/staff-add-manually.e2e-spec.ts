/**
 * Decision 246 — Staff "Add Manually": a real User + RoleGrant (role:
 * BRANCH_STAFF) created immediately from just name + email + branchId, a
 * temp passcode emailed, forced change on first login. Mirrors
 * instructors.e2e-spec.ts's own "Add Manually"/full-smoke-path coverage
 * exactly, minus the third profile-row concern (Staff has no profile table
 * of its own — see RoleGrantsService.createStaffManually's own header
 * comment).
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
  console.warn(
    '[staff-add-manually.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('RoleGrantsModule — Staff "Add Manually" (Decision 246)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let schoolA: { id: string };
  let branchA1: { id: string };
  let ownerA: { id: string; email: string };
  let tokenOwnerA: string;
  let tokenBranchStaffA1: string;

  const roleGrantIds: string[] = [];
  // Decision 246 — captured emails for Add Manually's temp-passcode send, same
  // overrideProvider(NotificationDeliveryService) pattern instructors.e2e-spec.ts
  // already established.
  const sentEmails: Array<{ to: string; subject: string; body: string }> = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  function extractTempPasscode(body: string): string {
    const match = body.match(/Temporary passcode: (\d{6})/);
    if (!match) throw new Error(`No temp passcode found in email body: ${body}`);
    return match[1];
  }

  beforeAll(async () => {
    process.env.PORTAL_BASE_URL = 'https://portal.example.test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NotificationDeliveryService)
      .useValue({
        sendEmail: async (to: string, subject: string, body: string) => {
          if (!subject.startsWith('Your ULTM8 staff account is ready')) return;
          sentEmails.push({ to, subject, body });
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    schoolA = await superuser.school.create({ data: { id: randomUUID(), name: 'Staff Add-Manually HTTP School A' } });
    branchA1 = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'Staff Add-Manually Branch A1' } });

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `staff-am-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    ownerA = await mkUser('owner-a');
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerA.id, schoolId: schoolA.id },
    });

    const branchStaffA1User = await mkUser('branch-staff-a1');
    await superuser.roleGrant.create({
      data: { id: randomUUID(), role: 'BRANCH_STAFF', userId: branchStaffA1User.id, schoolId: schoolA.id, branchId: branchA1.id },
    });

    tokenOwnerA = signAccessToken(ownerA, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolA.id, branchId: null }]);
    tokenBranchStaffA1 = signAccessToken(branchStaffA1User, [
      { role: 'BRANCH_STAFF', franchiseId: null, schoolId: schoolA.id, branchId: branchA1.id },
    ]);
  });

  afterAll(async () => {
    await superuser.roleGrant.deleteMany({ where: { id: { in: roleGrantIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: schoolA.id } });
    await superuser.branch.deleteMany({ where: { id: branchA1.id } });
    await superuser.user.deleteMany({ where: { email: { contains: 'staff-am-http-' } } });
    await superuser.school.deleteMany({ where: { id: schoolA.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('creates a real User + RoleGrant (BRANCH_STAFF) immediately from name+email+branchId, and emails a temp passcode', async () => {
    const email = `staff-am-http-created-${randomUUID()}@example.test`;

    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/role-grants/add-manually`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ firstName: 'Added', surname: 'Manually', email, branchId: branchA1.id });
    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(true);
    expect(res.body.email).toBe(email);
    expect(res.body.role).toBe('BRANCH_STAFF');
    expect(res.body.branchId).toBe(branchA1.id);
    roleGrantIds.push(res.body.id);

    const createdUser = await superuser.user.findUniqueOrThrow({ where: { email } });
    expect(createdUser.phone).toBeNull();
    expect(createdUser.dateOfBirth).toBeNull();
    expect(createdUser.mustChangePasscode).toBe(true);
    expect(createdUser.firstName).toBe('Added');
    expect(createdUser.surname).toBe('Manually');

    const grant = await superuser.roleGrant.findFirst({ where: { userId: createdUser.id, schoolId: schoolA.id, role: 'BRANCH_STAFF' } });
    expect(grant).not.toBeNull();
    expect(grant!.revokedAt).toBeNull();
    expect(grant!.branchId).toBe(branchA1.id);

    const sentEmail = sentEmails.find((e) => e.to === email);
    expect(sentEmail).toBeDefined();
    expect(() => extractTempPasscode(sentEmail!.body)).not.toThrow();
  });

  it('missing branchId is rejected — 400 (Branch Staff always needs a branch, unlike Instructor)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/role-grants/add-manually`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ firstName: 'No', surname: 'Branch', email: `staff-am-http-no-branch-${randomUUID()}@example.test` });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate email — 409, points at "Invite staff" instead', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/role-grants/add-manually`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ firstName: 'Dup', surname: 'Email', email: ownerA.email, branchId: branchA1.id });
    expect(res.status).toBe(409);
  });

  it('non-owner (Branch Staff) cannot use Add Manually — 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/role-grants/add-manually`)
      .set('Authorization', `Bearer ${tokenBranchStaffA1}`)
      .send({ firstName: 'No', surname: 'Permission', email: `staff-am-http-no-perm-${randomUUID()}@example.test`, branchId: branchA1.id });
    expect(res.status).toBe(403);
  });

  it('a branchId from another School is rejected — 400', async () => {
    const otherSchool = await superuser.school.create({ data: { id: randomUUID(), name: 'Staff Add-Manually HTTP School Other' } });
    const otherBranch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: otherSchool.id, name: 'Other Branch' } });
    try {
      const res = await request(app.getHttpServer())
        .post(`/v1/schools/${schoolA.id}/role-grants/add-manually`)
        .set('Authorization', `Bearer ${tokenOwnerA}`)
        .send({ firstName: 'Cross', surname: 'Tenant', email: `staff-am-http-cross-${randomUUID()}@example.test`, branchId: otherBranch.id });
      expect(res.status).toBe(400);
    } finally {
      await superuser.branch.delete({ where: { id: otherBranch.id } });
      await superuser.school.delete({ where: { id: otherSchool.id } });
    }
  });

  it('full smoke path: add-manually -> login (must change passcode) -> first-login change -> real session; the old temp passcode then fails', async () => {
    const email = `staff-am-http-smoke-${randomUUID()}@example.test`;
    const created = await request(app.getHttpServer())
      .post(`/v1/schools/${schoolA.id}/role-grants/add-manually`)
      .set('Authorization', `Bearer ${tokenOwnerA}`)
      .send({ firstName: 'Smoke', surname: 'Path', email, branchId: branchA1.id });
    expect(created.status).toBe(201);
    roleGrantIds.push(created.body.id);

    const sentEmail = sentEmails.find((e) => e.to === email);
    const tempPasscode = extractTempPasscode(sentEmail!.body);

    const firstLogin = await request(app.getHttpServer()).post('/v1/auth/login').send({ email, passcode: tempPasscode });
    expect(firstLogin.status).toBe(201);
    expect(firstLogin.body.mustChangePasscode).toBe(true);
    expect(typeof firstLogin.body.passcodeChangeToken).toBe('string');
    expect(firstLogin.body.accessToken).toBeUndefined();

    // The passcode-change token cannot be used anywhere else.
    const misuse = await request(app.getHttpServer())
      .get(`/v1/schools/${schoolA.id}/role-grants/invite-candidate?email=${encodeURIComponent(email)}`)
      .set('Authorization', `Bearer ${firstLogin.body.passcodeChangeToken}`);
    expect(misuse.status).toBe(403);

    const change = await request(app.getHttpServer())
      .post('/v1/auth/passcode-change/first-login')
      .set('Authorization', `Bearer ${firstLogin.body.passcodeChangeToken}`)
      .send({ newPasscode: '424242' });
    expect(change.status).toBe(201);
    expect(typeof change.body.accessToken).toBe('string');
    expect(typeof change.body.refreshToken).toBe('string');

    // The old temp passcode no longer works.
    const oldPasscodeLogin = await request(app.getHttpServer()).post('/v1/auth/login').send({ email, passcode: tempPasscode });
    expect(oldPasscodeLogin.status).toBe(401);

    // The new passcode logs in normally — no more mustChangePasscode.
    const secondLogin = await request(app.getHttpServer()).post('/v1/auth/login').send({ email, passcode: '424242' });
    expect(secondLogin.status).toBe(201);
    expect(typeof secondLogin.body.accessToken).toBe('string');
    expect(secondLogin.body.mustChangePasscode).toBeUndefined();
  });
});
