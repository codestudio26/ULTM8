# Grading & coaching decisions — conformance review (Phase 7, item 4)

> **Snapshot of 10 Oct 2026, against `master` @ `0362ddd`.** The findings below were fixed or decided afterwards; see [README.md](README.md) for where each one went. Line numbers refer to that commit.

`master` @ `0362ddd` (clean tree). Read-only review, 10 Oct 2026.

**Sources checked:** `docs/decisions/POST-SPEC-55-DECISION-LOG.md` Decisions 124–184 and the earlier grading-relevant 75, 87, 88, 90, 93, 101, 104, 108; `skills/ultm8-domain-rules/SKILL.md` §5/§5A/§9/§11/§12; `docs/grading-integration/GRADING-MERGE-QUESTIONS.md` and `GRADING-INTEGRATION-ROADMAP.md` §10–§12; `CHANGELOG.md` → Unreleased.

**Method:** I read the code, not the comments. Each rule was traced to the service, engine, migration or portal file that enforces it, and to a test that asserts it. "Tested" means a test asserts the behaviour itself, not just that the code path runs. Unless a path says otherwise, it is relative to `apps/api/`. Portal paths start with `school-portal/`.

**Statuses:** IMPLEMENTED+TESTED · IMPLEMENTED-UNTESTED · PARTIAL · NOT BUILT · CONTRADICTED. Three more labels are not counted as gaps: **DEFERRED** (the decision or a later one says "later / V2 / Track B"), **SUPERSEDED** (a later decision replaces the rule, and I checked the code follows the later one) and **N/A** (a process or meta decision, or a "no rule" decision that has nothing to build).

Test-file shorthand: `e2e:<file>` = `apps/api/test/<file>.e2e-spec.ts`; `eng` = `apps/api/src/ranks/engine/grading-engine.spec.ts`; `pw:<file>` = `apps/school-portal/e2e/<file>.spec.ts`.

---

## Summary

