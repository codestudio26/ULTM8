/**
 * "What's new" (Decision 318 item 3): written by ULTM8 HQ in Platform Admin,
 * shown to School owners and staff in their language (English if a
 * translation is missing). Real HTTP, real Postgres.
 *
 * - Only a Full Platform Admin writes, edits and deletes posts; every change
 *   is audit-logged. Any admin reads them. A School-side token can't reach
 *   the admin routes, and an admin token can't read the portal route.
 * - Owners, Branch Staff, Instructors and Franchise Owners read them, newest
 *   first, in their language or English. Students and people with no staff
 *   role are refused.
 * - The tenant connection can only read the posts.
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
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const PLATFORM_ADMIN_JWT_SECRET = process.env.PLATFORM_ADMIN_JWT_SECRET;
const hasDb = Boolean(DATABASE_URL && process.env.DATABASE_URL_APP && process.env.DATABASE_URL_PLATFORM_ADMIN && JWT_ACCESS_SECRET && PLATFORM_ADMIN_JWT_SECRET);
const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[whats-new.e2e-spec] Skipped — database / secrets not set. This gate MUST run against a real Postgres in CI.');
}

const TAG = `whats-new-${randomUUID().slice(0, 8)}`;
type Role = 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT';

describeIfDb("What's new (Decision 318 item 3)", () => {
  let app: INestApplication;
  const su = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const tenantDb = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_APP });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });
  const adminJwt = new JwtService({ secret: PLATFORM_ADMIN_JWT_SECRET });
  const token: Record<string, string> = {};
  const userIds: string[] = [];
  const adminIds: string[] = [];
  const postIds: string[] = [];
  let schoolId = '';

  const http = () => request(app.getHttpServer());
  const asAdmin = (label: string) => ({ Authorization: `Bearer ${token[label]}` });
  const read = (label: string, query: Record<string, string> = {}) => http().get('/v1/whats-new').query(query).set('Authorization', `Bearer ${token[label]}`);
  const mine = (items: Array<{ id: string }>) => items.filter((i) => postIds.includes(i.id));

  async function person(label: string, role: Role | null) {
    const u = await su.user.create({
      data: {
        id: randomUUID(),
        email: `${TAG}-${label}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'News',
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
        phoneVerifiedAt: new Date(),
      },
    });
    userIds.push(u.id);
    if (role) await su.roleGrant.create({ data: { id: randomUUID(), role, userId: u.id, schoolId } });
    token[label] = jwt.sign({ sub: u.id, email: u.email, grants: role ? [{ role, franchiseId: null, schoolId, branchId: null }] : [] });
  }

  async function admin(label: string, subRole: 'SUPPORT' | 'BILLING_PAYMENTS_OPS' | 'FULL_ADMIN') {
    const a = await su.adminUser.create({ data: { id: randomUUID(), email: `${TAG}-${label}@example.test`, name: label, subRole, ssoSubject: `cognito-sub-${randomUUID()}` } });
    adminIds.push(a.id);
    token[label] = adminJwt.sign({ sub: a.id, email: a.email, subRole });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);

    schoolId = (await su.school.create({ data: { id: randomUUID(), name: `${TAG} School` } })).id;
    await person('owner', 'SCHOOL_OWNER_MANAGER');
    await person('staff', 'BRANCH_STAFF');
    await person('coach', 'INSTRUCTOR');
    await person('student', 'STUDENT');
    await person('nobody', null);
    await admin('full', 'FULL_ADMIN');
    await admin('support', 'SUPPORT');
  });

  afterAll(async () => {
    await app.close();
    await su.productUpdate.deleteMany({ where: { id: { in: postIds } } });
    await su.auditLogEntry.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await su.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    await su.roleGrant.deleteMany({ where: { userId: { in: userIds } } });
    await su.user.deleteMany({ where: { id: { in: userIds } } });
    await su.school.deleteMany({ where: { id: schoolId } });
    await su.$disconnect();
    await tenantDb.$disconnect();
  });

  it('only a Full Admin writes posts; any admin reads them; each change is audit-logged', async () => {
    const body = { title: 'Payroll report', body: 'See what to pay each coach.', translations: [{ locale: 'pt-BR', title: 'Relatório de pagamento', body: 'Veja quanto pagar a cada professor.' }] };
    expect((await http().post('/v1/platform-admin/whats-new').set(asAdmin('support')).send(body)).status).toBe(403);
    expect((await http().post('/v1/platform-admin/whats-new').set('Authorization', `Bearer ${token.owner}`).send(body)).status).toBe(401);
    expect((await http().post('/v1/platform-admin/whats-new').set(asAdmin('full')).send({ ...body, title: '' })).status).toBe(400);
    expect((await http().post('/v1/platform-admin/whats-new').set(asAdmin('full')).send({ ...body, translations: [{ locale: 'xx', title: 'a', body: 'b' }] })).status).toBe(400);
    const twice = [body.translations[0], body.translations[0]];
    expect((await http().post('/v1/platform-admin/whats-new').set(asAdmin('full')).send({ ...body, translations: twice })).status).toBe(400);

    const created = await http().post('/v1/platform-admin/whats-new').set(asAdmin('full')).send(body);
    expect(created.status).toBe(201);
    postIds.push(created.body.id);
    expect(created.body).toMatchObject({ title: 'Payroll report', translations: [{ locale: 'pt-BR', title: 'Relatório de pagamento' }] });

    const list = await http().get('/v1/platform-admin/whats-new').set(asAdmin('support'));
    expect(list.status).toBe(200);
    expect(mine(list.body.items)).toHaveLength(1);

    expect((await http().patch(`/v1/platform-admin/whats-new/${created.body.id}`).set(asAdmin('support')).send(body)).status).toBe(403);
    const edited = await http()
      .patch(`/v1/platform-admin/whats-new/${created.body.id}`)
      .set(asAdmin('full'))
      .send({ title: 'Payroll report is here', body: 'See what to pay each coach.', translations: [{ locale: 'es', title: 'Informe de nómina', body: 'Mira cuánto pagar a cada profesor.' }] });
    expect(edited.status).toBe(200);
    expect(edited.body.title).toBe('Payroll report is here');
    expect(edited.body.translations.map((t: { locale: string }) => t.locale)).toEqual(['es']);

    const logged = await su.auditLogEntry.findMany({ where: { targetId: created.body.id }, orderBy: { createdAt: 'asc' } });
    expect(logged.map((l) => l.action)).toEqual(['CREATE_PRODUCT_UPDATE', 'UPDATE_PRODUCT_UPDATE']);
    expect(logged.every((l) => l.schoolId === null && l.franchiseId === null)).toBe(true);
  });

  it('owners and staff read posts newest first, in their language or English; students and others are refused', async () => {
    const older = await http().post('/v1/platform-admin/whats-new').set(asAdmin('full')).send({ title: 'Older news', body: 'From before.' });
    postIds.push(older.body.id);
    await su.productUpdate.update({ where: { id: older.body.id }, data: { createdAt: new Date('2026-01-01T00:00:00Z') } });
    const newer = await http()
      .post('/v1/platform-admin/whats-new')
      .set(asAdmin('full'))
      .send({ title: 'Newer news', body: 'Just now.', translations: [{ locale: 'fr', title: 'Nouveauté', body: "À l'instant." }] });
    postIds.push(newer.body.id);

    for (const label of ['owner', 'staff', 'coach']) {
      const res = await read(label, { locale: 'fr' });
      expect(res.status).toBe(200);
      const items = mine(res.body.items);
      expect(items[0]).toMatchObject({ id: newer.body.id, title: 'Nouveauté', body: "À l'instant.", locale: 'fr' });
      expect(items.find((i: { id: string }) => i.id === older.body.id)).toMatchObject({ title: 'Older news', locale: 'en-GB' });
      expect(Object.keys(items[0]).sort()).toEqual(['body', 'createdAt', 'id', 'locale', 'title']);
    }
    expect(mine((await read('owner')).body.items)[0]).toMatchObject({ title: 'Newer news', locale: 'en-GB' });
    expect((await read('owner', { locale: 'xx' })).status).toBe(400);

    const refused = await read('student');
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toBe("What's new is for School owners and staff.");
    expect((await read('nobody')).status).toBe(403);
    expect((await http().get('/v1/whats-new').set(asAdmin('full'))).status).toBe(401);
  });

  it('pages through older posts', async () => {
    const all: string[] = [];
    let cursor: string | null = null;
    do {
      const res: request.Response = await read('owner', { limit: '1', ...(cursor ? { cursor } : {}) });
      expect(res.status).toBe(200);
      all.push(...res.body.items.map((i: { id: string }) => i.id));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(new Set(all).size).toBe(all.length);
    expect(postIds.every((id) => all.includes(id))).toBe(true);
    expect((await read('owner', { cursor: 'not-a-cursor' })).status).toBe(400);
  });

  it('deleting a post is a Full Admin\'s, audit-logged, and removes it for readers', async () => {
    const post = await http().post('/v1/platform-admin/whats-new').set(asAdmin('full')).send({ title: 'Oops', body: 'Posted by mistake.' });
    postIds.push(post.body.id);
    expect((await http().delete(`/v1/platform-admin/whats-new/${post.body.id}`).set(asAdmin('support'))).status).toBe(403);
    expect((await http().delete(`/v1/platform-admin/whats-new/${post.body.id}`).set(asAdmin('full'))).status).toBe(204);
    expect((await http().delete(`/v1/platform-admin/whats-new/${post.body.id}`).set(asAdmin('full'))).status).toBe(404);
    expect(mine((await read('owner')).body.items).map((i: { id: string }) => i.id)).not.toContain(post.body.id);
    expect(await su.auditLogEntry.count({ where: { targetId: post.body.id, action: 'DELETE_PRODUCT_UPDATE' } })).toBe(1);
  });

  it('the tenant connection can read posts but never write them', async () => {
    await expect(tenantDb.productUpdate.create({ data: { title: 'x', body: 'y', createdById: randomUUID() } })).rejects.toThrow(/permission denied/);
    await expect(tenantDb.productUpdate.deleteMany({ where: { id: { in: postIds } } })).rejects.toThrow(/permission denied/);
    await expect(tenantDb.productUpdateTranslation.updateMany({ data: { title: 'x' } })).rejects.toThrow(/permission denied/);
  });
});
