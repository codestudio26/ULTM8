/**
 * HTTP-level gate for UploadsModule — real photo uploads, product-owner-
 * approved (see apps/api/src/uploads/uploads.module.ts's own header comment
 * and CHANGELOG.md "Unreleased"). Proves, over real HTTP (same ground rule as
 * every other e2e spec in this repo):
 *   - each entityType's own authorization gate (School Owner for
 *     INSTRUCTOR/BRANCH/CLASS, Franchise Owner for FRANCHISE, Staff-on-
 *     behalf-of-a-Student for USER, self for USER with no entityId)
 *   - the "can't request a key under a different School's/Franchise's own
 *     namespace" cross-tenant check (an `entityId` that doesn't belong to the
 *     claimed `schoolId`/`franchiseId`)
 *   - the FRANCHISE "no franchiseId yet" branch needs no gate at all,
 *     mirroring `POST /franchises` itself (any authenticated user)
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET. The actual
 * presign-URL-VALUE assertions (which call through to R2ClientService's real
 * S3Client, requiring R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/
 * R2_BUCKET_NAME/R2_PUBLIC_BUCKET_NAME/R2_PUBLIC_BASE_URL) are gated
 * separately (describeIfR2 below) — not folded into the main hasDb gate, so
 * this file's authorization-gate coverage keeps running locally even without
 * R2 configured (this environment's own apps/api/.env has no R2 vars set at
 * all). Mirrors waivers.e2e-spec.ts's own describeIfR2 gating exactly:
 * fake-but-valid-shaped R2 credentials are safe in CI for presigned-URL
 * generation (never makes a network call — see ci.yml's own comment).
 *
 * Every REJECTION path (403/404/400) below never reaches R2ClientService at
 * all — the authorization/validation check in UploadsService always runs and
 * throws BEFORE the final getPublicPhotoUploadUrl()/getPublicPhotoUrl() calls
 * — so those run unconditionally under describeIfDb, not nested inside
 * describeIfR2. Only the SUCCESS-path assertions (a real 201 with a real
 * presigned uploadUrl/publicUrl) need R2 configured.
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
    '[uploads.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

const hasR2 = Boolean(
  process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME &&
    process.env.R2_PUBLIC_BUCKET_NAME &&
    process.env.R2_PUBLIC_BASE_URL,
);
const describeIfR2 = hasR2 ? describe : describe.skip;
if (hasDb && !hasR2) {
  // eslint-disable-next-line no-console
  console.warn(
    '[uploads.e2e-spec] Success-path (real presigned URL) tests skipped — R2_ACCOUNT_ID / ' +
      'R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME / R2_PUBLIC_BUCKET_NAME / ' +
      "R2_PUBLIC_BASE_URL not all set. CI sets fake-but-valid-shaped values for exactly this " +
      'reason (see ci.yml\'s own comment) — a local skip here is not a substitute for that.',
  );
}

describeIfDb('UploadsModule — HTTP-level authorization gates for POST /uploads/public-photo-url', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let schoolA: { id: string };
  let schoolB: { id: string };
  let branchA: { id: string };
  let instructorA: { id: string };
  let classA: { id: string };
  let franchiseId: string;
  let ownerA: { id: string; email: string };
  let ownerB: { id: string; email: string };
  let franchiseOwner: { id: string; email: string };
  let studentA: { id: string; email: string };
  let studentOutsider: { id: string; email: string };
  let plainOutsider: { id: string; email: string };
  let tokenOwnerA: string;
  let tokenOwnerB: string;
  let tokenFranchiseOwner: string;
  let tokenStudentA: string;
  let tokenPlainOutsider: string;

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    schoolA = await superuser.school.create({ data: { id: randomUUID(), name: 'Uploads HTTP School A' } });
    schoolB = await superuser.school.create({ data: { id: randomUUID(), name: 'Uploads HTTP School B' } });
    branchA = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolA.id, name: 'Branch A' } });

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `uploads-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
        },
      });

    ownerA = await mkUser('owner-a');
    ownerB = await mkUser('owner-b');
    franchiseOwner = await mkUser('franchise-owner');
    studentA = await mkUser('student-a');
    studentOutsider = await mkUser('student-outsider');
    plainOutsider = await mkUser('plain-outsider');

    const instructorUser = await mkUser('instructor-a');
    const instructorRow = await superuser.instructor.create({
      data: { id: randomUUID(), schoolId: schoolA.id, userId: instructorUser.id },
    });
    instructorA = { id: instructorRow.id };

    const classRow = await superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: schoolA.id,
        title: 'Uploads HTTP Class A',
        activities: ['Jiu Jitsu'],
        startDate: new Date(),
        endDate: new Date(Date.now() + 3600_000),
      },
    });
    classA = { id: classRow.id };

    const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'Uploads HTTP Franchise' } });
    franchiseId = franchise.id;

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerA.id, schoolId: schoolA.id },
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: ownerB.id, schoolId: schoolB.id },
        { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: franchiseOwner.id, franchiseId },
        { id: randomUUID(), role: 'STUDENT', userId: studentA.id, schoolId: schoolA.id },
        { id: randomUUID(), role: 'INSTRUCTOR', userId: instructorUser.id, schoolId: schoolA.id },
        // studentOutsider deliberately holds NO grant at schoolA at all.
      ],
    });

    tokenOwnerA = signAccessToken(ownerA, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolA.id, branchId: null }]);
    tokenOwnerB = signAccessToken(ownerB, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolB.id, branchId: null }]);
    tokenFranchiseOwner = signAccessToken(franchiseOwner, [{ role: 'FRANCHISE_OWNER', franchiseId, schoolId: null, branchId: null }]);
    tokenStudentA = signAccessToken(studentA, [{ role: 'STUDENT', franchiseId: null, schoolId: schoolA.id, branchId: null }]);
    tokenPlainOutsider = signAccessToken(plainOutsider, []);
  });

  afterAll(async () => {
    await superuser.instructor.deleteMany({ where: { schoolId: schoolA.id } });
    await superuser.class.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await superuser.roleGrant.deleteMany({ where: { OR: [{ schoolId: schoolA.id }, { schoolId: schoolB.id }, { franchiseId }] } });
    await superuser.branch.deleteMany({ where: { schoolId: schoolA.id } });
    await superuser.user.deleteMany({ where: { email: { contains: 'uploads-http-' } } });
    await superuser.franchise.delete({ where: { id: franchiseId } });
    await superuser.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await superuser.$disconnect();
    await app.close();
  });

  function post(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/v1/uploads/public-photo-url')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  // ---------------------------------------------------------------------------
  // Rejection paths — never reach R2, so these run unconditionally.
  // ---------------------------------------------------------------------------

  it('a Student (not School Owner) is rejected for entityType INSTRUCTOR — 403', async () => {
    const res = await post(tokenStudentA, { entityType: 'INSTRUCTOR', schoolId: schoolA.id, contentType: 'image/png' });
    expect(res.status).toBe(403);
  });

  it("School B's Owner cannot request an upload URL scoped to School A — 404 (not visible)", async () => {
    const res = await post(tokenOwnerB, { entityType: 'BRANCH', schoolId: schoolA.id, contentType: 'image/png' });
    expect(res.status).toBe(404);
  });

  it('School Owner A requesting a BRANCH upload URL for an entityId that does not belong to schoolId A — 400', async () => {
    const otherBranch = await superuser.branch.create({ data: { id: randomUUID(), schoolId: schoolB.id, name: 'Branch B' } });
    try {
      const res = await post(tokenOwnerA, { entityType: 'BRANCH', schoolId: schoolA.id, entityId: otherBranch.id, contentType: 'image/png' });
      expect(res.status).toBe(400);
    } finally {
      await superuser.branch.delete({ where: { id: otherBranch.id } });
    }
  });

  it('School Owner A requesting an INSTRUCTOR upload URL for an entityId outside their own School — 404', async () => {
    const otherInstructorUser = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `uploads-http-instructor-b-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'InstructorB',
        surname: 'Tenant',
        passcodeHash: 'x',
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    const otherInstructor = await superuser.instructor.create({
      data: { id: randomUUID(), schoolId: schoolB.id, userId: otherInstructorUser.id },
    });
    try {
      const res = await post(tokenOwnerA, { entityType: 'INSTRUCTOR', schoolId: schoolA.id, entityId: otherInstructor.id, contentType: 'image/png' });
      expect(res.status).toBe(404);
    } finally {
      await superuser.instructor.delete({ where: { id: otherInstructor.id } });
      await superuser.user.delete({ where: { id: otherInstructorUser.id } });
    }
  });

  it('School Owner A requesting a CLASS upload URL for an entityId outside their own School — 404', async () => {
    const otherClass = await superuser.class.create({
      data: {
        id: randomUUID(),
        schoolId: schoolB.id,
        title: 'Other School Class',
        activities: ['Judo'],
        startDate: new Date(),
        endDate: new Date(Date.now() + 3600_000),
      },
    });
    try {
      const res = await post(tokenOwnerA, { entityType: 'CLASS', schoolId: schoolA.id, entityId: otherClass.id, contentType: 'image/png' });
      expect(res.status).toBe(404);
    } finally {
      await superuser.class.delete({ where: { id: otherClass.id } });
    }
  });

  it('entityType FRANCHISE with a franchiseId the caller does not own — 403', async () => {
    const res = await post(tokenOwnerA, { entityType: 'FRANCHISE', franchiseId, contentType: 'image/png' });
    expect(res.status).toBe(403);
  });

  it('entityType FRANCHISE with NO franchiseId needs no gate — any authenticated user, even one holding no grants anywhere', async () => {
    if (!hasR2) return; // success path — needs R2 configured, see this file's own header comment
    const res = await post(tokenPlainOutsider, { entityType: 'FRANCHISE', contentType: 'image/png' });
    expect(res.status).toBe(201);
  });

  it('entityType USER with no entityId (self) needs no further gate for any authenticated user', async () => {
    if (!hasR2) return;
    const res = await post(tokenPlainOutsider, { entityType: 'USER', contentType: 'image/png' });
    expect(res.status).toBe(201);
  });

  it('entityType USER on behalf of someone else with NO schoolId — 400', async () => {
    const res = await post(tokenOwnerA, { entityType: 'USER', entityId: studentA.id, contentType: 'image/png' });
    expect(res.status).toBe(400);
  });

  it('entityType USER on behalf of a Student NOT enrolled at the claimed School — 404', async () => {
    const res = await post(tokenOwnerA, { entityType: 'USER', schoolId: schoolA.id, entityId: studentOutsider.id, contentType: 'image/png' });
    expect(res.status).toBe(404);
  });

  it('entityType USER on behalf of another Student, requested by a non-Staff caller (another Student) — 403', async () => {
    const res = await post(tokenStudentA, { entityType: 'USER', schoolId: schoolA.id, entityId: studentOutsider.id, contentType: 'image/png' });
    expect(res.status).toBe(403);
  });

  it('a disallowed contentType is rejected by validation — 400', async () => {
    const res = await post(tokenOwnerA, { entityType: 'BRANCH', schoolId: schoolA.id, contentType: 'application/pdf' });
    expect(res.status).toBe(400);
  });

  it('an unauthenticated request is rejected — 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/uploads/public-photo-url')
      .send({ entityType: 'BRANCH', schoolId: schoolA.id, contentType: 'image/png' });
    expect(res.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Success paths — need R2 configured (presigned URL generation is a real
  // S3Client call, even though it never leaves this process — see
  // R2ClientService's own header comment).
  // ---------------------------------------------------------------------------

  describeIfR2('success paths — real presigned uploadUrl/publicUrl', () => {
    it('School Owner A gets a presigned URL + public URL for a brand-new Instructor (no entityId yet)', async () => {
      const res = await post(tokenOwnerA, { entityType: 'INSTRUCTOR', schoolId: schoolA.id, contentType: 'image/png' });
      expect(res.status).toBe(201);
      expect(res.body.uploadUrl).toMatch(/^https:\/\/.+X-Amz-Signature=/);
      expect(res.body.publicUrl).toMatch(new RegExp(`^https://.+/public-photos/instructor/${schoolA.id}/.+\\.png$`));
    });

    it('School Owner A gets a presigned URL for an EXISTING Instructor profile at their own School', async () => {
      const res = await post(tokenOwnerA, { entityType: 'INSTRUCTOR', schoolId: schoolA.id, entityId: instructorA.id, contentType: 'image/jpeg' });
      expect(res.status).toBe(201);
      expect(res.body.publicUrl).toMatch(new RegExp(`^https://.+/public-photos/instructor/${schoolA.id}/${instructorA.id}/.+\\.jpg$`));
    });

    it('School Owner A gets a presigned URL for their existing Branch', async () => {
      const res = await post(tokenOwnerA, { entityType: 'BRANCH', schoolId: schoolA.id, entityId: branchA.id, contentType: 'image/webp' });
      expect(res.status).toBe(201);
      expect(res.body.publicUrl).toMatch(new RegExp(`^https://.+/public-photos/branch/${schoolA.id}/${branchA.id}/.+\\.webp$`));
    });

    it('School Owner A gets a presigned URL for their existing Class', async () => {
      const res = await post(tokenOwnerA, { entityType: 'CLASS', schoolId: schoolA.id, entityId: classA.id, contentType: 'image/png' });
      expect(res.status).toBe(201);
      expect(res.body.publicUrl).toMatch(new RegExp(`^https://.+/public-photos/class/${schoolA.id}/${classA.id}/.+\\.png$`));
    });

    it('the Franchise Owner gets a presigned URL for their own, existing Franchise', async () => {
      const res = await post(tokenFranchiseOwner, { entityType: 'FRANCHISE', franchiseId, entityId: franchiseId, contentType: 'image/png' });
      expect(res.status).toBe(201);
      expect(res.body.publicUrl).toMatch(new RegExp(`^https://.+/public-photos/franchise/${franchiseId}/${franchiseId}/.+\\.png$`));
    });

    it('a Student gets a presigned URL for their own profile photo', async () => {
      const res = await post(tokenStudentA, { entityType: 'USER', contentType: 'image/png' });
      expect(res.status).toBe(201);
      expect(res.body.publicUrl).toMatch(new RegExp(`^https://.+/public-photos/user/${studentA.id}/${studentA.id}/.+\\.png$`));
    });

    it("School Owner A (Staff at the Student's School) gets a presigned URL on behalf of Student A", async () => {
      const res = await post(tokenOwnerA, { entityType: 'USER', schoolId: schoolA.id, entityId: studentA.id, contentType: 'image/jpeg' });
      expect(res.status).toBe(201);
      expect(res.body.publicUrl).toMatch(new RegExp(`^https://.+/public-photos/user/${studentA.id}/${studentA.id}/.+\\.jpg$`));
    });
  });
});
