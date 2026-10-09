# Grading: questions to settle before merging into ULTM8

Prepared 8 Oct 2026, and checked against the code on `master` (`26c6be1`). Every “today” statement below was verified in the code.

Each question has a recommendation; the decision is Gus's. Every answer becomes a numbered entry in `docs/decisions/POST-SPEC-55-DECISION-LOG.md`, starting at 124.

## Already answered by Gus

- Gus's logic is the reference for grading.
- Each stripe is its own step on the ladder and a new grade.
- The prototype is standalone. In ULTM8, attendance and curriculum feed into it.
- This is the ULTM8 grading module, built inside ULTM8's existing ranks and curriculum code.
- Q1: your grading rules win over Spec 55 where they conflict, one logged decision per conflict (Decision 124).
- Q2: you are the product owner and approve all grading decisions (Decision 125).
- Q3: keep ULTM8's belt + stripe storage, with every per-rung setting from the prototype available per rung (Decision 126).
- CLAUDE.md now carries the grading exception (Decision 124), so future sessions follow it.
- Q4: requirements describe getting into a rung, your rule exactly (Decision 127).
- Q5–Q8, Q15, Q18, Q21–Q25, Q27, Q35, Q36, Q39, Q42: your prototype's rules as written (Decision 128).
- History entries are voided with a reason, never deleted (Decision 129).
- Bulk and events ask for the skills acknowledgement per student, in one quick step (Decision 130).
- Only the three IBJJF templates ship (Decision 131).
- Guardians can see their child's rank and progress (Decision 132).
- No direct membership rule (Decision 133); grading data follows account deletion (Decision 134); grading ships in v1.1 (Decision 135).
- 33% / 66% board columns by default, editable per school (Decision 136).
- Self-declared ranks at signup, verified by grading staff, white belts verified automatically (Decision 137).
- Grading permission: owner always, others per discipline as granted (Decision 138).
- Branches: one home branch per student, branch staff grade their own branch, one ladder per school (Decision 139).
- Which classes count: any ticked type, or each type required as a per-rung option (Decision 140).
- Deleted instructors show as “Former instructor” (Decision 141); the student app gets read-only grading in its next release (Decision 142).
- Classes carry a class type (Decision 143); grading fees are charged by the school, optionally (Decision 144).
- v1.1 notifications: ready to grade, and promoted (Decision 145); names typed once, not translated (Decision 146).
- Self-declared ranks can be corrected; only plain White Belt is verified automatically (Decision 147).
- Classes at another branch count if the student may book them; owner assigns home branches (Decision 148).
- “Each type required” sets a number per class type (Decision 149).
- Grading events and a fee switch with an amount ship in v1.1 (Decision 150); franchise-wide ladders behind a switch (Decision 151).
- Discipline list, rung reordering, attendance from membership (Decision 152); edit rank date (Decision 153).
- Lessons for paid members and guardians (Decision 154); app history (Decision 155); sign-off log (Decision 156); package stored in the repo (Decision 157).

## How many need answering, and when

| When | Count |
|---|---|
| Answer first | 10 |
| Before data model | 10 |
| Before API | 15 |
| Before screens | 7 |
| Can wait | 8 |

## The questions

### A. Governance

**Q1. Do your grading rules override Spec 55 where they conflict?** · _Answer first_
- Why it matters: The project rules say Spec 55 wins over later decisions. You said “follow Gus logic”, but each override must be recorded as a numbered decision, or the next developer will build to the spec instead.
- Recommendation: Yes. Log one decision per override (124 onwards) and list them for a spec amendment.
- Answer so far: Yes (9 Oct), recorded as Decision 124. Grading only; each conflict is confirmed and logged separately (125 onwards); ask when unsure.

**Q2. Who approves grading decisions from now on: you alone, or you plus the ULTM8 product owner?** · _Answer first_
- Why it matters: The decision log records who approved each change. If grading and the wider product have different owners, conflicts (payments, roles) need one person to settle them.
- Recommendation: You approve grading rules; anything touching payments, roles or tenancy also needs the product owner.
- Answer so far: Gus is the ULTM8 product owner and decides everything, including payments, roles and tenancy (Decision 125).

