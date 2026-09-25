# Track B — Student App, Slice 1: Walking Skeleton

## Context

This is a **second, parallel development track** to the main backend loop (currently on
`phase-16b-i-school-franchise-join`, backend shipped through Phase 16a/FranchisesModule).
Track B lives on its own branch, `track-b-student-app`, in its own git worktree at
`C:\Users\ADMIN\Desktop\ULTM8-track-b-student-app` — a separate working directory from
the main repo checkout, so the two tracks can build independently without touching each
other's working tree. Track B was branched from `origin/master` at `f71b481` (Phase 16a).

**Why this can start now, independent of the backend track:** every backend module a
Student app needs already exists and is live — Auth, Users, Tenants (self-enrollment),
Academies, Classes, Bookings/Waitlist, Memberships, Waivers, Ranks, Attendance
(self-service scan), Guardian, Notifications, Settings. Nothing in this slice is blocked
on `PlatformAdminModule`, `MobileAppPublishingModule`, `CurriculumModule`,
`SubscriptionPlansModule`, or `TranslationsModule` — those are backend-track work and
irrelevant to a Student-facing app.

**Standing rules, same as the backend track (`CLAUDE.md`):** only build against
`[CONFIRMED]` spec items. If something is unresolved, stop and flag it — do not guess a
plausible-looking answer. Load `skills/ultm8-domain-rules/SKILL.md` before any work
touching business rules. Run a high-effort code review before each commit, same
discipline the backend track has used since Phase 1.

**Scope discipline:** this kickoff is deliberately narrow — a walking skeleton, not the
whole app. Booking, payments/membership purchase, waiver signing, rank viewing,
attendance QR-scanning UI, and notifications are all explicitly **out of scope for this
slice** (see "Explicitly not doing," below). The pattern here mirrors how the backend's
own Phase 1 was scoped to 4 bounded items rather than "build everything" — pull in only
what this slice actually needs; anything that drags in new infrastructure (offline
caching, push delivery, drawn-signature capture, QR scanning) gets its own later slice.

---

## Before writing any code: two real decisions to make, not guess

### 1. Expo vs. bare React Native

Spec 55 confirms `apps/student` is a React Native app (§4.2) but does not specify Expo
vs. bare RN — this is unconfirmed anywhere in the spec, skills, or decision log. Real
trade-off, not a coin flip: Expo (managed workflow) makes EAS Build a much better fit for
`ultm8-app-publishing`'s confirmed per-School white-label rebuild pipeline (Spec §5) —
but bare RN gives more native-module control if QR scanning or camera consent handling
(both still `[UNRESOLVED]`, see below) end up needing something Expo's managed workflow
doesn't expose cleanly. **Recommendation: Expo (managed workflow)**, specifically because
the white-label rebuild requirement is already confirmed and EAS Build is the more direct
path to it — but this should be a stated decision (record it in
`docs/decisions/POST-SPEC-55-DECISION-LOG.md` once made, continuing the numbering), not a
silent default.

### 2. RN-appropriate secure token storage

`packages/auth/src/index.ts`'s existing `TokenStore` uses `sessionStorage`/`atob` —
browser-only APIs, not available in React Native. There is also no refresh-token endpoint
yet (`POST /auth/login` returns only `{ accessToken }`; a general refresh endpoint is
`[UNRESOLVED]` per `ultm8-nestjs-module` §7), so every session will force re-login at the
access token's TTL (≤15 minutes) until that's built — a real, known UX limitation to
carry into this slice, not silently work around. Use a real secure-storage primitive
(`expo-secure-store` if Expo is chosen) rather than reusing `packages/auth` as-is or
inventing an insecure fallback (plain `AsyncStorage` for a JWT is a real risk, not a
shortcut).

**Verify the RN toolchain is actually available in your build environment before
starting** — the original Phase 1 scaffolding pass explicitly could not do real RN init
because "Metro/Xcode/Android toolchains" weren't available in that session's environment
(`apps/student/README.md`). If that's still true here, flag it immediately rather than
building code that can't be run/verified — this may mean Track B needs to lean on Expo's
cloud build service (EAS) rather than local native builds.

