# apps/student

React Native — Student app (Spec §4.2), Track B Slice 1 (walking skeleton). Expo-managed
workflow (Decision 113, `docs/decisions/POST-SPEC-55-DECISION-LOG.md`) — EAS Build is the
direct path to the confirmed per-School white-label rebuild pipeline (Spec §5,
`packages/build-pipeline`, still an unbuilt placeholder as of this slice).

## What's built (Track B, Slice 1)

- Real Expo/TypeScript init — `npx create-expo-app` output, wired into the monorepo's
  Turborepo + npm workspaces task graph (`dev`/`build`/`lint`, same shape as
  `apps/school-portal`).
- Auth flow: Register → OTP verify → Login → Forgot/Reset passcode, against the real
  `apps/api` `AuthModule` surface (`src/auth/`).
- Secure token storage via `expo-secure-store` (Decision 113), not `@ultm8/auth`'s
  browser-only `sessionStorage` implementation and not `AsyncStorage`. See
  `src/auth/secureTokenStore.ts` and `src/auth/tokenCache.ts` for why an in-memory
  mirror bridges SecureStore's async API to `@ultm8/api-client`'s synchronous
  `getAccessToken` callback.
- JWT payload decoding (`src/auth/decodeJwt.ts`) is a local, dependency-free
  implementation, NOT `@ultm8/auth`'s `decodeJwtPayload` — that one calls the global
  `atob`, which a review before this shipped found is not actually present anywhere in
  the installed `react-native@0.86.3`/`expo@~57.0.23` runtime (grepped both packages'
  full source; no polyfill exists). Calling it would have silently returned `null` for
  `claims` on every real device, with the failure swallowed by its own try/catch. This
  is also why apps/student has no dependency on `@ultm8/auth` at all.
- Two read-only screens proving the full pipe end-to-end (RN app → typed API client →
  live backend → real data): Academies discovery (`src/academies/`) and My Bookings
  (`src/bookings/`).
- `logout()` clears the react-query cache (`queryClient.clear()`), not just the token —
  found on review: the device may be shared (e.g. a Guardian's phone used by more than
  one Student login), and without this the next login would briefly show the previous
  account's cached bookings/academies data before the first real refetch resolved.

## What's built (Track B, Slice 2 — Class Booking & Waitlist)

Full account, including what changed from the original plan and what was found while
building/testing it, in `docs/TRACK-B-ROADMAP.md`. Summary:

- `AcademyDetailScreen`'s class rows (`src/bookings/ClassBookingRow.tsx`) can Book;
  a `409` (class full) offers Join waitlist inline, using the real
  `apps/api` error message. Any other failure (unsigned waiver, rank ineligibility,
  network error) shows the real message and lets the Student retry.
- `MyBookingsScreen` rows can Cancel, gated on `status === 'UPCOMING'`, behind a
  native confirm dialog.
- **No "My Waitlist" screen and no "claim" button** — verified there is no
  `GET /waitlist/me`-equivalent endpoint, and the waitlist-cascade job that's supposed
  to notify a Student when a spot opens up never actually notifies anyone (a real
  backend-track gap, not a frontend limitation — see the roadmap doc and the spawned
  follow-up task). Building either would imply a feature with no way to reach it.

## What's deliberately not built here

See `docs/TRACK-B-STUDENT-APP-KICKOFF.md`'s "Explicitly not doing" list — membership
purchase, waiver signing, rank viewing, attendance QR check-in, Guardian screens, push
delivery, offline behavior, and white-label branding awareness are all still out of
scope. Booking/cancellation/waitlist-join are now built (Slice 2); waitlist-claim is
not (see above — a backend gap, not a scoping choice).

## Known limitations carried into this slice, not fixed here

- **No refresh-token endpoint** (`apps/api`'s `POST /auth/login` returns only
  `{ accessToken }`) — every session forces re-login at the access token's TTL
  (≤15 minutes). Flagged in the kickoff doc; a backend-track gap, not fixed from here.
- **No date picker** on the registration screen's date-of-birth field — a plain
  `YYYY-MM-DD` text input, to avoid pulling in a native date-picker module this slice
  doesn't otherwise need (scope discipline: "pull in only what this slice actually
  needs").
- **My Bookings shows a raw `classId`**, not a class title — `BookingResponseDto` has
  no denormalized class/school name, and joining against `ClassesModule` for display
  purposes is beyond this slice's read-only walking-skeleton scope.
- **`logout()`'s SecureStore delete isn't guaranteed** — `secureTokenStore.clear()`
  swallows a `deleteItemAsync` failure (Keychain/Keystore contention is rare but real)
  so the logout flow itself never crashes. In-memory state (and the query cache) is
  always cleared correctly for the current session either way; the narrow edge case is
  a stale token surviving in SecureStore for the *next* cold launch on a shared device.
  Not fixed here — a retry wouldn't guarantee success either, and this is an OS-level
  failure mode, not an application bug to paper over.
