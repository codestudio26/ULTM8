# Grading System — Handover Notes

Owner: Gus (Unision HQ)
Package assembled: 7 October 2026
Source: four published artifacts dated 22–26 August 2026, recovered, then stress tested, fixed and cleaned up on 7 October 2026.

Everything stated as fact below was checked against the code in this package, or by running it, on 7 October 2026. Where something is an inference, it says so.

---

## 1. What this is, in one paragraph

A grading (belt promotion) system for martial arts schools. A school owner builds a rank ladder for each style they teach, sets what a student needs for each rank (classes attended, time in rank, skills signed off), sees every student's progress on a board, and promotes students one at a time, in a batch, or at a grading event, with a full history. It ships with a complete IBJJF Brazilian Jiu-Jitsu ladder (kids and adults, 90 ranks) plus two kids-stripe variants.

**It is a clickable prototype, not a product.** One HTML file, no server, no database, no login, no saved data. Reload the page and every change is gone. Its job is to settle the rules and the screens. The next job is to build it for real.

## 2. State of the prototype

- **`prototype/index.html` is the fixed build.** It is not the build published on 24 August. `CHANGES.md` lists every difference. The published build is kept in `prototype/original-as-published-2026-08-24.html`.
- **The stress test passes: 105,303 checks, 0 failed.** Section 7 says what it covers and what it does not.
- **No known bugs remain in what is built.** What remains is listed in section 8: two requirements that cannot be enforced without attendance data, features that are only mocked on screen, and things that were never built.
- **The live published artifact is still the old build.** Only the file in this package is fixed.

## 3. Where it fits (please confirm with Gus)

The prototype is branded "DojoHQ". The spec tracker in `docs/` shows that Grading is one module of Gus's club-management product **ULTM8** (School Portal + Student Mobile App), next to Classes, Membership, Attendance and Payments. My reading is that "DojoHQ" was a working name used in the prototype and that this grading system is the ULTM8 grading module. **This is an inference. Ask Gus before you rename anything.**

The tracker also records platform decisions already made for ULTM8. If this module is built inside ULTM8, these apply to it:

| Area | Decision recorded in the tracker |
|---|---|
| Backend | NestJS modules, Prisma ORM |
| Hosting | AWS (RDS, ElastiCache, ECS Fargate), GitHub Actions CI/CD |
| Storage | Cloudflare R2 + Cloudflare Images |
| Notifications | FCM/APNs push, Twilio Verify, Postmark email (AWS SES as fallback) |
| Payments | Stripe; GoCardless excluded |
| i18n | i18next, with RTL support for the mobile app |
| Tenancy | Multi-tenant with row-level security; Franchise, School and Branch levels |

**The full ULTM8 Technical Specification is not in this package.** Only its tracker page is. The spec has a Grading data model (Section 6.1) and a note on this prototype's role in the build (Section 2.3). Get the spec from Gus before designing the database. Where the spec and this prototype disagree, do not pick one yourself. Ask.

One item the tracker lists as still open is directly about this module: *"StudentRank readiness-bucket thresholds / progress-% formula — a product call flagged rather than invented."* The prototype uses 33% and 66% (see 6.6). Those numbers are placeholders until Gus confirms them.

## 4. What is in the package

| Path | What it is |
|---|---|
| `START-HERE.md` | One page: reading order and the five things to know. |
| `HANDOVER.md` | This file. |
| `CHANGES.md` | Everything changed on 7 October: decisions, fixes, clean-up. |
| `TAKEOVER-PROMPT.md` | A ready-to-paste first message for the Claude team taking over. |
| `prototype/index.html` | **The prototype. Source of truth for behaviour.** Open it in a browser. |
| `prototype/original-as-published-2026-08-24.html` | The build as it was published. Reference only. |
| `qa/qa-harness.html` | The stress test. Open it and press Run. |
| `qa/archive/` | The original August test harness and the older build it tested. Reference only. |
| `tools/run-harness.py` | Runs the stress test from the command line, with options for seed, time zone and date. |
| `tools/e2e-clicks.py` | Drives the prototype with real mouse clicks, typing and drag-and-drop. 45 steps. |
| `tools/rebuild-harness.py` | Puts a changed prototype into the stress test. |
| `design/grading-system-mockup.html` | The first design canvas (22 Aug). Five screens. Design intent. |
| `design/screens/` | Source of those five screens. They do not open on their own. |
| `docs/curriculum-video-infrastructure.html` (+ `.txt`) | Memo: how to host and charge for curriculum video. A proposal, not built. |
| `docs/ultm8-spec-tracker.html` | Review status of the ULTM8 spec. Context only. |
| `screenshots/` | Fifteen images, one per screen or window, taken from the fixed build. Fonts fell back to system fonts in the capture. |

