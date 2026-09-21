# Track A — Backend/School-Portal/Platform-Admin Roadmap

Companion to `docs/TRACK-B-ROADMAP.md` (the Student app track). "Track A" is this
repo's main development line — `apps/api`, `apps/school-portal`, `apps/platform-admin`
— named here only to give it a counterpart to Track B's own label; there was no prior
Track-A-specific doc before this one; the work itself has been running since Phase 0.

Unlike Track B, Track A was never run against a pre-written slice plan — each phase
closed a real gap (a spec module, a Decision, a bug found in review) as it was found,
in commit-message order. This doc reconstructs the current state from the actual repo
(module folders, PRs, the decision log) rather than from a plan written in advance, so
treat "Phase N" numbers here as a historical record, not a forecast — same spirit as
Track B's own "each slice cites the real controller/service code it's grounded in."

Same standing rules as everywhere else in this repo (`CLAUDE.md`): only `[CONFIRMED]`
items are safe to build against; an `[UNRESOLVED]` item is a stop-and-escalate, not a
guess; load `skills/ultm8-domain-rules/SKILL.md` before any domain-rule work.

---

## Where things stand right now

- **56 phases shipped** (Phase 0 walking skeleton through Phase 56; Phase 55 is
  PR #76, Phase 56 — tenant/content offboarding endpoints — is on this same
  branch, not yet PR'd), covering every backend module in `ultm8-nestjs-module`
  §5's confirmed table except the one named below, plus `apps/school-portal` UI
  for essentially all of it, plus `apps/platform-admin` through Translations
  authoring and now SubscriptionPlansModule authoring.
- **PR #64 (Phase 47), PR #65 (Phase 48), PR #66 (this doc's own first version), PR
  #67 (Phase 49 — `TranslationsModule` backend), PR #68 (Phase 50 — Translations
  authoring UI), PR #69 (the master roadmap doc), PR #71 (Decision 106), PR #72
  (Phase 51), PR #73 (Phase 52 — QR-display screen), PR #74 (Phase 53 — Branch
  branding-field UI), PR #75 (Phase 54), PR #61 (Decisions 108/109 + a design-system
  refresh — see below), and PR #31 (shared `@ultm8/ui` mobile-nav/table-overflow
  fix — see below) are all merged. Phase 55 (`SubscriptionPlansModule`'s
  `apps/platform-admin` authoring UI) is PR #76.**
- **One open PR** — PR #76 (Phase 55), pushed and green, awaiting review; every
  other phase and standalone fix described in this doc has landed on `master`.
  Decision 110 (general tenant/content offboarding) and its own Phase 56
  implementation (this doc's own update for both) are on branch
  `decision/110-tenant-content-offboarding`, not yet opened as a PR — separate
  from PR #76.
- **Two items shipped outside the Phase-N sequence**, not tied to a specific phase
  number since neither PR framed itself as one (same treatment this doc already
  gives Decision-only PRs like #71):
  - **PR #61** — a design-system refresh (accent color ramp rebased to `#5D7081`;
    Figtree adopted as the self-hosted product typeface, `--font-sans`) bundled with
    a real backend fix: `TransactionsService` now joins `Transaction.student` and
    returns the paying Student's real name (`studentFirstName`/`studentSurname` on
    `TransactionResponseDto`) instead of a bare `studentId`, so `TransactionsPage.tsx`
    shows a real name instead of a truncated id. Recorded as **Decision 108**
    (Instructor rank: V1 is a manual belt dropdown on the Instructor's own profile
    settings page, V2 linking to the real grading system deferred) and **Decision
    109** (Transaction Student-name resolution — a Developer-level inference, flagged
    in the decision log for Architect confirmation, not yet given one). Also added
    `docs/design-mockup-notes.md`, a running per-page Figma-audit log for
    cross-session continuity.
  - **PR #31** — fixed two responsive bugs in shared `packages/ui`, affecting every
    page in `apps/school-portal` at once: the mobile nav (`<720px`) media query set
    `flex-direction: row` on `.ultm8-shell__sidebar` itself, which only reflows the
    sidebar's three *direct* children and doesn't cascade into `<nav>`'s own
    block-stacked children — fixed by keeping the sidebar a column and making
    `<nav>` itself the horizontal, `overflow-x: auto` scrolling strip. `<Table>`
    gained an `overflow-x: auto` wrapper (`.ultm8-table-scroll`) so a table wider
    than the viewport scrolls within itself instead of forcing the whole page to
    scroll sideways.
