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
| 4 | **Compliance & Guardian** | 6a (waiver signing, typed name), 6b (drawn-signature), 7 (Guardian-facing screens) | 6a ✅ DONE; 7 ✅ candidate committed (My Minors + consent grant/withdraw); 6b still blocked — needs a design pass + schema change; partially unblockable by syncing with `master` (see below) |
| 5 | **Attendance** | 8 (QR check-in) | Scoped (2026-09-22), not yet built — the backend endpoint already exists (`POST /attendance/scan`); needs your call on 2 remaining product questions + a new `apps/school-portal` screen |
| 6 | **Platform** | 9 (per-School white-label branding) | Blocked — `packages/build-pipeline` is still an unbuilt placeholder on `master` too |
| 7 | **Resilience** | 10 (offline behavior/caching) | ✅ DONE (light read-only caching via react-query persistence) |

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
  ✅ **DONE (2026-09-22), with a correction**: the screen-shell extraction this line
  describes had already shipped as `PaginatedListScreen.tsx` (used correctly by
  Academies/My Bookings/Notifications/My Memberships). `ClassBookingRow`/
  `MembershipPlanRow` were never pagination logic at all — they render a School's
  embedded array from a single `useAcademy` fetch, not a `useInfiniteQuery`. What
  remained was the follow-up already named below: 4 near-identical `useInfiniteQuery`
  hook bodies (`academyQueries`/`bookingQueries`/`membershipQueries`/
  `notificationQueries`), collapsed into one `usePaginatedQuery(queryKey, fetchPage,
  options?)` helper in `apps/student/src/lib/usePaginatedQuery.ts` — each call site
  keeps its own typed `apiClient.GET`/`unwrap` call, only the `useInfiniteQuery`
  wiring (initialPageParam/getNextPageParam) is shared. Net -14 lines across 4 files.
  Query keys are unchanged, so `PERSISTED_QUERY_KEY_PREFIXES`'s allowlist in
  `queryPersister.ts` is unaffected.

  **Also fixed in the same pass**, since it sits in a function this touched and was
  already named below as a spawned follow-up: the pre-existing timetable pagination
  bug. `AcademyDetailScreen` destructured only `useAcademyTimetable`'s `data`, never
  wiring `fetchNextPage`/`hasNextPage` — so any School with more Timetable slots than
  the server's default page size silently showed only the first page, with no
  indication more existed. Fixed with a "Load more" `Button` (reusing the existing
  `variant="secondary"`/`loading` props), not `onEndReached`-style infinite scroll —
  this screen is a `ScrollView` holding several sections (Activities/Plans/
  Rank/Classes/Timetable), not a single `PaginatedListScreen`-style `FlatList`.

  **Verified**: `npx turbo run lint build --filter=@ultm8/student` (`tsc --noEmit`
  both ways) passes clean, run together this time — no repeat of the earlier
  transient OOM some other slices hit running lint+build in parallel. **Not**
  interactively click-tested via `expo start --web` — no mock backend server exists
  in this checkout for this session, and standing one up was judged disproportionate
  for a mechanical hook-signature refactor plus a `fetchNextPage` wiring fix that
  reuses an already-proven pattern (`PaginatedListScreen`'s own identical
  fetchNextPage/hasNextPage/isFetchingNextPage usage, and `Button`'s already-used
  `loading` prop) rather than new logic. Flagged here rather than silently assumed.
- A real staging deployment of `apps/api` + Postgres (+ Redis) on Railway, so V1 is
  verified against the genuine backend, not indefinitely against throwaway mocks.
  Pending: the user creating a Railway account and connecting the GitHub repo — this
  can't be done on their behalf (account creation / payment details are always the
  user's own action).
