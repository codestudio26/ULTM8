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

- **48 phases shipped** (Phase 0 walking skeleton through Phase 48), covering every
  backend module in `ultm8-nestjs-module` §5's confirmed table except the three named
  below, plus `apps/school-portal` UI for essentially all of it, plus `apps/platform-admin`
  through its own Slice 4 (impersonation).
- **Two phases sitting in open, unmerged PRs right now** — not yet part of "done" until
  reviewed/merged:
  - **PR #64 — Phase 47**, closing the RLS-level impersonation-scope gap (Spec 55
    Decision 39). Green, `mergeable_state: clean`, no reviews yet.
  - **PR #65 — Phase 48**, the `apps/platform-admin` Impersonation UI (Slice 4) that
    actually calls Phase 43/46/47's backend. Green, clean, no reviews yet.
- **Three backend modules from the original confirmed module table are still fully
  unbuilt** — not partially done, not scaffolded, nothing — detailed in their own
  sections below. Each is blocked on something other than raw build time.
- **Everything Guardian/minor-facing that exists is backend-only.** `GuardiansModule`
  (Phase 12) and every Guardian-on-behalf-of flow (Phases 37–42: Waivers, Schools,
  Memberships, Bookings, Waitlist) has real API surface and is exercised by e2e tests —
  but no UI anywhere calls any of it. That's deliberately not a Track A gap: a Guardian
  is a Student/parent-facing concept, and Track B's own roadmap already names this as
  its own blocked item ("Slice 7 — Guardian-facing screens," blocked on a design pass
  that's never happened). Track A doesn't need to build it; Track B does, later.

---

## Phase overview

| Area | Status |
|---|---|
| Foundation (Auth, Tenants, Classes, Timetable, Instructors, Users, Settings) | ✅ DONE — Phase 0–7 |
| Core domain (Payments, Memberships, Transactions, Ranks/Grading, Waivers) | ✅ DONE |
| Guardian/minor-account backend (linking, consent, on-behalf-of flows) | ✅ DONE (backend only — Phase 12, 37–42) |
| Mobile-facing discovery, self-service attendance, notifications | ✅ DONE — Phase 13–15 |
| `apps/school-portal` full admin surface | ✅ DONE — Phase 3, 17–24, 45 |
| `apps/platform-admin` through Impersonation | ✅ DONE through Slice 3 (Phase 36); Slice 4 (Phase 48) **in PR #65, unmerged** |
| Cross-tenant impersonation-scope security fix | **In PR #64, unmerged** (Phase 47) |
| `CurriculumModule` (Lesson content) | ✅ DONE — Phase 44–45 |
| `SubscriptionPlansModule` (platform-level plans) | ⛔ NOT BUILT — blocked on an `[UNRESOLVED]` domain question |
| `TranslationsModule` (i18n CMS) | ⛔ NOT BUILT — not blocked, just never started |
| `MobileAppPublishingModule` + `packages/build-pipeline` | ⛔ NOT BUILT — blocked on a real product/legal decision |
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
  narrowed the JWT claim; Phase 47 closed the RLS-level gap Phase 46 left open.
  **Phase 47 is PR #64, not yet merged.**
- **Phase 48 (Slice 4)** — the `apps/platform-admin` screen that actually calls the
  impersonation endpoint. **Phase 48 is PR #65, not yet merged.**

---

## What's actually left

### 1. `SubscriptionPlansModule` — blocked on an unresolved domain question

Confirmed scope (`ultm8-nestjs-module` §5): `GET /plans`, `POST /plans/{id}/subscribe`,
Platform-Admin-authoring only. Nothing built — `apps/api/src/payments/payments.controller.ts`'s
own header comment still says "no SubscriptionPlan/white-label billing... deferred to
whenever Phase 9" and that phase never came.

**Why it's stuck, not just unscheduled:** `ultm8-domain-rules` §2 flags, as
`[UNRESOLVED]`, whether the platform-level `SubscriptionPlan` a Franchise/School
"subscribes to" represents ULTM8 billing that Franchise/School directly, or a plan the
Franchise resells onward to its own member Schools — and says explicitly: **"Do not
implement Franchise Subscription Plan billing logic until this is resolved."** The
entity/CRUD shell could plausibly be scaffolded without answering that (Platform Admin
authoring a plan doesn't obviously require knowing the billing direction), but the
`subscribe` action and any billing wiring cannot start until it is. Needs an Architect/
product-owner decision, recorded in `docs/decisions/POST-SPEC-55-DECISION-LOG.md`,
before real work here.

### 2. `TranslationsModule` — not blocked, just never started

Confirmed scope: `CRUD /translations`, `GET /translations?locale=&screen=`,
Platform-Admin-authoring only (`ultm8-nestjs-module` §5). The 5-language/RTL-Arabic
experience this feeds is `[CONFIRMED]` core scope (`ultm8-domain-rules` §1) — not a
nice-to-have. No `[UNRESOLVED]` flag blocks this one; it's simply never been picked up.
Straightforward next-phase candidate whenever prioritized: CMS-style CRUD backend +
a `apps/platform-admin` authoring screen, same shape as every other admin-authored
resource already built.

### 3. `MobileAppPublishingModule` + `packages/build-pipeline` — blocked on a product/legal decision

Confirmed scope: `TenantAppConfig` CRUD, the per-School white-label build/submit
pipeline, credential status-read (`ultm8-app-publishing` §5). `packages/build-pipeline`
is still the placeholder package it was scaffolded as in Phase 1.

**Why it's stuck:** `ultm8-app-publishing` §2 states the whole branded-app tier is
"**contingent on clearing the Apple 4.2.6/4.3 template-farm compliance risk** (§12.2).
If that risk can't be resolved before launch, the branded-app tier drops from v1
entirely." This is also exactly the gate Track B's own roadmap cites for why its own
Phase 6 (per-School white-label branding) is blocked — the same real-world constraint
blocks both tracks' halves of this feature. Not something to start building around;
needs the Apple compliance question actually resolved first.

### 4. `apps/platform-admin` general tenant-data edit UI — parked, not blocked

Decision 105 (`docs/decisions/POST-SPEC-55-DECISION-LOG.md`) already resolved this:
**not built, pending a named use case.** Nothing to do here until a real support/ops
scenario names what "editing another tenant's records generally" actually needs to
cover — building it speculatively is exactly what Decision 105 says not to do.

### 5. `apps/platform-admin` home dashboard — parked, cosmetic

Still lands directly on Admin Users. Low priority; nothing yet to summarize on a
landing page until more of the admin surface exists.

---

## Immediate next actions (not phases — just what's actually queued)

1. Get **PR #64** and **PR #65** reviewed and merged — both green, both waiting on
   human review, nothing blocking on the engineering side.
2. Pick one of items 1–3 above once you want to unblock it: #2 (Translations) is the
   only one of the three with no external blocker — it's ready to scope and build
   whenever it's prioritized. #1 and #3 both need a decision from you (or the Architect/
   product owner) recorded in the decision log before any code should be written
   against them.