- **One backend module from the original confirmed module table is still fully
  unbuilt** — not partially done, not scaffolded, nothing — detailed in its own
  section below (`MobileAppPublishingModule`). `TranslationsModule` shipped in Phase
  49–50; `SubscriptionPlansModule` (backend) shipped in Phase 54 — see below.
- **`SubscriptionPlansModule`'s "blocked" status was a stale citation, now fixed
  (Decision 106) — and the module itself now shipped end to end (Phase 54 backend,
  merged via PR #75; Phase 55 `apps/platform-admin` authoring UI, PR #76).** This
  doc used to say the billing-direction question was `[UNRESOLVED]` per
  `ultm8-domain-rules` §2; that citation was out of date — the question was
  genuinely resolved in Spec 55's own Pass 4 review, before Phase 0 even started
  (three independent primary sources verified this: the skill file's own current
  text, the `git show` diff of the commit that resolved it, and the spec's own
  `review-history-tracker.html`). With the citation cleared, Phase 54 built the
  confirmed core scope directly: Plan CRUD (Platform Admin authoring),
  Franchise/School subscribe/cancel against ULTM8's own platform Stripe account, the
  `PlatformCharge` ledger, and the read-only degraded-portal gate (Spec 55 §10.2) on
  new Class/Booking/payment creation. Phase 55 then built the `apps/platform-admin`
  authoring screen itself (list/add/edit, no delete — see below) — same
  backend-then-UI split every other module in this codebase already followed
  (Translations, Curriculum). Only one piece remains deliberately deferred: the
  `whiteLabelApp` metered entitlement (its own rate is still unresolved, Spec 55
  §12.2, and it's gated on `MobileAppPublishingModule` anyway).
- **Everything Guardian/minor-facing that exists is backend-only.** `GuardiansModule`
  (Phase 12) and every Guardian-on-behalf-of flow (Phases 37–42: Waivers, Schools,
  Memberships, Bookings, Waitlist) has real API surface and is exercised by e2e tests —
  but no UI anywhere calls any of it. That's deliberately not a Track A gap: a Guardian
  is a Student/parent-facing concept, and Track B's own roadmap already names this as
  its own blocked item ("Slice 7 — Guardian-facing screens," blocked on a design pass
  that's never happened). Track A doesn't need to build it; Track B does, later.
- **General tenant/content offboarding — Decision 110's policy is now fully
  built, Phase 56.** `TenantLifecycleModule` (inside `PlatformAdminModule`) adds
  `POST /platform-admin/schools/:id/close` and `.../reactivate`, plus the
  Franchise twins — FULL_ADMIN-only, re-typed-name confirmation, audited. Closing
  sets `archivedAt`/`purgeAt` (90 days out); `TenantAuthorizationService.
  assertSchoolNotArchived`/`assertFranchiseNotArchived` then refuses every
  create/update across all 10 of the entity services Decision 110 names (School,
  Franchise, Branch, Class, TimetableSlot, Instructor, MembershipPlan,
  Discipline/Rank/Skill, Waiver, Lesson) — reads stay unaffected, matching "read-
  only," not hidden. A new scheduled job (`tenant-lifecycle-purge`, daily sweep)
  hard-deletes a School/Franchise past its `purgeAt` — Postgres's own cascade
  handles every owned child row in one statement — except in two flagged cases
  it anonymizes the row in place instead: a School that still owns `Waiver` rows
  (Decision 110's own explicit exception, pending real legal input on retention)
  and a School/Franchise with billing history protected by the existing
  `PlatformCharge`/`FranchiseFeeCharge` `RESTRICT` FKs. See "What's actually
  left" item 3 below for the full account, including what this job's own
  narrower-than-literal scope reading deliberately does NOT touch
  (Membership/Transaction/PaymentAccount/Booking/RoleGrant — none of them named
  in Decision 110, several with the same financial-record character the existing
  `RESTRICT` protection already treats carefully).

---

## Phase overview

| Area | Status |
|---|---|
| Foundation (Auth, Tenants, Classes, Timetable, Instructors, Users, Settings) | ✅ DONE — Phase 0–7 |
| Core domain (Payments, Memberships, Transactions, Ranks/Grading, Waivers) | ✅ DONE |
| Guardian/minor-account backend (linking, consent, on-behalf-of flows) | ✅ DONE (backend only — Phase 12, 37–42) |
| Mobile-facing discovery, self-service attendance, notifications | ✅ DONE — Phase 13–15 |
| `apps/school-portal` full admin surface | ✅ DONE — Phase 3, 17–24, 45 |
| `apps/platform-admin` through Translations authoring | ✅ DONE — Phase 49 backend + Phase 50 UI, both merged |
| Cross-tenant impersonation-scope security fix | ✅ DONE — Phase 47 (merged PR #64) |
| `CurriculumModule` (Lesson content) | ✅ DONE — Phase 44–45 |
| `TranslationsModule` (i18n CMS) | ✅ DONE — Phase 49 backend + Phase 50 UI, both merged |
| QR check-in redesign + Attendance roll-call scan (Decisions 66, 71, 107) | ✅ DONE (backend) — Phase 51, merged via PR #72 |
| `SubscriptionPlansModule` (platform-level plans) | ✅ DONE — Phase 54 (backend: Plan CRUD, subscribe/cancel, `PlatformCharge`, degraded-portal gate, merged via PR #75) + Phase 55 (`apps/platform-admin` authoring UI, PR #76). Only the `whiteLabelApp` entitlement remains deliberately deferred. Blocker citation reconciled — Decision 106, merged via PR #71 |
| `MobileAppPublishingModule` + `packages/build-pipeline` | ⛔ NOT BUILT — blocked on a real product/legal decision |
| General tenant/content offboarding (close-account, archived-gate, 90-day purge) | ✅ DONE — Phase 56 (Decision 110). Close/reactivate endpoints, the archived-gate across all 10 named entity services, the scheduled purge job. `Waiver`'s own retention period still pending legal input (Decision 110's own flagged exception) |
| QR code display screen (`apps/school-portal`, Staff-facing) | ✅ DONE — Phase 52, merged via PR #73 |
| Guardian consent-management UI (view/withdraw) | ⛔ NOT BUILT — no screen exists anywhere in confirmed designs |
| Branch field-level settings UI | ✅ DONE — Phase 53. Turned out ~80% already shipped since Phase 3; only Decision 76's branding fields (logoUrl/bannerUrl) were missing from the form |
| Transaction Student-name resolution (Decision 109) | ✅ DONE — merged via PR #61. Developer-level inference, flagged for Architect confirmation |
| Design system refresh — accent color rebase + Figtree typeface | ✅ DONE — merged via PR #61 |
| Shared `packages/ui` mobile-nav / table-overflow fix | ✅ DONE — merged via PR #31 |
| `apps/platform-admin` general tenant-data edit UI | 🅿️ Parked — Decision 105, pending a named use case |
| `apps/platform-admin` home dashboard | 🅿️ Parked — cosmetic, nothing to summarize yet |

---

## Foundation (Phase 0–7) — DONE

- **Phase 0/1** — monorepo walking skeleton: Turborepo + npm workspaces, Prisma schema,
  `AuthModule`, the cross-tenant isolation CI gate.
- **Phase 2** — `TenantsModule`: School/Branch CRUD, RoleGrant assign/revoke.
- **Phase 3** — `apps/school-portal` frontend: auth, self-service onboarding, Branches,
  Staff invite/revoke.
- **Phase 4** — `ClassesModule`.
- **Phase 5** — `TimetableModule` + the Redis/BullMQ job infrastructure every later
  background job (waivers, waitlist, attendance) builds on.
- **Phase 6** — `InstructorsModule` + `UsersModule` self-service profile.
- **Phase 7** — `SettingsModule` (languages, currencies, legal-doc metadata).

Between Phase 7 and Phase 12, `PaymentsModule`, `MembershipsModule`,
`TransactionsModule`, `RanksModule`, and `WaiversModule` were all built and are live in
`apps/api/src` today — the exact phase numbers for that stretch aren't reliably
recoverable from commit messages alone (unlike every phase cited elsewhere in this
doc), so they're named here without a number rather than guessed at.

## Core domain, discovery, and engagement — DONE

- **Phase 12** — `GuardiansModule`: minor linking + two-tier `ConsentRecord`.
- **Phase 13** — `AttendanceModule`: self-service QR check-in (`POST /attendance/scan`,
  originally took a `bookingId` directly — the QR code's own generation/rotation
  mechanism was `[UNRESOLVED]` per `ultm8-domain-rules` §12, deliberately not built
  at the time). **Superseded by Phase 51** (Decision 107), which replaced the static
  `bookingId` with a genuine rotating-token mechanism.
- **Phase 14** — `AcademiesModule`: mobile-facing, read-optimized discovery
  (`GET /academies`, `/academies/:id`, `/academies/:id/timetable`) — the exact surface
  Track B's Student app builds its own discovery screens against.
- **Phase 15** — `NotificationsModule`: email delivery + `DeviceToken` registration
  (push *dispatch* itself deferred, Decision 95).
- **Phase 16a/16b-i/16b-ii** — `FranchisesModule`, School↔Franchise self-service
  linking, `FranchiseFeeCharge` module (self-service fee rate + Stripe billing).
- **Phase 17–24** — `apps/school-portal` scheduling, Membership Plans/Transactions,
  Waivers CRUD, Skills CRUD, full Rank management, Booking/Waitlist admin views,
  Franchise + fee billing UI, Notifications inbox. `apps/school-portal` has had UI
  parity with the backend since roughly this point.
- **Phase 34** — `WaiversModule` drawn-signature capture (R2), the engineering
  follow-up Decision 74/78 flagged as still open when those decisions were recorded.
- **Phase 37–42** — Guardian-on-behalf-of flows: Waivers signing, School enrollment,
  Membership purchase, Booking creation/cancellation, Waitlist join/withdraw/claim.
  Backend + e2e-tested only — see "Where things stand right now" above.
- **Phase 44–45** — `CurriculumModule` (Lesson/LessonSkill, Decision 104) + its
  `apps/school-portal` Lesson CRUD UI.
- **Phase 49** — `TranslationsModule` backend: `Translation` model (no RLS, global
  content, same precedent as `LegalDocument`/`AdminUser`), public `GET /translations`,
  FULL_ADMIN-only `platform-admin/translations` CRUD. Merged via PR #67.
- **Phase 50** — `apps/platform-admin` Translations authoring UI (list/filter/add/
  edit/delete), end-to-end browser-verified against a live backend. Merged via
  PR #68.
- **Phase 51** — `AttendanceModule` QR check-in redesign (Decision 107): replaced
  Phase 13's static-`bookingId` self-service scan with two independently-keyed,
  short-lived rotating JWTs (`GET /classes/:id/qr-token` Staff-minted Class token,
  `GET /attendance/my-qr-token` self-minted Student token), closing the
  "time-boxed, rotating, never static" constraint Decision 66 had set with nothing
  built against it. Also shipped the Instructor roll-call scan
  (`POST /classes/:id/attendance-scan`) Decision 71 had confirmed the purpose of but
  never designed — per-Student, two modes (`INSTRUCTOR_SCAN` camera-based,
  `INSTRUCTOR_MANUAL` camera-free fallback) discriminated by whether the request
  carries a `studentToken`. `Booking` gained `checkInMethod`/`checkedInById` columns.
  Backend only — full e2e suite green (306 tests), `turbo build`/`turbo test` clean,
  `packages/api-client` regenerated, all four flows (mint, self-service scan,
  Instructor scan, Instructor manual) manually verified over live HTTP. Merged via
  PR #72.
- **Phase 52** — `apps/school-portal` QR-display screen: `ClassQrCodePage`, reached
  via a new "Show QR" action on `ClassesPage` (the same per-Class-action pattern
  `ClassDetailPage`'s own "View bookings" link already established, not a new
  top-level nav item), rendering Phase 51's rotating Class token as a QR code
  (`qrcode.react`, new dependency) for Students to scan from their own device. The
  first interval-polling screen in this app — `useClassQrToken`'s own
  `refetchInterval` is computed from the fetched token's own `expiresAt` rather than
  a hardcoded interval, so it stays correct even if `QR_ATTENDANCE_TOKEN_TTL_SECONDS`
  (an explicit Developer-level placeholder on the backend) ever changes. Built
  stacked on Phase 51's branch; end-to-end Playwright-verified against a live
  backend, including proving the auto-refresh re-polls for a fresh token before the
  old one expires. Merged via PR #73.
- **Phase 53** — Branch field-level settings UI. Turned out to be almost entirely
  already shipped: `BranchesPage`/`BranchFormModal` (name/address/contactPhone/
  timezone/currencyOverride) have existed since Phase 3, and the backend
  (`CreateBranchDto`/`UpdateBranchDto`/`BranchResponseDto`/Prisma model) has carried
  `logoUrl`/`bannerUrl` the whole time too — only the form itself had never been
  updated to expose Decision 76's own explicitly-named "branding" fields. This
  doc's own prior claim that "no UI screen was ever designed" for Branch was
  **incorrect** — verified directly against the running code and corrected here,
  not carried forward from an unverified prior draft. Fixed by adding the two
  missing fields to `BranchFormModal.tsx`, mirroring the established plain-text-URL
  treatment `FranchiseFormModal`/`ClassFormModal`/`TimetableSlotFormModal` already
  give `logoUrl`/`bannerUrl` elsewhere in this app. Browser-verified end to end
  (Playwright): create with both fields → edit round-trip confirms persistence →
  clearing both fields actually clears them (not a silent no-op). **Correction to
  this doc's own prior claim**: re-checked directly against the repo's actual
  `skills/ultm8-domain-rules/SKILL.md` (not a cached/synced copy) before writing
  this entry — its Branch field-list line is already `[CONFIRMED]`, citing Decision
  76 directly; no skill/decision-log drift exists there (a first draft of this
  phase's own writeup wrongly claimed one, based on reading a stale snapshot
  instead of the repo's real file — caught and fixed before committing). The
  skill's very next line, `[UNRESOLVED]` on "no Branch-specific field screen was
  ever designed... needs a design pass," is genuinely now outdated by this phase
  and worth an Architect update to `[CONFIRMED]`/resolved — flagged, not patched
  directly, per the skill's own "only the Architect may edit this file" rule.
  Merged via PR #74.

## `apps/platform-admin` — DONE through Slice 4

- **Phase 25 (Slice 1)** — Cognito-backed auth spine.
- **Phase 26 (Slice 2)** — `AuditLogEntry` + first cross-tenant read.
- **Phase 27–30 (Slices 3–6, backend)** + **Phase 32–33 (Slices 1–2, frontend)** —
  Franchise/School/PaymentAccount lookup, admin-user invite/revoke, both backend and
  `apps/platform-admin` UI.
- **Phase 35–36 (Slice 7 backend / Slice 3 UI)** — Stripe Connect credential rotation,
  end to end.
- **Phase 43 (Slice 8)** — Support-tier impersonation, read-only (Decision 102).
- **Phase 46–47** — impersonation-scope hardening (Spec 55 Decision 39): Phase 46
  narrowed the JWT claim; Phase 47 closed the RLS-level gap Phase 46 left open. Merged
  via PR #64.
- **Phase 48 (Slice 4)** — the `apps/platform-admin` screen that actually calls the
  impersonation endpoint. Merged via PR #65.
- **Phase 49–50** — `TranslationsModule` backend + `apps/platform-admin` authoring UI.
  See "Core domain..." above and "What's actually left" below.
- **Phase 54** — `SubscriptionPlansModule` (core: Plan CRUD, subscribe/cancel,
  `PlatformCharge`, degraded-portal gate).
- **Phase 55** — `SubscriptionPlansModule`'s `apps/platform-admin` authoring UI
  (PR #76): `SubscriptionPlansPage` — list/add/edit, no delete action (the backend
  has no `DELETE` route — an already-subscribed Franchise/School has no confirmed
  safe orphaning behavior, see the Prisma model's own comment). Required one small
  backend addition alongside the UI: `GET /platform-admin/subscription-plans`, a
  new list route on `PlatformAdminSubscriptionPlansController` — unlike
  `TranslationsModule`, whose public `GET /translations` the Translations authoring
  UI reuses directly, `GET /plans` is tenant-JWT-gated (Platform Admin has no tenant
  token to call it with), so there was no existing route this screen could browse
  through. Authentication-only (no `assertFullAdmin`), same "nothing here is
  sensitive" reasoning `SubscriptionPlanResponseDto`'s own comment already gives.
  Full e2e suite green (328 tests, 2 new), `turbo build` clean, `packages/api-client`
  regenerated, browser-verified end to end (Playwright against a live backend:
  list → create → edit, zero console errors).
- **Phase 56** — General tenant/content offboarding (Decision 110), backend only.
  `TenantLifecycleModule`: close/reactivate for School and Franchise
  (FULL_ADMIN-only, re-typed-name confirmation, audited), a new `archivedAt`/
  `purgeAt`/`purgedAt` trio on both models, `TenantAuthorizationService.
  assertSchoolNotArchived`/`assertFranchiseNotArchived` wired into all 10 named
  entity services' create/update paths (22 call sites), and a daily
  `tenant-lifecycle-purge` scheduled job that hard-deletes a School/Franchise
  90 days past close (Postgres cascade handles the child-row graph in one
  statement — the same empirically-verified RLS-bypass-on-cascade behavior this
  phase's own investigation confirmed) or anonymizes it in place for the two
  flagged exceptions (retained `Waiver` rows; `PlatformCharge`/
  `FranchiseFeeCharge` billing-history `RESTRICT`). Full e2e suite green (347
  tests, 26 new across two new spec files), `turbo build` clean,
  `packages/api-client` regenerated. No `apps/platform-admin` UI yet for
  close/reactivate — same backend-then-UI split as every other module in this
  codebase; a natural Phase 57.

Also shipped, each on its own separate PR (not folded into this doc's own narrative
sections above in detail — see each PR's own description), all now merged:
**Phase 51** (QR check-in redesign + Instructor roll-call scan, Decision 107, merged
via PR #72), **Phase 52** (`apps/school-portal` QR-display screen, merged via
PR #73), and **Phase 53** (Branch field-level settings UI — the branding-fields gap,
merged via PR #74).

---

## What's actually left

Full cross-track detail (Track B, infra/deployment, and every open decision) now lives
in `docs/ULTM8-MASTER-ROADMAP.md`. This section keeps only the Track A-specific items.

### 1. `SubscriptionPlansModule` — fully shipped except one blocked entitlement

Confirmed scope (`ultm8-nestjs-module` §5): `GET /plans`, `POST /plans/{id}/subscribe`,
Platform-Admin-authoring only. This doc previously said the module was blocked on an
`[UNRESOLVED]` billing-direction citation in `ultm8-domain-rules` §2 — that citation
was itself stale (Decision 106, `docs/decisions/POST-SPEC-55-DECISION-LOG.md`): the
question was genuinely resolved in Spec 55's own Pass 4 review, before Phase 0 even
started, verified against three independent primary sources. Not blocked — simply
unscheduled, the same status `TranslationsModule` had before Phase 49. Phase 54 then
built the confirmed core: Plan CRUD, Franchise/School subscribe/cancel against
ULTM8's own platform Stripe account (`StripeClientService.platformClient()`, never a
tenant's own Connected Account — the money flows the opposite direction from every
other Stripe integration in this codebase), the `PlatformCharge` ledger, and the
read-only degraded-portal gate Spec 55 §10.2 confirms (new Class/Booking/payment
creation blocked once a School's platform Subscription is genuinely Canceled — never
on `PAST_DUE` or on a School that simply never subscribed, the ordinary state of
every School in this codebase before this phase). Phase 55 (PR #76) then built
`apps/platform-admin`'s own authoring UI for Plan CRUD — backend-then-UI split, same
convention `TranslationsModule` (Phase 49/50) and `CurriculumModule` (Phase 44/45)
already established.

One piece deliberately deferred, not silently dropped: the `whiteLabelApp` metered
entitlement — its own rate is itself unresolved ($0.99–$1.99/active-student/month,
Spec 55 §12.2: "exact rate still to be set"), and the entitlement is meaningless
before `MobileAppPublishingModule` exists (item 2 below, itself blocked on the Apple
compliance decision). Nothing left to build here until that decision lands.

### 2. `MobileAppPublishingModule` + `packages/build-pipeline` — blocked on a product/legal decision

Confirmed scope: `TenantAppConfig` CRUD, the per-School white-label build/submit
pipeline, credential status-read (`ultm8-app-publishing` §5). `packages/build-pipeline`
is still the placeholder package it was scaffolded as in Phase 1.

**Why it's stuck:** `ultm8-app-publishing` §2 states the whole branded-app tier is
"**contingent on clearing the Apple 4.2.6/4.3 template-farm compliance risk** (§12.2).
If that risk can't be resolved before launch, the branded-app tier drops from v1
entirely." This is also exactly the gate Track B's own roadmap cites for why its own
Phase 6 (per-School white-label branding) is blocked — the same real-world constraint
blocks both tracks' halves of this feature. Not something to start building around;
needs the Apple compliance question actually resolved first. The white-label add-on's
own metered billing rate ($0.99–$1.99/active-student/month range) is also never
finalized — a second, independent open item under this same module.

### 3. General tenant/content offboarding — Decision 110 built end to end, Phase 56 (backend only)

Was: no `DELETE` endpoint existed anywhere in the platform for School, Branch, Class,
Timetable, Instructor, Membership, Rank, Waiver, Franchise, or Curriculum —
`ultm8-app-publishing` §4/§5.5's own flagged open item, the same comment recurring
verbatim across 16 files.

**Decision 110** (`docs/decisions/POST-SPEC-55-DECISION-LOG.md`) resolved what
"offboarding" means: soft-archive (read-only, not hidden) immediately, hard-delete
after a 90-day retention window — matching the white-label credential's own 90-day
grace-then-purge precedent (Decision 27) rather than an invented number. Triggered
only by a new, explicit, Platform-Admin-mediated close-account action — **not** by
platform-subscription cancellation alone, which stays billing-only (the existing
`SubscriptionGateService` degraded-portal gate) and leaves data untouched, same
"billing lapsed ≠ delete my account" separation every major SaaS product makes.
Scoped to School/Franchise-level offboarding only — GDPR/LGPD per-user erasure
requests are deliberately out of scope, tracked as their own separate open item
(`docs/ULTM8-MASTER-ROADMAP.md` §4).

**Phase 56 built this**: `TenantLifecycleModule` (`apps/api/src/platform-admin/`) —
`POST /platform-admin/{schools,franchises}/:id/close` (re-typed-name confirmation,
FULL_ADMIN-only, audited — `CLOSE_SCHOOL_ACCOUNT`/`CLOSE_FRANCHISE_ACCOUNT`) and
`.../reactivate`. Closing sets `archivedAt`/`purgeAt` (now + 90 days) on School/
Franchise; `TenantAuthorizationService.assertSchoolNotArchived`/
`assertFranchiseNotArchived` (same file, same shared-check convention as
`assertSchoolOwner`) is called immediately after the existing ownership/staff check
in every one of the 10 named services' create/update methods (22 call sites total —
Ranks alone has 6, one per Discipline/Rank/Skill create+update). A reactivated
School/Franchise clears both fields and the gate lifts immediately — proven directly
over HTTP in `test/tenant-lifecycle.e2e-spec.ts` (PATCH succeeds again after
reactivate). The daily `tenant-lifecycle-purge` job (`apps/api/src/jobs/`) finds
every row past `purgeAt` with no reactivation and either hard-deletes it (Postgres's
own `ON DELETE CASCADE` graph — empirically verified earlier this same phase to
bypass per-child RLS/grants even under `FORCE ROW LEVEL SECURITY`) or, in two
flagged cases, anonymizes the row's PII-bearing fields in place instead of deleting
it: a School that still owns `Waiver` rows (Decision 110's own explicit exception —
Waiver retention needs real legal input before it runs on the uniform 90-day clock),
or a School/Franchise with billing history protected by the pre-existing
`PlatformCharge`/`FranchiseFeeCharge` `RESTRICT` FKs (caught as a Postgres P2003, not
pre-checked). Deliberately does **not** touch Membership/Transaction/PaymentAccount/
Booking/WaitlistEntry/RoleGrant — none are named in Decision 110's own scope, and
several are financial/attendance records of the same character the existing
`RESTRICT` protection already treats carefully; flagged as a narrower-than-literal
reading, not silently decided.

**Still not built**: `apps/platform-admin`'s own UI for close/reactivate (backend
only this phase, same split every other module here followed — a natural Phase 57),
and a real decision on `Waiver`'s own retention period.

### 4. Guardian consent-management UI — no screen anywhere

No interface exists for a Guardian to view current consent status or withdraw either
tier of `ConsentRecord` consent — `ultm8-domain-rules` §14 flags this as blocking any
market with children's-data-protection law. This is Track A surface (Platform
Admin/School Portal don't obviously own it either — needs a decision on which app it
belongs to) as much as it's Track B's already-known "Guardian-facing screens" gap.

### 5. `apps/platform-admin` general tenant-data edit UI — parked, not blocked

Decision 105 (`docs/decisions/POST-SPEC-55-DECISION-LOG.md`) already resolved this:
**not built, pending a named use case.** Nothing to do here until a real support/ops
scenario names what "editing another tenant's records generally" actually needs to
cover — building it speculatively is exactly what Decision 105 says not to do.

### 6. `apps/platform-admin` home dashboard — parked, cosmetic

Still lands directly on Admin Users. Low priority; nothing yet to summarize on a
landing page until more of the admin surface exists.

---

**Resolved since this list was last written** (see "Where things stand right now"
for PR numbers — all now merged): Attendance roll-call scan mechanics + QR code
display (Phase 51/52, PR #72/#73), Branch field-level settings UI (Phase 53, PR #74
— turned out to be a 2-field gap, not a whole undesigned screen), Transaction
Student-name resolution (Decision 109, PR #61), and two shared `packages/ui`
responsive bugs — mobile-nav collapse and table horizontal-overflow (PR #31).

---

## Immediate next actions (not phases — just what's actually queued)

1. ~~`SubscriptionPlansModule`'s own `apps/platform-admin` authoring UI~~ — done
   (Phase 55, PR #76).
2. ~~General tenant/content offboarding backend (Decision 110)~~ — done (Phase 56,
   this branch). `apps/platform-admin`'s own close/reactivate UI is the natural
   Phase 57.
3. Decision 109 (Transaction Student-name resolution, PR #61) is still a
   Developer-level inference, flagged in the decision log but not yet given an
   Architect confirmation — worth a short pass, though nothing is blocked on it.
4. Everything else in "What's actually left" needs a decision, design pass, or both
   before code should be written against it — see `docs/ULTM8-MASTER-ROADMAP.md` for
   the full prioritized path, including where Track A's open items overlap Track B's
   and infra's.
