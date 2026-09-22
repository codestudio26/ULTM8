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
 * `color-mix(in srgb, X p%, white)` tokens (bg-success/warning/danger) have no RN
 * equivalent — resolved here to their literal computed hex (verified via a Node
 * script reproducing the CSS color-mix formula, not eyeballed).
 *
 * Light mode only: apps/student/app.json sets `userInterfaceStyle: "light"`, so this
 * app doesn't follow system dark mode today. DESIGN.md's own dark-mode block exists
 * for when that changes, not reproduced here to avoid dead, unused tokens.
 */

/** Base ramps — DESIGN.md's `--color-accent-*`/`--color-neutral-*`/semantic tokens.
 * Accent anchored on #1f5eff, the brand blue already shipping in
 * packages/ui/src/tokens.css and live in school-portal/platform-admin today — see
 * DESIGN.md's Color section for why (an earlier slate-blue draft was dropped in
 * favor of matching what's actually shipped, never implemented anywhere). */
export const colors = {
  accent50: '#f2f5ff',
  accent100: '#dde7ff',
  accent200: '#b7cbff',
  accent300: '#8babff',
  accent400: '#5585ff',
  accent500: '#1f5eff',
  accent600: '#1b51db',
  accent700: '#1642b3',
  accent800: '#103185',
  accent900: '#0b2057',

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
