# Gymdesk dashboard + left nav — design brief for the school-portal shell

**Status:** draft, updated 19 Oct 2026. Reference only. Nothing here is a business rule.
Screenshots in this folder were taken by the product owner from Gymdesk's
manager dashboard as a *feel* reference.

**Agreed boundary (product owner, 19 Oct 2026):** we take Gymdesk's layout pattern, spacing,
clarity and nav behaviour. We do **not** copy its logo, icons, illustrations,
wording or colour scheme. ULTM8's own tokens (`packages/ui/src/tokens.css`,
`DESIGN.md`) and its own icon set stay in place.

## 1. What the reference does

### Left nav (`04-left-nav.png`)
- A narrow **icon rail** about 84px wide, with a dark solid background running the full height.
- A round tenant avatar/logo sits at the top in a slightly darker block.
- Each item is an **icon stacked above a short label**. The label is about 12px, light text on the dark background, and items are spaced about 60px apart.
- The active item gets a lighter block behind the full width of the rail. It has no pill and no left bar.
- It has about 12 top-level items. Detail lives on each section's own page or sub-nav, not in the rail.
- Account/trial status and Help sit at the bottom of the rail.

### Page header (`02`, `03`)
- A **full-width gradient hero band** across the top of the content area, about 200px tall.
- The page icon and title are large (about 34px, light weight), with the tenant name as a subtitle below.
- Content cards **overlap the bottom edge of the band**: the first card starts inside the gradient.
- A pill-shaped utility button sits top right ("What's new?" with a count badge).

### Dashboard body
- A centred content column about 1230px wide on a pale grey page.
- White cards with a small radius, no visible border and a soft shadow. Each card has an icon and title header with letter-spaced semibold titles.
- A two-column grid: a narrow "Schedule Today" card on the left, and wider stacked cards on the right (Birthdays, Notifications).
- Empty states are a **greyed skeleton preview with an overlay message**, not a blank card.
- A collapsible **setup checklist** panel shows a progress bar ("0 out of 8") over a 4×2 grid of task tiles.
- Floating extras: a "Next setup step" toast in the bottom right and a chat bubble.

### Banners (`01`)
- A full-width system banner above the hero, with a muted background, centred text and a single CTA.

## 2. What ULTM8 has today

| Area | Today | Gap vs reference |
|---|---|---|
| Shell | `AppShell` in `packages/ui/src/components.tsx`, **shared with platform-admin** | Any change there also changes platform-admin unless it's opt-in |
| Sidebar | 240px, light `--surface-0`, text-only links, "ULTM8 School Portal" brand text, Log out at the bottom | No icons, no dark rail, no avatar |
| Owner nav | **17 flat items** (`apps/school-portal/src/layout/Shell.tsx`) | Too many for an icon rail without grouping |
| Coach nav | 3–6 items (role-dependent) | Fits a rail as is |
| Top bar | `TopBar.tsx`: U8 tile, disabled search, notifications bell, School switcher, profile, language | Reference has no top bar; utilities float on the hero |
| Main column | `max-width: 1040px`, 48px padding, no hero | No gradient band, no overlap |
| Dashboard | `DashboardPage.tsx`: 2 booking stat cards + "See more" link | Much sparser; no schedule/notifications widgets |

## 3. Proposed build, visual only

1. **Opt-in rail variant of `AppShell`**: a `variant="rail"` prop plus an optional `icon` on
   `NavItem`. Both school-portal and platform-admin adopt it (Q4).
2. **Rail colours from ULTM8's own ramp**: background `--color-accent-900`, active block
   `--color-accent-800`, label `--color-accent-200`, active label white. This uses no
   Gymdesk colours. New tokens go in `tokens.css` with dark-mode values.
3. **Icons:** one open-source set (e.g. Lucide, MIT licence), not Gymdesk's glyphs.
4. **Hero band:** an opt-in `PageHeader` variant (gradient from `--color-accent-700` →
   `--color-accent-500`, the first card overlapping it). Used on Dashboard first.
5. **Dashboard re-layout** using data that **already exists**: the bookings stats (current),
   today's timetable slots, and recent notifications. Cards follow the reference's spacing
   and skeleton empty-state pattern.
