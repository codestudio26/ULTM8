# Changelog

Version numbers are assigned by the product owner as work accumulates — see
`CLAUDE.md` → "Versioning". Every user-visible change goes under **Unreleased**
until the product owner declares a version.

Compare any two versions with `git diff <old> <new>`, e.g. `git diff v1.0.0 master`.

## Unreleased

**Planned: v1.1.0** — the website front-end page redesigns and new features now
under way. This is a plan, not a release: the product owner decides which
pages complete v1.1, and only then is this heading renamed and `v1.1.0` tagged.

Post-V1 work on `master`. Track A (`apps/school-portal`, `apps/platform-admin`,
`apps/api`) only — Track B (`apps/student`) is versioned separately.

- **api-client — regenerated for `POST /auth/refresh` and `POST /auth/logout`**
  (added in #101 without a client regeneration), including the `refreshToken`
  now returned on sign-in. No code change.
- **api — grading engine (roadmap Phase 2a; Decisions 127, 136, 149, 171).**
  Gus's grading rules as pure functions in `apps/api/src/ranks/engine/`: the
  flat ladder of rungs, what the next rung requires, which classes count
  (ticked types, Monday–Sunday weekly cap), eligibility, progress % and the
  board columns, and the back-dated grading-date check. Checked against the
  prototype's own QA reference rules on every rung of an IBJJF-style ladder.
  Not wired in yet, so nothing changes for users until Phases 2b and 2c.
- **api + school-portal — instructor specialisations picked from the School's
  styles** (Decision 152, item 1): in a School with styles, an instructor's
  specialisations are chosen from its styles (`specializationStyleIds`). Free
  text is refused there, and the names are filled in for display. A School
  with no styles keeps free text. Specialisations stay optional. Existing
  instructors were mapped once wherever a specialisation named exactly one
  style. The portal's instructor form shows a checkbox per style.
  `packages/api-client` regenerated.
- **api — grading foundation, PR 6: self-declared ranks** (Decisions 137,
  147):
  - **Declaring:** a student (or their guardian, for a minor) declares the
    rung they hold in a style when joining
    (`POST /students/{id}/ranks/{styleId}/declare`). It is stored as
    unverified and goes on their history. The style's first rung (plain White
    Belt, no stripes) is verified automatically.
  - **Verifying:** staff with grading permission for that style and the
    student's branch verify it, or correct it to the right rung
    (`POST …/verify`). A correction goes on the history with who, from what,
    to what and when.
  - **Pending list:** the owner sees ranks waiting to be verified
    (`GET /schools/{id}/rank-verifications`). Permitted coaches get their
    branches' list with the Grading Board (Phase 3).
  - **Booking:** an unverified rank still counts for booking, as before.
  - `packages/api-client` regenerated.
- **api + school-portal — grading foundation, PR 5: styles and class types
  on classes, and how classes count toward a rung** (Decisions 140, 143, 149,
  152, 170):
  - **Classes and timetable slots** list one or more styles, each with a class
    type from that style's list. A mixed class (e.g. an Open Mat for BJJ and
    Judo) lists several. Styles are required when the School has any; a School
    with none keeps free-text activities. Generated classes copy their slot's
    styles.
  - **School portal:** the class and timetable forms pick styles and class
    types instead of free text, when the School has styles.
  - **Each rung** records how classes count: any ticked type toward one total
    (the default), or a number for each ticked type (e.g. 20 Fundamentals + 10
    Sparring).
  - **Existing classes** were mapped once from their free text wherever it
    named exactly one style.
  - **Unchanged until the grading engine (Phase 2):** the booking rank check and
    attendance credit still read the free-text list, which is now filled in
    from the chosen styles.
  - `packages/api-client` regenerated.
- **api — grading foundation, PR 4: grading permission per style, and
  branches** (Decisions 138, 139, 148, 168):
  - **Who can grade:** the School owner always can. Anyone else (Instructor
    or Branch Staff) can only grade in the styles the owner grants
    (`GET /schools/{id}/grading-permissions`, `PUT
    /schools/{id}/grading-permissions/{userId}`). Before, every staff member
    could grade everything. This covers grading, downgrade, stripe award,
    skill sign-off, void and edit rank date.
  - **Branches:** each student has a home branch. In a School with branches,
    joining (`POST /schools/{id}/join`) now requires a `branchId`. The owner
    assigns or changes a home branch with `PUT
    /schools/{id}/students/{studentId}/home-branch`.
  - **Coverage:** staff see and grade only students whose home branch is one
    of their branches. Coaches can be assigned to several branches. Students
    with no home branch are visible to the owner only. A School with no
    branches counts as one branch.
  - **Viewing:** staff without grading permission can still view their
    branches' students' grading.
  - **Adding an instructor** (Decision 169): in a School with branches, the
    instructor must be assigned to a branch (`POST /users/{id}/role-grants`
    refuses without one). An instructor who teaches at several branches gets
    one assignment per branch. In a School with no branches, the instructor
    belongs to the School. The school portal's Staff page now asks for the
    branch for instructors too.
  - `packages/api-client` regenerated.
