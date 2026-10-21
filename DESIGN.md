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

### Side menu text (product owner, 21 Oct 2026)
- Menu links (Dashboard … Notifications, Settings, Help) are **14px, regular weight, no extra letter-spacing**, the same as the right panel's text. Before this they were 15px with 0.04em spacing and looked big and heavy next to the tabs.
- The School name at the top stays 15px, also with no extra letter-spacing.

### Side menu stays in view (product owner, 21 Oct 2026)

On a computer the side menu is pinned to the screen (`position: sticky; top: 0; height: 100vh`). Its foot (Settings, Help and the signed-in account) is always visible, however long the page, and the menu scrolls on its own if the screen is very short. On phones the menu is the pinned top bar, with Settings in its row.

### Phone layout (product owner, 20 Oct 2026)

**Every feature added to the desktop must also be on the phone version** (product owner, 21 Oct 2026). Never ship a desktop-only control. Each change is checked at phone width before it's called done.

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

### Avatars: one shape, the circle (product owner, 20 Oct 2026)

- **Every avatar is a circle**: people and classes alike. Two shapes side by side looks unfinished, so square or rounded-square avatars are never used.
- **The school logo is the only exception**: a small rounded square (8px corners), shown whole on a plain tile and never cropped, because real logos come in any shape. It appears once, in the menu or top bar, never in a list beside avatars.
- **People** (students, coaches, staff): their photo, or their initials on a soft grey circle.
- **Classes**: same sizes as people (see the size table below).
  - They show the class's own **banner image** (`Class.bannerUrl`, uploaded on the class form), cropped to a circle.
  - With no banner, a soft-coloured circle shows the class initials (for example "AG" for Advanced (Gi)). The colour, not the shape, tells one class from another.
- **Avatar sizes depend on where the avatar sits, never on what it shows.** A student and a class in the same kind of spot are always the same size:

  | Where | Computer | Phone |
  |---|---|---|
  | Inside a line of text (e.g. "booked by Sofia") | 24px | 24px |
  | Your own account (bottom of the menu / top bar) | 32px | 32px |
  | Any list row: students, classes, attendance, today's classes, check-in | 40px | 44px (easier to tap) |
  | Right panel header, and the live preview card on forms | 64px | 64px |
  | Full profile page, the big picture at the top | 96px | 80px |

  No other avatar sizes. The two big sizes appear only once per screen.
- Use class avatars wherever a class appears in a list: attendance history, today's classes, bookings and the timetable.
- **Order in every class row: avatar → class name (with coach/branch underneath) → time or date → the rest.** For example, the booked count or check-in method.
  - On narrow cards, secondary numbers go under the time: "Done · 18/24 booked".
  - On a computer, the columns in a class row have capped widths, so they sit close together. Spare width goes to the end of the row, never between the class name and the date.

### Grading screens (New Portal vision, 20 Oct 2026)

The grading system as built, shown in the new look. Every label and rule stays as it is in the code; only layout and look change.

- **Where things live.** "Grading" in the menu opens five tabs, in this order: **Board** · **Styles & Belts** (the ladder and belt editor) · **Skills** · **Permissions** · **Settings** (product owner, 21 Oct 2026). A student's grading is the **Ranks** tab of their profile. "Styles & Belts" is always written with a capital B.
  - **Skills tab:** pick a style, then a list of its Skills with **+ Add skill**, and Edit and Delete on every row. Each row shows how many grades require the skill and how many students are working on it. The right panel shows the selected skill. Adding or editing asks for a name (required, unique within the style) and an optional description. A skill that students are already being signed off on can't be deleted; the dialog says why.
  - **Settings tab:** the same page as **Settings → Grading**, a new category after Check-in, laid out like Check-in rules (sections of settings on the left, "About this setting" panel on the right, Discard / Save changes bar). Sections: How ranks are shown, Grading rules, Grading Board columns, Whole school.
- **Ranks without a belt** (product owner, 21 Oct 2026), e.g. No-Gi: Beginner, Intermediate, Advanced.
  - Each style is set up as **either Belts or Levels**, never a mix: "Ranks shown as: Belts / Levels (no belt)" in the Add/Edit discipline dialog and in "About this style".
  - **The level badge:** a rounded tag in a colour the school picks (colour wheel as for belts), with dots for the step: "●●○" = step 2 of 3. Same sizes as the belt picture (72 × 16, large 168 × 30); text is dark or white to suit the colour.
  - **Levels have numbered steps** ("Beginner 1, 2, 3"), each with its own requirements, like stripe grades on a belt.
  - **In the editor:** "Level and steps", "Badge colour" (no secondary or tag colour, no stripes), "Steps of Beginner", "+ Add step", "Delete step".
  - The page title stays "Add rank".