---

## Task 1 — Real Expo/RN init, replacing the placeholder

- Replace `apps/student`'s placeholder `package.json`/README with a real Expo-managed RN
  app, TypeScript, matching the monorepo's actual tooling: **Turborepo + npm workspaces**
  (confirmed — not Nx, not pnpm; root `package.json` `workspaces: ["apps/*","packages/*"]`,
  `packageManager: npm@10.9.3`).
- Wire `build`/`dev`/`lint`/`test` scripts into `turbo.json`'s existing task graph, same
  shape as `apps/school-portal`'s (the one real sibling frontend today).
- Consume `@ultm8/api-client` (the generated typed SDK, live and real — confirmed at
  `packages/api-client`, generated via `openapi-typescript` against `apps/api`'s live
  `/v1/docs`) as a workspace dependency. **Check `packages/ui` before assuming it's
  reusable** — it was built for `apps/school-portal` (React-DOM); verify whether its
  components are RN-safe or web-only before pulling it in, rather than assuming.

## Task 2 — Auth flow: Register → OTP verify → Login

Build against the real, current `AuthModule` surface (verified directly from
`apps/api/src/auth/auth.controller.ts`, not the skill's "representative" endpoint table,
which is stale in places):
- `POST /auth/register` — `RegisterDto`: email, E.164 phone, firstName, surname, optional
  username, 6-digit `passcode`+`passcodeConfirm`, `dateOfBirth` (ISO date), optional
  gender/nationality/language/currency/address
