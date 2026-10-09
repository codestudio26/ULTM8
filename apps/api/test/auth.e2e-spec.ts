/**
 * HTTP-level gate for AuthController — /auth/login itself, plus the per-user/per-IP
 * throttling fix (Decision 12/17, apps/api/src/common/throttle/identity-trackers.ts).
 * No e2e spec exercised these endpoints at all before this file (confirmed by grep —
 * zero existing test referenced /auth/login or /auth/otp), despite throttling being a
 * security-relevant behavior; this closes that gap for what's testable without a
 * Twilio double (register/otp/send/otp/verify still need one and aren't covered here).
 *
 * The throttle tests below specifically prove Round 1's stress-test Weakness #1/#2
 * (docs/V1-STRESS-TEST-REPORT.md): before the fix, /auth/login had ONE pure-IP 5/60s
 * bucket shared by every caller behind that IP — a 6th distinct account on a shared
 * network (office wifi, a school's front-desk device) got wrongly 429'd by a stranger's
 * attempts. Now there are two independent, AND-ed dimensions: a per-identity 5/60s
 * bucket (same strictness a single caller always had) and a per-IP 20/60s backstop
 * (loose enough that normal shared-IP traffic never trips it, tight enough to still
 * catch a real credential-stuffing flood across many identities).
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, and JWT_ACCESS_SECRET — skips with a
 * warning if any are unset, same convention as every other e2e spec in this repo.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
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
    '[auth.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

const PASSCODE = '246810';
const randomPhone = () => `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`;

describeIfDb('AuthController — /auth/login + per-user/per-IP throttling (Decision 12/17)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });

  let user: { id: string; email: string };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    const passcodeHash = await bcrypt.hash(PASSCODE, 12);
    user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `auth-http-happy-${randomUUID()}@example.test`,
        phone: randomPhone(),
        firstName: 'Auth',
        surname: 'HappyPath',
        passcodeHash,
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await superuser.user.deleteMany({ where: { email: { contains: 'auth-http-' } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('POST /auth/login succeeds with the correct email + passcode', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: user.email, passcode: PASSCODE });
    expect(res.status).toBe(201);
    expect(typeof res.body.accessToken).toBe('string');
  });

  it('POST /auth/login rejects the wrong passcode — 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: user.email, passcode: '999999' });
    expect(res.status).toBe(401);
  });

  it('the per-identity throttle blocks a 6th rapid attempt for the SAME email (5/60s, Decision 12)', async () => {
    const email = `auth-http-identity-${randomUUID()}@example.test`;
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email, passcode: '000000' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).not.toContain(429);
    expect(statuses[5]).toBe(429);
  });

  it('a shared IP does NOT block a different account — the exact Weakness #1 regression check', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: `auth-http-sharedip-${i}-${randomUUID()}@example.test`, passcode: '000000' });
      statuses.push(res.status);
    }
    expect(statuses).not.toContain(429);
  });

  it('the identity throttle is phone-keyed and Twilio-independent on /auth/forgot-password (Decision 12/17)', async () => {
    // An unregistered phone never reaches TwilioVerifyService — AuthService.
    // requestPasscodeReset only calls it once a matching User is found — so this is
    // safe to throttle-test without a Twilio double. Same 5/60s identity-bucket shape
    // as /auth/login's email bucket, just keyed by `phone` instead.
    const phone = randomPhone();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app.getHttpServer()).post('/v1/auth/forgot-password').send({ phone });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).not.toContain(429);
    expect(statuses[5]).toBe(429);
  });
});

/**
 * ultm8-nestjs-module §7's own confirmed gap, now built — /auth/refresh and
 * /auth/logout. A SEPARATE describeIfDb block with its own dedicated users:
 * the block above already spends part of the 5/60s-per-email identity
 * throttle bucket on `user.email` (one successful login, one wrong-passcode
 * attempt), and these tests mint several logins per user — sharing that email
 * would make this block's pass/fail depend on execution order and timing
 * against that unrelated throttle, not on the refresh-token logic itself.
 */
