# Stress test round 3: everything added since round 2

**Run:** 27–28 Oct 2026, against `master` at `2a4cc58` (after #310). **Fixes:** branch `test/stress-round3` (this PR). **Scripts:** `apps/api/scripts/stress/round3/` (see its README), plus the round 1 and 2 scripts in `booking-schedule/` and `billing/`. **Earlier rounds:** `BOOKING-SCHEDULE-STRESS-TEST.md`, `BILLING-STRESS-TEST.md`.

## Summary

The same cast as rounds 1 and 2 went through the real API: 30 Schools and 12,213 students. Then:
- the round 1 and 2 load, attacks, bursts and billing ran again, unchanged;
- four new scripts attacked everything merged since round 2 (#273 to #343, and #310): 134 checks.

**Results:**
- **Round 1 and 2 still hold.** The load gives the same results as before: 12,213 declarations, 18,667 bookings and 10,975 promotions, with 1,238 promotions refused for no live membership. No class was ever overbooked, every burst filled exactly and billing passed 29 of 29. 22 of 24 attacks pass; the two that fail are round 1's known open items H2 and H4.
- **New features: 12 bugs found, all fixed in this PR**, each with a regression test that fails without the fix. Three were High: bookings landing on a class the School just cancelled (in two places), a whole-class cancel that couldn't be finished, and closing a Branch deadlocking with bookings.
- **After the fixes:** 132 of 134 new checks pass on the full cast. The other 2 wait on a product decision (Q2 below). The full API suite passes: 110 suites, 1,383 tests. No request returned a 500 anywhere in the final run.

**Needs action on deploy:**
- One migration, `20261212000100_role_grant_one_live_per_scope`. It first revokes any live duplicate role grants (keeping the oldest), then adds a unique index. Read the migration before deploying if production may hold duplicates.
- The API now uses the native `bcrypt` package. It ships prebuilt Linux binaries, so the Docker image and the Render build need no compiler. Existing passcode hashes keep working.

## Environment

- **Database and queue:** Postgres 16 with RLS and Redis, every migration applied to an empty database.
- **API:** the built API (`node dist/main.js`) against an in-memory fake Stripe (`billing/fake-stripe.mjs`).
- **Machine:** one sandbox with 4 CPUs runs the scripts, the API and Postgres, with the default Prisma pool. Absolute times are indicative.
- **One Redis per API process.** The job queue ignores the database number in `REDIS_URL` (`queue.module.ts` reads only host and port). Two APIs on one Redis take each other's jobs, which made notifications and webhooks fail for reasons that had nothing to do with the code. If two environments ever share a Redis server, they need separate servers, not separate database numbers.
- **The new scripts** were written and debugged against a small 4-School cast first, then run on the full cast, before and after the fixes.

## Load results (final run, all fixes in)

| Step | Requests | p50 | p95 | Result |
|---|---|---|---|---|
| Declare first belt | 12,213 | 421 ms | 485 ms | all 201 |
| Book now | 12,213 | 534 ms | 645 ms | 6,539 booked; 735 refused for no membership, 4,939 at another branch |
| Book from the timetable | 24,426 | 533 ms | 647 ms | 12,128 booked; full classes 409 |
| Instructor check-in | 6,929 | 660 ms | 741 ms | all 201 |
| Promote one rung | 12,213 | 715 ms | 798 ms | 10,975 promoted; 1,238 refused for no live membership (correct) |
| Grading Board, one School | 30 | 372 ms | 477 ms | all 200 |

Capacity races: 60 classes, none over or under. Bursts: 40, 100, 200 and 400 people booking at once filled every class exactly, with no errors (400 people: p50 4.2 s, slowest 6.0 s).

## Findings fixed in this PR

| # | Severity | Finding | Before | Now |
|---|---|---|---|---|
| 1 | High | A booking made while the School cancels the class stayed booked on the cancelled class: credit spent, no notice | 5–16 of 10–16 racing bookings left Upcoming | The booking locks the class and re-reads it; the cancel locks it before marking. A racing booking is either cancelled with the rest or refused ("This class has been cancelled by the school") |
| 2 | High | The same race when a timetable slot is switched off with its booked classes cancelled | 5 of 9 left Upcoming | Same lock-then-mark order |
| 3 | High | A whole-class cancel that failed half way (server busy) left bookings Upcoming, and cancelling again answered "already cancelled" | Stuck | Cancelling again finishes it, then answers "already cancelled" |
| 4 | High | Closing a Branch while people book its classes deadlocked: 500 on the close and on some bookings | 500 in every round | The close takes a lock that doesn't block the bookings' branch check; bookings move with their class |
| 5 | Medium | Booking and checking in one student from two desks at once deadlocked | 2 of 32 requests 500 | Same student and class take turns; the second booking gets the usual 409 |
| 6 | Medium | A style could be archived while classes using it were being saved | 7 classes with an archived style | Class and slot saves share-lock their styles |
| 7 | Medium | "Give role" clicked twice gave the same role several times; revoking one copy left the access | 3–10 identical grants | One live grant per person, role and scope (unique index; old duplicates revoked by the migration) |
| 8 | Medium | Passcode hashing (`bcryptjs`, pure JavaScript) blocked the whole API: a burst of Add manually or logins stalled every other request for seconds and returned 503s | 20 hashes: 6.5 s, 2.0 s blocked | Native `bcrypt` on the thread pool: 2.2 s, 23 ms blocked; same hashes |
| 9 | Medium | Add manually that failed part way left an account with no enrolment and no passcode, and the same email then got "use Invite instead" | 5 orphan accounts in one burst | The account is removed when the enrolment fails, so the owner can just try again |
| 10 | Medium | A Subscription paid after its School closed started billing and was never cancelled | Membership ACTIVE, renewing | The payment is refunded and the Stripe subscription cancelled; closing a School also cancels Subscriptions still waiting for their first payment |
| 11 | Medium | New waiver terms saved while students sign left signatures on the old terms | 0–18 per round | Signing and editing take turns on the waiver; no signature stays on retired terms |
| 12 | Low | Double-clicked waiver signature saved several times; "Remind everyone" pressed at once reminded everyone several times (and could deadlock); Subscription cancel pressed at once called Stripe each time | 4×201; 5,210 reminders for 1,042; up to 10 Stripe calls | One signature; each student reminded once a day; one Stripe call |

The regression tests are in `test/stress-round3-races.e2e-spec.ts` (fixes 1–6), `test/staff-fixes.e2e-spec.ts`, `test/auth.e2e-spec.ts` and `test/students-review-fixes.e2e-spec.ts` (7–9), and `test/school-self-close-and-franchise-notices.e2e-spec.ts`, `test/memberships-desk-and-cancel.e2e-spec.ts` and `test/waivers-settings.e2e-spec.ts` (10–12).

## Waiting on the product owner

These were found but not changed, because no confirmed rule covers them. They were asked on 28 Oct 2026.

| # | Question | What happens today | Suggested |
|---|---|---|---|
| Q1 | "Remove from School" for a coach who still teaches upcoming classes | Removed; the classes keep them as instructor. Revoking a single Instructor role is refused in that case (Decision 331) | Refuse until the classes are handed over, like revoke |
| Q2 | A student booked and checked in again to a class they already attended (FD3, FD5) | Allowed: the one-booking index covers Upcoming bookings only. Two desks can attend one student twice and spend two pack credits | One attendance per student per class |
| Q3 | A desk sale or Friend Pass clicked twice | Two packs and two payments, or two passes | Refuse an identical one for the same student within a minute |
| Q4 | A Friend Pass paying for its holder's own seat | Allowed | A Friend Pass covers a guest only |
| Q5 | One staff login booking walk-ins | Limited to 20 bookings a minute per user | 60 a minute for staff booking on someone's behalf |
| Q6 | A payment that arrives after its School closed | Refunded (fix 10) | Confirm, or create it and cancel at period end instead |

## Still open from earlier rounds

- **H2 (A1):** the extreme burst (1,200 people at 30 classes of 10 at once) gets "busy, try again" (503) by design.
- **H4 (A10b):** a promote sent without `expectedCurrentRungId` and double-clicked promotes twice. The portal always sends it.

## Observed, not fixed (low)

- The front-desk name search loads the whole roster and filters it in memory (p50 120 ms at 500 students). It should become a server-side search before Schools get much bigger.
- The transactions CSV export reads every page at 100 rows a request, so one owner's export of more than about 100,000 rows runs into the 1,000-requests-a-minute limit. A server-side CSV endpoint would fix it.
- Desk payments load every STUDENT grant of the School to check one id (`deskPayableStudents`), which grows with School size.
- Native `bcrypt` uses Node's thread pool (4 threads by default). `UV_THREADPOOL_SIZE` can be raised on the API hosts if logins burst.