**Not in the package, and not recoverable from here:** the original chat conversations, the ULTM8 spec document, and the Figma file. Decisions that lived only in conversation are lost unless they made it into the code comments. The code comments are detailed, so most did. Read them.

## 5. How to run it, and how it is built

1. Open `prototype/index.html` in a browser. No install, no server. It asks Google Fonts for two fonts and works without them.
2. To run the tests, open `qa/qa-harness.html` and press **Run full stress test**. It takes five to eight minutes. Expect `105303 checks, 0 failed`.
3. From a terminal: `python3 tools/run-harness.py qa/qa-harness.html` and `python3 tools/e2e-clicks.py prototype/index.html`.
4. After any change to the prototype: `python3 tools/rebuild-harness.py prototype/index.html qa/qa-harness.html qa/qa-harness.html`, then run both again.

Plain JavaScript, no framework, no build step. About 3,400 lines.

- **`DB`** (line 141) holds all data in memory. **`UI`** (line 202) holds all screen state.
- **`render()`** (line 818) rebuilds the whole page as an HTML string. Every action ends by calling it.
- **`App`** (line 2448) is one object with 122 actions, called from inline `onclick` handlers.
- **The rules are in one block, lines 316–541:** dates, then `gradingRequirement`, `computeEligibility`, `applyRankChange`, and the board's progress helpers. Nothing else decides who is ready to grade.
- Section banners: DATA 83 · HELPERS 290 · DATES 316 · GRADING RULES 387 · board progress 497 · BELT SWATCH 543 · SHELL 751 · RANKS PAGE 920 · SKILLS 1416 · CURRICULUM 1478 · CURRICULUM SETUP 1563 · STUDENT PANEL 1668 · GRADING BOARD 1815 · EVENTS 2260 · SETTINGS 2387 · ACTIONS 2447.

This architecture is fine for a prototype and wrong for production. Do not port it. Port the **rules** (section 6) and the **screens**.

### Screens

| Sidebar item | What works |
|---|---|
| Styles & Ranks | Create a style from a template, from scratch, or by duplicating. Rename, delete. Rank ladder with drag to reorder, add, edit, duplicate, delete. Rank editor: colours, stripe tiers, requirements, "time in rank only", class scope, skills. Copy/paste stripes across belts. |
| Skill Library | List, filter by style, add a skill, see which ranks use it and which lessons teach it. |
| Curriculum | Lesson cards grouped by category; lesson window. Manage page: add, edit, delete, drag to sort and re-categorise, add category. **No real video** — thumbnails are placeholders. |
| Grading Board | Three columns by progress. Search, "currently attending only", tick cards, bulk promote with a calling order, printable report, drag between columns. Click a card for the student. |
| Student panel | Current belt, progress rows, the skills for the next grade, rank history with notes, Grade, Downgrade, "Log a class". |
| Grading Events | Schedule (name, date, venue), add and remove participants, Pass or Fail, complete. |
| Settings | Fee switch, "skills required" per style, notification channels, instructor permissions per style. **Only "skills required" changes behaviour.** |
| Dashboard, Attendance | Disabled placeholders. They belong to other modules. |

### Data shapes

