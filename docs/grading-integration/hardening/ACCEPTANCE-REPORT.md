# Grading acceptance pass — Gus's prototype scenarios against the real ULTM8 API

> **Snapshot of 10 Oct 2026, against `master` @ `0362ddd`.** The findings below were fixed or decided afterwards; see [README.md](README.md) for where each one went. Line numbers refer to that commit.

Roadmap Phase 7, item 1 (`docs/grading-integration/GRADING-INTEGRATION-ROADMAP.md`). Run on 10 Oct 2026 against `master` @ `0362ddd`, on a dedicated database.

- **Script:** now committed as `apps/api/test/grading-acceptance.e2e-spec.ts`. It boots `AppModule` in-process like the other e2e specs, listens on a random local port and drives it with `fetch`. Students are seeded with a superuser `PrismaClient` (as the harness pushes students into `DB.students`); every eligibility read, grade, downgrade, sign-off, log-class, board read, board move, bulk promote, rank-date edit and void goes over HTTP.
- **Oracle:** the harness's own reference rules (`refReq`, `refEligible`, `refPct`, `refBand`, `refSkillsMissing`, `scenariosFor`, `populate`, the mulberry32 `rng`), ported unchanged in meaning and computed from the ladder **as stored in the DB**, never from the API's engine.
- **"Today":** the API uses the server clock in the student's zone (home branch → School → UTC; `grading-eligibility.ts`). The test School has no time zone, so all seeds are UTC days relative to the run's start day; the script records whether the UTC day changed mid-run (it did not).
- **Run:** CI runs a sample (every 3rd stripe, 2 scenarios each, 30 drags, 150 random actions). The full run in this report is `ACCEPTANCE_FULL=1 npx jest --config ./test/jest-e2e.json --runInBand test/grading-acceptance.e2e-spec.ts` from `apps/api`.

## Results

| Suite (harness numbering) | Checks | Failed | Time |
|---|---:|---:|---:|
| 2 · Ladders — the 3 IBJJF templates | 55 | 0 | 0.6 s |
| 3 · Eligibility and grading — every rung of every template (404 rungs, 5,109 scenarios over HTTP) | 107,586 | 0 | 824 s |
| 4 · Grade and Downgrade rules | 63 | 3 | 2.9 s |
| 5 · Student panel data — skills, classes, days | 17 | 0 | 1.1 s |
| 6 · Grading Board + bulk promote + drags — 600 students | 35 | 1 | 38.6 s |
| 10 · Hostile and awkward text | 69 | 0 | 7.6 s |
| 11–13 · Random actions, 3 seeds × 600 actions | 9 | 0 | 218 s |
| **Total** | **107,834** | **4** | |

The 4 failures are 3 distinct discrepancies (D1–D3 below). 1,182 harness sweep scenarios were not applicable (typed DB columns; see map). 2,400 requests hit HTTP 429 and were retried (see E1).

## Coverage map

Legend: **Covered** = an existing ULTM8 test already checks it; **New** = checked by this acceptance script; **N/A** = not applicable or overridden (decision cited). Many families are both Covered and New: the new check re-runs it on the real template ladders.

