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
