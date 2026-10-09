# Grading System Integration — Compatibility Review & Roadmap

**Prepared:** 8 Oct 2026 · **Input:** Gus's `dojohq-grading-handover.zip` (packaged 7 Oct 2026)
**Compared against:** Spec 55, `skills/ultm8-domain-rules/SKILL.md`, the post-Spec-55 decision log (through Decision 123), and the real code on `master` (`26c6be1`) in `apps/api`, `apps/school-portal` and `apps/student`, plus the remote Track B branch `track-b-student-app-pka8oo`.

> **Status of this document:** analysis and plan only. No code was changed. Every rule marked *needs a decision* is a real gap: it must be decided by the product owner (and Gus where it is his rule) and logged as a numbered decision before anyone builds it.

---

## 0. The short answer

1. **There is nothing to "merge" as code.** Gus's package is a single-file HTML prototype with no backend. His own notes and Spec 55 §2.3 say the same thing: *"It is NOT source code to port… the real frontend is a fresh build against these same validated flows."* What carries over is **the rules, the screen flows and the test scenarios**.
2. **ULTM8 already has half of a grading system.** `apps/api` has a working `RanksModule` and grading endpoints (promote, downgrade, stripe award, skill sign-off, rank history) and a `CurriculumModule`. The school portal can manage disciplines, ranks, skills and lessons. The student app shows a read-only "My Rank". **What is missing is almost everything a coach actually grades with:** no Grading Board, no eligibility or progress calculation, no bulk grading, no grade or downgrade screens, no rank history screen, and no skill sign-off screen.
3. **The two models are compatible in shape but not in detail.** Gus's "every stripe is its own rank" ladder maps cleanly onto ULTM8's *Rank + stripe-tier "flattened checkpoint" sequence*. But about 20 specific rules differ or are missing on one side (section 3). Seven of them conflict with something ULTM8 already decided or built, so they need a product decision before building.
4. **ULTM8's existing grading code has its own bugs and gaps that must be fixed first** (section 4). The most important: grading actions ignore the `ranksToggle` switch (a breach of Decision 87), and `Rank` has no `name` field although Spec 55 §6.1 lists one.
5. **Gus's tests reproduce exactly:** 105,303 checks with 0 failed, and the click-through 45 steps with 0 failed. The prototype is internally bug-free as claimed. The problems are in how it fits ULTM8, not in the prototype itself.

The path below is: **Phase 0 decisions → Phase 1 fix the existing foundation → Phase 2 port the rules as a tested engine → Phases 3–6 build API, portal and app → Phase 7 hardening → Phase 8 release.**

---

## 1. What was reviewed

| Source | What I did |
|---|---|
| Handover notes | Read `START-HERE.md`, `HANDOVER.md`, `CHANGES.md` and `TAKEOVER-PROMPT.md` in full. |
| Prototype rules | Read `prototype/index.html` lines 83–541 (data, dates, `gradingRequirement`, `computeEligibility`, `applyRankChange`, progress and board bands). |
| Gus's tests | Ran both (section 2). |
| Spec 55 | Extracted the full text. Pulled every grading passage: §2.3, §6.1 (Rank, StudentRank, Discipline, Skill, PromotionEvent, Lesson), §7 (RanksModule and CurriculumModule endpoints), §8.2 (roles), §9 (jobs), §12.1 and §12.2. |
| Domain rules | `SKILL.md` §5 (belt and rank) plus booking, attendance and QR sections. |
| Decision log | Decisions 75, 87, 88, 90, 93, 101, 104 and 108 bear directly on grading. |
| Existing code | `apps/api/src/ranks/*`, `apps/api/src/curriculum/*`, `attendance.service.ts`, the rank gate in `bookings.service.ts` and `waitlist.service.ts`, the Prisma models and migrations, and e2e tests. Also the school-portal `disciplines/ranks/skills/curriculum/students` pages, `packages/api-client`, and `apps/student/src/ranks/*`, both locally and on the Track B branch. |

**Not checked:** the Figma file and Gus's original conversations (neither is in the package). I also did not check how the prototype behaves in Safari, Firefox, on phones or keyboard-only (Gus's tests did not cover these either).

---

## 2. Gus's test results, reproduced here

| Test | Gus's claim | Result here |
|---|---|---|
| Click-through `tools/e2e-clicks.py` | 45 steps, 0 failed | **45 steps, 0 failed** ✅ |
| Stress test `tools/run-harness.py qa/qa-harness.html` | 105,303 checks, 0 failed | **105,303 checks, 0 failed** ✅ (13 suites, 295 s, app date 8 Oct 2026) |

Both were run in headless Chromium. The handover's own scripts were copied out, and only the browser path was changed to the pre-installed Chromium.

**What this proves:** the prototype's rules are internally consistent. **What it does not prove:** that those rules are what ULTM8 should build. That is section 3.

---

## 3. Compatibility matrix — Gus's prototype vs Spec 55 vs current ULTM8 code

Legend: ✅ compatible · 🔁 compatible with a translation · ⚠️ conflict (needs a decision) · ➕ Gus has it, ULTM8 has nothing (needs a decision before building) · 🐞 ULTM8 code falls short of its own spec.

### 3.1 Ladder and catalog