### B. Ladder and data model

**Q3. How are the rungs stored: belt + stripe tiers (ULTM8 today) or one row per rung (your prototype)?** · _Answer first_
- Why it matters: Bookings, attendance and the student app already use belt + stripe tiers. Changing the storage means rewriting working code.
- Recommendation: Keep belt + stripe tiers, and show and grade them exactly like your flat ladder.
- Answer so far: A: keep belt + stripe tiers, on condition that every rung can carry every setting a prototype rung has, including required skills, weekly cap and time-only (Decision 126).

**Q4. Which rung do requirements belong to: what it takes to get into a rung (yours), or to leave it (ULTM8 today)?** · _Answer first_
- Why it matters: This is the single most important rule. Your bug B1 was this confusion. ULTM8 checks the skills on the student's current rank.
- Recommendation: Pick one, write it down, and use it in the API, portal and app. If your way wins, the ULTM8 skill check must change.
- Answer so far: Your rule exactly: requirements are for getting INTO a rung, with the time-only exceptions (Decision 127).

**Q5. Each rung needs a name (“White Belt · 2 Stripes”). Is it typed by the school or generated from belt + stripe count?** · _Answer first_
- Why it matters: ULTM8's Rank table has no name, although Spec 55 lists one. Every screen shows “Rank 3”.
- Recommendation: Add a name to the belt, generate the stripe part automatically, and allow an override.
- Answer so far: Your prototype's rule, as written (Decision 128).

**Q6. Kids red and yellow stripes: one rung can show mixed colours (3 yellow + 1 red). Keep this?** · _Before data model_
- Why it matters: ULTM8 allows one colour per stripe tier, so your 139- and 175-rung ladders can't be stored today.
- Recommendation: Keep it: add a list of colour segments to a stripe tier.
- Answer so far: Your prototype's rule, as written (Decision 128).

**Q7. “Time in rank only”: on any rank (yours) or only Black Belt and above (Spec 55)? Where is the number of years stored?** · _Before data model_
- Why it matters: ULTM8 has a yes/no flag with no years figure and enforces nothing. Your prototype stores years as minimum days.
- Recommendation: Any rank. Store the years as minimum days on that rung.
- Answer so far: Your prototype's rule, as written (Decision 128).

**Q8. Is the weekly class cap set per rung (yours) or per belt (ULTM8)?** · _Before data model_
- Why it matters: It decides where the field lives and how attendance credit is limited.
- Recommendation: Per rung, to match your ladder.
- Answer so far: Your prototype's rule, as written (Decision 128).

**Q9. Which templates ship: IBJJF only, or also Karate, Taekwondo, Judo, Muay Thai, Kids BJJ and MMA?** · _Before API_
- Why it matters: Your own notes say the non-IBJJF numbers look illustrative. A template is a promise to schools.
- Recommendation: Ship the three IBJJF ladders. Add others once you confirm real numbers.
- Answer so far: The three IBJJF ladders only, others once you confirm real numbers (Decision 131).

**Q10. Can a franchise share one ladder across all its schools, or does each school keep its own?** · _Can wait_
- Why it matters: A discipline belongs to one school today. Franchises often want one standard syllabus.
- Recommendation: Each school keeps its own for now. A franchise template is a later feature.
- Answer so far: Yes, franchise-wide ladders behind an on/off switch (Decision 151). Design details still to confirm.

**Q11. Are “discipline”, the class's activities and the instructor's specialisations one shared list?** · _Before data model_
- Why it matters: Today they are three unconnected text fields, matched by exact spelling. A typo stops attendance counting and breaks the booking gate.
- Recommendation: Yes. Classes and instructors pick from the school's disciplines.
- Answer so far: Yes: classes, timetable and instructors pick from the school's discipline list (Decision 152).

**Q12. Should classes get a real class type (Kids Fundamentals, Adult Sparring…) separate from the discipline?** · _Before data model_
- Why it matters: “Which classes count” and the weekly cap need it. Today the discipline name doubles as the class type.
- Recommendation: Yes. Add a class type to the timetable slot and the class, chosen from the discipline's class types.
- Answer so far: Yes: each class picks its type from the discipline's list (Decision 143).

