// Flat config, same treatment as apps/api's eslint.config.js (see its own header
// comment) — this app's "lint" script was just `tsc --noEmit`, no actual ESLint ever
// ran against it either. `eslint-config-expo` is Expo's own official config for this
// exact SDK major (pinned to match `expo: ~57.0.23` in package.json) — it already
// bundles the right parser/plugin set for an Expo/React Native app (React, Hooks,
// Expo-specific rules), so there's no hand-rolled rule set to maintain here the way
// apps/api and apps/school-portal need one.
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: ['dist/**', 'node_modules/**', '.expo/**'],
  },
  {
    rules: {
      // FOUND ON FIRST REAL RUN: flagged 7 ordinary English contractions/possessives
      // in UI copy ("We'll", "You're", "isn't", "Class's") across screens this app
      // already shipped — every hit was plain natural-language text, not a real
      // JSX/HTML-entity ambiguity. A plain apostrophe renders correctly in RN same
      // as any other JS string; escaping it to `&apos;` only hurts readability of
      // the source copy for zero functional benefit. Off, not left to accumulate as
      // noise across every future screen's copy.
      'react/no-unescaped-entities': 'off',
    },
  },
];
