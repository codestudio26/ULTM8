/**
 * Backlog 3.14 (Decision 318 item 5) over real HTTP: a free trial of ULTM8 for
 * a School. Only a Full Platform Admin starts or extends it; a School owner
 * never can. While it runs the School works as usual; once it ends without a
 * platform subscription the School is read-only (no new Classes, Bookings or
 * payments) until it subscribes. Nothing is deleted.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_PLATFORM_ADMIN,
 * PLATFORM_ADMIN_JWT_SECRET, JWT_ACCESS_SECRET.
 */
import { ForbiddenException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { SubscriptionGateService } from '../src/subscription-plans/subscription-gate.service';

const DATABASE_URL = process.env.DATABASE_URL;
const PLATFORM_ADMIN_JWT_SECRET = process.env.PLATFORM_ADMIN_JWT_SECRET;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.DATABASE_URL_PLATFORM_ADMIN && PLATFORM_ADMIN_JWT_SECRET && JWT_ACCESS_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[platform-trial.e2e-spec] Skipped — database URLs or JWT secrets not set.');
}

const DAY = 86_400_000;

describeIfDb('Free trial of ULTM8 (backlog 3.14)', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const adminJwt = new JwtService({ secret: PLATFORM_ADMIN_JWT_SECRET });
  const tag = `trial-${randomUUID().slice(0, 8)}`;
  const adminIds: string[] = [];
  let school: { id: string };
  let owner: { id: string; email: string };
  const token: Record<string, string> = {};

  const admin = async (label: string, subRole: 'SUPPORT' | 'BILLING_PAYMENTS_OPS' | 'FULL_ADMIN') => {
    const a = await superuser.adminUser.create({
      data: { id: randomUUID(), email: `${tag}-${label}@example.test`, name: label, subRole, ssoSubject: `cognito-sub-${randomUUID()}` },
    });
    adminIds.push(a.id);
    token[label] = adminJwt.sign({ sub: a.id, email: a.email, subRole });
  };
  const post = (label: string, path: string, body: object) =>
    request(app.getHttpServer()).post(`/v1/platform-admin/schools/${school.id}${path}`).set('Authorization', `Bearer ${token[label]}`).send(body);
  const trialOf = () => superuser.school.findUniqueOrThrow({ where: { id: school.id }, select: { platformTrialStartedAt: true, platformTrialEndsAt: true } });
  const gate = () => app.get(SubscriptionGateService).assertNotDegraded(owner.id, school.id);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    school = await superuser.school.create({ data: { id: randomUUID(), name: tag } });
    owner = await superuser.user.create({
      data: {
        id: randomUUID(), email: `${tag}-owner@example.test`, phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: 'Olive', surname: 'Owner', passcodeHash: 'x', dateOfBirth: new Date('1990-01-01'), phoneVerifiedAt: new Date(),
      },
    });
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    token.owner = jwt.sign({ sub: owner.id, email: owner.email, grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }] });
    await admin('full', 'FULL_ADMIN');
    await admin('support', 'SUPPORT');
    await admin('billing', 'BILLING_PAYMENTS_OPS');
  });

  afterAll(async () => {
    await superuser.auditLogEntry.deleteMany({ where: { targetId: school.id } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: school.id } });
    await superuser.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await superuser.user.deleteMany({ where: { id: owner.id } });
    await superuser.school.deleteMany({ where: { id: school.id } });
    await superuser.$disconnect();
    await app.close();
  });

  it('a School with no trial works as before', async () => {
    await expect(gate()).resolves.toBeUndefined();
  });

  it('only a Full Platform Admin starts or extends a trial; the owner can\'t', async () => {
    expect((await post('support', '/trial', { days: 14 })).status).toBe(403);
    expect((await post('billing', '/trial', { days: 14 })).status).toBe(403);
    // A School token isn't a Platform Admin token at all.
    expect((await post('owner', '/trial', { days: 14 })).status).toBe(401);
    expect((await post('full', '/trial', { days: 0 })).status).toBe(400);
    expect((await post('full', '/trial', { days: 366 })).status).toBe(400);
    expect((await post('full', '/trial/extend', { days: 7 })).status).toBe(409);
    expect(await trialOf()).toEqual({ platformTrialStartedAt: null, platformTrialEndsAt: null });
  });

  it('a running trial: the School works, and the owner reads the end date', async () => {
    const started = await post('full', '/trial', { days: 14 });
    expect(started.status).toBe(200);
    const ends = new Date(started.body.platformTrialEndsAt).getTime();
    expect(Math.abs(ends - (Date.now() + 14 * DAY))).toBeLessThan(60_000);
    await expect(gate()).resolves.toBeUndefined();
    const own = await request(app.getHttpServer()).get(`/v1/schools/${school.id}`).set('Authorization', `Bearer ${token.owner}`);
    expect(own.body.platformTrialEndsAt).toBe(started.body.platformTrialEndsAt);
    expect(await superuser.auditLogEntry.count({ where: { targetId: school.id, action: 'START_SCHOOL_TRIAL' } })).toBe(1);
  });

  it('extending adds days to the end', async () => {
    const before = (await trialOf()).platformTrialEndsAt!.getTime();
    const res = await post('full', '/trial/extend', { days: 7 });
    expect(res.status).toBe(200);
    expect(new Date(res.body.platformTrialEndsAt).getTime()).toBe(before + 7 * DAY);
  });

  it('once it has ended without a subscription the School is read-only; extending opens it again', async () => {
    await superuser.school.update({ where: { id: school.id }, data: { platformTrialEndsAt: new Date(Date.now() - DAY) } });
    const err = await gate().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'TRIAL_ENDED' });
    // Extending an ended trial counts from today.
    const res = await post('full', '/trial/extend', { days: 3 });
    expect(Math.abs(new Date(res.body.platformTrialEndsAt).getTime() - (Date.now() + 3 * DAY))).toBeLessThan(60_000);
    await expect(gate()).resolves.toBeUndefined();
  });

  it('a School that subscribes is never held by an ended trial, and needs no new one', async () => {
    await superuser.school.update({ where: { id: school.id }, data: { platformTrialEndsAt: new Date(Date.now() - DAY), platformSubscriptionStatus: 'ACTIVE' } });
    await expect(gate()).resolves.toBeUndefined();
    expect((await post('full', '/trial', { days: 14 })).status).toBe(409);
  });
});
