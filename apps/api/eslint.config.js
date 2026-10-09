// Flat config (ESLint v9+ default, and the only format v10 understands) — the previous
// `.eslintrc.json` never actually ran: `eslint` itself was never an installed
// dependency anywhere in this repo, so `npm run lint` silently fell through to npx
// fetching a bare, uncached latest ESLint (v10), which ignores legacy `.eslintrc.*`
// files entirely. Fixed by actually installing eslint/typescript-eslint/globals as
// devDependencies and replacing the legacy config with this one, carrying over the
// same parser/rule intent `.eslintrc.json` had (now removed).
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

module.exports = tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      // Same override `.eslintrc.json` carried — this codebase's Prisma/NestJS
      // boundary code leans on `any` in a handful of deliberately-untyped spots
      // (e.g. isUniqueConstraintViolation's `err as { code: string }` pattern).
      '@typescript-eslint/no-explicit-any': 'off',
      // FOUND ON FIRST REAL RUN: `@typescript-eslint/recommended`'s default
      // no-unused-vars doesn't exempt `_`-prefixed names, which this codebase
      // already relies on for a BullMQ WorkerHost.process(_job: Job) override
      // parameter it's contractually required to accept but has no use for
      // (booking-no-show-processing.processor.ts, class-occurrence-generation.
      // processor.ts) — an established, intentional convention, not something to
      // rename away just because lint never actually ran against it before now.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // FOUND ON FIRST REAL RUN: every one of the 5 raw `console.*` calls in this
      // codebase (NestJS's own Logger is used everywhere else) already carries a
      // deliberate `// eslint-disable-next-line no-console` comment immediately
      // above it — clear evidence `no-console` was meant to be enabled from the
      // start, just never actually wired into a working config. Enabling it here
      // makes those 5 pre-existing disable comments meaningful again instead of
      // dead weight, with no other call site affected.
      'no-console': 'warn',
    },
  },
);
