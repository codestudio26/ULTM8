# Booking and schedule stress test — report and backend handover

**Run:** 26 Oct 2026, against `master` at `1c992b0`. **Fixes:** branch `test/stress-booking-schedule` (this PR). **Rules decided:** Decision 322. **Scripts:** `apps/api/scripts/stress/booking-schedule/` (see its README to rerun).

## Summary

30 Schools and 12,213 students went through the real API: belt declarations, three bookings each, check-in, and a promotion each. Then 20 attacks tried to break booking, the waitlist, schedule edits, check-in and grading.

- **Held up well from the start:**
  - no class was ever overbooked;
  - no duplicate booking or negative credit;
  - pack credits stayed exact under book/cancel churn and double cancels;
  - every cross-tenant attempt was refused;
  - concurrent check-ins counted once;
  - guarded promotions applied once.
- **Broke, now fixed in this PR:** 14 findings, listed below. Five of them were rules nobody had decided; the product owner decided them during the run (Decision 322).
- **Handed to the backend team:** 9 items, at the end (H1–H9). The most important is H1, the frontend screens for the new settings and choices.

**Needs action on deploy:** `TRUST_PROXY=1` is now set in `infra/terraform/ecs.tf`. Without it, every user behind the load balancer shares one IP and one 60-requests-a-minute limit (F2). Check the hop count if anything sits in front of the ALB (CloudFront would make it 2).

## Environment

- **Database and queue:** Postgres 16 with RLS, plus Redis. Every migration was applied, on an empty database.
- **API:** the built API (`node dist/main.js`) on its own port, driven over HTTP by Node scripts (64 requests in flight).
- **Machine:** one sandbox with 4 CPUs runs the client, the API and Postgres. The API uses its default Prisma pool of 9 connections, so absolute times are indicative.
- **Throttle:** `THROTTLE_IP_LIMIT_PER_MINUTE` was raised for the load runs, because every request came from one machine.
- **Memberships:** inserted directly, since purchase needs Stripe. Everything else went through the API:
  - the IBJJF style templates, 420 timetable slots, 540 one-off classes;
  - the real class generator, which made 1,680 classes in 2 s;
  - declarations, bookings, check-ins, promotions, waitlist and slot edits.
- **Seed:** 30 Schools with 1–3 branches and five time zones. Students: 70% Unlimited, 20% 5-class pack, 5% a membership past its expiry date (still ACTIVE, as before the nightly sweep runs), 5% none.

## Load results (final run, all fixes in)

| Step | Requests | Median | p95 | Result |
|---|---|---|---|---|
| Declare first belt | 12,213 | 505 ms | 735 ms | all 201 |
| Book (3 per student) | 36,639 | 514 ms | 670 ms | 18,667 booked. Refused: no or expired membership (400), class at another branch (404), full (409) |
| Instructor check-in | 6,929 | 731 ms | 844 ms | all 201 |
| Promote one rung | 12,213 | 820 ms | 959 ms | 10,975 promoted; 1,238 refused for no live membership (correct) |
| Grading Board, one School | 30 | 334 ms | 463 ms | all 200 |
| Bookings summary | 30 | 82 ms | 118 ms | all 200 |

**Booking bursts:** many students booking one popular class at the same moment, on one API instance.

| Burst | Filled | Errors | Median wait | Slowest |
|---|---|---|---|---|
| 40 people, 1 class of 20 | 20/20 | none | 0.8 s | 1.3 s |
| 100 people, 1 class of 30 | 30/30 | none | 1.8 s | 2.9 s |
| 200 people, 5 classes of 20 | all 20/20 | none | 2.2 s | 3.4 s |
| 400 people, 10 classes of 20 | all 20/20 | none | 4.2 s | 6.3 s |
| 1,200 people, 30 classes of 10 (extreme) | partly | 503 "busy, try again" | — | — |

Before the fix, the 40-per-class burst returned 500s (F3).

## Findings fixed in this PR

