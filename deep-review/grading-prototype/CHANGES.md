# What changed on 7 October 2026

The prototype in `prototype/index.html` is no longer the build that was published on 24 August 2026. It was stress tested, fixed and cleaned up before this handover. The published build is kept unchanged in `prototype/original-as-published-2026-08-24.html` so the two can be compared.

This file lists every change in behaviour. Nothing else about the screens or the rules was altered.

## 1. Four rule decisions made by Gus

| Question | Decision | What the prototype does now |
|---|---|---|
| Minimum days in rank for colour belts | **Enforce it** | A student is eligible only with enough classes **and** enough days in rank **and** all skills. The student panel shows a "Days in rank" row. A board card shows a clock icon when classes are done but the days are not. |
| Dragging a card between board columns | **Keep it, and log it** | The drag still rewrites the class count (or the promotion date, for a time-only rank). It now adds an ADJUSTMENT entry to the student's history saying what changed. Dropping a card on its own column does nothing. |
| "Complete event" | **Promote passes one rank** | Each participant marked Pass moves up one rank, with "Passed at <event>." on their history. Fails and no-results do not move. An event can be completed once and is read-only afterwards. |
| Grading on time alone | **A switch per rank** | The rank editor has a "Time in rank only" switch for any rank in any style. The IBJJF Black Belt and coral ranks have it on. It replaces the hidden marker (a red tag colour) the old build relied on. |

## 2. Changes made on my own judgement

These were needed to close a bug, but each one is a small rule. Gus has since confirmed items 3, 4 and 5. Items 1 and 2 (Grade up only, Downgrade down only) still need his explicit yes. The rest are easy to reverse.

1. **Grade only moves a student up.** The old build let "Grade" move a student to an earlier rank with no reason given, which went around the rule that a downgrade needs a written reason. It also opened with the student's *current* rank selected, so pressing Confirm straight away "graded" them to the rank they already held and wiped their classes and skill sign-offs. Grade now opens on the next rank, and the current and earlier ranks cannot be picked.
2. **Downgrade only moves a student down.** The old build would record a "DOWNGRADE" to a higher rank.
3. **Dates are checked. (Confirmed by Gus, 7 October.)** A grading date must be a real date and not in the future. It also cannot be earlier than the day the student reached their current rank, so a history can never run backwards. Event dates may be in the future. Dates can be typed as `21 Nov 2026`, `2026-11-21` or `21/11/2026`.
4. **A rank that students hold cannot be deleted (confirmed by Gus, 7 October)**, and a style that has students cannot be deleted. The old build deleted the rank at once, with no confirmation, and those students silently dropped off the board. Deleting an unused rank now asks first.
5. **Duplicating a style also copies its skills. (Confirmed by Gus, 7 October.)** A skill belongs to one style. Without this the copy's ranks required skills that its own rank editor could not show or remove. Deleting a style removes its skills and unlinks them from lessons.
6. **Skills never block a time-only rank.** The screens already said skills are optional for Black Belt and above, but "skills required" could still lock such a student. Now it cannot.
7. **A pass at an event that cannot be promoted is held, with the reason kept on the event:** already at the top rank, blocked by "skills required", or the student record is missing.
8. **Grading events got the minimum needed to be usable:** a name, date and venue on the form; add and remove participants; only students of the event's own style are offered.
9. **The fail panel no longer states "Extended window: 45 days / New target: 20 classes".** That text was fixed and nothing implemented it. It now says what actually happens: not promoted, progress kept. The retry idea is still listed as an open decision.

## 3. Bugs fixed

| # | Was | Now |
|---|---|---|
| B1 | The student panel listed the skills of the *current* rank, so the skills gating the *next* grade could not be signed off. Alex Chen could never become eligible. | The panel lists exactly the skills that gate the next grade, each with its sign-off button. |
| B2 | "Complete event" promoted nobody but said it had. | See section 1. |
| B3 | Minimum days was ignored for colour belts. | See section 1. |
| B5 | Brown Belt · 4 Stripes showed attendance as "10 / 0". | Shows the real target (26). |
| B6 | A Black Belt could be eligible and locked at the same time. | See section 2, item 6. |
| B7 | Board drag rewrote attendance silently, and a drop on the same column reset progress to the column's floor. | See section 1. |
| B8 | Five templates advertised the wrong number of ranks. | The number on each card is counted from the ladder the template really builds. |
| B9 | Only IBJJF could have time-only ranks. | See section 1. |
| B10 | On small belt pictures the tag covered most of the belt, so a black belt looked red. | The tag is capped at half the belt. |
| B11 | Names with `&` showed as `&amp;` in messages. | Text is escaped once, where it is written to the page. |
| B12 | Seed events listed four people who were not students. | Seed events use real seed students. |
| B13 | Deleting a rank or style orphaned students. | See section 2, item 4. |

Found by the new stress test and by review, and also fixed:

- **Typed text was lost.** Ticking a skill or changing category in the lesson form wiped the lesson name, instructor, duration and description. Picking a rank in the Downgrade window wiped the reason. The category name box had the same problem.
- **The search box lost the cursor after every letter**, because each keystroke redrew the page. The bulk-promote note box did the same. The focused field and caret position are now kept across a redraw.
- **The style name was written into the page unescaped** on the Grading Board header, and initials in the avatar were unescaped. A style or student name containing HTML was inserted as HTML.
- **The bulk-promote "done" list showed the wrong belts** (each student's new rank and the one after it) and dropped anyone who had just reached the top rank.
- **The board's "N inactive hidden" count included students hidden by the search.**
- **"Log a class" on a record with no class count produced NaN.**
- **Results could still be changed on a completed event**, and an event could be completed twice.
- **A new event took eligible students from every style**, not only its own, and had the fixed date "TBD".
- **The permissions table was hard-wired to one style.** It now has a column per style.
- **A class type whose name contained an apostrophe would have broken its button.**
- Students whose rank no longer exists were counted on the board as "already at the top rank". They are now listed separately with an "Assign a rank" action.
- A history entry now keeps the rank's name, so it still reads correctly if the rank is later deleted.

## 4. Clean-up (no change in behaviour)

- The three IBJJF ladder builders (about 290 lines, mostly repeated three times) are now one builder, `buildIbjjfLadder`, with options for the red and yellow kids stripes. The ladders it builds were compared field by field with the old ones for all nine templates and are identical.
- One function, `makeRank`, now knows every field of a rank. Six places used to copy the field list by hand.
- One function, `gradingRequirement`, answers "what does this student need for the next grade". Eligibility, the progress %, the skills panel and the Grade warning all use it. Before, three functions each worked it out separately.
- One function, `applyRankChange`, performs every rank change (Grade, Downgrade, bulk promote, events). Before, each wrote its own history entry and resets.
- All date handling is in one block (`parseDate`, `daysSince`, `normalizeDateInput`). Day counts use calendar days, so a clock change cannot shift them by one.
- The file is now a proper HTML document (doctype, head, body). Fonts have a fallback, so headings no longer turn serif when Google Fonts is unreachable.
- Stale comments corrected, unused functions removed, and every screen-state field is now declared in one place (`UI`).
- A scan of the final file finds no unused functions, no undefined or unused actions, and no leftover debug code.

## 5. Not changed

- **Weekly cap and "which classes count" are still not enforced.** They need attendance records, which belong to another module.
- **Still mocked on screen:** notifications, the grading fee, instructor permissions (stored but never checked), video.
- **Still no saving.** Reloading the page resets everything.
- **The live published artifact** ("DojoHQ Grading Prototype") is still the 24 August build. Only the file in this package is fixed.
