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

**Status:** implemented (22 Sep 2026, Decision 119) — `LoginPage.tsx` now
matches the approved Combined concept

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
- **Resolved (was open):** the success panel auto-advances after 2s, and a
  dismiss (×) lets the user skip the wait — decided directly with the user,
  see Decision 119.
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

**Status:** implemented (22 Sep 2026, Decision 119)

- Figma nodes: `2301:1431` (registerScreen) → `2301:1670` (success) / `2301:1693` (error)
- Real source: `apps/school-portal/src/auth/RegisterPage.tsx` (fields match `RegisterDto` exactly per its own header comment)
- **Excluded:** Remember Me, social signup buttons, "Agree to Martial App's Terms of Use" checkbox — same reasoning as Login
- **Added despite Figma omitting it:** Date of birth — required on `RegisterDto`, Figma's form is just missing it, not treating it as skippable
- **Kept:** the real "Optional details" collapsed section (username/gender/nationality/language/currency/address) — not in Figma at all, but real working code; now visually styled (bordered, custom disclosure marker) instead of an unstyled native `<details>`
- **Not used:** Figma's generic "Unable to Register Account" error panel — real code shows the actual `ApiError.message` inline instead, which carries more information
- **Resolved (was open):** registration now pauses on a success panel ("Account created") before continuing to `/verify-otp` — auto-advances after 2s, dismissible early. Same Decision 119 as Login.
- Artifact: https://claude.ai/artifact/28pd49EhjuZLW986cevJ9u

## school-portal — Instructors & Branches

**Status:** implemented (22 Sep 2026, Decision 120) — Instructors' real name gap
closed; Branches confirmed already matching, no changes needed