| Status | Rule rows |
|---|---|
| IMPLEMENTED+TESTED | 122 |
| IMPLEMENTED-UNTESTED | 16 |
| PARTIAL | 5 |
| NOT BUILT | 5 (2 of them are Track B app items scheduled for the app's next release) |
| CONTRADICTED | 1 |
| DEFERRED (not a gap) | 14 |
| SUPERSEDED (not a gap) | 6 |
| N/A (not a gap) | 8 |
| **Total** | **177** |

---

## Conformance table

### Earlier decisions that grading depends on

| Dec | Rule | Implementation | Test | Status |
|---|---|---|---|---|
| 75 | Board thresholds are School-configurable per discipline | `prisma/schema.prisma` Discipline `boardGettingThere/boardReadyToGrade`; `src/ranks/grading.service.ts:938-962` | e2e:grading-board-thresholds:119,125,135; pw:board-thresholds:23 | IMPLEMENTED+TESTED |
| 75 | The progress-% *formula* is School-configurable | Decision 136 fixes the formula as the prototype's (`engine/eligibility.ts:53-126`) | — | SUPERSEDED (by 136; see inter-decision conflicts) |
| 87 | `ranksToggle` blocks catalog writes (403) | `src/ranks/ranks.service.ts:627-634`, called by every catalog write | e2e:ranks:191 | IMPLEMENTED+TESTED |
| 87 | `ranksToggle` blocks promote/downgrade/stripe-award/sign-off/declare | `grading.service.ts:285-288` (`assertSchoolAcceptsGradingWrites`) | e2e:ranks:518, 1935 | IMPLEMENTED+TESTED |
| 87 | `ranksToggle` blocks the newer grading writes (board-move, log-class, board-active, bulk, thresholds, void, edit-date, verify) | Same helper at `grading.service.ts:624, 897, 955, 1148, 1180, 1371` | No toggle-off test for these | IMPLEMENTED-UNTESTED |
| 87 | Reads are not gated by the toggle | Read paths do not call the gate (`grading.service.ts:79-136`) | e2e:ranks:191, 518 | IMPLEMENTED+TESTED |
| 88 | StudentRank, SkillStatus and PromotionEvent RLS is narrow (owner/manager or self) | `prisma/migrations/20260914000000_ranks_module/migration.sql:241-251` | e2e:ranks:475, 486 | IMPLEMENTED+TESTED |
| 88 | Staff read through the target student's context, with no RLS widening | `grading.service.ts:79-93, 166-193` | e2e:ranks:454 | IMPLEMENTED+TESTED |
| 88 | Catalog (Discipline/Rank) stays broadly readable | ranks_module migration | e2e:ranks:491 | IMPLEMENTED+TESTED |
| 90 | Booking gate matches `Class.activities` to `Discipline.name` | Replaced by `src/ranks/booking-unlocks.ts:15-36` (173) and `grading-attendance.ts:77-121` (170/171); no `activities` match remains in `bookings/` or `attendance/` | e2e:grading-attendance:284 ("free-text bridge is gone") | SUPERSEDED (by 170/173) |
| 93 | Scan is handled synchronously | `src/attendance/attendance.service.ts:222-227` | e2e:attendance:172 | IMPLEMENTED+TESTED |
| 93 | Only an explicit WITHDRAWN camera consent blocks; no ConsentRecord means not applicable | `attendance.service.ts:174-185` | e2e:attendance:172, 272, 343 | IMPLEMENTED+TESTED |
| 93 | StudentRank increment uses the Decision 90 bridge | Now the engine (`grading-attendance.ts:77-121`) | e2e:grading-attendance:203-297 | SUPERSEDED (Phase 2b, 170/171) |
| 101 | Cloudflare Stream + AWS Transcribe | Vendor choice only; the decision says nothing is provisioned | — | DEFERRED (by the decision itself) |
| 104 | Lessons are School-scoped and Staff/Instructor-authored on ordinary tenant routes | `src/curriculum/curriculum.service.ts:41-49, 112-114` | e2e:curriculum:145, 175, 195 | IMPLEMENTED+TESTED |
| 104 | Any role holder at the School may read lessons | RLS `lesson_tenant_isolation` (`20261001000000_curriculum_module/migration.sql:67-75`) | e2e:curriculum:234, 242 | IMPLEMENTED+TESTED (but 154 narrows this; see 154) |
| 108 | V1: an Instructor sets their **own** rank with a belt **dropdown** on their own profile settings page; not staff-entered | Built the other way: staff edit free text. `school-portal/src/instructors/InstructorFormModal.tsx:132` (TextField on the owner's Instructors page); `src/instructors/instructors.service.ts:68,188` take `beltRanking` from the staff create/update DTOs; there is no Instructor self-profile page | — | **CONTRADICTED** (low severity, V1-era; the decision also left the option set open) |
| 108 | V2: link instructor rank to grading | — | — | DEFERRED |

### 124–135

| Dec | Rule | Implementation | Test | Status |
|---|---|---|---|---|
| 124 | Gus's prototype overrides Spec 55 for grading, one logged decision per conflict | CLAUDE.md carries the exception | — | N/A (meta) |
| 125 | Gus approves grading decisions | — | — | N/A (meta) |
| 126 | Storage stays Rank + RankStripeTier; every (belt, tier) is a rung | `src/ranks/engine/ladder.ts:64-87` | eng:198 | IMPLEMENTED+TESTED |
| 126 | Every rung carries name, segments, classes, days, scope, weekly cap, timeOnly and skills | schema RankStripeTier; `ranks.service.ts:660-730` | e2e:ranks:820, 872, 916 | IMPLEMENTED+TESTED |
| 126 | Belt drawing fields `tagColour` and `coralAccent` | `ranks.service.ts:250-251` | e2e:ranks:820 | IMPLEMENTED+TESTED |
| 126 | A translation layer flattens belt + tiers into the prototype's ladder | `engine/ladder.ts`, `grading-attendance.ts:22-47` (`loadLadder`) | eng:195-235 (prototype reference sweep) | IMPLEMENTED+TESTED |
| 127 | Requirement source table (normal→normal: next; normal→time-only: current; time-only: current days, next skills optional) | `engine/requirement.ts:44-84` | eng:240, 247, 256; e2e:grading-attendance:328, 386 | IMPLEMENTED+TESTED |
| 127 | The grading skills check uses the next rung's skills | `grading.service.ts:421-429` | e2e:grading-actions:172, 188 | IMPLEMENTED+TESTED |
| 127 | Sign-off is limited to the next rung's skills (required or optional) | `grading.service.ts:1071-1079` | e2e:grading-actions:188 | IMPLEMENTED+TESTED |
| 128.1 | Rung names typed per rung | `ranks.service.ts:714-724` | e2e:ranks:820, 872, 1007 | IMPLEMENTED+TESTED |
| 128.2 | Mixed stripe colours on one rung | `ranks.service.ts:675-689` | e2e:ranks:820, 950, 1065 | IMPLEMENTED+TESTED |
| 128.3 | "Time in rank only" on any rung: days only, no classes, skills optional | `engine/requirement.ts:51-63`; `grading-attendance.ts:101` | e2e:ranks:872; e2e:grading-attendance:291, 386; eng:256 | IMPLEMENTED+TESTED |
| 128.4 | Weekly cap per rung | `engine/class-count.ts:33-51` | e2e:grading-attendance:220 | IMPLEMENTED+TESTED |
| 128.5 | Board columns Just Starting / Getting There / Ready to Grade | `engine/eligibility.ts:128-142`; `school-portal/src/grading/GradingBoardPage.tsx` | eng:397-412; pw:grading-board:30 | IMPLEMENTED+TESTED |
| 128.6 | "Log a class" is a staff action | `grading.service.ts:1007-1037` | e2e:grading-board:233; pw:grading-board:144 | IMPLEMENTED+TESTED |
| 128.7 | A grade may skip rungs; "Skipped N ranks in between" is recorded | `grading.service.ts:493, 511-512` | e2e:grading-actions:149 | IMPLEMENTED+TESTED |
| 128.8 | Back-dated grading date: not in the future, not before the current rank date | `engine/grading-date.ts:11-19`; `grading.service.ts:444-456` | eng:414-422; e2e:grading-actions:199 | IMPLEMENTED+TESTED |
| 128.9 | "Starting classes" can be entered when grading | `grading.service.ts:537-569` | e2e:grading-actions:228, 237, 253 | IMPLEMENTED+TESTED |
| 128.10 | Per-style "skills required" switch: off = acknowledge, on = blocked with no override | `grading.service.ts:430-442` | e2e:grading-actions:172; pw:student-grading:50, 71 | IMPLEMENTED+TESTED |
| 128.11 | Downgrade needs a written reason; entries carry a system note and a user note | `dto/grading-action.dto.ts:63-70`; `grading.service.ts:508-512` | e2e:grading-actions:164; e2e:ranks:1323; pw:student-grading:81 | IMPLEMENTED+TESTED |
| 128.12 | Grade only moves up; Downgrade only moves down | `grading.service.ts:392-400` | e2e:grading-actions:157 | IMPLEMENTED+TESTED |
| 128.13 | Board drag rewrites the class count (or the rank date on a time-only rung) and writes an ADJUSTMENT | `grading.service.ts:968-1001`; `engine/board.ts:32-45` | e2e:grading-board:209, 225; eng:478-515; pw:grading-board:52, 65 | IMPLEMENTED+TESTED |
| 128.14 | Grading events: Pass promotes one rung; Fail keeps progress; read-only once completed | No GradingEvent model (checked schema) | — | DEFERRED (158: Version 2) |
| 128.15 | **Lesson categories are a real list with ordering; lessons are ordered within a category** | `prisma/schema.prisma:2019` `Lesson.category String?` (free text); no LessonCategory model, no order field | — | **NOT BUILT** |
| 128.16 | Skill sign-offs are wiped on every rank change | `grading.service.ts:486, 1421` | e2e:ranks:1289 | IMPLEMENTED+TESTED |
| 129 | Void with a reason: hidden from the normal view, kept with who/when/why, rank unchanged, only staff see voided entries | `grading.service.ts:117-136, 1131-1166` | e2e:ranks:1333; pw:student-grading:81 | IMPLEMENTED+TESTED |
| 130 | Bulk promote applies the same checks per student (skills, days short) | `grading.service.ts:642-671` | e2e:grading-bulk-promote:145 | IMPLEMENTED+TESTED |
| 130 | Students with nothing missing need no extra step; "Needs a look" lists the flagged ones with reasons | `grading.service.ts:658-671, 685-687` | e2e:grading-bulk-promote:145; pw:grading-board:74 | IMPLEMENTED+TESTED |
| 130 | One tick "I acknowledge these N" covers the list | `grading.service.ts:688-696` | e2e:grading-bulk-promote:170; pw:grading-board:74 | IMPLEMENTED+TESTED |
| 130 | Any student can be removed from the batch with one click | `school-portal/src/grading/BulkPromoteModal.tsx:96, 269` | No test clicks Remove | IMPLEMENTED-UNTESTED |
| 130 | Students blocked by the switch are listed as "can't be promoted" and skipped | `grading.service.ts:656` | e2e:grading-bulk-promote:195; pw:grading-board:113 | IMPLEMENTED+TESTED |
| 130 | Each history entry records the acknowledgement | `grading.service.ts:700-701, 506` | e2e:grading-bulk-promote:170; pw:grading-board:74 (`acknowledgedWithoutSkillSignoff`) | IMPLEMENTED+TESTED |
| 130 | 200 students per request | `dto/grading-board.dto.ts:91`; `grading.controller.ts:199` (throttle) | e2e:grading-bulk-promote:230 | IMPLEMENTED+TESTED |
| 130 | Event completion applies the same checks | — | — | DEFERRED (158) |
| 131 | Only the three IBJJF templates ship (90/139/175 rungs); no others | `src/ranks/templates/ibjjf.ts`; `ranks.service.ts:64-119` | e2e:style-templates:99, 109, 153 (`karate` → 400); pw:style-templates:19 | IMPLEMENTED+TESTED |
| 132 | A Guardian with an active link can read a minor's ranks, eligibility and history, read-only | `grading.service.ts:166-193` | e2e:ranks:644, 688 | IMPLEMENTED+TESTED |
| 133 | No direct membership rule for grading | `grading-attendance.ts:77-121` has no membership check (checked) | — | N/A (no rule to build) |
| 134 | Grading data goes with the account (Spec Decision 44 hard delete) | Account deletion is not built: `src/users/users.controller.ts:10-12` ("DELETE /users/me deferred") | — | DEFERRED (depends on the unbuilt account-deletion job) |
| 135 | Grading ships in v1.1 | — | — | N/A (release assignment) |

### 136–163

| Dec | Rule | Implementation | Test | Status |
|---|---|---|---|---|
| 136 | 33% / 66% by default | schema defaults; `engine/eligibility.ts:136` | e2e:grading-board-thresholds:119; eng:397 | IMPLEMENTED+TESTED |
| 136 | Thresholds editable per School (per style) | `grading.service.ts:938-962`; DB check `20261024000000_board_thresholds/migration.sql:7-8` | e2e:grading-board-thresholds:125, 146; pw:board-thresholds:23, 43 | IMPLEMENTED+TESTED |
| 136 | Progress = classes ÷ required (days for time-only), capped at 100; skills and days not in the % | `engine/eligibility.ts:53-126` | e2e:grading-attendance:328, 364, 386 | IMPLEMENTED+TESTED |
| 137.1 | **At signup**, a student (or a guardian for a minor) enters their current rank per discipline; stored unverified | API only: `grading.service.ts:1274-1355` (`POST /students/{id}/ranks/{styleId}/declare`). Not part of `POST /schools/{id}/join` (`tenants/schools/schools.service.ts:149-205`). Nothing in `apps/school-portal` or the `apps/student` copy on master calls it | e2e:ranks:1829, 1879 (endpoint only) | **PARTIAL** |
| 137.2 | Anyone with grading permission can verify | `grading.service.ts:1362-1442` (`canVerifyRanks`) | e2e:ranks:1888; e2e:grading-permission-toggles:180 | IMPLEMENTED+TESTED |
| 137.3 | An unverified rank still allows booking rank-restricted classes | `src/ranks/booking-unlocks.ts:15-36` ignores `verificationStatus` | No booking test uses an UNVERIFIED rank | IMPLEMENTED-UNTESTED |
| 137.4 | **A notice at portal login lists students waiting to be verified, for anyone with grading permission** | API `GET /schools/{id}/rank-verifications` is **owner-only** (`grading.service.ts:1448-1461`). Nothing in `school-portal/src` calls it, so there is no login notice. Coaches only see a per-card "Not verified" badge (`GradingBoardPage.tsx:308`) | e2e:ranks:1923 (owner list; coaches refused) | **PARTIAL** |
| 137.5 | White belts / beginners verified automatically | Refined by 147 (see below) | — | SUPERSEDED (by 147) |
| 138 | The owner always has grading permission | `grading.service.ts:220` | e2e:ranks:1684 | IMPLEMENTED+TESTED |
| 138 | Others only for the disciplines granted | `grading.service.ts:219-233`; `grading-permissions.service.ts:68-109` | e2e:ranks:1633, 1652 | IMPLEMENTED+TESTED |
| 138 | Permission covers grade, downgrade, adjust, bulk, sign-off, verify (and void, edit date) | Every write calls `assertCanGrade` | e2e:ranks:1710; e2e:grading-permission-toggles:160, 180 | IMPLEMENTED+TESTED |
| 138 | Downgrade and adjustments need no higher permission than promote (one permission) | Replaced by separate toggles | — | SUPERSEDED (by 181) |
| 139.1 | One home branch per student, chosen at join | `schools.service.ts:186-204` | e2e:tenants:523-546 | IMPLEMENTED+TESTED |
| 139.2 | Grading staff see and grade only their own branch; the owner sees all | `grading.service.ts:237-274, 795-803` | e2e:ranks:1652, 1671; e2e:grading-board:188 | IMPLEMENTED+TESTED |
| 139.3 | One ladder per style, shared by all branches | Structural (Discipline is per School, no branch field) | e2e:ranks:1652 (one ladder graded across branches) | IMPLEMENTED+TESTED |
| 140 | Default: any ticked type counts toward one total | `engine/class-count.ts:35-38` | e2e:grading-attendance:203; eng:293 | IMPLEMENTED+TESTED |
| 140 | "Each ticked type required" offered as a per-rung option | `ranks.service.ts:690-713` | e2e:ranks:1149 | IMPLEMENTED+TESTED |
| 140 | A class counts toward a discipline only if its type is ticked on the next rung | `grading-attendance.ts:77-121` | e2e:grading-attendance:203, 273 | IMPLEMENTED+TESTED |
| 141 | A deleted instructor's history is kept and shows "Former instructor" | `prisma/schema.prisma:2195` (SetNull); `school-portal/src/grading/StudentGradingPage.tsx:87` | e2e:ranks:1468 (API). The portal label has no test | IMPLEMENTED+TESTED |
| 142 | Student app: read-only rank, progress and skills for students and guardians, next app release | Not on master; Track B branch has no grading work | — | NOT BUILT (Track B, scheduled for the app's next release) |
| 143 | Classes carry a class type from the discipline's list; credit, cap and gate use it | `src/classes/classes.service.ts:138`; `grading-attendance.ts`; `booking-unlocks.ts` | e2e:classes:362; e2e:grading-attendance:203; e2e:booking-unlocks:146 | IMPLEMENTED+TESTED |
| 144 | The grading fee is the school's own optional charge to its students | Via 162/163 (existing scoped pass) | see 162 | IMPLEMENTED-UNTESTED (see 162) |
| 145.1 | "Ready to grade" in-app (+email) to the owner and permitted staff (by branch) | `src/jobs/grading-notifications.processor.ts:127-214`; `jobs/notification-fanout.processor.ts:59-77` | e2e:grading-ready-notification:163, 205 | IMPLEMENTED+TESTED |
| 145.2 | "You've been promoted" to the student, or the guardian for a minor | `grading-notifications.processor.ts:216-256` | e2e:grading-ready-notification:180, 192 | IMPLEMENTED+TESTED |
| 145 | Push delivery | — | — | DEFERRED (Decision 95) |
| 146 | School-typed names are stored once and not translated | No translation runtime exists | — | N/A (nothing to build) |
| 147.1 | The verifier can correct the rank; the correction goes on history (who/from/to/when) | `grading.service.ts:1382-1438` | e2e:ranks:1888 | IMPLEMENTED+TESTED |
| 147.2 | Only the style's first rung is auto-verified | `grading.service.ts:1310-1315` | e2e:ranks:1866 | IMPLEMENTED+TESTED |
| 148.1 | Attendance at another branch counts when bookable (no new restriction) | No branch filter in `grading-attendance.ts:77-121` | No cross-branch check-in test | IMPLEMENTED-UNTESTED |
| 148.2 | The owner assigns home branches to existing students | `schools.service.ts:423-441` | e2e:ranks:1684 | IMPLEMENTED+TESTED |
| 148.2 | **The Grading Board shows students with no home branch under "No branch", owner only** | Board items carry no home-branch field (`grading.service.ts:827-866`); `GradingBoardPage.tsx` has no grouping. Unassigned students are mixed into the normal columns for the owner | — | **NOT BUILT** |
| 149 | Number per type; complete only when every type is met | `engine/eligibility.ts:88-97`; `ranks.service.ts:701-713` | eng:372, 391; e2e:ranks:1149; e2e:grading-attendance:342 | IMPLEMENTED+TESTED |
| 150 | Events and a fee switch ship in v1.1 | None built (checked the schema) | — | SUPERSEDED (158, 163) |
| 151 | Franchise-wide ladders behind a switch | Nothing built (checked) | — | DEFERRED (160: after v1.1) |
| 152.1 | Classes, timetable slots and instructor specialisations pick from the School's style list | `classes.service.ts:138`; `timetable.service.ts:175`; `instructors/instructor-specializations.ts` | e2e:classes:362; e2e:timetable:264; e2e:instructors:537 | IMPLEMENTED+TESTED |
| 152.2 | Rungs can be reordered **by drag** even when held, after a confirmation that lists affected students | Reorder + confirmation built (`ranks.service.ts:482-526`; `school-portal/src/ranks/LadderSection.tsx:14-25`), but with ↑/↓ buttons, not drag (`LadderSection.tsx:115`) | e2e:ladder-editor:115, 185, 204; pw:ladder-editor:36, 94 | PARTIAL (interaction only; behaviour matches) |
| 152.2 | Deleting a rung students hold stays blocked | `ranks.service.ts:398-413` | e2e:ladder-editor:130, 150; pw:ladder-editor:82 | IMPLEMENTED+TESTED |
| 152.3 | "Currently attending" comes from an active membership, with a manual override | `grading.service.ts:846-847` | e2e:grading-board:176, 251; pw:grading-board:43 | IMPLEMENTED+TESTED |
| 153 | "Edit rank date" with a history note (old date, new date, who, when) | `grading.service.ts:1174-1254` | e2e:ranks:1378 | IMPLEMENTED+TESTED |
| 154.1 | **Lessons watchable only by students and guardians with an active paid membership for that activity; reads must be narrowed** | Not narrowed. Reads are gated by RLS `lesson_tenant_isolation` (any active RoleGrant) via `curriculum.service.ts:73-110`. A guardian without their own grant can't read lessons at all | e2e:curriculum:234 asserts the **old** broad read | **NOT BUILT** |
| 154.2 | Video pricing decided later | — | — | DEFERRED |
| 155 | App shows rank history next release | Not on master | — | NOT BUILT (Track B, scheduled) |
| 155 | App shows lessons once video exists | — | — | DEFERRED |
| 156 | Every sign-off change is logged (who, when, old, new) | `grading.service.ts:1087-1099`; schema SkillSignOffLog | e2e:ranks:1289, 1500 | IMPLEMENTED+TESTED |
| 157 | Handover stored read-only at `deep-review/grading-prototype/`; its scenarios are the engine's acceptance tests | Directory present (HANDOVER.md, prototype/, qa/ …) | eng:195-235 (sweep against the prototype's reference rules) | IMPLEMENTED+TESTED |
| 158 | Grading events move to Version 2 | Nothing built (checked) | — | DEFERRED |
| 159.1 | ULTM8 takes nothing from grading fees | No per-transaction platform fee anywhere in `src/` (no `application_fee`); the franchise fee is per active student, not per sale | — | IMPLEMENTED-UNTESTED |
| 159.2 | Fee per rung or per style in v1.1 (as separate passes); per event from V2 | Expressible as several scoped passes (162) | — | IMPLEMENTED-UNTESTED (per-event DEFERRED) |
| 160 | Franchise owner's switch, franchise-level edits, after v1.1 | Nothing built | — | DEFERRED |
| 161 | Students (and guardians) always see their full progression, including "Ready to Grade" | API: the student and guardian can read `/eligibility` with the board column (`grading.service.ts:98-113, 177`). App screens are Track B | e2e:ranks:644 (guardian eligibility); student self-read is covered implicitly | IMPLEMENTED+TESTED (API); app = Track B |
| 162 | Grading day = one-off Class + 1-credit CLASS_PACK scoped to it, through existing purchase flows; booking enforces the scope | Existing: MembershipPlan `scopedClassId` 1-credit cap; `src/bookings/bookings.service.ts:450, 489` | e2e:memberships:214 (cap). No test that booking refuses a pass scoped to another class | IMPLEMENTED-UNTESTED |
| 163 | No separate fee on/off + amount setting in v1.1 | None exists (checked schema and DTOs) | — | N/A (conforms: nothing to build) |

### 164–184

| Dec | Rule | Implementation | Test | Status |
|---|---|---|---|---|
| 164 | Belt-level required skills copied to the first rung of the next belt; top belt not copied; originals kept | `prisma/migrations/20261010000000_grading_ladder_fields/migration.sql:74-108` | No migration test | IMPLEMENTED-UNTESTED |
| 165 | The stripe list is the only colour source; the single colour follows the first stripe; colour-only edit refused on mixed; no-stripe rung keeps its colour | `ranks.service.ts:675-689, 718`; data migration `20261011000000_rung_colour_from_first_stripe` | e2e:ranks:1065 | IMPLEMENTED+TESTED |
| 166 | Corrected date not in the future and not before the previous (non-voided) grading; corrects that entry; ADJUSTMENT recorded | `grading.service.ts:1186-1250` | e2e:ranks:1378 (includes the voided lower bound), 1422; e2e:grading-actions:214 | IMPLEMENTED+TESTED |
| 167 | A stripe award restarts the time-in-rank clock | `grading.service.ts:445, 466` | e2e:ranks:1422; e2e:grading-attendance:297 | IMPLEMENTED+TESTED |
| 168.1 | A School with no branches is one branch: permitted staff cover all; join asks for no branch | `grading.service.ts:254-257`; `schools.service.ts:201-202` | e2e:grading-board:276; tests in branchless schools across grading suites (join-with-branchId refusal itself untested) | IMPLEMENTED+TESTED |
| 168.2 | Joining a School with branches requires a home branch; legacy students have none until assigned | `schools.service.ts:191-200` | e2e:tenants:523-546; e2e:ranks:1662 | IMPLEMENTED+TESTED |
| 168.3 | Staff assigned per branch (possibly several); a grant with no branch covers no one; the owner covers all | `grading.service.ts:251-274` | e2e:ranks:1671 | IMPLEMENTED+TESTED |
| 168.4 | Staff without permission can view (read-only) their branches' students | `grading.service.ts:237-241` | e2e:ranks:1652 | IMPLEMENTED+TESTED |
| 168 | StudentHomeBranch kept separate from the STUDENT grant | schema StudentHomeBranch; `schools.service.ts:199` | e2e:tenants:542-546 | IMPLEMENTED+TESTED |
| 169 | An instructor must have a branch in a School with branches, or belongs to the School when it has none | `src/tenants/role-grants/role-grants.service.ts:76`; `coach-invites.service.ts:105-110` | e2e:tenants:192; e2e:coach-invites:154 | IMPLEMENTED+TESTED |
| 170.1 | Styles required when the School has styles; class type from the style's list | `classes.service.ts:138`; `timetable.service.ts:175` | e2e:classes:362; e2e:timetable:264 | IMPLEMENTED+TESTED |
| 170.2 | One or more styles per class; counts once toward each | `grading-attendance.ts:91-120` | e2e:classes:385; e2e:grading-attendance:273 | IMPLEMENTED+TESTED |
| 170 | Classes generated from a slot copy its styles | `src/jobs/class-occurrence-generation.processor.ts:188-189` | e2e:class-occurrence-generation:116 | IMPLEMENTED+TESTED |
| 171.1 | Mon–Sun weekly cap; first classes count; extras ignored, not carried over | `engine/class-count.ts:31-53`; `engine/days.ts:35-38` | eng:303, 310, 318; e2e:grading-attendance:220, 240 | IMPLEMENTED+TESTED |
| 171.2 | "Each type" progress is combined, each type capped (22/30 = 73%) | `engine/eligibility.ts:88-97` | eng:372, 380; e2e:grading-attendance:342 | IMPLEMENTED+TESTED |
| 171.3 | Nothing ticked: every class counts | `engine/class-count.ts:37` | eng:298; e2e:grading-attendance:212 | IMPLEMENTED+TESTED |
| 171.4 | No cap or 0 means no limit | `engine/class-count.ts:33` | eng:293-298 (no cap) and the reference sweep | IMPLEMENTED+TESTED |
| 171 | Time-only next rung: count rules come from the current rung | `engine/requirement.ts:65-82` | eng:247 | IMPLEMENTED+TESTED |
| 172.1 | A School has an optional time zone, set in the create form and in settings | schema `School.timezone`; `school-portal/src/schools/CreateSchoolPage.tsx:124` | e2e:tenants:268 (API); portal form untested | IMPLEMENTED+TESTED |
| 172.2 | Branch tz → School tz → UTC, for generation and engine days/weeks | `grading-attendance.ts:50`; `grading-eligibility.ts:62-68`; class-occurrence processor :106 | e2e:class-occurrence-generation:148; e2e:grading-attendance:231; e2e:grading-actions:199, 214 | IMPLEMENTED+TESTED |
| 173.1–2 | Per-rung "Unlocks booking" list opens types to that rung and above; types no rung lists are open; nothing set = open | `engine/booking-access.ts:17-23`; `ranks.service.ts:728` | eng:448-476; e2e:booking-unlocks:141, 146, 153, 165, 178 | IMPLEMENTED+TESTED |
| 173.3 | Refused below the unlocking rung or with no rank; staff override recorded | `booking-unlocks.ts:15-36`; `bookings.service.ts:407-409` | e2e:booking-unlocks:146, 160, 171 | IMPLEMENTED+TESTED |
| 173.4 | A class with no type is open; a multi-style class must pass for each style | `booking-unlocks.ts:22-35` | e2e:booking-unlocks:165; eng:467 | IMPLEMENTED+TESTED |
| 173 | One gate shared by booking **and the waitlist claim** | `src/bookings/waitlist.service.ts:321-323` | No waitlist-claim rank-gate test | IMPLEMENTED-UNTESTED |
| 174.1 | Starting classes per type on "each type" rungs; one number otherwise; none for time-only | `grading.service.ts:537-569` | e2e:grading-actions:228, 237, 253 | IMPLEMENTED+TESTED |
| 174.2 | A board drag sets the same % for each type | `engine/board.ts:39-42` | eng:503; e2e:grading-board:218 | IMPLEMENTED+TESTED |
| 175 | Age-13 limited login closed, not built | No such code (checked) | — | N/A (closed) |
| 176.1 | Log a class: type from the next rank's ticked types (optional if none), skips the cap, recorded; none on time-only | `grading.service.ts:1007-1037` | e2e:grading-board:233; pw:grading-board:144 | IMPLEMENTED+TESTED |
| 176.2 | The Active switch is per student, per style | `StudentRank.boardActiveOverride` (per discipline row); `grading.service.ts:1041-1045` | e2e:grading-board:176, 251; pw:grading-board:144 | IMPLEMENTED+TESTED |
| 177.1 | Branch staff read-only access to their own branch's home-branch rows | `20261021000000_grading_board/migration.sql:13` | e2e:grading-board:260 | IMPLEMENTED+TESTED |
| 177.2 | Branchless School: staff can read its STUDENT grants, only while it has no branches | same migration :36-62 | e2e:grading-board:276 | IMPLEMENTED+TESTED |
| 178.1 | Ready check after log-class, grade and the daily sweep | `grading.service.ts:529, 587-591`; processor :101-125 | e2e:grading-ready-notification:163, 180, 205 | IMPLEMENTED+TESTED |
| 178.1 | Ready check after a **check-in, sign-off, board drag, rank-date edit, declare and verify** | `attendance.service.ts:227`; `grading.service.ts:969, 1063, 1186, 1298, 1373` | Not asserted for these triggers | IMPLEMENTED-UNTESTED |
| 178.2 | Once per rank (`readyNotifiedAt`); cleared on every rank change | `grading.service.ts:471, 1411`; processor :149-154 | e2e:grading-ready-notification:174, 180 | IMPLEMENTED+TESTED |
| 178.3 | Recipients: owners plus permitted staff covering the branch (all staff when branchless; owner only when no home branch); only enrolled students | processor :185-214, :137-141 | e2e:grading-ready-notification:163, 205 | IMPLEMENTED+TESTED |
| 178.3 | Only at an open School with ranks switched on | processor :135-136 | Not tested | IMPLEMENTED-UNTESTED |
| 178.4 | "Promoted" goes to each linked guardian instead of a minor | processor :216-256 | e2e:grading-ready-notification:192 | IMPLEMENTED+TESTED |
| 178.5 | Jobs role gets read-only grading grants; its only write is `readyNotifiedAt` | `20261022000000_grading_ready_notification/migration.sql:16-49` (column-level UPDATE grant) | No test that `ultm8_jobs` is refused other writes | IMPLEMENTED-UNTESTED |
| 179.1 | Grading screens in English first | — | — | N/A (conforms) |
| 179.2 | More languages later | — | — | DEFERRED |
| 179.3 | Chromium tests at desktop and tablet widths, keyboard-only | `school-portal/playwright.config.ts:29-30` | pw:* keyboard tests (grading-board:120, ladder-editor:131, student-grading:119, grading-permissions:70) | IMPLEMENTED+TESTED |
| 180.1 | Belts reorder, and stripes within their own belt; never across belts | `ranks.service.ts:378-392, 482-504` | e2e:ladder-editor:115, 170, 185 | IMPLEMENTED+TESTED |
| 180.2 | A rung keeps its identity and its students when moved | `ranks.service.ts:381-437` | e2e:ladder-editor:115, 185; pw:ladder-editor:94 | IMPLEMENTED+TESTED |
| 180.3 | A held rung can't be removed; the API names the students | `ranks.service.ts:398-413` | e2e:ladder-editor:130, 150 | IMPLEMENTED+TESTED |
| 180 | `GET /styles/{id}/rung-holders` is owner only | `ranks.service.ts:509-526` | e2e:ladder-editor:204 | IMPLEMENTED+TESTED |
| 181.1 | Seven toggles per coach per style; each action needs its own toggle | `grading.service.ts:20-29, 219-233`; `dto/grading-permission.dto.ts` | e2e:grading-permission-toggles:134, 160, 180 | IMPLEMENTED+TESTED |
| 181.1 | Branch rule unchanged for coaches | `grading.service.ts:232` | e2e:ranks:1652 | IMPLEMENTED+TESTED |
| 181.2 | Board % changed by the owner or a coach with "Change board %" | `grading.service.ts:938-962` | e2e:grading-board-thresholds:154 | IMPLEMENTED+TESTED |
| 181.3 | "Ready to grade" goes to coaches who may **Promote** | processor :192 (`canPromote: true`) | Recipient test only distinguishes no-permission vs permitted; no Promote-off case | IMPLEMENTED-UNTESTED |
| 181.4 | Existing grants keep every toggle on | `20261023000000_grading_permission_toggles` (DEFAULT true) | e2e:grading-permission-toggles:150 covers the legacy `disciplineIds` path, not the migration | IMPLEMENTED-UNTESTED |
| 181.5 | Grading permissions page lists Instructors and Branch Staff with "May grade" + 7 toggles | `school-portal/src/grading/GradingPermissionsPage.tsx`; `grading-permissions.service.ts:42-62` | pw:grading-permissions:23, 53, 70 | IMPLEMENTED+TESTED |
| 181 | **A Branch Staff member granted grading permission can use the grading screens** | API allows it. The portal does not: `school-portal/src/auth/AuthContext.tsx:98-109` (`useCoachSchoolId`/`useGradingSchoolId` only consider OWNER or INSTRUCTOR grants), so the Grading Board and student panel get no schoolId for Branch Staff | — | **PARTIAL** |
| 182.1 | Templates use the prototype's numbers (belts, rungs, classes, days, caps, types, black-belt years), then are edited freely | `templates/ibjjf.ts`; `ranks.service.ts:71-119` | e2e:style-templates:109, 147 | IMPLEMENTED+TESTED |
| 182.2 | Duplicate copies ladder, skills (re-linked), class types, switch and board %; not students, ranks, history, lesson links or permissions | `ranks.service.ts:125-174` | e2e:style-templates:158, 224; pw:style-templates:38 | IMPLEMENTED+TESTED |
| 182.3 | Owner only | `ranks.service.ts:73, 127` | e2e:style-templates:153 | IMPLEMENTED+TESTED |
| 183.1 | Coach by owner grant or by invite; no membership needed | `coach-invites.service.ts:216-252` | e2e:coach-invites:170 | IMPLEMENTED+TESTED |
| 183.2 | Email link, single use, 7 days, cancellable | `coach-invites.service.ts:117-160, 216-245` | e2e:coach-invites:136, 170, 201; pw:coach-invites:19 | IMPLEMENTED+TESTED (note: "one pending invite" is per School+**branch**+email, `:120-124`) |
| 183.2 | Text-message invites | — | — | DEFERRED ("text later") |
| 183.3 | Accept only with the invited email → INSTRUCTOR grant at the invite's branch | `coach-invites.service.ts:226-245` | e2e:coach-invites:170, 191; pw:coach-invites:52, 77 | IMPLEMENTED+TESTED |
| 183.4 | A coach keeps their student side | `coach-invites.service.ts:236-245` (adds, never revokes) | e2e:coach-invites:191 | IMPLEMENTED+TESTED |
| 183.5 | Owner + Branch Staff with "Can invite coaches" (own branches only); Instructors can't | API `coach-invites.service.ts:69-81, 282-300` | e2e:coach-invites:229, 262; pw:coach-invites:36 (owner sets the flag) | IMPLEMENTED+TESTED (API) |
| 183.5 | **Branch Staff with the permission can actually invite from the portal** | `school-portal/src/roleGrants/StaffPage.tsx:35` uses `useOwnedSchoolId()`. The Invite section (`CoachInvitesSection.tsx:81`) is only reachable by the owner | — | **PARTIAL** |
| 183.6 | Only the token's SHA-256 is stored; RLS owner/staff/link holder | `coach-invites.service.ts:117-125, 179-185`; migration `20261025000000_coach_invites` | e2e:coach-invites:136, 163, 262 | IMPLEMENTED+TESTED |
| 183.6 | The inviter must have a verified phone (Decision 81) | `coach-invites.service.ts:112-115` | Fixtures always set `phoneVerifiedAt`; no refusal test | IMPLEMENTED-UNTESTED |
| 183.7 / 184.1 | Mobile coach screens | Track B | — | DEFERRED (follows on the Track B branch, per 184.1) |
| 184.2 | Dashboard: grading counts per style, their classes and slots, notifications, own training | `school-portal/src/coach/CoachDashboardPage.tsx:44-120` | pw:coach-dashboard:31, 77, 84 | IMPLEMENTED+TESTED |
| 184.3 | Only their styles and the actions their toggles allow; own branches only | `StudentGradingPage.tsx:187-247` (`can(...)`); API `grading-permissions.service.ts:28-40` | pw:coach-dashboard:58; e2e:my-grading-permissions:92, 98, 106 | IMPLEMENTED+TESTED |
| 184.4 | A non-owner coach lands on `/coach`; menu Dashboard / Grading Board / Notifications; header "Coach"; first School only | `App.tsx:36-41`; `layout/Shell.tsx:6-20`; `layout/TopBar.tsx:11-15` | pw:coach-dashboard:31 | IMPLEMENTED+TESTED (INSTRUCTOR only; see the 181 Branch Staff row) |

---

## Inter-decision conflicts

1. **75 vs 136, formula.** Decision 75 says the progress-% *formula* is School-configurable. Decision 136 keeps the prototype's formula ("The progress formula itself stays the prototype's") and makes only the thresholds editable. 136 calls itself "consistent with 75", but 75's formula half is effectively overruled. Nothing in 75 is annotated. Recommend a one-line note on 75.
2. **138 vs 181.** 138 says "Downgrade and adjustments need no higher permission than promoting" (one permission). 181 splits this into seven independent toggles. 181 says it "refines" 138, but 138's sentence is no longer true. Code follows 181.
3. **"Coach" means different people.** In 181 a coach is "each Instructor or Branch Staff member". In 183 and 184 a coach is someone with an INSTRUCTOR grant (an invite grants INSTRUCTOR; "Can invite coaches" is Branch Staff only, per Spec 55 §8.2). 184 never says whether Branch Staff with grading toggles get the coach dashboard. This ambiguity causes the portal gap for Branch Staff graders (181/184 PARTIAL row). **Needs a product answer.**
4. **152.2 "reordered by drag" vs 180 / the built editor.** 180 restates the rule without drag, and the portal uses ↑/↓. This is an interaction difference only.
5. **104 vs 154 (lesson reads).** 104 says any role holder at the School may read lessons. 154 narrows this to paid-membership students and guardians. The code still follows 104, and a test asserts the 104 behaviour (e2e:curriculum:234).
6. **140 vs 171 (time-only next rung).** Decision 140 says "ticked on the student's next rung". 171's confirmation uses the current rung when the next one is time-only. 171 itself reconciles them. Code follows 171. No action needed.
7. **164: still open.** The belt-level `RankRequiredSkill` rows (and `Rank.weeklyClassCountCap` / `yearsInRankFlag`) were to be kept "until the grading engine switches over". The engine has switched (`loadLadder` reads only rung skills, `grading-attendance.ts:22-47`). However, `createRank`/`updateRank`/`duplicate` still write the belt-level fields (`ranks.service.ts:252-253, 267-271, 459-466, 155`). An API client setting belt-level skills gets no effect. No decision covers removing them.
8. Explicit supersessions, all correctly followed by the code: 137.5→147.2; 150→158/163; 90/93-bridge→170/173/Phase 2b.

## SKILL.md lines that contradict the decision log

| SKILL.md line | Says | Conflicts with |
|---|---|---|
| `skills/ultm8-domain-rules/SKILL.md:66` (§5) | **[CONFIRMED]** `eligibleClassTypes` is dual-purpose: grading credit **and** booking eligibility, cumulative across the flattened ladder | Decision 173 (booking uses the separate `bookingUnlocksClassTypes`; overrides Spec 55 §6.1 here) and 127/140 (`eligibleClassTypes` = types that count toward reaching that rung, not cumulative). §9 (line ~152) carries the 173 note, but §5 is not marked superseded |
| `SKILL.md:70` (§5) | **[CONFIRMED]** thresholds **and the formula** for progress % are School-configurable | Decision 136 (formula fixed as the prototype's). The next bullet says "RESOLVED by 136", but this one still reads as confirmed |
| `SKILL.md:62` (§5 note) and `:76` (§5A title) | "Everything in §5A is decided but mostly **not yet built**"; title "Decisions 124–163" | Stale: §5A cites up to 182 and most of it is now built. This line could mislead a reader into rebuilding things |
| `SKILL.md:108` (§5A) | "staff get a notice at login" (unverified ranks) | Not built (137.4 PARTIAL). SKILL.md states it as current without flagging that |
| `SKILL.md:174` (§12) | `qr-attendance-processing` is a **background job** triggered by a scan | Decision 93 (handled synchronously in the request; `attendance.service.ts:222`). Pre-grading, but it describes the StudentRank increment path |

## CHANGELOG "Unreleased" claims not (fully) built

1. **"api — grading foundation, PR 6 … Pending list: … Permitted coaches get their branches' list with the Grading Board (Phase 3)."** The board only shows a per-card "Not verified" badge (`GradingBoardPage.tsx:308`). Coaches have no list, and nobody has a login notice. `rank-verifications` is owner-only and has no portal consumer.
2. **"Coach invites … Who can invite coaches: the owner ticks which Branch Staff may also invite, for their own branches."** True for the API. In the portal, the Invite UI sits on the owner-only Staff page (`StaffPage.tsx:35`), so a Branch Staff member with the permission has no way to invite there.
3. **"Coach dashboard … A coach who signs in lands on Coach dashboard … The Grading Board and student panel now work for coaches."** This works for INSTRUCTOR grants only. A Branch Staff member given grading toggles (181 calls them a coach) can't use the board or the panel (`AuthContext.tsx:98-109`). Whether that counts as overstated depends on conflict 3 above.
4. Everything else listed under Unreleased for grading (Phases 2a–3c, the ladder editor, the student panel, the board, thresholds, toggles, templates/duplicate, coach invites API, coach dashboard for Instructors, School time zone, specialisations) was found built as described.

## Extra behaviour beyond the decisions (flag, not a status row)

- **Downgrade sends a "Rank updated" notification** to the student or guardians (`grading.service.ts:521-528`; processor :221-247). Decision 145 approved only two notifications ("ready to grade" and "you've been promoted"; "more can be added later"). A downgrade notice was never decided. It is low risk, but it is unspecified behaviour per CLAUDE.md. Either confirm it with Gus or drop it.
- **No enrolment check on grading writes.** `changeRung` does not verify that the target holds an active STUDENT grant at the School. It relies on Rank RLS: a user with no grant there sees an empty ladder and gets a 400. As a result, the owner (or a permitted coach in a branchless School) can give a rank to someone who is only Staff or an Instructor there. Not covered by any decision; worth an explicit check (`grading.service.ts:343-420`). I am uncertain whether this is intended (184: a coach may also train).
- **Coach invite "one per person"** is enforced per (School, **branch**, email), not per person (`coach-invites.service.ts:120-124`). This is probably intended, since a coach can be at several branches (168/169), but the decision text says "one per person".
