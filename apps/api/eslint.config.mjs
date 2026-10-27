// Flat-config port of the former .eslintrc.json (ESLint 9+ no longer reads .eslintrc.*).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { project: 'tsconfig.json', tsconfigRootDir: import.meta.dirname, sourceType: 'module' },
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // `_`-prefixed names are this codebase's existing convention for deliberately
      // unused params/destructured fields (BullMQ `_job`, omit-by-destructuring).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // The code already carries `eslint-disable-next-line no-console` on every
      // deliberate console call, so this rule was always meant to be on.
      'no-console': 'error',
    },
  },
);
