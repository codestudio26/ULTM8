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

- **54 phases shipped or in flight** (Phase 0 walking skeleton through Phase 54),
  covering every backend module in `ultm8-nestjs-module` §5's confirmed table except
  the one named below, plus `apps/school-portal` UI for essentially all of it, plus
  `apps/platform-admin` through Translations authoring.
- **PR #64 (Phase 47), PR #65 (Phase 48), and PR #66 (this doc's own first version)
  are merged.** PR #67 (Phase 49 — `TranslationsModule` backend) is also merged.
- **Several phases sitting in open, unmerged PRs right now** (each independent of
  this one — this Phase 54 work branched fresh off `master`):
  - **PR #68 — Phase 50**, the `apps/platform-admin` Translations authoring UI that
    calls Phase 49's backend. Green, clean, no reviews yet, end-to-end browser-verified.
  - **PR #71 — Decision 106**, the `SubscriptionPlansModule` citation reconciliation
    this doc's own previous version needed (see below — already folded into this
    version directly, since Phase 54 needed the accurate status anyway).
  - **PR #72 — Phase 51**, QR check-in redesign + Instructor roll-call scan.
  - **PR #73 — Phase 52**, the `apps/school-portal` QR-display screen (stacked on #72).
  - **PR #74 — Phase 53**, Branch field-level settings UI (the branding-fields gap).
- **One backend module from the original confirmed module table is still fully
  unbuilt** — not partially done, not scaffolded, nothing — detailed in its own
  section below (`MobileAppPublishingModule`). `TranslationsModule` shipped in Phase
  49–50; `SubscriptionPlansModule` (backend) shipped in Phase 54 — see below.
- **`SubscriptionPlansModule`'s "blocked" status was a stale citation, now fixed
  (Decision 106) — and the module itself now shipped (Phase 54).** This doc used to
  say the billing-direction question was `[UNRESOLVED]` per `ultm8-domain-rules` §2;
  that citation was out of date — the question was genuinely resolved in Spec 55's
  own Pass 4 review, before Phase 0 even started (three independent primary sources
  verified this: the skill file's own current text, the `git show` diff of the
  commit that resolved it, and the spec's own `review-history-tracker.html`). With
  the citation cleared, Phase 54 built the confirmed core scope directly: Plan CRUD
  (Platform Admin authoring), Franchise/School subscribe/cancel against ULTM8's own
  platform Stripe account, the `PlatformCharge` ledger, and the read-only
  degraded-portal gate (Spec 55 §10.2) on new Class/Booking/payment creation.
  Deliberately deferred: the `whiteLabelApp` metered entitlement (its own rate is
  still unresolved, Spec 55 §12.2, and it's gated on `MobileAppPublishingModule`
  anyway) and the `apps/platform-admin` authoring UI (backend-then-UI split, same as
  every other module in this codebase).
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
| QR check-in redesign + Instructor roll-call scan | ✅ DONE (backend) — Phase 51, **PR #72, unmerged** |
| `apps/school-portal` QR-display screen | ✅ DONE — Phase 52, **PR #73, unmerged, stacked on #72** |
| Branch field-level settings UI | ✅ DONE — Phase 53, **PR #74, unmerged** (turned out ~80% already shipped; only Decision 76's branding fields were missing) |
| `SubscriptionPlansModule` (platform-level plans, core) | ✅ DONE (backend) — Phase 54: Plan CRUD, subscribe/cancel, `PlatformCharge`, degraded-portal gate. `whiteLabelApp` entitlement + `apps/platform-admin` UI deliberately deferred |
| `MobileAppPublishingModule` + `packages/build-pipeline` | ⛔ NOT BUILT — blocked on a real product/legal decision |
| General tenant/content offboarding (no DELETE anywhere) | ⛔ NOT BUILT — unspecified in Spec 55, systemic gap across ~15 files |
| Attendance roll-call scan (`POST /classes/{id}/attendance-scan`) | ✅ DONE — shipped as part of Phase 51 (Decision 71's mechanics resolved directly with the user, see Decision 107) |
| QR code display/generation screen | ✅ DONE — Phase 51 (backend token mint) + Phase 52 (School Portal display screen) |
| Guardian consent-management UI (view/withdraw) | ⛔ NOT BUILT — no screen exists anywhere in confirmed designs |
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
- **Phase 54** — `SubscriptionPlansModule` (core: Plan CRUD, subscribe/cancel,
  `PlatformCharge`, degraded-portal gate) — see "What's actually left" below for
  what remains (the `whiteLabelApp` entitlement and this module's own
  `apps/platform-admin` authoring UI).

Also shipped, on their own separate unmerged branches (not folded into this doc's
own narrative sections above in detail — see each PR's own description):
**Phase 51** (QR check-in redesign + Instructor roll-call scan, Decision 107,
PR #72), **Phase 52** (`apps/school-portal` QR-display screen, PR #73, stacked on
#72), and **Phase 53** (Branch field-level settings UI — the branding-fields gap,
PR #74).

---

## What's actually left

Full cross-track detail (Track B, infra/deployment, and every open decision) now lives
in `docs/ULTM8-MASTER-ROADMAP.md`. This section keeps only the Track A-specific items.

### 1. `SubscriptionPlansModule` — core shipped (Phase 54); two pieces remain

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
every School in this codebase before this phase).

Two pieces deliberately deferred, not silently dropped:
- The `whiteLabelApp` metered entitlement — its own rate is itself unresolved
  ($0.99–$1.99/active-student/month, Spec 55 §12.2: "exact rate still to be set"),
  and the entitlement is meaningless before `MobileAppPublishingModule` exists
  (item 2 below, itself blocked on the Apple compliance decision).
- `apps/platform-admin`'s own authoring UI for Plan CRUD — backend-then-UI split,
  same convention `TranslationsModule` (Phase 49/50) and `CurriculumModule` (Phase
  44/45) already established.

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

**Resolved since this list was last written** (each on its own separate unmerged
branch — see "Where things stand right now" for PR numbers): Attendance roll-call
scan mechanics + QR code display (Phase 51/52), and Branch field-level settings UI
(Phase 53, turned out to be a 2-field gap, not a whole undesigned screen).

---

## Immediate next actions (not phases — just what's actually queued)

1. Get **PR #68, #71, #72, #73, #74** reviewed and merged — all green, clean, no
   reviews yet, nothing blocking on the engineering side.
2. `SubscriptionPlansModule`'s own `apps/platform-admin` authoring UI (item 1) —
   the natural next phase, same backend-then-UI split as Translations/Curriculum.
3. Everything else in "What's actually left" needs a decision, design pass, or both
   before code should be written against it — see `docs/ULTM8-MASTER-ROADMAP.md` for
   the full prioritized path, including where Track A's open items overlap Track B's
   and infra's.
