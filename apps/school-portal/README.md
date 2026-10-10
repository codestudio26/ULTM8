# apps/school-portal

Placeholder. Tenant-facing web app: Franchise/School/Branch management, classes,
memberships, instructors, timetable, transactions (Spec 55 §4.2, ultm8-nestjs-module §6).

Not implemented in Phase 1 — that scope was the backend walking skeleton (monorepo,
Prisma schema, AuthModule, CI isolation gate) only. This directory exists so the
monorepo layout matches ultm8-nestjs-module §6 from day one.

## Browser tests

Playwright tests in `e2e/` run the portal against the real API and a real
Postgres and Redis, with the same environment variables as `apps/api`'s e2e
tests (`DATABASE_URL`, `DATABASE_URL_APP`, `DATABASE_URL_JOBS`, …,
`JWT_ACCESS_SECRET`, `REDIS_URL`). Build the API first, then:

```sh
npx turbo run build --filter=@ultm8/api
cd apps/school-portal
npm run e2e -- --project=chromium-desktop --project=chromium-tablet
```

Playwright starts the API on port 3100 and the portal on 5174. Each test seeds
its own School and removes it afterwards. Firefox and WebKit projects are
defined too; install those browsers with `npx playwright install firefox webkit`.
