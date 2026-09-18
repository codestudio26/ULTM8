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

- **53 phases shipped or in flight** (Phase 0 walking skeleton through Phase 53),
  covering every backend module in `ultm8-nestjs-module` §5's confirmed table except
  the two named below, plus `apps/school-portal` UI for essentially all of it, plus
  `apps/platform-admin` through Translations authoring.
- **PR #64 (Phase 47), PR #65 (Phase 48), and PR #66 (this doc's own first version)
  are merged.** PR #67 (Phase 49 — `TranslationsModule` backend) is also merged.
- **Several phases sitting in open, unmerged PRs right now** (this branch — Phase 53
  — is independent of the others and branched fresh off master, not stacked on any
  of them):
  - **PR #68 — Phase 50**, the `apps/platform-admin` Translations authoring UI that
    calls Phase 49's backend. Green, clean, no reviews yet, end-to-end browser-verified.
  - **PR #71 — Decision 106**, the `SubscriptionPlansModule` citation reconciliation.
  - **PR #72 — Phase 51**, the QR check-in redesign + Instructor roll-call scan.
  - **PR #73 — Phase 52**, the `apps/school-portal` QR-display screen (stacked on #72).
  - **Phase 53** (this branch) — Branch field-level settings UI, closing the actual
    remaining gap (branding fields only — see the Phase 53 entry below for why this
    turned out much smaller than previously tracked). PR not yet opened as of this
    doc's own last edit.
- **Two backend modules from the original confirmed module table are still fully
  unbuilt** — not partially done, not scaffolded, nothing — detailed in their own
  sections below. `TranslationsModule` (the third module this doc used to list here)
  shipped in Phase 49–50.
- **`SubscriptionPlansModule`'s "blocked" status is itself now in question** — see
  item 1 below. This doc and two code comments (`platform-admin.module.ts`,
  `payments.controller.ts`) still cite `ultm8-domain-rules` §2 as `[UNRESOLVED]` on
  the billing-direction question, but the skill file's *current* text marks that same
  question `[CONFIRMED]`/resolved (Pass 4), with no decision-log entry ever recorded
  for the reconciliation. Needs an Architect pass to confirm which is right before this
  doc (or those comments) can be trusted on this one item — flagged, not silently
  resolved either way.
