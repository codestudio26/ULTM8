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

### Side menu text (product owner, 21 Oct 2026; icon tiles 23 Oct 2026)
- Menu links (Dashboard … Notifications, Settings, Help) are **14px, regular weight, no extra letter-spacing**, the same as the right panel's text. Before this they were 15px with 0.04em spacing and looked big and heavy next to the tabs.
- **Icon tiles** (product owner, 23 Oct 2026: idea 2 of five, the "Side menu — five ideas" boards). The type and spacing follow the right panel: **40px rows, 20px sides**; the School name and search line up at 20px too, and the School name is 14px. Each icon (18px, the same outline icons) sits in a **34px soft tile, 10px corners, #edf0f2**, with the icon in #3e4b56. The page you are on has a **mint tile (#9fd3b2)** with a #20262c icon, on a pale-green row (#def2e2); no bold and no edge bar. The menu stays the full 248px wide.
- On phones the menu's row of rounded buttons keeps the tiles at 28px.
- The coach's menu (Dashboard, Grading Board, My belts, Invite coaches, Notifications) uses the same tiles.
- In the vision pages the tiles are applied by `apply_nav2.py` after the generators run.

### Side panel buttons sit under the content (product owner, 23 Oct 2026)
In every right-hand panel (Students, Team, the coach view, the Grading Board), the panel's buttons ("Open full page ›", "Grading permissions ›", "Open the Grading Board ›") sit **straight under the last section, 16–18px below it**, never pinned to the bottom of the panel. A short panel no longer leaves the button far down the screen.

### Coach view: nothing shown twice, cards first on a phone (product owner, 23 Oct 2026)
On a phone the coach's pages show the cards first and the side panel below them, like the other pages. The panel never repeats the page:
- **Dashboard:** "Open the Grading Board" is only on the Grading card (not again under the panel). The panel's **Ready to grade** list is the one place for ready students; the Notifications card leaves out "… is ready to grade" alerts and says so ("Ready to grade" alerts are in the Ready to grade list). **Coming up** in My classes starts after today's class, which is the panel's "Next class".
- **My belts:** the belt drop-down shows the belt picture, so there is no second picture beside Save.
- **Invite coaches:** the card has only the form; **How invites work** in the panel explains the steps, including "If they already train here, they keep their student account too."

### Dashboard: nothing shown twice, cards first on a phone (product owner, 23 Oct 2026)
On a phone the Dashboard shows the number cards and lists first and **Needs attention** (Notifications) below them; the panel shares nothing with the page. Inside the page each fact appears once:
- **The School's name** is on the School switcher only; the line under "Dashboard" says just the branch scope ("All branches").
- **Ready to grade** is one list, not a number card as well. Its header carries the count as **See all 5 →**, which opens the Grading Board. The number cards are Bookings this week, Check-ins today and Active students.

### Check-in: nothing shown twice, cards first on a phone (product owner, 23 Oct 2026)
On a phone Check-in shows Today's classes and the keypad first and **Recent check-ins** below them. The panel shares nothing with the page. A check-in updates both sides together: the student goes to the top of Recent check-ins and their class's "checked in" count goes up by one. The line under the keypad says only **Checked in ✓** (product owner, 23 Oct 2026): who checked in, and to which class, is in Recent check-ins. It clears on the next key press.

### Settings: nothing shown twice, settings first on a phone (product owner, 23 Oct 2026)
On a phone Settings shows the category menu and the settings first, and the student preview and **About this setting** below them.
- **About this setting** names the setting and explains it. It has no "On/Off" or "Set to: …" chip: the switch or drop-down on the page already shows the value.
- **Show belt progress on the check-in screen** has no "e.g. 12 of 40 classes to Blue" hint: the preview shows exactly that line.
- The page's intro says "Click any setting to see what it does in About this setting", naming the section as it is labelled.

