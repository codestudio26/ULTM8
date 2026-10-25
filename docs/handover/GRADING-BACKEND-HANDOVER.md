# Grading — backend handover

**Date:** 22 Oct 2026 · **For:** the backend team (`apps/api`) · **Status of grading on `master`:** the core is built and tested; this file is what's left.

Read this before starting. Each task says what it must do, where the code is today, a suggested build, and when it's done. The frontend tasks that depend on yours are listed at the end, so you can agree the API shape with the frontend team first.

> **Note to the backend team (23 Oct 2026, updated).** Everything left in this file is yours. **B11 (hours trained) and B10 (promotion fee) are built and on `master`** (PRs #292, #293, #294; Decisions 306, 307, 313, 314), so don't rebuild them; their sections below say what was built and what's still open. If anything is unclear, or you need information to start a task, ask the product owner: questions get answered quickly, and a gap that needs a business decision is recorded in the decision log before anyone builds it.
>
> **Suggested order:** **C1** first (charges and balances): until it exists a promotion fee can't be paid, and with the default setting a waiting promotion only goes through when the owner waives the fee. Then **B2** (it absorbs the two small settings endpoints B10 and B11 added), **B1**, and the rest in any order. Known issues in the repo are in section 6.

---

## 1. Read first

**What already works (don't rebuild it):** ranks and stripes, skills and sign-off, the grading engine (classes, days, skills), promote / move down / stripe award, skipping ranks in a single grade, the Grading Board (columns, move, log a class, Active switch), bulk promote (no limit, sent 200 at a time, safe retry), grading permissions per coach and branch, "ready to grade" notifications, rank history with notes and voiding, self-declared belts and verifying them. Decisions 124–207 and 282–284.

**Sources, highest first** (from `CLAUDE.md`):
1. Spec 55, then `skills/ultm8-domain-rules/SKILL.md`.
2. `docs/decisions/POST-SPEC-55-DECISION-LOG.md`. **For grading, Gus's rules (Decision 124 onward) override Spec 55** where they conflict. The decisions for this work are **280, 281, 285–290, 297–304, 306, 307 and 313**.
3. The New Portal design: `DESIGN.md` → "Grading screens" (merged into `master`), and the published design (ask the product owner for the link). The design shows UI; it's never the source of a business rule on its own.

**Rules that always apply:**
- **Tenancy and RLS.** Every query stays inside the School (Franchise → School → Branch). Use `prismaApp.withTenantContext(...)` as `grading.service.ts` does. Add RLS policies and grants in the migration for any new table. Never read across Schools.
- **Who may grade.** Reuse `gradeAuthorizer` / `assertCanGrade` (`grading.service.ts`). Owners always can; coaches only for the styles, actions and branches they're given (Decisions 138, 168, 181).
- **History.** Every change of rank writes a `PromotionEvent` through `changeRung`, so the history stays correct. Don't write `StudentRank` directly.
- **`[UNRESOLVED]` means stop.** Where a task says something is still open, build only the decided part and ask the product owner.
- **No decision numbers in text people see** (task B7). Put the reference in a code comment instead.

**Tests:** every pull request runs all API end-to-end suites against Postgres (`apps/api/test/*.e2e-spec.ts`, in the "Cross-tenant isolation gate" CI job) and the portal browser tests. Grading suites start with `grading-`; `test/live-membership.ts` gives a test student a live membership (only active students can be graded, Decision 283). Add API tests for every rule below.

---

## 2. Ready to build

### B1. Kids and Adult programs — Decisions 281 and 285 (largest task)

**What it must do:**
- Brazilian Jiu-Jitsu has **two separate ladders**: Kids and Adult. They are two programs, not one combined ladder (Decision 281).
- A Kids student can be **graded into the Adult program** in one action. The default first adult rank is **Blue Belt** (Decision 285 item 1).
- **The age is a rule:** a kid can be graded into Adult only from the School's **"Ready for Adult from age"** (default **16**, the IBJJF age). To go earlier, the School lowers the age first (285 item 2).
- From that age the board shows the **"Ready for Adult program"** tag on the kid. Nothing moves on its own.
- **What moves with the student:** history, notes and skill sign-offs. **Only the class count restarts from zero** (285 item 3). This is unlike an ordinary grade, which clears sign-offs.
- The history entry reads **"Moved to Adult program"**.
- It works from the single Grade dialog, the board and bulk promote.

**Today:** `Discipline` has no program, parent or age (`prisma/schema.prisma`). `StudentRank` is unique on `(studentId, disciplineId)`. A student can hold ranks in several disciplines (e.g. BJJ and No-Gi).

**Suggested build:**
- **Data:** a nullable `Discipline.program` (`KIDS | ADULT`) and `Discipline.adultDisciplineId` on the Kids ladder (pointing at the Adult one), plus `Discipline.readyForAdultAge Int @default(16)` on the Kids ladder. A separate `Program` table is the alternative; pick one and agree it with the frontend team. Both keep each ladder's own `Rank`s.
- **Grade across:** `promote` (and bulk, see B3) accepts a target rung on the linked Adult ladder.
  - Refuse it (400) when the student is younger than `readyForAdultAge` on the grading date, with a plain message: "{name} is under the School's Ready for Adult age ({n}). Change the age in Grading settings first."
  - In one transaction: create or update the student's Adult `StudentRank` at the target rung, copy the skill sign-offs whose skills are on the Adult rank, set the class count to 0, close the Kids rank (archive it, or keep it read-only; agree with the frontend which), and write the `PromotionEvent` with the system note "Moved to Adult program".
  - The age comes from `User.dateOfBirth`. Students without a date of birth: refuse with a clear message.
- **Board:** return `readyForAdult: boolean` on Kids cards (age reached), and the program on each discipline.
- **Changing the age:** the owner, or a coach with the grading settings right (see B2).
- **Which sign-offs carry over (Decision 298):** a Kids skill that was signed off counts on the Adult ladder when the Adult ladder has a skill with exactly the same name. Unmatched sign-offs stay in the history only.

**Done when:** a kid at or over the age can be graded onto Blue Belt (or any adult rank) from the Grade dialog, the board and bulk promote; under the age it's refused; afterwards they show under Adult, with "Moved to Adult program" in their history, their sign-offs and history kept and 0 classes; the tag shows from the age; a School never sees another School's programs.

---

### B2. Grading settings: the right and the School-wide settings — Decisions 285 item 4, 287, 290

**What it must do:**
- The designed **Grading → Settings** page has these sections: How ranks are shown, Grading rules, Grading Board columns, Whole school.
- **Who may change grading settings (Decision 297):** the School owner, and coaches with **"Change grading settings"** for that style. This is today's "Change board %" right, renamed and widened to the whole page. **The promotion fee switches are owner-only.**
- Settings to store:
  - per style: board %, **Ready for Adult from age** (Kids ladder, B1), **Ranks shown as: Belts / Levels** (B4);
  - School-wide, **owner only**: **Promotion fee on/off** (Decision 287, off by default) and **"Allow grading before the fee is paid"** (Decision 300, B10);
  - School-wide, owner or "Change grading settings": **"Open mat counts toward hours"** (Decision 301 item 6, B11).

**Today:** the right closest to this is `GradingPermission.canChangeBoardThresholds` ("Change board %"). Board % is saved with `PUT disciplines/:id/board-thresholds`. Other style settings are on `PATCH disciplines/:id`.

**Suggested build:**
- **Rename the right:** `canChangeBoardThresholds` → `canChangeGradingSettings` (migration renames the column, so everyone keeps their current value). It now guards every per-style setting, not only board %. Update the Grading permissions page label to "Change grading settings".
- Per-style settings go on `Discipline`. School-wide ones on `School` or a small `GradingSettings` row per School. Expose one read and one save endpoint the settings page can use, or extend `PATCH disciplines/:id`.
- The two fee switches check for the owner only; "Open mat counts toward hours" accepts the owner or a coach with `canChangeGradingSettings` for any style at the School.

**Done when:** the owner and a coach with the right can change each per-style setting; only the owner can change the fee switches; a coach without the right gets 403; the values come back on reload.

---

### B3. Bulk promote: pick the rank per student ("Promote to")

**What it must do:** in bulk promote each student starts on their next rank, but the coach can pick a **higher** one for any student (skip ranks), or an Adult rank for a Kids student (B1). This is the same as the single Grade dialog. The product owner asked for it on 21 Oct 2026 (DESIGN.md "Promote selected: pick the rank"; skipping is Decision 128 item 7).

**Today:** `BulkPromoteDto` (`src/ranks/dto/grading-board.dto.ts`) has no target; `bulkPromote()` (`grading.service.ts`) always uses `ladder[fromIndex + 1]`, and its history note doesn't say "Skipped N rank(s)".

**Suggested build:**
- Add an optional `targets: [{ studentId, rungId }]` (validated like `expected`, at most 200). A student without one goes up one rung, as today.
- The target must be above the current rung on the same ladder, or on the linked Adult ladder (B1). Otherwise list the student under `cannotPromote` with a reason.
- **The next rank's checks apply whatever target is picked** (Decision 289): "Skills required" blocks; missing skills or days short need the acknowledgement. `changeRung` already does this for a single grade; reuse it.
- History note: "Skipped N rank(s) in between." when it skips, as a single grade writes it. Keep the `expected` guard (Decision 284) so a retry never promotes twice.
- The dry run returns each student's planned `toRungId`, so the window can show it.

**Done when:** a batch can move one student one stripe and another straight to Blue Belt; the checks still apply on a skip; the history shows the skip; the existing bulk tests still pass.

---

### B4. Ranks without a belt: Levels — Decision 290 (v1.3 backlog §3.19)

**What it must do:** a style shows its ranks as **Belts** or **Levels**, never a mix. A level is a coloured badge with numbered steps (Beginner 1, 2, 3), each with its own requirements. Grading works exactly as for stripes.

**Suggested build:**
- `Discipline.rankDisplay` enum `BELTS | LEVELS`, default `BELTS`. Display only, so it can change while students hold ranks.
- For `LEVELS`: `Rank.primaryColour` is the badge colour; `secondaryColour` and `tagColour` stay null; each step is a `RankStripeTier` with empty `stripeSegments`, default name "{level} {n}". Reject stripe segments on a Levels style with a 400.
- Return `rankDisplay` on every discipline and ladder response.
- The three IBJJF templates stay `BELTS`.
- Make belt-only validation messages neutral ("Pick a colour.").

**Done when:** a style can be created as Levels; its ranks and steps save without stripes; grading on it works like a belt style.

---

### B5. Saved belt colours per School — v1.3 backlog §3.18

**What it must do:** a School keeps a short list of its own colours for the belt editor. Staff can save, replace and delete them. Deleting one never changes a belt that already uses it.

**Suggested build:** `School.savedBeltColours String[]` (upper-case `#RRGGBB`, no duplicates, about 24 at most). `GET` and `PUT /v1/schools/:schoolId/belt-colours` (the whole list). Only the owner may change it, as for editing the ladder. Same tenant guards as the ranks endpoints.

**Done when:** a saved colour is there after reload and for the School's other staff; edit and delete work; no School sees another's colours.

---

### B6. Student photos on grading data

**What it must do:** the redesigned board, the student panel, the selection panel, the promote window and the printable report show each student's photo (or initials).

**Today:** `User.profilePhotoUrl` exists; `GradingBoardItemDto` and the bulk promote rows don't return it.

**Suggested build:** add `photoUrl: string | null` to `GradingBoardItemDto` (and to rank-history / bulk rows if the frontend needs it there). Check that the staff who can see the board are allowed to read the photo under RLS (the board already reads first name and surname through the policies in `20261021000000_grading_board`).

**Done when:** the board response carries the photo for every student the caller can see, and no photo of a student they can't see.

---

### B7. Remove decision numbers from text people see — v1.3 backlog §3.17

**What it must do:** no history note or error message shown in the portal or the student app contains "(Decision N)".

**Where:** `grep -rn "(Decision" apps/api/src --include=*.ts` and keep only strings sent to people: `throw new …Exception('…')` and `systemNote: '…'`. Swagger `@ApiProperty` descriptions can keep them. This includes the newest ones from 21–22 Oct, e.g. `INACTIVE_MESSAGE` ("…(Decision 283)…") and the bulk note "Promoted in a batch; acknowledged: … (Decision 130).".

**Suggested build:**
1. Drop the "(Decision N)" from each string; put `// Decision N` on the line above.
2. A migration that cleans saved notes: `UPDATE "PromotionEvent" SET "systemNote" = regexp_replace("systemNote", '\s*\(Decision [0-9]+(, item [0-9]+)?\)', '', 'g') WHERE "systemNote" ~ '\(Decision [0-9]+';` (check the names in `schema.prisma`; never touch the staff-written `note`).
3. A unit test that fails if `Exception('…(Decision` or `systemNote: '…(Decision` comes back.
4. Update the tests that match the old texts (grading suites in `apps/api/test/`, `engine/grading-engine.spec.ts`).

**Done when:** no "(Decision" in any text a person sees, old history reads cleanly, all grading tests pass.

---

### B8. Students can ask for a belt correction — Decision 286 (v1.3 backlog §3.13)

**What it must do:** a student can ask the School to correct a wrong belt. Students still can't change their own rank. A coach approves or rejects; an approval goes through the normal grading path, so the history shows it.

**Suggested build:**
- `RankCorrectionRequest { id, schoolId, studentId, disciplineId, currentRungId, requestedRungId, note, status (PENDING | APPROVED | REJECTED), reviewedById, reviewedAt, reviewNote }` with RLS like `StudentRank`.
- Student: create and list their own; one pending request per style.
- Staff: list pending for the School (like `GET schools/:schoolId/rank-verifications`), approve (applies through `changeRung` with a system note "Corrected at the student's request") or reject with a reason. Notify the student either way.
- **Reviewers (Decision 299):** the owner, and coaches with **"Verify ranks"** (`canVerifyRanks`) for that style covering the student's branch, the same people as for declared belts.
- **What can be asked (Decision 299):** any rank on that style's ladder. **A note is required** (400 without one).

**Done when:** a student can request, a reviewer can approve or reject, an approval changes the rank with history, a School never sees another's requests.

---

### B9. Belt progress on the check-in screen — v1.3 backlog §3.5 (setting AT8)

**What it must do:** when the School turns it on, the check-in screen shows the student's progress, e.g. "12 of 40 classes to Blue".

**Suggested build:** after a check-in, return a short progress summary per style from the grading engine (`eligibilityOnLadder`): current rank, next rank, classes done and needed (or days for a time-only rank). Respect the School's check-in setting (part of §3.5's check-in rules, built with them). The student's own data only.

**Done when:** with the setting on, a check-in returns the summary; with it off, it doesn't.

---

### B10. Promotion fee — Decisions 287, 297, 300 — ✅ built (#293, #294)

> **Built.** Switches: `GET`/`PUT /v1/schools/:schoolId/promotion-fee-settings` (owner changes). Prices: `stripeTiers[].promotionFeeMinor` on the rank endpoints, shown only to the owner and people with grading permission for the style (Decision 314). Requests: `PromotionFeeRequest` table, payer accept/decline, owner waive/cancel, "to decide" with dismiss by anyone with grading permission for the style (314), the board's `feeStatus`, and the one reminder (313) in the daily sweep. One waiting promotion per student per style (314).
> **Left for you:** the payment step. **C1** turns an ACCEPTED request into a charge and, once paid, calls `PromotionFeeService.markPaid(studentId, requestId)` (exported from the ranks module, tested), which applies a waiting promotion with the coach's date. There is no "paid at the desk" action: that isn't decided. The original brief follows for reference.


**What it must do:**
- **Prices per grade.** With the fee switch on, the owner can set a price on any belt and any stripe grade. **No price = free.** Stripes are free unless priced.
- **Never charged directly.** At grading, a **fee request** appears in the student's account (the Guardian's, for a child). They **accept** it, then it's charged.
- **"Allow grading before the fee is paid"** (owner switch):
  - **On:** the promotion happens straight away; the request waits. Declined → the owner sees **"Fee declined"** on the student; the promotion stays.
  - **Off (the default, Decision 307):** the promotion waits, shown as **"Waiting for fee"** on the board, and applies only once the fee is accepted and paid. Declined → nothing changes, the owner sees "Fee declined".
  - No answer → the request stays open.
