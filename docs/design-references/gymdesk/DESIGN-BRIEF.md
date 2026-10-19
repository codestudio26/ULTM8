# Gymdesk dashboard + left nav — design brief for the school-portal shell

**Status:** draft, 19 Oct 2026. Reference only. Nothing here is a business rule.
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
- **Q2 Sub-nav style: PENDING.** The product owner will send a Gymdesk example of how a
  section's sub-pages appear once a rail item is clicked.
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