### Add student: nothing shown twice, form first on a phone (product owner, 23 Oct 2026)
On a phone Add student shows the form first and the preview card, **Ready to save** and the Add student button below it.
- Chapter progress shows once, on the form: the chapter number turns green and gets a **Done** tag. The panel no longer has the row of chapter circles (01–06) or "2 of 6 chapters".
- **Ready to save** lists only what saving needs: name, date of birth, contact, and the Guardian for a child. Address, photo, waivers and app access are shown once, by their section's **Done** tag (product owner, 23 Oct 2026). The button sits right under it.
- The preview card mirrors what is typed (name, type, check-in code). That is its job, so it is not counted as a repeat.

### Grading Board: the student panel never repeats the card (product owner, 23 Oct 2026)
On a phone the board's cards come first and the student panel sits below the board, like every other page (product owner, 23 Oct 2026). Tapping a student scrolls down to their panel. The panel shows only what the card doesn't:
- **Left out** because the card shows them: the current belt box (picture, rank, "since", "not verified"), the progress bar and the "— 56%" after **Toward …**, and **Move to another column** (the card has Move).
- **Kept:** name and branch, **Toward {next rank}** with the classes, time at this rank and skills ticks, the promotion fee box and price, skills for the next rank, grading history, and Promote · Open grading page › · Open full student view ›.
- "See full history ›" is gone: it opened the same page as **Open grading page ›**.

