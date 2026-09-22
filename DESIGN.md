# ULTM8 Design System

Design tokens and UI rules for ULTM8, a worldwide martial-arts school management platform (franchises, schools, students, instructors, belt/rank grading, class bookings, QR check-in). ~99.9% of usage is on phones and tablets, so every rule here is mobile-first by default, not scaled down from desktop.

This file is written for coding agents to read before generating UI — reference the tokens and tables directly rather than re-deriving values.

## Typography

Keep it system-native for speed: no webfont request on first paint.

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
```

| Token | Size | Use |
|---|---|---|
| `--font-size-caption` | 13px | Metadata, timestamps, helper text |
| `--font-size-footnote` | 14px | Secondary labels |
| `--font-size-body` | 16px | Default body copy — never go smaller than this for body text |
| `--font-size-input` | 16px | Any `<input>`/`<select>`/`<textarea>` — below 16px triggers iOS auto-zoom on focus |
| `--font-size-heading-sm` | `clamp(1.125rem, 1rem + 0.5vw, 1.25rem)` | Card/section titles |
| `--font-size-heading-md` | `clamp(1.375rem, 1.2rem + 0.8vw, 1.75rem)` | Screen titles |
| `--font-size-heading-lg` | `clamp(1.75rem, 1.4rem + 1.6vw, 2.5rem)` | Marketing/onboarding headers |

Weights: 400 (body), 500 (emphasis, buttons, labels), 600 (headings only). Body line-height 1.5, headings 1.2.

## Color

Neutral-dominant, one accent. Most of the UI is grayscale; blue appears only where it carries meaning — primary actions, active/selected states, links, focus rings. It is never decorative.

**Base ramps** — literal hex, mode-stable. The accent ramp is anchored on `#1f5eff`, the brand blue already shipping in `packages/ui/src/tokens.css` (`--color-accent`) and live in `school-portal`/`platform-admin` today — not a new color, and not the slate blue an earlier draft of this file specified before `packages/ui` existed. That slate-blue draft was never implemented anywhere in the codebase (confirmed by a full-repo search) and has been dropped here in favor of matching what's actually shipped, rather than repainting the live apps to match a draft none of them ever used:

```css
:root {
  /* accent — brand blue */
  --color-accent-50:  #f2f5ff;
  --color-accent-100: #dde7ff;
  --color-accent-200: #b7cbff;
  --color-accent-300: #8babff;
  --color-accent-400: #5585ff;
  --color-accent-500: #1f5eff; /* brand reference value — matches packages/ui's --color-accent */
  --color-accent-600: #1b51db;
  --color-accent-700: #1642b3;
  --color-accent-800: #103185;
  --color-accent-900: #0b2057;

  /* neutral */
  --color-neutral-50:  #f9fafa;
  --color-neutral-100: #f1f2f3;
  --color-neutral-200: #e1e3e5;
  --color-neutral-300: #c2c7cb;
  --color-neutral-400: #969ea6;
  --color-neutral-500: #6c767f;
  --color-neutral-600: #50575e;
  --color-neutral-700: #383d42;
  --color-neutral-800: #26292c;
  --color-neutral-900: #151719;

  /* semantic — interface convention colors, distinct from the brand accent */
  --color-success: #1f7a4d;
  --color-warning: #b7791f; /* pair with dark text, not white — see contrast note below */
  --color-danger:  #b91c1c;
}
```

**Purpose tokens** — what components actually consume. Light mode on `:root`, dark mode flips under `prefers-color-scheme: dark` or `[data-theme="dark"]`:

```css
:root {
  --surface-0: var(--color-neutral-50);   /* page background */
  --surface-1: #ffffff;                   /* card */
  --surface-2: #ffffff;                   /* panel / popover */
  --text-primary: var(--color-neutral-900);
  --text-secondary: var(--color-neutral-600);
  --text-muted: var(--color-neutral-400);
  --border: var(--color-neutral-200);
  --border-strong: var(--color-neutral-300);

  --fill-accent: var(--color-accent-500);
  --fill-accent-hover: var(--color-accent-600);
  --on-accent: #ffffff;
  --text-accent: var(--color-accent-700);  /* links, accent text on light surfaces */

  --bg-success: color-mix(in srgb, var(--color-success) 12%, white);
  --text-success: var(--color-success);
  --bg-warning: color-mix(in srgb, var(--color-warning) 15%, white);
  --text-warning: #6b4a10;
  --bg-danger: color-mix(in srgb, var(--color-danger) 12%, white);
  --text-danger: var(--color-danger);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --surface-0: var(--color-neutral-900);
    --surface-1: var(--color-neutral-800);
    --surface-2: #2e3236;
    --text-primary: var(--color-neutral-100);
    --text-secondary: var(--color-neutral-400);
    --text-muted: var(--color-neutral-500);
    --border: var(--color-neutral-700);
    --border-strong: var(--color-neutral-600);

    --fill-accent: var(--color-accent-400);
    --fill-accent-hover: var(--color-accent-300);
    --on-accent: var(--color-neutral-900);
    --text-accent: var(--color-accent-300);
  }
}
[data-theme="dark"] {
  /* same block as above, repeated so an explicit toggle wins over system preference */
}
```