| Suite | Family | Status | Covered by / decision |
|---|---|---|---|
| 1 Dates | Display-format parsing ("14 Jan 2026", "14/01/2026") | N/A | The API takes YYYY-MM-DD only (`IsISO8601 strict`); display formats are the portal's job. New 4c confirms "14 Jan 2026" is refused (400). |
| 1 | Impossible / nonsense dates refused | Covered + New | engine `grading-engine.spec.ts` "refuses an unreadable date"; New 4c (banana, 2026-02-31) |
| 1 | daysSince: today = 0, future = 0, never negative | Covered + New | engine spec "days"; New sweep "date in the future" scenarios |
| 1 | Grading date not in the future | Covered + New | `grading-actions.e2e` back-dated test; New 4c |
| 1 | Event date may be in the future | N/A | Events moved to V2 (Decision 158, 163) |
| 1 | 366 days of 2024 round-trip | N/A | No display-format storage; dates are `timestamptz`/ISO |
| 2 Ladders | 9 templates | N/A for 6 | Decision 131: only the 3 IBJJF ladders ship |
| 2 | Rung counts 90/139/175, card count | Covered + New | `style-templates.e2e`; New |
| 2 | Unique ids/names, contiguous order, valid numbers, class types exist | New | (not covered before) |
| 2 | Last 10 time-only; years 3-3-3-5-5-5-7-7-10-0; top = Red Belt (9th) | Covered (partly) + New | `style-templates.e2e` checks black degrees + top; New checks full sequence |
| 2 | White rungs 0–4; Grey Belt rung sequences per variant; ≤4 stripes; Grey 18/73; one red stripe on White | New | |
| 2 | Every belt draws at every size | N/A | Portal drawing, not API |
| 3 Eligibility sweep | Every rung × harness scenarios: eligible, next rung, %, column, skills warning, years-shown guard | Covered (unit) + New | engine spec sweep (27-rung handmade ladder, unit level); New: 404 rungs of the real templates over HTTP, plus required/optional skill lists, class/day targets, elapsed days |
| 3 | Grade to next rung: rung, clock today, classes 0, sign-offs cleared, history entry | Covered (partly) + New | `grading-actions.e2e`, `grading-attendance.e2e` (stripe award resets); New on every rung |
| 3 | Top rung: no next grade; can't grade to the rung held | Covered + New | `ranks.e2e` "promoting past the highest Rank"; New |
| 3 | Unreadable / empty date, class count missing / as text | N/A | `dateOfCurrentRank` and `classesAttendedTowardCheckpoint` are non-null typed columns (1,182 scenarios) |
| 3 | Student whose rank no longer exists ("data error") | N/A | Decision 180 item 3 (held rung can't be removed) + FK on `currentStripeId` |
| 4 Grade rules | Grade window opens on next rung; earlier rungs disabled | Covered (UI) | portal `student-grading.spec.ts`; API default differs, see Q3 |
| 4 | Same / earlier / unknown rung refused, nothing changes | Covered + New | `grading-actions.e2e` "grade only moves up…"; New 4a |
| 4 | Skip rungs + "Skipped N ranks in between" | Covered + New | `grading-actions.e2e`; New 4b |
| 4 | Starting classes | Covered + New | `grading-actions.e2e` (any-type, per-type, time-only); New 4b |
| 4 | Back-dating rules | Covered + New | `grading-actions.e2e`; New 4c |
| 4 | History runs in date order, newest first | **New — FAILS** | **D1** |
| 4 | Into the time-only tier: no starting classes | Covered + New | `grading-actions.e2e` "a time-only new rank takes no starting classes"; **D2** |
| 4 | Skills soft warning + ack; hard block incl. skip past; lifts when signed | Covered + New | `grading-actions.e2e`, `ranks.e2e`, portal `student-grading.spec.ts`; New 4e |
| 4 | Time-only: optional skills never block | Covered (unit) + New | engine spec; New 4e |
| 4 | Downgrade: down only, reason required (not blank), resets, dated today, nothing below first rung | Covered + New | `grading-actions.e2e`, `ranks.e2e`; New 4g |
| 4 | History note added/edited after the fact | **Not built** | **Q1** |
| 4 | Delete history entry | N/A → void | Decision 129; `ranks.e2e` void test; New 4h |
| 5 Panel | Skills listed for next grade, sign-off cycles, eligibility follows | Covered + New | `ranks.e2e` cycle; portal "signing off the last skill"; New 5a |
| 5 | Brown 4 → Black shows 10/26 (not /0) | Covered (unit) + New | engine "normal → time-only reads current rung"; New 5b + sweep |
| 5 | Log a class ×16 reaches target | Covered + New | `grading-board.e2e` (Decision 176); New 5b |
| 5 | Minimum days shown and enforced | Covered + New | `grading-attendance.e2e` "minimum days are a gate"; New 5c |
| 5 | "Just became eligible" notice | Covered | `grading-ready-notification.e2e` (Decision 178) |
| 5 | Active / inactive toggle | Covered | `grading-board.e2e`, portal `grading-board.spec.ts` |
| 6 Board | 600 students: every card in the right column, %, skills & "too early" warnings, sort | Covered (small) + New | `grading-board.e2e` (7 students); New 600 |
| 6 | Top rung not shown | Covered + New | `grading-board.e2e` |
| 6 | "N inactive hidden" count unchanged by search | **New — FAILS** | **D3** |
| 6 | Search (case-insensitive, no match), filter off | Covered + New | `grading-board.e2e` |
| 6 | Column collapse, focus kept while typing | N/A | Portal UI |
| 6 | Skills-required padlocks | Covered + New | `grading-board.e2e`, portal spec |
| 6 | Bulk promote: date stops whole batch (too early / nonsense / future), blocked skipped, one rung each, reset, note, report | Covered + New | `grading-bulk-promote.e2e`, portal spec; New 6d |
| 6 | Bulk promote silently promotes soft-flagged students | N/A (overridden) | Decision 130: "Needs a look" + one acknowledgement; New 6d checks the flags and "N days short" reasons |
| 6 | Calling order / printable report | Covered (portal) | portal `grading-board.spec.ts`; portal builds the report in calling order (`BulkPromoteModal.tsx:134`). API response order is ready-then-flagged (not a defect) |
| 6 | 300 drags: lands in column, logged once, rung unchanged; own column no-op; top/unknown no-op | Covered (small) + New | `grading-board.e2e`; New 6e (API answers 400 on own column / top / unknown — nothing changes, equivalent) |
| 6 | 3,000-student speed | Deferred | Phase 7 item 2 (stress round). 600-student board GET: 431 ms |
| 7 Events | All | N/A | Decisions 158, 163 (events are V2) |
| 8 Structure | Held rung can't be deleted; unused one can | Covered | `ladder-editor.e2e` (Decisions 152, 180) |
| 8 | Add / edit / duplicate rung; reorder | Covered | `ranks.e2e` PR2 block, `ladder-editor.e2e` |
| 8 | Stripe copy/paste across belts | N/A | Portal editor UI |
| 8 | Time-only switch on any rung; promotion INTO time-only uses the rung below | Covered + New | `ranks.e2e` "time-in-rank-only rung", engine spec, New sweep (all Brown·4 → Black scenarios) |
| 8 | Rename / duplicate style | Covered + New | `style-templates.e2e` duplicate; New 10 (rename) |
| 8 | Delete a style (guarded when it has students); delete a belt | **Not built** | **Q2** |
| 8 | Number-field input sanitising | N/A | Portal form; API validates with 400 (`ranks.e2e`) |
| 9 Skills/curriculum/settings | Create skill; newly attached skill gates the rung | Covered | `ranks.e2e` PR2, New sweep |
| 9 | Lessons: create, edit, link to skill, "Watch" on panel | Covered | `curriculum.e2e`, portal |
| 9 | Lesson categories with order; drag lessons; delete lesson | **Not built** | **Q2** (Decision 128 item 15) |
| 9 | "Skills required" switch per style | Covered | `grading-actions.e2e` |
| 9 | Fee / channels / permissions table | N/A / Covered | Fee: Decision 163; channels: Decisions 145/178; permissions: `grading-permission-toggles.e2e` (Decision 181) |
| 10 Hostile text | Stored exactly (style, belt, skill, history note, downgrade reason, search) | New | All pass; notes on length limits and trimming (O2) |
| 10 | Nothing injected / escaped twice on 31 screens | N/A | Portal rendering (React escapes); not an API concern |
| 11–13 Random | 3 × random actions incl. bogus ids: no 5xx, invariants hold, reads never NaN | New | 3 × 600 actions, 0 failures |
| e2e-clicks.py | 45 real-click steps | Covered (portal) | portal Playwright specs `student-grading`, `grading-board`, `ladder-editor`, `style-templates`; event steps N/A (Decision 158) |

**Counts (63 family rows):** **38 already covered** by existing tests (28 of them also re-run here on the real ladders, 10 left to existing tests), **6 newly checked here only** (2 of them fail: D1, D3), **16 N/A** (decision, interface or UI-only; includes the 3,000-student speed row, deferred to Phase 7 item 2), **3 not built** (Q1, Q2). The new checks: **107,834 checks, 4 failed**.

## Discrepancies

Each was re-verified against the API code and the decision log before classifying.

### D1 — Rank history is not in date order (API bug, surfaces in the portal)
- **Scenario:** Suite 4 "the history runs in date order, newest first" (`qa-harness.html` suiteGradeRules, history after back-dated grades).
- **Prototype:** newest first, always in date order.
- **API:** `GET /students/{id}/rank-history` returns `2026-10-05, 2026-10-05, 2026-10-08, 2026-09-30` — no date order at all. `cursorPaginate` orders by `id asc` (`apps/api/src/common/pagination/cursor-paginate.ts:34`), used by `GradingService.findRankHistoryForStudent` (`apps/api/src/ranks/grading.service.ts:129-133`); ids are random UUIDv4. The portal renders the list as returned (`apps/school-portal/src/grading/StudentGradingPage.tsx:158`, `useRankHistory` in `gradingQueries.ts:31`), so the student panel's history order is random.
- **Classification:** API bug (no decision changes the prototype's order; Decision 128 adopts the prototype's history; Decision 166 relies on history "always staying in date order").
- **Fix direction (not done):** order by `effectiveDate desc, createdAt desc` with a cursor that supports it, or sort client-side; add an e2e check.

### D2 — Starting classes typed when grading INTO a time-only rung: refused, not ignored
- **Scenario:** Suite 4 "classes are zero on a time-only rung even if Starting classes was typed" (Brown Belt · 4 Stripes → Black Belt, startingClasses 25).
- **Prototype:** accepts the grade and stores 0 classes.
- **API:** 400 "The new rank counts time only, so it starts with no classes (Decision 128, item 3)" (`grading.service.ts:546`). Graded without the field, the outcome is identical (0 classes).
- **Classification:** intended difference (Decision 174 item 1: "A time-only new rank takes none"; Decision 128 item 3). The portal hides the field, as the prototype's modal does. No action needed; recorded so nobody "fixes" it back.

### D3 — "N inactive hidden" count on the board changes with the search, and excludes top-rung students
- **Scenario:** Suite 6 "the inactive hidden count is not changed by searching".
- **Prototype:** `hiddenInactive` = every inactive student in the style (`prototype/index.html:1854`), independent of search. Gus fixed exactly this in the prototype on 7 Oct (`CHANGES.md` §3: "The board's 'N inactive hidden' count included students hidden by the search").
- **API:** `getGradingBoard` drops non-matching names (`grading.service.ts:843`) and top-rung students (`:845`) **before** counting inactive (`:849`): 71 with no search, 8 when searching "silva".
- **Classification:** API bug — it reintroduces a prototype bug Gus fixed (adopted rules, Decision 128). Whether top-rung inactive students should count is a smaller **question for Gus** (the prototype counts them; this run's random school had none, so only the search part failed).

### Questions for Gus (prototype behaviour with no API equivalent; not guessed)
- **Q1 — Editing a history note afterwards.** The prototype lets staff add or edit a user note on any existing history entry (`App.toggleHistoryNoteEditor`, `index.html:1792, 3185`). The API takes `note` only at grading time; there is no endpoint to change it later. Decision 128 item 11 says entries "carry a system note and a user note" but not whether it can be edited later (or whether that edit is itself audited, given Decision 129's audit stance). Build an edit endpoint, or is the note fixed once written?
- **Q2 — Deleting things.** The prototype can delete a style (refused while it has students), a belt/rank (refused while held), a lesson, and has ordered lesson categories with drag. The API has no DELETE for disciplines, belts, skills or lessons (rungs can be removed via `PATCH /ranks/{id}`, Decision 180), and `Lesson.category` is free text with no ordering, although Decision 128 item 15 adopted "lesson categories are a real list with ordering". Confirm these are planned (roadmap Phase 4 item 5) rather than dropped.
- **Q3 — API default target for promote/downgrade.** With no `targetRungId`, `promote` goes to the **next belt's first rung** (Blue · 2 → Purple, skipping 2 rungs and recording it), and `downgrade` to the **previous belt's first rung** (Purple · 2 → Blue) (`grading.service.ts:409`, V1 behaviour kept "as before"). The prototype's windows open on the next rung up / the rung just below. The portal always sends `targetRungId`, so users see prototype behaviour; only direct API callers (e.g. the future mobile coach app, Decision 184) would hit the old default. Should the default become "next rung" / "rung just below"?

### Observations (not discrepancies)
- **O1 — Bulk promote response order** is ready-then-flagged, not the calling order. The portal builds the printable report from its own calling order (`BulkPromoteModal.tsx:134`), so the report is correct.
- **O2 — Text limits and trimming.** Names longer than 100 (style, belt) or 150 (skill) characters are refused with 400; the prototype has no limit. Names are stored untrimmed ("  Padded Style  "); the prototype trims. Downgrade reasons/notes are stored exactly. Validation conventions, not grading rules.
- **O3 — Top-rung eligibility** returns `{hasNext:false, dataError:false}`; the harness expects only `hasNext`. The extra flag is how the API tells "top" from "data error"; equivalent.
- **O4 — Own-column drag** answers 400 "already in that column" instead of a silent no-op; nothing changes either way.

## Environment notes
- **E1 — Throttling.** `THROTTLE_IP_LIMIT_PER_MINUTE` only raises the `default` throttler; the `identity` throttler (1,000/min, IP-keyed by default; `app.module.ts:48`) and bulk promote's own 30/min (`grading.controller.ts:199`) still apply. The first run tripped them; the script now waits and retries on 429 (2,400 retries). A coach is very unlikely to reach 1,000 requests a minute, so this is test-environment friction, not a defect. A committed e2e version should not issue thousands of requests per minute (sample the sweep, or run it as a unit-plus-small-HTTP split).
- **E2 — Shared Redis.** The in-process BullMQ workers also consumed jobs enqueued by another agent's API (same Redis db 0, different Postgres DB): 440 `Notification_userId_fkey` errors for user ids that don't exist in `ultm8_haccept` (checked). Email errors are the missing `NOTIFICATIONS_FROM_EMAIL`. Neither affects these checks (notifications aren't asserted here). Use a separate Redis db or `prefix` per test run.
- Test data is left in `ultm8_haccept` under Schools named "Grading Acceptance …" (dedicated DB).

## Turning this into a committed e2e spec
- The setup and helpers map onto `apps/api/test/*.e2e-spec.ts` directly (`Test.createTestingModule(AppModule)`, superuser seeding, `JwtService` tokens; replace `fetch` with `supertest`).
- Suite 3 at full size is 13.7 min, mostly throttling and per-request cost. Suggested split: keep the full 404-rung sweep at engine level on the real template ladders (`buildIbjjfTemplate` flattened), and over HTTP run one or two scenarios per rung (≈ 800 requests).
- Suites 4, 5, 6, 10 and one random seed run in about 1 minute together and can be committed nearly as they are. Add D1 and D3 as regression checks once fixed.
