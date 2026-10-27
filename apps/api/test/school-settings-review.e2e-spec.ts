/**
 * Decision 368 — the School Settings review: School name trimmed and never
 * blank (S9), footer links need https:// and say so plainly (S5, S10), the
 * waitlist window's plain message (S8), the currency guard for plans that
 * follow the School's currency (S6/Q3), the Franchise name check before a
 * join request (Q4), the School logo upload (Q2), and GET /schools/:id
 * leaving the Stripe ids out (S11).
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, DATABASE_URL_JOBS,
 * JWT_ACCESS_SECRET, R2_* (fake values are enough, see ci.yml) — skips with a
 * warning if the database ones are unset, same convention as every other
 * HTTP-level gate in this repo.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.DATABASE_URL_JOBS && process.env.JWT_ACCESS_SECRET);
const hasR2 = Boolean(process.env.R2_PUBLIC_BUCKET_NAME && process.env.R2_PUBLIC_BASE_URL && process.env.R2_ACCOUNT_ID);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[school-settings-review.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_JOBS / JWT_ACCESS_SECRET not set. ' +
      'This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('School Settings review (Decision 368)', () => {
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const tenantJwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  let app: INestApplication;

  const franchiseIds: string[] = [];
  const schoolIds: string[] = [];
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
    await superuser.franchiseJoinRequest.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.membershipPlan.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await superuser.user.deleteMany({ where: { id: { in: userIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  async function mkUser(label: string) {
    const user = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `school-settings-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Settings',
        passcodeHash: await bcrypt.hash('246810', 4),
        dateOfBirth: new Date('2000-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function seedSchool(data: Record<string, unknown> = {}) {
    const school = await superuser.school.create({ data: { id: randomUUID(), name: 'Settings School', ...data } });
    schoolIds.push(school.id);
    const owner = await mkUser('owner');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'SCHOOL_OWNER_MANAGER', userId: owner.id, schoolId: school.id } });
    const token = tenantJwt.sign({
      sub: owner.id,
      email: owner.email,
      grants: [{ role: 'SCHOOL_OWNER_MANAGER', franchiseId: null, schoolId: school.id, branchId: null }],
    });
    return { school, owner, token };
  }

  async function studentToken(schoolId: string) {
    const student = await mkUser('student');
    await superuser.roleGrant.create({ data: { id: randomUUID(), role: 'STUDENT', userId: student.id, schoolId } });
    return tenantJwt.sign({ sub: student.id, email: student.email, grants: [{ role: 'STUDENT', franchiseId: null, schoolId, branchId: null }] });
  }

  const http = () => request(app.getHttpServer());
  const patch = (schoolId: string, token: string, body: Record<string, unknown>) =>
    http().patch(`/v1/schools/${schoolId}`).set('Authorization', `Bearer ${token}`).send(body);

  it('S9: trims the School name and refuses one of only spaces', async () => {
    const { school, token } = await seedSchool();
    const blank = await patch(school.id, token, { name: '    ' });
    expect(blank.status).toBe(400);
    expect(blank.body.error.message).toContain("School name can't be empty.");
    const trimmed = await patch(school.id, token, { name: '  Gracie Barra  ' });
    expect(trimmed.status).toBe(200);
    expect(trimmed.body.name).toBe('Gracie Barra');
  });

  it('S5/S10: footer links need https:// and the error says so plainly', async () => {
    const { school, token } = await seedSchool();
    const bare = await patch(school.id, token, { footerInstagramUrl: 'instagram.com/myschool' });
    expect(bare.status).toBe(400);
    expect(bare.body.error.message).toContain('Social links must be full web addresses starting with https://.');
    const email = await patch(school.id, token, { footerContactEmail: 'not-an-email' });
    expect(email.status).toBe(400);
    expect(email.body.error.message).toContain('Enter a valid contact email address.');
    const ok = await patch(school.id, token, { footerInstagramUrl: 'https://instagram.com/myschool' });
    expect(ok.status).toBe(200);
    expect(ok.body.footerInstagramUrl).toBe('https://instagram.com/myschool');
  });

  it('S8: a waitlist window under 1 minute gets a plain message', async () => {
    const { school, token } = await seedSchool();
    const res = await patch(school.id, token, { waitlistClaimWindowMinutes: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('The waitlist claim window must be a whole number of minutes, at least 1.');
  });

  describe('S6/Q3: the School currency and plans that follow it', () => {
    it('changes freely when no paid, live plan follows it', async () => {
      const { school, token } = await seedSchool({ defaultCurrency: 'BRL' });
      await superuser.membershipPlan.createMany({
        data: [
          { id: randomUUID(), schoolId: school.id, title: 'Own currency', type: 'CLASS_PACK', price: 5000, currency: 'BRL', classesIncluded: 5 },
          { id: randomUUID(), schoolId: school.id, title: 'Free', type: 'CLASS_PACK', price: 0, classesIncluded: 1 },
          { id: randomUUID(), schoolId: school.id, title: 'Archived', type: 'CLASS_PACK', price: 5000, classesIncluded: 5, archivedAt: new Date() },
        ],
      });
      const res = await patch(school.id, token, { defaultCurrency: 'USD' });
      expect(res.status).toBe(200);
      expect(res.body.defaultCurrency).toBe('USD');
    });

    it('asks to confirm a change, and refuses clearing, while a plan follows it', async () => {
      const { school, token } = await seedSchool({ defaultCurrency: 'BRL' });
      await superuser.membershipPlan.create({
        data: { id: randomUUID(), schoolId: school.id, title: 'Follows School', type: 'CLASS_PACK', price: 15000, classesIncluded: 10 },
      });

      const unconfirmed = await patch(school.id, token, { defaultCurrency: 'USD', name: 'Renamed' });
      expect(unconfirmed.status).toBe(409);
      expect(unconfirmed.body.error.code).toBe('SCHOOL_CURRENCY_CHANGE_CONFIRM');
      expect(unconfirmed.body.error.message).toMatch(/^1 membership plan\(s\) .* charged in USD from now on/);
      // Nothing was saved, the name included.
      const after = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
      expect(after.defaultCurrency).toBe('BRL');
      expect(after.name).toBe('Settings School');

      // The same currency sent again (any case) is no change.
      expect((await patch(school.id, token, { defaultCurrency: 'brl' })).status).toBe(200);

      const cleared = await patch(school.id, token, { defaultCurrency: null, confirmCurrencyChange: true });
      expect(cleared.status).toBe(409);
      expect(cleared.body.error.code).toBe('SCHOOL_CURRENCY_IN_USE');

      const confirmed = await patch(school.id, token, { defaultCurrency: 'USD', confirmCurrencyChange: true });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.defaultCurrency).toBe('USD');
    });
  });

  describe('Q4: the Franchise name check before asking to join', () => {
    it('gives the name to the School Owner only, and not for a closed Franchise', async () => {
      const franchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'Alliance HQ' } });
      const closedFranchise = await superuser.franchise.create({ data: { id: randomUUID(), name: 'Closed HQ', archivedAt: new Date() } });
      franchiseIds.push(franchise.id, closedFranchise.id);
      const { school, token } = await seedSchool();
      const url = `/v1/schools/${school.id}/franchise-preview`;

      const ok = await http().get(url).query({ franchiseId: franchise.id }).set('Authorization', `Bearer ${token}`);
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ id: franchise.id, name: 'Alliance HQ' });

      const closed = await http().get(url).query({ franchiseId: closedFranchise.id }).set('Authorization', `Bearer ${token}`);
      expect(closed.status).toBe(403);

      const unknown = await http().get(url).query({ franchiseId: randomUUID() }).set('Authorization', `Bearer ${token}`);
      expect(unknown.status).toBe(404);

      const typo = await http().get(url).query({ franchiseId: 'not-a-uuid' }).set('Authorization', `Bearer ${token}`);
      expect(typo.status).toBe(400);
      expect(typo.body.error.message).toContain('Enter the Franchise ID exactly as the Franchise Owner gave it.');

      const student = await studentToken(school.id);
      const asStudent = await http().get(url).query({ franchiseId: franchise.id }).set('Authorization', `Bearer ${student}`);
      expect(asStudent.status).toBe(403);
      // Nothing was asked yet.
      expect(await superuser.franchiseJoinRequest.count({ where: { schoolId: school.id } })).toBe(0);
    });
  });

  (hasR2 ? it : it.skip)('Q2: the School Owner can upload a School logo; a student and a closed School cannot', async () => {
    const { school, token } = await seedSchool();
    const body = { entityType: 'SCHOOL', schoolId: school.id, entityId: school.id, contentType: 'image/png' };
    const ok = await http().post('/v1/uploads/public-photo-url').set('Authorization', `Bearer ${token}`).send(body);
    expect(ok.status).toBe(201);
    expect(ok.body.publicUrl).toContain(`public-photos/school/${school.id}/${school.id}/`);

    const wrongEntity = await http().post('/v1/uploads/public-photo-url').set('Authorization', `Bearer ${token}`).send({ ...body, entityId: randomUUID() });
    expect(wrongEntity.status).toBe(400);

    const student = await studentToken(school.id);
    expect((await http().post('/v1/uploads/public-photo-url').set('Authorization', `Bearer ${student}`).send(body)).status).toBe(403);

    await superuser.school.update({ where: { id: school.id }, data: { archivedAt: new Date(), purgeAt: new Date(Date.now() + 86_400_000) } });
    expect((await http().post('/v1/uploads/public-photo-url').set('Authorization', `Bearer ${token}`).send(body)).status).toBe(403);
  });

  it('S11: GET and PATCH /schools/:id leave out the Stripe ids and platform status', async () => {
    const { school, token } = await seedSchool({
      stripeFranchiseFeeSubscriptionId: 'sub_fee_secret',
      stripePlatformSubscriptionId: 'sub_platform_secret',
      platformSubscriptionStatus: 'ACTIVE',
    });
    const student = await studentToken(school.id);
    for (const t of [token, student]) {
      const res = await http().get(`/v1/schools/${school.id}`).set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Settings School');
      expect(res.body).not.toHaveProperty('stripeFranchiseFeeSubscriptionId');
      expect(res.body).not.toHaveProperty('stripePlatformSubscriptionId');
      expect(res.body).not.toHaveProperty('platformSubscriptionStatus');
    }
    const patched = await patch(school.id, token, { description: 'Hi' });
    expect(patched.status).toBe(200);
    expect(patched.body).not.toHaveProperty('stripePlatformSubscriptionId');
    // Still stored.
    const row = await superuser.school.findUniqueOrThrow({ where: { id: school.id } });
    expect(row.stripePlatformSubscriptionId).toBe('sub_platform_secret');
  });
});
