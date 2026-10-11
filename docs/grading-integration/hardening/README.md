# Grading hardening (roadmap Phase 7)

Three reviews were run on 10 Oct 2026 against `master` @ `0362ddd` (PR #131).
They are kept as they were written; this page records where each finding went
afterwards.

| Report | What it did |
|---|---|
| [ACCEPTANCE-REPORT.md](ACCEPTANCE-REPORT.md) | Gus's prototype scenarios (`qa-harness.html`) re-run against the real API: 107,834 checks on the three IBJJF templates, 600-student board, random actions. Now a CI test: `apps/api/test/grading-acceptance.e2e-spec.ts`. |
| [GRADING-STRESS-TEST-REPORT.md](GRADING-STRESS-TEST-REPORT.md) | Load, races, tenant isolation and throttles on grading, in the style of the V1 stress reports. |
| [DECISION-CONFORMANCE.md](DECISION-CONFORMANCE.md) | Every grading and coaching decision (75–184) traced to the code and a test. |

## Where the findings went

### Acceptance pass

| Finding | Outcome |
|---|---|
| D1 — rank history not in date order | Fixed in #132: newest first by grading date (Decision 185). |
| D2 — starting classes refused into a time-only stripe | Intended (Decisions 128.3, 174.1). No change. |
| D3 — "N inactive hidden" changed with the search | Fixed in #132; students on the top stripe counted too, in #139 (Decision 194). |
| Q1 — edit a history note later | Decision 192, built in #145. |
| Q2 — lesson categories with order | Decision 191, built in #144. |
| Q2 — deleting a style, belt, skill or lesson | Decision 198: only what has never been used. Built with this decision. |
| Q3 — default promote/downgrade target | Decision 185.1: one stripe, built in #132. |
| E1, E2 — throttling and shared Redis in the test run | Test environment only. The CI test samples the sweep to stay well under the throttle. |

### Stress test

| Finding | Outcome |
|---|---|
| 1 HIGH — coach board read one student at a time | Fixed in #134. |
| 2 MEDIUM — bulk promote of 200 slow | Fixed in #134. |
| 3 MEDIUM — owner board CPU and size | Improved in #134 (0.76 s to 0.52 s). |
| 4 MEDIUM — concurrent belt edits deadlock | Fixed in #132: edits of one style take turns; a clash is a 409, not a 500. |
| 5 MEDIUM — bulk promote applied a stale target | Fixed in #132 (Decision 185.3). |
| 6 MEDIUM — two coaches awarding the same stripe | Fixed in #132 (Decision 185.3): one wins, the other gets 409. |
| 7 LOW — cancel at the moment of accepting gave 500 | Fixed in #133: a clean 409. |
| 8 LOW — grading someone who isn't the School's student | Fixed in #132 (Decision 185.4): 404. |

### Decision conformance

| Finding | Outcome |
|---|---|
| Branch Staff with grading toggles had no portal screens (181 vs 183/184) | Decision 186, built in #135. |
| A downgrade sent a notification | Removed in #132 (Decision 185.2). |
| Grading writes didn't check the person is a student | Fixed in #132 (Decision 185.4). |
| 104 vs 154: anyone at the School read every lesson | Decisions 190, 195, built in #148. |
| Decision 108: instructor belt | Decision 188, built in #142. |
| 137.4: login notice for belts waiting verification | Decision 189, built in #140. |
| SKILL.md lines that contradicted the log | Corrected with this page. |
| CHANGELOG entries that claimed more than was built | Corrected with this page (the Branch Staff ones by #135). |
| 142, 155 — the student app shows progress, skills and history | Built: the app's **My grading** screen and `GET /students/{id}/grading`. |
| 184 — the coach dashboard in the mobile app | Built in #150. |
| 164 — belt-level skills, weekly cap and years flag still written by the API, ignored by grading | Decisions 199, 207: belt-level skills, weekly cap and years flag removed (the plain belt's rung keeps its own). |
| 137.1 — a student declares their belt at signup: the API existed, no screen called it | Built in #158: the app's **Join this School** screen asks for the home branch, then the belt per style (Decision 209 shows branch names to people browsing). |
| 148.2 — students with no home branch were mixed into the owner's columns | Built in #159: an owner-only **No branch** group above the columns, with **Assign** to give each a branch. |
| 152.2 — rungs reordered with ↑/↓ buttons, not by drag | Built in #161: drag handles on belts and stripe lines; ↑/↓ kept for the keyboard. |
| IMPLEMENTED-UNTESTED rows (16) | 15 now tested, no behaviour changed (see below); 164 superseded. |
| One pending invite per School, branch and email, not per person | Kept as built (Decision 210): one per branch, so a coach can be invited to a second branch; now tested. |

### The 16 rows that were built but untested

Each now has a test, except 164. No test found a bug; nothing in the code changed.

| Row | Test |
|---|---|
| 87 — switching ranks off blocks the newer grading writes | `grading-board.e2e-spec.ts`: board move, log a class, active switch, board %, bulk promote, void, edit rank date and verify all refused, nothing changed |
| 130 — remove a student from a bulk promotion in one click | Playwright `grading-board.spec.ts`: Remove, then only the others are promoted |
| 137.3 — an unverified belt still books | `booking-unlocks.e2e-spec.ts` |
| 144, 159.2, 162 — a grading-day pass books only its own class | `booking-unlocks.e2e-spec.ts` |
| 148.1 — a class at another branch counts | `grading-attendance.e2e-spec.ts` |
| 159.1 — ULTM8 takes nothing from what students pay | `src/payments/payments.service.spec.ts`: one-off passes and subscriptions are charged on the School's own Stripe account, with no application fee or transfer |
| 164 — belt-level skills copied to the first stripe of the next belt | Superseded: Decision 199 removed belt-level skills and their table, so there is nothing left to copy or test |
| 173 — the waitlist claim uses the booking rank gate | `booking-unlocks.e2e-spec.ts` |
| 178.1 — the ready check runs after a check-in, sign-off, board drag, rank-date edit, declare and verify | `grading-ready-notification.e2e-spec.ts`, one test each |
| 178.3 — no "ready" notice while ranks are off or the School is archived | `grading-ready-notification.e2e-spec.ts` |
| 178.5 — the jobs role can only mark a student as notified | `grading-ready-notification.e2e-spec.ts`: other updates and deletes refused by the database |
| 181.3 — "ready" goes only to coaches who may Promote | `grading-ready-notification.e2e-spec.ts`: a coach with Promote off is left out |
| 181.4 — grants that existed before the toggles have every toggle on | `grading-permission-toggles.e2e-spec.ts`: a grant written with the old columns only |
| 183.6 — an inviter needs a verified phone | `coach-invites.e2e-spec.ts` |

