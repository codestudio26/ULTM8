/**
 * HTTP-level gate for UsersModule (Phase 6) — GET/PATCH /users/me only. Same ground
 * rule as classes.e2e-spec.ts: prove over real HTTP, not just by reading the code,
 * that:
 *  1. GET/PATCH /users/me only ever touches the caller's own row (never another
 *     User's, even one at the same School) — `user_self_or_shared_school`'s existing
 *     self-visibility clause plus the always-`callerId` WHERE clause in
 *     UsersService, not new RLS.
 *  2. `email`/`phone` are rejected if included in the PATCH body — ValidationPipe's
 *     global `forbidNonWhitelisted: true` should already do this since UpdateUserDto
 *     deliberately excludes both; asserted explicitly here, not assumed.
 *  3. `passcodeHash` never appears in the GET/PATCH response body.
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

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[users.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('UsersModule — GET/PATCH /users/me', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  let userA: { id: string; email: string; phone: string | null };
  let userB: { id: string; email: string; phone: string | null };
  let tokenA: string;
  let tokenB: string;

  function signAccessToken(user: { id: string; email: string }, grants: Array<Record<string, unknown>> = []) {
    return jwt.sign({ sub: user.id, email: user.email, grants });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    const mkUser = (label: string) =>
      superuser.user.create({
        data: {
          id: randomUUID(),
          email: `users-http-${label}-${randomUUID()}@example.test`,
          phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
          firstName: label,
          surname: 'Self',
          passcodeHash: 'x',
          dateOfBirth: new Date('2000-01-01'),
          phoneVerifiedAt: new Date(),
        },
      });

    userA = await mkUser('user-a');
    userB = await mkUser('user-b');

    tokenA = signAccessToken(userA);
    tokenB = signAccessToken(userB);
  });

  afterAll(async () => {
    await superuser.user.deleteMany({ where: { email: { contains: 'users-http-' } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('GET /users/me returns the caller\'s own row, never another User\'s', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(userA.id);
    expect(res.body.id).not.toBe(userB.id);
  });

  it('GET /users/me never includes passcodeHash', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.passcodeHash).toBeUndefined();
  });

  it('PATCH /users/me updates only the caller\'s own row', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(userA.id);
    expect(res.body.firstName).toBe('Updated');

    const untouchedB = await superuser.user.findUniqueOrThrow({ where: { id: userB.id } });
    expect(untouchedB.firstName).toBe('user-b');
  });

  it('PATCH /users/me rejects email in the body — 400, not a silent no-op or a credential change', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: 'changed@example.test' });
    expect(res.status).toBe(400);

    const unchanged = await superuser.user.findUniqueOrThrow({ where: { id: userA.id } });
    expect(unchanged.email).toBe(userA.email);
  });

  it('PATCH /users/me rejects phone in the body — 400, not a silent no-op or a credential change', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ phone: '+15559999999' });
    expect(res.status).toBe(400);

    const unchanged = await superuser.user.findUniqueOrThrow({ where: { id: userA.id } });
    expect(unchanged.phone).toBe(userA.phone);
  });

  it('PATCH /users/me rejects passcodeHash (or any other non-whitelisted field) in the body', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ passcodeHash: 'attempted-override' });
    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Regression coverage: firstName/surname/dateOfBirth are NOT NULL on User, but
  // @IsOptional() alone doesn't reject an explicit null (only an omitted field) — an
  // explicit null must be rejected with 400, not silently no-op (dateOfBirth) or
  // reach Postgres as a literal null and surface as an unhandled 500 (firstName/
  // surname).
  // ---------------------------------------------------------------------------

  it('PATCH /users/me rejects firstName: null with 400, not a 500', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: null });
    expect(res.status).toBe(400);
  });

  it('PATCH /users/me rejects surname: null with 400, not a 500', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ surname: null });
    expect(res.status).toBe(400);
  });

  it('PATCH /users/me rejects dateOfBirth: null with 400, not a silent no-op', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dateOfBirth: null });
    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Decision 220/246 — Student Measurements (weightCategory/kimonoSize/beltSize),
  // built as real nullable String columns on User. Same self-service surface as
  // every other optional profile field: round-trips set -> read back -> cleared
  // with an explicit null, same as gender/nationality/etc.
  // ---------------------------------------------------------------------------

  it('PATCH /users/me sets weightCategory/kimonoSize/beltSize, and GET /users/me reads them back', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ weightCategory: '-73kg', kimonoSize: 'A3', beltSize: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ weightCategory: '-73kg', kimonoSize: 'A3', beltSize: '3' });

    const getRes = await request(app.getHttpServer())
      .get('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({ weightCategory: '-73kg', kimonoSize: 'A3', beltSize: '3' });

    const persisted = await superuser.user.findUniqueOrThrow({ where: { id: userA.id } });
    expect(persisted.weightCategory).toBe('-73kg');
    expect(persisted.kimonoSize).toBe('A3');
    expect(persisted.beltSize).toBe('3');
  });

  it('PATCH /users/me clears weightCategory/kimonoSize/beltSize with an explicit null', async () => {
    const setRes = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ weightCategory: '-73kg', kimonoSize: 'A3', beltSize: '3' });
    expect(setRes.status).toBe(200);

    const clearRes = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ weightCategory: null, kimonoSize: null, beltSize: null });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.weightCategory).toBeNull();
    expect(clearRes.body.kimonoSize).toBeNull();
    expect(clearRes.body.beltSize).toBeNull();

    const persisted = await superuser.user.findUniqueOrThrow({ where: { id: userA.id } });
    expect(persisted.weightCategory).toBeNull();
    expect(persisted.kimonoSize).toBeNull();
    expect(persisted.beltSize).toBeNull();
  });

  it('PATCH /users/me rejects a weightCategory/kimonoSize/beltSize longer than 50 characters', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ weightCategory: 'x'.repeat(51) });
    expect(res.status).toBe(400);
  });

  it('PATCH /users/me rejects a username already taken by another User', async () => {
    const claimRes = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ username: `taken-${randomUUID()}` });
    expect(claimRes.status).toBe(200);

    const collideRes = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ username: claimRes.body.username });
    expect(collideRes.status).toBe(409);

    const unchangedB = await superuser.user.findUniqueOrThrow({ where: { id: userB.id } });
    expect(unchangedB.username).not.toBe(claimRes.body.username);
  });

  // ---------------------------------------------------------------------------
  // Closes the undefined-vs-null DTO contract gap: username/gender/nationality/
  // language/currency/address are nullable on User, and UsersService.updateProfileFor
  // already passes each straight through to Prisma (same shape as weightCategory/
  // kimonoSize/beltSize above) — the only thing that was missing was UpdateUserDto's
  // own type admitting `null` at all. Omitting a field still leaves it alone;
  // sending an explicit null now clears it, same contract as every other optional
  // field in this DTO.
  // ---------------------------------------------------------------------------

  it('PATCH /users/me clears username/gender/nationality/language/currency/address with an explicit null', async () => {
    const setRes = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        username: `clear-me-${randomUUID()}`,
        gender: 'FEMALE',
        nationality: 'Testland',
        language: 'en',
        currency: 'USD',
        address: '123 Test St',
      });
    expect(setRes.status).toBe(200);

    const clearRes = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ username: null, gender: null, nationality: null, language: null, currency: null, address: null });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.username).toBeNull();
    expect(clearRes.body.gender).toBeNull();
    expect(clearRes.body.nationality).toBeNull();
    expect(clearRes.body.language).toBeNull();
    expect(clearRes.body.currency).toBeNull();
    expect(clearRes.body.address).toBeNull();

    const persisted = await superuser.user.findUniqueOrThrow({ where: { id: userA.id } });
    expect(persisted.username).toBeNull();
    expect(persisted.gender).toBeNull();
    expect(persisted.nationality).toBeNull();
    expect(persisted.language).toBeNull();
    expect(persisted.currency).toBeNull();
    expect(persisted.address).toBeNull();
  });

  it('PATCH /users/me omitting gender/nationality/etc. leaves the existing value untouched (undefined still means "leave alone")', async () => {
    const setRes = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ gender: 'MALE', nationality: 'Testlandia' });
    expect(setRes.status).toBe(200);

    const untouchedRes = await request(app.getHttpServer())
      .patch('/v1/users/me')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ firstName: 'StillB' });
    expect(untouchedRes.status).toBe(200);
    expect(untouchedRes.body.gender).toBe('MALE');
    expect(untouchedRes.body.nationality).toBe('Testlandia');
  });

  it('gender is Female, Male or empty only (Decision 315 item 15)', async () => {
    const patch = (body: object) => request(app.getHttpServer()).patch('/v1/users/me').set('Authorization', `Bearer ${tokenA}`).send(body);
    const refused = await patch({ gender: 'non-binary' });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain('Gender must be Female or Male, or left empty.');
    expect((await patch({ gender: 'FEMALE' })).body.gender).toBe('FEMALE');
    expect((await patch({ gender: '' })).body.gender).toBeNull();
    // The database refuses anything else too.
    await expect(superuser.$executeRaw`UPDATE "User" SET "gender" = 'other' WHERE id = ${userA.id}`).rejects.toThrow();
  });
});