```
Style    { id, name, classTypes: [string], ranks: [Rank], skillsRequired?: bool }
Rank     { id, name, order (1..N), color, secondaryColor|null,
           tagColor|null, coralAccent|null,          // drawing only
           stripeTiers: [{count, color}],
           timeOnly: bool,                           // graded on time in rank alone
           classCount, minDays, weeklyCap, scope: [classType], skills: [skillId] }
Skill    { id, name, description, styleId }
Student  { id, name, styleId, rankId, since, memberSince, classesAttended,
           skillStatus: {skillId: "not_started"|"learning"|"signed"},
           active: bool, history: [HistoryEntry] }
HistoryEntry { id, rankId, rankName, type: "promotion"|"downgrade"|"adjustment",
               date, by, note, notes }
Event    { id, title, date, venue, styleId, status: "scheduled"|"completed",
           participants: [{id, name, result: null|"pass"|"fail", outcome?}] }
Category { id, name, styleId }
Lesson   { id, categoryId, order, title, duration, instructor, text, skillIds: [skillId] }
Settings { feeOn, channels: {inapp,email,push,sms},
           instructors: [{id, name, perm: {styleId: bool}}] }
```

Things to know before you turn these into tables:

- A student has **one** style and **one** rank. Real students train in more than one style. Expect a join table (the tracker calls it `StudentRank`).
- `history.note` is written by the system ("Skipped 2 ranks in between."). `history.notes` is typed by the user. Two different fields with nearly the same name.
- Dates are display strings such as `"14 Jan 2026"`. They are validated on the way in, but use real dates in a database.
- `classesAttended` is a single counter that resets to zero on every promotion. There are no attendance records behind it.
- `skillStatus` is one flat map per student and is wiped on every rank change.
- A skill belongs to one style. The first mockup said skills could be shared across styles.
- "Who did this" is always the constant `CURRENT_USER`. There is no login.

## 6. The rules (this is the valuable part)

These are the decisions the prototype encodes. Each one names the function that implements it. All of them are exercised by the stress test.

### 6.1 The ladder

- A style is an ordered list of ranks. **Every stripe is its own rank.** White Belt, White Belt · 1 Stripe … White Belt · 4 Stripes are five separate ranks. This was a deliberate choice over "one rank with a stripe counter".
- The default IBJJF ladder has 90 ranks: 16 colour belts × 5 rungs (13 kids belts from White to Green/Black, then Blue, Purple, Brown), then Black Belt with 0–6 stripes, then Red/Black (7th degree), Red/White (8th), Red (9th).
- Two variants add kids' coloured stripes: **White & Red Stripes** (139 ranks) and **Yellow Stripes** (175 ranks). Red stripes replace white ones one position at a time; yellow then replaces red. White Belt takes only one red stripe. A kids belt promotes at 3 yellow + 1 red. The code comments say these were confirmed against reference photos. (`buildIbjjfLadder`, line 1118.)
- Once a style is created from a template it is independent. Editing it never changes the template or other styles.
- A rank that students currently hold cannot be deleted. A style that has students cannot be deleted.

### 6.2 Two kinds of rank

`rank.timeOnly` decides which applies. It is a switch in the rank editor, available for any rank in any style.

**A normal rank — classes, days and skills.**

- Eligible = enough classes **and** enough days in rank **and** every required skill signed off.

**A "time in rank only" rank — time alone.** On for Black Belt and above in the IBJJF templates.

- Eligible = days since promotion ≥ the rank's `minDays`.
- Years per rank, from the IBJJF figures: 3, 3, 3, 5, 5, 5, 7, 7, 10. Red Belt is the top.
- Classes are not counted. Skills attached to the next rank are shown but optional, and can never block.

### 6.3 Where the numbers are read from

`gradingRequirement` (line 425). This is the one subtle rule. Get it exactly right.

| The student is at… | …and the next rank is… | Requirement comes from |
|---|---|---|
| a normal rank | a normal rank | the **next** rank. A rank's classes, days and skills mean "what it takes to be promoted **into** this rank". |
| a normal rank | a time-only rank (Brown Belt · 4 Stripes → Black Belt) | the **current** rank, because a time-only rank carries no class or skill numbers. |
| a time-only rank | anything | the **current** rank's `minDays`: the time that must be spent **at** this rank. |

