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
