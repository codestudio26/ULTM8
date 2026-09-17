# Frontend design mockup notes

Running log of the Figma-reference-driven UI mockup pass (see `DESIGN.md` and
`skills/ui-implementation/SKILL.md` for the rules this follows). Each entry
records what was checked, what was kept vs. excluded, and why — so this can
be picked up in a different session without re-deriving the reasoning from
chat history.

**Process per page:** pull the real endpoint/DTO shape from the code, find
the matching screen(s) in the ULTM8 Figma file
(`txowXWQFNw5LdeCN2umyDb`, "ULTM8 — New Versions"), cross-check every
Figma element against the real DTO and the domain-rules skill, then mock up
only what's confirmed — flagging anything Figma shows that isn't backed by
real data or a confirmed rule, rather than silently including or excluding it.
Never a pixel-exact copy of the Figma file. Nothing here is implemented into
real app code until a direction is approved.

Status legend: `mockup` (built, awaiting review) · `approved` (direction
picked, not yet implemented) · `implemented` (in real app code).

---

## school-portal — Login flow

**Status:** mockup (Combined concept approved as the working direction, not
yet implemented in `LoginPage.tsx`)

- Figma nodes: `2301:72` (Login Form) → `2301:1781` (LoginSuccessMessage)
- Real source: `apps/school-portal/src/auth/LoginPage.tsx`, Decision 72
  (passcode is the sole credential — PIN-style, no password)
- **Excluded** (present in Figma, not a confirmed ULTM8 decision): password
  field, social/OAuth login buttons (Google/Facebook/Apple/Microsoft/Discord),
  "Remember Me", terms-of-use checkbox at login (Figma file still literally
  reads "Martial App" — unbranded template content)