- **Everything Guardian/minor-facing that exists is backend-only.** `GuardiansModule`
  (Phase 12) and every Guardian-on-behalf-of flow (Phases 37–42: Waivers, Schools,
  Memberships, Bookings, Waitlist) has real API surface and is exercised by e2e tests —
  but no UI anywhere calls any of it. That's deliberately not a Track A gap: a Guardian
  is a Student/parent-facing concept, and Track B's own roadmap already names this as
  its own blocked item ("Slice 7 — Guardian-facing screens," blocked on a design pass
  that's never happened). Track A doesn't need to build it; Track B does, later.
- **A systemic gap not previously called out in this doc**: no tenant/content
  offboarding exists anywhere in the platform. There is no `DELETE` endpoint for
  School, Branch, Class, Timetable, Instructor, Membership, Rank, Waiver, Franchise, or
  Curriculum — `ultm8-app-publishing` §4/§5.5 flags this as its own unspecified item,
  and the same "`[UNRESOLVED]`, general tenant/content offboarding" comment recurs
  verbatim across ~15 files. This blocks any real account-closure or data-erasure flow
  and is worth its own decision + phase, not just a footnote — see
  `docs/ULTM8-MASTER-ROADMAP.md` for the full cross-track picture.

---

## Phase overview

| Area | Status |
|---|---|
| Foundation (Auth, Tenants, Classes, Timetable, Instructors, Users, Settings) | ✅ DONE — Phase 0–7 |
| Core domain (Payments, Memberships, Transactions, Ranks/Grading, Waivers) | ✅ DONE |
| Guardian/minor-account backend (linking, consent, on-behalf-of flows) | ✅ DONE (backend only — Phase 12, 37–42) |
| Mobile-facing discovery, self-service attendance, notifications | ✅ DONE — Phase 13–15 |
| `apps/school-portal` full admin surface | ✅ DONE — Phase 3, 17–24, 45 |
| `apps/platform-admin` through Translations authoring | ✅ DONE through Phase 49 (backend); Phase 50 (UI) **in PR #68, unmerged** |
| Cross-tenant impersonation-scope security fix | ✅ DONE — Phase 47 (merged PR #64) |
| `CurriculumModule` (Lesson content) | ✅ DONE — Phase 44–45 |
| `TranslationsModule` (i18n CMS) | ✅ DONE — Phase 49 backend (merged), Phase 50 UI (PR #68) |
| `SubscriptionPlansModule` (platform-level plans) | ⛔ NOT BUILT — citation of its `[UNRESOLVED]` blocker needs reconciliation (see above); may just be unscheduled |
| `MobileAppPublishingModule` + `packages/build-pipeline` | ⛔ NOT BUILT — blocked on a real product/legal decision |
| General tenant/content offboarding (no DELETE anywhere) | ⛔ NOT BUILT — unspecified in Spec 55, systemic gap across ~15 files |
| Attendance roll-call scan (`POST /classes/{id}/attendance-scan`) | ⛔ NOT BUILT — Decision 71 confirms purpose only, mechanics undesigned |
| QR code display/generation screen | ⛔ NOT BUILT — no Figma screen ever designed; binding rotating-code constraint set (Decision 66), nothing built against it |
| Guardian consent-management UI (view/withdraw) | ⛔ NOT BUILT — no screen exists anywhere in confirmed designs |
| Branch field-level settings UI | ✅ DONE — Phase 53. Turned out ~80% already shipped since Phase 3; only Decision 76's branding fields (logoUrl/bannerUrl) were missing from the form |
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
  takes a `bookingId` directly — the QR code's own generation/rotation mechanism is
  still `[UNRESOLVED]` per `ultm8-domain-rules` §12, deliberately not built).
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
  edit/delete), end-to-end browser-verified against a live backend. **PR #68, not yet
  merged.**
- **Phase 51–52** — QR check-in redesign + Instructor roll-call scan (Decision 107)
  and the `apps/school-portal` QR-display screen that calls it. Built on their own
  branches, not yet merged to master as of this doc's own last edit on this branch —
  see those PRs' own descriptions for full detail; not restated here to avoid two
  copies of the same account drifting out of sync.
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

## `apps/platform-admin` — DONE through Slice 4, Slice 4 unmerged

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

---

## What's actually left

Full cross-track detail (Track B, infra/deployment, and every open decision) now lives
in `docs/ULTM8-MASTER-ROADMAP.md`. This section keeps only the Track A-specific items.

### 1. `SubscriptionPlansModule` — blocker citation needs reconciliation first

Confirmed scope (`ultm8-nestjs-module` §5): `GET /plans`, `POST /plans/{id}/subscribe`,
Platform-Admin-authoring only. Nothing built — `apps/api/src/payments/payments.controller.ts`'s
own header comment still says "no SubscriptionPlan/white-label billing... deferred to
whenever Phase 9" and that phase never came.

**This doc previously said** `ultm8-domain-rules` §2 flags the billing-direction
question (does the platform-level `SubscriptionPlan` bill the Franchise/School
directly, or does the Franchise resell it onward?) as `[UNRESOLVED]`. **A fresh read of
the skill file's current text says the opposite** — §2 now states this is `[CONFIRMED]`
("ULTM8's own platform revenue... not a plan the Franchise resells onward," resolved
Pass 4), and §18's consolidated list marks it resolved too. No decision-log entry ever
formally reconciled this — the skill was updated in place, and that update never
propagated to this doc or to the `platform-admin.module.ts`/`payments.controller.ts`
comments that still cite the old wording. Per `CLAUDE.md`'s own source-of-truth
hierarchy, the skill file outranks this doc and code comments, so the honest reading is
**this module may just be unscheduled, not blocked** — but that needs an Architect
confirmation and a doc/comment cleanup pass before treating it as settled either way.

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

### 3. General tenant/content offboarding — unspecified in the spec, never scoped

No `DELETE` endpoint exists anywhere in the platform for School, Branch, Class,
Timetable, Instructor, Membership, Rank, Waiver, Franchise, or Curriculum.
`ultm8-app-publishing` §4/§5.5 names this as its own new open item, not covered
anywhere else in Spec 55. The same flagged comment recurs verbatim across roughly 15
service/controller files. This blocks any real account-closure or GDPR/LGPD-style
data-erasure flow — a genuine, systemic gap rather than a per-module oversight. Needs
a product/legal decision on what "offboarding" actually means per entity (hard delete?
soft-archive? retention period?) before any of those ~15 files gets a real `DELETE`.

### 4. Attendance roll-call scan + QR code display — mechanics undesigned

Two related but distinct gaps, both already-confirmed-in-scope but with no design to
build against:
- `POST /classes/{id}/attendance-scan` (Instructor-run roll-call, distinct from the
  self-service `POST /attendance/scan` that already ships) — Decision 71 confirms only
  the *purpose*; what's actually scanned, per-Student vs. batched, and anti-fraud
  deterrence are all still undesigned. Needs an Architect engineering-design pass.
- The QR code itself — no Figma screen was ever designed for the School Portal's own
  "QR Code" nav item, despite a binding constraint now set (Decision 66: must be a
  time-boxed, rotating code, never a static per-Class one). Without this, self-service
  check-in (`POST /attendance/scan`, Phase 13, already built) has no code for a Student
  to actually scan — the harness exists, the thing it consumes doesn't.

### 5. Guardian consent-management UI — no screen anywhere

No interface exists for a Guardian to view current consent status or withdraw either
tier of `ConsentRecord` consent — `ultm8-domain-rules` §14 flags this as blocking any
market with children's-data-protection law. This is Track A surface (Platform
Admin/School Portal don't obviously own it either — needs a decision on which app it
belongs to) as much as it's Track B's already-known "Guardian-facing screens" gap.

### 6. `apps/platform-admin` general tenant-data edit UI — parked, not blocked

Decision 105 (`docs/decisions/POST-SPEC-55-DECISION-LOG.md`) already resolved this:
**not built, pending a named use case.** Nothing to do here until a real support/ops
scenario names what "editing another tenant's records generally" actually needs to
cover — building it speculatively is exactly what Decision 105 says not to do.

### 7. `apps/platform-admin` home dashboard — parked, cosmetic

Still lands directly on Admin Users. Low priority; nothing yet to summarize on a
landing page until more of the admin surface exists.

---

## Immediate next actions (not phases — just what's actually queued)

1. Get **PR #68** reviewed and merged — green, clean, no reviews yet, nothing blocking
   on the engineering side.
2. Resolve the `SubscriptionPlansModule` citation question (item 1) — a quick Architect
   confirmation, then either scaffold it (if genuinely unblocked) or record a proper
   decision-log entry (if genuinely still open).
3. Everything else in "What's actually left" needs a decision, design pass, or both
   before code should be written against it — see `docs/ULTM8-MASTER-ROADMAP.md` for
   the full prioritized path, including where Track A's open items overlap Track B's
   and infra's.
