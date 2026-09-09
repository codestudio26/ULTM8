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
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET.
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
    '[waivers.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
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
  let tokenOwner: string;
  let tokenStudentA: string;
  let tokenStudentB: string;
  let tokenStudentMinor: string;
  let tokenOutsider: string;

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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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

    await superuser.roleGrant.createMany({
      data: [
        { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentA.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentB.id, schoolId: school.id },
        { id: randomUUID(), role: 'STUDENT', userId: studentMinor.id, schoolId: school.id },
      ],
    });

    tokenOwner = signAccessToken(owner, [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentA = signAccessToken(studentA, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentB = signAccessToken(studentB, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenStudentMinor = signAccessToken(studentMinor, [{ role: 'STUDENT', franchiseId: null, schoolId: school.id, branchId: null }]);
    tokenOutsider = signAccessToken(outsider, []);
  });

  afterAll(async () => {
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
