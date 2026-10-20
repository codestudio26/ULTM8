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
| `--font-size-setting-label` | 15px, regular weight | Label of a toggle/select row on a Settings page (redesign vision, 20 Oct 2026); colour `--text-setting-label` (`--color-neutral-500` light, `--color-neutral-400` dark). The value inside that row's `<select>`/`<input>` uses the same 15px Figtree and the same colour, `--text-setting-value` (= `--text-setting-label`) |
| `--font-size-body` | 16px | Default body copy — never go smaller than this for body text |
| `--font-size-input` | 16px | Any `<input>`/`<select>`/`<textarea>` — below 16px triggers iOS auto-zoom on focus |
| `--font-weight-strong` | 500 (medium) | **Redesign rule: no bold text anywhere** (product owner, 20 Oct 2026). Titles, names, buttons and numbers top out at medium 500; everything else is regular 400. Don't use 600/700 in redesigned screens |
| `--letter-spacing-title` | 0.06em | Redesign card titles, Settings row titles and list-row names (product owner, 20 Oct 2026). Body text, descriptions and form values stay at normal spacing |
| `--font-size-field` | 15px desktop / 16px under 768px | Redesign form fields (product owner, 20 Oct 2026): Figtree regular; typed value in `--text-field-value` (= settings-label grey `#6c767f`), hint text in `--text-placeholder` (`#969ea6`, ~2.6:1, accepted by the product owner) |
| `--font-size-heading-sm` | `clamp(1.125rem, 1rem + 0.5vw, 1.25rem)` | Card/section titles |
| `--font-size-heading-md` | `clamp(1.375rem, 1.2rem + 0.8vw, 1.75rem)` | Screen titles |
| `--font-size-heading-lg` | `clamp(1.75rem, 1.4rem + 1.6vw, 2.5rem)` | Marketing/onboarding headers |

Weights: 400 (body), 500 (emphasis, buttons, labels), 600 (headings only). Body line-height 1.5, headings 1.2.

## Color

Neutral-dominant, one accent. Most of the UI is grayscale; slate blue appears only where it carries meaning — primary actions, active/selected states, links, focus rings. It is never decorative.

**Base ramps** — literal hex, mode-stable:

```css
:root {
  /* accent — slate blue (matches packages/ui's --color-accent as of PR #61,
     2026-09-20; the prose above this block predates that rebase and still
     describes the earlier #1f5eff brand blue — a pre-existing drift in this
     file, not something this merge introduces, flagged here rather than
     silently rewritten as part of an unrelated conflict resolution). */
  --color-accent-50:  #fcfdfd;
  --color-accent-100: #edf0f2;
  --color-accent-200: #d3d9df;
  --color-accent-300: #afbbc5;
  --color-accent-400: #889aaa;
  --color-accent-500: #5d7081; /* brand reference value — matches packages/ui's --color-accent */
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
  --text-strong: var(--color-neutral-700);   /* redesign main text: headings, names, table text — softer than text-primary (product owner, 20 Oct 2026) */
  --text-description: var(--color-neutral-400); /* redesign secondary/description text, 14px on Settings rows — ~2.6:1, accepted by the product owner (20 Oct 2026) */
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

  /* Primary action buttons (Save, Add) and "on" switches — redesign vision, 20 Oct 2026 */
  --fill-action: var(--fill-success);        /* #def2e2 pale green */
  --fill-action-hover: var(--fill-success-hover);
  --on-action: var(--color-neutral-600);     /* #50575e soft grey, 6.3:1 on the fill; no outline */

  /* Side menu, design D — 20 Oct 2026. Light = white menu (option F1); dark mode = Pine (option B1) */
  --nav-bg: #ffffff;                         /* dark: #1f3d33 Pine */
  --nav-border: var(--color-neutral-200);    /* dark: #2c5446 */
  --nav-text: var(--color-neutral-700);      /* dark: #cfe3d6 */
  --nav-text-muted: var(--color-neutral-500);/* dark: #9fbfac */
  --nav-active-bg: var(--fill-action);       /* #def2e2; dark: #2c5446 */
  --nav-active-text: var(--color-accent-900);/* dark: #ffffff */
  --nav-active-marker: var(--color-success); /* 4px bar on the left; dark: #def2e2 */
  --nav-width: 248px;
  --inspector-width: 340px;                  /* right-side white panel on every page */
  /* Kept alternative, not in use: Slate 500 menu (option A1) — nav-bg #5d7081, text #edf0f2,
     active #4d5d6b with white text and a #def2e2 bar (product owner, 20 Oct 2026) */

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

### Form pattern "F": numbered chapters + live preview

The product owner chose this on 20 Oct 2026 as the feel and style for every form across the site. It was first applied to Add student.

**Structure**
- **Chapters:** the form is a stack of chapters (`.ultm8-chapter`), numbered 01, 02, … in large light figures.
  - Left side: the number, a title, and a one-line explanation of why the chapter is asked for.
  - Right side: the fields, two to a row.
  - A chapter's number turns success-green (`.ultm8-chapter--done`) once its required fields are filled.
- **Fields** (`.ultm8-soft-field` / `.ultm8-soft-input`):
  - no border, a soft grey fill (`--form-field-bg`), 52px tall, 14px corner radius
  - the label sits above the field
  - on focus, the field turns white with a 2px slate ring
  - text is `--font-size-field` (15px on desktop, 16px on phones)
- **Date of birth:** three boxes, DD / MM / YYYY (`.ultm8-soft-date`).

**Choices**
- **5 or fewer short options:** pills (`.ultm8-pills`), so every option is visible and takes one tap.
- **More than 5 options, or a list a School can grow:** a drop-down (`<select class="ultm8-soft-input">`).
- **Choices that need a line of explanation** (waivers, app access): option cards (`.ultm8-option-card`). Selected cards get a success-green border.

**Live preview** (`.ultm8-form-preview`)
- It sits in the right-side inspector and stays in view while the form scrolls.
- It holds two things:
  - a preview card (`.ultm8-preview-card`, Slate 500) showing what is being created, filling in as staff type
  - a "Ready to save" checklist (`.ultm8-checklist`) of what is done and what is still missing
- The primary Save/Add button lives under the checklist, so it is always in reach.

**Responsive**
- Under 1024px, the preview drops below the form.
- Under 768px, chapters stack (number and title above the fields) and fields go one per row.

**Settings:** `--form-*` in `packages/ui/src/tokens.css`, with light and dark values.

### Settings pages (product owner, 20 Oct 2026)

Every Settings page follows the chosen layout, "idea A + information in the right panel". The reference is the vision's **6 · Settings → Check-in rules**.

- **Left: the Settings categories.** They sit in a white card, and each has an icon and a one-line description. The current category is pale green.
- **Middle: the settings, grouped.** They sit in white cards, each with a small uppercase heading and icon, for example *Who can check in · Access · Check-in screen · Timing*.
  - **Yes/no settings** use switches with no ON/OFF words. The switch knob always has its outline (`--switch-knob-ring`).
  - **Choices** use soft drop-downs, or pills when there are 3 or fewer.
- **Saving:** there is no full-width Save button. A dark bar, "N unsaved changes · Discard · Save changes", appears only when something has changed.
- **Right: the panel explains whatever is selected.** It has three parts:
  1. **Preview:** what the student or member sees, updating live as settings change.
  2. **About this setting:** for whichever setting was clicked, it shows the name, the current state ("On", "Off", "Set to: 30 minutes") and a plain explanation of what it does. The selected setting is highlighted in pale green in the middle column.
  3. **A picture of the setting, where one helps.** For example, the check-in window is shown as a timeline (opens 17:30 → class 18:00 → closes 18:15) that moves as the times change.
- **Wording:** explanations only describe what a setting does, as decided. Features that aren't built yet say "coming soon" and point to `docs/v1.3-backend-backlog.md`.

### Phone layout (product owner, 20 Oct 2026)

The desktop design is made phone-friendly. The student app (`apps/student`) borrows this style for now; its own UI/UX redesign comes later. Under 768px:

- **Side menu → top bar.**
  - It sticks to the top of the screen.
  - It shows the School logo, then the sections as a row of rounded buttons you swipe sideways.
  - The selected section is pale green.
  - The search box and user row are hidden.
- **Right-hand panel → below the page.** This covers the details, preview and "About this setting" panels. They run full width with a top border instead of a side shadow.
- **Grids drop to one column:** cards, form fields and settings groups.
  - Some small grids keep their shape: the 4 quick-action buttons in a panel, and the 3×4 check-in keypad.
  - Form pattern F's chapters stack, with the number and title above the fields.
- **Settings categories** become a row of buttons you swipe sideways.
- **Wide tables** (Students list) scroll sideways inside their card.
- **Short history lists** (for example the attendance sessions on a profile) become **cards on a phone**:
  - Line 1: the main item (class) on the left, the date on the right.
  - Line 2: the secondary detail (coach) on the left, the type as a small tag on the right (QR / Code / Front desk).
  - On a computer they stay one tidy row with aligned columns.
- **Toolbars:** on a phone, search takes its own full-width row. The main actions follow on one row (for example Filter · + Add student · Invite), ending in a **⋯ More** button. Secondary actions (Print, Export CSV) live under More and open as a small stacked list. On a computer every action stays visible.
- **Lists with a details panel** (for example the Students list):
  - Tapping a row **shrinks the list to that one row**, hiding the headings and footer, and shows the details directly underneath.
  - A **"Show all students (N)"** button brings the full list back.
  - On a computer the list never shrinks, because the details sit in the right-hand panel.
- **Detail pages** (for example the Student profile) **open with the photo/details box** that is the right-hand panel on a computer.
  - On a phone the box moves to the top, under the menu bar, with "‹ Students" and the name added at its top.
  - The tabs and cards follow below it.
  - The desktop page header, which duplicates the name, is hidden on phones.
- **Form fields** use 16px text, so iOS doesn't zoom in when a field is tapped.
- **Page side padding** is 16px.

**Reference:** the vision's "Phone · …" boards show all six screens at 390px wide. The rules live in each vision screen's styles. When the real menu and panel components are built in `packages/ui`, they must follow the same rules.

### Stat rows (numbers with labels)

For example: Sessions / Hours / This month, or Check-ins / Students per class / Classes per student.

- **Columns:** the stats sit in equal-width columns side by side, on phones as well.
- **Numbers always line up on one line.** Each label sits in the same fixed-height slot, room for two short lines, so a label that wraps never pushes its number down.
- **Labels:** 12px uppercase, 0.06em letter spacing, grey. Keep them short.
- **"Soon" goes under the number,** never inside the label, so the label stays one line.

### Avatars: people vs classes

- **People** (students, coaches, staff) have **round** avatars: their photo, or their initials on a soft grey circle.
- **Classes** have **rounded-square** avatars: 40px on a computer and 44px on a phone, with 10–12px corners.
  - They show the class's own **banner image** (`Class.bannerUrl`, uploaded on the class form), cropped to a square.
  - With no banner, a soft tile shows the class initials (for example "AG" for Advanced (Gi)).
- **The different shapes tell people and classes apart at a glance.** Use class avatars wherever a class appears in a list: attendance history, today's classes, bookings and the timetable.
- **Order in every class row: avatar → class name (with coach/branch underneath) → time or date → the rest.** For example, the booked count or check-in method.
  - On narrow cards, secondary numbers go under the time: "Done · 18/24 booked".

### Never the same colour twice (product owner, 20 Oct 2026)

A selected, active, focused or "on" state must never use the same colour as the surface behind it, or as a control sitting on it. Otherwise the control disappears.

The cases found so far, with their fixes:
- **Round icon button in a selected list row:** the button turns white with an outline, because the row highlight is the same grey.
- **Status badge on a selected row:** it gets a 1px outline in a darker shade of its own colour.
- **Switch knob on the pale-green "on" track:** the knob is outlined (`--switch-knob-ring`).
- **Soft form fields:** these are grey, so a form always sits on white (`.ultm8-chapter-form`).
- **A focused field in dark mode:** it uses `--surface-2`, not the card colour.

When a new state colour is added, check it against every surface it can appear on, in light and dark mode.

**Fixes for the current app's styles, held back until the new look goes live.** These are in `packages/ui/src/redesign-fixes.css`. Every rule there is scoped to `[data-look='redesign']`, which the live app never sets, so the live app is unchanged. The product owner asked on 20 Oct 2026 that the live app stay untouched.
- **Time zone and currency pickers:** the highlighted option used a fixed light colour (dark mode 1.0:1 → 9.1:1).
- **Dark-mode tinted backgrounds** (`--bg-accent`, `--bg-success`, `--bg-warning`, `--bg-danger`) and their text colours. This changes:
  - the accent badge (1.7:1 → 5.2:1)
  - field error text (2.8:1 → 9.3:1)
  - danger buttons and banners, which also get softer
- **Old side menu, selected link:** it was white on an almost-white menu. It now uses the new menu's pale green with a 4px bar.

Turning the new look on means setting `data-look="redesign"` on `<html>`. A check renders all 113 existing component classes from `master` and from the redesign branch with the switch off, in light and dark mode, and finds 0 differences.

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
