# V1 Stress Test & Functional Audit — Report

**Round 1 run date:** 2026-09-30 · **Round 2 run date:** 2026-10-01.

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

## Weaknesses found in Round 1 — status after Round 2

1. **FIXED.** `/auth/login` (and `/otp/send`, `/otp/verify`, `/forgot-password`,
   `/reset-password`) were throttled 5 requests/60s **per IP only** — a shared IP
   (school wifi, a gym's guest network, campus NAT, mobile CGNAT) hit the ceiling
   after the 5th *different person* logged in within a minute, not after 5 failed
   attempts by one attacker. Fixed on `fix/v1-hardening-round2`
   (`apps/api/src/common/throttle/identity-trackers.ts`): a new per-identity
   named throttler (keyed by the submitted email/phone, same 5/60s strictness a
   single caller always had) now runs *alongside* the IP-keyed `default`
   throttler, which is loosened to a generous 20/60s backstop — so the two
   dimensions are independent (both still apply, AND-ed), not one shared bucket.
   `LoginAttemptTracker`'s own escalating-lockout curve is untouched — it's still
   flagged in its own header comment as Architect-review-pending, not folded into
   this fix. Proven with a new `auth.e2e-spec.ts` (no e2e spec exercised
   `/auth/login` or `/auth/otp/*` at all before this): a 6th rapid attempt against
   the *same* email now 429s while 10 different emails in a row from the same IP
   all get through — the exact Weakness #1 scenario, now a regression test.
2. **FIXED.** Class-booking, waitlist-claim, and Booking-cancel (which is also
   where a membership credit gets restored) had **no throttle at all**. Same
   per-identity mechanism added, keyed by the caller's JWT `sub` (decoded, not
   re-verified — Nest's global `ThrottlerGuard` runs before the per-route
   `JwtAuthGuard`, so `req.user` isn't populated yet at throttle time; a forged
   token is still rejected downstream exactly as before). Limit 20/60s per user.
   Proven with a new `booking-throttle.e2e-spec.ts`: a 21st rapid booking/claim
   attempt by the same user now 429s. Full e2e suite re-run after the fix:
   **383/383 passing** (was 376 — 2 new spec files, 7 new tests), zero
   regressions.
3. **Side finding, fixed in passing**: 22 e2e spec files generated fake phone
   numbers as `+1555` + a 7-digit random suffix (~9M combinations). Collided for
   real this session against the 10,715-row seed dataset and flaked
   `classes.e2e-spec.ts` on a full-suite run. Widened to a 10-digit suffix across
   all 22 files — same commit as the throttle fix.
4. **Minor gap in my own seed data, not the app**: the bulk seed assigned STUDENT
   RoleGrants directly, including to some Users whose randomized `dateOfBirth`
   makes them minors — which isn't reachable through the real registration flow
   (a minor can only be created via `POST /guardians/me/minors`, never
   self-registered). This correctly triggered the app's own
   "Guardian-linked enrollment is not yet available" rejection on waiver-signing,
   which is the app behaving correctly against unrealistic seed data, not an app
   bug. Flagging so the number isn't misread as a real defect.

## Round 2 — extended coverage

**DB performance (`EXPLAIN ANALYZE` against the live 48,865-Booking/5,393-
Transaction dataset):** both named hot paths use their index correctly —
`Booking` by `studentId` and `Transaction` by `schoolId` each resolve via a
Bitmap Index Scan (`Booking_studentId_idx`, `Transaction_schoolId_idx`),
sub-millisecond execution (0.17ms / 0.16ms). Per-student/per-school result sets
are small at this volume (≤16 bookings, ≤86 transactions), so the small
in-memory Sort the planner adds after the index scan (cursor pagination orders
by `id`, not the indexed column) costs nothing yet. Not a current problem;
worth revisiting with a composite `(studentId, id)` / `(schoolId, id)` index
only if per-entity row counts grow into the thousands.

