# Grading — what's left, by team

**Date:** 22 Oct 2026. **Where things stand:** the grading people use today is built and tested against the real backend: every pull request runs all the API grading tests on a real database, plus the portal browser tests. What's left is the New Portal grading redesign, Kids and Adult programs, and the items below.

Details for the backend team: [`GRADING-BACKEND-HANDOVER.md`](GRADING-BACKEND-HANDOVER.md). Decisions: `docs/decisions/POST-SPEC-55-DECISION-LOG.md` (280–290, 297–305).

---

## Product owner — answered

All five questions were answered on 22 Oct 2026 (Decisions 297–301):
- **Grading settings right:** "Change board %" becomes "Change grading settings" (per style); the promotion fee switches are owner-only (297).
- **Kids → Adult sign-offs:** carried over when the Adult ladder has a skill with the same name (298).
- **Belt corrections:** reviewed by the owner and coaches with "Verify ranks"; any rank, with a note (299).
- **Promotion fee:** a price per belt or stripe (none = free); the student accepts before paying; an owner switch decides whether grading waits for payment (300).
- **Hours:** from the class length; each grade requires classes, hours or both; open mat has its own switch (301).

The two related topics are answered too: **student charges and balances** (Decision 303: credit allowed; owner, Branch Staff and anyone with "Can create charges"; pay in the app) and **open mat** (Decision 304: scheduled and unplanned; always booked; credit on by default; only the owner and permitted staff start one; in-app alerts, push opt-in).

## Backend team (`apps/api`)

| # | Task | Ready? |
|---|---|---|
| B7 | Remove "(Decision N)" from history notes and errors people see, and clean saved notes | ✅ ready |
| B6 | Student photo on grading data (board, promote, report) | ✅ ready |
| B2 | Grading settings: "Change grading settings" right, Ready for Adult age, Belts/Levels, fee switches (owner), open mat switch | ✅ ready |
| B1 | Kids and Adult programs: two ladders, grade a kid into Adult (from the age; Blue Belt first; everything carries over, sign-offs by matching name; classes restart at 0) | ✅ ready |
| B3 | Bulk promote: pick a higher rank per student, checks still apply | ✅ ready |
| B4 | Levels instead of belts (No-Gi) | ✅ ready |
| B5 | Saved belt colours per School | ✅ ready |
| B8 | Students can ask for a belt correction (any rank, note required); owner or "Verify ranks" coaches approve or reject | ✅ ready |
| B9 | Belt progress on the check-in screen (with the check-in rules, v1.3 §3.5) | ✅ ready |
| B11 | Attendance hours: classes, hours or both per grade; progress breakdown | ✅ ready |
| B10 | Promotion fee: price per grade, student accepts, waiting/declined, waive | ✅ ready (payment step after C1) |
| C1 | Staff-created charges and member balances, paid in the app (Decision 303) | ✅ ready |
| C2 | Open mat sessions: scheduled and unplanned, walk-in bookings, credits, alerts (Decision 304) | ✅ ready |

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
| Grading → Settings page | B2, B10, B11 |
| Belt editor: price per grade; classes / hours / both per grade | B10, B11 |
| Board: "Waiting for fee" / "Fee declined"; owner waives or cancels a fee | B10 |
| Student page: grading progress breakdown per requirement | B11 |
| Belt editor: one grade at a time, insert position, duplicate a rank, drag and drop with touch, stripe colour groups | — |
| Colour wheel with saved colours | B5 |
| Levels badge | B4 |
| Two-tone belt picture (middle band) | — |
| Belt correction requests (review list) | B8 |

## Frontend team — Student app (`apps/student`)

The coach screens' five web-only actions (skipping ranks, bulk promote, moving columns, rank dates, first rank) stay on the web portal for now (Decision 305).

| Task | Needs backend |
|---|---|
| Ask for a belt correction | B8 |
| Accept or decline a promotion fee (Guardian for a child) | B10 |
| Grading progress breakdown per requirement | B11 |
| Belt progress after check-in | B9 |
| Levels badge, Kids/Adult program names | B4, B1 |
| Translate the app (deferred by Decision 273) | — |

## QA

| Task | Notes |
|---|---|
| Watch the nightly Firefox and Safari (WebKit) run, and fix what it finds | Set up by Decision 302 (`.github/workflows/browsers-nightly.yml`); "Run workflow" runs it on demand. The first runs may show real problems: grading was never tested in these browsers. |
| Native-speaker review of the portal's grading translations | First drafts (Decision 273). |
| Re-run the grading stress test on the redesigned portal | 20 academies, 300–500 students, 50–90% graded at once. |

## Deferred on purpose

Grading events with pass/fail (Version 2) · franchise-wide ladders · push delivery of grading notices (v1.3, waiting on credentials) · coach invites by text message · instructor belt linked to grading history (Version 2) · more style templates · deleting grading data on account deletion (waiting on the erasure design).
