import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** First test setup in this package (Phase 3 shipped components with no test
 * infra at all — `apps/school-portal` has no unit-test runner either, only
 * Playwright e2e, so there was no existing in-repo convention for testing an
 * interactive web component to follow). Vitest + jsdom + Testing Library,
 * chosen to match the rest of this workspace: `apps/school-portal` already
 * builds on Vite, so this reuses the same toolchain rather than introducing a
 * second one (e.g. Jest + a DOM shim) alongside it. */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    globals: true,
  },
});
