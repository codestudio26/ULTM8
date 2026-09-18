# Track B — Student App Roadmap

Phase structure for `apps/student` beyond Slice 1. Same scope discipline as every
slice so far (and the backend track's own Phase 1): each slice pulls in only what it
actually needs; anything requiring a design pass that doesn't exist yet, or a backend
capability that isn't built, is named explicitly and held out rather than guessed at.

Every slice below cites the real controller/service code it's grounded in — verified
directly against `apps/api/src/**`, not the `ultm8-nestjs-module` skill's own
"representative" endpoint table (already known to be stale in places, per Slice 1's
kickoff doc).

## Phase overview

A "Slice" is one concrete, shippable build unit (matches the git commit history — each
one is its own commit). A "Phase" groups Slices by theme, for planning at a glance.
Detail for each Slice is in its own section below; this table is the map.

| Phase | Theme | Slices | Status |
|---|---|---|---|
| 1 | **Foundation** | 1 (walking skeleton), 2 (booking/waitlist), 3 (rank/grading) | ✅ DONE |
| 2 | **Engagement** | 5 (notifications, read-side) | ✅ DONE |
| 3 | **Commerce** | 4a (Cash/Bank membership purchase + My Memberships), 4b (Stripe/PaymentSheet) | 4a ✅ DONE; 4b blocked on your decision |
| 4 | **Compliance & Guardian** | 6a (waiver signing, typed name), 6b (drawn-signature), 7 (Guardian-facing screens) | 6a unblocked (in V1); 6b/7 blocked — need a design pass; partially unblockable by syncing with `master` (see below) |
| 5 | **Attendance** | 8 (QR check-in) | Blocked — genuinely unresolved even on `master`, needs a backend/product decision on the QR mechanism itself |
| 6 | **Platform** | 9 (per-School white-label branding) | Blocked — `packages/build-pipeline` is still an unbuilt placeholder on `master` too |
| 7 | **Resilience** | 10 (offline behavior/caching) | Not scoped — nothing in the spec, any skill, or the decision log addresses this; don't start until someone asks with real requirements |

**Cross-cutting prerequisite, not a phase of its own: syncing `track-b-student-app`
with `master`.** As of this doc, the branch is 60+ commits / 27+ backend phases behind
`master`, which has since shipped (backend-only — no client UI anywhere yet, verified):
Waiver drawn-signature capture (`master`'s Phase 34) and Guardian-on-behalf-of flows
across Schools/Waivers/Memberships/Bookings/Waitlist (Phases 37–42). Syncing wouldn't
fully unblock Phase 4 (Compliance & Guardian) on its own — the *client* UI (a
drawn-signature capture screen, Guardian consent screens) still needs designing and
building either way — but it would remove the *backend* half of that blocker, leaving
only the design-pass gap. Checked and confirmed **not** resolved on `master` either:
QR check-in's payload/generation mechanism (Phase 5) and the white-label build
pipeline (Phase 6) — syncing doesn't change those. This sync is deliberately not
decided or actioned here — same reasoning as the earlier decision to hold it.

---

## Version 1 Plan (decided with the user, 2026-09-18)

This section is the authoritative scope for "Version 1" — the release the user will
review and approve before it's considered launch-ready. Anything not listed here as
in-scope is deliberately deferred, not forgotten.

**In scope for V1:**
- Slices 1, 2, 3, 4a, 5 — already shipped (see their sections below).
- Fix the Membership authorization gap flagged in Slice 4a's review
  (`MembershipsService.findAllPlans()`/`purchase()` appear to have no tenant/enrollment
  check beyond a valid Student JWT) — a real security risk, must close before V1 ships.
- Extract the shared paginated-list component (now duplicated 4x across
  `ClassBookingRow`/`NotificationRow`/`MembershipRow`/the underlying list-screen shape).
- A real staging deployment of `apps/api` + Postgres (+ Redis) on Railway, so V1 is
  verified against the genuine backend, not indefinitely against throwaway mocks.
  Pending: the user creating a Railway account and connecting the GitHub repo — this
  can't be done on their behalf (account creation / payment details are always the
  user's own action).
- QR check-in (Phase 5) — direction decided: **Student displays a rotating, signed QR
  code; a Staff member scans it to check them into a specific class session** (not
  School-displays/Student-scans). Chosen because a Staff-verified scan can't be faked
  by sharing a photo of a static code, and it ties cleanly to real attendance for
  rank/stripe progression — both matter more here than in a typical gym app given the
  youth-safety context already central to this spec. Still needs real scoping before
  build: a token-minting endpoint, and a Staff-facing scanner surface (likely
  `apps/school-portal`, not `apps/student`) — treat as its own small sub-project, not
  a same-day add.
- Offline (Phase 7) — scoped narrowly to **light read-only caching**: previously-loaded
  screens (bookings, timetable, ranks) stay viewable with no connection. No offline
  writes, no sync, no conflict resolution — chosen specifically because it needs zero
  new business-logic decisions and carries no correctness risk, unlike full offline-first.

**Deferred past V1 (fast-follow candidates, not abandoned):**
- Slice 4b (Stripe/PaymentSheet) — deferred to avoid shipping the highest-risk,
  money-touching code in the very first release. Ship Cash/Bank first, validate with
  real usage, add Stripe once the rest of the app is proven stable in production.
- White-label per-School branding (Phase 6) — `packages/build-pipeline` is an empty
  placeholder even on `master`. This is a standalone business/infrastructure decision
  (one app with dynamic theming vs. a separate app-store listing per School) deserving
  its own dedicated conversation, not a quick unblock alongside the student app.
- Full offline-first with write-sync — needs real conflict-resolution design first;
  only the light read-only caching above is in V1.

**Correction (2026-09-18): Waiver signing is NOT blocked — only the drawn-signature
enhancement is.** Verifying `apps/api/src/waivers/dto/sign-waiver.dto.ts` directly
(not just the roadmap's earlier summary of the decision log) shows the CURRENT,
CONFIRMED `POST /waivers/{id}/sign` contract is two typed-text fields —
`signerFullName` and `signatureText` — with the DTO's own comment stating plainly
"Neither field accepts drawn/canvas signature data this phase." This is a fully
buildable, zero-schema-change feature today, not a design-blocked one. Moved to
**in scope for V1** as **Slice 6a — Waiver Signing (typed name)**:
- `GET /schools/{schoolId}/waivers` (all Waivers for the Student's enrolled School,
  resolved from their own JWT `grants` — no new endpoint needed) cross-referenced
  against `GET /waivers/me` (their own signatures) to show signed vs. pending.
- `POST /waivers/{id}/sign` with a typed full-name + typed-signature-text form.
- The confirmed self-attested-adult (18+) gate (`WaiversService.assertSelfAttestedAdult`)
  rejects an under-18 caller outright — shown honestly via the real backend message
  (which already names the real reason: no Guardian-linked path exists yet), not
  hidden or worked around.
- Explicitly NOT wiring this into the booking flow's unsigned-waiver gate this
  slice — `WaiversController`'s own header comment confirms "no Booking-time
  enforcement" exists yet either, so `ClassBookingRow`'s existing honest-error-message
  behavior is left as is (a small, purely client-side deep-link is a real gap this
  slice's own review noticed — spawned as a separate follow-up, not built here).

**Slice 6a shipped (2026-09-18).** Built: `WaiversScreen` (off Home), `WaiverRow`
(typed name + typed signature, deriving its "Signed" state directly from the
mutation's own returned data, not a round-tripped prop), and `useEnrolledSchoolId`
(`AuthContext.tsx`, mirroring `apps/school-portal`'s own `useOwnedSchoolId`).

An 8-agent review found real issues, fixed before commit:
- **Unstable school selection**: `AuthService`'s token issuance has no `orderBy` on
  the RoleGrants it signs into the JWT, so picking "the first STUDENT grant" could
  resolve to a different School on different logins for a multi-School Student.
  Fixed with a deterministic sort — still only resolves one School (a real,
  separate follow-up is spawned for proper multi-School support), but at least a
  stable one.
- **A signed-status race**: the screen's loading gate only reflected the Waivers
  query, not the separate signatures query — if Waivers resolved first, every
  already-signed Waiver would briefly show an active "Sign" button, and tapping it
  hit the backend's 409. Fixed by gating on both queries settling, the same
  discipline Slice 3's `MyRankSection` already established.
- **A post-signature double-submit window**: the row only left its sign-form once
  the parent's `signature` prop updated (a full refetch round-trip), not the
  instant the mutation itself succeeded. Fixed by deriving the signed state
  directly from the mutation's own returned data, matching `MembershipPlanRow`'s
  already-fixed pattern.
- **Two silent-truncation gaps**: `signature.status` was never checked (latent —
  only matters once a non-SIGNED status is ever written), and the signatures list
  was fetched with no page-size override, silently missing anything past the
  default 20. Fixed with a status filter and a `limit: 100` request.

**Flagged as follow-ups, not fixed here** (separate tasks spawned): proper
multi-School support (querying and merging every enrolled School's Waivers, not
just one), and a deep-link from `ClassBookingRow`'s unsigned-waiver error to this
new Waivers screen.

**Verified**: `npx tsc --noEmit`, `npx turbo run lint build`, and `npx expo export
--platform android` all pass. Interactively tested via `expo start --web` against a
local mock server: correct signed/unsigned status per Waiver, a real sign
submission (`POST /waivers/{id}/sign`) returning 201 and the row flipping to
"Signed ✓" immediately with no error, and no console errors beyond expected ones.

**Still genuinely blocked, path forward identified:**
- Guardian consent screen (Phase 4) — confirmed via direct research: no Figma design,
  no screen inventory, no mockup exists anywhere for it — nothing beyond the backend
  `ConsentRecord`/`GuardianLink` data model. `skills/ultm8-domain-rules/SKILL.md` tags
  it `[UNRESOLVED]` outright: "No consent-management interface... exists anywhere in
  the confirmed designs." The drawn-signature capture enhancement for Waivers (on top
  of the typed-name version now in V1 above) is the other half of this same gap —
  Decision 74 flags it as "still undesigned... for the Architect / design work before
  this can be built," and would need a `WaiverSignature` schema change besides.
  Building either without a real design would mean inventing unconfirmed business
  logic — the thing this doc's own source-of-truth rules exist to prevent. **Path
  forward**: a candidate Guardian consent screen will be drafted and shown to the user
  for approval before any wiring to real backend logic — that approval stands in for
  the missing design pass, rather than leaving this blocked indefinitely with no way
  to move. The drawn-signature enhancement stays parked behind that same design pass
  plus the separate schema-change decision.

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

## Slice 4a — Membership purchase, Cash/Bank + free-plan path (buildable now, no Stripe)

Split out from the original Slice 4 once `MembershipsService.purchase()` was read in
full: the `requires_payment` (Stripe) branch is only reached when the School's
`PaymentAccount.provider === 'STRIPE'`. On a Cash/Bank-only School, or for a £0-priced
plan on any School, `purchase()` returns `active` or `pending_confirmation` — neither
needs a Stripe SDK, a native module, or the dev-client workflow change Slice 4b
requires. This is real, valuable, and fully testable in the same web-preview workflow
every other slice has used.

**Confirmed real API surface**:
- `academy.membershipPlans` (`AcademyMembershipPlanDto[]`) is already fetched by
  Slice 1's `useAcademy` — unused until now.
- `POST /membership-plans/{id}/purchase` — empty body. Response is the discriminated
  union above: `active` (immediate — confirmed only reachable for `FRIEND_PASS` is
  blocked entirely from self-purchase, so effectively £0-priced
  `CLASS_PACK`/`WEEKLY_PASS`/`TRIAL_MEMBERSHIP`/`SUBSCRIPTION`-that-happens-to-be-free
  — though `SUBSCRIPTION` always requires Stripe per its own check, so in practice
  this is a non-Subscription £0 plan), `pending_confirmation` (Cash/Bank, non-zero
  price — a `Transaction` is created `PENDING`; a Staff member confirms it later via
  `PATCH /transactions/{id}/confirm`, out of scope for the Student app), or
  `requires_payment` (Stripe — out of scope for this slice, show an honest "online
  payment isn't available in the app yet" message rather than a dead end with no
  explanation).
- `MembershipPlanType` (`CLASS_PACK`/`WEEKLY_PASS`/`FRIEND_PASS`/`TRIAL_MEMBERSHIP`/
  `SUBSCRIPTION`, `apps/api/prisma/schema.prisma`) — `FRIEND_PASS` is School-gifted
  only; `purchase()` throws a 400 if a Student attempts to self-purchase one. Don't
  show a working "Buy" button for it — the real error would just confuse a Student
  who never should have seen the option.
- `GET /memberships/me` — a Student's own current Memberships
  (`MembershipListResponseDto`, cursor-paginated, same convention as My Bookings).
  `MembershipStatus` is `ACTIVE`/`EXPIRED` (`schema.prisma`).

**Planned build**: a "Membership Plans" section on `AcademyDetailScreen` (same
extend-don't-replace pattern as every prior slice) listing `academy.membershipPlans`,
each with a "Purchase" action reflecting the real outcome; and a new "My Memberships"
screen (`GET /memberships/me`) off the Home screen, matching My Bookings' shape.

### What was built

A "Membership Plans" section on `AcademyDetailScreen` (`src/memberships/
MembershipPlanRow.tsx`) rendering each of `academy.membershipPlans` with its price,
class count, and expiry window, plus a "Purchase" action wired to
`usePurchaseMembership()` (`src/memberships/membershipQueries.ts`) that renders the
correct outcome message for all three real outcomes (`active`,
`pending_confirmation`, `requires_payment`) directly from the mutation's own state. A
new "My Memberships" screen (`src/memberships/MyMembershipsScreen.tsx`, off Home) lists
`GET /memberships/me` via `useMyMemberships()`, resolving each membership's plan title
through a small in-memory `planNameCache` (`src/memberships/planNameCache.ts`)
populated whenever `AcademyDetailScreen` fetches a School's plans, falling back to the
raw plan id for a plan the Student never browsed that way.

### Found on review, fixed before this shipped

An 8-agent review found real issues, applied before commit:
- **A 100x money-display bug**: prices were rendered as raw `plan.price` (e.g. `2500`)
  instead of converted from minor units — cross-checked against the Prisma schema's own
  comment confirming `price` is stored in cents. Fixed with a new `formatMoney()`
  helper (`src/lib/formatMoney.ts`) using `Intl.NumberFormat` currency formatting.
- **Duplicated, unmirrored purchase state**: the original row kept its own `RowState`/
  `actionError` local state set via `mutateAsync` + try/catch, risking a
  setState-after-unmount if the Student navigated away mid-purchase, and letting
  `actionError` drift from `purchase.error`. Fixed by reading `purchase.isSuccess`/
  `purchase.data.outcome`/`purchase.isError` directly from the mutation, with
  `purchase.mutate()` instead of the async form.
- **`plan.type === 'FRIEND_PASS'` checked twice** (once to hide the Purchase button,
  again to show the "ask School staff" message) — deduplicated into one `isFriendPass`
  constant.
- **Falsy-zero bugs**: `classesIncluded`/`expiryDurationDays` were gated with a plain
  truthy `?` check, which would silently hide a real `0` value. Fixed with explicit
  `!= null` checks.
- A minor `paddingVertical` inconsistency (`10` vs. the `8` every sibling row in this
  slice uses) — fixed to match.

**Flagged as backend follow-ups, not fixed here** (separate tasks spawned):
- `MembershipsService.findAllPlans()`/`purchase()` appear to have no tenant/enrollment
  authorization check beyond a valid Student JWT — worth a dedicated backend security
  review, not something the client can compensate for.
- Neither `AcademyMembershipPlanDto` nor `AcademyDetailDto` exposes any signal for
  whether a plan's School uses Stripe, so a tap on a Stripe-backed plan still runs the
  real server-side `purchase()` branch — creating an actual `Transaction` row and a live
  Stripe PaymentIntent — before the client can show its "not available yet" message.
  A `requiresOnlinePayment` field on the plan DTO would let the client pre-filter
  instead of discovering this after the fact.

**Deliberately deferred, not started**: `MembershipPlanRow` is now the 4th list-item
component in this app following the same "row component + paginated-list screen"
shape (after `ClassBookingRow`, `NotificationRow`, `MembershipRow` itself for the
list-item half). A shared extraction is due, but scoped as its own follow-up task
rather than folded into this slice.

### Verified

`npx tsc --noEmit`, `npx turbo run lint build`, and `npx expo export --platform
android` all pass. Interactively tested via `expo start --web` against a local mock
server, confirming: all plan prices display correctly after the `formatMoney` fix,
`FRIEND_PASS` shows no Purchase button, all three purchase outcomes render their
correct message after clicking Purchase, and the `planNameCache` cross-screen
behaviour is correct — a previously-browsed plan (`plan-classpack`) resolves to its
real title ("10-Class Pack") on the My Memberships screen via cache-hit, while a
membership referencing a plan never browsed that way (`plan-never-seen`) falls back
to the raw-id display ("Plan plan-never-seen"), confirmed using only in-app
navigation (not a full page reload) to keep the in-memory cache alive across screens
during the test.

---

## Slice 4b — Stripe/PaymentSheet path — researched, recommendation below, NOT built

Real money, real Stripe integration, a genuinely new "real decision" — not built this
session per the user's own explicit instruction to set aside anything needing their
judgment rather than guess on a payment flow. What follows is the research needed to
make that decision, grounded in the real backend code, not assumed.

### There is no existing precedent anywhere in this codebase to copy

Checked `apps/school-portal/src` for any existing payment/Stripe/membership UI —
**none exists**. This would be the first payment UI in any of ULTM8's three frontend
apps. No shortcuts, no "just match what school-portal does" available.

### The real API shape — confirmed directly in `MembershipsService.purchase()`

`POST /membership-plans/{id}/purchase` (`apps/api/src/memberships/memberships.service.ts:181-271`)
returns a discriminated union
(`PurchaseMembershipResponseDto`, `packages/api-client/src/generated/schema.d.ts:1892-1901`):
- `{ outcome: 'active', membership }` — an immediate grant (confirmed: only reachable
  for a £0-priced plan, e.g. a Cash/Bank-eligible free plan; `FRIEND_PASS` is
  explicitly blocked from self-purchase here — School-gifted only, no client UI to
  build for it).
- `{ outcome: 'requires_payment', clientSecret, transactionId }` — **a real Stripe
  `PaymentIntent` client secret**, returned for both one-time (`charge()`) and
  recurring (`subscribe()`) Stripe-backed plans.
- `{ outcome: 'pending_confirmation', transactionId }` — the Cash/Bank-Transfer path
  (not yet read in full this pass, but implied: no client-side payment UI needed,
  just an "awaiting confirmation" state).

**This settles the "which SDK" half of the decision on its own**: a real
`clientSecret` returned from the backend is exactly what Stripe's own
**`@stripe/stripe-react-native`** package (specifically its **PaymentSheet**
component) is built to consume — not a Checkout redirect, not a WebView, not a
custom-built card form. PaymentSheet takes the `clientSecret`, presents Stripe's own
pre-built, PCI-compliant, accessible payment UI, and handles the confirmation
round-trip. This is close to a forced technical conclusion given what the backend
already returns, not really "a coin flip" the way the original plan framed it — the
open decision is narrower than originally stated (see below).

### The real open decision: not "which SDK," but "what does adopting it cost right now"

`@stripe/stripe-react-native` has native modules — **it does not run in Expo Go**.
Using it means this app needs a custom dev client
(`npx expo install expo-dev-client` + an EAS development build) from this point
forward for anyone testing payment screens, which is a real, standing workflow change
for the whole track, not a one-line dependency add. This is the actual decision to
make, more than "which library":

1. **Adopt the custom-dev-client workflow now**, accepting that `expo start --web`
   (this session's whole verification method) can no longer exercise this specific
   screen — PaymentSheet has no web target at all — and every future Slice 4 change
   needs a real EAS build or a local native build to test. The Codespaces devcontainer
   already cherry-picked onto this branch doesn't currently forward EAS/native-build
   tooling either; that would need its own look.
2. **Scope Slice 4 to card payments only for a first cut**, deferring Apple
   Pay/Google Pay wiring to a follow-up. PaymentSheet supports both automatically once
   configured, but each needs its own real-account setup independent of the SDK
   choice: Apple Pay needs a paid Apple Developer account, a Merchant ID, and a real
   device or EAS build (never Simulator); Google Pay needs a Google Pay/Business
   Console merchant id. Neither is a code decision — both are real external-account
   setup this session has no way to do or verify.
3. **The Cash/Bank-Transfer (`pending_confirmation`) path needs no Stripe SDK at
   all** — if a School's `PaymentAccount` isn't Stripe-backed, this could plausibly
   ship as its own, much smaller slice first (an informational "payment pending
   confirmation" screen, no native module, testable in the existing web-preview
   workflow) — worth asking the user whether that's worth splitting out rather than
   waiting on the Stripe decision to unblock everything membership-related.

### Recommendation

`@stripe/stripe-react-native`'s PaymentSheet, card-only for a first cut, Apple/Google
Pay as an explicit follow-up once real merchant accounts exist — but the decision that
actually needs the user's sign-off isn't the library, it's **taking on the
custom-dev-client workflow change** (losing the web-preview verification path this
whole track has relied on) **right now**, versus shipping the non-Stripe
`pending_confirmation` path first as a smaller, unblocking slice.

## Slice 5 — Notifications — DONE, with a scope change from the original plan below

`POST /notifications/device-tokens` (device token registration) and
`GET /notifications/me` both exist and are real, safe reads/writes — but actual
FCM/APNs *dispatch* is deferred server-side (Decision 95). This slice was originally
planned as registering the token and showing an in-app notification list/badge; it
explicitly does NOT imply push notifications will arrive on-device, and the UI should
not suggest they will.

### Scope change, found during implementation — flagged here per CLAUDE.md, not just in code

**Device-token registration was NOT built.** The plan above treated it as "real, safe"
and didn't account for what registering one actually costs client-side: a real
push-capable token needs `expo-notifications` (a new native module), OS permission
prompts, and — for Expo's own push service — an EAS project actually configured for
it. None of that exists in this app yet, and pulling it in now would be new
infrastructure serving a capability whose other half (server-side FCM/APNs dispatch)
is explicitly deferred (Decision 95) — the same "defer anything pulling in new
infrastructure to its own phase" discipline this track has used since Slice 1.
Registering a placeholder/fake token instead (to exercise the API without the real
native work) was considered and rejected — that would be building something that
*looks* functional but can never actually receive anything, which is its own kind of
dishonesty about what's built. **Revisit once server-side push dispatch is real.**

**No unread-count badge was built either**, for a related but distinct reason: no
`GET /notifications/unread-count`-style endpoint exists, so a Home-screen badge would
mean fetching the *entire* notification list just to count unread ones — a redundant
network call on every Home-screen render for a "first cut" nice-to-have. Deferred
until either a dedicated count endpoint exists or the cost is judged worth it.

### What was built

`NotificationsScreen` (`src/notifications/`): a cursor-paginated list (`GET
/notifications/me`, same infinite-query convention as Academies/My Bookings) with a
"Mark as read" action per unread row (`PATCH /notifications/{id}/read`). The `type`
field on `NotificationResponseDto` is explicitly "not spec-confirmed" (per the
generated type's own comment) — deliberately not used for any icon/categorization UI.

### Found on review, fixed before this shipped

- **Mark-read invalidated the entire notification list** instead of patching the one
  changed item — the first cursor-paginated list in this app a single-item mutation
  targets, so a full invalidate would refetch every already-loaded page for a
  one-field change. Fixed with a targeted `queryClient.setQueryData` patch.
- **A duplicated local error state** shadowed the mutation's own `isError`/`error` —
  removed in favor of reading the mutation's own state directly, dropping the
  redundant try/catch wrapper too.
- **Raw ISO timestamps** (`notification.createdAt`, and — found to be a pre-existing,
  second occurrence — `ClassBookingRow`'s `startDate`/`endDate` from Slice 2) had no
  shared formatter anywhere in the app. Added `src/lib/formatDate.ts` and used it in
  both places rather than let a third screen copy the raw-string pattern as "the
  convention."
- **Missing accessibility labels** on the unread indicator (a bare colored `View`
  with no way for a screen reader to convey read/unread state) — added.

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

Slices 2, 3, 4a, and 5 are all done — see their own sections above for what shipped,
every scope change (each recorded here, not just in code comments), and what was found
on review and while interactively testing.

**Slice 4b (Stripe/PaymentSheet)** is the only remaining item from the original
Slices 1-5 roadmap, and it's genuinely blocked on the user's own decision, not on
further research — the API shape is fully confirmed (see its section above), and the
open question isn't "which library" (already settled: `@stripe/stripe-react-native`'s
PaymentSheet) but whether to take on the custom-dev-client workflow change (losing this
track's web-preview verification method) right now. Since Slice 4a shipped the
non-Stripe `pending_confirmation`/`active` paths as the smaller, unblocking slice,
Slice 4b is purely additive whenever that decision is made.

With Phase 3 (Commerce) now effectively as far along as it can go without that
decision, the next genuinely unblocked candidate is the shared paginated-list
component extraction flagged in Slice 4a's section above (4th occurrence of the same
row-component/list-screen shape). Phases 4-7 (Guardian/Waiver, QR check-in,
white-label, offline) all remain blocked on design passes, backend decisions, or the
`master`-sync question described in the Phase overview table.

Several follow-ups are already spawned and tracked outside this doc: the waitlist
notification-dispatch backend gap (Slice 2), the StudentRank-detail-denormalization
question (Slice 3), and the Membership authorization-check / Stripe-provider-signal
gaps (Slice 4a).
