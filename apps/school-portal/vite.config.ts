import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite chosen for apps/school-portal: fast dev server/HMR, minimal config, standard
// choice for a React SPA in a Turborepo/npm-workspaces monorepo (same "engineering
// call to make, note why" category as Phase 1's Turborepo-vs-Nx decision).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
