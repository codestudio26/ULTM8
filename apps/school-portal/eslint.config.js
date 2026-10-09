// Flat config, same treatment as apps/api's eslint.config.js (see its own header
// comment) — this app's "lint" script was just `tsc --noEmit`, no actual ESLint ever
// ran against it either. This mirrors the standard Vite + React + TypeScript flat
// config (react-hooks + react-refresh, browser globals), since that's exactly what
// this app is.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Vite's Fast Refresh needs every export from a component file to itself be a
      // component — this app's screen files only ever export the one component, so
      // allowConstantExport (for the odd co-located constant) is the standard,
      // non-disruptive relaxation, not a loosened rule.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
);
