import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Same tooling choice as apps/school-portal's own vite.config.ts, for the same
// reasons (fast dev server/HMR, minimal config, standard for a React SPA in this
// Turborepo/npm-workspaces monorepo). A DIFFERENT dev-server port from
// school-portal's 5173 and student's own port — this app is a genuinely separate
// deployment (Spec §4.4), not a route inside another app, so it needs to be able to
// run side-by-side with the others during local development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
  },
});