**Q13. Deleting or reordering a rung that students hold: block it (yours), or ask where to move them?** · _Before API_
- Why it matters: The database already refuses to delete a rank a student holds. Reordering changes what counts as “next”.
- Recommendation: Block deleting. Allow reordering only with a confirmation that lists the affected students.
- Answer so far: Reordering allowed with a confirmation listing affected students; deleting stays blocked (Decision 152).

### C. Progress and attendance

**Q14. Progress % and the three columns: what can each school configure (Decision 75), and what are the defaults?** · _Answer first_
- Why it matters: ULTM8 decided these are per school, with no fixed platform rule. Your 33% and 66% would become the default.
- Recommendation: Default: classes ÷ required, columns at 33% and 66%, adjustable per discipline.
- Answer so far: 33% / 66% by default, editable by each school (Decision 136).

**Q15. Column names: Just Starting / Getting There / Ready to Grade (yours), or Not Ready / Almost Ready / Ready (Spec 55)?** · _Before screens_
- Why it matters: Spec 55 uses both. One set must be chosen for the portal, the app and the translations.
- Recommendation: Your labels.
- Answer so far: Your prototype's rule, as written (Decision 128).

**Q16. Does one attended class count toward every discipline the class lists, or only one?** · _Before API_
- Why it matters: Today a class listing two disciplines adds a class to both of the student's progress counts.
- Recommendation: Count it only for disciplines whose eligible class types include the class's type.
- Answer so far: Each rung ticks which class types count: any ticked type (one total), or each type with its own number (Decisions 140, 149).

**Q17. Does a class at any branch count, and should the board be filterable by branch?** · _Before screens_
- Why it matters: Grading has no idea of branches. Instructors and staff can be branch-scoped.
- Recommendation: Classes at any branch count. Add a branch filter to the board.
- Answer so far: One home branch each; branch staff grade their own branch; classes at another branch count if the student may book them; owner assigns missing home branches (Decisions 139, 148).

**Q18. Keep your manual “Log a class” button next to QR attendance?** · _Before API_
- Why it matters: Classes are counted automatically from QR check-in. A manual add with no record behind it can be abused.
- Recommendation: Keep it for staff only, and log every manual add on the student's history.
- Answer so far: Your prototype's rule, as written (Decision 128).

**Q19. What makes a student “currently attending” for the board's filter?** · _Before screens_
- Why it matters: ULTM8 has no active flag on a student. The options are an active membership, an un-revoked school role, or recent attendance.
- Recommendation: Active membership or a class attended in the last 60 days.
- Answer so far: Automatic from an active membership, with a manual override (Decision 152).

**Q20. Does an expired or unpaid membership affect grading (hide from the board, block grading)?** · _Before screens_
- Why it matters: Memberships and grading are not connected at all today.
- Recommendation: No block. Show a badge on the card.
- Answer so far: No direct rule: without an active membership a student can't book, so they earn no attendance (Decisions 133, 136).

### D. Grading actions and permissions

**Q21. Can a grade skip rungs (yours), or only move to the next one (ULTM8 today)?** · _Before API_
- Why it matters: The ULTM8 promote endpoint can only go one step.
- Recommendation: Allow skipping, with the skipped rungs noted on the history.
- Answer so far: Your prototype's rule, as written (Decision 128).

**Q22. Can a grading be back-dated (yours: not in the future, not before the current rank date)?** · _Before API_
- Why it matters: ULTM8 always uses today and has no date field on the history record.
- Recommendation: Yes, exactly your rule. Add an effective date to the history.
- Answer so far: Your prototype's rule, as written (Decision 128).

**Q23. Keep “starting classes” when grading?** · _Before API_
- Why it matters: Spec 55 says the count always resets to zero.
- Recommendation: Your call. If kept, log it on the history.
- Answer so far: Your prototype's rule, as written (Decision 128).