| # | Topic | Gus's prototype | Spec 55 / decisions | ULTM8 code today | Verdict |
|---|---|---|---|---|---|
| L1 | Stripe modelling | Every stripe is its own **rank** (White, White·1 … White·4 = 5 ranks) | Stripes are **tiers inside a Rank**, but each tier is "its own gating/progress checkpoint" in a "flattened belt+stripe sequence" | `Rank` + `RankStripeTier`; `StudentRank.currentStripeId` | 🔁 **Same idea, different storage.** Gus's rank ≈ one ULTM8 (Rank, stripe tier) checkpoint. Build ULTM8's way and translate Gus's ladder into it. |
| L2 | Promote vs stripe award | One action, "Grade", moves to any later rung | Two separate actions: **Stripe Award** (next tier, same belt) and **Promotion** (next belt). No stripe award at the top tier. | Both built, as separate endpoints | 🔁 Gus's "Grade to next rung" becomes Stripe Award or Promotion depending on whether the next rung is a tier or a new belt. The UI can present one button. |
| L3 | Rank name | Every rank has a name | §6.1 Rank: **"Name, order, …"** | **`Rank` has no `name` column.** The student app works around this with "Rank {order}". | 🐞 **ULTM8 gap.** Add `Rank.name` (Phase 1). |
| L4 | Multi-colour stripes on one rung (e.g. 3 yellow + 1 red) | `stripeTiers: [{count, color}, …]` on one rank | Each tier has one count and one colour | `RankStripeTier` has one `count` and one `colour` | ⚠️ The **Yellow-Stripes and Red-Stripes kids templates (139 and 175 rungs) cannot be represented** in ULTM8 as is. Decide: a "stripe colour segments" field on a tier, or drop those templates. |
| L5 | Drawing-only fields | `tagColor`, `coralAccent` | Not in spec | Absent | ➕ Cosmetic. Decide whether belt rendering needs them (IBJJF black-belt bar, coral belts). |
| L6 | Time-only ranks | `timeOnly` switch on any rank; uses that rank's `minDays` (years × 365) | "Black Belt and above": a years-in-rank flag; tenure "in years" is the sole gate | `Rank.yearsInRankFlag` stored, **no number of years anywhere**, nothing enforced; the code deliberately forbids inventing `yearsRequired` | ⚠️ **Needs a decision:** where the number of years lives. Gus's answer (reuse minimum days on the rank) is a sensible recommendation, but it must be logged. Also: spec says "Black Belt and above" while Gus allows any rank. Confirm. |
| L7 | Where thresholds live | `classCount`, `minDays`, `weeklyCap`, `scope` on each rung | classes-required, min-days and `eligibleClassTypes` on each **stripe tier**; weekly cap on the **Rank** | Same as spec | 🔁 Translates one-to-one, except the **weekly cap is per belt in ULTM8 but per rung in Gus's version**. Minor. Confirm per-belt is acceptable. |
| L8 | Requirement direction (the subtle rule) | A rung's numbers and skills = what it takes to get **into** that rung, read from the **next** rung (time-only rungs read their own) | Skills "required at the CURRENT checkpoint". Reads most naturally as *the checkpoint the student is at now*. | `assertSkillsSignedOffOrAcknowledged` checks skills on the student's **current** rank; skill sign-off only allows current-rank skills | ⚠️ **Direct conflict, and the most important one.** Gus's bug B1 was exactly this confusion. Pick **one** meaning ("requirements to leave this checkpoint" vs "to enter it"), log it, and make engine, API and portal all use it. Recommendation in §6. |
| L9 | Delete guards | Can't delete a rank students hold or a style with students; unused deletes need confirmation | Not stated | **No DELETE endpoints at all**; DB restrict on `StudentRank.currentRankId` | ✅ Compatible. ULTM8 is stricter for now. Adding deletes later should follow Gus's guards. |
| L10 | Reorder ranks | Drag to reorder | Order must be unique and contiguous | Portal can only **append** ranks | ➕ Needs a reorder endpoint (must keep `order` contiguous and not break students). |
| L11 | Templates (IBJJF 90 rungs + 2 kids variants; Karate/TKD/Judo/Muay Thai/Kids BJJ/MMA) | Built in | Not in spec | None | ➕ Needs a decision: ship templates? Gus himself flags the non-IBJJF ones as possibly placeholder (his open item 14). |
| L12 | Duplicate a style, copying skills | Yes | Not stated | None | ➕ Low risk. Decide in scope. |
| L13 | Skills belong to one discipline | Yes | Yes | Yes | ✅ |
| L14 | Skill edit/delete | Not built | — | Edit yes, delete no | ✅ / ➕ |

### 3.2 Student progress and eligibility