- `POST /auth/otp/send`, `POST /auth/otp/verify`
- `POST /auth/login` — `LoginDto`: email + 6-digit passcode only. **This is the entire
  credential** — PIN-style, not a password+OTP combo (Decision 72, confirmed). No
  designed lockout/recovery UX yet (Decision 72's own open follow-up) — a bare, functional
  wrong-passcode error is enough for this slice; do not invent a lockout policy.
- `POST /auth/forgot-password`, `POST /auth/reset-password`

Store the returned access token via the Task-1 secure-storage decision. Do not build a
"remember me"/persistent-session UX beyond that — the 15-minute TTL + no-refresh-token
limitation applies regardless (see above).

## Task 3 — Minimal navigation shell + two real, read-only screens

Two screens only, both simple `GET`s with no side effects — enough to prove the whole
pipe (RN app → typed API client → live backend → real data) actually works end to end,
the same "walking skeleton" purpose Phase 1 served for the backend:

- **Academies discovery** — `GET /academies`, `GET /academies/:id`,
  `GET /academies/:id/timetable`. This is the confirmed mobile-facing, read-optimized
  discovery surface (`AcademiesModule`, Phase 14) — no RoleGrant needed to browse.
- **My Bookings** — `GET /bookings/me`. Read-only list; do not build the booking-creation
  flow itself yet (Task 4+ territory, out of scope this slice).

Every list endpoint uses cursor-based pagination (`?cursor=&limit=`), never
offset/page — confirmed platform-wide convention (Decision 22/70). Handle the standard
`{error:{code,message}}` non-2xx envelope, same as `apps/school-portal` does.

## Task 4 — Self-check before calling this done

- Confirm the app actually builds and runs against a live `apps/api` instance (local or
  the same dev target `apps/school-portal` uses) — not just typechecks clean.
- Confirm `GET`s against Academies/Bookings return real data end-to-end through
  `@ultm8/api-client`, not a mocked response.
- Run a high-effort code review pass before committing, same standing discipline the
  backend track uses (`skills/ultm8-domain-rules/SKILL.md` §20, tagging discipline:
  `[CONFIRMED]`/`[OBSERVED IN DESIGNS]`/`[UI BEHAVIOUR]`/`[UNRESOLVED]`).

---

## Explicitly not doing in this slice

- **Booking creation, cancellation, waitlist join/claim** — Task 3 only reads
  `bookings/me`; the write flows (`POST /classes/:id/book`, waitlist endpoints) are a
  later slice.
- **Membership purchase / payment UI** — `POST /membership-plans/:id/purchase` touches
  Stripe; deliberately deferred.
- **Waiver signing** — Decision 74/78 confirmed *typed name + drawn signature* is legally
  required, but **the drawn-signature capture screen itself has never been designed
  anywhere** (Figma shows typed name only). Do not build a signature pad from
  assumption — this needs a design pass before it's a Track B task.
- **Rank/grading viewing** — `GET /students/:id/ranks` etc. exist and are safe reads, but
  out of scope for a walking-skeleton slice; add in a follow-up once Auth+nav is proven.
- **Attendance QR check-in** — **genuinely unresolved**, not just deferred: the QR code's
  actual contents, who generates it, and the client-side scan/decode mechanism are all
  unconfirmed (`ultm8-domain-rules` §12/§18) — `POST /attendance/scan` today just accepts
  a raw `bookingId` in the request body, with no defined answer for how a Student's
  camera is supposed to produce that value. Do not build a QR scanner UI against a
  guessed payload format.
- **Guardian-facing screens** (linking a minor, consent management) — the backend
  `GuardianModule` API exists (`/guardians/me/minors`, `/guardians/me/consent`), but there
  is **no consent-management UI anywhere in confirmed designs** (`ultm8-domain-rules`
  §14, still `[UNRESOLVED]`), and Guardian-enrolling-a-minor into a School is explicitly
  unbuilt server-side too (Decision 96). Flag for a dedicated slice once the backend gap
  closes, not silently worked around.
- **Push notification delivery** — `DeviceToken` registration
  (`POST /notifications/device-tokens`) is real, but actual FCM/APNs dispatch is
  explicitly deferred server-side (Decision 95) — don't build UI that implies push will
  arrive on-device yet.
- **Offline behavior / caching strategy** — not addressed anywhere in Spec 55, any skill,
  or the decision log. Fully unconfirmed; do not invent an offline-first architecture for
  this slice.
- **Per-School white-label branding awareness** (dynamic icon/bundle-id/theme) — the
  publishing pipeline that would drive this (`packages/build-pipeline`) is an unbuilt
  placeholder. This slice targets the shared, default ULTM8-branded app only.
- **Invoice/receipt viewing, Student-scoped transaction history** — do not build UI
  against these; `GET /transactions/{id}/invoice` and a Student-scoped transactions list
  do not exist as real endpoints yet, despite appearing in `ultm8-nestjs-module` §5's
  "representative" table.

## A real spec resource worth knowing about

Spec 55 §2.2 (inside `ULTM8_Technical_Specification_55.docx`,
`deep-review/ULTM8-Dev-Handover-v55/`) contains an actual, reconciled Student Mobile App
screen inventory — confirmed "Done" status in `review-history-tracker.html`. It was never
extracted into a skill file or standalone doc in this repo. Worth opening directly for
screen/navigation reference — but treat it as `[OBSERVED IN DESIGNS]` (Figma-derived UI),
never as confirmed business logic on its own, per `CLAUDE.md`'s source-of-truth
hierarchy. Two known, flagged inconsistencies already on record: the mobile bottom
navigation isn't consistent across screens, and several unlabeled Profile stats
(870/120k/354k/3.8Gb) have no stated meaning anywhere — don't invent what either means.

## Verification

- Confirm Expo/bare-RN and token-storage decisions are made and recorded (not defaulted
  silently) before Task 1 starts.
- Confirm the RN toolchain is actually usable in this environment before assuming local
  builds work.
- Every `[CONFIRMED]` claim above should be spot-checked against the live controller
  files in `apps/api/src/**/*.controller.ts` before relying on it — this document was
  compiled from a real read of that code as of `f71b481`, but the backend track is
  shipping fast (Phase 16a already landed since this branch point) and may have moved on.
- Final summary before calling this slice done: what was built, what was explicitly
  deferred (the "not doing" list above), and any new `[UNRESOLVED]` items found along the
  way — same reporting discipline every backend phase has used.
