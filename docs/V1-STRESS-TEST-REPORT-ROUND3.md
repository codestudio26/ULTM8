# V1 Stress Test — Round 3 Report

**Run date:** 2026-10-06. Builds directly on `docs/V1-STRESS-TEST-REPORT.md`
(Round 1+2) — that report's own "Coverage gaps" section named exactly five
areas as not yet exercised with real traffic: **Franchise fee billing**,
**platform SubscriptionPlan gating**, **Translations CRUD**, **tenant
lifecycle close/reactivate**, and **Platform Admin impersonation**. This round
covers all five. Kept as a separate file rather than appended to the existing
report — Round 1+2 covered the core tenant-facing booking/payment/attendance
surface at very high volume (15K actions); this round covers five narrower,
platform-operations-facing surfaces each at a scale proportional to what they
actually involve (hundreds of actions, not thousands — see each section).

## Environment

Real local Postgres 16 + Redis 7 (not mocked), same roles/migrations the
`.devcontainer/docker-compose.yml` reference values describe:
`DATABASE_URL`/`_APP`/`_AUTH`/`_JOBS`/`_DISCOVERY`/`_PLATFORM_ADMIN`,
`JWT_ACCESS_SECRET`, `PLATFORM_ADMIN_JWT_SECRET`, `REDIS_URL`, and CI's dummy
`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` values. `npx prisma migrate
deploy` found all 35 migrations already applied cleanly (fresh schema, zero
errors). The full existing e2e suite (373 tests, 37 of 38 suites — one
suite's guard conditions are unmet in this sandbox by design, see Round 1+2)
passes clean against this real database both before and after this round's
changes.

Two complementary techniques, matching what each area actually allows:

- **Translations CRUD, tenant lifecycle, Platform Admin impersonation** — a
  real, separately-running API process (`node dist/main.js`, listening on
  `:3000`), driven with genuine concurrent HTTP requests from a standalone
  Node script (`Promise.all` over `fetch()`), the same "live HTTP simulator"
  technique Round 1+2 used. No Stripe involved in any of these three areas.
- **SubscriptionPlan gating / Franchise fee billing** — both have a real
  Stripe network call sitting directly inside the exact code path this round
  needed to race (`SubscriptionPlansService.subscribe()`'s
  `stripe.subscriptions.create()`; `FranchiseFeeBillingService.
  ensureSubscription()`/`reportUsage()`'s own Stripe calls), and this
  sandbox's `STRIPE_SECRET_KEY` is the same documented CI dummy value Round
  1+2 already hit for the identical reason. Driven instead via `StripeClientService`
  stubbed out through NestJS's `overrideProvider` (the exact technique
  `platform-admin-auth.e2e-spec.ts` and `stripe-webhook-processing.e2e-spec.ts`'s
  own Membership-collision block already use) on top of a **real** Postgres
  and **real** concurrent `Promise.all` calls into the real service/processor
  code — only the external network call is substituted; the race itself, the
  DB rows, and the locking are all real. New Jest e2e specs using this
  technique are committed alongside this report.

All scratch seed data created for the live-HTTP phases was deleted from the
database after each phase; the full e2e suite was re-run clean at the end to
confirm no residue.

---

## Translations CRUD under concurrent load

Scale: a seeded pool of 60 ordinary rows plus purpose-built concurrency
batches of 55–150 requests per batch (Translations are admin-authored content,
not high-volume tenant traffic — concurrency correctness matters far more here
than raw throughput, per the task brief's own guidance).

- **55 concurrent creates, all unique `(screen, labelKey, locale)` triples:**
  55/55 succeeded (201), exactly 55 `CREATE_TRANSLATION` audit rows, zero 5xx.
- **55 concurrent creates, all the SAME triple** (two staff both typing in a
  brand-new label at once): exactly **1** succeeded (201), the other 54
  correctly got `409 Conflict`, and exactly **1** row was ever persisted —
  `TranslationsService.create()`'s P2002-to-409 mapping over the real
  `@@unique([screen, labelKey, locale])` index holds under genuine concurrent
  pressure, not just in isolation.
- **150 concurrent updates to the SAME existing row** (two staff editing the
  same translation simultaneously — the scenario the task brief specifically
  named): within this run's per-route throttle budget, 60 of the 150 landed
  (the rest correctly 429'd — see "A note on the pre-existing per-route
  throttle" below); all 60 succeeded (200), zero 5xx, and **exactly 60**
  `UPDATE_TRANSLATION` audit rows were written — no lost or duplicated audit
  entries even with 60 genuinely concurrent writers racing the same row. The
  final persisted `content` was exactly one of the 60 submitted values
  (ordinary last-write-wins — `Translation` has no version/optimistic-lock
  column, and nothing in Spec 55 or the domain-rules skill asks for one, so
  this is expected behavior, not a bug).
- **25 concurrent updates + 10 concurrent deletes on one fresh row** (an edit
  racing a delete): zero 5xx; the row ended up deleted, and every update that
  landed after the delete won the race got a clean `404` (Prisma's own P2025,
  already mapped by the global exception filter) — confirmed under real
  concurrent delete-during-update pressure, not just a sequential assumption.

**No bug found in this area.**

---

## Tenant lifecycle close/reactivate — a real race found and fixed

**Found:** `TenantLifecycleService.closeSchool()` / `closeFranchise()` /
`reactivateSchool()` / `reactivateFranchise()` (`apps/api/src/platform-admin/
tenant-lifecycle.service.ts`) each did a plain `findUnique()`, a conditional
throw, then a **separate, unconditional** `update()` — a textbook TOCTOU
window, and unlike `SubscriptionPlansService.subscribe()`'s own analogous race
(below), this one needs **no** external network call to open it — just two
ordinary DB round trips.

Driven directly: 30 Schools and 10 Franchises, each closed by **4 different
FULL_ADMIN callers firing `POST .../close` concurrently** with the correct
`confirmName`. Result, against the pre-fix code:

- **15 of 30 Schools** and **10 of 10 Franchises** had **all 4** concurrent
  calls succeed (201) — not 1 winner + 3 losers.
- Each of those schools/franchises ended up with **4 duplicate
  `CLOSE_SCHOOL_ACCOUNT`/`CLOSE_FRANCHISE_ACCOUNT` audit rows**, not 1.

That's a real integrity problem, not a cosmetic one: Decision 110 and
`ultm8-tenant-isolation` §6 both lean on the audit trail to answer "who closed
this tenant, and when" — a trail with 4 rows for 1 real action can't answer
that question, and 3 of the 4 HTTP callers were told their own call succeeded
when it never was the one that actually mattered.

**Fix** (`apps/api/src/platform-admin/tenant-lifecycle.service.ts`): the
fast-path `findUnique()` + specific error messages stay (so "not found",
"already closed", "already purged" are unchanged for the ordinary,
non-racing caller), but the actual mutation is now a conditional
`updateMany()` — e.g. `where: { id: schoolId, archivedAt: null }` for
`closeSchool()` — re-checked against the row's state **at write time** inside
Postgres's own row-level locking for that single `UPDATE`, not the possibly
stale read from before. Only the call whose `updateMany()` actually affects a
row (`count === 1`) writes the audit entry; every other concurrent caller gets
the correct `409 Conflict` instead of a false `201`. All four methods
(close/reactivate × School/Franchise) got the identical fix.

**Verified fixed:** 20 fresh Schools, same 4-concurrent-caller pattern, after
the fix — **0 of 20** had more than one success or more than one audit row.
Four new regression tests
(`apps/api/test/tenant-lifecycle-concurrency.e2e-spec.ts`) prove the same for
all four methods with real concurrent HTTP requests against the real app:
exactly one `201`, one `409`, and one audit row, every time.

### Mid-flight write while a tenant is closed

30 concurrent `POST /schools/:id/classes` calls from a real School Owner,
fired alongside a Platform Admin's `close()` call for that same School: 30
successes (201, one 429'd from the pre-existing throttle), zero 5xx, zero
corruption. `TenantAuthorizationService.assertSchoolNotArchived()`'s own
check-then-act window (a `findUnique` immediately before the write, no lock)
is architecturally the same class of race as the bug above — but Decision 110
explicitly scopes this gate as "read-only, not hidden" (part 1): a Class
created in the narrow window before `archivedAt` is actually visible is not
itself a violation of that decision, just an ordinary race-window artifact of
a soft business gate, not a security boundary. Flagged here for completeness,
not fixed — fixing it would mean row-locking the School on every single
write across 10 different services for a gate the spec doesn't ask to be
airtight, which would be inventing a stricter guarantee than Decision 110
actually confirms.

---

## Platform Admin impersonation under load

- **55 concurrent `startSession()` calls**, one admin, 55 distinct target
  Students: 55/55 succeeded, exactly 55 `START_IMPERSONATION_SESSION` audit
  rows, and **55 distinct JWTs** issued (no token collision/reuse across
  concurrent calls).
- **200 concurrent reads** using issued impersonation tokens against a real
  endpoint: all succeeded, zero 5xx.
- **150 concurrent WRITE attempts** using impersonation tokens against a real
  tenant write route (`POST /schools/:id/classes`): every single one was
  blocked — `403` ("read-only impersonation session", Decision 102) or the
  pre-existing throttle, **never** a 500, and **zero** Class rows were
  actually created in the database. Read-only enforcement
  (`JwtStrategy.validate()`'s `impersonation` check) holds under real
  concurrent pressure.
- **Session expiry under load** (the task brief's own named concern): booted
  the server with a 3-second `PLATFORM_ADMIN_IMPERSONATION_TTL_SECONDS`,
  started 30 concurrent impersonation sessions (30/30 succeeded), waited for
  the TTL to elapse, then fired 30 concurrent reads against a real
  `JwtAuthGuard`-protected route (`GET /schools/:id`) using the now-expired
  tokens: **30/30 correctly `401`'d**, zero 5xx. A control call with a
  freshly-issued token against the identical route immediately succeeded
  (200) — confirming the 401s are genuinely `exp`-claim enforcement under
  concurrency, not a broken guard or route.

**No bug found in this area.**

---

## SubscriptionPlan gating / platform billing — a real race found and fixed

**Found:** `SubscriptionPlansService.subscribe()`
(`apps/api/src/subscription-plans/subscription-plans.service.ts`) read the
tenant's `platformSubscriptionStatus`, checked it wasn't already
`ACTIVE`/`PAST_DUE`, then made a real Stripe `subscriptions.create()` call,
then wrote the result back — with the check and the write as two separate,
unsynchronized steps either side of a network round trip. Two concurrent
`subscribe()` calls for the **same** School/Franchise (a double-click, or two
browser tabs) can both pass the check, both create their **own real Stripe
Subscription**, and both try to claim the same row — plain last-write-wins
would silently **orphan the loser's Subscription**: `cancel()` only ever
looks at the one `stripePlatformSubscriptionId` column, so that Subscription
would have no code path that could ever cancel it again. A real,
ongoing money leak, not a cosmetic race — worse in character than the
duplicate-audit-row bug above, since actual Stripe money movement is involved.

Reproduced deterministically (`apps/api/test/
subscription-plans-concurrency.e2e-spec.ts`): `StripeClientService` stubbed
with an artificial 25ms delay on `subscriptions.create()` to widen the window,
over the real NestJS HTTP pipeline and a real Postgres row. Pre-fix: both
concurrent calls got `201`, both Stripe Subscriptions were created, and the
loser's was never touched again.

**Fix:** same technique as the tenant-lifecycle race — the fast-path
pre-Stripe-call check stays (so an obviously-already-subscribed tenant still
skips the Stripe call entirely), but the actual claim is now a conditional
`updateMany()` **after** the Stripe call, re-checked against the row's
current state. If the claim loses (`count === 0`), the just-created Stripe
Subscription is explicitly cancelled (`stripe.subscriptions.cancel()`) and the
caller gets `409 Conflict` instead of a false `201` — the exact "don't
silently orphan the loser's Stripe side effect" principle Round 2's own
`resolveMembershipCollision` fix already established for the analogous
Membership-purchase collision.

**Found on review, before shipping:** the first draft of the atomic guard
used `platformSubscriptionStatus: { notIn: ['ACTIVE', 'PAST_DUE'] }`. Verified
empirically against this sandbox's own real Postgres (not assumed from
memory) — standard SQL three-valued logic means `NULL NOT IN (...)` evaluates
to `NULL`, not `TRUE`, and Prisma's `notIn` compiles directly to that with no
implicit `OR col IS NULL`. Since `null` is the ordinary starting state for
every School/Franchise that has never subscribed, that draft would have made
**every normal, non-racing `subscribe()` call** spuriously lose its own "race
against nothing" and get a 409 — a regression far worse than the bug being
fixed. Caught by writing a 3-line standalone script against the real database
before trusting the filter, not by assumption; the shipped version guards
explicitly with `OR: [{ platformSubscriptionStatus: null }, { ... notIn
[...] }]`.

**Verified fixed:** the new regression test's two cases both pass — exactly
one `201` + one `409` (never two `201`s), exactly one of the two Stripe
Subscriptions left un-cancelled, and the persisted
`stripePlatformSubscriptionId` matches the winner, never the loser. A third
test confirms a later, non-racing `subscribe()` attempt still gets the
ordinary clean `400` ("already has an active platform subscription"), not a
false conflict.

### The read-only degraded-portal gate itself

`SubscriptionGateService.assertNotDegraded()` (the gate that gives a
`platformSubscriptionStatus: CANCELED` tenant a read-only portal) is pure DB
logic with no Stripe call in it, and is already covered by
`subscription-plans.e2e-spec.ts`. It was **not** separately driven under live
concurrent load this round — it is structurally the same "soft check-then-act
gate" class as `assertSchoolNotArchived()` (proven safe under real concurrency
above), and nothing about it suggests it would behave differently, but that
is an inference, not a direct measurement, so it is listed honestly under
"still untested" below rather than silently assumed covered by analogy.

---

## Franchise fee billing — verified, not assumed

Rather than re-stating franchise-fee-usage-reporting.processor.ts's own
header comments as if they were already proven (they weren't — nothing in
this repo had driven either mechanism concurrently before this round), two
new Jest e2e specs (`apps/api/test/
franchise-fee-billing-concurrency.e2e-spec.ts`) put real concurrent pressure
on both documented protections, against a real Postgres, with
`StripeClientService` stubbed (same documented sandbox constraint as Round
1+2 — this needs a live/mocked Stripe backend for the actual network call,
not for the race itself):

1. **Two truly concurrent `process()` runs** (simulating a double
   worker-dispatch of the same monthly job) against the same ready
   Per-Headcount School/Franchise with 2 active Students: the result is
   **exactly 1** `FranchiseFeeCharge` row for the period, not 2 — the
   migration's own partial unique index backstop (`usageReportPass()`'s own
   header comment calls it "the real, DB-enforced backstop") genuinely holds
   under real concurrent DB pressure, confirmed rather than trusted on faith.
   This is exactly the "franchise-fee charge double-counting active students"
   risk the task brief named to specifically watch for — it does not happen.
2. **`ensureSubscription()` called twice concurrently** for the same School:
   both calls settle on the **identical** Stripe Subscription id (the
   `franchise-fee-sub-${school.id}` idempotency key, simulated in the stub
   with real request-serialization semantics — the second concurrent call
   waits for and reuses the first's in-flight result, matching Stripe's own
   documented idempotency-key behavior) — never two separate standing
   Subscriptions for one School.

**No bug found in this area** — both mechanisms hold exactly as documented.
One structural note, not a bug: `ensureSubscriptionsPass()`'s own School loop
is sequential (`for...await`, not `Promise.all`), so in normal single-process
operation two *different* Schools under the same Franchise never actually
race each other's `ensureMeterAndPrice()` call (which has no idempotency key
of its own, unlike `ensureSubscription()`'s Subscription-create call) — this
round's test forced genuine concurrency directly at the service layer
specifically to verify the mechanisms that DO need to hold under a double
dispatch, not to claim the ordinary sweep itself is parallel.

---

## A note on the pre-existing per-route throttle

Several batches above show partial completion (e.g. "60 of 150 landed") —
this is `ThrottlerGuard`'s existing, intentional, per-(IP, route-handler)
default of 60 requests/60s (`apps/api/src/app.module.ts`), already documented
in Round 2's own report for the identical reason (`POST /students/{id}/ranks/
{disciplineId}/promote` hitting the same ceiling under a single-IP burst).
Restarting the server process (which resets the in-memory `ThrottlerStorage`)
and isolating a batch to its own fresh window reliably gets a clean,
un-throttled result, as shown in the 55-concurrent-unique-create and
55-concurrent-impersonation-start batches above — this is sandbox
single-IP-burst behavior, not a new finding, and not a bug in either
direction.

## What was found and fixed — summary

| # | Area | File(s) | Mechanism | Fix |
|---|------|---------|-----------|-----|
| 1 | Tenant lifecycle | `platform-admin/tenant-lifecycle.service.ts` | `findUnique` + unconditional `update()` TOCTOU — up to 4/4 concurrent `close()` calls all succeeded, duplicate audit rows | Conditional `updateMany()`, re-checked at write time |
| 2 | SubscriptionPlan billing | `subscription-plans/subscription-plans.service.ts` | Same TOCTOU shape across a real Stripe network call — orphaned, un-cancelable Stripe Subscription (real money leak) | Conditional `updateMany()` after the Stripe call + explicit cancel of the loser's Subscription |

Both fixes follow the identical pattern Round 2's own `resolveMembershipCollision`
fix established: let the race happen where it can't be prevented cheaply,
then make the DB write atomic and clean up any side effect the loser already
caused, rather than inventing a lock the spec never asks for.

Verification for both: `npx tsc --noEmit` clean; full e2e suite
**373/373 passing** (37 of 38 suites; one skip is pre-existing and unrelated)
against a real Postgres + Redis, before and after; 6 new regression tests
across 3 new spec files, all passing; unit test suite (17 tests) unaffected.

## Still genuinely untested — honest gaps

- **`invoice.paid`/`invoice.payment_failed`/`charge.dispute.*` under live
  queue concurrency** — unchanged from Round 1+2: these make a real outbound
  Stripe API call before touching the DB, and this sandbox's
  `STRIPE_SECRET_KEY` is a documented dummy value. Correctness is Jest-covered
  (`stripe-webhook-processing.e2e-spec.ts`), concurrency is not.
- **`SubscriptionGateService.assertNotDegraded()` under live concurrent
  load** — see above; not separately driven this round, only inferred safe by
  structural analogy to the tenant-lifecycle gate.
- **Real multi-process/multi-replica BullMQ worker concurrency** for
  franchise-fee-usage-reporting — this round proved the DB-level race
  protection holds when two calls race at the service layer; it did not spin
  up two actual competing BullMQ workers against live Redis to prove BullMQ's
  own per-job locking additionally prevents that scenario from ever being
  reachable in the first place. Both are real, independent layers of
  protection; only the inner one was directly measured here.
- **A real Stripe test-mode account** for the franchise-fee/platform-billing
  happy path (an actual `subscriptions.create()` round trip, a real webhook
  redelivery against a real signature) — same sandbox constraint as every
  Stripe-touching area in Round 1+2, not newly discovered.
- **Translations/tenant-lifecycle/impersonation at Round 1+2's own ~15,000-
  action scale** — deliberately not attempted; per the task brief's own
  guidance, these are admin-operations surfaces where concurrency
  *correctness* (did two racing writers corrupt something) matters far more
  than raw volume, and the batches run here (55–300 per area) were sized to
  that goal, not to Round 1+2's tenant-traffic volume.

## No design ambiguities hit

Both bugs found this round were implementation races in already-confirmed
business logic (Decision 110's close/reactivate semantics; the "one active
platform subscription" rule `SubscriptionPlansService.subscribe()`'s own
header comment already derives from domain-rules §6/§8 by direct analogy) —
fixing the race didn't require deciding anything the spec, the domain-rules
skill, or the decision log hadn't already settled. No `[UNRESOLVED]` item was
hit or needed to be escalated this round.