**Q24. Keep the per-style switch that blocks grading when skills are missing?** · _Before API_
- Why it matters: Spec 55 says the system warns and never blocks.
- Recommendation: Your call. It is the one rule that flatly contradicts the spec.
- Answer so far: Your prototype's rule, as written (Decision 128).

**Q25. Downgrade needs a written reason, and history entries carry notes. Confirmed?** · _Before data model_
- Why it matters: ULTM8 stores neither a reason nor notes today.
- Recommendation: Yes. Add reason and note fields.
- Answer so far: Your prototype's rule, as written (Decision 128).

**Q26. Can history entries be deleted (yours), or only voided with a reason?** · _Before data model_
- Why it matters: It is an audit trail. Deleting a promotion leaves no trace of who changed what.
- Recommendation: Void with a reason. Hide voided entries by default.
- Answer so far: Void with a reason, never delete (Decision 129).

**Q27. Grade only moves up, Downgrade only moves down. Confirmed?** · _Before API_
- Why it matters: Your notes list this as still awaiting your yes.
- Recommendation: Yes.
- Answer so far: Your prototype's rule, as written (Decision 128).

**Q28. Bulk promote and events: should they ask for the missing-skills acknowledgement and warn about minimum days, per student?** · _Before API_
- Why it matters: A single grade asks; bulk and events don't. This is open item 5 in your notes.
- Recommendation: Yes, per student, with a cap of 200 per request (Spec 55).
- Answer so far: Yes, per student, with one quick “acknowledge these N” step (Decision 130).

**Q29. Who can grade: Owner, Instructor, Branch Staff? Only their own branch? Per-discipline permission (your settings page)?** · _Answer first_
- Why it matters: Today Branch Staff can grade any student in the school. Spec 55 says Instructors only.
- Recommendation: Owner and Instructor, per discipline. Not Branch Staff.
- Answer so far: Owner always; others only for the disciplines the owner grants (Decision 138).

**Q30. Do Downgrade and board adjustments need a higher permission than promoting?** · _Before API_
- Why it matters: These change a student's record against their interest.
- Recommendation: Owner, or an instructor with the discipline permission. No extra tier for now.
- Answer so far: No higher permission: the same grading permission covers downgrade and adjustments (Decision 138).

**Q31. Add an “edit rank date” correction action?** · _Before API_
- Why it matters: Your direction: keep the date rule and add a correction that leaves a note. Not built anywhere.
- Recommendation: Yes, Owner only, logged.
- Answer so far: Yes, for anyone with grading permission, logged (Decision 153).

### E. Getting students onto the ladder

**Q32. How does an existing student get their current rank when a school joins ULTM8?** · _Answer first_
- Why it matters: A rank only exists after the first promote, and it always starts at the bottom. Placing a brown belt takes dozens of clicks and creates fake history.
- Recommendation: A “set current rank” action with a start date, plus a CSV import for schools moving in.
- Answer so far: Self-declared at signup and verified by grading staff, who can correct it; only plain White Belt is verified automatically (Decisions 137, 147).

**Q33. New student or new minor: does staff set the starting rank, or does everyone start at the first rung?** · _Before API_
- Why it matters: Joining a school and creating a minor never touch rank.
- Recommendation: Start at the first rung; staff can change it with “set current rank”.
- Answer so far: Students declare their rank at signup; a brand-new student starts at White Belt, verified automatically (Decisions 137, 147).

### F. Events, fees and notifications

**Q34. Are grading events part of ULTM8, and in which release?** · _Can wait_
- Why it matters: Spec 55 has no event entity. It is the largest piece of new work.
- Recommendation: Yes, as phase 2, after the board and bulk promote.
- Answer so far: Yes, grading events ship in v1.1 (Decision 150).

**Q35. What happens after a fail at an event? (The mockup showed a 45-day window and 20 classes.)** · _Can wait_
- Why it matters: Nothing is implemented. Your prototype keeps progress and changes nothing.
- Recommendation: Keep progress, no special window, for v1.
- Answer so far: Your prototype's rule, as written (Decision 128).

