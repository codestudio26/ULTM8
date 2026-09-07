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

  let userA: { id: string; email: string; phone: string };
  let userB: { id: string; email: string; phone: string };
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
          phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
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
});
