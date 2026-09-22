# ULTM8 Design System

Design tokens and UI rules for ULTM8, a worldwide martial-arts school management platform (franchises, schools, students, instructors, belt/rank grading, class bookings, QR check-in). ~99.9% of usage is on phones and tablets, so every rule here is mobile-first by default, not scaled down from desktop.

This file is written for coding agents to read before generating UI — reference the tokens and tables directly rather than re-deriving values.

## Typography

Figtree, self-hosted as a single variable font (`@fontsource-variable/figtree`, SIL Open Font License), is the product's typeface — a deliberate trade-off against the previous system-native-only stance, chosen for brand consistency across the app rather than for its performance profile. The mitigations that make this acceptable: it's self-hosted (no third-party CDN round trip), it's one variable file per script subset rather than separate files per weight, and `font-display: swap` means the system fallback stack renders immediately and text is never blocked on the webfont — Figtree swaps in once loaded, it doesn't delay first paint.

```css
--font-sans: "Figtree Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
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

Neutral-dominant, one accent. Most of the UI is grayscale; slate blue appears only where it carries meaning — primary actions, active/selected states, links, focus rings. It is never decorative.

**Base ramps** — literal hex, mode-stable:

```css
:root {
  /* accent — slate blue */
  --color-accent-50:  #fcfdfd;
  --color-accent-100: #edf0f2;
  --color-accent-200: #d3d9df;
  --color-accent-300: #afbbc5;
  --color-accent-400: #889aaa;
  --color-accent-500: #5d7081; /* brand reference value */
  --color-accent-600: #4d5d6b;
  --color-accent-700: #3e4b56;
  --color-accent-800: #2f3941;
  --color-accent-900: #20262c;

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

  /* Solid "success" button fill — a distinct pair from bg-success/text-success
     above (badge/alert tint), because a filled button needs its own hover step
     and its own on-fill text color: text-success on this fill only reaches
     ~4.4:1, just under AA for normal-size text — see the contrast table below. */
  --fill-success: #def2e2;
  --fill-success-hover: color-mix(in srgb, var(--color-success) 20%, white);
  --on-success: var(--color-neutral-900); /* literal ramp ref, not --text-primary — see tokens.css comment for why */

  --bg-warning: color-mix(in srgb, var(--color-warning) 15%, white);
  --text-warning: #6b4a10;
  --bg-danger: color-mix(in srgb, var(--color-danger) 12%, white);
  --text-danger: var(--color-danger);

  /* Brand accents — exact values picked from the ULTM8 marketing site, kept
     separate from the app-wide accent ramp above rather than overwriting it. */
  --color-footer-bg: #d0d9e0;
  --color-brand-ink: #16374e;   /* logotype, footer headings — never literal black */
  --fill-cta: #355762;          /* "Login"-style neutral CTA fill */
  --fill-cta-hover: color-mix(in srgb, #355762 85%, black);
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

    --color-footer-bg: var(--color-neutral-800);
    --color-brand-ink: var(--color-accent-200);
    --fill-cta: var(--color-accent-400);
    --fill-cta-hover: var(--color-accent-300);
  }
}
[data-theme="dark"] {
  /* same block as above, repeated so an explicit toggle wins over system preference */
}
```

Dark mode ships at launch, derived from the same ramps above — never hand-authored separately.

**Never set text to literal black (`#000000`/`black`).** Default UI/body text uses `--text-primary` (`--color-neutral-900`, #151719 — an off-black, not pure black). Brand-toned headings, logotype, and other text that should read as navy-dark ink rather than gray-dark ink (e.g. on the marketing footer below) use `--color-brand-ink` (#16374e) instead. Both are dark enough to read as "black" at a glance without ever being #000.

**Verified contrast** (WCAG AA, 4.5:1 normal text / 3:1 large text & UI):

