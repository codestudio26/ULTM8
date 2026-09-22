/**
 * RN-compatible translation of DESIGN.md's design tokens — plain JS values, since
 * React Native's StyleSheet has no CSS custom properties, `rem`/`clamp()`, media
 * queries, or `color-mix()`. `packages/ui` (DESIGN.md's own CSS implementation) is
 * web-only — react-dom/react-router-dom peer deps, `.css` file imports — none of
 * which runs here (see components/ui.tsx's own header comment, written when that
 * was first confirmed). This file is the RN equivalent: components import named
 * constants from here rather than any screen hardcoding a hex value directly, the
 * same "no hardcoded hex outside the token file" discipline DESIGN.md's `packages/ui`
 * already follows on the web side.
 *
 * CORRECTION: an earlier version of this file anchored the accent ramp on #1f5eff,
 * reasoning that Track B's own packages/ui/src/tokens.css (an ad hoc palette
 * predating this DESIGN.md) was "what's actually shipped." That was wrong — checked
 * against origin/docs/track-a-roadmap, whose packages/ui/src/tokens.css explicitly
 * implements THIS DESIGN.md ("implements DESIGN.md's concrete design system
 * (slate-blue + neutral ramps...)", its own header comment) with
 * --color-accent-500: #4a6b8a, an exact match. Track B's own tokens.css was simply
 * stale relative to Track A, not evidence the slate-blue spec was abandoned. Values
 * below are restored to match DESIGN.md/Track A's tokens.css exactly.
 *
 * `color-mix(in srgb, X p%, white)` tokens (bg-success/warning/danger) have no RN
 * equivalent — resolved here to their literal computed hex (verified via a Node
 * script reproducing the CSS color-mix formula, not eyeballed).
 *
 * Light mode only: apps/student/app.json sets `userInterfaceStyle: "light"`, so this
 * app doesn't follow system dark mode today. DESIGN.md's own dark-mode block exists
 * for when that changes, not reproduced here to avoid dead, unused tokens.
 */

/** Base ramps — DESIGN.md's `--color-accent-*`/`--color-neutral-*`/semantic tokens,
 * verified against Track A's packages/ui/src/tokens.css (see file header). */
export const colors = {
  accent50: '#f5f7fa',
  accent100: '#e4ebf1',
  accent200: '#c7d4e1',
  accent300: '#9fb6cb',
  accent400: '#7495b4',
  accent500: '#4a6b8a',
  accent600: '#3d5871',
  accent700: '#30465a',
  accent800: '#243442',
  accent900: '#17212b',

  neutral50: '#f9fafa',
  neutral100: '#f1f2f3',
  neutral200: '#e1e3e5',
  neutral300: '#c2c7cb',
  neutral400: '#969ea6',
  neutral500: '#6c767f',
  neutral600: '#50575e',
  neutral700: '#383d42',
  neutral800: '#26292c',
  neutral900: '#151719',

  success: '#1f7a4d',
  warning: '#b7791f',
  danger: '#b91c1c',

  white: '#ffffff',
} as const;

/** Purpose tokens — DESIGN.md's light-mode block only (see file header for why). */
export const theme = {
  surface0: colors.neutral50,
  surface1: colors.white,
  surface2: colors.white,

  textPrimary: colors.neutral900,
  textSecondary: colors.neutral600,
  textMuted: colors.neutral400,

  border: colors.neutral200,
  borderStrong: colors.neutral300,

  fillAccent: colors.accent500,
  fillAccentHover: colors.accent600,
  onAccent: colors.white,
  textAccent: colors.accent700,

  bgSuccess: '#e4efea',
  textSuccess: colors.success,
  bgWarning: '#f4ebdd',
  textWarning: '#6b4a10',
  bgDanger: '#f7e4e4',
  textDanger: colors.danger,
} as const;

/** DESIGN.md's `--space-*` scale, in px (RN StyleSheet numbers are density-independent
 * px already — no rem conversion needed). */
export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
} as const;

/** DESIGN.md's font-size tokens. The two `clamp()` heading sizes (heading-sm/md) have
 * no RN equivalent (no viewport units) — picked a fixed value inside DESIGN.md's own
 * documented clamp range, at the phone-width end since DESIGN.md itself says "design
 * up from a ~360px viewport; treat phone as the primary target." */
export const fontSize = {
  caption: 13,
  footnote: 14,
  body: 16,
  input: 16,
  headingSm: 19,
  headingMd: 24,
  headingLg: 32,
} as const;

/** DESIGN.md's documented weights — RN's `fontWeight` style prop takes these as
 * strings, not numbers. */
export const fontWeight = {
  body: '400',
  emphasis: '500',
  heading: '600',
} as const;

/** DESIGN.md doesn't name a border-radius token explicitly; 8 matches the radius
 * every existing input/button in components/ui.tsx already used before this file
 * existed — kept, not invented, since DESIGN.md's own "preserve intentional detail"
 * rule (skills/ui-implementation/SKILL.md) applies to values already shipped, not
 * just Figma output. */
export const radius = {
  input: 8,
  button: 8,
} as const;

/** DESIGN.md: "Every interactive element: minimum 44×44px touch target, regardless
 * of visual size." */
export const minTouchTarget = 44;