| # | Finding | Before | Now |
|---|---|---|---|
| F1 | **Per-user rate limit keyed by IP** | The "identity" limit (1,000/min) fell back to the IP on most routes, so every user on one School's WiFi shared it. In the run, 11,213 of 12,213 declarations and promotions got 429. | Keyed by the signed-in user (`app.module.ts`). |
| F2 | **No `trust proxy` behind the ALB** | `req.ip` is the load balancer's address in production, so the 60/min per-IP limit applied to the whole platform at once. | `TRUST_PROXY` env (number of hops), set to 1 in `ecs.tf` (`main.ts`). |
| F3 | **Booking burst drained the connection pool** | Every booking waiting for a busy class's row lock held a pooled connection. Requests then failed with "Unable to start a transaction" (500): 644 of 1,500 in the burst test, and classes were left half empty. | The lock is taken with `NOWAIT` and retried with no connection held. Booking transactions may wait 10 s for a connection. Any leftover Prisma P2028 is a 503 "busy", not a 500 (`booking-gates.ts`, exception filter). |
| F4 | **Expired memberships paid for bookings** | An ACTIVE membership past its `expiryDate` (before the sweep) funded 377 bookings. Spec: expiry is checked at every booking. | Excluded when choosing what pays. Packs expiring soonest are spent first. A pack emptied by a concurrent booking falls through to the next pack. |
| F5 | **Booking cut-off ignored** | `bookingEndAt` (the timetable's booking cut-off) was never checked. | Students and Guardians are stopped at it; Staff can book walk-ins until the end (Decision 322 §1). |
| F6 | **Ended and archived classes bookable** | A class that ended yesterday took bookings, and spent credits. | Refused for everyone, in booking, waitlist join and claim. |
| F7 | **Check-in had no opening time** | A coach could check a student into next week's class, and it counted toward grading. | Opens `School.checkInOpensMinutesBeforeStart` (default 30) before the start (Decision 322 §2). |
| F8 | **Waitlist joins that make no sense** | A class with free seats took waitlist entries, and so did students already booked into it. | Refused with a clear message (Decision 322 §3). |
| F9 | **Queue jumping** | A freed seat went to whoever booked first, not the waitlist. | Waitlist first: while anyone waits, students can't book directly. Seats offered to notified students are held. Raising capacity offers the new seats to the waitlist (Decision 322 §3). |
| F10 | **Capacity below bookings** | The owner could cut a class of 8 bookings to 3. | Refused with the count (Decision 322 §6). |
| F11 | **Late cancellation gave credit back after the start** | With no refund cut-off, a student could cancel during the class, or after it ended (until the 15-minute no-show sweep), and get the credit back. | A School setting, `lateCancelRefundPolicy`, default no refund once started. Ended classes can't be cancelled (Decision 322 §4). |
| F12 | **Timetable edits never reached generated classes** | Switching a slot off left 4 weeks of bookable classes. A new day added a second set, with the old ones still there. | Unbooked upcoming classes follow the edit. Booked ones need the owner's Move, Cancel or Keep choice, and booked students are told (Decision 322 §5). Only the fields the edit changed are carried over, so a change made to one class on its own survives an unrelated slot edit. |
| F13 | **Archiving a slot left its classes bookable** | The slot was archived, its upcoming classes weren't. | Unbooked upcoming classes leave the schedule with it. |
| F14 | **Duplicated booking code** | Booking and waitlist claim each had their own copy of "which membership pays". | One shared copy, `bookings/booking-gates.ts`. The class generator and slot edits now share `timetable/slot-occurrences.ts`. |

**Schema:** migration `20261126000000_booking_stress_fixes` adds `School.checkInOpensMinutesBeforeStart` (int, default 30) and `School.lateCancelRefundPolicy` (enum, default `NO_REFUND_ONCE_STARTED`). Both are settable on `PATCH /schools/:id` and returned on the School.

**API changes:**
- `PATCH /timetable/:id` takes an optional `bookedClasses` (`MOVE`, `CANCEL` or `KEEP`). It returns 409 when the choice is needed.
- New `GET /timetable/:id/upcoming-impact` returns the counts for that choice.
- `PATCH /classes/:id` returns 409 when the new capacity is below the bookings.
- New error messages for every refusal above.
- The API client (`packages/api-client`) is regenerated.

**Tests:**
- New `apps/api/test/booking-schedule-stress-fixes.e2e-spec.ts` (14 tests) pins every finding.
- `bookings.e2e-spec.ts` and `attendance.e2e-spec.ts` fixtures were updated to the new rules: a waitlist needs a full class, and check-in opens 30 minutes before the start.
- Unit tests: 517 pass.

## Attack results (final run)

23 of 25 checks pass. The two that fail are handed over (H4 and the extreme burst in H2).

| Check | Result |
|---|---|
| Double-click booking (20 at once) | one booking |
| Last pack credit, 10 classes at once | one booking, 0 credits left |
| 10 parallel cancels | one refund |
| Book/cancel churn | credits exact |
| Cross-tenant: book, staff book, cancel, check-in, list, promote, other-school student | all refused |
| Waitlist positions under 20 parallel joins | unique |
| Waitlist rules and queue jumping | refused as decided |
| Capacity cut, archive with bookings | refused |
| Slot off with bookings | asks; Cancel removes all and refunds |
| Slot Move | re-timed, bookings kept |
| Slot new weekday | moved, not doubled |
| 10 parallel promotes with `expectedCurrentRungId` | one promotion |
| 10 parallel promotes **without** it | **two promotions** (H4) |
| Simultaneous instructor + self check-in | counted once |
| Cancel after start (default setting) | credit kept |
| Raise capacity of a full class | waitlist notified, direct booking refused |
| 30 students from one IP | none throttled |

## For the backend team

Everything above is built and tested. These items are not, in order of priority. **Need information?** Ask the product owner. Every rule in Decision 322 was answered directly, so nothing here is guessed.

| # | Task | Notes |
|---|---|---|
| H1 | ~~**Frontend screens for the new rules**~~ **Done** (26 Oct 2026, branch `feature/booking-rules-ui`) | The school-portal now has the two School settings, the Move/Cancel/Keep dialog on slot edits (it reads `GET /timetable/:id/upcoming-impact`, which now also returns `mostTaken`, and sends only the changed fields), "Add to waitlist" when a class is full, and its own wording for the coded errors. The student app shows "Join waitlist" only for a full class or a queue, not for every 409. **Error codes are now part of the API contract** (`error.code`, messages unchanged): `CLASS_FULL`, `WAITLIST_FIRST`, `BOOKING_CLOSED`, `CLASS_BUSY`, `CHECK_IN_NOT_OPEN`, `CAPACITY_BELOW_BOOKED`, `BOOKED_CLASSES_CHOICE_REQUIRED`. Keep them stable; the apps key their wording off them. |
| H2 | **Capacity and speed** | One instance handled about 150 booking requests a second at steady load (36,639 in 237 s), and 60–65 a second when they all hit one class at once; the burst table above shows the waits. Each booking opens 3–4 separate transactions (class lookup, degraded-portal check, staff check when booking for someone, the booking itself), plus 2–4 seat and waitlist counts on the jobs pool. Merging the first steps into the booking transaction would cut the connection use. Set Prisma's `connection_limit` per ECS task from the RDS max, and consider PgBouncer. The extreme burst (1,200 at once on one instance) gets 503s by design. |
| H3 | **Booking at another branch** | A student whose role is scoped to one branch gets 404 on every other branch's classes; 39% of the seeded students. Decision 148 left "which other branches a student may book" open, so this is a product decision, not a bug. Bring it to the product owner. |
| H4 | **Promote without `expectedCurrentRungId`** | 10 parallel calls promoted twice. Both apps always send it, so no user can trigger this, but the API should require it, or default it to the current rung. |
| H5 | **Identity throttle trusts an unverified JWT `sub`** | `jwtSubTracker` decodes the token without checking the signature, so a forged token gets its own budget. The per-IP limit still applies, so the harm is small. Verify the token, or key after the auth guard. |
| H6 | **Archive vs. booking race** | `POST /classes/:id/archive` checks for bookings in one transaction and archives in another. Take the class seat lock (as booking does) for both steps. |
| H7 | **Who may change the new settings** | Owner-only for now, through `PATCH /schools/:id`. Decision 316 gives check-in rules to "the owner and staff the owner grants access". Add them to the per-staff Access page when it's built (Decision 320). |
| H8 | **Slot-edit edge cases to confirm** | Cases in `TimetableService.syncUpcomingClasses`: (a) a class moved to a day this week that has already passed is removed if unbooked, or cancelled with notice if booked with Move; (b) Keep leaves booked classes completely unchanged, title included; (c) notices go through the in-app fan-out only. Confirm (a) and (b) with the product owner if the frontend shows them. |
| H9 | **Spend order when a student holds several packs** | Packs expiring soonest are now spent first. Before, the order was undefined. Mention it in the release notes. |
| H10 | **The waitlist job can offer one seat twice** | `waitlist-cascade-processing` notifies the next Waiting student on every `seat-freed` event, without checking whether that seat is already offered to someone still Notified. Found by CI on this PR. Claiming is first come first served among notified students, so the seat is never lost, but a student can be told about a seat that is gone by the time they claim. The job should notify only while free seats exceed the current holds. |