- **api — grading foundation, PR 3: history fields, void, edit rank date and the
  sign-off log** (Decisions 128, 129, 141, 153, 156, 166):
  - **History entries** gain:
    - a grading date (`effectiveDate`, which can differ from when the entry was written);
    - a downgrade reason, a system note and the grader's own note;
    - the rungs skipped and the "starting classes" (stored now, set by the grading engine later);
    - void details.
  - **Downgrade now needs a written reason**; a missing or blank reason gets a 400.
  - **Void an entry** (`POST /students/{id}/rank-history/{eventId}/void`, staff, with a reason): it is hidden from the normal history, kept with who, when and why, and the student's rank doesn't change. Staff can still see voided entries with `includeVoided=true`.
  - **Edit rank date** (`PATCH /students/{id}/ranks/{disciplineId}/rank-date`, staff): corrects the date a student reached their current rung. The date can't be in the future or before their previous grading (Decision 166). It also corrects that grading's entry and adds an `ADJUSTMENT` note with the old and new dates.
  - **Skill sign-off log**: every sign-off change is logged with who, when, and the old and new status. The log is kept when a grading resets the sign-offs.
  - **A stripe award restarts the time-in-rank clock** (Decision 167): every stripe is its own rung, so its minimum days count from the stripe, not from the belt grading.
  - **Former instructor**: deleting a grader's account no longer fails; their history entries and log rows stay, and "graded by" becomes empty (shown as "Former instructor").
  - `packages/api-client` regenerated.
- **api — a rung's colour follows its stripes** (Decision 165): a rung's
  stripe list is now the only place its stripe colours are set. Its single
  colour is filled in from the first stripe, the newest colour, which is the
  one the rung is named after ("1 Yellow Stripe" = 1 yellow + 3 red, so
  yellow), so the two can never disagree. Changing only the colour repaints a
  one-colour rung. On a rung with mixed stripes it is refused with a clear
  message, because the stripes must be changed in the list. A data migration
  brings existing rungs into line. `packages/api-client` regenerated
  (descriptions only).
- **api — grading foundation, PR 2: every rung of a ladder carries its own
  settings** (Decisions 126, 128, 164): belts get a name (Spec 55 §6.1) and
  drawing fields (tag colour, coral accent). Each rung (stripe tier) gets a
  name, mixed stripe colours (e.g. 3 yellow + 1 red), its own weekly class cap,
  a "time in rank only" switch, and its own required skills. Missing names are
  generated ("Blue Belt · 2 Stripes"). A migration fills in existing data and
  moves each belt's required skills to the first rung of the next belt
  (Decision 164). Nothing is removed: the belt-level cap, years flag and skills
  stay until the grading engine switches over. `packages/api-client`
  regenerated. **Fixes found on independent review:** editing a belt in the
  school portal no longer wipes a rung's custom name, mixed stripe colours or
  "time in rank only" setting. Fields left out of an edit are kept, and
  renaming a belt also renames the rung names that were generated from it.
  `null`, empty names and duplicate skills on a rung now get a clear 400
  instead of a server error. The migration reports any belt skills it could
  not move.
- **api — grading foundation, PR 1: grading writes respect the ranks switch and
  closed Schools; Guardians can read their child's grading** (Decisions 87, 110,
  132; grading plan in `docs/grading-integration/`): promote, downgrade,
  stripe-award and skill sign-off now refuse (403) when the School has ranks
  switched off (`School.ranksToggle`) or has been closed. Before, only catalog
  edits checked these. Grading reads stay available. An active Guardian can
  now read a linked minor's ranks, eligibility and rank history (read-only);
  before, Guardians were refused. Adds tests for both gates, downgrade, two
  coaches grading the same student at once, and the Guardian read and refusal
  paths. **Security fix found on independent review:** grading reads (ranks,
  eligibility, rank history) now require a valid `schoolId`. Before, a staff
  member who left it out could read a Student's grading from every School
  (pre-existing since Phase 10b). An impersonation session scoped to one School
  is now refused at another.
