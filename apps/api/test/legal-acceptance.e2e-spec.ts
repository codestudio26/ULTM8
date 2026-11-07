/**
 * Decision 444 (legal go-live fixes C1 and C5).
 *
 * C1: creating a School or a Franchise needs the owner's tick on the School and
 * Franchise Agreement, and the server saves which version was accepted and when.
 * C5: a Guardian's consent is saved with the Children notice version the server
 * publishes now, never the version string the app sends.
 *
 * Sign-up's own tick and 18+ check are covered in src/auth/auth.service.spec.ts
 * (registration sends an SMS, which this suite cannot).
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
  console.warn('[legal-acceptance.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

describeIfDb('Legal acceptance (Decision 444)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const userIds: string[] = [];
  const schoolIds: string[] = [];
  const franchiseIds: string[] = [];
  let owner: { id: string; email: string };
  let token: string;

  const http = () => request(app.getHttpServer());
  const mkUser = async (label: string, dateOfBirth = new Date('1990-01-01')) => {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `legal-${label}-${randomUUID()}@example.test`,
        phone: null,
        firstName: label,
        surname: 'Legal',
        passcodeHash: 'x',
        dateOfBirth,
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    return u;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    owner = await mkUser('owner');
    token = jwt.sign({ sub: owner.id, email: owner.email, grants: [] });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 1000));
    await superuser.consentRecord.deleteMany({ where: { guardianId: { in: userIds } } });
    await superuser.guardianLink.deleteMany({ where: { guardianId: { in: userIds } } });
    await superuser.roleGrant.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { franchiseId: { in: franchiseIds } }] } });
    await superuser.notification.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    // LegalAcceptance rows go with the user (ON DELETE CASCADE).
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('every legal page has a row with a version, served by GET /v1/legal/:slug', async () => {
    for (const slug of ['terms-and-conditions', 'privacy-statement', 'school-agreement', 'children-notice', 'cookie-notice']) {
      const res = await http().get(`/v1/legal/${slug}`);
      expect(res.status).toBe(200);
      expect(typeof res.body.version).toBe('string');
    }
  });

  it('a School is refused without the Agreement tick, and nothing is created', async () => {
    const name = `Legal No Tick ${randomUUID()}`;
    const res = await http().post('/v1/schools').set('Authorization', `Bearer ${token}`).send({ name });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AGREEMENT_NOT_ACCEPTED');
    expect(await superuser.school.count({ where: { name } })).toBe(0);
  });

  it('with the tick, the School is created and the accepted version is saved', async () => {
    const res = await http().post('/v1/schools').set('Authorization', `Bearer ${token}`).send({ name: `Legal Tick ${randomUUID()}`, acceptAgreement: true });
    expect(res.status).toBe(201);
    schoolIds.push(res.body.id);
    const doc = await superuser.legalDocument.findUniqueOrThrow({ where: { slug: 'school-agreement' } });
    const rows = await superuser.legalAcceptance.findMany({ where: { userId: owner.id, schoolId: res.body.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ documentSlug: 'school-agreement', version: doc.version, franchiseId: null });
  });

  it('a Franchise is refused without the tick, and saved with it', async () => {
    const refused = await http().post('/v1/franchises').set('Authorization', `Bearer ${token}`).send({ name: `Legal Franchise ${randomUUID()}` });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('AGREEMENT_NOT_ACCEPTED');

    const ok = await http().post('/v1/franchises').set('Authorization', `Bearer ${token}`).send({ name: `Legal Franchise ${randomUUID()}`, acceptAgreement: true });
    expect(ok.status).toBe(201);
    franchiseIds.push(ok.body.id);
    expect(await superuser.legalAcceptance.count({ where: { userId: owner.id, franchiseId: ok.body.id, documentSlug: 'school-agreement' } })).toBe(1);
  });

  it("acceptAgreement can't be sent on an update", async () => {
    const res = await http().patch(`/v1/schools/${schoolIds[0]}`).set('Authorization', `Bearer ${jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: schoolIds[0], branchId: null }] })}`).send({ acceptAgreement: true });
    expect(res.status).toBe(400);
  });

  it('one person cannot read another person\'s acceptances (self-only RLS)', async () => {
    const other = await mkUser('other');
    const appDb = new PrismaClient({ datasourceUrl: DATABASE_URL_APP });
    try {
      const seen = await appDb.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${other.id}'`);
        return tx.legalAcceptance.count({ where: { userId: owner.id } });
      });
      expect(seen).toBe(0);
    } finally {
      await appDb.$disconnect();
    }
  });

  it("a Guardian's consent is saved with the server's Children notice version, not the app's", async () => {
    const parent = await mkUser('parent', new Date('1985-01-01'));
    const parentToken = jwt.sign({ sub: parent.id, email: parent.email, grants: [{ role: 'GUARDIAN', franchiseId: null, schoolId: null, branchId: null }] });
    const kid = await http().post('/v1/guardians/me/minors').set('Authorization', `Bearer ${parentToken}`).send({ firstName: 'Legal', surname: 'Kid', dateOfBirth: '2016-03-03' });
    expect(kid.status).toBe(201);
    userIds.push(kid.body.studentId);

    const res = await http()
      .post(`/v1/guardians/me/minors/${kid.body.studentId}/consent`)
      .set('Authorization', `Bearer ${parentToken}`)
      .send({ tier: 'BASELINE', policyVersion: 'made-up-by-the-app' });
    expect(res.status).toBe(201);
    const notice = await superuser.legalDocument.findUniqueOrThrow({ where: { slug: 'children-notice' } });
    expect(res.body.policyVersion).toBe(notice.version);
    expect(await superuser.consentRecord.count({ where: { guardianId: parent.id, policyVersion: 'made-up-by-the-app' } })).toBe(0);
  });
});
