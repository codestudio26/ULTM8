/**
 * HTTP-level gate for WaiversModule (Phase 10) — Waiver CRUD, Student self-signing,
 * the double-sign guard, and the /waivers/me-vs-/waivers/:id route-ordering fix
 * caught before this ever ran. Same ground rule as every other e2e spec in this
 * repo: prove over real HTTP, not just by reading the code.
 *
 * Also includes ONE direct-Prisma RLS test (not HTTP), mirroring
 * memberships.e2e-spec.ts's own — WaiverSignature deliberately reuses Phase 9's
 * narrow "School Owner/Manager or the row's own Student" RLS shape (see the
 * migration's own comment), not Waiver's broad catalog-read shape; this proves
 * that holds against real Postgres.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET. The drawn-signature-
 * capture tests (Phase 34) additionally require R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/
 * R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME — gated separately (describeIfR2 below), not
 * folded into the main hasDb gate, so this file's existing CRUD/signing/RLS
 * coverage keeps running locally even without R2 configured. Fake-but-valid-shaped
 * R2 credentials are safe in CI for presigned-URL generation (never makes a network
 * call — see ci.yml's own comment). R2ClientService.objectExists() is the one
 * exception — a genuine network round-trip — so it's stubbed via NestJS's
 * overrideProvider (see `stubR2Client` below), the same pattern
 * platform-admin-auth.e2e-spec.ts already established for
 * CognitoTokenVerifierService.verify(); everything else on the stub delegates to a
 * real R2ClientService instance so the presigned-URL assertions below are still
 * exercising real code, not a mock.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { R2ClientService } from '../src/waivers/r2-client.service';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[waivers.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

const hasR2 = Boolean(
  process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME,
);
const describeIfR2 = hasR2 ? describe : describe.skip;
if (hasDb && !hasR2) {
  // eslint-disable-next-line no-console
  console.warn(
    '[waivers.e2e-spec] Drawn-signature-capture tests skipped — R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / ' +
      'R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME not set. CI sets fake-but-valid-shaped values for exactly ' +
      'this reason (see ci.yml\'s own comment) — a local skip here is not a substitute for that.',
  );
}

describeIfDb('WaiversModule — HTTP-level CRUD, signing, and RLS', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const appDb = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let school: { id: string };
  let owner: { id: string; email: string };
  let studentA: { id: string; email: string };
  let studentB: { id: string; email: string };
  let studentMinor: { id: string; email: string };
  let outsider: { id: string; email: string };
  let guardian: { id: string; email: string };
  let tokenOwner: string;
  let tokenStudentA: string;
  let tokenStudentB: string;
  let tokenStudentMinor: string;
  let tokenOutsider: string;
  let tokenGuardian: string;

  const waiverIds: string[] = [];
  const signatureIds: string[] = [];

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>>) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  async function withUser<T>(userId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return appDb.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${userId}'`);
      return fn(tx as unknown as PrismaClient);
    });
  }

  // Mutable so a single test can control whether objectExists() reports an
  // upload as present without a real R2 round-trip — see this file's own
  // header comment. Defaults to true so every OTHER test (which never cares
  // about this branch) doesn't have to remember to reset it.
  let stubObjectExists = true;
  const realR2Client = new R2ClientService(); // reads real (CI: fake-but-valid-shaped) env vars
  const stubR2Client: Pick<R2ClientService, 'getPresignedUploadUrl' | 'getPresignedDownloadUrl' | 'objectExists'> = {
    getPresignedUploadUrl: (key, contentType) => realR2Client.getPresignedUploadUrl(key, contentType),
    getPresignedDownloadUrl: (key) => realR2Client.getPresignedDownloadUrl(key),
    objectExists: async () => stubObjectExists,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2ClientService)
      .useValue(stubR2Client)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: 'Waivers HTTP School' } });

    const mkUser = (label: string, dateOfBirth = new Date('2000-01-01')) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `waivers-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
          firstName: label,
          surname: 'Tenant',
          passcodeHash: 'x',
          dateOfBirth,
          phoneVerifiedAt: new Date(),
        },
      });

    owner = await mkUser('owner');
    studentA = await mkUser('student-a');
    studentB = await mkUser('student-b');
    // 10 years old relative to "today" — well under the confirmed 18 age-of-
    // majority threshold (Decision 77), regardless of what "today" actually is
    // when this suite runs.
    const tenYearsAgo = new Date();
    tenYearsAgo.setUTCFullYear(tenYearsAgo.getUTCFullYear() - 10);
    studentMinor = await mkUser('student-minor', tenYearsAgo);
    outsider = await mkUser('outsider');
    guardian = await mkUser('guardian');

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentA.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentB.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentMinor.id, schoolId: school.id },
      ],
    });

    // Phase 37 — Guardian-on-behalf-of signing. GuardianLink is platform-scoped
    // (Decision 92), not School-scoped, so it's seeded directly rather than via
    // any School-scoped fixture — same direct-Prisma-seed convention
    // guardians.e2e-spec.ts's own "withdrawing BASELINE..." test already
    // established for a minor's STUDENT RoleGrant (studentMinor's own RoleGrant
    // above stands in for the still-unbuilt Guardian-on-behalf-of enrollment
    // path — see WaiversService.sign()'s own header comment for that known gap).
    await superuser.guardianLink.create({
      data: { id: randomUUID(), guardianId: guardian.id, studentId: studentMinor.id },
    });

    tokenOwner = signAccessToken(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentA = signAccessToken(studentA, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentB = signAccessToken(studentB, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentMinor = signAccessToken(studentMinor, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenOutsider = signAccessToken(outsider, []);
    tokenGuardian = signAccessToken(guardian, [{ role: 'GUARDIAN', franchiseId: null, schoolId: null, branchId: null }]);
  });

  afterAll(async () => {
    await superuser.guardianLink.deleteMany({ where: { guardianId: guardian.id } });
    // Phase 15 — creating a Waiver above for real enqueues waiver-signature-
    // requests, which (unlike its old log-only-stub self) now fans out a real
    // Notification row per Student at this School via a live worker consuming
    // real CI Redis, asynchronously, outside this test's own control. Found
    // when this exact cleanup started failing on Notification's own
    // ON DELETE RESTRICT foreign key. Queried by the same email pattern the
    // final `user.deleteMany` below already trusts, not a hand-maintained id
    // list — matches the same fix in bookings.e2e-spec.ts's own afterAll.
    const createdUserIds = (
      await superuser.user.findMany({ where: { email: { contains: 'waivers-http-' } }, select: { id: true } })
    ).map((u) => u.id);
    await superuser.notification.deleteMany({ where: { userId: { in: createdUserIds } } });
    await superuser.waiverSignature.deleteMany({ where: { id: { in: signatureIds } } });
    await superuser.waiver.deleteMany({ where: { id: { in: waiverIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.user.deleteMany({ where: { email: { contains: 'waivers-http-' } } });
    await superuser.school.delete({ where: { id: school.id } });
    await superuser.$disconnect();
    await appDb.$disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Waiver CRUD
  // ---------------------------------------------------------------------------

  it('School Owner CAN create a Waiver; a Student cannot', async () => {
    const forbidden = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/waivers`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ title: 'Denied', body: 'text' });
    expect(forbidden.status).toBe(403);

    const res = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/waivers`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Liability Waiver', body: 'By signing, I acknowledge the risks of training...' });
    expect(res.status).toBe(201);
    waiverIds.push(res.body.id);
    expect(res.body.schoolId).toBe(school.id);
  });

  it('School Owner CAN list and update the Waiver; a cross-School caller cannot read it', async () => {
    const listRes = await request(app.getHttpServer())
      .get(`/v1/schools/${school.id}/waivers`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items.length).toBeGreaterThan(0);

    const updateRes = await request(app.getHttpServer())
      .patch(`/v1/waivers/${waiverIds[0]}`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Updated Liability Waiver' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.title).toBe('Updated Liability Waiver');

    const outsiderRes = await request(app.getHttpServer())
      .get(`/v1/waivers/${waiverIds[0]}`)
      .set('Authorization', `Bearer ${tokenOutsider}`);
    expect(outsiderRes.status).toBe(404); // RLS-blocked, indistinguishable from not-found by design
  });

  // ---------------------------------------------------------------------------
  // Signing
  // ---------------------------------------------------------------------------

  it('a Student CAN sign a Waiver, and it appears in their own GET /waivers/me', async () => {
    const signRes = await request(app.getHttpServer())
      .post(`/v1/waivers/${waiverIds[0]}/sign`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ signerFullName: 'Student A', signatureText: 'Student A' });
    expect(signRes.status).toBe(201);
    expect(signRes.body.status).toBe('SIGNED');
    // Phase 37 — self-signing always records signedById === studentId (the
    // caller signed for themselves, no Guardian involved).
    expect(signRes.body.signedById).toBe(studentA.id);
    expect(signRes.body.studentId).toBe(studentA.id);
    signatureIds.push(signRes.body.id);

    // Route-ordering check: /waivers/me must resolve to the dedicated handler, not
    // fall through to GET /waivers/:id with id='me' — caught before build, see the
    // controller's own comment.
    const meRes = await request(app.getHttpServer())
      .get('/v1/waivers/me')
      .set('Authorization', `Bearer ${tokenStudentA}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.items.some((s: { id: string }) => s.id === signRes.body.id)).toBe(true);
  });

  it('a second non-Expired signature for the same Student/Waiver is rejected — 409', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/waivers/${waiverIds[0]}/sign`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ signerFullName: 'Student A', signatureText: 'Student A again' });
    expect(res.status).toBe(409);
  });

  it('a different Student CAN independently sign the same Waiver', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/waivers/${waiverIds[0]}/sign`)
      .set('Authorization', `Bearer ${tokenStudentB}`)
      .send({ signerFullName: 'Student B', signatureText: 'Student B' });
    expect(res.status).toBe(201);
    signatureIds.push(res.body.id);
  });

  it('a Student under the confirmed age-of-majority (18) is rejected — no Guardian-linked path exists yet', async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/waivers/${waiverIds[0]}/sign`)
      .set('Authorization', `Bearer ${tokenStudentMinor}`)
      .send({ signerFullName: 'Student Minor', signatureText: 'Student Minor' });
    expect(res.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // Guardian-on-behalf-of signing (Phase 37).
  // ---------------------------------------------------------------------------

  it('a Guardian CAN sign a Waiver on behalf of their linked minor — signedById is the Guardian, studentId is the minor', async () => {
    const waiverRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/waivers`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Guardian-Signed Waiver', body: 'text' });
    waiverIds.push(waiverRes.body.id);

    const signRes = await request(app.getHttpServer())
      .post(`/v1/waivers/${waiverRes.body.id}/sign`)
      .set('Authorization', `Bearer ${tokenGuardian}`)
      .send({ studentId: studentMinor.id, signerFullName: 'Guardian Of Minor', signatureText: 'Guardian Of Minor' });
    expect(signRes.status).toBe(201);
    expect(signRes.body.status).toBe('SIGNED');
    expect(signRes.body.studentId).toBe(studentMinor.id);
    expect(signRes.body.signedById).toBe(guardian.id);
    signatureIds.push(signRes.body.id);

    // The minor's own self-attested-adult age check never ran for this
    // Guardian-authenticated path — proven independently by the fact this
    // succeeded at all, since studentMinor is 10 (well under 18).
  });

  it('a Guardian with NO active link to the target Student is rejected — 403, not a silent no-op', async () => {
    const waiverRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/waivers`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Unlinked Guardian Waiver', body: 'text' });
    waiverIds.push(waiverRes.body.id);

    // `outsider` holds no GuardianLink to studentMinor at all.
    const res = await request(app.getHttpServer())
      .post(`/v1/waivers/${waiverRes.body.id}/sign`)
      .set('Authorization', `Bearer ${tokenOutsider}`)
      .send({ studentId: studentMinor.id, signerFullName: 'Not A Guardian', signatureText: 'Not A Guardian' });
    expect(res.status).toBe(403);
  });

  it('an ordinary Student cannot sign on behalf of a different Student either — assertGuardianOfStudent blocks it the same way', async () => {
    const waiverRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/waivers`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Student Impersonation Attempt Waiver', body: 'text' });
    waiverIds.push(waiverRes.body.id);

    const res = await request(app.getHttpServer())
      .post(`/v1/waivers/${waiverRes.body.id}/sign`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ studentId: studentB.id, signerFullName: 'Student A', signatureText: 'Student A' });
    expect(res.status).toBe(403);
  });

  it('signing with no signatureImageKey still works and returns signatureImageUrl: null (typed-name-only remains valid)', async () => {
    // A fresh Waiver — waiverIds[0] is already signed by studentA/studentB above,
    // and re-signing would 409 regardless of what this test is actually checking.
    const waiverRes = await request(app.getHttpServer())
      .post(`/v1/schools/${school.id}/waivers`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'No-Image Waiver', body: 'text' });
    waiverIds.push(waiverRes.body.id);

    const signRes = await request(app.getHttpServer())
      .post(`/v1/waivers/${waiverRes.body.id}/sign`)
      .set('Authorization', `Bearer ${tokenStudentA}`)
      .send({ signerFullName: 'Student A', signatureText: 'Student A' });
    expect(signRes.status).toBe(201);
    expect(signRes.body.signatureImageUrl).toBeNull();
    signatureIds.push(signRes.body.id);
  });

  // ---------------------------------------------------------------------------
  // Drawn-signature capture (Phase 34) — gated separately on R2 config, see this
  // file's own header comment.
  // ---------------------------------------------------------------------------

  describeIfR2('drawn-signature capture', () => {
    let imageWaiverId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/schools/${school.id}/waivers`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ title: 'Image Waiver', body: 'text' });
      imageWaiverId = res.body.id;
      waiverIds.push(imageWaiverId);
    });

    it('POST /waivers/:id/signature-upload-url returns a presigned PUT URL and a correctly-prefixed objectKey', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/waivers/${imageWaiverId}/signature-upload-url`)
        .set('Authorization', `Bearer ${tokenStudentA}`);
      expect(res.status).toBe(201);
      // Exact prefix WaiversService.sign() will validate against — proven here
      // independently of that validation logic, not assumed to match it.
      expect(res.body.objectKey).toMatch(new RegExp(`^waiver-signatures/${school.id}/${imageWaiverId}/${studentA.id}/.+\\.png$`));
      expect(res.body.uploadUrl).toMatch(/^https:\/\/.+X-Amz-Signature=/);
    });

    it('sign() with a matching signatureImageKey succeeds and returns a well-formed presigned GET URL', async () => {
      const uploadUrlRes = await request(app.getHttpServer())
        .post(`/v1/waivers/${imageWaiverId}/signature-upload-url`)
        .set('Authorization', `Bearer ${tokenStudentA}`);

      const signRes = await request(app.getHttpServer())
        .post(`/v1/waivers/${imageWaiverId}/sign`)
        .set('Authorization', `Bearer ${tokenStudentA}`)
        .send({ signerFullName: 'Student A', signatureText: 'Student A', signatureImageKey: uploadUrlRes.body.objectKey });
      expect(signRes.status).toBe(201);
      signatureIds.push(signRes.body.id);
      // No raw signatureImageKey should ever reach the response — only the
      // computed, presigned signatureImageUrl (see WaiversService's own
      // toSignatureResponse() comment for why this was worth a dedicated test).
      expect(signRes.body.signatureImageKey).toBeUndefined();
      expect(signRes.body.signatureImageUrl).toMatch(/^https:\/\/.+X-Amz-Signature=/);

      const meRes = await request(app.getHttpServer()).get('/v1/waivers/me').set('Authorization', `Bearer ${tokenStudentA}`);
      const listed = meRes.body.items.find((s: { id: string }) => s.id === signRes.body.id);
      expect(listed.signatureImageUrl).toMatch(/^https:\/\/.+X-Amz-Signature=/);
    });

    it('sign() rejects a signatureImageKey that does not match this waiver/caller — 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/waivers/${imageWaiverId}/sign`)
        .set('Authorization', `Bearer ${tokenStudentB}`)
        .send({
          signerFullName: 'Student B',
          signatureText: 'Student B',
          // A syntactically plausible key, but for a DIFFERENT student — not one
          // this caller was ever actually issued.
          signatureImageKey: `waiver-signatures/${school.id}/${imageWaiverId}/${studentA.id}/not-mine.png`,
        });
      expect(res.status).toBe(400);
    });

    it('sign() rejects a signatureImageKey with the right school/student but the WRONG waiverId — 400', async () => {
      // A second Waiver studentB has never touched — proves the prefix check
      // genuinely binds to THIS waiverId, not just schoolId+studentId (a gap the
      // "not-mine" test above, which only varies studentId, doesn't cover).
      const otherWaiverRes = await request(app.getHttpServer())
        .post(`/v1/schools/${school.id}/waivers`)
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({ title: 'Other Waiver', body: 'text' });
      waiverIds.push(otherWaiverRes.body.id);

      const res = await request(app.getHttpServer())
        .post(`/v1/waivers/${otherWaiverRes.body.id}/sign`)
        .set('Authorization', `Bearer ${tokenStudentB}`)
        .send({
          signerFullName: 'Student B',
          signatureText: 'Student B',
          // Correct schoolId/studentId, but issued for imageWaiverId, not this
          // (otherWaiverRes) waiver.
          signatureImageKey: `waiver-signatures/${school.id}/${imageWaiverId}/${studentB.id}/wrong-waiver.png`,
        });
      expect(res.status).toBe(400);
    });

    it('sign() rejects a correctly-prefixed signatureImageKey that was never actually uploaded — 400', async () => {
      const uploadUrlRes = await request(app.getHttpServer())
        .post(`/v1/waivers/${imageWaiverId}/signature-upload-url`)
        .set('Authorization', `Bearer ${tokenStudentB}`);

      // Stubbed false, not a real R2 check — see this file's own header comment
      // on why objectExists() specifically can't run against fake CI credentials.
      // Proves sign() actually calls and honors objectExists(), not just the
      // prefix check (which this key would otherwise pass).
      stubObjectExists = false;
      try {
        const res = await request(app.getHttpServer())
          .post(`/v1/waivers/${imageWaiverId}/sign`)
          .set('Authorization', `Bearer ${tokenStudentB}`)
          .send({ signerFullName: 'Student B', signatureText: 'Student B', signatureImageKey: uploadUrlRes.body.objectKey });
        expect(res.status).toBe(400);
      } finally {
        stubObjectExists = true; // don't leak into any test that runs after this one
      }
    });

    it('a Guardian requesting an upload URL on behalf of a linked minor gets a key prefixed with the MINOR\'s id, not the Guardian\'s', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/waivers/${imageWaiverId}/signature-upload-url`)
        .set('Authorization', `Bearer ${tokenGuardian}`)
        .send({ studentId: studentMinor.id });
      expect(res.status).toBe(201);
      expect(res.body.objectKey).toMatch(
        new RegExp(`^waiver-signatures/${school.id}/${imageWaiverId}/${studentMinor.id}/.+\\.png$`),
      );
    });

    it('a Guardian CAN complete drawn-signature-capture end-to-end on behalf of a linked minor', async () => {
      const uploadUrlRes = await request(app.getHttpServer())
        .post(`/v1/waivers/${imageWaiverId}/signature-upload-url`)
        .set('Authorization', `Bearer ${tokenGuardian}`)
        .send({ studentId: studentMinor.id });

      const signRes = await request(app.getHttpServer())
        .post(`/v1/waivers/${imageWaiverId}/sign`)
        .set('Authorization', `Bearer ${tokenGuardian}`)
        .send({
          studentId: studentMinor.id,
          signerFullName: 'Guardian Of Minor',
          signatureText: 'Guardian Of Minor',
          signatureImageKey: uploadUrlRes.body.objectKey,
        });
      expect(signRes.status).toBe(201);
      expect(signRes.body.studentId).toBe(studentMinor.id);
      expect(signRes.body.signedById).toBe(guardian.id);
      expect(signRes.body.signatureImageUrl).toMatch(/^https:\/\/.+X-Amz-Signature=/);
      signatureIds.push(signRes.body.id);
    });
  });

  // ---------------------------------------------------------------------------
  // RLS — WaiverSignature deliberately reuses Phase 9's narrow shape, not
  // Waiver's own broad catalog-read shape. Direct Prisma, not HTTP — no HTTP
  // endpoint exposes another Student's raw signature to probe this via supertest
  // alone, same reasoning memberships.e2e-spec.ts's own RLS test documents.
  // ---------------------------------------------------------------------------

  it('RLS: Student B cannot read Student A\'s WaiverSignature rows, even sharing a School', async () => {
    const asStudentB = await withUser(studentB.id, (tx) =>
      tx.waiverSignature.findMany({ where: { studentId: studentA.id } }),
    );
    expect(asStudentB).toHaveLength(0);

    const asOwner = await withUser(owner.id, (tx) => tx.waiverSignature.findMany({ where: { studentId: studentA.id } }));
    expect(asOwner.length).toBeGreaterThan(0);

    const asStudentASelf = await withUser(studentA.id, (tx) => tx.waiverSignature.findMany({ where: { studentId: studentA.id } }));
    expect(asStudentASelf.length).toBeGreaterThan(0);
  });
});
