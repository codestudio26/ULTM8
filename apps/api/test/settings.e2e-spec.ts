/**
 * HTTP-level gate for SettingsModule (Phase 7) — GET /settings/languages,
 * GET /settings/currencies, GET /legal/:doc. Same ground rule as every other e2e
 * spec in this repo: prove over real HTTP, not just by reading the code.
 *
 * This module touches no RLS/tenant-isolation surface and signs no access token for
 * any of its tests — every route is genuinely unauthenticated (see the Phase 7
 * kickoff prompt's Auth section) — so this spec's skip condition deliberately
 * diverges from every prior e2e spec's uniform
 * `DATABASE_URL && DATABASE_URL_APP && JWT_ACCESS_SECRET` gate: only
 * `DATABASE_URL_APP` is actually needed here.
 *
 * **Bootstraps `[SettingsModule, PrismaModule]` directly, NOT the full
 * `AppModule`** — an earlier draft imported `AppModule` here while still narrowing
 * the skip gate to `DATABASE_URL_APP` alone, which was a real bug caught on code
 * review: `AppModule` pulls in `AuthModule`, whose `JwtStrategy` provider throws
 * synchronously in its own constructor when `JWT_ACCESS_SECRET` is unset — so in
 * any environment with `DATABASE_URL_APP` set but `JWT_ACCESS_SECRET` not, the
 * suite would run (not skip) and `moduleRef.compile()` would throw a confusing,
 * unrelated-looking error instead of the clean skip the header comment promised.
 * Scoping the test module to exactly what `SettingsModule` needs — itself plus
 * `PrismaModule` (`@Global()`, but still needs importing somewhere in the graph to
 * be instantiated at all) — removes `AuthModule`/`JwtStrategy` from the graph
 * entirely, so the narrower single-var skip gate is now genuinely accurate rather
 * than just asserted.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SettingsModule } from '../src/settings/settings.module';
import { PrismaModule } from '../src/common/prisma/prisma.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const hasDb = Boolean(DATABASE_URL_APP);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn(
    '[settings.e2e-spec] Skipped — DATABASE_URL_APP not set. This gate MUST run against a real Postgres in CI; a local skip is not a substitute.',
  );
}

describeIfDb('SettingsModule — GET /settings/languages, /settings/currencies, /legal/:doc', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SettingsModule, PrismaModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /settings/languages returns the 15 languages of Decision 273, unauthenticated', async () => {
    // Deliberately no Authorization header at all — proves this genuinely doesn't
    // require a token, not just that a token happens to also work.
    const res = await request(app.getHttpServer()).get('/v1/settings/languages');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(15);
    expect(res.body.map((l: { code: string }) => l.code).sort()).toEqual(
      ['ar', 'de', 'en-GB', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'ru', 'th', 'tr', 'zh-CN'].sort(),
    );
  });

  it('GET /settings/currencies returns every Stripe-supported currency, unauthenticated', async () => {
    // Grew from the old hardcoded 6 (GBP/EUR/USD/BRL/AED/MYR) to every currency
    // Stripe supports (~135 ISO 4217 codes) — product-owner-approved 11/12 Oct
    // 2026, see CHANGELOG.md -> Unreleased and CURRENCIES' own header comment
    // in apps/api/src/settings/constants/currencies.ts for how the list was
    // sourced. Asserts shape and that the full set is present (incl. the
    // previous 6) rather than hand-pinning an exact count, so a legitimate
    // future addition/removal to CURRENCIES doesn't need this test rewritten.
    const res = await request(app.getHttpServer()).get('/v1/settings/currencies');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(100);
    const codes = res.body.map((c: { code: string; name: string }) => c.code);
    expect(new Set(codes).size).toBe(codes.length); // no duplicate codes
    for (const c of res.body) {
      expect(typeof c.code).toBe('string');
      expect(c.code).toMatch(/^[A-Z]{3}$/);
      expect(typeof c.name).toBe('string');
      expect(c.name.length).toBeGreaterThan(0);
    }
    expect(codes).toEqual(expect.arrayContaining(['AED', 'BRL', 'EUR', 'GBP', 'MYR', 'USD']));
  });

  it('GET /legal/terms-and-conditions returns 200 with content: null (seeded, not-yet-populated state)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/legal/terms-and-conditions');
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('terms-and-conditions');
    expect(res.body.content).toBeNull();
  });

  it('GET /legal/privacy-statement returns 200 with content: null (seeded, not-yet-populated state)', async () => {
    const res = await request(app.getHttpServer()).get('/v1/legal/privacy-statement');
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('privacy-statement');
    expect(res.body.content).toBeNull();
  });

  it('GET /legal/not-a-real-doc returns 404', async () => {
    const res = await request(app.getHttpServer()).get('/v1/legal/not-a-real-doc');
    expect(res.status).toBe(404);
  });
});