describeIfDb('AuthController — /auth/refresh + /auth/logout', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const userIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await superuser.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  async function mkLoggedInUser(label: string) {
    const passcodeHash = await bcrypt.hash(PASSCODE, 12);
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        // "rt-" not "auth-http-refresh-" — IsEmail enforces RFC 5321's 64-char
        // local-part limit, and the longer prefix plus a 36-char uuid plus a
        // longer label (e.g. "logout-idempotent") blew past it, which is what
        // this exact bug looked like before it was caught here: a 400 from
        // AuthController itself, not from AuthService's own logic at all.
        email: `rt-${label}-${randomUUID()}@example.test`,
        phone: randomPhone(),
        firstName: 'Auth',
        surname: 'Refresh',
        passcodeHash,
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    const loginRes = await request(app.getHttpServer()).post('/v1/auth/login').send({ email: user.email, passcode: PASSCODE });
    return { user, refreshToken: loginRes.body.refreshToken as string };
  }

  it('POST /auth/login returns a refreshToken alongside the accessToken', async () => {
    const { refreshToken } = await mkLoggedInUser('login-shape');
    expect(typeof refreshToken).toBe('string');
    expect(refreshToken.length).toBeGreaterThan(20);
  });

  it('POST /auth/refresh exchanges a valid refreshToken for a brand-new pair', async () => {
    const { refreshToken } = await mkLoggedInUser('rotate');
    const res = await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(201);
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');
    expect(res.body.refreshToken).not.toBe(refreshToken);
  });

  it('POST /auth/refresh rejects an unknown/fabricated token — 401', async () => {
    const res = await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: 'not-a-real-token' });
    expect(res.status).toBe(401);
  });

  it('REUSE DETECTION: replaying an already-rotated token is rejected AND invalidates the token that replaced it too', async () => {
    const { refreshToken: tokenA } = await mkLoggedInUser('reuse');

    const rotateRes = await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: tokenA });
    expect(rotateRes.status).toBe(201);
    const tokenB = rotateRes.body.refreshToken as string;

    // Replaying the now-rotated-out tokenA is the attack signal.
    const replayRes = await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: tokenA });
    expect(replayRes.status).toBe(401);

    // The whole session family is burned as a precaution — tokenB (the
    // legitimate successor, never itself compromised) must also now fail,
    // proving this isn't a no-op revoke of tokenA alone.
    const tokenBRes = await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: tokenB });
    expect(tokenBRes.status).toBe(401);
  });

  it('POST /auth/logout revokes exactly the presented token, leaving a sibling session (a second login) untouched', async () => {
    const passcodeHash = await bcrypt.hash(PASSCODE, 12);
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `rt-logout-${randomUUID()}@example.test`,
        phone: randomPhone(),
        firstName: 'Auth',
        surname: 'Logout',
        passcodeHash,
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);

    const sessionA = await request(app.getHttpServer()).post('/v1/auth/login').send({ email: user.email, passcode: PASSCODE });
    const sessionB = await request(app.getHttpServer()).post('/v1/auth/login').send({ email: user.email, passcode: PASSCODE });

    const logoutRes = await request(app.getHttpServer()).post('/v1/auth/logout').send({ refreshToken: sessionA.body.refreshToken });
    expect(logoutRes.status).toBe(201);

    const refreshAfterLogoutA = await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: sessionA.body.refreshToken });
    expect(refreshAfterLogoutA.status).toBe(401);

    // Logging out device A must not be a mass revoke — device B's own session
    // (a different login, for the same User) is untouched.
    const refreshB = await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: sessionB.body.refreshToken });
    expect(refreshB.status).toBe(201);
  });

  it('POST /auth/logout is idempotent — logging out twice (or an unknown token) is not an error', async () => {
    const { refreshToken } = await mkLoggedInUser('logout-idempotent');
    const first = await request(app.getHttpServer()).post('/v1/auth/logout').send({ refreshToken });
    expect(first.status).toBe(201);
    const second = await request(app.getHttpServer()).post('/v1/auth/logout').send({ refreshToken });
    expect(second.status).toBe(201);
    const unknown = await request(app.getHttpServer()).post('/v1/auth/logout').send({ refreshToken: 'never-issued' });
    expect(unknown.status).toBe(201);
  });
});