### Styles & Belts, Skills, Permissions and Grading settings: nothing shown twice (product owner, 23 Oct 2026)
On a phone every one of these pages shows its content first and the side panel below. The panel names what it is about (a belt, a skill, a setting), then shows only what the page doesn't:
- **Styles & Belts, a belt picked:** the panel has no Edit this belt / Duplicate buttons (the row has them) and no stripe count (the row shows it). It keeps the belt, how many students hold it, and what each grade takes.
- **Belt editor:** the preview card no longer repeats the style name (it's in the back link), and **Ready to save** has no "4 of 4" count. On a phone the sticky Save bar is the only Save / Cancel: the panel's own pair is hidden there.
- **Skills, a skill picked:** no Edit / Delete in the panel; the row has them.
- **Permissions:** "Ticking May grade…" is said once, in the panel's **How permissions work**. "You (the owner) can always do everything" is said once, in the panel's **The owner**.
- **Grading settings and Settings → Check-in rules:** About this setting doesn't repeat the short line under the setting (for example "For a child, the Guardian signs" or "Belts: a belt picture with stripes"). The intro says "…in About this setting".
- Pages with no side panel (the student's Ranks tab, the student app) needed no change.

### Styles & Belts: archive a style, students per style, skill order, class types list, coach view (Decisions 308, 309)
- **Archive (owner only).** Edit · Duplicate · **Archive** · Delete sit with the style switch. Archive asks first ("Use this when your School stops teaching a style…") and is refused while upcoming classes or timetable slots use the style, with the counts. An archived style is hidden from the switch until **Show archived** is ticked; its button reads "… · Archived", the page says "This style is archived: you can look, but not change it or grade in it", every edit control is gone, and **Unarchive** brings it back.
- **Class types are a list** in Edit discipline: one row each, with ↑ ↓ and ✕, and **+ Add class type**. Renaming one renames it on every grade that uses it. Removing one that an upcoming class, a timetable slot or a grade still uses is refused with the counts. A name listed twice is refused.
- **Students (owner only):** a card under Skills lists everyone with a rank in the style, lowest belt first, with their belt, each linking to the student. The panel keeps the Students count; the card has no count, so the number isn't shown twice.
- **Skills** show **Required for** (the grades that need them, in ladder order) and how many **lessons** teach them, and the owner puts them in order with ↑ ↓. The Skills tab rows show the lesson count and have the same ↑ ↓.
- **Coach / Branch Staff view (G3c):** the same page, read-only: no Edit, Archive, Add, drag or order buttons, no per-belt student counts and no Students card, and the note "Only the School owner can change this style."

### Grading settings: "Promotion to decide" reminder (Decision 313)
A new always-on row under the whole-School notifications: one reminder to the coaches who may promote, 3 days after a fee was cancelled or a declined fee was waived, only when the student is fully ready (every class required, enough days, every skill signed off). It is not repeated and the promotion never times out. "Ready to grade" now says plainly that it is sent only when a student is fully ready, even though the board's Ready to Grade column starts at 66%.

### Students list: open full page from each row, panel never repeats the row (product owner, 23 Oct 2026)
- **Every row** has **Open full page ›** under the name and status (phone and desktop). It opens that student's full page.
- **The side panel** shows only what the row doesn't: name, "Student since", the check-in code, Access · Call · Message · Edit, Training (home branch), Account (membership, balance, family) and tags.
- **Left out of the panel** because the row shows them: the status tag, Contact (phone, email), Guardian, the belt and the panel's own "Open full page ›".

### Student page: nothing shown twice (product owner, 23 Oct 2026)
The student page follows the same rule as the team member page: the right panel never repeats what the page shows.
- **Right panel:** status and "Student since", Edit, the check-in code, Send access · Call · Message · QR card, Contact, Personal (birthday and age, gender), Training (home branch only), Account (balance, Manage family account) and Tags.
- **Removed from the panel:** each style's rank and the Programme (the Ranks tab shows them, with progress and history) and the Membership (the Memberships card on Profile shows it, with price and next payment).

### Team member full page (product owner, 23 Oct 2026)
Instructors and Branch Staff get a full page like a student's (`StaffProfile.dc.html`, board 7). It opens from **Open full page ›** in the Team page's side panel, or from the **Open full page ›** link under each name on the **Coaches Info** tab (renamed from "Instructors' belts", product owner 23 Oct 2026; its card is headed "Belts"); "‹ Team" goes back. **Open full page ›** is a link under every name on the **Staff** and **Coaches Info** lists (phone and desktop). The Team side panel never repeats its list (product owner, 23 Oct 2026):
  - **Staff tab:** the panel leaves out the role tags, Branches, "Open full page ›" and "Grading permissions ›" (the list rows and the card header have them); it shows the person's belts and Front desk and money.
  - **Coaches Info tab:** the panel leaves out the belts and "Open full page ›" (the table has them); it shows roles, branches, Front desk and money and "Grading permissions ›".
  - **Invite coaches tab:** the panel shows everything, with "Open full page ›".
- **Layout:** the same as the student page. Header "‹ Team" and the name (30px light), tabs underneath, white cards on the left (up to 980px), and the **Team member** summary panel on the right.
- **Nothing is shown twice** (product owner, 23 Oct 2026). The right panel holds who the person is and how to reach them: 64px avatar, name, Email · Call · Edit as mint tiles, and Contact (email, phone). Everything else is on the page only: their roles, branches and status are in **Roles**, and belts, rights and classes are in their own cards. The page has no second Edit button.
- **Everything from the Team page's side panel is on the Profile tab** (product owner, 23 Oct 2026): branches (in Roles), belts and the Front desk and money switches.
- **Tabs:** Instructor: Profile · Classes · Grading. Branch Staff: Profile · Grading.
  - **Profile:** About (Instructor only: years of experience and specializations as tags), **Belts** (Instructor: the belt in each style, Verified / Not verified with **Verify** / Not chosen), **Front desk and money** (Can create charges, Can start open mat sessions, and for Branch Staff Can invite coaches; "Refunds and credit stay with you, the owner."), Roles (each role with its branch and status), for an Instructor the next two classes with "All classes ›", and last a red-outlined **Remove from the team** card with **Revoke enrollment** (Instructor) or **Revoke role** (Branch Staff), as the built pages do.
  - **Classes:** upcoming classes with date, branch and "12 of 20 booked" (the built Instructor detail page's list); an empty state when there are none.
  - **Grading:** a read-only table of their Grading permissions per style (✓ or –, "Doesn't grade this style"), with "Change in Grading permissions ›".
- **Phone is a mirror of the desktop** (product owner, 23 Oct 2026): the Team page's side panel, with **Open full page ›**, sits under the staff list, and the full page has the same tabs, cards and summary panel (below the cards).
- Everything on it comes from what ULTM8 already has: the Instructor detail page, the Staff page, Instructors' belts, Grading permissions and the per-person rights (Decisions 183, 303, 304). Nothing new is invented.
- **Phone layout:** the tabs wrap, the cards run full width, the summary panel moves below, and the permissions table turns its headings sideways so the seven columns fit.

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
- **Detail pages** (the Student profile and the team member page) **show the name, the tabs and the cards first, then the photo/details box** that is the right-hand panel on a computer, below them (product owner, 23 Oct 2026; before this the Student profile opened with the box).
  - On a phone the page header ("‹ Students" or "‹ Team" and the name) stays at the top, then the tabs and cards.
  - The box follows below the cards, full width, without repeating the name.
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
  - **Settings tab:** the same page as **Settings → Grading**, a new category after Check-in, laid out like Check-in rules (sections of settings on the left, "About this setting" panel on the right, Discard / Save changes bar). Sections: How ranks are shown, Grading rules, Grading Board columns, **Promotion fee · whole school** (owner only, see below), Whole school (now with **"Open mat counts toward hours"**).
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
    - **– (make small)** shrinks the Selection panel to a floating pill at the bottom right: "N selected ▴" plus **Promote**. Tapping "N selected" opens it again. The toolbar's **"N selected ▸"** is also a button that opens it (product owner, 21 Oct 2026: the pill alone was easy to miss). The pill also shows while a student's panel is open and others are ticked, so the selection is never hidden.
    - **Phone:** both panels are bottom sheets (up to 72% of the screen, rounded top corners) instead of sitting below the whole board. Ticking students only shows the pill, so the sheet never covers the board while you tick. Tapping the pill opens the sheet. While the pill shows, the board gets 96px of extra space at the bottom so the last card's checkbox and Move button can scroll clear of it.
  - **Student avatars, everywhere a student is listed:** the board's cards and rows, the right panel (64px), the Selection list (32px), the Promote dialog and the "Students promoted" result (32px), and the printable report (36px). Each shows the student's photo when they have one, otherwise their initials in a grey circle (#d3d9df).
  - **"Students promoted" result** (wide dialog, up to 860px): **one line per student**: number, avatar and name, the from belt with its rank name, →, then the to belt with its rank name.
    - Under 720px the name takes the first line and from → to the second.
    - Under 420px from and to stack, with → before the new rank.
  - **Right panel, below the skills** (product owner, 21 Oct 2026):
    - **Grading history:** the last 4 entries, newest first. Each shows Promoted / Stripe awarded, the date, the two belt pictures (from → to), "from → to", who graded, and any system note ("Skipped N rank(s) in between."). A promotion made on the board appears at the top straight away. "See full history ›" opens the student's Ranks tab.
    - **Buttons:** Promote (pale green) · Move to another column · Open grading page › · **Open full student view ›** (dark), which opens the student profile on its Profile tab. They sit straight under the history, 16px below it, never pinned to the bottom of the panel (product owner, 21 Oct 2026).
  - **The selected student's own data, everywhere** (product owner, 21 Oct 2026).
    - Selecting a student on the board (Gi or No-Gi, Kids or Adult) and opening "Open full student view" or "Open grading page" always shows that student. That covers name, check-in code, phone, email, birthday and age, gender (Female/Male), member since, home branch and membership.
    - The Training section lists **every rank they hold, one row per style**, e.g. "Brazilian Jiu-Jitsu · Adult: Blue Belt · 2 Stripes" and "No-Gi: Advanced 1". The Programme row reads "Brazilian Jiu-Jitsu · No-Gi".
    - The Ranks tab shows one card per style they hold a rank in, plus "Give first rank" for a discipline they don't train yet. It never offers the other program of a discipline they're already in (an adult doesn't see an empty Kids card).
    - A student who trains both appears on both boards (Gi and No-Gi), each with its own rank and progress.
  - **Click a progress bar to promote** (product owner, 21 Oct 2026). Every progress bar is a button: on a card, in a row and in the right panel. It opens the promote dialog for that one student, titled "Promote {name}", with the same "Promote to", checks and acknowledgement as bulk promote. It doesn't change the ticked students. The bar gets a pale-green ring on hover.
- **Sorting** (product owner, 21 Oct 2026). Students are sorted **inside each stage** (No branch, Just Starting, Getting There, Ready to Grade), in Grid and Rows.
  - **Default: by belt, lowest grade first.** Students on the same rank are ordered by surname.
  - The toolbar has **Sort: Belt · Name** (the same grey switch) and a direction button: "Lowest first ↑" / "Highest first ↓" for belt, "A–Z ↓" / "Z–A ↑" for name.
  - In Rows, the **Student** and **Belt → Next** headings also sort; clicking the active one flips the direction, and an arrow shows it.
  - **Phone:** the same Sort switch and direction button are in the toolbar. In Rows, where the belt column is hidden, the heading reads **Student · Belt**, and either word sorts by it, with the same arrows.
- **Grid or Rows.** A switch in the board's toolbar shows the same students two ways:
  - **Grid:** the three columns side by side.
  - **Rows:** three stacked groups, **Ready to Grade on top**, then Getting There, then Just Starting. Each group has its count, its % range and "Select all".
    - Each row, laid out like the Instructors' belts list: tick box, 40px avatar and name, the belt with its rank name and "→ next rank" under it, a progress bar with the %, the "needs" tags, and Move.
    - A coloured strip on the group's left edge marks it: green for Ready to Grade, slate for Getting There, grey for Just Starting.
    - On phones each row keeps the tick box, the name (with the belt and tags under it) and the progress.
  - Ticking, Select all, Promote selected, Move and the right panel work the same in both views.
  - **No branch** follows the switch too (product owner, 21 Oct 2026): in Rows, its students are rows like the groups below, with the "Choose a branch" picker and Assign on a line under each row.
- **Kids and Adult programs** (product owner, 21 Oct 2026; Decision 281, which corrects 280).
  - Brazilian Jiu-Jitsu has two separate programs, each with its own ladder: **Kids** (White, then the kids belts) and **Adult** (White, Blue, Purple, Brown, Black).
  - **Grading a kid into Adult** (rules: Decision 285, product owner 22 Oct 2026). From the School's **"Ready for Adult from age"** (default 16, the IBJJF age), a Kids student's "Promote to" list goes on past the kids ranks into a small grey heading, **ADULT PROGRAM**, followed by the adult ranks **from Blue Belt**. Younger kids don't get the Adult group: to grade one earlier, the School lowers the age in Grading → Settings first.
    - Everything moves with the student (history, notes, skill sign-offs); only the class count starts again from zero.
    - Picking one shows "Moves to the Adult program. This is recorded on the history." in blue.
    - The history entry reads "Moved to Adult program". The result list says "(Adult program)".
    - The student then appears under Adult. The same choice is in the Grade dialog on the Ranks tab, labelled "{rank} · Adult program".
  - **"Ready for Adult program"** tag: shown on a Kids student who has reached "Ready for Adult from age" (Grading → Settings, default 16). Nothing moves on its own. The age can be changed by the owner and coaches with the right to change grading settings.
  - **Grading → Settings, Whole school** also has **"Who can change these settings"** (links to Grading permissions). The promotion fee now has its own owner-only section (see "Promotion fee" below).
- **Promote selected: pick the rank** (product owner, 21 Oct 2026; skipping is Decision 128 item 7). Each student in the bulk promote dialog has a **Promote to** picker. It starts on the next rank and lists only higher ranks, so a student can go from White Belt · 2 Stripes straight to Blue Belt. A skip shows "Skips N rank(s) in between. This is recorded on the history." in blue, and the result list says "(skipped N)".
  - **The picker is our own drop-down, not the browser's** (product owner, 21 Oct 2026; now the rule for every drop-down, see "Drop-downs" below). A browser `<select>` opens a grey system list that can't be styled. The closed picker is a soft grey 48px field showing the belt picture, the rank name and a chevron; it gets a slate outline while open. The list opens under it inside the dialog: a white card, 14px corners, at most 264px tall and scrolling. Each option is 44px high with its belt picture and name. Hover is light grey; the chosen rank is pale green (#def2e2) with a green ✓. Picking closes the list. It is `role="listbox"` with `role="option"` rows. Use this pattern wherever a choice of ranks or belts needs styling; plain `<select>` stays fine for short text-only lists.
  - **A skip doesn't get round the checks** (product owner, 21 Oct 2026, after the stress test). The next rank's checks apply whichever rank is picked, as the API already does: a style's "Skills required" still blocks, and missing skills or days short still need the "Needs a look" acknowledgement. The same holds in the Grade dialog on the Ranks tab.
- **Grading at scale** (product owner, 21 Oct 2026, after a stress test of 20 academies with 300–500 students, grading 50–90% at once):
  - **Only active students are graded up** (Decision 283). An inactive student's tick box is off, with the reason as its tooltip ("Only active students can be graded. Turn on their Active switch, or give them a live membership."). "Select all" skips them. Bulk promote lists them as "Can't be promoted: inactive". Unverified students can still be graded.
  - **No limit on how many students are promoted at once** (Decision 282). The portal sends them 200 at a time; the coach never sees a limit.
  - **25 cards per stage**, then a grey full-width **"Show all N"** button under the stage (in Grid and in Rows). The stage count always shows the full number, and "Select all" picks the whole stage, shown or not.
  - **Ticked students the search hides** are still in the batch, so the toolbar and the Selection panel say "N of them hidden by your search or filter." with a **Show them** link that clears the search and the "Currently attending only" switch.
  - **Students on the top rank** aren't cards (they have no next rank). The toolbar says "N on the top rank, not shown".
  - **One date for the batch** is checked as it's typed: "The grading date can't be in the future." and "The grading date can't be before {name} reached {rank} ({date})." show in red above the list, and the Promote button stays off. The date is used for the history (shown as "19 Oct 2026") and for the student's time at the new rank.
  - **The note and the acknowledgement are saved** on each student's history entry: "Graded without all skills signed off (acknowledged). Note: Spring Grading Day".
  - **The printable report is built from this batch.** "Open printable report" in the done dialog opens it in the page: style, date, "Graded by You", the note, then one row per student (number, avatar, name, from and to belt pictures with names), the students not promoted, and how many were acknowledged. **Print / Save as PDF** prints only the report. On phones each row shows the name on one line, with from and to side by side under it.
  - **The "Promote to" list is built only while it is open**, and the field is sized from the longest rank name, so a 400-student batch opens quickly.
  - **On phones the selection pill sits at the bottom right**, sized to its content, so it never covers the tick boxes on the left.
- **Tags:**
  - Green: Ready.
  - Amber: needs a look ("Skills not signed off", "n days short") and **"Waiting for fee"**.
  - Blue: **"Promotion to decide"** and "Ready for Adult program".
  - Red: blocked or unverified ("Skills required", "Not verified") and **"Fee declined"**.
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
- **"Change grading settings"** (Decision 297). The coach right that was "Change board %" is now "Change grading settings" on the Permissions page, per coach and per style. Its tooltip: everything in Grading → Settings for that style (board %, how ranks are shown, the Ready for Adult age, open mat hours), never the promotion fee.
- **Promotion fee** (Decisions 287, 297, 300, 307; 22 Oct 2026). **Both switches are off by default** (the fee, and "Allow grading before the fee is paid"), and G10 Grading Settings shows them that way. G1 (the board) is a sample School that has turned the fee on, so it shows a waiting and a declined fee. G3 (Styles & Belts) has the fee off, so it shows no prices; G3b is the same page with the fee on.
  - **Grading → Settings → Promotion fee · whole school**, tagged **Owner only** (a coach sees "Only the School owner can change the promotion fee."): **Promotion fee** switch ("Off (the default): promotions are free, and prices don't show in Styles & Belts."); when it is on, **Allow grading before the fee is paid** (switch, off by default), **Prices** ("Set prices in Styles & Belts ›") and **The student accepts first** (Always on). The info panel for "Allow grading…" shows On (green box) and Off (amber box) side by side, plus "You can waive or cancel a fee at any time. Waiving a waiting promotion applies it straight away. Cancelling it, or waiving a declined fee, never promotes on its own: a coach decides."
  - **Belt editor, chapter 03 Promotion fee** (owner only, after 02 What it takes, **only while the fee is on**; with the fee off, Add rank and Edit have no price field at all): "Price for this grade" with the School's currency (R$ in the sample) before the box; empty = **Free**. Under it, a grey line lists the priced grades of this rank ("Priced grades of this rank: Blue Belt: R$ 40. Every other grade is free."). The rank's side panel adds "Promotion fee: R$ 40 / free" to each grade, again only while the fee is on.
  - **Board card and Ranks tab:** "Waiting for fee" (amber) or "Fee declined" (red) tag, first among the tags. A waiting student has no "Ready" tag and no Promote button, and bulk promote lists them as "Can't be promoted: a promotion is already waiting for its fee".
  - **Right panel:** under the rank box, an amber box (red when declined): the tag, "R$ 60 · Purple Belt", then "Graded on 18 Oct 2026. Ben was asked to accept the fee on 18 Oct 2026. The promotion to Purple Belt applies once it is accepted and paid." (declined: "Leo declined the fee on 15 Oct 2026, so the promotion to Blue Belt didn't go ahead. Talk to them, then waive or cancel the fee. Promoting them is then a coach's decision."). Buttons: **Waive fee** and **Cancel fee**. With no fee waiting, the panel shows "Promotion fee for Blue Belt: R$ 40" under the ticks.
  - **Waive and cancel never promote on their own, except waiving a waiting promotion** (Decision 307):
    - **Waive fee on a waiting promotion** applies the grade the coach already made, with their grading date; the history says "Fee waived (R$ 60)."
    - **Cancel fee on a waiting promotion, or Waive or Cancel on a declined fee**, opens **"Promote Ben Taylor?"**: a blue line "The R$ 60 fee for Purple Belt was cancelled.", the from → to belts, and "Promoting is a coach's decision and never happens on its own. Promote Ben to Purple Belt now, without a fee, or leave it as "Promotion to decide" for a coach." Buttons: **Not now** and **Promote to Purple Belt**.
    - **Not now** leaves a blue **"Promotion to decide"** tag on the card and a blue box in the panel ("No fee · Purple Belt. The R$ 60 fee was cancelled. Ben stays on Blue Belt · 4 Stripes until a coach promotes them; nothing happens on its own.") with **Promote to Purple Belt** and **Don't promote**.
    - **Promote to …** opens the normal Promote dialog, starting on the planned rank, with "No fee: it was cancelled." on the row; the coach picks the date and confirms. No new fee request is made, and the history notes "No fee (it was cancelled)." **Don't promote** clears it.
  - **Promote window:** each priced row adds "Promotion fee R$ 40: Lucas is asked to accept it in the app. The promotion waits until it is paid." (or "The promotion happens now; the fee waits."). A child's line names the Guardian.
  - **"Students promoted":** students whose promotion waits are not in the list; an amber line says "Waiting for fee: Lucas Martins (Blue Belt, R$ 40). Each promotion applies once its fee is accepted and paid, dated 20 Oct 2026 as you chose."
- **Hours trained: logged, not graded** (Decisions 301, 306; 22 Oct 2026). **Grading doesn't change**: the belt editor, the requirements, the % and "Ready to Grade" are exactly as before. Hours are a record of time on the mat.
  - **Ranks tab, "Toward Blue Belt — 100%":** under the bar, a **Breakdown**: one line per requirement grading already uses (Classes, Days at this rank, Skills signed off) with ✓ or ○, "x of y", its own % and a thin bar, plus "Counts toward the %" or "Needed too, not in the %". Under a thin line: **Hours trained** "60 h at this rank", then "A record only. Grading doesn't use hours." Last, how the % is worked out ("The % is classes out of classes required.").
  - **Log a class:** the button no longer says "+1". The dialog picks a **Class** ("Adult Fundamentals · Mon 18:00 · 90 min") or **No class (enter the time)**, which shows "Time on the mat (minutes)", 60 by default. The hint reads "Adds 1 class and 1.5 hours. …" and the history records both.
  - **Grading → Settings → Whole school:** **"Open mat counts toward hours"** (owner and coaches with "Change grading settings"): whether open mat time is logged in hours trained.
- **Open mat** (Decision 304; 22 Oct 2026).
  - **Check-in → Today's classes:** the **+ OPEN MAT SESSION** button (no longer "Soon"). It opens **Start an open mat**: Style (BJJ · Adult / BJJ · Kids / No-Gi), Starts (time) and Length (minutes, 60 by default), a grey box saying who is told in the app and how, and a note that every session has a booking and uses a class credit unless that's turned off. **Start open mat** adds "Open Mat · No-Gi" with a blue **Unplanned** tag to today's classes ("Until 19:55") and a dark toast "Open mat started: …. Students were told in the app." Staff without the right see "Only the owner and staff they allow can start an open mat." instead of the button. A scheduled open mat is just a class with the class type "Open mat" (the 20:30 row).
  - **Settings → Check-in rules → Access:** **Open mat uses a class credit**, on by default.
- **Team: per-person rights** (Decisions 303, 304). The person's side panel gets **Front desk and money**: **Can create charges** (on by default for Branch Staff, "for students of their own branches"; off for Instructors) and **Can start open mat sessions** (off for everyone), then "Refunds and credit stay with you, the owner."
- **Student app (G11, `StudentApp.dc.html`)** (Decisions 286/299, 300, 301, 303, 304; the coach actions stay on the web, Decision 305). A phone mock in the same colours, with a bottom tab bar: Home · Classes · Progress · Account.
  - **Home:** while an unplanned open mat is on, a dark banner "Open mat now at Centre · Brazilian Jiu-Jitsu · until 12:00" with **Book** (then "Booked"). A **Promotion fee** card ("You were graded to Purple Belt", belt, R$ 60) with **See and answer**. The last check-in shows belt progress ("Purple Belt: 32 of 32 classes").
  - **Fee sheet:** the grade, who graded and when, the price, "Nothing is charged until you accept it. Your promotion goes through once the fee is accepted and paid." **Accept R$ 60** / **Decline** (Decline asks again, in red, and says the school is told). Accepting shows the bill: the fee, "Credit on your balance − R$ 15", **Pay R$ 45 now** (secure checkout) or "Pay later, in the app or at the desk". Once paid, Progress shows the new belt.
  - **Progress:** the belt, "Toward Purple Belt" with the % and the same breakdown as the Ranks tab, **Hours trained** ("A record of your time on the mat. Grading doesn't use it."), then **Ask for a belt correction**: a sheet listing every rank on the ladder (with belt pictures) and a required "Why?" box; sent requests show "Waiting for review".
  - **Account:** the balance (In credit / To pay / Paid up), charges and receipts, and **Open mat alerts** (push, off by default; the banner and the notification always show).
  - Prop `who="guardian"` shows the same screens for a Guardian ("Ben was graded to …").
- **Dialogs.** A centred white card over a dimmed page, up to 560px wide (640px for bulk promote). Cancel and the action sit in a grey footer. On phones the dialog fills the screen and the footer buttons share the width.
- **Phone.** The columns stack in the order Just Starting, Getting There, Ready to Grade. Permission toggles become one list of switches.

### Drop-downs (product owner, 21 Oct 2026)
- **Every drop-down in the new look is our own, never a browser `<select>`.** The browser draws its list as a grey system box that CSS can't style.
- **Closed:** a soft grey field with the value and a chevron. The value and every option use the same text colour (#383d42), the chosen option included. Placeholder text ("Choose a branch") is only slightly softer (#50575e), never pale grey, so it doesn't look like a different font. It gets a slate outline while open.
- **Width:** exactly as wide as its longest option (plus padding and the chevron), never stretched to fill the row. It doesn't jump when the value changes. The only limit is the width of its container.
- **Open:** the list opens under the field and pushes the content down, so a dialog or a card never clips it. It is a white card, 12px corners, at most 264px tall and scrolling.
- **Options:** 40px rows (48px and 16px text on phones). Hover is light grey. The chosen option is pale green (#def2e2) with a ✓ in #3a7556. Picking closes the list.
- **Font:** Figtree everywhere, and the options always use the same size as their field. That's 14px, or 15px inside a soft form (`.ultm8-soft-field`, where the field is 52px to match the inputs), and 16px on phones.
- **Every drop-down of ranks shows the belt picture** before each rank, in the closed field and in every option (product owner, 23 Oct 2026): Promote to on the Grading Board, New rank in Grade and Move down, Rank in Verify, the Correct belt dialog on Team → Coaches Info and the coach's My belts. In the vision pages it comes from `belt_dd()`; options carry a `chip`.
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
