# ULTM8 — Master Project Roadmap

The single cross-track source of truth for "what's done, what's left, and what's
blocking it" across the whole platform. Companion to, not a replacement for:

- `docs/TRACK-A-ROADMAP.md` — backend (`apps/api`) + `apps/school-portal` +
  `apps/platform-admin` detail.
- `docs/TRACK-B-ROADMAP.md` — the Student mobile app (`apps/student`) detail. **Lives
  only on the unmerged `origin/track-b-student-app` branch today** — not in this
  checkout. Everything below about Track B is sourced from that branch as of its HEAD
  commit `b34bb97` (2026-09-17), audited directly against the real code, not assumed
  from the doc alone.
- `docs/decisions/POST-SPEC-55-DECISION-LOG.md` — the append-only decision record
  (Decisions 70–110 as of this writing). This doc cites decisions by number; it does
  not restate their reasoning.
- `skills/ultm8-domain-rules/SKILL.md` — the canonical, tagged distillation of Spec
  55's business rules (`[CONFIRMED]` / `[UNRESOLVED]` / etc.). Where this doc and that
  skill disagree, **the skill file wins** (`CLAUDE.md`'s own source-of-truth
  hierarchy) — this actually happened once already (the `SubscriptionPlansModule`
  citation, reconciled by Decision 106) and is exactly the failure mode §6 below warns
  about.

Same standing rules as everywhere else in this repo: only `[CONFIRMED]` items are safe
to build against; an `[UNRESOLVED]` item is a stop-and-escalate, not a guess; load
`skills/ultm8-domain-rules/SKILL.md` before any domain-rule work; never invent
unspecified business logic.

