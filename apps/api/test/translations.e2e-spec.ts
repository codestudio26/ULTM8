/**
 * HTTP-level gate for TranslationsModule (Phase 49) — GET /translations (public,
 * unauthenticated) and POST/PATCH/DELETE /platform-admin/translations
 * (FULL_ADMIN-only), mirroring platform-admin-users.e2e-spec.ts's own shape for
 * the admin-CRUD half. What this file specifically proves: the public endpoint
 * genuinely needs no token (same reasoning SettingsController's own comment gives
 * for /settings/languages and /legal/:doc); the FULL_ADMIN-only gate on every write;
 * the (screen, labelKey, locale) unique-index → 409 mapping on both create and
 * update; that update()/delete() rely on the global HttpExceptionFilter's generic
 * P2025 → 404 mapping rather than a manual existence check; and that a freshly
 * admin-created row is immediately visible via the public GET with no separate
 * admin list endpoint needed.
 *
 * Requires DATABASE_URL, DATABASE_URL_APP, PLATFORM_ADMIN_JWT_SECRET — skips with
 * a warning if any are unset, same convention as every other HTTP-level gate in
 * this repo. Like AdminUser, Translation has no RLS and no dedicated Postgres role
 * (see schema.prisma's own model comment), so DATABASE_URL_PLATFORM_ADMIN isn't
 * needed for the row itself — only AuditLogEntry writes use that role internally.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, AdminSubRole } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const PLATFORM_ADMIN_JWT_SECRET = process.env.PLATFORM_ADMIN_JWT_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && PLATFORM_ADMIN_JWT_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[translations.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / ' +
      'PLATFORM_ADMIN_JWT_SECRET not set. This gate MUST run against a real Postgres ' +
      'in CI; a local skip is not a substitute.',
  );
}

describeIfDb('TranslationsModule — GET /translations, /platform-admin/translations', () => {
  let app: INestApplication;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const platformAdminJwt = new JwtService({ secret: PLATFORM_ADMIN_JWT_SECRET });

  const adminIds: string[] = [];
  const translationIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    // AuditLogEntry.adminUserId has a real FK to AdminUser — must be deleted first,
    // same order platform-admin-users.e2e-spec.ts already uses.
    await superuser.auditLogEntry.deleteMany({ where: { adminUserId: { in: adminIds } } });
    await superuser.adminUser.deleteMany({ where: { id: { in: adminIds } } });
    // AuditLogEntry.targetId is a plain, unconstrained String (deliberately
    // polymorphic) — no FK-ordering dependency for Translation cleanup either way.
    await superuser.translation.deleteMany({ where: { id: { in: translationIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  async function seedAdmin(subRole: AdminSubRole) {
    const admin = await superuser.adminUser.create({
      data: {
        id: randomUUID(),
        email: `translations-http-${randomUUID()}@example.test`,
        name: 'HTTP Gate Admin',
        subRole,
        ssoSubject: `cognito-sub-${randomUUID()}`,
      },
    });
    adminIds.push(admin.id);
    return admin;
  }

  function tokenFor(admin: { id: string; email: string; subRole: AdminSubRole }) {
    return platformAdminJwt.sign({ sub: admin.id, email: admin.email, subRole: admin.subRole });
  }

  async function seedTranslation(overrides: Partial<{ screen: string; labelKey: string; locale: string; content: string }> = {}) {
    const suffix = randomUUID();
    const translation = await superuser.translation.create({
      data: {
        id: randomUUID(),
        screen: overrides.screen ?? `screen-${suffix}`,
        labelKey: overrides.labelKey ?? `label-${suffix}`,
        locale: overrides.locale ?? 'en-GB',
        content: overrides.content ?? `Content ${suffix}`,
      },
    });
    translationIds.push(translation.id);
    return translation;
  }

  function newTranslationPayload(overrides: Partial<{ screen: string; labelKey: string; locale: string; content: string }> = {}) {
    const suffix = randomUUID();
    return {
      screen: overrides.screen ?? `screen-${suffix}`,
      labelKey: overrides.labelKey ?? `label-${suffix}`,
      locale: overrides.locale ?? 'en-GB',
      content: overrides.content ?? `Content ${suffix}`,
    };
  }

  it('GET /translations requires no token at all — 200, includes a seeded row', async () => {
    const seeded = await seedTranslation();
    const res = await request(app.getHttpServer()).get('/v1/translations');
    expect(res.status).toBe(200);
    expect(res.body.items.some((item: { id: string }) => item.id === seeded.id)).toBe(true);
  });

  it('GET /translations filters by screen and locale independently', async () => {
    const screen = `filter-screen-${randomUUID()}`;
    const seeded = await seedTranslation({ screen, locale: 'ar' });
    await seedTranslation({ screen, locale: 'es' });
    await seedTranslation({ locale: 'ar' });

    const byScreenAndLocale = await request(app.getHttpServer()).get('/v1/translations').query({ screen, locale: 'ar' });
    expect(byScreenAndLocale.status).toBe(200);
    expect(byScreenAndLocale.body.items).toHaveLength(1);
    expect(byScreenAndLocale.body.items[0].id).toBe(seeded.id);

    const byScreenOnly = await request(app.getHttpServer()).get('/v1/translations').query({ screen });
    expect(byScreenOnly.status).toBe(200);
    expect(byScreenOnly.body.items).toHaveLength(2);
  });

  it('a FULL_ADMIN can create a Translation — 201, and the audit row has schoolId/franchiseId both null', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const payload = newTranslationPayload();
    const res = await request(app.getHttpServer())
      .post('/v1/platform-admin/translations')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send(payload);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject(payload);
    translationIds.push(res.body.id);

    const entries = await superuser.auditLogEntry.findMany({ where: { adminUserId: caller.id, targetId: res.body.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'CREATE_TRANSLATION', targetType: 'Translation', schoolId: null, franchiseId: null });
  });

  it('a freshly admin-created Translation is immediately visible via the public GET — no separate admin list endpoint needed', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const payload = newTranslationPayload();
    const createRes = await request(app.getHttpServer())
      .post('/v1/platform-admin/translations')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send(payload);
    expect(createRes.status).toBe(201);
    translationIds.push(createRes.body.id);

    const listRes = await request(app.getHttpServer()).get('/v1/translations').query({ screen: payload.screen });
    expect(listRes.status).toBe(200);
    expect(listRes.body.items.map((item: { id: string }) => item.id)).toContain(createRes.body.id);
  });

  it.each([AdminSubRole.SUPPORT, AdminSubRole.BILLING_PAYMENTS_OPS] as const)(
    'a %s caller gets 403 on create — only a Full Platform Admin may author Translations',
    async (subRole) => {
      const caller = await seedAdmin(subRole);
      const res = await request(app.getHttpServer())
        .post('/v1/platform-admin/translations')
        .set('Authorization', `Bearer ${tokenFor(caller)}`)
        .send(newTranslationPayload());
      expect(res.status).toBe(403);
    },
  );

  it('a duplicate (screen, labelKey, locale) is a clean 409, not a 500', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const payload = newTranslationPayload();
    const first = await request(app.getHttpServer())
      .post('/v1/platform-admin/translations')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send(payload);
    expect(first.status).toBe(201);
    translationIds.push(first.body.id);

    const second = await request(app.getHttpServer())
      .post('/v1/platform-admin/translations')
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({ ...payload, content: 'Different content, same triple' });
    expect(second.status).toBe(409);
  });

  it('no token at all is rejected — 401 on all three write routes', async () => {
    const createRes = await request(app.getHttpServer()).post('/v1/platform-admin/translations').send(newTranslationPayload());
    expect(createRes.status).toBe(401);

    const patchRes = await request(app.getHttpServer()).patch(`/v1/platform-admin/translations/${randomUUID()}`).send({ content: 'x' });
    expect(patchRes.status).toBe(401);

    const deleteRes = await request(app.getHttpServer()).delete(`/v1/platform-admin/translations/${randomUUID()}`);
    expect(deleteRes.status).toBe(401);
  });

  it('a FULL_ADMIN can update a Translation — 200, content changed, audit row recorded', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const seeded = await seedTranslation();

    const res = await request(app.getHttpServer())
      .patch(`/v1/platform-admin/translations/${seeded.id}`)
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({ content: 'Updated content' });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('Updated content');
    expect(res.body.screen).toBe(seeded.screen);

    const entries = await superuser.auditLogEntry.findMany({ where: { adminUserId: caller.id, targetId: seeded.id, action: 'UPDATE_TRANSLATION' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ targetType: 'Translation', schoolId: null, franchiseId: null });
  });

  it('updating a Translation onto an already-taken (screen, labelKey, locale) is a clean 409', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const existing = await seedTranslation();
    const toMove = await seedTranslation();

    const res = await request(app.getHttpServer())
      .patch(`/v1/platform-admin/translations/${toMove.id}`)
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({ screen: existing.screen, labelKey: existing.labelKey, locale: existing.locale });
    expect(res.status).toBe(409);
  });

  it('updating a nonexistent Translation id is a clean 404', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const res = await request(app.getHttpServer())
      .patch(`/v1/platform-admin/translations/${randomUUID()}`)
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({ content: 'x' });
    expect(res.status).toBe(404);
  });

  it('a non-FULL_ADMIN caller gets 403 on update', async () => {
    const caller = await seedAdmin(AdminSubRole.SUPPORT);
    const seeded = await seedTranslation();
    const res = await request(app.getHttpServer())
      .patch(`/v1/platform-admin/translations/${seeded.id}`)
      .set('Authorization', `Bearer ${tokenFor(caller)}`)
      .send({ content: 'x' });
    expect(res.status).toBe(403);
  });

  it('a FULL_ADMIN can delete a Translation — 200, audit row recorded, gone from the public GET', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const seeded = await seedTranslation();

    const res = await request(app.getHttpServer())
      .delete(`/v1/platform-admin/translations/${seeded.id}`)
      .set('Authorization', `Bearer ${tokenFor(caller)}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(seeded.id);
    // Deleted — remove from the cleanup array so afterAll's deleteMany doesn't
    // redundantly try to delete an already-gone row.
    translationIds.splice(translationIds.indexOf(seeded.id), 1);

    const entries = await superuser.auditLogEntry.findMany({ where: { adminUserId: caller.id, targetId: seeded.id, action: 'DELETE_TRANSLATION' } });
    expect(entries).toHaveLength(1);

    const listRes = await request(app.getHttpServer()).get('/v1/translations').query({ screen: seeded.screen });
    expect(listRes.body.items.some((item: { id: string }) => item.id === seeded.id)).toBe(false);
  });

  it('deleting a nonexistent Translation id is a clean 404', async () => {
    const caller = await seedAdmin(AdminSubRole.FULL_ADMIN);
    const res = await request(app.getHttpServer())
      .delete(`/v1/platform-admin/translations/${randomUUID()}`)
      .set('Authorization', `Bearer ${tokenFor(caller)}`);
    expect(res.status).toBe(404);
  });

  it('a non-FULL_ADMIN caller gets 403 on delete', async () => {
    const caller = await seedAdmin(AdminSubRole.SUPPORT);
    const seeded = await seedTranslation();
    const res = await request(app.getHttpServer())
      .delete(`/v1/platform-admin/translations/${seeded.id}`)
      .set('Authorization', `Bearer ${tokenFor(caller)}`);
    expect(res.status).toBe(403);
  });
});