| # | Topic | Gus | Spec / decisions | ULTM8 code | Verdict |
|---|---|---|---|---|---|
| E1 | Student has one style and one rank | Yes (flat) | One `StudentRank` **per discipline** | Per discipline | 🔁 ULTM8 is already right. The UI must be per discipline. |
| E2 | Eligibility formula | classes ≥ req **and** days ≥ req **and** all skills signed; time-only = days only | "gate alongside, not instead of"; Black Belt+ = years only | **Not computed anywhere.** `GET /students/{id}/eligibility` returns the same data as `/ranks`. | 🐞 + port. Gus's formula fills the gap the spec leaves open. Log it as a decision, then build it. |
| E3 | Minimum days enforced for colour belts | Yes (Gus decided 7 Oct) | min-days is a confirmed tier field | Stored, not enforced | ✅ Compatible. Build it. |
| E4 | Class counter | Single number, resets on every change, no records behind it | `classesAttendedTowardCheckpoint` is fed by **Completed Bookings** via QR | Built: attendance increments every `StudentRank` whose discipline name matches the class's `activities` | ✅ ULTM8 is better. 🐞 But it ignores `eligibleClassTypes` and the weekly cap (E5). |
| E5 | "Which classes count" (scope) and weekly cap | Stored, **not enforceable** without attendance records | Confirmed: `eligibleClassTypes` governs grading credit **and** booking; weekly cap is confirmed | Booking gate uses `eligibleClassTypes`; **grading credit does not**; the weekly cap is never applied | 🐞 ULTM8 has the data to do this. **Blocker:** `Class` has no class-type field. `Class.activities` is used both as discipline name (Decision 90) and as class type. Needs a decision (Phase 0). |
| E6 | Progress % | classes ÷ required (time-only: days ÷ required), capped at 100; skills and days excluded | **Decision 75: School-configurable per discipline, no platform default; config schema undesigned** | Not computed | ⚠️ Gus's formula becomes the **default preset** of a configurable setting, not a fixed rule. The config schema must be designed (Phase 0). |
| E7 | Buckets | Just Starting / Getting There / Ready to Grade at 33% / 66% | Ready / Almost Ready / Not Ready, thresholds configurable. Spec §2.3 also uses Gus's labels, so **the spec contradicts itself.** | None | ⚠️ Decide the labels (one set) and whether 33/66 is the offered default. |
| E8 | Skill status cycle | not_started / learning / signed | Same three values | Same, with NOT_STARTED → LEARNING → SIGNED_OFF → NOT_STARTED wrap (inferred) | ✅ |
| E9 | Skill sign-offs wiped on rank change | Yes (Gus open item 11) | "scoped to the current checkpoint only" | Deleted on promote, downgrade and stripe award | ✅ Consistent. |

### 3.3 Grading actions