So normal ranks read forward and time-only ranks read their own number. Make this explicit in the real data model rather than leaving it to one function.

### 6.4 Grading a student

`GradeModal` (line 2119), `App.confirmGrade` (line 3249), `applyRankChange` (line 486)

- **Grade moves a student up.** To the next rank, or to any later rank. Skipping ranks is allowed and is recorded ("Skipped 2 ranks in between."). The current rank and earlier ranks cannot be picked.
- Eligibility never promotes anyone. The system only says who is ready. **A person always grades**, and may grade a student who is not yet eligible.
- If required skills are not all signed off, one of two things happens, set per style in Settings:
  - **Off (default):** a warning lists the missing skills, with a "Watch" link to the lesson for each. The grader must tick an acknowledgement to continue.
  - **On:** grading is blocked. No override. On the board, the student's tick box becomes a padlock.
- The grading date can be back-dated. It cannot be in the future, and cannot be earlier than the day the student reached their current rank.
- On any rank change: the rank changes, the time-in-rank clock restarts on the grading date, classes reset to zero (or to a "starting classes" number the grader types), skill sign-offs are cleared, and a history entry is written.

### 6.5 Downgrading

`DowngradeModal` (line 2194), `App.confirmDowngrade` (line 3277)

- **Downgrade moves a student down**, to any earlier rank.
- A written reason is required. It is stored on the history and shown in red.
- Same resets as a promotion. Always dated today.

### 6.6 The Grading Board

`computeProgress` (line 502), `progressBand` (line 519)

- Progress % = classes attended ÷ classes required (normal rank), or days in rank ÷ days required (time-only rank). Capped at 100.
- **Skills and minimum days are deliberately not part of the percentage.** A missing skill shows as a warning triangle on the card. Days not yet served shows as a clock.
- Columns: Just Starting (0–32%), Getting There (33–65%), Ready to Grade (66%+). **These thresholds are the open item in the ULTM8 spec.**
- Students at the top rank are not shown.
- **Bulk promote** moves every ticked student **one rank up**. The grader sets the calling order by dragging, sets one date and one optional note, and can open a printable report afterwards. A student blocked by "skills required" cannot be ticked.
- **Dragging a card to another column** is a manual override. It rewrites the class count (or the promotion date) so the student lands in that column, and records an ADJUSTMENT on their history (`App.dropOnBand`, line 2583).

### 6.7 Grading events

`App.completeEvent` (line 3371)

- An event belongs to one style. It is pre-filled with that style's active students who are eligible right now. Anyone else in the style can be added by hand.
- Each participant gets Pass, Fail, or nothing.
- Completing the event promotes every Pass by **one** rank, dated the day of the event (or today, if the event's date is still in the future or is earlier than the student's current rank date), with "Passed at <event>." on their history.
- A Pass who cannot be promoted is left alone and the reason is kept on the event.
- A completed event is read-only and cannot be completed twice.

### 6.8 History

- Every promotion, downgrade and manual adjustment is logged with date, who did it, the rank's name at the time, and a note.
- Entries can have a user note added, and can be deleted (with a confirmation). Deleting an entry does not change the student's rank.

### 6.9 Curriculum