- Offline (Phase 7) ✅ **DONE (2026-09-22)** — scoped to **light read-only caching**:
  previously-loaded screens stay viewable with no connection, including across an app
  restart (not just mid-session), via `@tanstack/react-query-persist-client` +
  AsyncStorage. No offline writes, no sync, no conflict resolution — mutations are
  excluded by react-query's own default regardless of this feature.

  An 8-agent review found this was more consequential than a routine wiring task and
  caught two real issues, both fixed before commit:
  - **Persisted sensitive data unfiltered**: the first version persisted every
    successful query indiscriminately, including a Student's actual typed Waiver
    signature text and a Guardian-linked minor's name/DOB/consent status — to plain,
    unencrypted AsyncStorage, for up to 24h. This codebase already treats that
    distinction seriously elsewhere (the JWT itself lives in `expo-secure-store`,
    never AsyncStorage, specifically because AsyncStorage is unencrypted). Fixed by
    switching from an implicit "persist everything" default to an explicit
    **allowlist** (`PERSISTED_QUERY_KEY_PREFIXES` in `queryPersister.ts`) matching
    this phase's own named scope (academies, bookings, notifications, ranks,
    memberships) — Waiver and Guardian query keys are deliberately never persisted.
  - **The feature didn't actually deliver its own promise for most screens**:
    `AcademyDetailScreen`, `MyRankSection`, `MyMinorsScreen`, and `MinorConsentScreen`
    all checked `isError` *before* checking whether cached data existed — so a
    background refetch failure (which happens on essentially every screen mount while
    offline, confirmed: no NetInfo/`onlineManager` wiring exists to short-circuit
    that) replaced perfectly good cached content with a full-screen error banner.
    Only the `PaginatedListScreen`-based screens (already fixed in an earlier slice's
    own review) got this right. Fixed by applying that same "data takes precedence
    over a stale isError" rule to all four screens.
  - Also fixed: a comment overclaiming that `logout()`'s explicit
    `asyncStoragePersister.removeClient()` call "immediately" clears the persisted
    cache — react-query's own cache-clear notifications are deferred, so the ordering
    isn't actually guaranteed (though no real data leak was possible either way,
    confirmed by tracing the library's own source); and an unhandled-promise-rejection
    risk on that same call.

  **Flagged as follow-ups, not fixed here** (separate tasks spawned): unbounded
  `useInfiniteQuery` page growth for the persisted paginated queries (no `maxPages`
  set, so a long scroll history grows the persisted blob indefinitely), and missing
  `NetInfo`/`onlineManager` wiring (offline screen mounts still attempt and fail a
  real fetch before falling back to cache, rather than detecting offline immediately).

  **Verified**: `npx tsc --noEmit` clean (run sequentially, not via `turbo run
  lint build` in parallel — that combination triggered a transient
  out-of-memory crash on this machine unrelated to the code, confirmed by the
  identical command succeeding when run alone). The actual persistence mechanism
  (save, restart-restore, logout-clear, no-leak-between-users, maxAge-expiry, and the
  security allowlist) was proven via an isolated Node script exercising the real
  `@tanstack/query-persist-client-core`/`@tanstack/query-async-storage-persister`
  libraries directly — chosen specifically because the machine's memory pressure
  made running the full Metro/Expo web bundler for a click-through test unreliable,
  and because this particular claim (data survives a restart) can't be distinguished
  from "a fresh fetch happened to be fast" through a UI alone anyway.

