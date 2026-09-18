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
  (Decisions 70–105 as of this writing). This doc cites decisions by number; it does
  not restate their reasoning.
- `skills/ultm8-domain-rules/SKILL.md` — the canonical, tagged distillation of Spec
  55's business rules (`[CONFIRMED]` / `[UNRESOLVED]` / etc.). Where this doc and that
  skill disagree, **the skill file wins** (`CLAUDE.md`'s own source-of-truth hierarchy)
  — flagged explicitly below wherever that's live (see the `SubscriptionPlansModule`
  item).

Same standing rules as everywhere else in this repo: only `[CONFIRMED]` items are safe
to build against; an `[UNRESOLVED]` item is a stop-and-escalate, not a guess; load
`skills/ultm8-domain-rules/SKILL.md` before any domain-rule work; never invent
unspecified business logic.

Last synthesized: 2026-09-18, from a full audit of Track A (this session's own direct
knowledge), Track B (`origin/track-b-student-app` HEAD `b34bb97`), infrastructure/CI/CD
(`master` HEAD `bbf0198`), and every `[UNRESOLVED]` item + decision-log entry.

---

## Snapshot

| Track | State |
|---|---|
| **Track A** — backend + school-portal + platform-admin | 54 phases shipped or in flight. PR #71 (Decision 106) and PR #73 (Phase 52 QR-display screen) open, both green; PR #75 (Phase 54, `SubscriptionPlansModule` backend core) also open and green. `MobileAppPublishingModule` is now the only confirmed-scope module still fully unbuilt. Remaining designed-but-unscreened UI gap: Guardian consent. |
| **Track B** — Student mobile app | 10 commits on an unmerged branch, never PR'd, **34 phases behind master**. Zero test coverage. Foundation/Booking/Notifications(read)/Rank(read)/Membership(non-Stripe) built and verified; Payment UI, Waiver signing, Guardian screens, QR scanning, white-label, and offline are all still unbuilt. |
| **Infrastructure & deployment** | AWS (RDS/ElastiCache/Fargate) + GitHub Actions is the *decided* target (Spec §11.6) — **nothing is provisioned**. CI is real but test-only; no CD, no Dockerfile, no IaC, no backup/DR plan, no APM/error-tracking, no numeric NFR targets. |
| **Open decisions** | 37 post-spec decisions logged, most resolved but several carry real open follow-ups (86 non-UAE Stripe, 92 multi-Guardian consent, 94 discovery-role precedent, 97/98/99 Franchise lifecycle edges). Decision 71's attendance-mechanics gap was closed by Decision 107 (Phase 51); Decision 76's Branch-UI gap was closed by Phase 53. `SubscriptionPlansModule`'s stale blocker citation is reconciled (Decision 106, PR #71, unmerged) and its backend core already built on that strength (Phase 54, PR #75, unmerged). One tracking gap found (GDPR/data-residency named in the original spec handover, never carried into any living doc). |

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
notifications, `CurriculumModule`, `TranslationsModule` (Phase 49 backend merged,
Phase 50 UI in PR #68), the QR check-in redesign + Instructor roll-call scan (Phase
51, Decision 107 — merged via PR #72) plus its `apps/school-portal` QR-display
screen (Phase 52, PR #73, still open — was stacked on Phase 51; base moves to
`master` now that Phase 51 has merged), Branch field-level settings UI (Phase 53,
merged via PR #74 — turned out to be a small gap: the screen has existed since
Phase 3, only Decision 76's branding fields were missing), `apps/school-portal`
full admin surface, `apps/platform-admin` through Translations authoring including
Cognito auth, audit logging, cross-tenant read/write for Schools/Franchises/
PaymentAccounts/AdminUsers, Stripe credential rotation, and read-only Support
impersonation (with its RLS-scope hardening).

**Left, in priority order:**

1. **Merge PR #71** (Decision 106) and **PR #73** (Phase 52) — neither is blocked,
   both green. **PR #75** (Phase 54, `SubscriptionPlansModule` backend core) is also
   open and green, independent of the others.
2. **`SubscriptionPlansModule` blocker citation** — reconciled: Decision 106 (**PR
   #71, unmerged**) traced the question to source across three independent primary
   sources and found it was resolved before Phase 0 started; this doc, the old Track
   A roadmap, and two code comments had simply never caught up with the skill file's
   own already-`[CONFIRMED]` text. Phase 54 (**PR #75, unmerged**) already scaffolded
   the module's backend core on the strength of that reconciliation. What's left is
   just merging both PRs, not an open Architect question.
   **Update, Phase 53**: checked whether this same drift recurred for Branch
   (Decision 76) — it hadn't. The repo's actual `ultm8-domain-rules` SKILL.md
   already carries Branch's field list as `[CONFIRMED]`, citing Decision 76
   directly (a first pass at this checked a stale cached copy instead of the
   real file and wrongly concluded otherwise — caught before committing). The
   skill's neighboring `[UNRESOLVED]` line on the Branch *screen* specifically
   is genuinely now outdated by Phase 53 shipping it, and worth a small Architect
   update to match — a much narrower finding than first thought.
3. **General tenant/content offboarding** — no `DELETE` endpoint exists anywhere
   (School, Branch, Class, Timetable, Instructor, Membership, Rank, Waiver, Franchise,
   Curriculum). Unspecified in Spec 55; the same flagged comment recurs across ~15
   files. Needs a product/legal decision on what "offboarding" means per entity before
   any of it gets built. This is the single largest *specified-gap-shaped* hole in the
   platform — nothing about account closure or GDPR/LGPD erasure works today.
4. **Guardian consent-management UI** — no screen exists for a Guardian to view or
   withdraw consent (`ultm8-domain-rules` §14). Blocks launch in any market with
   children's-data-protection law. Needs a decision on which app owns it (School
   Portal? A future Guardian-facing surface in Track B?) plus a design pass.
5. **`MobileAppPublishingModule` + `packages/build-pipeline`** — blocked on the Apple
   4.2.6/4.3 template-farm compliance question (see §4 below — shared blocker with
   Track B's own Phase 6). Its white-label metered-billing rate is also unfinalized.
6. Parked, not blocking anything: `apps/platform-admin` general tenant-data edit UI
   (Decision 105 — deliberately not built pending a named use case) and its home
   dashboard (cosmetic).

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
  `POST /classes/{id}/attendance-scan` for an Instructor to scan it; Phase 52 (PR
  #73, unmerged) shipped the School Portal's own display screen. What blocks Track
  B now is purely client-side — no screen in
  `apps/student` yet displays or scans a QR code — the same "buildable today, not yet
  built" shape as the rest of this list.
- **Per-School white-label branding** — blocked on the same Apple compliance question
  and `packages/build-pipeline` placeholder as Track A item 5.
- **Offline behavior/caching** — not even scoped; no requirements exist yet.

**Gaps the doc does NOT disclose, found on direct audit:**
- **Zero automated test coverage** — no test files, no `test` script in
  `apps/student/package.json`. Every other gap in the doc is explicitly flagged;
  this one isn't.
- **Track B's own CI config has drifted from master's** — missing the
  `DATABASE_URL_PLATFORM_ADMIN`, `PLATFORM_ADMIN_JWT_SECRET`, and R2 env vars master's
  CI added for Phase 25/26 and Phase 34. If tested today, the branch's copy of
  `apps/api` would fail to boot in CI purely from environment staleness.

**Integration status — the real headline finding:**
- **No PR has ever been opened for `track-b-student-app`.** It has never been proposed
  for merge, never had CI run against it as a unit, and is invisible from `master`'s
  own `docs/` folder (which has Track A's roadmap but no Track B one).
- **34 phases / 69 commits behind master** (fork point `f71b481`, Phase 16a) and
  growing every day both tracks run in parallel without syncing.
- **A guaranteed merge conflict is already sitting there**: both branches independently
  added an unrelated "Decision 98" to `docs/decisions/POST-SPEC-55-DECISION-LOG.md`
  with completely different content (master: School→Franchise linking; track-b: Track
  B's own Slice 1 kickoff). Whoever merges this has to resolve and renumber by hand.

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
1. Sync Track B onto current master (69 commits / 34 phases), resolving the Decision 98
   conflict by hand (renumber one of the two entries).
2. Fix Track B's CI env-var drift so the isolation gate can actually run.
3. Open a real PR — even a draft one — so this track gets a review trail and stops
   being invisible from master.
4. Add a `test` script and at least smoke-level coverage before the next slice, so this
   gap doesn't compound further.
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

### Decided, zero provisioning (the largest category)
Every one of these has a real, named decision behind it (cited) but **no Dockerfile,
Terraform/CDK, live account, or credentials exist anywhere in this environment**:

| Target | Decision | Provisioned? |
|---|---|---|
| AWS RDS + ElastiCache + ECS Fargate hosting | Spec §11.6, Decision 11 | No |
| AWS Secrets Manager | Spec §11.6, `ultm8-payments` §1 | No |
| AWS Cognito (Platform Admin IdP) | Decision 100 | No |
| RDS Proxy (connection pooling) | Decision 63 | No — not implemented in code either |
| Cloudflare Stream + AWS Transcribe (video) | Decision 101 | No — schema fields exist, unused |
| CloudWatch (job-queue observability) | Decision 53 | Partially — a logging *rule* is designed, no CloudWatch integration exists |

### Genuine gaps — no decision found at all
- **CD/deploy pipeline** — nothing, not even a stub.
- **Dockerfile / container build definition** — none exist, including for `apps/api`,
  despite Fargate being the confirmed deploy target.
- **Any IaC tool** (Terraform/Pulumi/CDK/CloudFormation/Kubernetes) — none.
- **Database backup/DR strategy, point-in-time recovery, read replicas** — not
  mentioned anywhere, not even at the decision-log level.
- **Error-tracking/APM** (Sentry, Datadog, or equivalent) — none; only NestJS's
  built-in `Logger`.
- **Numeric NFR targets** (uptime/SLA, p95 latency, concurrent-user budgets) — none
  found anywhere in the repo.
- **Formal compliance program** (SOC 2, PCI DSS attestation beyond the SAQ-A design
  target, GDPR/LGPD data-residency program) — see the dedicated finding below.
- **`packages/build-pipeline`** — confirmed, explicit placeholder (its own `build`
  script literally echoes "placeholder"). Not a disguised gap — it's honestly labeled
  and blocked on the same Apple compliance decision as Track A item 5 / Track B's
  Phase 6.

### What CAN start now, without waiting on AWS provisioning
Writing a Dockerfile for `apps/api` and a first pass of Terraform/CDK for the
RDS/ElastiCache/Fargate/Cognito/Secrets-Manager stack doesn't require live AWS
credentials to draft and review — same as every other "confirmed target, not yet
built" item in this codebase. What genuinely can't proceed without the product owner
is the actual `terraform apply`/account provisioning step. Worth splitting this
workstream into "code that can be written now" vs. "steps that need a real AWS
account handed over."

---

## 4. Open decisions & unresolved items — cross-track view

This is a consolidated view of `skills/ultm8-domain-rules/SKILL.md`'s `[UNRESOLVED]`
tags and `docs/decisions/POST-SPEC-55-DECISION-LOG.md`'s open follow-ups, organized by
what they actually block. Full detail (all 36 decisions, all `[UNRESOLVED]` citations)
is preserved in this synthesis's source audit; this section keeps only what's
load-bearing for planning.

### Blocks a whole module or UI surface
| Item | Blocks | Owner needed |
|---|---|---|
| Apple 4.2.6/4.3 template-farm compliance risk | `MobileAppPublishingModule`, `packages/build-pipeline`, Track A item 5, Track B Phase 6 — the entire branded-app tier | Product/legal |
| Guardian consent-management UI (no screen anywhere) | Any market with children's-data-protection law; Track B's "Guardian-facing screens" slice | Design + a decision on which app owns it |
| General tenant/content offboarding (unspecified in spec) | Any account-closure or GDPR/LGPD erasure flow, ~15 files' worth of missing `DELETE` endpoints | Product/legal |

`SubscriptionPlansModule`'s billing-direction citation conflict and the QR
mechanism/roll-call-mechanics rows this table used to carry are resolved — Decision
106 (PR #71) and Decision 107 (Phase 51, merged via PR #72) respectively; see Track A
item 2 and the "Done" summary in §1 above. Branch's field-level settings screen
(Decision 76) is resolved too, shipped in Phase 53 (merged via PR #74).

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

### Confirmed as deliberately parked, not open
- `apps/platform-admin` general tenant-data edit UI (Decision 105 — no named use case).
- Trial-reissuance/account-recreation loophole (`ultm8-domain-rules` §7) — permanently,
  deliberately left open by design, not a bug to fix.

---

## 5. Prioritized path to completion

Grouped into workstreams, roughly ordered by what unblocks the most other work per
unit of effort. Not a committed schedule — a structure to work through.

**A. Finish what's already in flight (near-zero net-new work)**
1. Merge PR #71 (Decision 106), PR #73 (Track A Phase 52), and PR #75 (Track A Phase
   54 — `SubscriptionPlansModule` backend core) — none blocked, all green.

**B. Decision/reconciliation pass (no code — needs a person's answer, unblocks real work once done)**
2. ~~`SubscriptionPlansModule` citation reconciliation~~ — done (Decision 106, PR #71,
   unmerged; Track A item 2).
3. Tenant/content offboarding policy — what does "delete" mean per entity?
4. Apple 4.2.6/4.3 compliance question — unblocks 2 modules across both tracks at once.
5. Guardian consent UI — needs both a design pass and an "which app owns this" call.

**C. Track B integration (buildable today, growing more expensive to defer)**
6. Sync onto master, resolve the Decision 98 conflict, fix CI env drift, open a PR.
7. Add test coverage.

**D. Unblocked build work once B lands**
8. ~~`SubscriptionPlansModule`~~ — done (backend core, Phase 54, PR #75, unmerged).
9. Tenant/content offboarding endpoints (once policy is decided).
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

**G. Compliance program**
19. Formalize the GDPR/LGPD data-residency tracking gap into a real decision-log entry
    and, eventually, an actual program — currently has no owner anywhere.

---

## 6. Keeping this tracked going forward

This repo already has a working, low-overhead tracking convention — a living markdown
roadmap per track plus an append-only decision log — proven across 50 Track A phases.
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
  sequence from 106.
- **Before starting work matching any `[UNRESOLVED]` item**, load
  `skills/ultm8-domain-rules/SKILL.md` fresh rather than trusting a roadmap doc's
  characterization of it — this synthesis itself found one case (§4,
  `SubscriptionPlansModule`) where a roadmap doc and code comments had drifted out of
  sync with the skill file's own current text. Roadmap docs describe state; they can
  go stale. The skill file and decision log are the two sources meant to stay current.
- **Track B specifically** needs a merge/sync cadence, not a permanent parallel
  branch — the longer it runs unsynced, the more expensive reconciliation gets (it's
  already gone from "60+ commits behind" to "69 commits / 34 phases behind" between
  this doc's source audit being written and finalized).