**Stripe payment/dispute flow** — driven directly onto the real
`stripe-webhook-processing` BullMQ queue, consumed by the actual running
worker (the real HTTP webhook endpoint needs a raw-body HMAC signature that
can't be faked, so this bypasses only that, nothing downstream).
**New constraint found this round, not assumed:** `charge.dispute.*` and
`invoice.paid`/`invoice.payment_failed` make a real outbound Stripe API call
(`disputes.retrieve`/`invoices.retrieve`) *before* touching the DB at all
(`stripe-webhook-processing.processor.ts`'s own `process()`) — and this
sandbox's `STRIPE_SECRET_KEY` is a CI placeholder (`sk_test_ci_d...`, confirmed
not live), so those two event families genuinely can't be driven through a
live worker here. Their *correctness* is still covered — both already have
dedicated Jest coverage calling the processor directly against a stubbed
`StripeClientService` (`stripe-webhook-processing.e2e-spec.ts`,
`chargeback-pattern-restriction.e2e-spec.ts`) — just not their behavior under
real queue concurrency.
What *was* driven at volume (`payment_intent.succeeded`/`payment_intent.
payment_failed`/`customer.subscription.deleted`, which only match `objectId`
against a stored correlator column, no Stripe call needed):
- 140 `payment_intent.succeeded` + 17 `payment_intent.payment_failed`, all
  correctly settled (140 Memberships created, 17 Transactions flipped to
  `FAILED`, zero 5xx).
- **Idempotency confirmed under real redelivery**: 10 already-processed events
  redelivered a second time (nearly concurrently with their first delivery, a
  harder case than a delayed resend) — zero duplicate Memberships, exactly 1
  `ProcessedStripeEvent` row each, not 2.
- **The documented collision path, reproduced for real**: 20 genuine "student
  already holds an active general-access Membership" collisions (a second
  `SUBSCRIPTION` purchase landing while one is already active) correctly left
  the `Transaction` row `PENDING` — never falsely `SUCCESSFUL` — and never
  created a duplicate Membership, confirming `handlePaymentIntentSucceeded`'s
  own documented rollback-together behavior holds under the real BullMQ
  retry/backoff cycle (3 attempts, exponential backoff), not just in Jest.
  **FIXED, same session**: the code's own comment at this exact spot said the
  correct resolution was a Stripe Refund API call (and Subscription
  cancellation), deliberately left unbuilt (`TODO(Phase 9 follow-up)`) —
  previously only a loud server log. Now built
  (`StripeWebhookProcessingProcessor.resolveMembershipCollision`): the
  captured PaymentIntent is refunded, the Subscription is cancelled too for a
  SUBSCRIPTION-type purchase, and the Transaction moves to the
  already-modeled-but-previously-unused `REFUNDED` status with
  `refundedAmount` set, rather than sitting `PENDING` forever. Real
  implementation obstacle hit and resolved along the way: the original plan
  was to distinguish this collision from the dedup-row conflict via
  `err.meta?.target` column-name inspection (same technique
  `isProcessedStripeEventConflict` already uses) — reliable for the dedup
  case but NOT for this one, confirmed empirically: Postgres suppresses a
  unique-violation's DETAIL text (what Prisma parses `target` from) on any
  RLS-governed table for a non-owner role, and `Membership` has RLS while
  `ProcessedStripeEvent` doesn't. Fixed by catching the collision with a
  dedicated error type at the one call site that can produce it instead.
  4 new e2e tests (own `StripeClientService` stub, matching the existing
  `charge.dispute.*` block's own established pattern) prove the refund+cancel,
  the one-time-purchase no-cancel case, and that a redelivery never double-
  calls Stripe. Full suite: 387/387 passing.
- An initial version of this test used a `CLASS_PACK` plan for the collision
  case and found no collision at all — a flaw in the test, not the app:
  `Membership_one_active_general_access_per_school` is a *partial* unique
  index (`WHERE classesRemaining IS NULL`), deliberately excluding
  `CLASS_PACK` purchases (stacking multiple class-packs is legitimate).
  Re-run against a `SUBSCRIPTION` plan (`classesIncluded` null) for a genuine
  test — noted here so the correction itself is on record.

**Staff actions** (`apps/api/src/attendance`, `src/ranks`, `src/payments`),
real HTTP calls against the live server:
- **Instructor manual roll-call scan** (`POST /classes/{id}/attendance-scan`,
  no QR token): 33/33 succeeded against real `UPCOMING` Bookings inside the
  check-in window.
- **Grading/promotion** (`POST /students/{id}/ranks/{disciplineId}/promote`):
  60/300 succeeded before hitting the **pre-existing, unrelated** global
  default throttle (60 requests/60s/IP — this route carries no `@Throttle`
  override, so it uses the generic default) — not a bug, just this script's
  own single-IP burst pattern meeting a throttle that was already there and
  already working correctly. Worth knowing if a future "bulk-promote the
  graduating class" School Portal feature is ever built driving >60 calls/
  minute from one office.
- **Cash/Bank Transaction confirm** (`PATCH /transactions/{id}/confirm`):
  16/40 succeeded, 24 correctly `409`'d on the identical "already has an
  active general-access Membership" collision tested above for Stripe — and
  here it's handled *better*: synchronously, as an immediate `409` to the
  caller, not a deferred queue retry-then-alarm. Lower risk too, since no
  Stripe charge has already moved money by the time this runs. Re-confirming
  10 already-resolved Transactions a second time was a clean idempotent no-op
  (4 already-`SUCCESSFUL` → no-op `200`; 6 still-`PENDING`-from-the-same-
  collision → the identical `409` again, deterministically).
- Zero 5xx anywhere across all three.

## Coverage gaps — still not exercised with real traffic

- `invoice.paid`/`invoice.payment_failed`/`charge.dispute.*` under live queue
  concurrency (blocked on a real/mocked Stripe backend — see above; their
  correctness is already Jest-covered, just not at concurrency)
- Franchise fee billing, platform SubscriptionPlan gating / degraded-state
  behavior
- Translations CRUD, tenant lifecycle close/reactivate, Platform Admin
  impersonation

## Improvements worth considering (lower severity, not blockers)

- A composite `(studentId, id)` / `(schoolId, id)` index for Bookings-by-
  Student / Transactions-by-School, only if per-entity row counts grow from
  today's tens into the thousands (see DB performance above — not urgent yet).
- `apps/api`'s own `npm run lint` is currently broken in this sandbox
  (ESLint 10 installed/hoisted with no `eslint.config.js`, while the repo still
  ships a legacy `.eslintrc.json`) — a pre-existing environment issue, not
  something this round's changes caused, but worth fixing so lint is part of
  the verification loop again.