**QR check-in (Phase 5) — correction (2026-09-22): the earlier direction was wrong
given what's actually built, not just under-scoped.** Reading `apps/api/src/attendance/`
directly (not just SKILL.md's summary) found a real, already-built, already-shipped
endpoint: `POST /attendance/scan { bookingId }` (Phase 13). It's **strictly
self-service** — it requires the caller's own JWT to match the Booking's `studentId`
(`booking.studentId !== callerId` → 404), checks the Class's configured check-in
window (`Class.qrAttendanceEndAt`, Staff-set at Class creation), checks camera-tier
consent hasn't been withdrawn, then marks the Booking `COMPLETED` and increments rank
progress. **This makes "Staff scans a Student's QR" — the direction previously
recorded here — structurally incompatible with the one piece of this system that's
actually been built**: a Staff member's own JWT could never satisfy
`booking.studentId === callerId`. That would need a genuinely different, separate
endpoint (the "Instructor roll-call scan," `POST /classes/{id}/attendance-scan`,
confirmed only as a *named concept* by Decision 71 — its mechanics are explicitly
undesigned, and it isn't built).

What IS still genuinely unresolved (SKILL.md §12, a binding constraint per Decision
66): the QR code itself must be "time-boxed, rotating... never a single static code,"
but **nothing server-side ever validates the QR's contents** — the real enforcement
(booking ownership, time window, consent) is already 100% handled by the existing
endpoint regardless of what triggers the call. That means the QR's actual job is
narrower than it first appears: proving the Student is physically at the venue right
now (a code that only exists live, on a screen at the venue, can't be satisfied by a
screenshot from home) — not carrying a cryptographically-verified payload.

**Corrected direction**: an Instructor/Staff device (a new `apps/school-portal`
screen — a different app than `apps/student`) displays a rotating code, scoped to a
specific live Class session; the Student scans it with their own phone and the
**already-built** `POST /attendance/scan` fires using the Student's own identity and
their own already-known `bookingId` for that Class (visible to them via "My
Bookings"). No new backend endpoint is required for the core flow — only a
QR-scanning capability in `apps/student` and a QR-display screen in
`apps/school-portal`. The Instructor roll-call fallback (Decision 71) stays a
separate, genuinely unbuilt follow-up, not a blocker for this.

**Still open, needs your call before building**: exactly what the rotating code
encodes (a `classId` + a short-lived nonce the client only uses to gate *when* a
"Check in" action becomes available is the minimal design — the nonce need not reach
the backend at all, given it doesn't validate one today) and where that display
screen lives operationally (an Instructor's own phone running `apps/school-portal`
during class vs. a fixed venue tablet/kiosk) are real product decisions, not
technical ones this doc should guess at.

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

**Guardian consent candidate — drafted, reviewed, and committed (2026-09-22).**
Confirmed via direct research: no Figma design, no screen inventory, no mockup
existed anywhere for this — nothing beyond the backend `ConsentRecord`/`GuardianLink`
data model, which is itself real and confirmed (`apps/api/src/guardians/`).
`skills/ultm8-domain-rules/SKILL.md` tags the consent-management interface
`[UNRESOLVED]` outright. Per this doc's own "path forward," a candidate screen was
built against the real, confirmed API and shown to the user for approval — that
approval stands in for the missing design pass.

**What was built**: `MyMinorsScreen` (off Home, gated on a `GUARDIAN` RoleGrant via
the new `useIsGuardian` hook) listing linked minors plus an "Add a minor" form;
`MinorConsentScreen` showing both confirmed consent tiers (Baseline, Camera) with
their real descriptions and withdrawal consequences (quoted from SKILL.md §14, not
invented); `ConsentTierRow` handling grant/withdraw per tier. `CURRENT_POLICY_VERSION`
is an explicit, disclosed placeholder pending real privacy-notice content from
product/legal — not invented legal text.

An 8-agent review found two real correctness bugs, fixed before commit:
- **A stuck consent-status bug**: `grant`/`withdraw` are two separate mutation
  objects, so calling one never reset the other's leftover `isSuccess`. Withdrawing
  once and then granting again on the same still-mounted screen left the row stuck
  showing "Grant consent" forever, even though the backend record was genuinely
  active — a Guardian could reasonably believe consent was never restored. Fixed by
  resetting the opposing mutation when a new action starts.
- **A misplaced re-entrancy guard**: the destructive withdraw action's `isPending`
  check ran before the confirmation dialog was shown, not immediately before the
  actual mutation call inside the dialog's async callback — a fast double-tap could
  stack two confirmations. Fixed by re-checking at the real call site, matching
  `MyBookingsScreen`'s own established pattern.
- Also fixed: an untrimmed form-submission mismatch (the enable check trimmed
  fields, the mutation didn't), and extracted the inline Guardian-role check into a
  reusable `useIsGuardian` hook alongside the existing `useEnrolledSchoolId`
  precedent.

**Flagged as follow-ups, not fixed here** (separate tasks spawned): a
severity-proportional confirmation for BASELINE withdrawal specifically (its
`Alert.alert` confirmation is a documented no-op on React Native Web, this app's
own test target, and arguably too lightweight for an action that deactivates a
minor's entire account regardless of platform); and a pre-existing `formatDate`
timezone bug (renders in local time, which can shift a UTC-midnight
date-of-birth to the wrong calendar day for users west of UTC) — not introduced by
this slice, but newly consequential here.

**Verified**: `npx tsc --noEmit` and `npx turbo run lint build` (run sequentially —
running them in parallel hit a transient out-of-memory crash on this machine
unrelated to the code, confirmed by the identical command succeeding when run
sequentially). Interactively tested via `expo start --web`: correct tier status
display, a real grant submission updating the UI immediately with no error, and
the trim fix confirmed via the actual network request payload. The withdraw→regrant
race itself couldn't be click-tested end-to-end (the confirmation dialog doesn't
render on web), so that specific fix is verified by direct code/logic tracing
against react-query's mutation reducer, not a live click-through.

The drawn-signature capture enhancement for Waivers (a different, still-genuinely-
blocked half of the original combined gap) remains parked — Decision 74 flags it as
"still undesigned... for the Architect / design work before this can be built," and
would need a `WaiverSignature` schema change besides.

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

*(Superseded in most cases by the Version 1 Plan section above and each Slice's own
section — kept here only for what's still genuinely blocked as of 2026-09-22.)*

- **Waiver drawn-signature capture** — the typed-name path shipped as Slice 6a;
  Decision 74/78 confirm drawn-signature is legally sufficient too, but that specific
  capture screen has never been designed anywhere. Needs a design pass + a
  `WaiverSignature` schema change.
- **Per-School white-label branding** — `packages/build-pipeline` is still an unbuilt
  placeholder; nothing to build against yet, and it's a standalone business decision
  (one app with dynamic theming vs. per-School app-store listings) beyond scope here.
- **Invoice/receipt viewing, Student-scoped transaction history** — the endpoints
  these would need don't exist yet as real controllers, despite appearing in a
  "representative" table in one of the skills.

Everything else previously listed here (Attendance QR check-in, Guardian-facing
screens, Offline caching) has since been scoped and/or built — see the Version 1 Plan
section and each item's own section above for the current, accurate status.

---

## Recommendation

**Shipped**: Slices 1, 2, 3, 4a, 5, 6a; the Guardian consent candidate (My Minors +
consent grant/withdraw); the shared `PaginatedListScreen` extraction; light read-only
offline caching (Phase 7); the Membership authorization-check fix.

**Scoped, not yet built**: QR check-in (Phase 5) — the backend endpoint it needs
already exists (`POST /attendance/scan`); what's left is a `apps/school-portal` QR
display screen, a scanning capability in `apps/student`, and your call on the 2
remaining product questions in that section above.

**Blocked on your decision, not further research**: Slice 4b (Stripe/PaymentSheet) —
the API shape and library choice are both settled; the open question is only whether
to take on the native dev-client workflow change right now.

**Genuinely blocked** (see the section above): the Waiver drawn-signature capture and
per-School white-label branding.

Several follow-ups are already spawned and tracked outside this doc (visible as task
chips in the session): the waitlist notification-dispatch backend gap, the
StudentRank-detail-denormalization question, the Membership authorization/Stripe-signal
gaps, proper multi-School support for the Waivers screen, and a deep-link from
booking errors to the Waivers screen.

**Note on the deep-link follow-up**: checked, not built this pass. `bookings.service.ts`'s
unsigned-Waiver rejection is a plain `BadRequestException(message)` with no distinct
error `code` (`HttpExceptionFilter` falls back to the generic `BAD_REQUEST` code
shared by every other 400) — the only signal available client-side to detect "this
specific error" is matching the free-text message, which is fragile and not something
to build silently. Needs either a backend change (a stable error code) or an explicit
decision to accept text-matching; left open rather than guessed at.

**Severity-proportional BASELINE withdrawal confirmation ✅ FIXED (2026-09-22).**
Found something worse than "not severity-proportional" while looking at this:
`Alert.alert` — used for both tiers' withdraw confirmation — is a documented no-op on
React Native Web, this app's own interactive-test target, so tapping "Withdraw" did
nothing at all on web, for either tier, not just BASELINE. Replaced with an inline
confirmation panel (`ConsentTierRow.tsx`) — plain Views/Text, no native dialog API, so
it renders identically on every platform. BASELINE's panel additionally requires an
explicit tap-to-acknowledge ("I understand this deactivates the account") before its
Confirm button enables; CAMERA's panel only needs the one warning read + tap, matching
its narrower, non-account-affecting effect. Added a `destructive` variant to the
shared `Button` component (`components/ui.tsx`) for the confirm action's styling —
usable elsewhere later (e.g. MyBookingsScreen's own `Alert.alert`-based cancel flow
has the identical no-op-on-web problem, not fixed here — out of scope for this
specifically-flagged BASELINE follow-up, spawned as its own follow-up instead).

**Verified**: `npx turbo run lint build --filter=@ultm8/student` clean. **Not**
click-tested — no mock backend or component-test harness exists in this checkout
(no jest config, no `react-test-renderer` installed in `apps/student`), and adding
test infrastructure wasn't judged proportionate to verify one component's local state
machine. Verified instead by tracing every transition by hand: open→cancel resets
`acknowledged`; open→confirm is blocked pre-mutate for BASELINE until acknowledged;
a failed withdraw still surfaces via the pre-existing `withdraw.isError` banner
(rendered outside the confirm/active branch, so unaffected by which one is showing);
a successful withdraw's `granted` becomes `undefined` immediately (existing
`withdraw.isSuccess` derivation, untouched), which hides the whole active/confirm
block regardless of `confirming`'s leftover value.

**`formatDate` timezone bug ✅ FIXED (2026-09-22).** Confirmed against
`apps/api/prisma/schema.prisma`: only `Minor.dateOfBirth` is a calendar-only
`@db.Date` column (line 211) — `Class.startDate/endDate`, `Membership.expiryDate`,
and `WaiverSignature.signedDate` are all genuine `DateTime` timestamps, where
`formatDate`'s existing local-timezone rendering is correct (a Class really does
start at a specific instant). Only the DOB display was wrong: the backend
serializes a `@db.Date` as UTC midnight, and `formatDate`'s local-timezone
`Intl.DateTimeFormat` shifted it back a calendar day for any viewer west of UTC
(verified: `2015-06-01T00:00:00.000Z` rendered as "May 31, 2015" in
`America/Los_Angeles`). Added `formatDateOnly` (`apps/student/src/lib/
formatDate.ts`), pinning `timeZone: 'UTC'` so the rendered day always matches the
stored one regardless of viewer timezone, and swapped `MyMinorsScreen.tsx`'s
`Born {formatDate(minor.dateOfBirth)}` to it — confirmed via the same Node check
that this renders "Jun 1, 2015" correctly. The three genuine-timestamp call sites
(`ClassBookingRow`, `MyMembershipsScreen`, `WaiverRow`) and `RegisterScreen`'s
typed-text DOB input (never round-tripped through `formatDate`) were left
untouched — confirmed as out of scope for this bug, not overlooked.

**Verified**: `npx turbo run lint build --filter=@ultm8/student` (`tsc --noEmit`)
clean, plus a standalone `node -e` check (above) proving the actual Intl output
difference, not just that it typechecks.