| Pairing | Ratio |
|---|---|
| `text-primary` on `surface-0` (light) | 17.2:1 |
| `text-secondary` on `surface-0` (light) | 7.0:1 |
| `on-accent` (white) on `fill-accent` #5d7081 | 5.1:1 |
| `text-accent` #3e4b56 on white | 8.6:1 |
| `text-primary` (dark) on `surface-0` (dark) | 16.0:1 |
| `text-secondary` (dark) on `surface-0` (dark) | 6.6:1 |
| white on `--color-danger` | 6.5:1 |
| white on `--color-success` | 5.3:1 |
| dark ink on `--color-warning` | 4.9:1 (use dark text here, not white — white only reaches 3.6:1) |
| `on-success` on `fill-success` #def2e2 | 14.8:1 (dark neutral text — `text-success` on this same fill only reaches ~4.4:1, just under the 4.5:1 AA floor for normal-size text, so the solid button variant deliberately does not reuse it) |
| white on `--fill-cta` #355762 | 7.8:1 |
| `--color-brand-ink` #16374e on `--color-footer-bg` #d0d9e0 | 8.7:1 |

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

## Patterns

Recurring structures built from the tokens and component states above. Adapted from screen patterns observed in the ULTM8 Figma file — per the source-of-truth hierarchy, a Figma screen is illustrative only, so the specific copy, icon choice, and exact proportions below are a starting point, not a pixel-for-pixel copy; the token usage is what's binding. Neither pattern implies new business logic — see the domain-rules skill before wiring either one to real behavior.

### Success confirmation panel

Confirms a completed action (a save, an update, a login) with a self-contained panel rather than a silent redirect — this shape recurs across dozens of flows in the Figma file (login, profile updates, timetable changes):

- `--color-success` filled circle (44–64px) with a check mark, centered
- Bold title (`--font-size-heading-sm`, `--font-weight-semibold`) stating what succeeded
- One line of body text (`--font-size-footnote`, `--text-secondary`) with the specific detail
- A dismiss control (`×`) in the corner — whether a given flow also auto-advances after a delay is a per-flow decision, not something this pattern decides on its own
- Card surface (`--surface-1`, `--radius-lg`, `--shadow-md`), same as any other card

### Segmented code input

For a flow that collects a short numeric code (OTP, PIN-style passcode):

- One `--radius-sm`-bordered box per digit, fixed square aspect ratio, `--font-mono` + `font-variant-numeric: tabular-nums` so digits don't shift width as they fill
- Minimum 44×44px touch target per box (same rule as any other interactive element)
- A live countdown/expiry line below, in `--text-muted` — the actual expiry duration is a backend/business value, never hardcoded in the UI layer
- Primary action stays disabled until every box is filled

### Button pairing — neutral action vs. affirmative action

When two actions sit side by side (e.g. "Login" / "Sign up" in a header, or a form's "Cancel" / "Confirm"), don't invent a third color — pair the brand CTA fill with the success solid button so the fill difference alone signals which action is a plain navigation/neutral step versus which one commits to something new:

| Role | Example | Fill | Text |
|---|---|---|---|
| Neutral / navigation action | "Login" | `--fill-cta` (hover `--fill-cta-hover`) | `--on-accent` |
| Affirmative / commit action | "Sign up" | `--fill-success` (hover `--fill-success-hover`) | `--on-success` |

Same shape, radius, and padding for both — only the fill and text-on-fill pair changes.

### Footer

Marketing/auth-adjacent footers use the dedicated brand accents instead of the neutral ramp, to feel branded rather than like a plain content panel:

| Element | Token |
|---|---|
| Background | `--color-footer-bg` |
| Logotype / section headings | `--color-brand-ink` (never literal black — see color note above) |
| Body copy & links | `--text-secondary` |
| Divider above legal row | `--border-strong` |

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

- Figtree (above) is self-hosted as a single variable font per script subset, not separate files per weight, with `font-display: swap` so the system fallback stack renders immediately and first paint is never blocked on the webfont.
- No layout-shifting images: always set explicit `width`/`height` or `aspect-ratio`.
- Lazy-load everything below the fold.
- Keep first-load JS/CSS minimal — many users worldwide are on slower mobile connections, not just small screens; this is a network-speed constraint as much as a screen-size one.

## Internationalization

- No fixed-width text containers — translated strings run 30–40% longer or shorter than English.
- Spacing/alignment tokens (`--space-*`, flex/grid gaps) must be logical-property-safe so layouts can mirror for RTL languages later without a rewrite.