- **Belt picture.** Always drawn like `BeltChip`:
  - The belt colour. A two-tone belt has its **second colour as a band through the middle** (the middle 30%, from 35% to 65%), like a real Grey/White or Grey/Black kids' belt (product owner, 21 Oct 2026). It is never split top and bottom. The live `BeltChip` still splits top/bottom and must change when the redesign is built.
  - A tag with the stripes: 3px stripes with 2px gaps.
  - An 8px tip in the belt colour.
  - Sizes: 72 × 16 px in rows and cards; 168 × 30 px as the large picture in a panel or at the top of a student's style card. The rank name always sits next to it.
- **Board.**
  - **Columns:** the three columns (Just Starting / Getting There / Ready to Grade) are soft grey trays. Student cards inside them are white.
  - **Each card**, top to bottom:
    - checkbox, 40px circle avatar, name, and the % on the right (green at 100%)
    - the belt and rank name on their own line
    - a progress bar
    - tags, then Move
  - **Selection:**
    - A selected card gets a slate ring.
    - A ticked card turns pale green.
    - Clicking a card fills the right panel: the large belt, "Toward {next} — %", the ticks and the skills.
  - **When the right panel shows** (product owner, 21 Oct 2026):
    - **Nothing opened, nothing ticked:** no right panel; the board uses the full width.
    - **Click a student:** their panel opens, sticky on desktop so it stays in view while the board scrolls. A round ✕ in its header closes it.
    - **Tick students:** a compact **Selection** panel shows instead. It has "N selected", one row per student (32px avatar, name, belt picture → next rank, a ✕ to take them out), then **Promote N students** and **Clear selection**. Clicking a name opens that student's panel.
    - **– (make small)** shrinks the Selection panel to a floating pill at the bottom right: "N selected ▴" plus **Promote**. Tapping "N selected" opens it again. The pill also shows while a student's panel is open and others are ticked, so the selection is never hidden.
    - **Phone:** both panels are bottom sheets (up to 72% of the screen, rounded top corners) instead of sitting below the whole board. The pill spans the screen width.
    - On the New Portal canvas these states have their own boards next to G1, in the row below the phone boards: "3 students ticked", "selection made small", "a student opened" and the two phone versions.
  - **Right panel, below the skills** (product owner, 21 Oct 2026):
    - **Grading history:** the last 4 entries, newest first. Each shows Promoted / Stripe awarded, the date, the two belt pictures (from → to), "from → to", who graded, and any system note ("Skipped N rank(s) in between."). A promotion made on the board appears at the top straight away. "See full history ›" opens the student's Ranks tab.
    - **Buttons:** Promote (pale green) · Move to another column · Open grading page › · **Open full student view ›** (dark), which opens the student profile on its Profile tab. They sit straight under the history, 16px below it, never pinned to the bottom of the panel (product owner, 21 Oct 2026).
  - **The selected student's own data, everywhere** (product owner, 21 Oct 2026).
    - Selecting a student on the board (Gi or No-Gi, Kids or Adult) and opening "Open full student view" or "Open grading page" always shows that student. That covers name, check-in code, phone, email, birthday and age, gender (Female/Male), member since, home branch and membership.
    - The Training section lists **every rank they hold, one row per style**, e.g. "Brazilian Jiu-Jitsu · Adult: Blue Belt · 2 Stripes" and "No-Gi: Advanced 1". The Programme row reads "Brazilian Jiu-Jitsu · No-Gi".
    - The Ranks tab shows one card per style they hold a rank in, plus "Give first rank" for a discipline they don't train yet. It never offers the other program of a discipline they're already in (an adult doesn't see an empty Kids card).
    - A student who trains both appears on both boards (Gi and No-Gi), each with its own rank and progress.
  - **Click a progress bar to promote** (product owner, 21 Oct 2026). Every progress bar is a button: on a card, in a row and in the right panel. It opens the promote dialog for that one student, titled "Promote {name}", with the same "Promote to", checks and acknowledgement as bulk promote. It doesn't change the ticked students. The bar gets a pale-green ring on hover.
- **Grid or Rows.** A switch in the board's toolbar shows the same students two ways:
  - **Grid:** the three columns side by side.
  - **Rows:** three stacked groups, **Ready to Grade on top**, then Getting There, then Just Starting. Each group has its count, its % range and "Select all".
    - Each row, laid out like the Instructors' belts list: tick box, 40px avatar and name, the belt with its rank name and "→ next rank" under it, a progress bar with the %, the "needs" tags, and Move.
    - Highest progress comes first within each group.
    - A coloured strip on the group's left edge marks it: green for Ready to Grade, slate for Getting There, grey for Just Starting.
    - On phones each row keeps the tick box, the name (with the belt and tags under it) and the progress.
  - Ticking, Select all, Promote selected, Move and the right panel work the same in both views.
  - **No branch** follows the switch too (product owner, 21 Oct 2026): in Rows, its students are rows like the groups below, with the "Choose a branch" picker and Assign on a line under each row.
- **Kids and Adult programs** (product owner, 21 Oct 2026; Decision 274, which corrects 273).
  - Brazilian Jiu-Jitsu has two separate programs, each with its own ladder: **Kids** (White, then the kids belts) and **Adult** (White, Blue, Purple, Brown, Black).
  - **Grading a kid into Adult.** In "Promote to", a Kids student's list goes on past the kids ranks into a small grey heading, **ADULT PROGRAM**, followed by the adult ranks.
    - Picking one shows "Moves to the Adult program. This is recorded on the history." in blue.
    - The history entry reads "Moved to Adult program". The result list says "(Adult program)".
    - The student then appears under Adult. The same choice is in the Grade dialog on the Ranks tab, labelled "{rank} · Adult program".
  - **"Ready for Adult program"** tag: shown on a Kids student who has reached "Ready for Adult from age" (Grading → Settings, default 16). Nothing moves on its own.
- **Promote selected: pick the rank** (product owner, 21 Oct 2026; skipping is Decision 128 item 7). Each student in the bulk promote dialog has a **Promote to** picker. It starts on the next rank and lists only higher ranks, so a student can go from White Belt · 2 Stripes straight to Blue Belt. A skip shows "Skips N rank(s) in between. This is recorded on the history." in blue, and the result list says "(skipped N)".
  - **The picker is our own drop-down, not the browser's** (product owner, 21 Oct 2026; now the rule for every drop-down, see "Drop-downs" below). A browser `<select>` opens a grey system list that can't be styled. The closed picker is a soft grey 48px field showing the belt picture, the rank name and a chevron; it gets a slate outline while open. The list opens under it inside the dialog: a white card, 14px corners, at most 264px tall and scrolling. Each option is 44px high with its belt picture and name. Hover is light grey; the chosen rank is pale green (#def2e2) with a green ✓. Picking closes the list. It is `role="listbox"` with `role="option"` rows. Use this pattern wherever a choice of ranks or belts needs styling; plain `<select>` stays fine for short text-only lists.
  - ⚠️ **Open:** which rank's requirements apply when a student skips. The design copies the single-student Grade dialog: the "Needs a look" checks (skills, days short) only apply to the next rank, so they drop away on a skip. Students blocked by "Skills required" still can't be promoted and get no picker. This needs a product-owner decision before the API is built.
- **Tags:**
  - Green: Ready.
  - Amber: needs a look ("Skills not signed off", "n days short").
  - Red: blocked or unverified ("Skills required", "Not verified").
  - Grey: Inactive.
- **Belt editor: one grade at a time** (product owner, 21 Oct 2026, following the flow of the earlier grading prototype). A grade is each step a student can reach on a belt: the plain belt first, then each stripe.
  - **Top:** "Grades of White Belt", a row of pills, one per grade: belt picture plus "Plain belt", "1 stripe", "2 stripes"…, with a small count of students holding it.
    - Tapping a pill picks the grade being edited.
    - "+ Add stripe grade" adds the next stripe.
    - Under the pills: "Grade 5 of 5 · 1 student on this grade", with ↑ ↓ and Delete grade.
  - **01 Belt and stripes:**
    - The **name box follows the picked grade**:
      - On the plain belt it's the **Rank name** ("White Belt").
      - On any other grade it's **"Name of this grade"**, already filled with "White Belt · 2 Stripes". It can be edited there; clearing it goes back to the made-up name.
      - Renaming the rank renames every grade that hasn't been renamed by hand.
    - Then the colours, shared by every grade of the belt, and "Stripes on this grade".
  - **02 What it takes:** the picked grade's requirements.
  - **Preview:** the live preview shows the picked grade.
  - **Adding a rank:**
    - The title stays **"Add rank"**, because a rank can be something other than a belt (e.g. No-Gi levels).
    - Chapter 01 has **"Where it goes in the ladder"**: "First, before White Belt" / "After Blue Belt" / … / "Last, after Black Belt". The default is last, and the preview shows "Belt 4 of 6".
    - The new rank is saved at that place.
  - **Drag and drop on the ladder** (product owner, 21 Oct 2026):
    - Grab a rank by its ⠿ handle and drop it above or below another. A green line shows where it will land, and the dragged row fades.
    - It works with a mouse and a finger (pointer events, not the browser's own drag), and never selects text.
    - The ↑ ↓ arrows stay for keyboard users.
    - A drop is a reorder like the arrows: "The new order isn't saved yet", then Save order, with "Reorder belts?" when students are affected.
  - **Duplicate a rank** (product owner, 21 Oct 2026):
    - Each ladder row has **Duplicate** next to Edit; the rank's side panel has it next to "Edit this belt".
    - It opens the editor titled "Duplicate Blue Belt", already filled with a copy: the colours, every grade and what each takes.
      - It's named "Blue Belt (copy)", with no students, and placed right after the original.
      - A blue note says: "Give it a new name and colour, then save."
    - On phones the six row buttons sit three per row.
  - **Requirements check:** "Ready to save" has a fourth line.
    - It reads "Every grade says what it takes" once each grade has classes or days set.
    - Otherwise it's an amber "Check what it takes: Plain belt, 1 stripe (0 classes and 0 days)".
    - It's a warning, not a block: the live app allows 0.
    - The very first grade of the whole ladder may be empty.
  - **New stripe grades** copy the previous grade's numbers and class types (not its skills).
  - No list of expanding boxes, and never two sections for the same grade.
- **Stripe colours.** A stripe can have more than one colour group (e.g. 2 red + 2 white).
  - Each group is a box with a round selector and its name ("Colour 2 · 1 stripe"). Tap the box to select it.
  - One **Remove** button sits beside "Add stripes of another colour". It removes the selected group, and its label names it ("Remove colour 2"); with one group it just says "Remove".
  - There are no per-group Remove buttons.
  - A new colour group is selected as soon as it's added.
- **Colour choices.** Every colour row (base, secondary, tag and each stripe colour) shows the preset circles, then the School's **saved colours**, then a dashed **"+"** circle.
  - "+" opens a **colour panel** under the row. It has:
    - a **colour wheel**, so any colour can be chosen: tap or drag; the centre is white and the edge is full colour
    - a **Brightness** slider
    - a large preview circle
    - a "Colour code" box (e.g. #2A9D8F); typing a code moves the marker on the wheel
  - The panel stays open until **Save colour** or **Cancel**. Picking, dragging or typing never closes it.
  - **Save colour** applies the colour and adds it to the saved colours, which then appear in every colour row.
  - A chosen custom colour shows a line under the row: "Custom colour #2A9D8F", with **Edit** and **Delete**. If the colour isn't saved yet, it says "· not saved" and offers **Save** instead of Delete.
  - **Edit** reopens the panel and replaces that saved colour.
  - **Delete** removes it from the saved colours only. Belts already using it keep their colour.
  - A wrong code shows "Use a colour code like #2A9D8F." and Save stays off.
  - The wheel is our own, not the browser's colour picker. The browser's picker closes when the page updates, and it looks different on every device.
- **Dialogs.** A centred white card over a dimmed page, up to 560px wide (640px for bulk promote). Cancel and the action sit in a grey footer. On phones the dialog fills the screen and the footer buttons share the width.
- **Phone.** The columns stack in the order Just Starting, Getting There, Ready to Grade. Permission toggles become one list of switches.

### Drop-downs (product owner, 21 Oct 2026)
- **Every drop-down in the new look is our own, never a browser `<select>`.** The browser draws its list as a grey system box that CSS can't style.
- **Closed:** a soft grey field with the value and a chevron. The value and every option use the same text colour (#383d42), the chosen option included. Placeholder text ("Choose a branch") is only slightly softer (#50575e), never pale grey, so it doesn't look like a different font. It gets a slate outline while open.
- **Width:** exactly as wide as its longest option (plus padding and the chevron), never stretched to fill the row. It doesn't jump when the value changes. The only limit is the width of its container.
- **Open:** the list opens under the field and pushes the content down, so a dialog or a card never clips it. It is a white card, 12px corners, at most 264px tall and scrolling.
- **Options:** 40px rows (48px and 16px text on phones). Hover is light grey. The chosen option is pale green (#def2e2) with a ✓ in #3a7556. Picking closes the list.
- **Font:** Figtree everywhere, and the options always use the same size as their field. That's 14px, or 15px inside a soft form (`.ultm8-soft-field`, where the field is 52px to match the inputs), and 16px on phones.
- The **Promote to** picker uses the same drop-down, with a belt picture before each rank.
- Built as `role="listbox"` / `role="option"`. In the vision pages it comes from `dd()` / `ddMake()`.

### Greens: mint, not dark green (product owner, 21 Oct 2026)
- **Fills** (progress bars at 100%, the Ready to Grade strip, ticks, switch tracks, the menu's selected bar): **mint #9fd3b2**, a soft matte green, never a bold solid one.
- **Green text and icons** (100%, ✓, the text of green tags such as "Signed off" and "Active"): **#3a7556**. It passes 4.5:1 on white and on pale green.
- The old dark greens (#1f7a4d, #1f6440, #1f4d36) are no longer used in the new look. The live app keeps its own `--color-success` until the new look goes live.
- **The secondary dark button** ("Open full student view", "Invite") is **soft blue: #e5ecf6 with #2b4f80 text**, not black.

### Progress bar colours: one soft colour per board level (product owner, 21 Oct 2026)
- Every progress bar takes the colour of the student's board level, never a dark one:
  - **Just Starting:** soft peach **#f4c7a1**
  - **Getting There:** soft sky **#a8c5ea**
  - **Ready to Grade:** mint **#9fd3b2**
- The same colour marks the group's left edge in Rows, and the bar in the right panel and on the Ranks tab.
- The % next to a bar carries the meaning, so the soft bar colour doesn't need text contrast. The track stays #e1e3e5.

### One accent: mint, with calm grey (product owner, 21 Oct 2026; option C)
- Soft blue next to pale green didn't work, so the new look has **one accent: mint**. There are no blue fills and nothing filled dark slate or black. The only exceptions are QR codes, belt colours and status tags.
- **Actions and "where you are"** are mint: the selected menu item, Promote, Save and the other main buttons (#def2e2), Ready, 100% bars and the Ready to Grade strip (#9fd3b2). Green text is #3a7556.
- **Selections are white or grey, never coloured:**
  - A chosen pill (Student / Visitor, the style switch) is white with a soft shadow on the grey track.
  - A ticked checkbox is white with a green tick and border (#3a7556).
  - A selected filter chip is white with a thin green ring.
- **Secondary buttons** ("Open full student view", "Invite") are white with a grey outline.
- **Cards, bars and notes** use calm grey: cards #eef1f3 with #383d42 text and #6c767f for quieter lines. That covers the New student / ID preview, the Settings check-in preview and the Check-in keypad panel (white keys, a mint ✓). The "unsaved changes" and undo bars, info notes and the SJ logo square use #edf0f2.
- **Switches that are on** use the pale-green track.
- **Blue stays only** in the "Getting There" progress bar (#a8c5ea) and in status tags that mean something ("Frozen", "Learning", info tags). Small charts (attendance, class history) are mint.

### Style switch: one look everywhere (product owner, 21 Oct 2026)
- Picking a style always looks like the Grading Board: a light grey track (#edf0f2) holding the choices, with the chosen one white, raised by a soft shadow. Never dark filled pills or outlined pills.
- The disciplines come first (Brazilian Jiu-Jitsu · No-Gi). When a discipline has programs, a second switch **Kids · Adult** follows it, Kids first.
- The same switch is used on the Board, Styles & Belts, Skills and Settings, desktop and phone. In the vision pages it comes from `style_switch()` / `styleSwitch()`.

### Button pairs (product owner, 21 Oct 2026)
- Two buttons side by side, like "Edit this belt" and "Duplicate", share the row equally: same height, same width, one line, 8px apart. Never one wide button next to a narrow one.

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
