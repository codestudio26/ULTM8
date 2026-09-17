# Track B — Student App Roadmap

Phase structure for `apps/student` beyond Slice 1. Same scope discipline as every
slice so far (and the backend track's own Phase 1): each slice pulls in only what it
actually needs; anything requiring a design pass that doesn't exist yet, or a backend
capability that isn't built, is named explicitly and held out rather than guessed at.

Every slice below cites the real controller/service code it's grounded in — verified
directly against `apps/api/src/**`, not the `ultm8-nestjs-module` skill's own
"representative" endpoint table (already known to be stale in places, per Slice 1's
kickoff doc).

---

## Slice 1 — Walking skeleton (DONE)

Expo/RN init, Auth flow (Register → OTP → Login → Forgot/Reset passcode), read-only
Academies discovery, read-only My Bookings. Built, high-effort reviewed (6 real bugs
found and fixed, 4 documented limitations), typechecked, and interactively tested via
a browser preview. See `apps/student/README.md` for the full account.

---

## Slice 2 — Class Booking & Waitlist (DONE)

**Why this one next:** it's the direct write-side counterpart to Slice 1's read-only
Academies/My Bookings screens — browsing a class and doing nothing with it is an
unfinished loop, and this closes it. Nothing about it is blocked: every endpoint it
needs already exists and was just re-verified directly against
`apps/api/src/bookings/bookings.service.ts` and `apps/api/src/waitlist/`.

### Confirmed API surface

- `POST /classes/{id}/book` (`BookClassDto`) — for an ordinary Student self-booking,
  the body can be empty (`{}`). `studentId` and `overrideReason` are Staff-only fields
  (booking on someone else's behalf / bypassing a gate) — a Student who is not Staff
  must never send them; `attendeeMembershipIds` is only for booking extra guests
  beyond yourself and is out of scope for a first cut. `sourceMembershipId` is resolved
  server-side from the caller's own active Membership — the client never selects one.
- `PATCH /bookings/{id}/cancel` — no request body.
- `POST /classes/{id}/waitlist` — join the waitlist, no body.
- `DELETE /waitlist/{id}` — withdraw from the waitlist.
- `POST /waitlist/{id}/claim` — claim an offered waitlist spot; returns a real
  `BookingResponseDto` (i.e. claiming converts the waitlist entry into a Booking).
- `GET /bookings/me` (already built, Slice 1) — the list this slice adds actions to.

### Real gates this flow must surface, not build around

Verified directly in `BookingsService.bookClass()` — three real failure modes the UI
needs to display gracefully (not prevent, since the client can't evaluate any of them
itself):
1. **Waiver required and not signed** → `400 BadRequestException`, "This Student must
   hold a Signed Waiver for this School before booking a Class that requires one."
   Since waiver signing has no UI yet (Slice 1's explicit deferral — the drawn-signature
   screen has never been designed), a Student who hits this has **no in-app path to
   resolve it in this slice**. Show the real backend message as-is; do not invent a
   workaround.
2. **Rank ineligibility** (`assertRankEligible`) → a `400`-class error with its own
   message. Same treatment — surface it, don't pre-validate client-side.
3. **Class full** → `409 ConflictException`, "This Class is full for the requested
   party size — join the waitlist instead (POST /classes/{id}/waitlist)." This is the
   one case worth branching UI on: catch `ApiError` with `status === 409` on a booking
   attempt and offer a "Join waitlist" action inline, using the real message text
   rather than a generic fallback.

`AcademyClassDto` (already fetched by Slice 1's `AcademyDetailScreen`) has no live
occupancy count (`capacity` is the only field, no `seatsRemaining`) — so there's no way
to show "3 spots left" ahead of time; the 409 on attempt is the only signal, confirmed
above, and this is a genuine API limitation, not something to work around.

### What was actually built

- **`AcademyDetailScreen`** — each "Upcoming classes" row is now a `ClassBookingRow`
  (`src/bookings/ClassBookingRow.tsx`) with a real per-class state machine: idle →
  Book → (booked, or 409 → "Class is full" + Join waitlist → waitlisted → Leave
  waitlist). Any other error (waiver/rank gate, network failure) shows the real
  message inline and lets the Student retry.
- **`MyBookingsScreen`** — each row is a `BookingRow` with a Cancel action gated on
  `status === 'UPCOMING'` (confirmed enum: `UPCOMING/COMPLETED/CANCELLED/NO_SHOW`,
  `apps/api/prisma/schema.prisma`), behind a native `Alert.alert` confirm/destructive
  dialog, invalidating `['my-bookings']` on success.
- `src/bookings/bookingQueries.ts` gained `useBookClass`/`useCancelBooking`;
  `src/bookings/waitlistMutations.ts` (new) has `useJoinWaitlist`/`useWithdrawWaitlist`.

### Corrected during implementation — no "My Waitlist" screen, no "claim" UI

The planning pass above assumed a possible `GET /waitlist/me`-style endpoint might
exist; verified directly against `apps/api/src/bookings/waitlist.controller.ts` that
it does not — `WaitlistController` only exposes join/withdraw/claim, nothing that
lists a caller's own entries. Worse: `apps/api/src/jobs/waitlist-cascade-processing.processor.ts`'s
`notifyNextWaitingEntry()` — the job that's supposed to tell a Student a spot opened
up — only flips the entry's DB status to `NOTIFIED`; it never creates a Notification
row, sends a push, or does anything else observable. **There is currently no real
product flow in which a Student could ever learn a waitlist spot opened up, or
discover which entry id to claim.** So this slice does NOT build a persisted "My
Waitlist" list or a "claim" button — that would imply a working feature with no way
to actually reach it. Joining/leaving the waitlist works via the id returned directly
from the join call, held in that row's local state for the current screen session
only. **Flagged as a backend-track gap**, not silently worked around — see the spawned
follow-up task.

### Found while implementing, then corrected on a second review pass

First draft bypassed `@ultm8/api-client`'s `unwrap()` for `DELETE /waitlist/{id}`
(which succeeds with `204 No Content`) with a hand-rolled, cast-based check, since
`unwrap()` treated any empty-body response as `EMPTY_RESPONSE` — reasoned at the time
as a one-off workaround rather than a shared-package change, since no other frontend
called a 204 endpoint yet.

**A second high-effort review (8 more finder angles) found this workaround had its own
real bug**, and that the "no other consumer" premise was already false:
- `unwrap()`'s replacement — and the hand-rolled workaround it replaced — both only
  checked `result.error !== undefined`. Per `openapi-fetch`'s own source, a **non-2xx
  response with an empty body is indistinguishable from a genuine 204 success** (both
  come back as `{error: undefined, response}`) — so a failed withdraw at the network
  edge (a proxy/gateway error, a dropped connection) would have been silently reported
  as succeeding.
- `apps/api` already has a second real `204` endpoint merged
  (`DELETE /notifications/device-tokens/:id`, needed by this app's own Slice 5) —
  this codebase's own Decision 94 treats "only one real consumer so far" as
  insufficient reason to leave a shared-infrastructure bug in place once a second one
  exists.

**Fixed at the source**: `unwrap()` now branches on the real HTTP status
(`response.ok`) instead of trusting which slot openapi-fetch happened to populate, and
only flags a missing body as a problem when the status wasn't `204`. `useWithdrawWaitlist`
goes back through the same shared `unwrap()` every other call in this app uses — the
custom cast is gone entirely. Verified this doesn't regress `apps/school-portal` (the
other `unwrap()` consumer): its full `tsc`+`vite build` still passes.

Also found and fixed in this second pass: no re-entrancy guard on Book/Join
waitlist/Leave waitlist/Cancel (a fast double-tap could fire two overlapping
mutations before the button's `loading`-driven disable took effect); a failed "leave
waitlist" call discarded the waitlist entry's id permanently, with no way to recover
it (no `GET /waitlist/me` exists); and the `err instanceof ApiError ? ... : ...`
fallback-message ternary, duplicated 12 times across the whole app, got a shared
`src/lib/apiErrorMessage.ts` helper used everywhere.

### Found while interactively testing (documented, not a bug)

`react-native-web`'s `Alert.alert` is a complete no-op (`static alert() {}` —
verified in `node_modules/react-native-web/src/exports/Alert/index.js`), so the
Cancel confirmation dialog does nothing in the web preview. Real iOS/Android (this
app's actual target) are unaffected. Verified the underlying cancel logic separately
by temporarily bypassing just the dialog against a local mock server: the mutation,
`ApiError` handling, and `invalidateQueries`-triggered refetch all fired correctly.

---

## Slice 3 — Rank & Grading (read-only) — DONE

Explicitly named in Slice 1's kickoff doc as "add in a follow-up once Auth+nav is
proven" — Auth+nav is now proven. A deep-dive pass against the real code (not the
`ultm8-nestjs-module` skill's table, which doesn't mention this route's query param
at all) surfaced several things that would have led to a wrong build if assumed:

**There is no `apps/api/src/students/` module or `StudentsController`** — the route
lives in `apps/api/src/ranks/grading.controller.ts` (`GradingController`), alongside
the grading-action endpoints (promote/downgrade/skill-signoff), not in a dedicated
Students module. `GradingService.assertCallerCanReadStudent()`
(`grading.service.ts:80-82`) confirms directly: `if (callerId === studentId) return;`
— for a Student reading their own ranks, the path `{id}` is literally their own
`callerId` (`user.sub`, i.e. the JWT's `sub` claim already available via
`useAuth().claims`). No separate Student entity id exists.

**`GET /students/{id}/ranks` takes a REQUIRED `schoolId` query param** — missed
entirely in the original plan above; confirmed in the generated
`GradingController_findRanksForStudent` operation type
(`packages/api-client/src/generated/schema.d.ts`) and in the controller's own comment
("a Student's StudentRank rows are School-scoped… without it this can't know which
School's data to read"). A Student can hold multiple STUDENT RoleGrants (multiple
schools), so this can't be a standalone global "My Ranks" tab without a school picker
— **unless it's scoped by navigation context instead**. It can be: verified
`AcademiesService.findOne()` (`apps/api/src/academies/academies.service.ts:125`)
reads `tx.school.findUnique({ where: { id: schoolId } })` directly — **an Academy's
`id` IS a `School.id`**, not a separate entity. So `AcademyDetailScreen`'s existing
`academyId` route param already *is* the `schoolId` this endpoint needs. Recommended
build: a "My Rank" section on `AcademyDetailScreen` (same extend-don't-replace pattern
as Slice 2), using `academyId` as `schoolId` and `claims.sub` as `studentId` — no
school picker needed, and it reuses a screen that already exists.

**Response shape has no pagination** — `StudentRankListResponseDto` is just
`{ items: StudentRankResponseDto[] }`, no `nextCursor` (confirmed in the controller's
own comment: a StudentRank row exists per-Discipline-trained, a small bounded set, not
an unbounded log — deliberately different from `rank-history`, which IS
cursor-paginated). Use a plain `useQuery`, not `useInfiniteQuery`.

**"Raw ID, no name" is NOT the same limitation as Booking's `classId`** — a real
resolution path exists here, but it's less obvious than "just fetch a name":
- `disciplineId` → `GET /schools/{schoolId}/disciplines` (or `GET /disciplines/{id}`)
  returns a real `name` field (e.g. a style like "Brazilian Jiu-Jitsu"). **Confirmed
  a Student can actually read these**: `RanksService.findAllDisciplines`/
  `findOneDiscipline` have no `assertStaffAtSchool` gate, and the table's own RLS
  policy (`discipline_tenant_isolation`,
  `apps/api/prisma/migrations/20260914000000_ranks_module/migration.sql:51-59`) has
  no `role =` filter at all — `EXISTS (... RoleGrant WHERE schoolId matches AND
  revokedAt IS NULL)` admits ANY active grant, and the migration's own header
  comment says so explicitly ("Public-visibility catalog data… RLS shape matches
  Class/TimetableSlot/MembershipPlan/Waiver's own 'any active RoleGrant holder at
  the School' pattern"). Same policy shape covers `Rank`/`RankStripeTier`/`Skill`.
- `currentRankId` does **NOT** resolve to a text name at all — `RankResponseDto`
  (`schema.d.ts`) has no `name`/`title` field. A Rank is represented by `order`
  (a number), `primaryColour`/`secondaryColour` (belt colors), and a `stripeTiers`
  array (`RankStripeTierResponseDto`: `order`, `count`, `colour`,
  `classesRequired?`, `minimumDaysInRank?`). This is a real, martial-arts-domain-
  appropriate shape (belt + stripes, not a name) — the UI should render a colored
  belt indicator from `primaryColour`/`secondaryColour`/`order`, not try to show a
  "rank name" that doesn't exist. `StudentRankResponseDto.currentStripeId`, if not
  null, matches one entry in the current Rank's own `stripeTiers` array (fetched via
  `GET /ranks/{currentRankId}` or `GET /styles/{disciplineId}/ranks`) — resolve stripe
  count/colour from that match.

### What was built

A "My Rank" section on `AcademyDetailScreen` (`src/ranks/MyRankSection.tsx`,
`src/ranks/rankQueries.ts`) exactly per the design above: a colour swatch (primary +
secondary border) with `Rank {order}` and, if awarded, `· N stripes`, one row per
Discipline the Student has a `StudentRank` row for at this School. Renders nothing at
all when there's nothing to show — deliberately, since this screen is reached by
browsing *any* Academy (Slice 1's discovery feature), not just ones the Student is
enrolled at, so "empty" is the common case for a browsing-not-enrolled Student, not a
broken state.

### Found on review, fixed before this shipped

An 8-agent review (matching Slices 1/2's own discipline) found real issues, applied
before commit:
- **An accidental fetch waterfall**: the ranks/disciplines queries were originally
  called inside `MyRankSection` itself, which only mounts after
  `AcademyDetailScreen`'s own `useAcademy` resolves — even though this data needs
  nothing from `academy`. Fixed by hoisting `useStudentRanks`/`useDisciplines` to
  `AcademyDetailScreen`'s top level (firing in parallel with every other query the
  screen makes) and passing the query results down as props.
- **A silently swallowed discipline-fetch error**: only the ranks query's `isError`
  was checked; a failed `GET /schools/{schoolId}/disciplines` degraded silently into
  `'Unknown discipline'` on every row, indistinguishable from real, expected data.
  Fixed by surfacing it via its own `InlineError`.
- **A discipline-name race**: the section's loading gate only reflected the ranks
  query, so rows could briefly render `'Unknown discipline'` before the (separately
  fetched) real names arrived. Fixed by gating on both queries settling before
  rendering anything — verified directly: a mock server with an artificial 1.5s delay
  on the disciplines endpoint confirmed zero `'Unknown discipline'` flash once fixed.
- **The section's own dedicated loading spinner** was inconsistent with every sibling
  section on the same screen (Activities/Upcoming-classes/Timetable), none of which
  have their own loading UI — removed, now renders nothing until ready like its
  siblings.
- A candidate finding claimed Academy.id might not equal School.id (risking querying
  the wrong tenant's data) — **refuted with a direct quote chain**:
  `AcademiesController.findOne(@Param('id') id)` passes the URL param unchanged into
  `academiesService.findOne(id)`, whose parameter (named `schoolId`) is used directly
  as `tx.school.findUnique({ where: { id: schoolId } })`
  (`academies.service.ts:125-127`). Confirmed via the exact call chain, not inferred
  from the DTO shape the way the candidate finding was.

**Flagged as a backend follow-up, not fixed here** (separate task spawned): resolving
each row's Rank display info costs one `GET /ranks/{id}` call per Discipline the
Student trains, since `StudentRankResponseDto` only carries the raw `currentRankId`/
`currentStripeId` and no batch-lookup endpoint exists. Confirmed as the correct/only
client-side approach given the current API — worth a backend review of denormalizing
the resolved Rank fields onto the list response instead.

### Verified

`npx tsc --noEmit`, `npx turbo run lint build`, and `npx expo export --platform
android` all pass. Interactively tested via `expo start --web` against a local mock
server (same pattern as Slices 1/2) with two Disciplines, confirming: correct belt
colours/borders (checked via computed style, not just visual), correct stripe count
resolution, the discipline-error path surfacing the real backend message while ranks
still render (`'Unknown discipline'` fallback, not a full-section failure), and zero
console errors beyond the deliberately-triggered network failures.

---

## Slice 4 — Membership & Payments

Bigger lift than 2 or 3: real money, Stripe, and a payment UI on a platform (RN) that
needs its own SDK (`@stripe/stripe-react-native` or Stripe's own Payment Sheet) rather
than reusing anything web-side. Needs its own "real decision" pass before scoping in
detail — at minimum: which Stripe RN integration, and how Apple Pay/Google Pay
support is handled (a real product decision, not a coin flip). Do not start this by
copying assumptions from `apps/school-portal`'s payment code without checking whether
it exists there yet at all.

## Slice 5 — Notifications (client-side groundwork)

`POST /notifications/device-tokens` (device token registration) and
`GET /notifications/me` both exist and are real, safe reads/writes — but actual
FCM/APNs *dispatch* is deferred server-side (Decision 95). This slice is registering
the token and showing an in-app notification list/badge; it explicitly does NOT imply
push notifications will arrive on-device, and the UI should not suggest they will.

---

## Explicitly blocked — do not scope a slice for these yet

- **Waiver signing** — Decision 74/78 confirm typed-name + drawn-signature is legally
  required, but the drawn-signature capture screen has never been designed anywhere
  (Figma shows typed name only). Needs a design pass before this becomes a buildable
  slice. Also directly blocks part of Slice 2 (see above) for any class that requires
  a waiver — that's accepted as a known gap for Slice 2, not a reason to build a
  signature pad from assumption.
- **Attendance QR check-in** — genuinely unresolved, not just deferred: QR payload
  contents, generation, and client-side scan/decode are all unconfirmed
  (`ultm8-domain-rules` §12/§18). Needs a backend/product decision first.
- **Guardian-facing screens** (linking a minor, consent management) — no
  consent-management UI exists in any confirmed design, and Guardian-enrolling-a-minor
  into a School is explicitly unbuilt server-side too (Decision 96). Needs both a
  design pass and a backend phase before this is scoped.
- **Per-School white-label branding** — `packages/build-pipeline` is still an unbuilt
  placeholder; nothing to build against yet.
- **Offline behavior / caching strategy** — unconfirmed anywhere in the spec, any
  skill, or the decision log. Not scoped until someone explicitly asks for it.
- **Invoice/receipt viewing, Student-scoped transaction history** — the endpoints
  these would need don't exist yet as real controllers, despite appearing in a
  "representative" table in one of the skills.

---

## Recommendation

Slices 2 and 3 are both done — see their own sections above for what shipped, what was
corrected during/after implementation, and what was found on review and while
interactively testing. Build **Slice 5 (Notifications, client-side)** next — device
token registration + an in-app list, no pending product decision. **Slice 4
(Membership & Payments)** needs a real decision (which RN Stripe integration, Apple/
Google Pay scope) before it can be scoped in detail — see its own section for a
recommendation, held for the user's call rather than an autonomous guess on a payment
flow.
