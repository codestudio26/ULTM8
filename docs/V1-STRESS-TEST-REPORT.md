# V1 Stress Test & Functional Audit — Report

**Run date:** 2026-09-30 · **Not committed** — local-only report, add to git if you want it kept.

## What was built and run

1. **Bulk historical seed** (`apps/api/prisma/seed-dev-user.js`-style direct Prisma writes, bypassing the API):
   100 Schools (5 under Franchises, 86 independent), 10,715 Users, 10,254 Students,
   203 Branches, 192 Disciplines, 1,042 Ranks, 8,593 historical Classes spanning the
   past 90 days, 48,831 Bookings, 7,207 Memberships, 5,393 Transactions, 6,202 Waiver
   signatures. Completed in **18.5 seconds** — no FK/constraint errors on first run.

2. **Live HTTP simulator** — real requests against the running API (not a mock), 30
   sampled schools, ~1,200 concurrent student actors, 30 concurrent workers:
   **15,059 real actions in 105 seconds** (~143 req/s from a single sandbox IP).
   Covered: booking, cancellation, membership purchase, waiver signing, QR
   self-check-in, notifications, cross-tenant probing, and a dedicated
   overbooking concurrency race test.

## What's working well (confirmed, not assumed)

- **Zero 5xx errors, zero unhandled exceptions, zero crashes** across 15,059 requests
  and the full 3-month seed. Every error returned was a correct, intentional 4xx
  business-rule rejection (see below) — the server never fell over.
- **Latency is excellent under load**: p50 = 11ms, p95 mostly 20–90ms, p99 mostly
  under 250ms, even while 30 concurrent workers hammered it. No sign of slow
  queries or missing indexes at this data volume (~9K classes, ~49K bookings,
  ~10K students).
- **Booking concurrency is correct** — the one race condition every naive booking
  system gets wrong. 20 students simultaneously tried to book the same 5-seat
  class: **exactly 5 succeeded, 0 overbooked.** Ran twice (smoke test + full run),
  same clean result both times.
- **Cross-tenant isolation held 100%** — 1,552 real attempts by a Student at one
  School to book a Class at a *different* School, zero succeeded (correctly 404,
  RLS makes the other School's row invisible rather than leaking a 403 that would
  confirm it exists).
- **Business rules are actually enforced, not decorative**: rank-gating blocked a
  booking with the exact "current Rank does not permit this Class" message;
  duplicate-membership and duplicate-waiver-signature attempts were correctly
  rejected (409); a student with no Active Membership was correctly blocked from
  booking (400) rather than silently allowed through.
- **Graceful degradation works as designed**: with no email provider configured,
  `NotificationFanoutProcessor` correctly logs "NOTIFICATIONS_FROM_EMAIL not set,"
  keeps the in-app Notification row, and only the email side-channel fails —
  exactly the documented behavior, not a bug.
- **Writes are real**, spot-checked directly in Postgres: 32 new Memberships, 22
  new WaiverSignatures, 34 new Bookings (1 correctly CANCELLED) appeared in the
  DB matching the simulator's own success counts.

## Weaknesses found — worth fixing

1. **`/auth/login` is throttled to 5 requests/60 seconds per IP** (`apps/api/src/auth/auth.controller.ts`,
   `AUTH_THROTTLE`). This is real brute-force protection, but it's **per-IP, not
   per-account** — any shared IP (school wifi, a gym's guest network, campus NAT,
   a mobile carrier's CGNAT) hits this ceiling after the 5th *different person*
   logs in within a minute, not after 5 failed attempts by one attacker. A
   realistic scenario — several students logging in from the same gym wifi right
   before class — could genuinely lock legitimate users out. **Recommend:**
   rate-limit by email/account (already tracked via `LoginAttemptTracker` for
   lockout) in addition to or instead of raw IP, or raise the per-IP ceiling and
   rely on the existing account-lockout logic for actual brute-force defense.
2. **Global default throttle is also IP-based**: 60 requests/60s/IP
   (`app.module.ts`, `ThrottlerModule.forRoot`). Under this test's concurrency
   (30 workers, single IP) this was hit on `bookClass` and other endpoints —
   expected for a synthetic load generator on one machine, but the same shared-IP
   concern applies to any real deployment behind a NAT. Worth deciding
   deliberately (not silently) whether this should also move toward per-user
   rather than per-IP for authenticated routes.
3. **Minor gap in my own seed data, not the app**: the bulk seed assigned STUDENT
   RoleGrants directly, including to some Users whose randomized `dateOfBirth`
   makes them minors — which isn't reachable through the real registration flow
   (a minor can only be created via `POST /guardians/me/minors`, never
   self-registered). This correctly triggered the app's own
   "Guardian-linked enrollment is not yet available" rejection on waiver-signing,
   which is the app behaving correctly against unrealistic seed data, not an app
   bug. Flagging so the number isn't misread as a real defect.

## Coverage gaps — not tested in this pass (be honest about scope)

This round covered booking, cancellation, membership purchase (free/immediate
path only), waiver signing, QR self-check-in, notifications, and tenant
isolation — the highest-traffic, highest-risk paths. **Not yet exercised with
real traffic in this pass:**

- Stripe payment flows requiring `requires_payment`/`pending_confirmation`
  outcomes, and the dispute/chargeback-pattern-restriction path (confirmed
  simulatable by pushing directly onto the `stripe-webhook-processing` BullMQ
  queue, per the contract research — just not wired into this run)
- Staff actions: roll-call QR scan, grading/promotion, cash-transaction
  confirmation (`PATCH /transactions/{id}/confirm`)
- Franchise fee billing, platform SubscriptionPlan gating / degraded-state
  behavior
- Translations CRUD, tenant lifecycle close/reactivate, Platform Admin
  impersonation

**Recommendation:** treat this as Round 1. The simulator infrastructure
(`/tmp/.../scratchpad/seed-mega.js`, `simulate-usage.mjs`) is reusable — a
Round 2 extending the action set to the above would close the remaining gap
cheaply, since the hard part (schema/contract research, the 100-school dataset,
the concurrency harness) is already done.

## Improvements worth considering (lower severity, not blockers)

- Both throttle configs above should be a deliberate product decision, not
  left as defaults inherited from scaffolding.
- No dedicated index-usage/slow-query audit was run against the 49K-booking
  dataset beyond what the observed latencies already imply (good) — worth a
  focused `EXPLAIN ANALYZE` pass on the Bookings-by-Student and
  Transactions-by-School list queries specifically, since those are the ones
  that will grow fastest in real usage.