**Q36. Can a pass at an event promote more than one rung?** · _Can wait_
- Why it matters: Today it is always one.
- Recommendation: One rung. A coach can grade further by hand.
- Answer so far: Your prototype's rule, as written (Decision 128).

**Q37. Grading fee: per event or per student, through Stripe, and does cash count?** · _Can wait_
- Why it matters: ULTM8 payments only know membership purchases. A fee needs a new kind of charge.
- Recommendation: Per student per event, through Stripe and cash, after events ship.
- Answer so far: The school charges its own students; v1.1 adds a fee switch and an amount (Decisions 144, 150). Collection and where it's set still to confirm.

**Q38. Which grading notifications, to whom: eligible to grade (coach), promoted (student and guardian), event invitation?** · _Can wait_
- Why it matters: No grading notification exists, and push sending is deferred (Decision 95).
- Recommendation: Eligible (coach, in-app) and promoted (student, email or in-app) first.
- Answer so far: v1.1: “ready to grade” to grading staff, “you've been promoted” to the student or guardian (Decision 145).

### G. Curriculum and skills

**Q39. Lesson categories: a real list with ordering (yours), or free text (ULTM8)?** · _Before data model_
- Why it matters: Your curriculum screens sort and group by category. ULTM8 has neither the table nor the ordering.
- Recommendation: A real category list with ordering.
- Answer so far: Your prototype's rule, as written (Decision 128).

**Q40. Who can watch lessons: every student, only those who need the skill, or paid?** · _Can wait_
- Why it matters: Every student at the school can read every lesson today, and there is no pricing.
- Recommendation: Every student at the school. Decide pricing with the video rollout.
- Answer so far: Students and guardians with a paid membership for that activity (Decision 154).

**Q41. Video pricing for schools: a flat add-on or per student?** · _Can wait_
- Why it matters: Cloudflare Stream is already chosen (Decision 101). The price model is open item 13 in your notes.
- Recommendation: A flat add-on per school.
- Answer so far: Decided later, with video (Decision 154).

**Q42. Should skills keep their sign-off when a student moves up (signed at Blue, still counts at Purple)?** · _Before API_
- Why it matters: Both systems wipe sign-offs on every rank change. This is open item 11 in your notes.
- Recommendation: Keep wiping. Each rung asks for its own sign-off.
- Answer so far: Your prototype's rule, as written (Decision 128).

### H. Student app and guardians

**Q43. What does the student see in the app: progress %, skills needed, lessons, history, next grading date?** · _Before screens_
- Why it matters: The app shows only belt and stripes today. Spec 55 sketches a ranking screen with readiness and %.
- Recommendation: All of these except the date, until events exist.
- Answer so far: Rank by name, progress, skills and history in the next release; lessons once video exists (Decisions 142, 155).

**Q44. Can a guardian see their child's rank and progress?** · _Before API_
- Why it matters: Today a guardian is refused: only staff or the student themselves can read ranks.
- Recommendation: Yes, read-only.
- Answer so far: Yes, read-only (Decision 132).

**Q45. Should students see that they're “Ready to Grade” before the coach decides?** · _Before screens_
- Why it matters: It can create pressure on coaches. Some schools prefer to keep it private.
- Recommendation: A per-school setting, off by default.
- Answer so far: “Students see the whole progression of their grading.” Always on or a school setting still to confirm.

### I. Data, privacy and audit

**Q46. When a student deletes their account, is grading history erased, or kept anonymised for the school?** · _Before data model_
- Why it matters: Account deletion isn't built yet. A grading record also names the instructor, and that link blocks deleting an instructor's account.
- Recommendation: Erase the student's rank data. Anonymise the instructor on history records.
- Answer so far: Grading data goes with the account (Decision 134); a deleted instructor shows as “Former instructor” on other students' history (Decision 141).

**Q47. Should skill sign-offs be audited (who signed, when)?** · _Before data model_
- Why it matters: Today a sign-off overwrites the previous status with no trace.
- Recommendation: Yes, a small sign-off log.
- Answer so far: Yes, every sign-off change is logged (Decision 156).

