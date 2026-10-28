/**
 * The per-IP limit applies only to callers who aren't signed in (product owner,
 * 28 Oct 2026): a School's staff and students share one address on its WiFi, so
 * signed-in requests are counted per user instead (src/common/throttle/ip-limit.ts).
 * The limit is set to 5 here so each case needs only a few requests.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, JWT_ACCESS_SECRET.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[ip-throttle.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / JWT_ACCESS_SECRET not set.');
}

describeIfDb('Per-IP limit: only for callers who aren\'t signed in', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const previousLimit = process.env.THROTTLE_IP_LIMIT_PER_MINUTE;
  let userId: string;
  let token: string;

  const get = (path: string, bearer?: string) => {
    const r = request(app.getHttpServer()).get(`/v1${path}`);
    return bearer ? r.set('Authorization', `Bearer ${bearer}`) : r;
  };
  const statuses = async (n: number, send: () => request.Test) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push((await send()).status);
    return out;
  };

  beforeAll(async () => {
    process.env.THROTTLE_IP_LIMIT_PER_MINUTE = '5';
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    userId = randomUUID();
    const user = await superuser.user.create({
      data: {
        id: userId,
        email: `ip-throttle-${userId}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Ip',
        surname: 'Throttle',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    token = jwt.sign({ sub: user.id, email: user.email, grants: [] });
  });

  afterAll(async () => {
    if (previousLimit === undefined) delete process.env.THROTTLE_IP_LIMIT_PER_MINUTE;
    else process.env.THROTTLE_IP_LIMIT_PER_MINUTE = previousLimit;
    await superuser.user.deleteMany({ where: { id: userId } });
    await superuser.$disconnect();
    await app.close();
  });

  it('a signed-in caller goes past the IP limit, and doesn\'t use up the IP\'s allowance', async () => {
    const signedIn = await statuses(15, () => get('/users/me', token));
    expect(signedIn.filter((s) => s === 429)).toEqual([]);
    // Same route, same address, no token: the 15 above didn't count towards it,
    // so an expired session still gets its 401 (and the app refreshes), not a 429.
    expect(await statuses(6, () => get('/users/me'))).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('a made-up token is not signed in: it keeps the IP limit', async () => {
    const forged = new JwtService({ secret: 'not-the-api-secret-at-all-32-characters' }).sign({ sub: userId, grants: [] });
    expect(await statuses(6, () => get('/notifications/me', forged))).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('an expired token is not signed in either', async () => {
    const expired = jwt.sign({ sub: userId, grants: [], exp: Math.floor(Date.now() / 1000) - 60 });
    expect(await statuses(6, () => get('/notifications/me/counts', expired))).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('a route with its own limit keeps it for a signed-in caller, counted per user', async () => {
    // Public School search: 30 a minute.
    const signedIn = await statuses(31, () => get('/public/schools/search?q=zz', token));
    expect(signedIn.slice(0, 30).filter((s) => s === 429)).toEqual([]);
    expect(signedIn[30]).toBe(429);
    // The address's own allowance for that route is untouched.
    expect((await get('/public/schools/search?q=zz')).status).not.toBe(429);
  });
});