Dark mode ships at launch, derived from the same ramps above — never hand-authored separately.

**Verified contrast** (WCAG AA, 4.5:1 normal text / 3:1 large text & UI) — recomputed for the `#1f5eff` accent ramp above, not copied from the earlier slate-blue draft:

| Pairing | Ratio |
|---|---|
| `text-primary` on `surface-0` (light) | 17.2:1 |
| `text-secondary` on `surface-0` (light) | 7.0:1 |
| `on-accent` (white) on `fill-accent` #1f5eff | 5.1:1 |
| `text-accent` #1642b3 on white | 8.5:1 |
| `text-primary` (dark) on `surface-0` (dark) | 16.0:1 |
| `text-secondary` (dark) on `surface-0` (dark) | 6.6:1 |
| `on-accent` (dark ink, neutral-900) on `fill-accent` #5585ff (dark mode) | 5.3:1 |
| `text-accent` #8babff on `surface-0` (dark) | 8.0:1 |
| white on `--color-danger` | 6.5:1 |
| white on `--color-success` | 5.3:1 |
| dark ink on `--color-warning` | 4.9:1 (use dark text here, not white — white only reaches 3.6:1) |

## Layout & spacing

Design up from a ~360px viewport; treat phone as the primary target, tablet and desktop as expansions of the same layout, not separate designs.

```css
--space-1: 0.25rem;  /* 4px */
--space-2: 0.5rem;   /* 8px */
--space-3: 0.75rem;  /* 12px */
--space-4: 1rem;     /* 16px */
--space-6: 1.5rem;   /* 24px */
--space-8: 2rem;     /* 32px */
```

| Breakpoint | Width | Notes |
|---|---|---|
| Phone (default) | ≥360px | Primary target — build this first |
| Tablet | ≥768px | Expand columns/spacing, not a redesign |
| Desktop | ≥1024px | Same components, more breathing room |

- Every interactive element: minimum **44×44px** touch target, regardless of visual size.
- No horizontal overflow at any breakpoint.
- Use `--space-*` tokens and `rem`, never hardcoded pixel margins.

## Components

Every component defines these states. Hover is a progressive enhancement for mouse/trackpad only — it must never be the only way to reveal information, since most sessions are touch.

| State | Applies to | Rule |
|---|---|---|
| Default | all | Uses purpose tokens above |
| Hover | pointer input only | Subtle `--fill-accent-hover` / `--surface-1`→`--surface-2` shift |
| Pressed / active | touch and pointer | Must exist even without hover — this is the primary feedback on mobile |
| Focus-visible | keyboard | Ring in `--fill-accent`, never suppressed |
| Disabled | all | Avoid where possible; if used, still legible, not just low-opacity |
| Loading | async actions | Inline spinner or skeleton, never a blank state |
| Error | forms, async | `--text-danger` / `--bg-danger`, message states what happened and what to do |

Minimum set requiring all of the above: buttons, inputs/selects, cards that are tappable, list rows, tabs/nav items, checkboxes/toggles.

## Motion

```css
--dur-fast: 120ms;
--dur-base: 200ms;
--dur-slow: 280ms;
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
```

Prefer CSS transitions over JS animation. Keep everything in the 120–280ms range so the UI feels immediate on lower-end phones. Wrap all motion in `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

## Performance

- System font stack (above) — zero webfont requests on first paint. If a custom display font is ever added, it must be a single self-hosted variable font, not multiple weight files.
- No layout-shifting images: always set explicit `width`/`height` or `aspect-ratio`.
- Lazy-load everything below the fold.
- Keep first-load JS/CSS minimal — many users worldwide are on slower mobile connections, not just small screens; this is a network-speed constraint as much as a screen-size one.

## Internationalization

- No fixed-width text containers — translated strings run 30–40% longer or shorter than English.
- Spacing/alignment tokens (`--space-*`, flex/grid gaps) must be logical-property-safe so layouts can mirror for RTL languages later without a rewrite.
