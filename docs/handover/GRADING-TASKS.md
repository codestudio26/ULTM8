# Grading — what's left, by team

**Date:** 22 Oct 2026. **Where things stand:** the grading people use today is built and tested against the real backend: every pull request runs all the API grading tests on a real database, plus the portal browser tests. What's left is the New Portal grading redesign, Kids and Adult programs, and the items below.

Details for the backend team: [`GRADING-BACKEND-HANDOVER.md`](GRADING-BACKEND-HANDOVER.md). Decisions: `docs/decisions/POST-SPEC-55-DECISION-LOG.md` (280–290).

---

## Product owner — still to answer

Each one blocks only the part named.

| # | Question | Blocks |
|---|---|---|
| Q1 | The grading settings right: widen "Change board %" into "Change grading settings", or add a new right? (Decision 285) | B2 |
| Q2 | Kids → Adult: which skill sign-offs carry over when the Adult skills differ? Suggested: a sign-off counts if the same skill is on the Adult rank. (Decision 285) | part of B1 |
| Q3 | Belt correction: who reviews a request (suggested: owner + coaches with "Verify ranks")? Can a student ask for any rank, or only a fix of the current one? (Decision 286) | B8 |
| Q4 | Promotion fee: amount (one fee / per rank / per belt), when and how it's charged, does unpaid block the promotion, who pays for a child, stripes and bulk? (Decision 287) | the fee charge |
| Q5 | Attendance hours: from the class's scheduled length or real check-in/out? Instead of classes or as well, per rank? Does open mat count? (Decision 288) | hours |

## Backend team (`apps/api`)

| # | Task | Ready? |
|---|---|---|
| B7 | Remove "(Decision N)" from history notes and errors people see, and clean saved notes | ✅ ready |
| B6 | Student photo on grading data (board, promote, report) | ✅ ready |
| B2 | Grading settings: the right, Ready for Adult age, Belts/Levels, promotion fee on/off | ⏳ after Q1 |
| B1 | Kids and Adult programs: two ladders, grade a kid into Adult (from the age; Blue Belt first; everything carries over, classes restart at 0) | ✅ ready (Q2 for one detail) |
| B3 | Bulk promote: pick a higher rank per student, checks still apply | ✅ ready |
| B4 | Levels instead of belts (No-Gi) | ✅ ready |
| B5 | Saved belt colours per School | ✅ ready |
| B8 | Students can ask for a belt correction; a coach approves or rejects | ⏳ after Q3 |
| B9 | Belt progress on the check-in screen (with the check-in rules, v1.3 §3.5) | ✅ ready |
| P1 | Promotion fee: the on/off switch only (in B2) | switch ✅ · charge ⏳ Q4 |
| P2 | Attendance hours in grading | ⏳ after Q5 |

## Frontend team — School Portal (`apps/school-portal`)

Build the New Portal grading redesign (DESIGN.md → "Grading screens"; the published design). It merges after the backend handover.

| Task | Needs backend |
|---|---|
| 5-tab Grading menu: Board, Styles & Belts, Skills, Permissions, Settings | — |
| Grid / Rows views, sort by belt or name inside each stage | — |
| Right-hand student panel (rank, progress, skills, history) and the Selection panel / pill | — |
| Click a progress bar to promote | — |
| Our own "Promote to" drop-down (single and bulk) | B3 for bulk |
| Promote window and done list with belts; printable report with photos and belts | B6 |
| Avatars on the board and panels | B6 |
| Kids · Adult switch, "Adult program" in Promote to, "Ready for Adult program" tag | B1 |
| Grading → Settings page | B2 |
| Belt editor: one grade at a time, insert position, duplicate a rank, drag and drop with touch, stripe colour groups | — |
| Colour wheel with saved colours | B5 |
| Levels badge | B4 |
| Two-tone belt picture (middle band) | — |
| Belt correction requests (review list) | B8 |

## Frontend team — Student app (`apps/student`)

| Task | Needs backend |
|---|---|
| Ask for a belt correction | B8 |
| Belt progress after check-in | B9 |
| Levels badge, Kids/Adult program names | B4, B1 |
| Coach screens: decide which web-only actions come to the phone (skipping ranks, bulk promote, moving columns, rank dates, first rank) | — |
| Translate the app (deferred by Decision 273) | — |

## QA

| Task | Notes |
|---|---|
| Run the grading browser tests in Firefox and Safari (WebKit) | The tests already have Firefox and WebKit projects in `apps/school-portal/playwright.config.ts`; CI only runs Chromium. |
| Native-speaker review of the portal's grading translations | First drafts (Decision 273). |
| Re-run the grading stress test on the redesigned portal | 20 academies, 300–500 students, 50–90% graded at once. |

## Housekeeping

| Task | Notes |
|---|---|
| Update `skills/ultm8-domain-rules/SKILL.md` with Decisions 280–290 | Only with the product owner's approval (the skill's own rule). |
| Fix the clashing decision numbers on two unmerged branches | `claude/project-thread-203tsv` uses 279 (class cancellations); `claude/project-thread-dpnk7k` uses 280 (branch archive). Master already uses both. Renumber them to the next free numbers when they merge. |

## Deferred on purpose

Grading events with pass/fail (Version 2) · franchise-wide ladders · push delivery of grading notices (v1.3, waiting on credentials) · coach invites by text message · instructor belt linked to grading history (Version 2) · more style templates · deleting grading data on account deletion (waiting on the erasure design).