- A lesson links to one or more skills. That link is the whole design: a video appears wherever its skill appears (Skill Library, the student's skills, the Grade warning), so a student watches it because their next grade needs it.
- See `docs/curriculum-video-infrastructure` for the hosting and pricing proposal.

## 7. Testing

### What was run

| Test | Result |
|---|---|
| Stress test, `qa/qa-harness.html` | **105,303 checks, 0 failed** |
| The same test under 9 other dates and time zones | 0 failed in each |
| Nine more random runs with other seeds, 3,000 actions each | 0 failed |
| Real mouse and keyboard, `tools/e2e-clicks.py` | 45 steps, 0 failed |
| The same stress test against the **original** build | 2,099 failed |
| 16 deliberate faults put into the fixed build, one at a time | all 16 detected |

The last two rows are there to show the test has teeth. A test that passes on broken code proves nothing.

### What the stress test covers

Expected answers come from rules written out separately inside the test file (`refReq`, `refEligible`, `refPct`), not from the prototype's own functions.

1. **Dates.** Reading, rejecting and counting days, including every day of a leap year.
2. **Ladders.** All nine templates: rank counts, order, unique names, stripe sequences, years per degree, every belt drawn at every size.
3. **Eligibility and grading.** Every one of the 515 ranks across 10 styles, with 11 to 18 crafted students each: on the threshold, one class short, one day short, promoted today, unreadable date, future date, missing fields, skills partly signed. For each: eligibility, progress %, skills warning, then a real grade and the state it leaves.
4. **Grade and Downgrade rules.** Up only, down only, skipping, dates, starting classes, soft warning, hard block, time-only ranks, a student whose rank is gone, history notes and deletion.
5. **Student panel.** The right skills on all 90 ranks, sign-off by clicking, logging classes, days in rank, active and inactive.
6. **Grading Board.** 600 random students: every card in the right column with the right % and warnings, search, filters, select-all, bulk promote end to end, 300 drags. Then 3,000 students for speed.
7. **Grading events.** The form, pre-fill, add and remove, results, completion, the three "held" cases, read-only afterwards, date handling.
8. **Styles and ranks.** Add, edit, duplicate, reorder, delete guards, stripe copy and paste, the time-only switch, rename, create from scratch, no styles at all.
9. **Skills, curriculum and settings.**
10. **Hostile text.** Twelve awkward strings (HTML, script injection, quotes, `&`, accents and emoji, 600 characters) typed into every field, then all 31 screens and windows drawn. Nothing injected, nothing escaped twice, every control still works.
11. **Random actions.** Three runs of 3,000 random actions each, including calls with ids that do not exist. After every action the data must still be consistent; every tenth action the screen must not show "undefined", "NaN" or "null".

### What it does not cover

- **Only Chromium was used.** Safari and Firefox were not tested.
- **Desktop width only.** The layout is a fixed sidebar and three columns. Phone and tablet widths were not tested and are not designed.
- **Keyboard-only use and screen readers** were not tested. Several controls (the board tick boxes, for example) are not reachable by keyboard.
- **Dark mode** was not checked screen by screen.
- **The printable report** is checked for content, not for how it prints.
- The mocked features (section 8) have nothing behind them to test.

## 8. What is left

### Stored and shown, but not enforced

| Item | Why |
|---|---|
| **Weekly cap** ("max classes per week that count") | Needs dated attendance records. The prototype only has a class counter. |
| **Which classes count** (class scope per rank) | Same reason. |

### Shown on screen but not real

- **Notifications.** "Owner notified" is a message on screen. Nothing is sent. The channel switches do nothing.
- **Grading fee.** A switch with no amount and no charge.
- **Instructor permissions.** Stored per style, never checked. Every action is recorded as `CURRENT_USER`.
- **Video.** No upload, no player.
- **Saving.** None. No save, no load, no export.

### Not built at all

Adding or editing a student · editing or deleting a skill · renaming or deleting a category · editing a style's class types · editing an event after it is created · attendance records · a student-facing view · login, roles and tenancy · the "template updates" feature from the mockup.

### In the first mockup but not in the prototype

`design/grading-system-mockup.html` is the earlier design (22 Aug). It shows ideas that did not make it into the prototype. They are design intent, not agreed scope:

- A fee amount on the event form ($35.00 per participating student, added to their account).
- A "style and rank tier" on the event, and a participant picker with eligible students pre-ticked.
- After a failed grading: an extended window (45 days) and a new class target (20), with progress kept.
- Uploading a demo photo or video on a skill.
- Attendance split by class type on the student panel (Fundamentals 68, Advanced 36).
- The student panel as one tab among Profile, Attendance, Billing, Grading and Notes.
- "Template updates" in Settings: the school is told when a template it started from improves, and can apply or revert the update.
- Skills shared across styles ("reused skills stay in sync everywhere they're linked").

To view it, open the file and wait a few seconds; use the zoom control or the play button above a screen.

### For whoever writes the production code

- Every screen is an HTML string with inline `onclick` handlers. All text is escaped where it is written to the page, and that is tested, but the pattern itself should not be carried over.
- Duplicate rank names and duplicate style names are allowed. Pickers then show two rows that look the same.
- The seed data uses fixed calendar dates, so the demo students drift as time passes (a student at 96% in October is at 100% a few weeks later).

## 9. Decisions

### Decided by Gus on 7 October 2026

Do not reopen these without asking him. Details are in `CHANGES.md`.

- Minimum days in rank is enforced for normal ranks.
- Dragging a card on the board is kept, and logged on the student's history.
- Completing an event promotes each Pass by one rank.
- "Time in rank only" is a switch on any rank in any style.
- A grading date cannot be in the future, or earlier than the day the student reached their current rank.
- A rank that students hold, or a style that has students, cannot be deleted.
- Duplicating a style also copies its skills.

### Waiting for Gus to confirm

One rule was added while fixing bugs and has not had an explicit yes:

- **Grade can only move a student up, and Downgrade only down.** The August build let Grade move a student to an earlier rank with no reason given.

### Still open

In the order they block work. None of these can be answered from the files.

1. **Is this the ULTM8 grading module, and should "DojoHQ" be renamed?**
2. **Where the ULTM8 spec and this prototype differ, which wins?** (Needs the spec.)
3. **Board thresholds and progress formula.** Keep 33% / 66%? Should skills or minimum days count toward the percentage?
4. **Weekly cap and class scope.** These need the Attendance module. Is grading built before or after Attendance?
5. **Bulk promote and events skip the soft checks.** Grading one student with skills missing needs an acknowledgement. Promoting the same student in a batch, or passing them at an event, does not. Neither warns when the minimum days have not been served. Should they?
6. **Correcting a rank date.** Because of the date rule, a student whose current rank date was entered wrong cannot be given an earlier, correct date at their next grading. Gus's direction: keep the rule and add an "edit rank date" action that leaves a note on the history. Not built.
7. **Moving students when a rank is removed.** Deleting a rank that students hold is blocked. A friendlier version would ask which rank to move them to. Not built.
8. **Grading events.** What are the real rules after a fail (the mockup's 45 days and 20 classes)? Is the fee per event or per student, and is it charged through Stripe? Can a pass promote more than one rank?
9. **Who can grade.** The mockup says "Owners can always grade everything" and instructors are granted rights per style. Confirm, and say whether a downgrade or a manual board adjustment needs a higher permission than a promotion.
10. **Can history entries really be deleted?** For an audit trail, "void with a reason" is safer than delete.
11. **Skill sign-offs on promotion.** Currently wiped. Should a skill signed at Blue still count at Purple?
12. **Promotion into a time-only rank** uses the rank below's requirement. That fits IBJJF, where every rung of a belt shares the same numbers. Is it right for other styles?
13. **Curriculum video.** Accept the Cloudflare Stream recommendation? Flat add-on or per-student pricing?
14. **Other templates.** Are the Karate, Taekwondo, Judo, Muay Thai, Kids BJJ and MMA ladders real proposals or placeholders? Their numbers look illustrative.

## 10. Suggested order of work

1. Read this file and `CHANGES.md`, then open the prototype and click through every screen with the screenshots beside you.
2. Run the stress test and the click-through. Confirm the results in section 7.
3. Get the ULTM8 spec from Gus and compare its Grading entities with section 5 here. Write down every difference.
4. Take section 9 to Gus. Get answers in writing.
5. Lift the rules block (lines 316–541) into a module with no screen code, with the stress test's scenarios as its unit tests. This module is what carries over to production.
6. Design the database from the agreed model. Then build the screens against it.

Do not start step 6 before step 4 is done.
