import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the School Portal, against the real API and a real
 * Postgres (the same database env vars as apps/api's e2e tests: DATABASE_URL,
 * DATABASE_URL_APP, DATABASE_URL_JOBS, …, JWT_ACCESS_SECRET, REDIS_URL). Build
 * the API first (`npx turbo run build --filter=@ultm8/api`); Playwright starts
 * it on port 3100 and the portal's dev server on 5174.
 *
 * Projects: each engine at desktop and tablet width (roadmap Phase 4 exit
 * criteria). Run one engine with `--project=chromium-desktop` etc.; Firefox
 * and WebKit need their browsers installed (`npx playwright install firefox
 * webkit`).
 */
const API_PORT = 3100;
const PORTAL_PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORTAL_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 } } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'] } },
    { name: 'firefox-tablet', use: { ...devices['Desktop Firefox'], viewport: { width: 820, height: 1180 } } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'] } },
    { name: 'webkit-tablet', use: { ...devices['iPad (gen 7)'] } },
  ],
  webServer: [
    {
      command: 'node ../api/dist/main.js',
      url: `http://localhost:${API_PORT}/v1/docs`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { PORT: String(API_PORT), CORS_ALLOWED_ORIGINS: `http://localhost:${PORTAL_PORT}` },
    },
    {
      command: `npx vite --port ${PORTAL_PORT} --strictPort`,
      url: `http://localhost:${PORTAL_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { VITE_API_BASE_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
