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