6. **Responsive:** below about 768px the rail becomes a bottom bar or hamburger drawer, to be decided at build.

Delivered as separate PRs, each from the latest `master`: (a) rail + icons, (b) hero header
with the utilities moved off `TopBar` (Q3), (c) dashboard layout.

## 4. Product-owner answers (19 Oct 2026)

- **Q1 Nav grouping: APPROVED** as proposed below (9 rail items).
- **Q2 Sub-nav style: TABS** (from the product owner's Gymdesk recordings, 19 Oct 2026).
  Clicking a rail item opens the section's first page; its other pages are text tabs
  under the page title (see §6). No flyout menus.
- **Q3 Top bar: move utilities onto the hero band and the rail**, as in the reference. The
  bell, School switcher and language go on the hero's top right; the profile goes to the rail bottom.
  The "TopBar as a thin bar" option is dropped.
- **Q4 platform-admin: gets the rail too.** Its 6 items (Admin Users, Schools,
  Franchises, Impersonation, Translations, Subscription Plans) fit the rail ungrouped.

## 5. Original questions

- **Q1 Nav grouping.** 17 owner items won't fit as single icons. Proposal: one rail item per
  group, each opening that group's sub-nav:
  - Dashboard
  - Students (Students)
  - Team (Instructors, Staff)
  - Schedule (Classes, Timetable, Curriculum)
  - Grading (Grading Board, Grading Permissions, Disciplines)
  - Billing (Membership Plans, Transactions)
  - Waivers
  - Organisation (School, Branches, Franchises)
  - Notifications

  Do you approve this grouping, or do you want different groups or names?
- **Q2 Sub-nav style.** Should a grouped item open a flyout from the rail, or show tabs
  at the top of the page?
- **Q3 Top bar.** Keep `TopBar` as a thin bar, or move its utilities (bell, School
  switcher, profile, language) onto the hero band / rail bottom like the reference?
- **Q4 platform-admin.** Should it get the rail too, or stay as it is?

### Deliberately NOT carried over: [UNRESOLVED], no spec backing
These appear in the reference but would be **new features**, not visual changes. They are not
built as part of this redesign unless they get their own decision:
- **Upcoming Birthdays.** `dateOfBirth` exists on the profile, but showing members'
  (including minors') birthdays to staff on a dashboard is a data-exposure decision the
  spec doesn't make.
- **Setup/onboarding checklist** (progress + task tiles + "Next setup step" toast).
- **"What's new?" product-updates feed.**
- **Trial / "days left" account status and the email-gating banner.**
- **In-app chat/support bubble.**
- Gymdesk's Marketing, Website, Sales, Competitions and Front Desk sections. ULTM8 has no
  equivalent modules.

## 6. Patterns from the second round of screenshots/recordings (19 Oct 2026)

Files: `05`–`09`, `recordings-keyframes/`.

### Section pages + tabs (`06`, `recordings-keyframes/nav-tabs-and-settings-panel.jpg`)
- Clicking a rail item goes straight to that section. There is no flyout.
- Header: large icon + section title, the School name below it, then a row of plain-text tabs
  with an accent underline on the active one. Plain white header. **The gradient hero band is
  used on the Dashboard only.**
- Page body: one white card centred on the pale grey page.
- ULTM8 mapping: tabs for Team, Schedule, Grading, Billing and Organisation. Dashboard,
  Students, Waivers and Notifications are single pages.

### Settings layout
- A second dark panel (about 250px) beside the rail lists categories, each with a ›.
- The content is a list of rows (title + one-line description + ›). A row opens a detail page
  with a "‹ Back" title.
- Possible fit for School/Branch settings later. Not yet decided.

### Long form: section cards (`07`–`09`, Add Member)
- Full page, not a pop-up. "Back to list" button at the top right.
- Each section is its own white card in two columns: the title on the left with a green tick
  icon (plus an optional hint), and fields on the right in a 2–3 column grid.
- Small uppercase labels above fields; a red `*` for required fields.
- Optional extras are inline links ("ADD SECONDARY PHONE +", "+ ADDITIONAL CONTACT").
- Photo: round placeholder + two pill buttons (camera / upload).
- One primary button at the bottom right.
- ULTM8 fit: Add/Update Student, Add Instructor Manually, School/Branch settings.

### Long form: collapsible cards (recording, Add Membership Option)
- A stack of cards, each with an icon, title, one-line description and chevron.
- **A closed card shows its current value as a chip** ("FREE", "Ongoing", "Unlimited").
- Type choice uses large tile pickers (e.g. Recurring / One-time / Per-session / Trial). The
  selected tile is highlighted, and the fields below change to match.
- Grey sub-panels group related fields inside a card.
- One centred primary button at the bottom.
- ULTM8 fit: Membership Plans, Classes.

### Empty states
- Action-led, not blank. E.g. "How To Add Members" shows 4 option cards; Memberships
  shows "Add a new membership" + example templates.

### Fields
Per the product owner (19 Oct 2026), screens include Gymdesk's fields even where ULTM8 has no
backend yet. Those show as disabled "coming soon", and each is listed in
`GYMDESK-PARITY-BACKLOG.md` with the business-rule questions to answer before building.
This replaces the "Deliberately NOT carried over" list in §5: those items are now backlog
entries D3–D7 there.

## 7. Colour decisions from the vision prototype (20 Oct 2026)

Prototype canvas: https://claude.ai/artifact/C5ztydgzpyzjD8bTfwEP4N (private to the product owner; six sample screens + a colour sheet).

- **Left rail and secondary dark panels share one colour:** slate `#2f3941` (`--color-accent-800`), as in Gymdesk's matching rail + settings panel. Rail hover `#3e4b56`, active item `#5d7081`.
- **Save / primary action buttons and toggles (on): pale green `#def2e2`** (`--fill-success` in `DESIGN.md`) with **dark text `#151719`**, **no outline** (product owner removed the green outline, 20 Oct 2026). Chosen by the product owner from the colour sheet ("number 9").
  - Accessibility note: `#def2e2` on a white page is about 1.2:1, below the 3:1 WCAG minimum for a control's state. Without an outline, an "on" toggle relies on its ON label and knob position. Re-check with an accessibility review before building.
- Navigation buttons (Back to list, All check-ins) stay slate `#5d7081`. Section-heading ticks stay success green `#1f7a4d`.

## 8. Shell chosen: design D, our colours (20 Oct 2026)

Five nav + info-panel designs were compared in the vision prototype (A = the Gymdesk idea refined, B–E different). The product owner chose **D, in ULTM8's own colours**. This replaces the icon rail + dark 420px side panel described in §6 and §7 for the prototype screens.

- **Left nav:** a labelled 200px sidebar on `--nav-rail` (#2f3941): school logo and name, a search box (⌘K), then Dashboard, Students, Team, Schedule, Grading, Billing, Waivers, Organisation, Notifications. Settings, Help and the signed-in user sit at the bottom. The active item is #5d7081 with white text and a 4px pale-green (#def2e2) marker on the left.
- **Right-side inspector:** selecting a row in a list opens a white 340px panel on the right instead of a dark panel on the left. The page keeps its full width, and "Open full page ›" leads to the full profile.
- **Student inspector content** comes from design A (product owner, 20 Oct 2026):
  - photo, name, an Active badge and "Student since"
  - the check-in code shown as a dashed "ticket" with a QR icon
  - Access, Call, Message and Edit as pale-green icon buttons
  - details grouped under small headings: Contact (phone, email), Training (belt, home branch) and Account (membership, balance, family)
  - tags, with "+ tag"
- **Settings:** categories sit in a white card inside the page, with the active category in pale green. A "Preview" inspector on the right shows what the student sees at check-in and updates as the rules change.
- **Applied to every page (20 Oct 2026):** each page has a white header (a "‹ back" link where there is a parent page) and its own right-side inspector:
  - Dashboard: "Needs attention" (notifications). Search moved from the dark header to the sidebar.
  - Students list: the selected student.
  - Student profile: the full summary (the Shell A details plus birthday, gender and programme, with an Edit button and "Manage family account"). The tabs stay in the main area, and the dark card headers are now light.
  - Add student: the new student's summary, a list of the form's sections and the Add button.
  - Check-in: recent check-ins. The check-in screen itself stays dark, because it faces the student.
  - Settings: a preview.
- **Visual only:** this is layout and styling. It changes no business rules, data model or API, and student tags remain a parity-backlog item.
