/**
 * Decision 448 item 8: people the School creates (added manually, approved
 * tablet sign-ups, imports, Guardians added by staff) tick the Terms and
 * Privacy "I agree" the first time they sign in, recorded as a LegalAcceptance
 * exactly as sign-up records it (Decision 444). "Needs to accept" is: no Terms
 * acceptance with no School or Franchise. Until then their session can only
 * record the tick. The row is marked atFirstSignIn, so it never makes them
 * "signed up themselves" for the 18th-birthday rule (Decision 446 item 8).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_JOBS && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[first-sign-in-terms.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_JOBS / JWT_ACCESS_SECRET not set.');
}

const PASSCODE = '135790';

describeIfDb('Terms and Privacy at the first sign-in (Decision 448 item 8)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jobsDb = new PrismaClient({ datasourceUrl: DATABASE_URL_JOBS });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const userIds: string[] = [];
  let passcodeHash: string;

  const http = () => request(app.getHttpServer());
  const mkUser = async (label: string, extra: { mustChangePasscode?: boolean } = {}) => {
    const u = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `first-terms-${label}-${randomUUID()}@example.test`,
        phone: null,
        firstName: label,
        surname: 'Terms',
        passcodeHash,
        dateOfBirth: new Date('1990-01-01'),
        ...extra,
      },
    });
    userIds.push(u.id);
    return u;
  };
  const login = (email: string, passcode = PASSCODE) => http().post('/v1/auth/login').send({ email, passcode });
  const claims = (token: string) => jwt.decode(token) as { legalPending?: true; sub: string };
  const selfSignedUp = async (id: string) =>
    (await jobsDb.$queryRaw<Array<{ id: string }>>`SELECT "self_signed_up_users" AS id FROM "self_signed_up_users"(${[id]}::text[])`).map((r) => r.id);

  beforeAll(async () => {
    passcodeHash = await bcrypt.hash(PASSCODE, 4);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 500));
    await superuser.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.$disconnect();
    await jobsDb.$disconnect();
    await app.close();
  });

  it('an account with no Terms acceptance gets a session that can only record the tick', async () => {
    const person = await mkUser('created');
    const res = await login(person.email);
    expect(res.status).toBe(201);
    expect(claims(res.body.accessToken).legalPending).toBe(true);

    const blocked = await http().get('/v1/users/me').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('LEGAL_ACCEPTANCE_REQUIRED');

    // A refreshed token is still held at the step.
    const refreshed = await http().post('/v1/auth/refresh').send({ refreshToken: res.body.refreshToken });
    expect(refreshed.status).toBe(201);
    expect(claims(refreshed.body.accessToken).legalPending).toBe(true);
  });

  it('without the tick nothing is recorded; with it, Terms and Privacy are saved at the published versions and the session opens', async () => {
    const person = await mkUser('ticks');
    const { body } = await login(person.email);
    const token = body.accessToken as string;

    const refused = await http().post('/v1/auth/legal-acceptance').set('Authorization', `Bearer ${token}`).send({ acceptTerms: false });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('TERMS_NOT_ACCEPTED');
    expect(await superuser.legalAcceptance.count({ where: { userId: person.id } })).toBe(0);

    const ok = await http().post('/v1/auth/legal-acceptance').set('Authorization', `Bearer ${token}`).send({ acceptTerms: true });
    expect(ok.status).toBe(201);
    expect(claims(ok.body.accessToken).legalPending).toBeUndefined();

    const docs = await superuser.legalDocument.findMany({ where: { slug: { in: ['terms-and-conditions', 'privacy-statement'] } } });
    const rows = await superuser.legalAcceptance.findMany({ where: { userId: person.id }, orderBy: { documentSlug: 'asc' } });
    expect(rows.map((r) => r.documentSlug)).toEqual(['privacy-statement', 'terms-and-conditions']);
    for (const row of rows) {
      expect(row).toMatchObject({ schoolId: null, franchiseId: null, atFirstSignIn: true, version: docs.find((d) => d.slug === row.documentSlug)!.version });
    }

    const open = await http().get('/v1/users/me').set('Authorization', `Bearer ${ok.body.accessToken}`);
    expect(open.status).toBe(200);

    // Asked once: the next sign-in is ordinary, and a second tick adds nothing.
    const again = await login(person.email);
    expect(claims(again.body.accessToken).legalPending).toBeUndefined();
    await http().post('/v1/auth/legal-acceptance').set('Authorization', `Bearer ${again.body.accessToken}`).send({ acceptTerms: true }).expect(201);
    expect(await superuser.legalAcceptance.count({ where: { userId: person.id } })).toBe(2);
  });

  it('a first-sign-in acceptance never counts as signing up themselves (Decision 446 item 8)', async () => {
    const person = await mkUser('not-self');
    const { body } = await login(person.email);
    await http().post('/v1/auth/legal-acceptance').set('Authorization', `Bearer ${body.accessToken}`).send({ acceptTerms: true }).expect(201);
    expect(await selfSignedUp(person.id)).toEqual([]);

    // Someone who signed up (sign-up's row: no School, not atFirstSignIn) is
    // never asked, and still counts as signing up themselves.
    const signedUp = await mkUser('signed-up');
    await superuser.legalAcceptance.createMany({
      data: ['terms-and-conditions', 'privacy-statement'].map((documentSlug) => ({ id: randomUUID(), userId: signedUp.id, documentSlug, version: 'unpublished' })),
    });
    const res = await login(signedUp.email);
    expect(claims(res.body.accessToken).legalPending).toBeUndefined();
    expect(await selfSignedUp(signedUp.id)).toEqual([signedUp.id]);
  });

  it("a School owner's Agreement acceptance alone doesn't count: they are asked for the Terms once", async () => {
    const owner = await mkUser('owner');
    await superuser.legalAcceptance.create({ data: { id: randomUUID(), userId: owner.id, documentSlug: 'school-agreement', version: 'unpublished', schoolId: randomUUID() } });
    const res = await login(owner.email);
    expect(claims(res.body.accessToken).legalPending).toBe(true);
  });

  it('after the first-login passcode change, the new session is held at the tick too', async () => {
    const person = await mkUser('temp-passcode', { mustChangePasscode: true });
    const first = await login(person.email);
    expect(first.body.mustChangePasscode).toBe(true);
    const changed = await http()
      .post('/v1/auth/passcode-change/first-login')
      .set('Authorization', `Bearer ${first.body.passcodeChangeToken}`)
      .send({ newPasscode: '246802' });
    expect(changed.status).toBe(201);
    expect(claims(changed.body.accessToken).legalPending).toBe(true);
  });

  it('a token held at the tick cannot call the passcode-change or any other route', async () => {
    const person = await mkUser('only-tick');
    const { body } = await login(person.email);
    const change = await http()
      .post('/v1/auth/passcode-change')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .send({ currentPasscode: PASSCODE, newPasscode: '112233' });
    expect(change.status).toBe(403);
    expect(change.body.error.code).toBe('LEGAL_ACCEPTANCE_REQUIRED');
  });
});