- **The owner can waive or cancel a fee at any time** (Decision 307):
  - Waiving a **waiting** promotion applies it straight away (the coach already made it).
  - **Cancelling** a waiting promotion, or **waiving a declined** fee, never promotes on its own: the student stays on their rank and the planned promotion is marked **"to decide"** for a coach. A coach who may promote that student (or the owner) confirms it through the normal Promote flow; no new fee request is created for it.
- **With the fee switch off, prices are hidden** everywhere (belt editor and ladder), and none are returned to the portal.
- The history keeps **the grading date the coach chose**, not the payment date.
- **Bulk promote:** one request per promoted student, for their own grade's price.
- Owner-only: the switches and the prices.

**Suggested build:**
- `RankStripeTier.promotionFeeMinor Int?` (plus the School's currency), null = free.
- `PromotionFeeRequest { id, schoolId, studentId, payerId (student or Guardian), disciplineId, toRungId, amountMinor, currency, status (PENDING | ACCEPTED | PAID | DECLINED | WAIVED | CANCELLED), promotionEventId?, pendingGrade (target, grading date, note, acknowledgement) when the promotion waits, timestamps }` with RLS for the School and the payer.
- In `changeRung` / bulk: if the target grade has a price and the fee switch is on, create the request. With "grade before paying" off, store the planned grade on the request instead of applying it; apply it (through `changeRung`, with the stored grading date) when the request is paid or waived. Keep the `expected` rung guard so a waiting grade can't apply twice.
- Board: return `feeStatus` (waiting / declined / toDecide) on cards. "To decide" carries the planned grade so the Promote flow can start on it, flagged as fee-free.
- "To decide" reminder (Decision 313): one in-app/email reminder, 3 days after the promotion became "to decide", to the coaches who may promote that student in that style and branch and the owner. Send it only if the student is fully eligible (`eligibilityOnLadder(...).eligible`: classes 100%, days and every required skill). Never repeat it; it never times out. Reuse the "ready to grade" sweep and recipients (Decisions 145, 178), with its own once-only marker.
- Notify the payer when a request is created.
- **Payment step:** an accepted fee becomes a charge on the member's balance (C1, Decision 303), paid in the app or at the desk. Build prices, requests, accept/decline, waiting promotions, waive and cancel first if C1 isn't ready yet.

**Done when:** a priced grade creates a request; accepting (then paying) applies a waiting promotion; declining shows "Fee declined"; waiving a waiting promotion applies it; cancelling it, or waiving a declined fee, leaves it "to decide" and nothing applies until a coach promotes; a fully eligible "to decide" student gets exactly one reminder after 3 days, and a not-fully-eligible one gets none; bulk creates one request each; an unpriced grade is free; with the fee off no prices are returned; another School never sees the requests.

---

### B11. Hours trained (logged, not graded) — Decisions 301, 306 — ✅ built (#292)

> **Built.** `TrainingLog` table (minutes per style per check-in or "Log a class"), `hoursTrained` and `progressBreakdown` on `GET /v1/students/:id/eligibility` and `GET /v1/students/:id/grading`, and "Open mat counts toward hours" at `GET`/`PUT /v1/schools/:schoolId/grading-settings/open-mat-hours` (off by default). Grading reads none of it.
> **Left for you:** fold the open-mat switch into B2's settings page and the renamed right; add `TrainingLog` to account erasure once Decisions 245/265 settle it. The original brief follows for reference.


**Hours are a record only. Do not change the grading logic** (Decision 306): no hours requirement on a grade, and progress, readiness and "Ready to Grade" stay exactly as they are.

**What it must do:**
- Each check-in adds the **scheduled length** of the class to the student's hours trained (90 min = 1.5 h).
- **"Log a class"** adds the picked class's length, or a time the coach enters (default 60 min).
- **Open mat** sessions (C2, Decision 304) add to the hours only if the switch "Open mat counts toward hours" is on.
- The **student's page** shows a progress breakdown with the requirements grading already uses (classes, days at the rank, skills), each on its own next to the overall %, plus the **hours trained** as information.

**Suggested build:**
- Minutes per attendance record (copied from the class's scheduled length at check-in, or from "Log a class"), summed per student and style. Store minutes to avoid fractions.
- Return `hoursTrained` (total, and since the current rank if cheap) on the student grading data; never use it in `eligibilityOnLadder` or `progressPercent`.
- Return each existing requirement's own progress (classes, days, skills) for the breakdown.

**Done when:** check-ins and logged classes add hours; open mat follows the switch; the student page API returns the breakdown and the hours; every grade's progress and readiness are unchanged.

---

### B12. Requirement tick boxes, automatic promotion, first belt on first class — Decision 321

From the Gymdesk Programs study (25 Oct 2026).

- **Requirement tick boxes, on each style (owner):** Classes, Days in rank, Skills, Hours, Days attended, Minimum age.
  - An unticked requirement is never checked, even if a rung still holds a number for it.
  - `progressBreakdown` (B11) lists only the ticked requirements, and "ready" (100%) is computed from them.
- **Hours:** hours trained (B11) count toward a rung only in a style that ticks Hours. This amends Decision 306 for that style. Open mat counts only while its switch is on.
- **Days attended:** distinct calendar days (School time zone) with a check-in to a class of the style, since the last promotion. Counted per rung.
- **Minimum age, per rung:** age on the promotion day, from the date of birth. Eligibility stays false until then.
- **Promotion setting, per style (owner):** `MANUAL` (default), `AUTO_STRIPES`, `AUTO_ALL`.
  - **When:** an automatic promotion runs when the next rung is 100%: after a check-in, and in the grading sweep for time- and age-based requirements.
  - **Fee:** if the next rung has a fee, the fee request is created and the promotion runs when it is paid or waived (B10's `markPaid()` hook). A cancelled fee doesn't promote.
  - **History:** `PromotionEvent` records it as automatic, with no performer.
  - **Notices:** the student (the Guardian for a child) gets the usual promotion notice. The coaches of the style are told.
  - **Undo:** a coach with promote permission can undo an automatic promotion. The undo is recorded in the history.
  - **Reminders:** no "Promotion to decide" reminder for rungs that are awarded automatically.
- **Auto-assign first belt, per style (owner switch):** a student with no `StudentRank` in the style gets the first rung on their first check-in to a class of that style. It is created as VERIFIED (Decision 147). Self-declaring a higher belt stays possible (Decision 137).
- **Questions?** Ask the product owner. Nothing here is guessed: every rule above was answered on 25 Oct 2026.

## 3. Related work that grading needs

Not grading features themselves, but B10 and B11 depend on them. Both are decided.

### C1. Staff-created charges and member balances — Decision 303 (v1.3 backlog §3.6)

**What it must do:**
- Staff create **one-off** charges (e.g. a rash guard) and **recurring** charges outside a Membership Plan, with an optional discount (% or fixed). **Tax comes from the country**, never typed.
- Each member has a **balance**, which **can be in credit**; credit is used automatically against the next charges.
- **Who can create charges:** the owner; Branch Staff for their own branches; anyone else the owner turns on with **"Can create charges"** (per person; on by default for Branch Staff, off for Instructors). **Refunds and credit: owner only.**
- Members (or Guardians) **pay in the app**, the whole balance or one charge, through Stripe hosted Checkout as for memberships (Decisions 238/243), or at the desk. The receipt shows in their account.
- An accepted promotion fee (B10) is one of these charges.

**Suggested build (from backlog §3.6):** `Charge { schoolId, studentId, description, amount, discountType?, discountValue?, taxRate (from country), total, dueAt, status, paymentMethod, createdById }`; `RecurringCharge { …, interval, dayOfMonth, firstChargeAt, nextChargeAt }`; a ledger for the balance (charges, payments, credits, refunds) rather than a stored number; a per-country tax table set by Platform Admin; card payments through Stripe Connect on the School's account, cash and transfer recorded by staff; a scheduler for recurring charges; a `canCreateCharges` flag on the staff role grant.

**Done when:** staff can create one-off and recurring charges with discounts and country tax; the balance (including credit) shows on the profile and panel; members pay in the app and see the receipt; only permitted staff can create charges and only the owner can refund or credit.

---

### C2. Open mat sessions — Decision 304 (v1.3 backlog §5.9)

**What it must do:**
- **Scheduled open mat:** a timetable class with the class type "Open mat".
- **Unplanned open mat:** "+ Open mat session" at the front desk: style, start time, length (default 60 min). It creates a one-off class, so check-in, attendance and hours work unchanged.
- **Every check-in has a booking:** checking in without one creates it at that moment.
- **"Open mat uses a class credit"**, a School setting in Check-in rules, **on by default**.
- **Who can start an unplanned session:** the owner and staff with **"Can start open mat sessions"** (per person, **off for everyone by default**).
- **Students are told in the app:** a notification plus a home-screen banner while it's on, with "Book"; a push alert only for students who turn on "Open mat alerts" (off by default). Audience: live membership or pass, home branch = that branch, trains that style.

**Suggested build:** a one-off `Class` (or `ClassOccurrence`) flagged as unplanned open mat; reuse booking, waitlist and check-in code; `canStartOpenMat` on the staff role grant; a check-in-rules setting `openMatUsesCredit` (default true); a notification type `OPEN_MAT_STARTED` with a student preference for push.

**Done when:** a permitted staff member starts an unplanned session; eligible students see it in the app and can book; walk-in check-ins create bookings; credits follow the setting; hours count when the grading switch is on.

## 4. Deferred on purpose (not for now)

- Grading events with pass/fail, and a per-event fee: Version 2 (Decisions 158, 163).
- Franchise-wide ladders: after v1.1, no version yet (Decisions 151, 160).
- Push delivery of grading notices: built, waiting for Firebase/APNs credentials, v1.3 (Decisions 264, 267).
- Coach invites by text message: needs Twilio (Decision 183 item 2).
- Linking an instructor's belt to grading history: Version 2 (Decision 188 item 3).
- More style templates (Karate and others): when Gus confirms real numbers (Decision 131).
- Deleting a student's grading data on account deletion: waiting on the erasure design and legal review (Decisions 245, 265).

## 5. What the frontend team builds on top (agree the API with them)

The New Portal grading redesign (DESIGN.md → "Grading screens") is designed but not built in `apps/school-portal`. The parts that need your work:

| Frontend | Needs |
|---|---|
| Kids · Adult switch, "Adult program" group in Promote to, "Ready for Adult program" tag | B1 |
| Grading → Settings page (5th tab) | B2, B4, B10, B11 |
| "Promote to" picker per student in bulk promote | B3 |
| Levels badge instead of a belt | B4 |
| Colour wheel with saved colours in the belt editor | B5 |
| Avatars on the board, panels, promote window and report | B6 |
| Clean history notes and errors | B7 |
| Belt correction requests (student app and portal) | B8 |
| Belt progress on check-in | B9 |
| Belt editor: price per grade, only while the fee is on | B10 |
| Board: "Waiting for fee" / "Fee declined"; owner waives or cancels a fee | B10 |
| Student app: accept or decline a promotion fee (Guardian for a child) | B10 |
| Student page: progress breakdown per requirement, and hours trained | B11 |

Frontend-only (no backend): Grid/Rows views, sort by belt or name, the student panel and selection panel, click a progress bar to promote, the printable report with belts, the one-grade-at-a-time belt editor, duplicate a rank, drag and drop with touch, the two-tone belt picture, the 5-tab menu. In the student app, the coach screens still leave some actions to the web portal (skipping ranks, bulk promote, moving columns, editing rank dates, first rank); see `docs/TRACK-B-ROADMAP.md`.

**Suggested order:** B7 (small, clears the way) → B6 → B2 → B1 → B3 → B4 → B5 → B8 → B9 → B11 → B10. C1 before B10's payment step; C2 before open mat adds to hours. B1 and B3 touch the same promote code; do them together or B1 first.

---

## 6. Known issues in the repo (found while building B10 and B11)

- **API lint doesn't run.** `npm run lint` in `apps/api` fails on a clean `master` too: the installed ESLint (v10) ignores `apps/api/.eslintrc.json`, so nothing is linted. Pin ESLint 8 with the repo's plugins, or move the config to the flat format.
- **Schema and migrations have drifted.** `prisma migrate dev --create-only` proposes many unrelated changes, so the B10 and B11 migrations were written by hand. Worth one clean-up migration (or a reviewed baseline) so new migrations can be generated again.
- **Local e2e runs** need `QR_CLASS_TOKEN_SECRET` and `QR_STUDENT_TOKEN_SECRET` set (any values), or the attendance and hours suites are skipped. A full local run can hit Node's memory limit; `NODE_OPTIONS=--max-old-space-size=8192` fixes it.
- **Narrow readings still to confirm with the product owner** (listed in PRs #292 and #293): "Open mat" matched exactly by class type name; the open-mat switch applies at check-in time; every style on a class gets its minutes; a cancelled fee whose promotion already applied keeps the promotion; the payer can't decline after accepting; a reminder goes on the first day a "to decide" student is fully ready after day 3; turning the fee off doesn't close open requests; prices use the School's default currency.