- **`JwtClaims`/`RoleGrantClaim` (`src/auth/types.ts`) are a third hand-copy** of the
  same shape already duplicated once in `apps/school-portal/src/auth/types.ts` — both
  mirror `apps/api/src/auth/interfaces/jwt-payload.interface.ts` by hand since the JWT
  payload is never an OpenAPI response body. `@ultm8/auth` would be the natural shared
  home for this, but moving it there is a cross-app change touching the other track's
  code, out of scope for this slice — flagged, not silently fixed.

## Toolchain verification (this session)

No Android SDK/Xcode toolchain is available in this environment (confirmed: no
`ANDROID_HOME`/`ANDROID_SDK_ROOT`/`adb`), consistent with the original Phase 1
placeholder's own note. What *was* verified here:
- `npx tsc -p tsconfig.json --noEmit` — clean, zero errors.
- `npx expo export --platform android` — a full production bundle built successfully
  (977 modules, real Hermes bytecode output), proving every import in the dependency
  graph (workspace packages included) resolves and the app actually compiles.
- **A real interactive run**, via `expo start --web` in a browser (the one target
  buildable without native tooling — `react-native-web`/`react-dom`/`@expo/metro-runtime`
  added as dev-convenience deps for exactly this). Clicked through Register → submit
  (against no backend, to exercise the failure path), Login, Home, Academies, and My
  Bookings. This caught two real issues before they shipped, both fixed:
  - **`expo-secure-store` has no web implementation at all**
    (`node_modules/expo-secure-store/src/ExpoSecureStore.web.ts` is a literal
    `export default {}`) — every call threw internally, silently caught by
    `secureTokenStore`'s try/catch, so a session never survived a page reload on web
    with zero visible error. The real target platforms (iOS/Android) are unaffected —
    Keychain/Keystore both work normally there. Fixed by making the gap an explicit,
    one-time `console.warn` via `SecureStore.isAvailableAsync()` instead of a silent
    no-op indistinguishable from "everything's fine" (`secureTokenStore.ts`).
  - **List-screen errors showed the raw browser/fetch error text** (e.g. "Failed to
    fetch") instead of a friendly message, and the FlatList's empty state ("No
    academies found.") rendered *simultaneously* with the error banner, which is
    misleading — it implies the fetch succeeded with zero results rather than never
    completing. Fixed in `AcademiesListScreen.tsx`, `AcademyDetailScreen.tsx`, and
    `MyBookingsScreen.tsx`: errors now render instead of the list (not alongside it),
    and non-`ApiError` failures show a friendly fallback, matching the pattern the
    auth screens already used.
  - Also checked, not a bug: reloading directly on a URL for a params-requiring screen
    (`/AcademyDetail` with no `academyId`) — falls back to Home cleanly rather than
    crashing on the missing param, even though this slice has no `linking` config and
    deep-linking isn't a supported feature yet.
- **Slice 2's booking/waitlist/cancel flows**, against a small throwaway local HTTP
  mock server (not committed — `window.fetch` can't be monkey-patched here since
  `@ultm8/api-client`'s client captures a `fetch` reference at module-load time,
  before any post-load script injection could reach it). Confirmed working
  end-to-end: Book → 409 → "Join waitlist" → real position number → "Leave
  waitlist" → reverts; Book (retry) → "Booked ✓"; Cancel → `PATCH` fires,
  `invalidateQueries` correctly triggers a refetch. Also found:
  `react-native-web`'s `Alert.alert` is a complete no-op
  (`static alert() {}`, `node_modules/react-native-web/src/exports/Alert/index.js`) —
  the Cancel confirmation dialog silently does nothing in the web preview. Real
  iOS/Android are unaffected (`Alert.alert` is a standard, fully-supported native
  API there); verified the underlying cancel logic separately by temporarily
  bypassing just the dialog.

What was **not** verified: an actual run against a live `apps/api` instance on a device,
simulator, or Expo Go (Task 4's "self-check before calling this done" in the kickoff
doc) — the web run above used no backend, so it only proves the client-side wiring and
error handling, not real data round-tripping. That needs a machine with Expo Go, a
simulator, a real Postgres instance for `apps/api` (this environment has neither Docker
running nor a local Postgres — checked), or EAS Build access. Do that real end-to-end
run before treating this slice as fully done.

## Running

```
npm install          # from the monorepo root
npm run dev -w apps/student   # or: cd apps/student && npx expo start
```

Requires a running `apps/api` instance — set `expo.extra.apiBaseUrl` in `app.json` if
it isn't at `http://localhost:3000`.
