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
- **PR #64 (Phase 47), PR #65 (Phase 48), PR #66 (this doc's own first version), PR
  #67 (Phase 49 — `TranslationsModule` backend), PR #68 (Phase 50 — Translations
  authoring UI), PR #69 (the master roadmap doc), PR #71 (Decision 106 — this PR),
  PR #72 (Phase 51), and PR #74 (Phase 53 — Branch branding-field UI) are merged.**
- **Remaining phases sitting in open, unmerged PRs right now**:
  - **PR #73 — Phase 52**, the `apps/school-portal` QR-display screen. Was stacked on
    Phase 51; its base has since moved to `master` and its diff shrunk to just the
    QR-display screen itself.
  - **PR #75 — Phase 54**, `SubscriptionPlansModule` (backend core) — Plan CRUD,
    Franchise/School subscribe/cancel against ULTM8's own platform Stripe account,
    the `PlatformCharge` ledger, and the read-only degraded-portal gate. Branched
    fresh off `master`, independent of the others.
- **One backend module from the original confirmed module table is still fully
  unbuilt** — `MobileAppPublishingModule` (`TranslationsModule` shipped in Phase
  49–50; `SubscriptionPlansModule`'s backend core is now built too — see below).
- **`SubscriptionPlansModule`'s "blocked" status was a stale citation, now fixed
  (Decision 106, this PR)** — traced to source: three independent primary sources
  (the skill file's own internal consistency, the commit that made the Pass-4 edit,
  and Spec 55's own review-history tracker) agree the billing-direction question was
  resolved *before* Phase 0 started. This doc and two code comments
  (`platform-admin.module.ts`, `payments.controller.ts`) simply never caught up with
  the skill file's own already-`[CONFIRMED]` text. Phase 54 (**PR #75, unmerged**)
  already built the module's backend core on the strength of that reconciliation —
  it was never actually blocked, just unscheduled.
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
| `apps/platform-admin` through Translations authoring | ✅ DONE — Phase 49 backend + Phase 50 UI, both merged |
| Cross-tenant impersonation-scope security fix | ✅ DONE — Phase 47 (merged PR #64) |
| `CurriculumModule` (Lesson content) | ✅ DONE — Phase 44–45 |
| `TranslationsModule` (i18n CMS) | ✅ DONE — Phase 49 backend + Phase 50 UI, both merged |
| QR check-in redesign + Attendance roll-call scan (Decisions 66, 71, 107) | ✅ DONE (backend) — Phase 51, merged via PR #72 |
| `SubscriptionPlansModule` (platform-level plans) | 🟡 Backend core built — Phase 54, **PR #75, unmerged**. Blocker citation reconciled — Decision 106, merged via PR #71 |
| `MobileAppPublishingModule` + `packages/build-pipeline` | ⛔ NOT BUILT — blocked on a real product/legal decision |
| General tenant/content offboarding (no DELETE anywhere) | ⛔ NOT BUILT — unspecified in Spec 55, systemic gap across ~15 files |
| QR code display screen (`apps/school-portal`, Staff-facing) | 🟡 Built — Phase 52, **PR #73, unmerged** (was stacked on Phase 51; base moves to `master` now that Phase 51 has merged) |
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
  edit/delete), end-to-end browser-verified against a live backend. **PR #68, not yet
  merged.**
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
  old one expires. **PR #73, not yet merged** as of this doc's own last edit.
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

### 1. `SubscriptionPlansModule` — not blocked; simply unscheduled (Decision 106)

Confirmed scope (`ultm8-nestjs-module` §5): `GET /plans`, `POST /plans/{id}/subscribe`,
Platform-Admin-authoring only. Nothing built yet — `apps/api/src/payments/payments.controller.ts`'s
own header comment still says "no SubscriptionPlan/white-label billing... deferred to
whenever Phase 9" and that phase never came under that name.

**This doc previously said** `ultm8-domain-rules` §2 flags the billing-direction
question (does the platform-level `SubscriptionPlan` bill the Franchise/School
directly, or does the Franchise resell it onward?) as `[UNRESOLVED]`. **That citation
was stale.** Reconciled directly against source (`docs/decisions/POST-SPEC-55-DECISION-LOG.md`
Decision 106): the skill file's current text is unambiguous and internally consistent
across six separate locations (§2, the platform-wide confirmed-items roundup, the
white-label-entitlement line, the explicit `MembershipPlan`-vs-`SubscriptionPlan`
distinction warning, and the canonical-terminology table) — `[CONFIRMED]`, "ULTM8's own
platform revenue... not a plan the Franchise resells onward," resolved Pass 4. The
`git show` diff of the commit that made that edit (`80de2d4`, dated 31 Aug 2026 — before
Phase 0 of implementation even started) confirms it was a deliberate resolution, not
drift, and the spec's own `review-history-tracker.html` independently corroborates it a
third way ("SubscriptionPlan direction" listed as the first of five decisions locked in
Pass 4). This doc's own prior wording and the `platform-admin.module.ts`/
`payments.controller.ts` comments citing `[UNRESOLVED]` had simply gone stale after
the skill file was updated in place. **`SubscriptionPlansModule` is not blocked — it's
unscheduled, the same status `TranslationsModule` had before Phase 49.** Ready to
scaffold and build whenever prioritized, same shape as every other admin-authored
resource already built.

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

### 4. QR code display screen — the one remaining piece after Phase 51

Phase 51 (Decision 107) closed both mechanics gaps this section used to describe:
`POST /classes/{id}/attendance-scan` (Instructor-run roll-call) is built and
e2e-tested, and the self-service Class QR token now genuinely rotates
(`GET /classes/:id/qr-token`, Decision 66's "time-boxed, rotating, never static"
constraint). What's left is purely a UI gap, not a design gap: no Figma screen was
ever designed for the School Portal's own "QR Code" nav item, and no
`apps/school-portal` screen yet calls the new `GET /classes/:id/qr-token` endpoint to
actually display a rotating code Students can scan. This would be the first
interval-polling UI pattern in `apps/school-portal` (no existing screen polls on a
timer today) — a natural, scoped follow-up phase, not a design gap needing an
Architect pass.

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
2. `SubscriptionPlansModule` (item 1) is now ready to scaffold and build whenever
   prioritized — no decision needed, the citation blocking it was stale (Decision 106).
3. Everything else in "What's actually left" needs a decision, design pass, or both
   before code should be written against it — see `docs/ULTM8-MASTER-ROADMAP.md` for
   the full prioritized path, including where Track A's open items overlap Track B's
   and infra's.