- Instructors — Figma: `" instructorList"` (`2380:640`); Real: `InstructorResponseDto`
  - **Excluded:** progress-bar "Ranking" (real `beltRanking` is plain text, not a progress metric), "Active" status badge (no such field), date-range picker (endpoint takes no date params), a Name column (DTO has no name field — real code doesn't render one either, confirmed real gap)
  - **Excluded:** numbered pagination — hook's own comment says "No pagination in this UI yet," and the API is cursor-based anyway
  - **Proposed, not assumed:** a `photoUrl` avatar — field exists on the DTO, just isn't wired into the UI today
- Branches — no matching Figma list screen exists (only branch-detail frames); built from `BranchResponseDto` + current real table
- Artifact: https://claude.ai/artifact/6hBes7L1F7DSt9G525ywwy

## school-portal — Verify OTP (register's second step) & Forgot/Reset passcode

**Status:** implemented (22 Sep 2026, Decision 119)

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
- **Resolved (was flagged, not assumed):** the real `code` field has no
  length constraint in code (`@Length(4, 8)` on both `VerifyOtpDto` and
  `ConfirmPasscodeResetDto`) — the user was shown this exact gap and chose
  the 6-box segmented input over the safer plain-text default anyway; 6 is
  a documented assumption (matches the app's own passcode length + Twilio's
  typical default), not a confirmed value — see Decision 119. Both
  Verify-OTP's and Reset's `code` fields now use `SegmentedCodeInput`.
- **Resolved (was open):** Reset passcode now pauses on a success panel
  ("Passcode changed") before continuing to `/login`, same auto-advance-+-
  dismissible behavior as Login/Register. Verify OTP intentionally did
  **not** get a success panel — none was shown in the approved mockup for
  this screen.
- Artifact: https://claude.ai/artifact/CTTu5AcXMdb7tZ7ETPVV4Y

**Auth flow is now fully covered** (Login, Register, Verify OTP, Forgot/Reset passcode) across the three artifacts above.

## school-portal — Timetable

**Status:** implemented (confirmed 22 Sep 2026, Decision 120) — already matched
the approved mockup exactly, no changes needed

- Figma: "timeTableList" (`2389:3922`); Real: `TimetableSlotResponseDto`, `TimetablePage.tsx`
- **Figma's list screen doesn't match this resource at all** — it's the same unadapted generic-list template as Instructors (same dummy row, date-range picker, numbered pagination), with "Start Date"/"End Date" columns that describe *Classes*, not Timetable. Real code's own comment is explicit that Timetable (recurring `weekday` + `startTime`/`endTime`) and Classes (dated `startDate`/`endDate`) are deliberately separate resources — using Figma's columns here would blur that distinction.
- Built from the real weekday-grouped layout instead (one card per day), which is what's actually implemented today.
- Artifact: https://claude.ai/artifact/KJxAg5YpVMWuAbZjdM2EGo

## school-portal — Staff

**Status:** implemented (confirmed 22 Sep 2026, Decision 120) — resolved-name
display and exact email/phone invite lookup (Decisions 114/116) already exceed
this mockup's own simpler bare-User-ID invite form; one minor flagged gap
(card-heading style) deliberately not fixed in isolation, see Decision 120

- No Figma screen exists for this page at all (checked the whole file)
- **Hard constraint from the code itself:** no "list all staff at my School" endpoint exists — `roleGrantQueries.ts`'s own comment confirms it. Only real capabilities: invite a known User ID as Instructor/Branch Staff, and look up/revoke one known user's grants at a time. A staff directory/roster view would need new backend work, not a UI change.
- Invite form is deliberately narrow (Instructor/Branch Staff only) per Decision 80/81 — not expanded here.
- Pure styling pass otherwise — both cards shown populated for review; real default state has the lookup table empty until searched.
- Artifact: https://claude.ai/artifact/SnY3N4MVPgDhsUyZ7kVZpx

## school-portal — Disciplines, Skills & Ranks

**Status:** implemented (22 Sep 2026, Decision 120) — Ranks' colour column now
renders a real swatch; Disciplines list and Skills table already matched

- No Figma screen exists for this page either — "Ranks"/"Belt" only appear as small nested labels inside unrelated screens (e.g. the Instructor list's progress-bar column, already flagged as not matching real data)
- Built entirely from `DisciplineResponseDto`, `SkillResponseDto`, `RankResponseDto`
- **Rank colors are rendered as real swatches** — unlike Instructors' `beltRanking` (plain text, flagged earlier), `RankResponseDto.primaryColour`/`secondaryColour` genuinely are structured color fields, so a swatch reflects real data here, not an invented one
- Kept the real, persistent "Ranks can only be added at the end of the ladder" hint (append-only, no reorder)
- Pure styling pass — no fields added/removed/reinterpreted
- Artifact: https://claude.ai/artifact/3bdYgVFW327Wd8qFwL13a3

## school-portal — Classes & Class detail

**Status:** implemented (22 Sep 2026, Decision 120) — Classes list gained a
real Instructor column; Class Detail already had real Bookings/Waitlist name
resolution (Decision 117)

- Figma: "classesList" (`2389:4491`); Real: `ClassResponseDto`, `BookingResponseDto`, `WaitlistEntryResponseDto`
- **"Fees: $300.00" column → removed.** `ClassResponseDto` has no price field at all — a Class isn't sold directly, access comes through Membership Plans. This is the opposite direction of the Timetable finding: here Figma invents a field the DTO doesn't have.
- **"Status: Active" → removed** (no status field on the DTO)
- Real Start/End dates *were* kept — unlike Timetable, Classes genuinely has `startDate`/`endDate`, so those Figma columns are the right shape here
- **Flagged, not assumed:** an Instructor column would be a reasonable addition (data's already fetched for the form dropdown), but isn't in the real table today, so shown as a suggestion, not included
- Class detail is read-only by design (real code's own comment: "visibility only" this phase, matches Transactions) — no cancel/override actions added; Student rows show truncated IDs since no name-lookup endpoint exists
- Artifact: https://claude.ai/artifact/NAEVAWWQrNh8XnVbuikK6E

## school-portal — Membership Plans

**Status:** implemented (confirmed 22 Sep 2026, Decision 120) — already
matched the approved mockup exactly, no changes needed

- Figma: "membershipList" (`2406:5604`); Real: `MembershipPlanResponseDto`, `MembershipPlansPage.tsx`
- **Type labels kept exact** to the 5 real enum values — Figma's "Subscriptions"/"Single Passes"/"Trial Memberships" don't map cleanly onto them
- **"Expires: [fixed date]" column → removed.** Conflates the Plan template's `expiryDurationDays` (a duration, e.g. "30 days after purchase") with an individual purchased membership's actual expiry date, which only exists per-purchase
- **"Status: Active" → removed** — redundant with the real Visibility (Visible/Hidden) column
- Date-range picker, numbered pagination → removed (consistent with every other list page)
- Artifact: https://claude.ai/artifact/DStQyxjW2cbQP2n6ZJagmq

## school-portal — Transactions

**Status:** implemented (confirmed 22 Sep 2026, Decision 120) — Student-name
fix was already real (Decision 109); the mockup's remaining "unimplemented"
items (balance-widget cards, Download action) were always meant to be
*excluded*, and real code already excludes them — the page is fully aligned,
not partial

- Figma: "transactionsHistory"; Real: `TransactionResponseDto`, `TransactionsPage.tsx`
- **Note:** Figma's MCP tool call limit was hit partway through this page — built from the structural text already cached locally (column labels) plus the real code, not a fresh screenshot. Remaining pages below have the same limitation until it resets.
- **Stripe/GoCardless/Cash balance-widget cards → removed entirely.** That's payment-account administration (closer to platform-admin's `PaymentAccountResponseDto`), not this School-level read-only transaction ledger — not folding two different pages together.
- **"Download" (invoice) action → removed.** Real code's own comment: "no refund/credit-restore/invoice-download endpoints exist yet this phase."
- Date-range picker, numbered pagination → removed (consistent pattern)
- Artifact: https://claude.ai/artifact/ThDY6cRhHrVAS9Y34pgyzH

**Implemented for real, 18 Sep 2026 — Student column now shows a real name:**

- The mockup's Student-name correction (see the "Audit — same 'no name field' mistake" entry above) has been built into the actual app, not just the preview. `TransactionsService.findAllForSchool` now joins `Transaction.student` and `TransactionResponseDto` carries `studentFirstName`/`studentSurname`; `TransactionsPage.tsx` renders the resolved name, falling back to the truncated id only if both are empty. See **Decision 109** (`docs/decisions/POST-SPEC-55-DECISION-LOG.md`) for the full reasoning, RLS trace, and what's explicitly still out of scope (the identical gap in `ClassDetailPage.tsx`/`InstructorFormModal.tsx`/`StaffPage.tsx`).
- Regenerated `packages/api-client/openapi.json`/`schema.d.ts` from the live Swagger output to pick up the new fields — diffed to confirm only the two expected fields changed.
- Added an assertion to `apps/api/test/memberships.e2e-spec.ts`'s existing Transactions-list test, extending rather than duplicating it. **Not run in this environment** — no reachable Postgres (confirmed: no `DATABASE_URL*` set, `pg_isready` unreachable) — verified instead via `tsc --noEmit` across `apps/api`, `packages/api-client`, and `apps/school-portal` (all clean). Needs `npm run test:e2e -- memberships.e2e-spec` against a real database before this is fully proven, not just compiled.
- Everything else on this page (balance-widget cards, Download action, date/pagination) was always meant to be excluded, not built — confirmed 22 Sep 2026 (Decision 120) that real code already excludes all of it, so nothing further was needed. One unrelated cosmetic note surfaced by that audit: the Failed/Disputed badge colors are inverted between this mockup and real `paymentStatusBadge.tsx` — not changed, since neither was ever confirmed as the deliberate choice.

## school-portal — Waivers

**Status:** implemented (confirmed 22 Sep 2026, Decision 120) — already
matched the approved mockup exactly, no changes needed

- No Figma screen exists for Waiver management — "Liability waivers" only appears as a small checkbox label elsewhere, and a "Severability and Waiver" legal clause on an unrelated Terms page (naming coincidence, not the same concept)
- Built entirely from `WaiverResponseDto` — pure styling pass, 80-char body preview matches the real code's own `bodyPreview()` convention
- Artifact: https://claude.ai/artifact/BJu16F9LeGy11Qvp27mmSt

## school-portal — Franchises & Franchise detail

**Status:** implemented (confirmed 22 Sep 2026, Decision 120) — already
matched the approved mockup exactly; `mobileNumber` stays unrendered on the
list, still a proposed-not-decided addition, not added

- Figma: "franchiseList" (`2337:9161`); Real: `FranchiseResponseDto`, `FranchiseDetailPage.tsx`
- **"Status: Active" → removed** (no status field on the DTO)
- **Phone number flagged, not included** — DTO has a real `mobileNumber` field not currently rendered (same category as Instructors' unused `photoUrl`)
- Detail page (member Schools + fee charges + refund) has no Figma match at all — built entirely from real code, which is explicit that School roster/fee-charge rows are written only by billing jobs and Stripe webhooks; refund is the one real write action
- Artifact: https://claude.ai/artifact/UCyBq5oRddpVLKDrgToNqJ

## school-portal — Notifications

**Status:** implemented (confirmed 22 Sep 2026, Decision 120) — already
matched the approved mockup exactly, no changes needed

- No Figma screen matches an in-app notification inbox — the only nearby match is an unrelated "Email notifications" settings/preferences screen (toggles, not a message list), not used
- Built entirely from `NotificationResponseDto` — pure styling pass, list + mark-read only (no device-token registration UI, out of scope per the real code's own comment)
- Artifact: https://claude.ai/artifact/UNKSBCCrc56mKSTCtbJiQJ

## platform-admin — Admin Users, School lookup, Franchise lookup

**Status:** implemented (22 Sep 2026, Decision 120) — Admin Users already
matched exactly; School/Franchise lookup gained token-driven spacing/subtitle
styling in place of hardcoded pixel values. Not live-verified in a browser —
this sandbox has no AWS Cognito configured, which platform-admin's real login
requires — verified via type-check and code review only

- **Confirmed zero Figma coverage for this app.** The whole Figma file has exactly one top-level page, literally named "School Portal" — there is no platform-admin content in it at all.
- Built entirely from real code: `AdminUsersPage.tsx` (populated by default, Full-Admin-only), `SchoolLookupPage.tsx` / `FranchiseLookupPage.tsx` (lookup-gated, empty by default, shown here post-search)
- Kept the real "Rotate credential" gating exactly — STRIPE-provider payment accounts only, shown both with (School) and without (Franchise, BANK_TRANSFER) in the mockup
- Artifact: https://claude.ai/artifact/Sb2k58B66vCfLs9hFWYAGt

---

**All 14 queued pages are now done** (Login flow, Instructors, Branches, Register, Verify OTP/Forgot/Reset, Timetable, Staff, Disciplines/Skills/Ranks, Classes, Membership Plans, Transactions, Waivers, Franchises, Notifications, platform-admin's Admin Users/School lookup/Franchise lookup). Figma's MCP rate limit was hit partway through Transactions — everything from Transactions onward was built from real code plus previously-cached Figma structural text, not fresh screenshots.

## Typography — Figtree

**Status:** implemented (not yet committed)

- User uploaded Uber Move (`UberMove-*.ttf`) and later a re-zipped "EnnVisions" set as the desired typeface — both rejected: every file's embedded metadata literally reads "This custom font has been licensed exclusively to Uber," including the renamed set (glyph names still contained "Uber"). Neither was added to the repo.
- Verified 5 open-license alternatives (Inter, Plus Jakarta Sans, Manrope, Figtree, Lato — all SIL OFL 1.1) with a real comparison artifact, no Uber Move glyphs rendered anywhere (even privately), described in words instead.
- User picked **Figtree**. Installed `@fontsource-variable/figtree` (self-hosted variable font, SIL OFL) into `packages/ui`, imported in `index.ts`, set as `--font-sans` in `tokens.css`. DESIGN.md's Typography + Performance sections rewritten to honestly reflect the trade-off (one self-hosted webfont request now, mitigated by `font-display: swap` + system fallback).
- Single token change point — cascades to every already-built page automatically, no per-page edits.
- Demo artifact: https://claude.ai/artifact/RwzDugp8VcNqy7nmdPgFsp

## school-portal — Instructors (full-page "look replica")

**Status:** implemented (22 Sep 2026, Decision 120) — see the final column
order/name-resolution notes below; superseded by the earlier "Instructors &
Branches" section's status line, kept here as the historical revision record

- Source: PDF export of the same Figma "instructorList" screen already reviewed — no new information, same analysis applied
- User asked for a 100%-look replica (full shell, header bar, pagination component, etc.), with the explicit constraint: don't fabricate data that doesn't apply
- **Header bar (search/bell/avatar/language) kept as pure visual chrome** — not in the real `AppShell` today, but doesn't assert any Instructor-specific fact, so replicating its look isn't inventing data. Flagged as a real `AppShell` feature proposal if it's ever wanted for real, not a page-level change.
- **Sidebar nav → real `Shell.tsx` list**, not the PDF's (page names are information, not decoration)
- **"Ranking" progress bar → dropped, not just restyled.** The widget itself needs a percentage that doesn't exist for `beltRanking` (plain text) — faking the number the bar shows would be exactly the invented data being avoided. Kept the column, shows real belt text.
- **"Status: Active" → dropped** (no field to back it)
- **Date-range picker → dropped**, distinguished from the header bar: its whole purpose is date-filtering this list, and no such capability exists for Instructors at all — this one promises a feature, not just furniture.
- **Pagination → look kept, data honest.** Real Prev/1/Next component style, correctly shown as a single disabled page for 5 real rows, not the PDF's fake "10 pages."
- **"Id" → added back** (real field); **"Name" → still omitted** (no field exists at all)

**Revision — dummy avatar, "Ranking" column restored, Instructor grading-link question raised:**

- User asked for a dummy profile image, the Ranking field back, and font sizes matched to Figma
- **Avatar → generic silhouette icon**, not colored initials and not a fabricated "realistic" photo — `photoUrl` is a real nullable field on `InstructorResponseDto`, so an icon placeholder for "no photo set" is honest; a stock photo standing in for a specific instructor would not be
- **Column relabeled "Ranking"** (was "Belt / ranking") to match Figma's own wording — still shows real `beltRanking` text only, no progress bar/percentage (see prior entry — that finding didn't change)
- Checked a second, previously-unreviewed Figma frame the user's phrasing pointed at — **"Instructor Information" profile screen, node `2639:2120`** — confirms the profile-page concept exists in Figma, but its own "Ranking" field literally renders the placeholder value **"Yes"** (unbound, not a real percentage) — reinforces rather than overturns the no-fabricated-number finding
- Font sizes: left at the previously-confirmed type scale (table 14px, badges 13px, page title `--font-size-heading-md`) — inferred from DESIGN.md tokens and one successfully-fetched Figma frame (the login form), not this exact list screen, due to the ongoing Figma MCP rate limit; not re-verified pixel-for-pixel against this screen
- **New question raised by user, not yet resolved:** should Instructor have a *real* rank/grading-system link (like `StudentRank`), rather than the current free-text `beltRanking`? Researched, not decided — see `[UNRESOLVED]` note below.
- Artifact: https://claude.ai/artifact/KYv6romDvrQYMHFzebeNt6 (Version 2)

**`[CONFIRMED]` — Instructor rank: V1 manual dropdown, V2 grading-system link deferred (Decision 108):**

- `InstructorResponseDto.beltRanking` (`packages/api-client/src/generated/schema.d.ts`) is explicitly documented in its own DTO comment as *"Plain display text (e.g. \"Black Belt, 3rd Dan\") — not a live reference into the grading system"* — this is a deliberate existing design choice, not an oversight
- Domain-rules skill's entity-relations model has exactly one rank-tracking entity, `StudentRank` ("Student(User) 1—\* StudentRank, one per discipline") — Instructor has no rank/progress relation anywhere in the confirmed model; `Rank` (discipline ladder, reference data) is "referenced by StudentRank, not owned per-student"
- Resolved directly with the user, 17 Sep 2026 — recorded as **Decision 108** (`docs/decisions/POST-SPEC-55-DECISION-LOG.md`): V1 is a manual belt dropdown on the Instructor's own profile settings page (no link to the grading system, `beltRanking` stays plain text); V2, linking it to the real grading system, is deferred and not designed
- Still open per Decision 108, not to be guessed at: the V1 dropdown's option set, whether Instructor rank is discipline-scoped like `StudentRank`, and which profile settings screen it lives on (not yet mocked up — only the Staff-facing list/detail views are covered so far)
- Doesn't change this page's mockup: it already shows `beltRanking` as plain text with no progress bar, which is exactly what V1 confirms — a future Instructor-facing "my profile settings" page is where the dropdown itself would appear

**Correction — Instructor name was wrongly dropped, restored:**

- User caught this by comparing the rendered page against the Figma/PDF reference: the earlier revision had no Name column at all, identifying rows only by truncated UUID
- Original reasoning was too narrow: `InstructorResponseDto` (`packages/api-client/src/generated/schema.d.ts`) only carries `userId`, not a name, so I'd called it "no field exists." But `userId` references a real `User` row, and `User.firstName`/`User.surname` are already-confirmed fields — the name genuinely exists in the data model, it's just not joined into this list endpoint's response today. That's a real API completeness gap worth flagging (the Instructors list endpoint should resolve/include the linked User's name), not a case of inventing data
- Fixed: added an "Instructor" column (avatar + name together, matching how the reference shows it) with dummy names standing in for the join, same convention as every other dummy value already on the page (phone numbers, branch names, IDs)
- Rendered the page to JPG via local headless Chromium (Playwright, `/opt/pw-browsers/chromium`) and sent it directly, since the user wanted a static image rather than the live artifact link
- Artifact: https://claude.ai/artifact/KYv6romDvrQYMHFzebeNt6 (Version 3)

**Rebuild — abandoned the "100% shell replica" approach, back to "Figma as reference" (the originally agreed pattern):**

- User called it: the full-shell-replica attempt (fake topbar with search/bell/avatar/language, fake browser chrome around the real sidebar) wasn't working — it diverged from both the real app and the Figma reference at once, on top of the Name-column mistake above
- Figma MCP was still rate-limited (Starter plan), so re-derived the real column order from the cached `figma-metadata.xml` dump instead of a fresh fetch: instructorList's (node 2380:640) actual `<text>` header labels are, in order, **Id · Image · Name · Ranking · Specializations · Experience · Phone Number · Status · Actions**
- Rebuilt the page on the same simple pattern already used successfully for every other page this session (`PageHeader` + `Card` + `Table`, no fake shell/topbar) — the pattern from the original `instructors-branches.html`, not the one-off "full replica" experiment
- Column order now follows Figma's real order for every shared field; `Status` stays dropped (no such field on `InstructorResponseDto`); `Branch` stays as an addition beyond Figma (real, confirmed field, central to ULTM8's multi-branch model) — not a contradiction of "reference not copy," since Figma showing fewer real fields isn't a reason to hide one that exists
- Name column now included (same dummy-names-as-join-placeholder treatment as the correction above), instead of being dropped a second time
- Artifact: https://claude.ai/artifact/KYv6romDvrQYMHFzebeNt6 (Version 4) — JPG re-rendered and re-sent

**Audit — same "no name field" mistake found and fixed on two other pages:**

- Since the Instructors Name-column error was a reasoning mistake (not page-specific), spot-checked the rest of the loop's own changelog notes for the same pattern ("no name-lookup endpoint," "truncated ID," "same gap as...") rather than re-deriving every page from scratch
- Found it twice, confirmed against `schema.d.ts` both times before fixing (same standard as the Instructors correction):
  - **`transactions.html`** — `TransactionResponseDto.studentId` only carries an ID; Student was shown as a truncated UUID. Fixed: shown as a name (dummy placeholder), changelog corrected. Artifact: https://claude.ai/artifact/ThDY6cRhHrVAS9Y34pgyzH (Version 2)
  - **`classes.html`** — two separate instances: (1) Class Detail's Bookings table, `BookingResponseDto.studentId`, same fix; (2) Class Detail's Waitlist table, `WaitlistEntryResponseDto.studentId`, same fix, not called out in the original changelog text at all — caught only by checking the actual rows. Also resolved the Classes list's already-flagged-but-not-added Instructor name column, since it was the same low-risk join reasoning. Artifact: https://claude.ai/artifact/NAEVAWWQrNh8XnVbuikK6E (Version 2)
- Checked but found **no instance** of this pattern in: `waivers.html`, `notifications.html`, `staff.html`, `membership-plans.html`, `timetable.html`, `franchises.html`, `disciplines.html` — none of these reference a bare `studentId`/`userId` without either already resolving it or not needing to
- Underlying, still-open real gap (not a mockup issue): `InstructorResponseDto`, `TransactionResponseDto`, `BookingResponseDto`, and `WaitlistEntryResponseDto` all expose a bare `userId`/`studentId` with no name resolution — every one of them should get a real join/expanded-DTO fix, not just this mockup's dummy-name workaround

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
