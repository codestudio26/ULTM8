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
authoring UI (PR #76, open, pushed and green, awaiting review) — the module is now
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
runtime, Franchise's did not). Both phases are on the same still-open PR #77. See
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
Not yet merged. Test coverage (still zero) remains explicitly open, scoped out of the
sync PR on purpose — see §2's own "Recommended next actions."

---

## Snapshot

| Track | State |
|---|---|
| **Track A** — backend + school-portal + platform-admin | 57 phases shipped, all merged to master — no Track A PRs open (PR #76, Phase 55, and PR #77, Decision 110 + Phase 56 + Phase 57, both merged). Decision 111/112 (Stripe dispute handling + chargeback-pattern-restriction) already merged to master. 1 confirmed-scope module still fully unbuilt (`MobileAppPublishingModule`, genuinely blocked). `SubscriptionPlansModule` fully shipped (Phase 54 backend + Phase 55 admin UI, PR #76); only its `whiteLabelApp` entitlement remains, blocked on Apple compliance. General tenant/content offboarding is now built end to end, both backend (Phase 56) and its `apps/platform-admin` close/reactivate UI (Phase 57) — only `Waiver`'s own retention period remains open. Guardian consent UI remains the one designed-but-unscreened gap. Also shipped outside the Phase-N sequence: a design-system refresh + Transaction Student-name resolution (PR #61, Decisions 108/109), the infra Dockerfile/Terraform/CD-pipeline skeleton, and a shared `packages/ui` mobile-nav/table-overflow fix (PR #31). |
| **Track B** — Student mobile app | Synced onto current master and PR'd (see §2) — was 19 commits behind on an unmerged branch, never PR'd, 79 master commits behind at sync time. Zero test coverage (still true, unchanged). Foundation/Booking/Notifications(read)/Rank(read)/Membership(non-Stripe)/Guardian-consent-candidate/light offline caching built and verified; Payment UI, Waiver signing (client), full Guardian screens, QR scanning, white-label, and richer offline are still unbuilt. |
| **Infrastructure & deployment** | AWS (RDS/ElastiCache/Fargate) + GitHub Actions is the *decided* target (Spec §11.6). First-pass Dockerfile, Terraform for the full confirmed stack, a manual/gated CD pipeline skeleton, and backup/DR + APM + NFR-gap docs now exist (`apps/api/Dockerfile`, `infra/terraform/`, `.github/workflows/deploy.yml`, `docs/ops/`) — **still nothing is provisioned or running**: no AWS account/credentials exist in this environment, `terraform apply` has never been run, and CI remains test-only (deploy is manual-dispatch only, by design). |
| **Open decisions** | 44 post-spec decisions logged (Decisions 108/109: Instructor rank V1/V2 dropdown, Transaction Student-name resolution; Decision 110: general tenant/content offboarding policy; Decision 111: dispute-handling scope split into Phase A/B, chargeback threshold set at 2 lost disputes; Decision 112: Phase B's own implementation design; Decision 113: Track B's Expo/secure-token-storage choice, renumbered from a colliding "Decision 98" at sync time), most resolved but several carry real open follow-ups (86 non-UAE Stripe, 92 multi-Guardian consent, 94 discovery-role precedent, 97/98/99 Franchise lifecycle edges, 109 itself awaiting Architect confirmation, 110's own `Waiver`-retention piece pending legal input). Decision 76's Branch-UI gap was closed by Phase 53. `SubscriptionPlansModule`'s stale blocker citation is reconciled (Decision 106, merged via PR #71) and its backend core shipped on that strength (Phase 54, merged via PR #75). GDPR/LGPD data-residency and per-user erasure (both distinct from, and explicitly out of scope for, Decision 110's own School/Franchise-level offboarding) remain their own tracking gap — still not carried into any decision-log entry. |

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
3. **Guardian consent-management UI** — no screen exists for a Guardian to view or
   withdraw consent (`ultm8-domain-rules` §14). Blocks launch in any market with
   children's-data-protection law. Needs a decision on which app owns it (School
   Portal? A future Guardian-facing surface in Track B?) plus a design pass.
4. **`MobileAppPublishingModule` + `packages/build-pipeline`** — blocked on the Apple
   4.2.6/4.3 template-farm compliance question (see §4 below — shared blocker with
   Track B's own Phase 6). Its white-label metered-billing rate is also unfinalized —
   this now also gates `SubscriptionPlansModule`'s own deferred `whiteLabelApp`
   entitlement (Phase 54), not just Track B/Track A's own publishing pipeline.
   (`SubscriptionPlansModule`'s own `apps/platform-admin` authoring UI shipped in
   Phase 55 — backend-then-UI split, same convention Translations/Curriculum already
   used. `whiteLabelApp` is the only piece of this module still blocked.)
5. Parked, not blocking anything: `apps/platform-admin` general tenant-data edit UI
   (Decision 105 — deliberately not built pending a named use case) and its home
   dashboard (cosmetic).
6. **Decision 109 confirmation** — Transaction Student-name resolution (PR #61) was
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

Full detail: `docs/TRACK-B-ROADMAP.md` on `origin/track-b-student-app` (not in this
checkout — see note at top of this doc).

**The roadmap doc itself is trustworthy** — a full audit found no case of it
overclaiming finished work; everything it says is built, is. The problem is currency
and integration, not honesty.

**Done, verified against real code:** Expo/RN foundation (Auth flows, navigation),
class booking + waitlist (with a documented 409→waitlist state machine), Notifications
(read-side only — no push/device-token registration, deliberately cut mid-slice),
Rank/Grading (read-only, embedded in Academy Detail), Membership purchase for
Cash/Bank and free plans (not Stripe).

**Explicitly NOT built, matching the doc's own "blocked" list exactly:**
- **Stripe/PaymentSheet purchase UI** — researched only, no code, correctly framed as
  waiting on a user/product decision on approach.
- **Waiver signing + Guardian-facing screens** — blocked on a design pass that's never
  happened. Partially unblocked on the backend side since the doc was last updated:
  master's Phase 34 (drawn-signature capture) and Phases 37–42 (Guardian-on-behalf-of
  flows) shipped after Track B's fork point — but that's backend-only; the client UI
  and design work are still the actual blocker.
- **QR check-in scanning UI** — the backend root cause named when this doc was first
  written (no rotating-token mechanism existed anywhere) is now resolved: Track A
  Phase 51 (Decision 107, merged via PR #72) shipped `GET /attendance/my-qr-token`
  for a Student to mint their own rotating personal token, and
  `POST /classes/{id}/attendance-scan` for an Instructor to scan it; Phase 52
  (merged via PR #73) shipped the School Portal's own display screen. What blocks
  Track B now is purely client-side — no screen in
  `apps/student` yet displays or scans a QR code — the same "buildable today, not yet
  built" shape as the rest of this list.
- **Per-School white-label branding** — blocked on the same Apple compliance question
  and `packages/build-pipeline` placeholder as Track A item 4.
- **Offline behavior/caching** — not even scoped; no requirements exist yet.

**Gaps the doc does NOT disclose, found on direct audit:**
- **Zero automated test coverage** — no test files, no `test` script in
  `apps/student/package.json`. Every other gap in the doc is explicitly flagged;
  this one isn't.
- **Track B's own CI config has drifted from master's** — missing the
  `DATABASE_URL_PLATFORM_ADMIN`, `PLATFORM_ADMIN_JWT_SECRET`, and R2 env vars master's
  CI added for Phase 25/26 and Phase 34. If tested today, the branch's copy of
  `apps/api` would fail to boot in CI purely from environment staleness.

**Integration status — updated 2026-09-23, no longer the headline finding it was:**
- **A sync PR is now open** — `track-b-student-app` (19 commits, fork point `f71b481`
  / Phase 16a, 79 master commits behind by the time of the sync) merged onto current
  master in a new branch, CI-verified before opening: `apps/api` and `apps/student`
  both typecheck clean, the full 30-suite/327-test e2e gate passes against real
  Postgres+Redis, and `turbo run build` is clean across all 8 packages. Not yet
  merged — see the PR for current status.
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
   see "Integration status" above; PR open, not yet merged.
2. ~~Fix Track B's CI env-var drift~~ — turned out to be API-contract drift, not
   env-var drift (ci.yml's `build-and-unit-test` job already runs `turbo run build`
   generically, no apps/student-specific job was ever needed); the 3 real call-site
   breakages found are fixed, see above.
3. ~~Open a real PR~~ — done, same PR as #1.
4. Add a `test` script and at least smoke-level coverage before the next slice, so this
   gap doesn't compound further. **Still open** — not attempted in the sync PR, which
   scoped itself to getting Track B mergeable and green, not to writing its first
   tests from zero.
5. Only then: pick up Slice 4b (Stripe UI, needs a product decision on approach first)
   or re-attempt Waiver/Guardian screens now that more of their backend exists.

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
  and blocked on the same Apple compliance decision as Track A item 4 / Track B's
  Phase 6. Unchanged by this infra phase.

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
| Apple 4.2.6/4.3 template-farm compliance risk | `MobileAppPublishingModule`, `packages/build-pipeline`, Track A item 4, Track B Phase 6, `SubscriptionPlansModule`'s own deferred `whiteLabelApp` entitlement (Phase 54) — the entire branded-app tier | Product/legal |
| Guardian consent-management UI (no screen anywhere) | Any market with children's-data-protection law; Track B's "Guardian-facing screens" slice | Design + a decision on which app owns it |

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
action) and no longer belongs in this table; see Track A item 2. What that row used
to also gesture at — GDPR/LGPD erasure — was never actually resolved by it and stays
its own open item, now tracked explicitly under "A tracking gap, not a technical
one" below rather than folded into the offboarding row.
Decisions 108 (Instructor rank V1/V2, PR #61) and 109 (Transaction Student-name
resolution, PR #61 — still awaiting Architect confirmation) are also recorded; see
Track A item 6. Decision 55's own dispute-handling contract — previously modeled in
the schema with zero code behind it — is built too (Decision 111 Phase A, merged to
master), and so is Decision 68's own `chargeback-pattern-restriction` job (Decision
112 Phase B, merged to master); see §1's "Done" summary.

### Real but narrower — worth a decision, doesn't block a whole feature
- Late-cancellation fee **collection** mechanism unanswered (distinct from the
  already-resolved refund/credit mechanism).
- RoleGrant authority matrix only covers the narrowest case (Decision 80/81) — every
  other grantor/role combination is flatly rejected pending a decision.
- Stripe Connect onboarding verified for UAE only (Decision 86) — other regions
  unverified.
- Non-camera check-in alternative for consent-withdrawn/accessibility-need Students —
  flagged as a product opportunity, not designed.
- Multi-Guardian consent interaction (Decision 92) not formally settled.
- Franchise lifecycle edges: reaffiliation/billing-continuity on leaving a Franchise
  (Decision 97, deliberately deferred to project completion by direct product-owner
  instruction), leave/switch-Franchise path and Franchise-side approval (Decision 98),
  fee-rate-change migration mechanics (Decision 99) — all explicitly open, not
  accidentally missed.
- `ultm8-tenant-isolation` SKILL.md hasn't been updated to reflect Decisions 89/92/93/94
  — an Architect documentation task flagged by Decision 94 itself.

### A tracking gap, not a technical one
- **Data residency / GDPR & LGPD compliance across markets** — named explicitly in the
  original spec handover's own open-items list (`deep-review/.../START HERE.md`), but
  has **no corresponding entry anywhere** in the domain-rules skill, any other skill,
  or the decision log. This appears to have fallen out of the post-Spec-55 tracking
  process entirely rather than being resolved or deliberately parked. Worth its own
  decision-log entry the next time anyone touches compliance scope, if only to record
  "still open" formally instead of leaving it undiscoverable.
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
4. Apple 4.2.6/4.3 compliance question — unblocks `MobileAppPublishingModule` across
   both tracks AND `SubscriptionPlansModule`'s own deferred `whiteLabelApp`
   entitlement (Phase 54) — 3 things now, not 2.
5. Guardian consent UI — needs both a design pass and an "which app owns this" call.

**C. Track B integration (buildable today, growing more expensive to defer)**
6. ~~Sync onto master, resolve the Decision 98 conflict, fix CI env drift, open a
   PR~~ — done, see §2's "Integration status." PR open, not yet merged.
7. Add test coverage. **Still open.**

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
   110's own flagged exception.
10. Guardian consent UI (once designed) — likely spans both a School Portal or new
    surface AND Track B.
11. Track B Waiver signing + Guardian screens (backend already mostly there).
12. Track B Slice 4b (Stripe payment UI) — needs its own product decision on approach
    first, independent of the items above.

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
20. Formalize the GDPR/LGPD data-residency tracking gap into a real decision-log entry
    and, eventually, an actual program — currently has no owner anywhere.

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