Last synthesized: 2026-09-18, from a full audit of Track A (this session's own direct
knowledge), Track B (`origin/track-b-student-app` HEAD `b34bb97`), infrastructure/CI/CD
(`master` HEAD `bbf0198`), and every `[UNRESOLVED]` item + decision-log entry. Updated
same day: `SubscriptionPlansModule`'s stale blocker citation was reconciled (Decision
106) and its core backend shipped (Phase 54) — see §1 and §4. **Updated again
2026-09-20**: PR #73 (Phase 52, QR-display screen) merged. PR #61 merged: a
design-system refresh (accent color rebase, Figtree typeface)
bundled with a real Transaction Student-name resolution fix, recorded as Decision 108
(Instructor rank V1/V2) and Decision 109 (Transaction Student-name resolution,
Developer-level inference, flagged for Architect confirmation). PR #31 merged: two
shared `packages/ui` responsive bugs (mobile-nav collapse, table horizontal-overflow)
fixed for every `apps/school-portal` page at once. **Updated a third time, same
day**: Phase 55 shipped `SubscriptionPlansModule`'s own `apps/platform-admin`
authoring UI (PR #76, merged) — the module is now
fully shipped except the still-deferred `whiteLabelApp` entitlement (blocked on
Apple compliance, unrelated to this phase). **Updated again 2026-09-21**: Decision
110 resolves general tenant/content offboarding's policy question — soft-archive
with a 90-day retention window (matching the white-label credential's own Decision
27 precedent), triggered only by an explicit close-account action, never by
platform-subscription cancellation alone, scoped to School/Franchise-level
offboarding only (GDPR/LGPD per-user erasure stays a separate, still-open item) —
see §1 and §4. **Updated a fifth time, same day**: Phase 56 built Decision 110 end
to end (backend) — `TenantLifecycleModule`'s close/reactivate endpoints, the
archived-gate across all 10 named entity services (22 call sites), and a daily
scheduled purge job that hard-deletes or (for two flagged exceptions — retained
`Waiver` rows, protected billing history) anonymizes a School/Franchise 90 days
past close. **Updated a sixth time, same day**: Phase 57 built the
`apps/platform-admin` side of the same feature — a shared
`TenantLifecycleControls` component (Active/Closed badge, re-typed-name
confirmation modal, Reactivate button) on `SchoolLookupPage`/
`FranchiseLookupPage`, requiring `SchoolResponseDto`/`FranchiseResponseDto` to be
widened to type `archivedAt`/`purgeAt`/`purgedAt` (and `FRANCHISE_PUBLIC_SELECT`
to actually select them — School's `findOne()` already returned them at
runtime, Franchise's did not). Both phases are on the same PR #77, merged. See
§1 for the full account. Only `Waiver`'s own retention period remains open.

**Updated 2026-09-23:** Infrastructure & deployment's "code that can be written now"
half (§3's own framing) is done — a production `apps/api/Dockerfile`, first-pass
Terraform for the full confirmed AWS stack, a manual/gated CD pipeline skeleton, and
`docs/ops/` docs for backup/DR, APM/observability, and the numeric-NFR-targets gap.
No new product/architecture decision was made or needed — every choice in this work
is a self-flagged, Developer-level infra default (same treatment `variables.tf`'s own
comments already give sizing/region), not a Decision-log entry. **Still nothing is
provisioned or running** — this environment has no AWS account or credentials,
`terraform apply` has never been run, and `.github/workflows/deploy.yml` has no
automatic trigger by design. See §3.

**Updated 2026-09-23:** Track B is synced onto current master and PR'd — see §2's own
"Integration status" for the full account (Decision 98 collision resolved/renumbered to
113, two real bug fixes carried over, one real API-contract drift found and fixed).
Test coverage (still zero) remains explicitly open, scoped out of the
sync PR on purpose — see §2's own "Recommended next actions."

**Updated 2026-09-25:** PR #76 (Phase 55), PR #77 (Decision 110 + Phase 56 + Phase
57), and PR #81 (Track B sync) are all merged to master. Track A now has zero open
PRs; Track B is merged and current with master as of PR #81's own base commit. See
§1/§2's own updated status and the Snapshot table above.

**Updated 2026-09-30 (Decision 122):** closed a real gap in an already-confirmed
Spec 55 §6.1 rule — a Membership force-Expiry (Subscription final cancellation, or
a lost Membership-purchase dispute) now also cancels the future Bookings it was
funding and notifies the waitlist for each freed seat, instead of silently leaving
them in place. Not itself a Track-status change (no phase completed, no PR count
shifted) — logged here because it closes a specific, previously-flagged gap this
doc's own history should reflect. See Decision 122 for the full account, including
the one genuinely inferred scope choice (guest-seat Bookings are left untouched)
and a related, still-open gap this fix does NOT cover (no sweep exists anywhere for
a Membership expiring by its own `expiryDate`, only for the two force-Expiry sites
that already existed).

**Updated 2026-10-13 — this doc had gone stale against `docs/v1.2-backend-backlog.md`,
`docs/TRACK-B-ROADMAP.md`, and the decision log, all three of which had kept pace
with real work this doc hadn't synthesized since 30 Sep. Reconciled directly against
those sources (not assumed), not just patched at the Snapshot table:**
- **TimetableSlot ↔ Class — resolved, not still-blocking.** §4's table used to list
  this as an open architectural blocker (Decisions 200/205). It was actually resolved
  by **Decision 210**: the daily `class-occurrence-generation` job already materializes
  real, dated `Class` rows from every `TimetableSlot` up to 4 weeks ahead — there was no
  remaining data-model question, only a missing lookup endpoint. The Timetable page's
  real click-to-book UI shipped on that basis (backlog doc, "Timetable page," DONE 12
  Oct 2026). Removed from §4's blocker table below.
- **Guardian consent-management UI — approved and built, not an unapproved candidate.**
  **Decision 236** promoted Track B's candidate screen to approved, and gated BASELINE
  consent withdrawal behind step-up re-authentication. No longer Track A's item 3 or
  §4's own blocker row.
- **Track B is far more complete than this doc's own Snapshot/§2 said.** Payment UI
  (hosted-Checkout fresh-card and saved-card, Decisions 238/243), Waiver drawn-signature
  capture, QR check-in (both display and camera-scan), and Kid Mode booking delegation
  (Decision 123) are all built and merged — see `docs/TRACK-B-ROADMAP.md`'s own
  "Recommendation" section, which is current through 12 Oct 2026. The one Track B item
  still genuinely blocked is per-School white-label branding (same Apple-compliance gate
  as Track A).
- **Track B's "zero test coverage" claim was flat-out wrong by the time of this
  update** — verified directly (not trusted from either roadmap doc): `apps/student`
  has a real `"test": "jest"` script and 19 test files on disk today. Exactly the kind
  of claim this doc's own §6 warns goes stale fastest — recorded here as a caught
  instance, not just corrected silently.
- **Entity-level tenant offboarding extended to 7 more entities** — **Decision 226**
  (merged via PR #238): Branch, Class, TimetableSlot, Instructor, Rank, Waiver, and
  Lesson each gained the same soft-archive/90-day-purge pattern Decision 110 built for
  School/Franchise, usable by a School Owner without closing the whole School.
  **Corrected (Decisions 253/261):** this list's own earlier "9 of 16 still have no
  such action" framing was wrong on every count — Discipline/Skill already had real
  hard-delete, Booking/RoleGrant already had real cancel/revoke mechanisms, and
  Membership/Transaction/PaymentAccount are now explicitly decided never-deletable
  (same financial/legal-record reasoning as Waiver), not an open gap — see §1 item
  2's update below.
- **GDPR/LGPD's "no corresponding entry anywhere" tracking-gap claim is now false.**
  **Decision 245** (12 Oct 2026) gave it a real decision-log entry — a technical-design
  scoping pass only (anonymize-in-place vs. hard-delete, single-region vs.
  region-per-tenant), explicitly not legal advice and nothing built yet. Still
  genuinely open; just no longer *undocumented*. See §4's "tracking gap" section,
  corrected below.
- Also shipped since 30 Sep, not previously reflected anywhere in this doc: Instructor
  and Staff "Add Manually" (Decisions 237/251 — real User+RoleGrant created
  immediately, temp passcode emailed, forced change on first login), Branch
  field-level settings screen content gap closed, Franchise leave/switch (Decision
  232), late-cancellation fee collection (Decision 234, closing the §4 "real but
  narrower" item below), a no-camera QR check-in fallback (Decision 235), and Student
  Measurements as real `User` fields (Decision 220/246).

---

## Snapshot

| Track | State |
|---|---|
| **Track A** — backend + school-portal + platform-admin | 57+ phases shipped, all merged to master — no Track A PRs open. `MobileAppPublishingModule` and `packages/build-pipeline` remain fully unbuilt, genuinely blocked on Apple compliance. `SubscriptionPlansModule` fully shipped; only its `whiteLabelApp` entitlement remains, same blocker. General tenant/content offboarding now covers School/Franchise (Decision 110) **and** Branch/Class/TimetableSlot/Instructor/Rank/Waiver/Lesson (Decision 226, PR #238, merged 13 Oct 2026); Membership/Transaction/PaymentAccount are confirmed never-deletable (Decisions 253/261, same reasoning as Waiver), and Booking/RoleGrant already had real cancel/revoke mechanisms all along — no remaining gap, despite an earlier wrong "9 of 16" count in this doc. Guardian consent-management UI is Track B's, not Track A's, and is now approved and built (Decision 236) — no longer an open item here. Also shipped since the last full synthesis: Instructor/Staff "Add Manually" (Decisions 237/251), Branch field-level settings, Franchise leave/switch (Decision 232), late-cancellation fee collection (Decision 234), a no-camera QR check-in fallback (Decision 235), Student Measurements as real fields (Decision 220/246), and real Timetable click-to-book (Decision 210 resolved the underlying TimetableSlot↔Class question). |
| **Track B** — Student mobile app | Merged and current with master (PR #81 and many since). **Real automated test coverage now exists** — `apps/student` has a `jest` test script and 19 test files on disk (verified directly 13 Oct 2026); the "zero test coverage" claim this table carried for weeks was stale. Payment UI (hosted-Checkout fresh-card + saved-card, Decisions 238/243), Waiver drawn-signature capture, Guardian consent + step-up re-auth (Decision 236), Kid Mode booking delegation (Decision 123), and QR check-in (display + camera-scan) are all built and merged — see `docs/TRACK-B-ROADMAP.md`'s own "Recommendation" section (current through 12 Oct 2026). Only per-School white-label branding remains genuinely blocked (same Apple-compliance gate as Track A). |
| **Infrastructure & deployment** | AWS (RDS/ElastiCache/Fargate) + GitHub Actions is the *decided* target (Spec §11.6). First-pass Dockerfile, Terraform for the full confirmed stack, a manual/gated CD pipeline skeleton, and backup/DR + APM + NFR-gap docs now exist (`apps/api/Dockerfile`, `infra/terraform/`, `.github/workflows/deploy.yml`, `docs/ops/`) — **still nothing is provisioned or running**: no AWS account/credentials exist in this environment, `terraform apply` has never been run, and CI remains test-only (deploy is manual-dispatch only, by design). Unchanged since the last full infra audit — nothing in §3 below needed correction. |
| **Open decisions** | Well past 250 post-spec decisions logged as of 13 Oct 2026 (`docs/decisions/POST-SPEC-55-DECISION-LOG.md` is the authoritative count — deliberately not restated as an exact number here, since this table has already gone stale on that count more than once). Resolved since the last full synthesis of this table: TimetableSlot↔Class (Decision 210), Guardian consent-UI approval (Decision 236), late-cancellation fee collection (Decision 234), GDPR/LGPD's own tracking-gap now has a real entry (Decision 245, technical-design scoping only — still needs a legal/program owner). Apple 4.2.6/4.3 compliance is now resolved and built too (Decision 266, 15 Oct 2026 — the School-selection UX Decision 247 itself left open; see the "Blocks a whole module" table below). Still genuinely open: Waiver retention period, RoleGrant authority-matrix edges (Decision 80/81), Stripe Connect verified for UAE only (Decision 86), Franchise lifecycle edges (Decisions 97/98/99). |

**Nothing here is "100% done."** Track A is the most mature by a wide margin; Track B
and infra/deployment are the two biggest remaining bodies of work, and they're
different in kind — Track B is buildable-today work sitting idle, while most of
infra/deployment is genuinely blocked on the product owner provisioning a real AWS
account (Claude Code cannot create AWS infrastructure or credentials on its own).

---

## 1. Track A — backend, school-portal, platform-admin

Full detail: `docs/TRACK-A-ROADMAP.md`. Summary:

**Done:** Foundation (Auth/Tenants/Classes/Timetable/Instructors/Users/Settings),
core domain (Payments/Memberships/Transactions/Ranks/Waivers), Guardian backend
(linking, consent, on-behalf-of flows for Waivers/Schools/Memberships/Bookings/
Waitlist — backend + e2e only, no UI anywhere), mobile-facing discovery/attendance/
notifications, `CurriculumModule`, `TranslationsModule` (Phase 49 backend + Phase 50
UI, both merged via PR #67/#68), the QR check-in redesign + Instructor roll-call scan
(Phase 51, Decision 107 — merged via PR #72) plus its `apps/school-portal` QR-display
screen (Phase 52, merged via PR #73), Branch field-level settings UI (Phase 53,
merged via PR #74 — turned out to be a small gap: the screen has existed since
Phase 3, only Decision 76's branding fields were missing), `SubscriptionPlansModule`
end to end (Phase 54 backend, merged via PR #75 — Plan CRUD, subscribe/cancel,
`PlatformCharge`, the degraded-portal gate; Phase 55 `apps/platform-admin`
authoring UI, PR #76), `apps/school-portal` full admin surface,
`apps/platform-admin` through Translations authoring including Cognito auth, audit
logging, cross-tenant read/write for Schools/Franchises/PaymentAccounts/AdminUsers,
Stripe credential rotation, and read-only Support impersonation (with its RLS-scope
hardening), and Decision 55/111/112's Stripe dispute-handling + chargeback-pattern-
restriction, both merged to master: real `charge.dispute.*` handlers across
Transaction/FranchiseFeeCharge/PlatformCharge, refund/credit-restore frozen while
disputed, Membership force-Expiry + Subscription cancellation on a loss, notification
routed by who's financially exposed (Phase A), plus the `chargeback-pattern-
restriction` job restricting a Student to Cash/Bank Transfer past 2 lost disputes
(Phase B). Full detail: `docs/TRACK-A-ROADMAP.md`'s own "Payments — Stripe dispute
handling" section. Also merged, outside the Phase-N sequence: a design-system refresh
(accent color rebase, Figtree typeface) bundled with a real Transaction Student-name
resolution fix (PR #61, Decisions 108/109), the infra Dockerfile/Terraform/CD-pipeline
skeleton (merged), and a shared `packages/ui` fix for mobile-nav collapse + table
horizontal-overflow affecting every `apps/school-portal` page (PR #31). Also shipped:
general tenant/content offboarding, both backend (Phase 56, Decision 110) —
`TenantLifecycleModule`'s close/reactivate endpoints (FULL_ADMIN-only, re-typed-name
confirmation, audited), the archived-gate wired into all 10 named entity services'
create/update paths, and a daily scheduled purge job that hard-deletes or (for two
flagged exceptions) anonymizes a closed School/Franchise 90 days out — and its
`apps/platform-admin` UI (Phase 57) — a shared `TenantLifecycleControls` component on
`SchoolLookupPage`/`FranchiseLookupPage` (Active/Closed badge, re-typed-name
confirmation modal, Reactivate button). **Track A has no open PRs**: PR #76
(Phase 55) and PR #77 (Decision 110's record plus its Phase 56 + Phase 57
implementation) are both merged to master.

**Left, in priority order:**

1. ~~`SubscriptionPlansModule` blocker citation~~ — done (Decision 106, merged via
   PR #71): traced the question to source across three independent primary sources
   and found it was resolved before Phase 0 started; this doc, the old Track A
   roadmap, and two code comments had simply never caught up with the skill file's
   own already-`[CONFIRMED]` text. Phase 54 (merged via PR #75) built the module's
   backend core on the strength of that reconciliation.
   **Update, Phase 53**: checked whether this same drift recurred for Branch
   (Decision 76) — it hadn't. The repo's actual `ultm8-domain-rules` SKILL.md
   already carries Branch's field list as `[CONFIRMED]`, citing Decision 76
   directly (a first pass at this checked a stale cached copy instead of the
   real file and wrongly concluded otherwise — caught before committing). The
   skill's neighboring `[UNRESOLVED]` line on the Branch *screen* specifically
   is genuinely now outdated by Phase 53 shipping it, and worth a small Architect
   update to match — a much narrower finding than first thought.
2. ~~**General tenant/content offboarding** — needs a product/legal decision, then
   build~~ — done end to end (**Decision 110** + **Phase 56** + **Phase 57**,
   PR #77). Policy: soft-archive
   immediately, hard-delete after a 90-day retention window (matching the
   white-label credential's own Decision 27 precedent), triggered only by an
   explicit close-account action, never by platform-subscription cancellation
   alone. Scoped to School/Franchise-level offboarding only — GDPR/LGPD per-user
   erasure stays a separate, still-undecided item (§4 below). Build:
   `TenantLifecycleModule` — close/reactivate for School and Franchise
   (FULL_ADMIN-only, re-typed-name confirmation, audited), the archived-gate
   (`TenantAuthorizationService.assertSchoolNotArchived`/`assertFranchiseNotArchived`)
   wired into all 10 named entity services' create/update paths (School, Branch,
   Class, Timetable, Instructor, Membership, Rank, Waiver, Franchise, Curriculum —
   22 call sites), and a daily `tenant-lifecycle-purge` job that hard-deletes a
   School/Franchise past `purgeAt` or, in two flagged cases, anonymizes it in place:
   a School that still owns `Waiver` rows (Decision 110's own exception — Waiver
   retention needs real legal input before it runs on the uniform 90-day clock),
   or a School/Franchise with billing history protected by the existing
   `PlatformCharge`/`FranchiseFeeCharge` `RESTRICT` FKs. Deliberately does not touch
   Membership/Transaction/PaymentAccount/Booking/RoleGrant — none are named in
   Decision 110's own scope. **Phase 57** then built `apps/platform-admin`'s own
   close/reactivate UI: a shared `TenantLifecycleControls` component on
   `SchoolLookupPage`/`FranchiseLookupPage` (Active/Closed badge, re-typed-name
   confirmation modal, Reactivate button, an "already purged" message once
   `purgedAt` is set) — needed `SchoolResponseDto`/`FranchiseResponseDto` widened
   to type `archivedAt`/`purgeAt`/`purgedAt`, and `FRANCHISE_PUBLIC_SELECT`
   widened to actually select them (School's `findOne()` already returned them at
   runtime; Franchise's did not). Left: `Waiver`'s own retention period.
3. ~~**Guardian consent-management UI**~~ — done (**Decision 236**): Track B's
   candidate implementation (`apps/student/src/guardians/`) was promoted to
   approved and built, with BASELINE consent withdrawal additionally gated behind
   step-up re-authentication. Confirmed Track B's, not Track A's/School Portal's —
   `ultm8-domain-rules` §14 confirms `Guardian` has only a React Native app
   session.
4. **Entity-level tenant offboarding, extended to 7 more entities** — done
   (**Decision 226**, PR #238, merged 13 Oct 2026): Branch, Class, TimetableSlot,
   Instructor, Rank, Waiver, and Lesson each gained the same soft-archive +
   90-day-purge pattern Decision 110 built for School/Franchise, usable by a
   School Owner without closing the whole School — a real "Delete" action where
   none existed before. `Waiver` is never hard-purged, mirroring Decision 110's
   own legal-record exception. **No longer "left": Decision 253 (Membership) and
   Decision 261 (Transaction, PaymentAccount) both confirmed never-deletable, the
   same financial/legal-record treatment as Waiver — not a remaining gap, a
   decided exception. Booking and RoleGrant were never gaps at all (real
   cancel/revoke mechanisms already existed).** The original "9 of 16" framing
   this section used to carry was wrong on every count — see Decision 253's own
   file-by-file verification for the full account.
5. **`MobileAppPublishingModule` + `packages/build-pipeline`** — blocked on the Apple
   4.2.6/4.3 template-farm compliance question (see §4 below — shared blocker with
   Track B's own white-label branding). Its white-label metered-billing rate is also
   unfinalized — this now also gates `SubscriptionPlansModule`'s own deferred
   `whiteLabelApp` entitlement (Phase 54), not just Track B/Track A's own publishing
   pipeline. (`SubscriptionPlansModule`'s own `apps/platform-admin` authoring UI
   shipped in Phase 55 — backend-then-UI split, same convention Translations/
   Curriculum already used. `whiteLabelApp` is the only piece of this module still
   blocked.)
6. Parked, not blocking anything: `apps/platform-admin` general tenant-data edit UI
   (Decision 105 — deliberately not built pending a named use case) and its home
   dashboard (cosmetic).
7. **Decision 109 confirmation** — Transaction Student-name resolution (PR #61) was
   recorded as a Developer-level inference, flagged for Architect confirmation, not
   yet given one. Nothing is blocked on it; worth a short pass.

**Smaller, individually-flagged items worth a decision at some point** (none currently
block a module, but each is a real, live gap): `grading.service.ts`'s
`assertStaffAtSchool` may be over-broad for mutating grading actions (shipped on an
unconfirmed assumption — real rework risk if narrowed later); `SettingsController`'s
"permissions metadata" was named in the spec but never given an endpoint; no general
refresh-token endpoint exists (Spec §8.3 describes one; the current 15-minute
forced-relogin window is the accepted tradeoff); `user_self_or_shared_school`'s RLS
clause means two Instructors at the same School can't see each other's `User`
profile; the RoleGrant authority matrix only covers the narrow Owner/Manager→
Instructor/Staff case (Decision 80) — Owner-grants-Owner and Franchise-Owner-grants-
anything are flatly rejected pending a decision; Stripe Connect onboarding was only
verified for UAE (Decision 86) — other regions are unverified; `ultm8-tenant-isolation`
SKILL.md itself hasn't been updated to acknowledge the `ultm8_jobs`/discovery-role
precedents Decisions 89/92/93/94 established (an Architect documentation task, not
code).

---

## 2. Track B — Student mobile app (`apps/student`)

Full detail: `docs/TRACK-B-ROADMAP.md` — lives in this checkout now (merged onto
`master` since the sync described below), and is kept current far more reliably
than this section is. Cross-check against it directly before trusting this
section's own summary.

**Status as of 2026-10-13 (re-verified directly against the roadmap doc and real
code, not assumed from this section's own stale prior text):** Track B is now
substantially complete for its own planned v1 scope. Done and merged: Expo/RN
foundation, class booking + waitlist, Notifications (read-side), Rank/Grading
(read-only), Membership purchase for every path — Cash/Bank, free plans, **and
Stripe** (hosted-Checkout fresh-card and saved-card, Decisions 238/243, resolved
without the native dev-client workflow this section used to say was required),
Waiver drawn-signature capture, Guardian consent management + step-up
re-authentication (Decision 236), Kid Mode booking delegation (Decision 123), QR
check-in (both the display side, carried over from Track A, and a real
`apps/student` camera-scan screen), student-scoped transaction history, and
session refresh (no more mid-session forced relogin). **Real automated test
coverage now exists** — verified directly: `apps/student/package.json` has a
`"test": "jest"` script and 19 test files on disk, directly contradicting this
section's own prior "zero test coverage" claim, which had gone stale.

**Genuinely still blocked, not just unbuilt:**
- **Per-School white-label branding** — blocked on the same Apple compliance
  question and `packages/build-pipeline` placeholder as Track A item 5. The only
  Track B item in this category.

**Historical integration record — updated 2026-09-25, merged, kept for context:**
- **The sync is merged** — `track-b-student-app` (19 commits, fork point `f71b481`
  / Phase 16a, 79 master commits behind by the time of the sync) merged onto current
  master in a new branch, CI-verified before opening: `apps/api` and `apps/student`
  both typecheck clean, the full 30-suite/327-test e2e gate passes against real
  Postgres+Redis, and `turbo run build` is clean across all 8 packages. PR #81
  merged 2026-09-25 (after a second, smaller conflict resolution against master's
  own PR #76/#77 landing first — see PR #81 for the full account).
- **The Decision 98 collision (below) is resolved**, not just flagged: both branches
  had independently used "Decision 98" for unrelated content (master:
  School→Franchise linking; Track B: its own Expo/secure-store kickoff decision).
  Track B's entry was renumbered to **Decision 113** (the next free slot once PRs
  #77/#79's own claimed numbers 110–112 are accounted for, not just master's own
  109) at sync time, with its own numbering note explaining why, and all 5 of its
  code/doc citations updated to match.
- **Two real carried-over fixes** rode along in the sync, previously living only on
  Track B's own branch: `MembershipsService.findAllPlans` was missing its
  owner/manager authorization gate (any tenant JWT could list any School's plans) —
  now fixed on master too; `packages/api-client`'s `unwrap()` mishandled a genuine
  `204 No Content` response as a failure in some cases — also fixed for every
  consumer (school-portal, platform-admin), not just apps/student.
- **A real API-contract drift was found and fixed during the sync**, not just
  merged around: master's later on-behalf-of work (Decision 103 and siblings) added
  an optional `studentId` to three DTOs Track B's own mutations call
  (cancel-booking, join-waitlist, purchase-membership), making `body` itself a
  required key even though `studentId` stays optional — 3 call sites in
  `apps/student` didn't have it and failed `tsc`. Fixed by adding `body: {}`,
  mirroring the pattern Track B's own `useBookClass()` already used correctly.

**Backend gaps Track B surfaced while building** (real findings, not Track B's fault —
worth carrying into Track A's own backlog): no `GET /waitlist/me`-equivalent endpoint,
so a Student can never discover an opened waitlist spot to claim (the cascade job never
creates a Notification either); no batch Rank-lookup endpoint (Track B does N+1 calls
per Discipline as a workaround); Membership purchase/plan-list endpoints appear to
have no tenant/enrollment authorization check beyond a valid JWT (flagged for a
backend security review); no signal on the Membership Plan DTO for whether its School
is Stripe-backed, so tapping a Stripe-only plan today would start a real Transaction/
PaymentIntent before the app can show its own "not available yet" message — a real
correctness bug waiting for Slice 4b to matter.

**Recommended next actions for Track B**, roughly in order:
1. ~~Sync Track B onto current master, resolving the Decision 98 conflict~~ — done,
   see "Historical integration record" above; PR #81 merged.
2. ~~Fix Track B's CI env-var drift~~ — turned out to be API-contract drift, not
   env-var drift; the 3 real call-site breakages found are fixed, see above.
3. ~~Open a real PR~~ — done, same PR as #1.
4. ~~Add a `test` script and at least smoke-level coverage~~ — done: `apps/student`
   now has a real `jest` setup and 19 test files (verified 13 Oct 2026).
5. ~~Pick up Slice 4b (Stripe UI)~~ — done (Decisions 238/243, hosted Checkout).
   ~~Re-attempt Waiver/Guardian screens~~ — done (drawn-signature capture; Guardian
   consent + step-up, Decision 236).
6. Only genuinely open item: per-School white-label branding, once the Apple
   compliance question (§4 below) is resolved.

---

## 3. Infrastructure & deployment

Nothing below is a "Track" in the phase-numbered sense — it's the operational layer
every track eventually needs to actually run in production. Full detail was gathered
by direct audit of `.github/workflows/`, the repo's `.env.example` files, `docs/`, and
`skills/`.

### Real and implemented today
- **CI** (`.github/workflows/ci.yml`) — real, runs on every PR/push to `master`. Two
  jobs: a required cross-tenant-isolation gate (real Postgres + Redis service
  containers, full e2e suite) and a build-and-unit-test job (`turbo build`/`turbo
  test`). **Test-only — no deploy job exists.**
  
- **Background jobs** (`apps/api/src/jobs/`) — fully built, not a stub. 8 real BullMQ
  queues, 8 processors, 4 schedulers, ~1,745 lines. Degrades gracefully with no Redis
  reachable (same "unconfigured dependency" convention as Stripe/Twilio), exercised for
  real in CI via a Redis service container.
- **RLS/tenant-isolation security model** — substantially implemented: `FORCE ROW
  LEVEL SECURITY` on every tenant-scoped table, dedicated least-privilege Postgres
  roles per subsystem, the CI gate itself, an immutable partitioned `AuditLogEntry`.
- **Cloudflare R2 client code** (`R2ClientService`) — implemented; the actual bucket is
  not provisioned.
- **Local dev environment** — a real `.devcontainer/docker-compose.yml` (Postgres 16 +
  Redis 7). Dev-only, not a production container definition.
- **Production Dockerfile** (`apps/api/Dockerfile`) — multi-stage
  (`turbo prune --docker` → install → build → non-root runtime), targets the
  confirmed Fargate deploy target. Build mechanics were validated in this sandbox
  against a substitute base image (Docker Hub's own CDN is blocked by this
  environment's org egress policy — the same class of denial as the Terraform
  registry block below, not routed around); the real committed image
  (`node:20-bookworm-slim`) was never itself built end-to-end here. See the
  Dockerfile's own header comment.
- **First-pass Terraform** (`infra/terraform/`) — the full "decided, zero
  provisioning" stack below, as code: VPC, RDS + RDS Proxy, ElastiCache, ECS
  Fargate + ALB, ECR, Secrets Manager, Cognito, least-privilege IAM.
  `terraform fmt -check` clean across all 15 files; `terraform validate`/`init`
  could not be run (`registry.terraform.io` blocked by this sandbox's own org
  policy) — flagged, not silently assumed passing, in `infra/terraform/README.md`.
  **Not applied** — no AWS account/credentials exist in this environment.
- **CD pipeline skeleton** (`.github/workflows/deploy.yml`) — `workflow_dispatch`
  -only (no automatic trigger, by design): build+push `apps/api`'s image,
  `terraform plan`/`apply`, and an opt-in migration step (`aws ecs run-task`
  against the same task definition the service uses, since RDS Proxy has no
  route from a GitHub-hosted runner). Every required secret/variable (AWS OIDC
  role, domain, Terraform backend) is named in `infra/terraform/README.md`'s own
  "CD pipeline" section but unset — dispatching it today fails closed at the
  first AWS-credentials step, not a silent no-op.
- **Backup/DR, APM/observability, and NFR-target gap docs** (`docs/ops/`) — each
  of the three "genuine gaps" this section used to list bare is now its own
  document: what's actually provisioned, what's still missing, and (NFR targets
  specifically) an explicit statement that no number in that doc is a decision.

### Decided, zero provisioning (the largest category)
Every one of these has a real, named decision behind it (cited); Terraform for
all but one now exists (`infra/terraform/`, above) — **none of it has been
applied**, and no live AWS account/credentials exist anywhere in this
environment:

| Target | Decision | Provisioned? |
|---|---|---|
| AWS RDS + ElastiCache + ECS Fargate hosting | Spec §11.6, Decision 11 | Terraform written (`rds.tf`, `elasticache.tf`, `ecs.tf`) — not applied |
| AWS Secrets Manager | Spec §11.6, `ultm8-payments` §1 | Terraform written (`secrets.tf`) — not applied |
| AWS Cognito (Platform Admin IdP) | Decision 100 | Terraform written (`cognito.tf`) — not applied |
| RDS Proxy (connection pooling) | Decision 63 | Terraform written (`rds_proxy.tf`) — not applied; still no app-code path specific to it (`DATABASE_URL*` is consumed the same either way) |
| Cloudflare Stream + AWS Transcribe (video) | Decision 101 | No — schema fields exist, unused; out of this infra phase's scope |
| CloudWatch (job-queue observability) | Decision 53 | Partially — log shipping to CloudWatch Logs is now provisioned (`ecs.tf`'s `awslogs` driver + Container Insights) and every job processor's designed error-logging rule already flows there; no metric filter/alarm turns that into a page yet — see `docs/ops/APM-AND-OBSERVABILITY.md` |

### Genuine gaps — still open (docs now exist to track them; numbers/tooling do not)
- **Database backup/DR strategy** — RDS's own automated-backup/PITR/Multi-AZ
  defaults are now documented, with their real limits (no Redis snapshotting,
  no timed restore runbook) — `docs/ops/BACKUP-AND-DR.md`. No RPO/RTO target is
  confirmed anywhere; that part of the gap is unchanged.
  Still not mentioned at the decision-log level.
- **Error-tracking/APM** — current state (structured logs → CloudWatch Logs,
  Container Insights, ALB health checks) and what's missing (alarms, tracing,
  an error-tracking SaaS, a real `/health` route) are now documented —
  `docs/ops/APM-AND-OBSERVABILITY.md`. None of the missing pieces are built.
- **Numeric NFR targets** (uptime/SLA, p95 latency, concurrent-user budgets) —
  still none found anywhere in the repo; now has a canonical, explicitly-flagged
  place to record them once a product/architecture decision sets them —
  `docs/ops/NFR-TARGETS.md`.
- **Formal compliance program** (SOC 2, PCI DSS attestation beyond the SAQ-A design
  target, GDPR/LGPD data-residency program) — see the dedicated finding below.
  Unchanged by this infra phase.
- **`packages/build-pipeline`** — confirmed, explicit placeholder (its own `build`
  script literally echoes "placeholder"). Not a disguised gap — it's honestly labeled
  and blocked on the same Apple compliance decision as Track A item 5 / Track B's
  own white-label branding. Unchanged by this infra phase.

### What CAN start now, without waiting on AWS provisioning
This split has now played out once, not just been proposed: the Dockerfile,
first-pass Terraform, CD pipeline skeleton, and `docs/ops/` docs above are all
"code that can be written now" (above), done without live AWS credentials —
same as every other "confirmed target, not yet built" item in this codebase.
What genuinely still can't proceed without the product owner is unchanged: the
actual `terraform apply`/account-provisioning step, and everything gated behind
it (a real domain/ACM cert, a real image pushed to ECR, real vendor-secret
values, real migrations run, and eventually real NFR targets to size and
alert against).

---

## 4. Open decisions & unresolved items — cross-track view

This is a consolidated view of `skills/ultm8-domain-rules/SKILL.md`'s `[UNRESOLVED]`
tags and `docs/decisions/POST-SPEC-55-DECISION-LOG.md`'s open follow-ups, organized by
what they actually block. Full detail (all 41 decisions, all `[UNRESOLVED]` citations)
is preserved in this synthesis's source audit; this section keeps only what's
load-bearing for planning.

### Blocks a whole module or UI surface
| Item | Blocks | Owner needed |
|---|---|---|
| Apple 4.2.6/4.3 template-farm compliance risk — **the policy question AND the School-selection UX are both resolved and built** (**Decision 247**, 12 Oct 2026: one shared app, School selected after install, not a per-tenant App Store listing; **Decision 266**, 15 Oct 2026: the actual pre-auth pick screen — join code + search, picked before signup — plus a School join code/accent-color on the backend). What's still genuinely unbuilt: `MobileAppPublishingModule`/`packages/build-pipeline` remain fully unbuilt, and `skills/ultm8-app-publishing/SKILL.md`'s entitlement model/`TenantAppConfig` design still assumed the old per-tenant-app shape and needs a reconciliation pass before either gets built | `MobileAppPublishingModule`, `packages/build-pipeline`, Track A item 5, Track B's per-School white-label branding, `SubscriptionPlansModule`'s own deferred `whiteLabelApp` entitlement — the entire branded-app tier | Developer (build pipeline + SKILL.md reconciliation) — no further Product input needed on this item |
| GDPR/LGPD data-residency program + per-user erasure | Launch in any market with real data-protection law requiring either | Legal/compliance owner — Decision 245 did a technical-design scoping pass only (13 Oct 2026), not a program; see "A tracking gap" below |

Resolved since this table last needed a full pass — kept here as a record of what
used to block something, not restated as still-open: Guardian consent-management
UI (**Decision 236** — Track B's candidate screen approved and built, with step-up
re-auth gating BASELINE withdrawal); `TimetableSlot` ↔ `Class` (**Decision 210** —
the daily occurrence-generation job already materializes real `Class` rows from
each `TimetableSlot`, so there was no remaining data-model question, only a missing
lookup endpoint — Timetable's real click-to-book UI shipped on that basis).
`SubscriptionPlansModule`'s billing-direction citation conflict and the QR
mechanism/roll-call-mechanics rows this table used to carry are resolved — Decision
106 (merged via PR #71) and Decision 107 (Phase 51, merged via PR #72) respectively;
see Track A item 1 and the "Done" summary in §1 above. Branch's field-level settings
screen (Decision 76) is resolved too, shipped in Phase 53 (merged via PR #74).
`SubscriptionPlansModule` itself shipped too, end to end (Phase 54 backend, merged
via PR #75; Phase 55 `apps/platform-admin` authoring UI, PR #76) — only its
`whiteLabelApp` entitlement remains, still genuinely blocked by the Apple row above.
General tenant/content offboarding's own policy question is resolved too (**Decision
110** — soft-archive, 90-day retention, gated behind an explicit close-account
action), and now extended to 7 more entities (**Decision 226**, PR #238) — see
Track A item 2/4. Late-cancellation fee collection is resolved too (**Decision
234**) — moved out of "Real but narrower" below.
Decisions 108 (Instructor rank V1/V2, PR #61) and 109 (Transaction Student-name
resolution, PR #61 — still awaiting Architect confirmation) are also recorded; see
Track A item 7. Decision 55's own dispute-handling contract — previously modeled in
the schema with zero code behind it — is built too (Decision 111 Phase A, merged to
master), and so is Decision 68's own `chargeback-pattern-restriction` job (Decision
112 Phase B, merged to master); see §1's "Done" summary.

### Real but narrower — worth a decision, doesn't block a whole feature
- RoleGrant authority matrix only covers the narrowest case (Decision 80/81) — every
  other grantor/role combination is flatly rejected pending a decision.
- Stripe Connect onboarding verified for UAE only (Decision 86) — other regions
  unverified.
- Non-camera check-in alternative for consent-withdrawn/accessibility-need Students —
  flagged as a product opportunity, not designed.
- Multi-Guardian consent interaction (Decision 92) not formally settled.
- ~~Franchise lifecycle edges: reaffiliation/billing-continuity on leaving a Franchise
  (Decision 97)~~ — **resolved and built (Decision 232, 14 Oct 2026).** The policy
  question Decision 97 deferred to project completion was answered directly with the
  product owner: `PaymentAccount`/`MembershipPlan` carry over unchanged (neither has a
  Franchise linkage to sever), `FranchiseFeeCharge` history is retained immutably, and
  the one real reconciliation point — the live Stripe franchise-fee subscription — is
  cancelled on leaving and recreated lazily against the new Franchise (or left null if
  the School goes independent). The leave/switch feature itself (`POST
  /schools/:id/leave-franchise`, re-join via the existing `join-franchise` endpoint) is
  genuinely merged to `master` (PR #196), full-stack including the School Portal's
  Franchise Affiliation card. This line previously said "deferred to project
  completion" and "explicitly open" — stale as of this session; confirmed directly
  against `master`, not just the decision log. Franchise-side approval (an open half of
  Decision 98) is still genuinely unresolved — joining/leaving stays fully self-service,
  no Franchise-side consent step exists.
- Fee-rate-change migration mechanics (Decision 99's own remaining gap: changing a
  Franchise's rate after franchise-fee billing has already started for at least one
  member School) — **built** (`FranchiseFeeRateMigrationProcessor`, `MIGRATE_NEXT_CYCLE`/
  `MIGRATE_IMMEDIATE` strategies, Decision 260), but sitting on an unmerged branch
  (`feature/franchise-fee-rate-migration`, PR #250) — genuinely open until that PR
  merges, not accidentally missed.
- `ultm8-tenant-isolation` SKILL.md hasn't been updated to reflect Decisions 89/92/93/94
  — an Architect documentation task flagged by Decision 94 itself.

### A tracking gap, not a technical one
- **Data residency / GDPR & LGPD compliance across markets** — named explicitly in the
  original spec handover's own open-items list (`deep-review/.../START HERE.md`).
  **No longer undocumented** — **Decision 245** (12 Oct 2026) gave it a real
  decision-log entry, but only a technical-design scoping pass (anonymize-in-place
  vs. hard-delete for erasure; single-region vs. region-per-tenant for residency),
  explicitly not legal advice and nothing built. Still genuinely open: a real
  program with an actual owner, and legal counsel's review of the actual
  retention/residency requirements before any of Decision 245's options get built.
- **Per-user GDPR/LGPD "erase my data" requests**, specifically — Decision 110
  (general tenant/content offboarding) deliberately scoped this out as its own
  separate question: a different trigger (an erasure/DSAR request, not a School
  closing), a different legal mechanism (GDPR Art 17 and its own retention
  exceptions), and a different technical shape (one person's rows, not a whole
  School/Franchise). Still genuinely undecided, not just undocumented.

### Confirmed as deliberately parked, not open
- `apps/platform-admin` general tenant-data edit UI (Decision 105 — no named use case).
- Trial-reissuance/account-recreation loophole (`ultm8-domain-rules` §7) — permanently,
  deliberately left open by design, not a bug to fix.

---

## 5. Prioritized path to completion

Grouped into workstreams, roughly ordered by what unblocks the most other work per
unit of effort. Not a committed schedule — a structure to work through.

**A. Finish what's already in flight (near-zero net-new work)**
1. ~~Merge PR #73 (Track A Phase 52)~~ — done, merged.

**B. Decision/reconciliation pass (no code — needs a person's answer, unblocks real work once done)**
2. ~~`SubscriptionPlansModule` citation reconciliation~~ — done (Decision 106, merged
   via PR #71; Track A item 1).
3. ~~Tenant/content offboarding policy — what does "delete" mean per entity?~~ —
   done (**Decision 110**): soft-archive immediately, hard-delete after a 90-day
   retention window, triggered only by an explicit close-account action (never
   subscription cancellation alone), scoped to School/Franchise-level only
   (GDPR/LGPD per-user erasure stays separate, §4). See item 9 below for the
   actual build work this unblocks.
4. ~~Apple 4.2.6/4.3 compliance question~~ — the policy (Decision 247) and the
   School-selection UX it left open (Decision 266, 15 Oct 2026: join code +
   search, picked before signup) are both resolved and built. What those
   decisions unblock — `MobileAppPublishingModule` across both tracks AND
   `SubscriptionPlansModule`'s own deferred `whiteLabelApp` entitlement
   (Phase 54) — is still fully unbuilt itself, just no longer blocked on a
   Product decision.
5. ~~Guardian consent UI — "which app owns this" call~~ — resolved and now fully
   built too (Decision 236) — see item 10 below.

**C. Track B integration (buildable today, growing more expensive to defer)**
6. ~~Sync onto master, resolve the Decision 98 conflict, fix CI env drift, open a
   PR, merge it~~ — done, see §2's "Historical integration record." PR #81 merged.
7. ~~Add test coverage~~ — done: `apps/student` has a real `jest` script and 19 test
   files (verified 13 Oct 2026, directly contradicting this item's own long-standing
   "still open" status).

**D. Unblocked build work once B lands**
8. ~~`SubscriptionPlansModule`~~ — **fully shipped (Phase 54 backend, merged via
   PR #75; Phase 55 `apps/platform-admin` authoring UI, PR #76)**: Plan CRUD,
   subscribe/cancel, `PlatformCharge`, degraded-portal gate, and the admin authoring
   screen. Left: only the `whiteLabelApp` entitlement (still gated on item 4's Apple
   compliance decision).
9. ~~Tenant/content offboarding endpoints + UI~~ — **done end to end (Phase 56 +
   Phase 57, PR #77)**: the close-account/reactivate action for School and
   Franchise, the archived-gate wired into all 10 named entity services (School,
   Branch, Class, Timetable, Instructor, Membership, Rank, Waiver, Franchise,
   Curriculum), the daily 90-day purge job, and the `apps/platform-admin`
   close/reactivate UI itself (`TenantLifecycleControls`, on both
   `SchoolLookupPage` and `FranchiseLookupPage`). `Waiver`'s own retention period
   still needs real legal input before its rows are ever purged — the job leaves
   them (and the School that owns them) untouched pending that, per Decision
   110's own flagged exception. **Extended to 7 more entities** (Branch, Class,
   TimetableSlot, Instructor, Rank, Waiver, Lesson) by **Decision 226** (PR #238,
   merged 13 Oct 2026) — a School-Owner-usable archive/delete action, not gated
   behind closing the whole School. The original "9 of the 16" framing this item
   used to carry was wrong on every count (Decisions 253/261): Membership,
   Transaction, and PaymentAccount are confirmed never-deletable (same reasoning
   as Waiver), and Booking/RoleGrant already had real cancel/revoke mechanisms
   all along.
10. ~~Guardian consent UI~~ — done (Decision 236): approved and built, with BASELINE
    withdrawal gated behind step-up re-authentication.
11. ~~Track B Waiver signing + Guardian screens~~ — done: drawn-signature capture
    and the Guardian consent/step-up flow above.
12. ~~Track B Slice 4b (Stripe payment UI)~~ — done (Decisions 238/243): hosted
    Checkout, both fresh-card and saved-card, resolved without the native
    dev-client workflow this item used to assume was needed.

**E. Infrastructure & deployment buildout** (can start in parallel with B–D; only the
final provisioning step needs the product owner directly)
13. Dockerfile for `apps/api`.
14. IaC for the confirmed AWS stack (RDS, ElastiCache, Fargate, Cognito, Secrets
    Manager, RDS Proxy) — codeable now, applying it needs real AWS credentials.
15. A real CD pipeline once a deploy target exists to point it at.
16. Backup/DR strategy, error-tracking/APM, numeric NFR targets — none of these are
    blocked on anything; they're simply not started.

**F. White-label tier** (fully blocked on B.4 — do not start before)
17. `MobileAppPublishingModule` + `packages/build-pipeline` real implementation.
18. Track A/B branding UI.
19. `SubscriptionPlansModule`'s own deferred `whiteLabelApp` metered entitlement
    (Phase 54's own scope explicitly excluded this — see item 8).

**G. Compliance program**
20. ~~Formalize the GDPR/LGPD data-residency tracking gap into a real decision-log entry~~
    — done (Decision 245, 12 Oct 2026): a technical-design scoping pass (anonymize-in-place
    vs. hard-delete for erasure, single-region vs. region-per-tenant for residency),
    explicitly not legal advice and not yet built. Still needs: a real program with an
    actual owner, and legal counsel's review of the real retention/residency requirements
    before any of Decision 245's options are implemented.

---

## 6. Keeping this tracked going forward

This repo already has a working, low-overhead tracking convention — a living markdown
roadmap per track plus an append-only decision log — proven across 55 Track A phases.
The recommendation is to extend that pattern rather than introduce a heavier one
(e.g. a GitHub Projects board) unless the team specifically wants that overhead:

- **This doc** is the cross-track entry point — update its Snapshot table and §5
  priority list whenever a phase lands on any track, or whenever a decision resolves
  or reopens an item in §4.
- **`docs/TRACK-A-ROADMAP.md`** / **`docs/TRACK-B-ROADMAP.md`** stay the per-track
  detail — update the relevant one whenever a phase ships on that track (same
  discipline this session already used for Track A through Phase 50).
- **`docs/decisions/POST-SPEC-55-DECISION-LOG.md`** stays the one place a real
  product/Architect decision gets recorded — never inferred or assumed elsewhere. Any
  item in §4 above that gets resolved should get a numbered entry here, continuing the
  sequence from 111.
- **Before starting work matching any `[UNRESOLVED]` item**, load
  `skills/ultm8-domain-rules/SKILL.md` fresh rather than trusting a roadmap doc's
  characterization of it — this synthesis itself found and fixed one real case
  (`SubscriptionPlansModule`, Decision 106): a roadmap doc and two code comments had
  drifted out of sync with the skill file's own current text, for weeks, undetected,
  until this cross-track audit specifically went looking. Roadmap docs describe
  state; they can go stale. The skill file and decision log are the two sources meant
  to stay current — trust them over a roadmap doc's own characterization when they
  disagree.
- **Track B specifically** needs a merge/sync cadence, not a permanent parallel
  branch — the longer it runs unsynced, the more expensive reconciliation gets (it's
  already gone from "60+ commits behind" to "69 commits / 34 phases behind" between
  this doc's source audit being written and finalized).