**Q48. Are rank, skill and discipline names translated into the 4 languages, or typed once by the school?** · _Before screens_
- Why it matters: Neither app has translation support yet, and Arabic needs right-to-left layout.
- Recommendation: Typed once by the school. Screen labels translated when i18n arrives.
- Answer so far: Typed once by the school; only buttons and labels are translated (Decision 146).

### J. Delivery

**Q49. Which release carries grading for the website (Track A) and for the app (Track B)?** · _Answer first_
- Why it matters: Version numbers are yours to assign. It decides what goes in first.
- Recommendation: Track A: foundation fixes, engine, API, board and student panel. Track B follows one release later.
- Answer so far: Website: v1.1 (Decision 135). App: read-only grading in its next release (Decision 142).

**Q50. Store your handover package (prototype, tests, screenshots) in the repo as read-only reference?** · _Answer first_
- Why it matters: Your tests become the acceptance tests. Kept outside the repo, they get lost.
- Recommendation: Yes, in deep-review/grading-prototype/ (about 9 MB).
- Answer so far: Done: stored at deep-review/grading-prototype/ (Decision 157).

## How grading connects to the rest of ULTM8 (checked in code)

| Area | Status | What connects today | Gap |
|---|---|---|---|
| QR attendance | Partly connected | A QR check-in marks the booking Completed and adds 1 to the student's class count for each matching discipline. | Ignores which classes count, the weekly cap and branch. Matching is by exact discipline name. |
| Bookings and waitlist | Partly connected | The booking gate allows only class types the student's rank unlocks. Staff can override with a reason. | Same exact-name matching. The waitlist copy has no override. |
| Classes and timetable | Gap | Classes list “activities” as free text. | No class type, and no link to a discipline. |
| Ranks, skills, disciplines | Connected | Built: ladder, stripe tiers, required skills, with the owner editing. | No rank name, no reorder, no delete, no years figure. |
| Grading actions | Partly connected | Promote, downgrade, stripe award, skill sign-off and history work for one student at a time. | Ignores the ranks switch and archived schools. No skip, back-date, reason, bulk or eligibility. |
| Curriculum | Partly connected | Lessons link to skills, and students can read them. | No video upload, categories are free text, and lessons have no order. |
| Instructors | Partly connected | Instructors can grade, and every grading records who did it. | Branch Staff can grade too. No per-discipline permission. The instructor's own belt is free text (deferred to V2). |
| Branches | Not connected | Nothing in grading knows about branches. | A branch-scoped staff member can grade the whole school. |
| Guardians and minors | Not connected | A guardian is refused when reading a child's rank. | No guardian view. Minors have no login of their own. |
| Memberships | Not connected | Not connected. | Nothing defines “currently attending”. |
| Payments | Not connected | Not connected. | A grading fee can't be recorded: every transaction must belong to a membership plan. |
| Notifications | Not connected | No grading notification exists. | Push sending is still deferred (Decision 95). |
| School settings (ranks switch) | Partly connected | The switch blocks catalog edits only. | Grading, the booking gate and the portal menu ignore it. |
| School close and purge | Partly connected | Catalog edits are blocked when a school closes. Purge deletes the school's data. | Grading still works on a closed school. Purging a school with ranked students is untested and could fail on a rank that is still in use. |
| Account deletion | Not connected | Not built yet (deferred). | An instructor's account can't be deleted while their name is on grading history. |
| Franchises | Not connected | Not connected. | No shared ladders. |
| Platform admin | Partly connected | Can see grading only by impersonating a user, read-only. | None needed now. |
| Translations | Not connected | Translations cover screen labels only. | Neither the portal nor the app has translation support or right-to-left layout yet. |
| Audit trail | Partly connected | Rank changes are recorded as history entries. | Skill sign-offs leave no trace. |
| School portal | Partly connected | Has disciplines, ranks, skills and curriculum pages. | No board, no student panel, no grade or downgrade, no history. |
| Student app | Partly connected | Shows belt and stripes per discipline. | No name, progress, skills, lessons or history. One extra request per discipline. |
| Starting ranks and import | Not connected | A rank only appears after the first promote, starting at the bottom. | No way to place an existing student at their real rank. |