| # | Topic | Gus | Spec / decisions | ULTM8 code | Verdict |
|---|---|---|---|---|---|
| G1 | Grade up only; skip ranks allowed (logged) | Yes (up-only awaits Gus's yes) | Not stated | Always `order ± 1`; **no skipping** possible | ⚠️ Decide on skipping. ULTM8 can't skip today. |
| G2 | Back-dated grading date; never future; never before current-rank date | Yes (Gus decided) | Not addressed | `dateOfCurrentRank = now()`; no date input | ⚠️ / ➕ Needs a `gradedAt` (effective date) on `PromotionEvent` and an API input. |
| G3 | "Starting classes" when grading | Grader can type a starting number | Resets to zero at every checkpoint | Always 0 | ⚠️ Conflicts with the spec's reset-to-zero wording. Needs a decision. |
| G4 | Missing skills | Per-style switch: soft (acknowledge) **or** hard block | **"the system warns, it does not block"** | Soft only, with acknowledgement flag stored | ⚠️ **Gus's hard-block option contradicts the spec.** Drop it or log a decision that overrides. |
| G5 | Downgrade | Down only, **written reason required**, shown in red | No reason field | No reason stored | ⚠️ Add a `reason`/`note` to `PromotionEvent`. A decision is needed (spec silent). |
| G6 | History notes | System note + user note | Not in spec | Neither | ➕ Same column as G5. |
| G7 | Deleting history entries | Allowed (with confirmation) | "auditable rank history"; only GET exists | No delete | ⚠️ Recommend **void-with-reason, never hard delete** (Gus's own open item 10 leans this way). |
| G8 | Board drag = manual override, logged as ADJUSTMENT | Rewrites class count / date, writes ADJUSTMENT | §2.3 confirms "manual drag-and-drop override" | No `ADJUSTMENT` enum value; no endpoint | ⚠️ Needs a new event type plus an endpoint. Check it doesn't break "no automatic PromotionEvent" (it's coach-initiated, so fine). |
| G9 | Bulk promote (calling order, one date, one note, printable report) | One rank up each | `POST /schools/{id}/ranks/bulk-promote` and `bulk-stripe-award`, each judged individually, **200-student cap** | **Not built**; enum values exist. Stress-test report warns about the 60 requests/min throttle. | ✅ Compatible. Build it. Open item: should bulk also demand the skills acknowledgement? Gus's open item 5 says it currently doesn't. The spec says acknowledgement is "always recorded". Recommend per-student acknowledgement in bulk. |
| G10 | Who can grade | Owner always; instructors per style (mocked) | §8.2: Instructor grades; **Owner/Manager not listed; Branch Staff excluded** | `assertStaffAtSchool` lets **Branch Staff** grade (already flagged [UNRESOLVED] in code and roadmap) | 🐞⚠️ Fix the Branch Staff hole. Decide on Owner grading and per-discipline instructor permissions. |
| G11 | `ranksToggle` respected | n/a | Decision 87: **every** create/modify including promote, downgrade, stripe award and sign-off | **Grading actions do not check it** (only catalog writes do) | 🐞 **Bug against an approved decision.** Fix in Phase 1. |
| G12 | Archived school | n/a | Decision 110 | Grading actions don't call `assertSchoolNotArchived` | 🐞 Fix in Phase 1. |

### 3.4 Grading events, curriculum, settings

| # | Topic | Gus | Spec / decisions | ULTM8 | Verdict |
|---|---|---|---|---|---|
| V1 | **Grading Events** (name, date, venue, participants, Pass/Fail, complete → promote passes one rank) | Built and decided by Gus | **No such entity.** Only "ceremony" wording that justifies bulk endpoints; a mobile "next grading date" seen in designs | None | ➕ **Largest new scope.** Needs new tables, endpoints, RLS and screens. Needs an explicit product decision to add it on top of Spec 55. |
| V2 | Grading fee | Mocked switch | **Absent** | None | ➕ Touches payments (Stripe Connect, Transactions). Do **not** build without a full decision. Defer. |
| V3 | Grading notifications | Mocked | **No grading notification in spec** | None | ➕ Defer; needs a decision (and NotificationsModule push is itself deferred, Decision 95). |
| V4 | Lesson ↔ skill link | Core idea | Decision 58 confirmed | Built (`LessonSkill`) | ✅ |
| V5 | Lesson categories (entity, with order, drag to sort) | Category entity + lesson order | "Belongs to a Category" but no Category entity (a known spec doc-bug) | `category` is a plain string; **no `order`** on Lesson | ⚠️ Decide whether Category becomes a real table and whether lessons are ordered. |
| V6 | Video | Placeholder | Decision 101: Cloudflare Stream + AWS Transcribe | Fields exist, no integration, no credentials | ✅ Same direction; integration is its own project. |
| V7 | "DojoHQ" name | Prototype branding | ULTM8 | ULTM8 | ✅ Build under ULTM8 naming. Confirm with Gus (his open item 1). Nothing to rename in ULTM8. |
| V8 | Instructor's own belt linked to grading | n/a | — | Decision 108: manual dropdown in V1, link deferred to V2 | ✅ Out of scope; keep deferred. |

### 3.5 Student app (Track B)

| Need from Gus's design | Track B today (`master` and `track-b-student-app-pka8oo`) | Gap |
|---|---|---|
| Student sees their rank per discipline | `MyRankSection` shows the belt swatch and "Rank {order} · N stripes" | Needs `Rank.name` (L3); and one `GET /ranks/{id}` per discipline (known waterfall) |
| Progress toward next grade, readiness | Nothing | Needs the eligibility API (E2/E6). Spec §2.2 mobile Ranking screen shows readiness and progress % |
| Skills needed + "watch the lesson" | Nothing | Needs a student-readable skills-for-next-grade endpoint + `GET /skills/{id}/lessons` (exists) |
| Rank history | Nothing | `GET /students/{id}/rank-history` exists |
| Minors (Guardian view) | Guardian/minor flows exist | Read-only rank view for minors per SKILL §14 (limited login reads own rank only) |

---

## 4. Bugs and gaps in ULTM8's **existing** grading code (fix before building on it)

Each of these was verified in the code, not just reported.

| # | Severity | Finding | Where |
|---|---|---|---|
| F1 | High | Promote, downgrade, stripe award and skill sign-off **don't check `School.ranksToggle`**, contrary to Decision 87 ("every RanksModule endpoint that creates or modifies… promote/downgrade/stripe-award, skill sign-off"). | `apps/api/src/ranks/grading.service.ts` (no `assertRanksEnabled`); catalog writes in `ranks.service.ts:42-43` do |
| F2 | High | **Branch Staff can perform grading** (`assertStaffAtSchool` admits Owner/Manager, Branch Staff and Instructor). Spec §8.2 excludes Branch Staff. Already flagged [UNRESOLVED] in the code and `ULTM8-MASTER-ROADMAP.md:227-229`. | `grading.service.ts:90-99` |
| F3 | High | `Rank` has **no `name`** though Spec 55 §6.1 lists "Name". Every screen falls back to "Rank {order}". | `schema.prisma` model `Rank` |
| F4 | Medium | Grading actions don't call `assertSchoolNotArchived` (catalog writes do). | `grading.service.ts` |
| F5 | Medium | `GET /students/{id}/eligibility` returns the **same data** as `/ranks`, with no readiness or progress. The spec says this endpoint "powers the Grading Board". | `grading.service.ts:65-67` |
| F6 | Medium | Attendance credits **every** matching discipline and **ignores `eligibleClassTypes` and the weekly cap**, both confirmed in the spec as governing grading credit. | `attendance.service.ts:219-230` |
| F7 | Medium | Skill-gate meaning (current vs next checkpoint) is ambiguous; the DTO comment says "target checkpoint" but the service checks the **current** one. See L8. | `grading-action.dto.ts:8-9` vs `grading.service.ts:307-323` |
| F8 | Medium | No downgrade e2e test and no test for the 409 concurrent-grading path. | `apps/api/test/ranks.e2e-spec.ts` |
| F9 | Low | `classTypesOffered` on Discipline vs `Class.activities` vs `eligibleClassTypes` are not one controlled list (SKILL §4 [UNRESOLVED]); class type and discipline name are the same string today (Decision 90). | bookings/attendance |
| F10 | Low | Bulk grading will hit the default 60 requests/min throttle if done client-side (stress-test report). | `docs/V1-STRESS-TEST-REPORT.md:172-178` |
| F11 | Low | Student app needs one `GET /ranks/{id}` per discipline (waterfall); no batch endpoint. | `ULTM8-MASTER-ROADMAP.md:321` |

---

## 5. Issues found in Gus's handover itself

- **The notes and code agree on everything I checked.** Section 6 of `HANDOVER.md` matches lines 316–541 of the prototype.
- **Bucket naming:** Gus's labels match Spec §2.3, but Spec §2.2, §12.2 and Decision 75 use *Ready / Almost Ready / Not Ready*. Both his notes and the spec should be told this.
- **"Thresholds are the open item in the ULTM8 spec"** (HANDOVER §6.6) is **out of date**: Decision 75 (2 Sep 2026) settled that they are School-configurable. Only the config schema is still open.
- **"Weekly cap and class scope need the Attendance module"**: in ULTM8, attendance is Bookings marked Completed (no Attendance entity, by confirmed design). The real blocker is the class-type field (E5), not a missing module.
- **"Who can grade"**: Gus's mockup says owners always can; Spec §8.2 names Instructors only. This needs reconciling.
- **The hard-block skills switch** (HANDOVER §6.4) contradicts the spec's "warns, does not block". Gus may not know this.
- The prototype's per-student "one style, one rank" (HANDOVER §5) is already solved in ULTM8 (per-discipline `StudentRank`).

---

## 5a. Answers received from Gus (8 Oct 2026)

Gus confirmed in this session that he is the author of the prototype and the owner of the grading rules.

| Topic | Gus's answer | Effect on this plan |
|---|---|---|
| Whose logic wins for grading (D-B) | **"We will follow Gus logic for grading."** The prototype's grading works the way it should; the aim is to reuse that knowledge, not start from zero or change much. | Gus's rules (HANDOVER §6, prototype lines 316–541) become the reference for grading behaviour. **Still to settle:** CLAUDE.md says logged decisions can't override Spec 55 §§1–11, so each place where Gus's rules contradict the spec (L8, G3, G4 and others in §3) needs Gus's explicit sign-off as product owner, recorded as a decision that amends the spec. See the open question below. |
| What the prototype is | A **standalone** grading system, not connected to attendance. (Its curriculum only links lessons to skills.) | In ULTM8 the class count comes from real attendance (QR check-in marks bookings Completed), not from Gus's manual counter. How the two fit together is an open question. |
| Stripes (L1) | **"Each stripe is a step on the ladder, and a new grade."** | Confirmed: every stripe is its own grading step, with its own requirements, its own grade action and its own history entry. Matches Spec §2.3 "stripe-as-its-own-rung". **Still open:** how this is stored (see below). |
| Is this the ULTM8 grading module (D-A) | Yes. Implement it in our system. | Build inside ULTM8's existing RanksModule and CurriculumModule. |

### Open follow-ups from these answers

1. **Spec override authority.** Confirm that, as product owner, you authorise your grading rules to override Spec 55 where they conflict. Each override is logged as Decision 124 onward and listed for a spec amendment.
2. **Storage of rungs.** Either (A) keep ULTM8's Rank + stripe-tier tables and show them as Gus's flat ladder, or (B) restructure so every rung is its own Rank row exactly like the prototype.
3. **Class count source.** QR attendance counts classes automatically. Should Gus's manual "Log a class" be kept as an extra staff action?

## 6. Decisions needed before building (Phase 0) — with recommendations

Ask as a small number of rounds. Each answer becomes a numbered entry in `docs/decisions/POST-SPEC-55-DECISION-LOG.md` (next number: **124**).

### Round 1 — blocks the data model (ask first)

| # | Question | Recommendation |
|---|---|---|
| D-A | Is Gus's prototype the ULTM8 grading module, built inside `apps/api` RanksModule, under the ULTM8 name? | **Yes.** Spec §2.3 already says so. Confirm with Gus and drop "DojoHQ". |
| D-B | When Gus's rules and Spec 55 disagree, who wins? | **Spec 55, unless a numbered decision overrides it** (CLAUDE.md hierarchy). Use this roadmap's §3 as the list to walk through with Gus. |
| D-C | Requirement direction (L8): do a checkpoint's classes, days and skills describe what's needed **to leave it** (ULTM8 today) or **to enter it** (Gus)? | **"To leave it" (requirements live on the checkpoint you're at)**: it matches the spec text "skills required at the CURRENT checkpoint", the current code and RLS, and it removes Gus's special case for time-only ranks. Translate Gus's ladders by shifting each rung's numbers back one position. |
| D-D | Where does the years-in-rank number live (L6)? | Reuse **`minimumDaysInRank` on the time-only checkpoint**, entered in years in the UI (Gus's approach). No new column. Enforce `yearsInRankFlag` = ignore classes, use days only, skills optional. |
| D-E | Multi-colour stripes on one rung (L4)? | Add an ordered `segments` list to a stripe tier (count + colour each), **or** cut the two kids variants from scope v1. Recommend **cut for now**, standard IBJJF only. |
| D-F | Class type (E5): add a real `Class.classType` (from `Discipline.classTypesOffered`) separate from `activities`? | **Yes.** It is the only way to enforce "which classes count" and the weekly cap properly. Must be designed together with Decision 90's bridge. |
| D-G | Progress and bucket config (E6/E7): what does a School configure? | A per-discipline setting: **formula** = classes-only (Gus's default) or classes+skills weighted; **two thresholds**, default 33/66; **one label set**. Recommend *Not Ready / Almost Ready / Ready* (spec majority) with Gus's labels as display text if he prefers. |

### Round 2 — blocks the grading actions

| # | Question | Recommendation |
|---|---|---|
| D-H | Grade up only, Downgrade down only (Gus's pending yes) | **Yes.** ULTM8 already enforces direction by route. |
| D-I | Allow skipping ranks/stripes in one action (G1)? | **Yes, with the skipped rungs recorded on the event.** Needs a `targetRankId`/`targetStripeTierId` on promote. |
| D-J | Back-dated grading date (G2) | **Yes**, per Gus's decided rule: not future, not before the current-rank date. Add `effectiveDate` to `PromotionEvent`; keep `createdAt` as the audit timestamp. Plus an "edit rank date" correction action (Gus open 6). |
| D-K | Starting classes on promotion (G3) | **No, always 0** (spec). Drop Gus's field. Ask Gus whether it mattered. |
| D-L | Skills hard-block option (G4) | **Drop it.** Spec says warn, never block. |
| D-M | Downgrade reason and user notes (G5/G6) | **Add `reason` (required for downgrade) and `note`** to `PromotionEvent`. |
| D-N | History deletion (G7) | **Void with reason, never delete.** Add `voidedAt/voidedById/voidReason`. |
| D-O | Board drag override (G8) | Keep (spec §2.3 confirms it). Add `ADJUSTMENT` event type recording old and new counter. |
| D-P | Bulk grading: per-student skills acknowledgement and min-days warning (Gus open 5) | **Yes, per student**, inside the bulk request; 200 cap per request (spec). |
| D-Q | Who grades (G10)? | **Instructor + School Owner/Manager; never Branch Staff.** Per-discipline instructor permissions: defer. Downgrade and adjustment: same permission as promotion for v1. |

### Round 3 — scope (can come later; these are add-ons)

| # | Question | Recommendation |
|---|---|---|
| D-R | Grading Events (V1) | **Phase 2 of the rollout**, after the board and bulk ship. Needs its own decision and design (entity, RLS, endpoints). |
| D-S | Grading fee (V2) | **Defer.** Touches payments; needs its own spec. |
| D-T | Grading notifications (V3) | Defer until push dispatch exists (Decision 95). |
| D-U | Lesson categories and order (V5) | A real `LessonCategory` table + `Lesson.order`, or keep the string. Recommend the **table**, since Gus's screens depend on it. |
| D-V | Templates (L11) | Ship **IBJJF only** as a template in v1; others when Gus confirms real numbers. |
| D-W | Rank deletion with student reassignment (Gus open 7) | Defer. Keep "can't delete a rank in use". |
| D-X | Fail rules at events (Gus open 8) | Defer with Grading Events. |

---

## 7. The roadmap

Rules that apply throughout (from `CLAUDE.md`):

- One short-lived branch per slice from latest `master` (`feature/grading-<slice>`), one PR each.
- **Never touch `v1.0.0`** or `release/*`.
- Every user-visible change goes under `## Unreleased` in `CHANGELOG.md`.
- No version numbers are picked by us.
- Every new rule gets a decision-log entry before code.
- RLS and tenant isolation must be preserved.
- `SKILL.md` is edited only by the Architect.

### Phase 0 — Decisions and source alignment (no code)

**Goal:** every ⚠️ and ➕ in §3 that is in scope has a written answer.

1. Send Gus and the product owner Round 1 of §6 (7 questions). Get answers in writing.
2. Log each answer as a numbered decision (124+).
3. Ask the Architect to update `SKILL.md` §5 (bucket labels, requirement direction, years number, class type).
4. Rounds 2 and 3, same process.
5. Store the handover package in the repo as reference (e.g. `deep-review/grading-prototype/`, read-only), so the prototype, harness and screenshots are versioned next to the spec. **Needs your go-ahead (adds ~9 MB).**

**Exit:** decision log updated; no ⚠️ left open for anything in Phases 1–6.

### Phase 1 — Fix the existing foundation (API, Track A)

Branch `feature/grading-foundation`.

1. **F1** add `assertRanksEnabled` and **F4** `assertSchoolNotArchived` to every grading write.
2. **F2** tighten grading writes to Instructor + Owner/Manager (per D-Q).
3. **F3** add `Rank.name` (migration plus backfill such as `"Rank {order}"`; DTOs; api-client regen).
4. Schema additions agreed in Phase 0: `PromotionEvent.effectiveDate/reason/note/voided*`, `ADJUSTMENT` type, optional promote target, `Class.classType` (D-F), progress-config table (D-G), lesson category/order (D-U).
5. **F8** missing tests: downgrade, 409 race, toggle-off, Branch Staff denied, archived school.

**Exit:** `npm test` + API e2e green; RLS tests for every new column and table; CHANGELOG entry.

### Phase 2 — Grading rules engine (port Gus's rules)

Branch `feature/grading-engine`.

1. A **pure TypeScript module** (no Prisma, no Nest) inside `apps/api/src/ranks/engine/`, or a shared `packages/grading-rules` so the portal and app can show the *same* numbers. Recommend the **package**, consumed by `api`, `school-portal` and `student`.
2. Functions:
   - `requirementFor(checkpoint, ladder)` (as decided in D-C)
   - `eligibility(studentRank, ladder, skills, today)`
   - `progress(…, config)`
   - `bucket(pct, config)`
   - `nextCheckpoint` / `flatten(ladder)`
   - `validateGradingDate(…)`
   - day counting in **calendar days in the School's time zone** (Gus's DST-safe approach)
3. **Port Gus's stress-test scenarios as unit tests.** That means his `refReq`/`refEligible`/`refPct` reference rules, the 515-rank sweep, the date suite (leap year, DST, midnight) and the 16 deliberate faults as mutation checks, all adapted to the D-C direction. This is the "acceptance-criteria set" Spec Decision 49 refers to.
4. Translate the IBJJF ladder into ULTM8's Rank + tier shape as a template fixture; prove equivalence against Gus's ladder by test.

**Exit:** engine is 100% covered and every adapted scenario passes.

### Phase 3 — Grading API (Track A)

Branch `feature/grading-api`.

1. `GET /students/{id}/eligibility`: real readiness, progress, missing skills and days short (F5), using the engine.
2. `GET /schools/{id}/grading-board?disciplineId=`: one call that returns the whole board, paginated, staff only. This is new, so it needs a decision note. It avoids one request per student.
3. Promote / stripe-award with optional target (skip), `effectiveDate`, `note`; downgrade with required `reason`.
4. `POST /schools/{id}/ranks/bulk-promote` and `bulk-stripe-award`: 200 cap, per-student result and acknowledgement, one transaction per student, and a throttle sized for it (F10).
5. Board override endpoint (writes `ADJUSTMENT`); void-history endpoint.
6. Attendance credit honours `classType` ∈ checkpoint `eligibleClassTypes` and the weekly cap (F6). Booking gate switches to `classType` too.
7. Rank reorder endpoint (keeps `order` contiguous).
8. Batch rank lookup for the student app (F11).
9. Regenerate `packages/api-client`.

**Exit:** e2e tests for every endpoint, including RLS cross-tenant denial and the Instructor vs Branch Staff split; stress tests for bulk (200 students), concurrent grading of the same student, and a toggle switched off mid-session.

### Phase 4 — School Portal screens (Track A, post-V1 → planned v1.x)

One PR per screen, built fresh in the portal's own stack and design system. Gus's screenshots are **flow references**, not designs to copy.

1. **Ladder editor upgrade:** rank names, reorder, stripe-tier editor, time-only switch (years), required skills, class types per tier.
2. **Student grading panel:** current belt per discipline, progress rows, skills for the next grade with sign-off and "Watch" lesson links, rank history with notes/void, Grade and Downgrade modals with the date rules and skill acknowledgement.
3. **Grading Board:** three buckets from the School's config, search, active only, tick and bulk promote with calling order, printable report, drag override with confirmation.
4. **Grading settings:** per-discipline progress formula and thresholds (D-G).
5. **Curriculum:** categories and order (if D-U), skill → lesson links surfaced on the student panel.

**Exit:** each screen covered by Playwright e2e in Chromium, Firefox and WebKit, at desktop and tablet widths, and keyboard-only (Gus's untested areas); translations for all 4 languages including Arabic RTL; CHANGELOG entries.

### Phase 5 — Student app (Track B)

On the Track B line (`track-b-student-app-pka8oo` / its successor), separate from Track A versioning.

1. "My Rank" shows the rank **name** and stripes (needs Phase 1 F3) using the batch lookup.
2. Progress toward next grade and readiness bucket (spec §2.2 mobile Ranking screen).
3. Skills needed for the next grade, with lesson links (curriculum).
4. Rank history (read-only).
5. Guardian view of a minor's rank; limited-login minors read only their own (SKILL §14).

**Exit:** RN tests; iOS and Android smoke; RTL check.

### Phase 6 — Grading Events (only if D-R approves)

New `GradingEvent` + `GradingEventParticipant` tables with RLS, endpoints, portal screens, and (optionally) a student "next grading" display. Completion promotes each Pass by one checkpoint through the same engine and bulk path. Fee and notifications stay out unless D-S/D-T say otherwise.

### Phase 7 — Hardening and acceptance

1. Re-run Gus's scenario suite against the **real API** (not the prototype) as an acceptance pass.
2. A "V1 stress-test" style round on grading, matching the existing `docs/V1-STRESS-TEST-REPORT*.md` format: races, tenant isolation, throttles, large ladders (175 checkpoints), 3,000-student board performance.
3. Security review of new endpoints (`/security-review`).
4. Independent reviewer pass against the decisions log.

### Phase 8 — Release

1. CHANGELOG Unreleased is complete.
2. The product owner assigns the version (e.g. a v1.x for Track A; Track B is versioned separately).
3. Tag only with explicit go-ahead.

### Rough sizing (for planning, not a commitment)

| Phase | Size |
|---|---|
| 0 Decisions | depends on availability of Gus and the product owner; 3 rounds |
| 1 Foundation | small–medium (1 PR) |
| 2 Engine | medium (1 PR, test-heavy) |
| 3 API | large (2–3 PRs) |
| 4 Portal | large (4–5 PRs) |
| 5 Student app | medium (2–3 PRs) |
| 6 Events | medium–large (optional) |
| 7 Hardening | medium |

---

## 8. Risks and how the plan handles them

| Risk | Mitigation |
|---|---|
| Building Gus's rules where they contradict the spec (L8, G4, G3) | Phase 0 before any code; decision log entries |
| Requirement-direction mistake (Gus's B1 again) | One engine in a shared package; Gus's scenarios as unit tests; portal and app use the same engine |
| Breaking the rank-gated booking when `classType` arrives | Migration backfills `classType` from today's `activities` match; booking e2e tests stay green |
| Tenant leakage via new board and bulk endpoints | Same narrow RLS shape (Decision 88); cross-tenant e2e on each |
| Touching V1 | All work on `master` feature branches; `v1.0.0` never moves |
| Scope creep (events, fee, notifications, video) | Explicitly phased and gated on separate decisions |

## 9. What not to do

- Don't copy prototype HTML or JS into the portal (Spec §2.3, HANDOVER §5).
- Don't hard-code 33/66 as platform rules (Decision 75).
- Don't add a hard skills block (spec: warns, never blocks).
- Don't allow hard deletion of `PromotionEvent`.
- Don't let Branch Staff grade.
- Don't build the fee, notifications or events without their own decisions.

---

## 10. Decisions 124–157 applied to the plan (9 Oct 2026)

Gus answered the merge questions as product owner. Each answer is a numbered entry in `docs/decisions/POST-SPEC-55-DECISION-LOG.md`. Where this section and the earlier sections of this file disagree, **this section wins**.

### What changes in the plan

| Area | Decision | Change to the roadmap |
|---|---|---|
| Source of truth | 124, 125 | Gus's prototype rules override Spec 55 for grading, one decision per conflict. Gus approves everything. CLAUDE.md updated. |
| Storage | 126 | Keep Rank + RankStripeTier. Move required skills, weekly cap and time-only to **each rung**. Add rung name, stripe colour segments, and tag/coral drawing fields. |
| Requirement direction | 127 | A rung's requirements = what it takes to get **into** it (prototype `gradingRequirement`). The current skill check and sign-off in `grading.service.ts` must change. |
| Prototype rules | 128 | Skip rungs, back-date, starting classes, per-style skills hard-block switch, downgrade reason, notes, board ADJUSTMENT, Log a class, Pass promotes one rung, lesson categories with order, sign-offs wiped. |
| History | 129 | Void with a reason, never delete. |
| Bulk and events | 130 | Per-student acknowledgement in one quick "Needs a look" step; 200 cap. |
| Templates | 131 | Three IBJJF ladders only. |
| Guardians | 132 | Guardians can read their child's rank, progress, skills and history. |
| Membership | 133, 136, 152 | No direct rule. "Currently attending" comes from an active membership, with a manual override. |
| Board | 136 | 33% / 66% by default, editable per school. Prototype column names. |
| Starting ranks | 137, 147 | Students self-declare their rank at signup; it stays unverified until grading staff verify or correct it; unverified ranks can still book; staff get a notice; plain White Belt is verified automatically. |
| Permissions | 138 | Owner always; others per discipline as granted. Replaces `assertStaffAtSchool` for grading. |
| Branches | 139, 148 | One home branch per student, chosen at join (owner assigns existing students). Branch staff grade their own branch. One ladder per school. Classes at other branches count if bookable. |
| Class counting | 140, 143, 149 | Classes get a **class type**. Each rung ticks which types count: any ticked type (one total), or each type with its own number. Weekly cap per rung. |
| Disciplines | 152 | Classes, timetable and instructors pick from the school's discipline list (replaces Decision 90's string match). |
| Deletion | 134, 141 | Grading data goes with the account (Spec Decision 44). A deleted instructor shows as "Former instructor". `PromotionEvent.performedById` can no longer be RESTRICT. |
| Notifications | 145 | v1.1: "ready to grade" to grading staff; "you've been promoted" to the student or guardian. |
| Names | 146 | Typed once by the school, not translated. |
| Events | **150** | **Grading events move into v1.1** (previously Phase 6, optional). |
| Fee | 144, **150** | v1.1: fee switch plus fee amount; the school charges its own students. How it is collected is still open. |
| Franchise ladders | 151 | Shared ladder behind an on/off switch. Design and release still open. |
| Rank date fix | 153 | "Edit rank date" correction action. |
| Lessons | 154 | Only students and guardians with a paid membership for that activity. Video pricing later. |
| Student app | 142, 155 | Next release: rank by name, progress, skills needed, history (read-only). Lessons once video exists. |
| Audit | 156 | Skill sign-off log. |
| Reference | 157 | Handover package stored at `deep-review/grading-prototype/`. |

### Revised v1.1 scope (Track A)

Phase 1 (foundation and schema) → Phase 2 (rules engine with Gus's scenarios as tests) → Phase 3 (API) → Phase 4 (portal screens), now including **grading events, the fee setting, self-declared rank verification, class types and branch scoping**. Track B follows in the app's next release (Decisions 142, 155).

### Still open before building the affected parts

1. Fee: does v1.1 collect the money, or only record the amount? Is it set per school, per discipline or per event? (Decision 150)
2. Franchise ladders: who controls the switch, can schools edit a shared ladder, what happens to students when it changes, and which release. (Decision 151)
3. Students seeing "Ready to Grade": always shown, or a school setting? (Decision 155)

## 11. Changes after §10 (Decisions 158–161, 9 Oct 2026)

These supersede §10 where they differ.

- **Grading events move to Version 2** (Decision 158). v1.1 no longer includes events. It keeps the board, single grading, bulk promote, self-declared rank verification, class types, branch scoping, the fee setting and the two notifications.
- **Fees** (Decision 159): ULTM8 takes nothing; the school collects. The school picks how the fee is set: per rung or per style in v1.1, and per event from Version 2. Still open: whether collection runs through the school's payment account inside ULTM8 or outside it.
- **Franchise-wide ladders** (Decision 160): franchise owner's switch, edited at franchise level only, after v1.1, with its own tenancy design.
- **Students always see their full progression** (Decision 161).

## 12. Final v1.1 scope (Decisions 124–163, 9 Oct 2026)

All 50 merge questions are answered. This section supersedes §10 and §11 where they differ.

**v1.1 (Track A: API and school portal)**
- Ladder: rung names, colour segments, per-rung skills, weekly cap and time-only, drag reorder with confirmation; create a style from the IBJJF templates (3), **build from scratch** (empty, or starting from a template), or duplicate a style with its skills (Decision 131 and the prototype's "Create a Style" panel).
- Rules engine: Gus's `gradingRequirement` / eligibility / progress, with his stress-test scenarios as tests.
- Grading Board: 33% / 66% (editable per school), "currently attending" from membership, branch scoping.
- Grading: single grade (skip, back-date, starting classes, skills warning or per-style block), downgrade with reason, void history, edit rank date, bulk promote with the quick acknowledgement step.
- Attendance: class types on classes, "which classes count" (any type, or a number per type), weekly cap, disciplines picked from the school's list.
- Students: self-declared rank at signup with verification (auto for plain White Belt), home branch, guardians can read.
- Permissions: owner always; others per discipline as granted.
- Notifications: "ready to grade" and "you've been promoted".
- Audit: skill sign-off log; deleted instructor shows as "Former instructor".
- Grading fee: set up by the school as a one-off Grading Day class plus a 1-credit pass (existing features; no new payment code).

**Track B (app), its next release:** rank by name, full progression, skills needed, history (read-only), for students and guardians.

**Version 2:** grading events as a full module, linked to their passes; per-event fee choice. **Later:** franchise-wide ladders, lessons in the app once video exists, video pricing.