- **Kept from Figma:** show/hide toggle icon on the passcode field, success
  panel copy ("Successful" / "You are successfully logged in to your
  account." + dismiss ×)
- **Open question, not assumed:** does the success panel auto-navigate after
  a delay, or wait for the user to dismiss it? Needs an answer before this
  becomes real state.
- Artifact: https://claude.ai/artifact/5aDC5GJLfShqmA5uEbZ8p1

## platform-admin — Login

**Status:** mockup

- No form in Figma or in real code — real flow is AWS Cognito Hosted UI
  (Authorization Code + PKCE), 2FA enforced by the IdP (Spec §4.4)
- Real source: `apps/platform-admin/src/auth/LoginPage.tsx` + `AuthContext.tsx`
- Nothing added beyond the three real states (default / signing-in /
  not-configured) — no fields, no providers invented
- Artifact: https://claude.ai/artifact/JXPbsswMs3jJhJExXo85VU

## school-portal — Register flow

**Status:** mockup

- Figma nodes: `2301:1431` (registerScreen) → `2301:1670` (success) / `2301:1693` (error)
- Real source: `apps/school-portal/src/auth/RegisterPage.tsx` (fields match `RegisterDto` exactly per its own header comment)
- **Excluded:** Remember Me, social signup buttons, "Agree to Martial App's Terms of Use" checkbox — same reasoning as Login
- **Added despite Figma omitting it:** Date of birth — required on `RegisterDto`, Figma's form is just missing it, not treating it as skippable
- **Kept:** the real "Optional details" collapsed section (username/gender/nationality/language/currency/address) — not in Figma at all, but real working code
- **Not used:** Figma's generic "Unable to Register Account" error panel — real code shows the actual `ApiError.message` inline instead, which carries more information
- **Open question, not assumed:** Figma shows a success interstitial before continuing; real code today navigates straight to `/verify-otp` with no pause. Shown as a proposed addition using the new DESIGN.md success-panel pattern, not treated as decided.
- Artifact: https://claude.ai/artifact/28pd49EhjuZLW986cevJ9u

## school-portal — Instructors & Branches

**Status:** mockup

- Instructors — Figma: `" instructorList"` (`2380:640`); Real: `InstructorResponseDto`
  - **Excluded:** progress-bar "Ranking" (real `beltRanking` is plain text, not a progress metric), "Active" status badge (no such field), date-range picker (endpoint takes no date params), a Name column (DTO has no name field — real code doesn't render one either, confirmed real gap)
  - **Excluded:** numbered pagination — hook's own comment says "No pagination in this UI yet," and the API is cursor-based anyway
  - **Proposed, not assumed:** a `photoUrl` avatar — field exists on the DTO, just isn't wired into the UI today
- Branches — no matching Figma list screen exists (only branch-detail frames); built from `BranchResponseDto` + current real table
- Artifact: https://claude.ai/artifact/6hBes7L1F7DSt9G525ywwy

## school-portal — Verify OTP (register's second step) & Forgot/Reset passcode

**Status:** mockup

- **Flow-structure correction, not just a style one:** Figma implies a 3-step
  reset (forgot → separate OTP screen → new-password-only screen), but real
  code combines code + new passcode into **one** screen —
  `ResetPasscodePage.tsx` posts `{phone, code, newPasscode}` in a single
  call. Kept the real 2-step structure rather than adding a screen to match
  Figma's drawn flow.
- The Figma OTP-only screen (`2301:1596`, "veriﬁcationPin") actually matches
  a *different* real page — `VerifyOtpPage.tsx`, which belongs to the
  **register** flow (phone verification), not reset. Reattributed correctly.
- **Excluded:** country-flag phone picker, generic "OTP Expired" panel (real
  code shows the actual `ApiError` message instead)
- **Kept:** real "Resend code" button + "Code resent." success banner (not
  in Figma at all); phone field left editable in the OTP-verify screen
  (Figma shows it as static text)
- **Flagged, not assumed:** the real `code` field has no length constraint
  in code — Figma shows 4 digit boxes, but that count isn't confirmed
  anywhere. Shown as a labeled alternative, not the default.
- **Open question, not assumed:** same success-panel-vs-immediate-redirect
  question as Login/Register — real code navigates straight to `/login`
  today with no pause.
- Artifact: https://claude.ai/artifact/CTTu5AcXMdb7tZ7ETPVV4Y

**Auth flow is now fully covered** (Login, Register, Verify OTP, Forgot/Reset passcode) across the three artifacts above.

## school-portal — Timetable

**Status:** mockup

- Figma: "timeTableList" (`2389:3922`); Real: `TimetableSlotResponseDto`, `TimetablePage.tsx`
- **Figma's list screen doesn't match this resource at all** — it's the same unadapted generic-list template as Instructors (same dummy row, date-range picker, numbered pagination), with "Start Date"/"End Date" columns that describe *Classes*, not Timetable. Real code's own comment is explicit that Timetable (recurring `weekday` + `startTime`/`endTime`) and Classes (dated `startDate`/`endDate`) are deliberately separate resources — using Figma's columns here would blur that distinction.
- Built from the real weekday-grouped layout instead (one card per day), which is what's actually implemented today.
- Artifact: https://claude.ai/artifact/KJxAg5YpVMWuAbZjdM2EGo

## school-portal — Staff

**Status:** mockup

- No Figma screen exists for this page at all (checked the whole file)
- **Hard constraint from the code itself:** no "list all staff at my School" endpoint exists — `roleGrantQueries.ts`'s own comment confirms it. Only real capabilities: invite a known User ID as Instructor/Branch Staff, and look up/revoke one known user's grants at a time. A staff directory/roster view would need new backend work, not a UI change.
- Invite form is deliberately narrow (Instructor/Branch Staff only) per Decision 80/81 — not expanded here.
- Pure styling pass otherwise — both cards shown populated for review; real default state has the lookup table empty until searched.
- Artifact: https://claude.ai/artifact/SnY3N4MVPgDhsUyZ7kVZpx

## school-portal — Disciplines, Skills & Ranks

**Status:** mockup

- No Figma screen exists for this page either — "Ranks"/"Belt" only appear as small nested labels inside unrelated screens (e.g. the Instructor list's progress-bar column, already flagged as not matching real data)
- Built entirely from `DisciplineResponseDto`, `SkillResponseDto`, `RankResponseDto`
- **Rank colors are rendered as real swatches** — unlike Instructors' `beltRanking` (plain text, flagged earlier), `RankResponseDto.primaryColour`/`secondaryColour` genuinely are structured color fields, so a swatch reflects real data here, not an invented one
- Kept the real, persistent "Ranks can only be added at the end of the ladder" hint (append-only, no reorder)
- Pure styling pass — no fields added/removed/reinterpreted
- Artifact: https://claude.ai/artifact/3bdYgVFW327Wd8qFwL13a3

## school-portal — Classes & Class detail

**Status:** mockup

- Figma: "classesList" (`2389:4491`); Real: `ClassResponseDto`, `BookingResponseDto`, `WaitlistEntryResponseDto`
- **"Fees: $300.00" column → removed.** `ClassResponseDto` has no price field at all — a Class isn't sold directly, access comes through Membership Plans. This is the opposite direction of the Timetable finding: here Figma invents a field the DTO doesn't have.
- **"Status: Active" → removed** (no status field on the DTO)
- Real Start/End dates *were* kept — unlike Timetable, Classes genuinely has `startDate`/`endDate`, so those Figma columns are the right shape here
- **Flagged, not assumed:** an Instructor column would be a reasonable addition (data's already fetched for the form dropdown), but isn't in the real table today, so shown as a suggestion, not included
- Class detail is read-only by design (real code's own comment: "visibility only" this phase, matches Transactions) — no cancel/override actions added; Student rows show truncated IDs since no name-lookup endpoint exists
- Artifact: https://claude.ai/artifact/NAEVAWWQrNh8XnVbuikK6E

## school-portal — Membership Plans

**Status:** mockup

- Figma: "membershipList" (`2406:5604`); Real: `MembershipPlanResponseDto`, `MembershipPlansPage.tsx`
- **Type labels kept exact** to the 5 real enum values — Figma's "Subscriptions"/"Single Passes"/"Trial Memberships" don't map cleanly onto them
- **"Expires: [fixed date]" column → removed.** Conflates the Plan template's `expiryDurationDays` (a duration, e.g. "30 days after purchase") with an individual purchased membership's actual expiry date, which only exists per-purchase
- **"Status: Active" → removed** — redundant with the real Visibility (Visible/Hidden) column
- Date-range picker, numbered pagination → removed (consistent with every other list page)
- Artifact: https://claude.ai/artifact/DStQyxjW2cbQP2n6ZJagmq

## school-portal — Transactions

**Status:** mockup

- Figma: "transactionsHistory"; Real: `TransactionResponseDto`, `TransactionsPage.tsx`
- **Note:** Figma's MCP tool call limit was hit partway through this page — built from the structural text already cached locally (column labels) plus the real code, not a fresh screenshot. Remaining pages below have the same limitation until it resets.
- **Stripe/GoCardless/Cash balance-widget cards → removed entirely.** That's payment-account administration (closer to platform-admin's `PaymentAccountResponseDto`), not this School-level read-only transaction ledger — not folding two different pages together.
- **"Download" (invoice) action → removed.** Real code's own comment: "no refund/credit-restore/invoice-download endpoints exist yet this phase."
- Date-range picker, numbered pagination → removed (consistent pattern)
- Artifact: https://claude.ai/artifact/ThDY6cRhHrVAS9Y34pgyzH

## school-portal — Waivers

**Status:** mockup

- No Figma screen exists for Waiver management — "Liability waivers" only appears as a small checkbox label elsewhere, and a "Severability and Waiver" legal clause on an unrelated Terms page (naming coincidence, not the same concept)
- Built entirely from `WaiverResponseDto` — pure styling pass, 80-char body preview matches the real code's own `bodyPreview()` convention
- Artifact: https://claude.ai/artifact/BJu16F9LeGy11Qvp27mmSt

## school-portal — Franchises & Franchise detail

**Status:** mockup

- Figma: "franchiseList" (`2337:9161`); Real: `FranchiseResponseDto`, `FranchiseDetailPage.tsx`
- **"Status: Active" → removed** (no status field on the DTO)
- **Phone number flagged, not included** — DTO has a real `mobileNumber` field not currently rendered (same category as Instructors' unused `photoUrl`)
- Detail page (member Schools + fee charges + refund) has no Figma match at all — built entirely from real code, which is explicit that School roster/fee-charge rows are written only by billing jobs and Stripe webhooks; refund is the one real write action
- Artifact: https://claude.ai/artifact/UCyBq5oRddpVLKDrgToNqJ

## school-portal — Notifications

**Status:** mockup

- No Figma screen matches an in-app notification inbox — the only nearby match is an unrelated "Email notifications" settings/preferences screen (toggles, not a message list), not used
- Built entirely from `NotificationResponseDto` — pure styling pass, list + mark-read only (no device-token registration UI, out of scope per the real code's own comment)
- Artifact: https://claude.ai/artifact/UNKSBCCrc56mKSTCtbJiQJ

## platform-admin — Admin Users, School lookup, Franchise lookup

**Status:** mockup

- **Confirmed zero Figma coverage for this app.** The whole Figma file has exactly one top-level page, literally named "School Portal" — there is no platform-admin content in it at all.
- Built entirely from real code: `AdminUsersPage.tsx` (populated by default, Full-Admin-only), `SchoolLookupPage.tsx` / `FranchiseLookupPage.tsx` (lookup-gated, empty by default, shown here post-search)
- Kept the real "Rotate credential" gating exactly — STRIPE-provider payment accounts only, shown both with (School) and without (Franchise, BANK_TRANSFER) in the mockup
- Artifact: https://claude.ai/artifact/Sb2k58B66vCfLs9hFWYAGt

---

**All 14 queued pages are now done** (Login flow, Instructors, Branches, Register, Verify OTP/Forgot/Reset, Timetable, Staff, Disciplines/Skills/Ranks, Classes, Membership Plans, Transactions, Waivers, Franchises, Notifications, platform-admin's Admin Users/School lookup/Franchise lookup). Figma's MCP rate limit was hit partway through Transactions — everything from Transactions onward was built from real code plus previously-cached Figma structural text, not fresh screenshots.

## DESIGN.md — Patterns section

**Status:** implemented (committed `83f6d41`)

- Added "Success confirmation panel" and "Segmented code input" as
  token-driven patterns, generalized from the recurring Figma shapes (the
  success-toast component appears dozens of times across unrelated flows;
  the OTP screen is node `2301:1596`)
- Deliberately did not hardcode the OTP expiry duration Figma shows
  ("1 minute 17 seconds") — that's a backend value, not confirmed anywhere

## Accent color token

**Status:** implemented (committed `711ce6b`, PR #61)

- Not Figma-derived — direct user instruction to replace `--color-accent-500`
  with `#5D7081`. Full 50–900 ramp regenerated (same hue/lightness-step curve
  as before, new base), WCAG AA re-verified for every pairing in DESIGN.md's
  contrast table.

---

*(Further pages appended below as they're reviewed.)*