- **api — decouple auth/booking rate limiting from raw IP** (PR #88, `db9571c`,
  Decision 12/17): `/auth/login`, `/auth/otp/*`, `/auth/forgot-password`, and
  `/auth/reset-password` now throttle per-identity (email/phone) in addition
  to a loosened per-IP backstop, so one caller's bad attempts on a shared IP
  (office wifi, a school's front-desk device) no longer lock out every other
  caller behind it. Class booking, booking cancellation, and waitlist-claim
  gained a per-user throttle they previously had none at all. Fixes Round 1
  stress-test Weakness #1/#2 (`docs/V1-STRESS-TEST-REPORT.md`).
- **api — auto-refund a Membership purchase that loses the one-active-membership
  race** (PR #88, `db9571c`): the Stripe webhook processor's Membership-purchase
  collision (two concurrent purchases racing the
  `Membership_one_active_general_access_per_school` unique constraint) now
  automatically cancels the losing purchase's Subscription (if any) and
  refunds its PaymentIntent via the Stripe Refund API, then marks the
  Transaction `REFUNDED` — closing a previously-documented-but-unbuilt TODO in
  `handlePaymentIntentSucceeded`.
- **api — close two concurrent-write races found by V1 stress-test Round 3**
  (PR #93, `35ffadf`, `docs/V1-STRESS-TEST-REPORT-ROUND3.md`): `TenantLifecycleService`'s
  `closeSchool()`/`closeFranchise()`/`reactivateSchool()`/
  `reactivateFranchise()` and `SubscriptionPlansService.subscribe()` each had a
  check-then-act TOCTOU window (a plain read, then a separate unconditional
  write) — up to 4 concurrent close() calls for the same School all succeeded
  with duplicate audit rows, and two concurrent subscribe() calls could both
  create a real Stripe Subscription, silently orphaning the loser's with no
  way to ever cancel it. Both now use a conditional `updateMany()` re-checked
  at write time; `subscribe()`'s loser additionally has its Stripe Subscription
  explicitly cancelled rather than orphaned.
- **school-portal — Instructors page redesign** (PR #78, `af0ef5d`): table now
  shows Image (photo or initials avatar), Instructor, Specializations, Scope,
  Login/Status (placeholder "—", no backend field yet), Phone Number, Actions.
  Id/Ranking/Years-exp columns removed from the list view (still editable via
  the Edit modal).
- **school-portal — new app-shell header** on every page (PR #78, `af0ef5d`):
  notifications bell with unread indicator, profile avatar/name, language
  preference (persisted only — no translation runtime yet), and a disabled
  "Search (coming soon)" placeholder (no search backend exists).
- **docs — redesign backend backlog** (`docs/v1.2-backend-backlog.md`, PR #78):
  running list of placeholders on redesigned pages that need backend support.

## v1.0.0 — 2026-09-25 — Track A baseline (frozen)

Tag `v1.0.0` → commit `11da406`. This tag sits beside `master`, not on it.

**In scope:** Track A only — `apps/api`, `apps/school-portal`,
`apps/platform-admin`, shared `packages/*`, `infra/`. 57 backend/UI phases plus
PR #78's V1 work: name resolution for Bookings/Waitlist/RoleGrants/Transactions/
Instructors (closing an RLS visibility gap), Instructor eligible-user picker,
StaffPage invite lookup, Student roster page, the approved auth-flow designs
(login, register, OTP, passcode reset), and the remaining mockup ports
(Decisions 114–121).

**Not in V1:** Track B / `apps/student`. A partial copy is present in the
snapshot only because PR #81 synced it to `master`; it is not frozen.

**Known gaps and deferred items at V1** (none block V1; all tracked in
`docs/ULTM8-MASTER-ROADMAP.md` / the decision log):

- `MobileAppPublishingModule` + `packages/build-pipeline` — not built; blocked
  on the Apple 4.2.6/4.3 compliance question. `SubscriptionPlansModule`'s
  `whiteLabelApp` entitlement is deferred for the same reason.
- `Waiver` retention period under tenant offboarding — pending legal input
  (Decision 110).
- Decision 109 (Transaction Student-name resolution) — awaiting Architect
  confirmation.
- GDPR/LGPD per-user erasure and data residency — not yet a decision-log entry.
- Open follow-ups on Decisions 86, 92, 94, 97–99.
- Guardian-facing UI — Track B's scope, not Track A's.
- Social/OAuth login — confirmed V2 scope (Decision 121); V1 is passcode-only.

**Verification:** backend (`apps/api`, `packages/api-client`, `infra`) is
identical to `master` at `159dad2`, whose CI run passed (build + unit tests and
the cross-tenant isolation gate). Build and unit tests were also run directly
on `11da406`: build passed, 17/17 unit tests passed.
