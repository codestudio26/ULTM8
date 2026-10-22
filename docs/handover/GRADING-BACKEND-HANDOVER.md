# Grading — backend handover

**Date:** 22 Oct 2026 · **For:** the backend team (`apps/api`) · **Status of grading on `master`:** the core is built and tested; this file is what's left.

Read this before starting. Each task says what it must do, where the code is today, a suggested build, and when it's done. The frontend tasks that depend on yours are listed at the end, so you can agree the API shape with the frontend team first.

---

## 1. Read first

**What already works (don't rebuild it):** ranks and stripes, skills and sign-off, the grading engine (classes, days, skills), promote / move down / stripe award, skipping ranks in a single grade, the Grading Board (columns, move, log a class, Active switch), bulk promote (no limit, sent 200 at a time, safe retry), grading permissions per coach and branch, "ready to grade" notifications, rank history with notes and voiding, self-declared belts and verifying them. Decisions 124–207 and 282–284.

**Sources, highest first** (from `CLAUDE.md`):
1. Spec 55, then `skills/ultm8-domain-rules/SKILL.md`.
2. `docs/decisions/POST-SPEC-55-DECISION-LOG.md`. **For grading, Gus's rules (Decision 124 onward) override Spec 55** where they conflict. The decisions for this work are **280, 281, 285–290**.
3. The New Portal design: `DESIGN.md` → "Grading screens" (on the design branch `claude/relaxed-bohr-j3ilir` until it merges), and the published design (ask the product owner for the link). The design shows UI; it's never the source of a business rule on its own.

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
- **Open (ask the product owner):** which skill sign-offs carry over when the Adult skills differ (285 "Still open"). Suggested default: a sign-off counts if the same skill is on the Adult rank.

**Done when:** a kid at or over the age can be graded onto Blue Belt (or any adult rank) from the Grade dialog, the board and bulk promote; under the age it's refused; afterwards they show under Adult, with "Moved to Adult program" in their history, their sign-offs and history kept and 0 classes; the tag shows from the age; a School never sees another School's programs.

---

### B2. Grading settings: the right and the School-wide settings — Decisions 285 item 4, 287, 290

**What it must do:**
- The designed **Grading → Settings** page has these sections: How ranks are shown, Grading rules, Grading Board columns, Whole school.
- **Who may change grading settings:** the School owner and coaches granted the grading settings right (285 item 4).
- New settings to store:
  - **Ready for Adult from age** (per Kids ladder, B1).
  - **Ranks shown as: Belts / Levels** (per style, B4).
  - **Promotion fee: on / off** (Decision 287), off by default.

**Today:** the right closest to this is `GradingPermission.canChangeBoardThresholds` ("Change board %"). Board % is saved with `PUT disciplines/:id/board-thresholds`. Other style settings are on `PATCH disciplines/:id`.

**Suggested build:**
- **Open (ask the product owner first):** rename and widen `canChangeBoardThresholds` into "Change grading settings", or add a new right next to it. Suggested: widen it (one right for the whole settings page) with a migration that keeps everyone's current value.
- Per-style settings go on `Discipline`; School-wide ones (the promotion fee switch) on `School` or a small `GradingSettings` row per School. Expose one read and one save endpoint the settings page can use, or extend `PATCH disciplines/:id`, guarded by the right above.

**Done when:** the owner and a coach with the right can change each setting; a coach without it gets 403; the values come back on reload.

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
- **Open (ask first):** who reviews (suggested: the owner and coaches with "Verify ranks", as for self-declared belts) and whether a student can request any rank or only a fix of their current one.

**Done when:** a student can request, a reviewer can approve or reject, an approval changes the rank with history, a School never sees another's requests.

---

### B9. Belt progress on the check-in screen — v1.3 backlog §3.5 (setting AT8)

**What it must do:** when the School turns it on, the check-in screen shows the student's progress, e.g. "12 of 40 classes to Blue".

**Suggested build:** after a check-in, return a short progress summary per style from the grading engine (`eligibilityOnLadder`): current rank, next rank, classes done and needed (or days for a time-only rank). Respect the School's check-in setting (part of §3.5's check-in rules, built with them). The student's own data only.

**Done when:** with the setting on, a check-in returns the summary; with it off, it doesn't.

---

## 3. Build only the decided part

| # | Feature | Decided | Still open — ask before building that part |
|---|---|---|---|
| P1 | **Promotion fee** (Decision 287) | A grading setting, fee on/off, off by default. Build the switch (B2). | The amount (one fee, per rank or per belt); when and how it's charged (card, balance); whether unpaid blocks the promotion; who pays for a child; stripes and bulk. **Don't build the charge yet.** |
| P2 | **Attendance hours** (Decision 288) | Hours are tracked as well as classes, and can be a grading requirement. | Where hours come from (scheduled length or real check-in/out); hours instead of or as well as classes, per rank; whether open mat counts (backlog §5.9). **Don't build until answered.** |

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
| Grading → Settings page (5th tab) | B2, B4, P1 switch |
| "Promote to" picker per student in bulk promote | B3 |
| Levels badge instead of a belt | B4 |
| Colour wheel with saved colours in the belt editor | B5 |
| Avatars on the board, panels, promote window and report | B6 |
| Clean history notes and errors | B7 |
| Belt correction requests (student app and portal) | B8 |
| Belt progress on check-in | B9 |

Frontend-only (no backend): Grid/Rows views, sort by belt or name, the student panel and selection panel, click a progress bar to promote, the printable report with belts, the one-grade-at-a-time belt editor, duplicate a rank, drag and drop with touch, the two-tone belt picture, the 5-tab menu. In the student app, the coach screens still leave some actions to the web portal (skipping ranks, bulk promote, moving columns, editing rank dates, first rank); see `docs/TRACK-B-ROADMAP.md`.

**Suggested order:** B7 (small, clears the way) → B6 → B2 → B1 → B3 → B4 → B5 → B8 → B9. B1 and B3 touch the same promote code; do them together or B1 first.
