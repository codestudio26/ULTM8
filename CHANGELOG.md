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

- **Instructors choose their own belt; the owner verifies it** (Decisions 108,
  188). Instructors get a **My belts** page in the School Portal where they
  choose their belt and stripe in each of the School's styles; it shows "Not
  verified" until the owner verifies it, and choosing another belt makes it
  unverified again. The owner's Instructors page gains **Instructors' belts**:
  verify each, or correct it to the right belt (saving verifies it), and see who
  hasn't chosen yet. **api:** `InstructorBelt` (migration `20261028000000`),
  one per instructor per style, with RLS: the owner manages all; an instructor
  reads theirs and writes their own only as unverified while they hold an
  active Instructor role. Endpoints `GET|PUT /schools/{id}/instructor-belts/me`,
  `GET /schools/{id}/instructor-belts` and
  `POST /schools/{id}/instructor-belts/{userId}/{disciplineId}/verify`.
- **Staff given a role again start fresh** (Decision 193). Removing someone's
  last Instructor or Branch Staff role at a School now clears their grading
  permissions there, and removing their Branch Staff role clears "Can invite
  coaches", so if they're added again later the owner grants what applies now.
  Losing one branch while they still coach at another keeps their grading
  permissions. The board's "inactive hidden" count already includes students on
  the top stripe (Decision 194); a test now pins it.
- **Grading hardening, performance** (Phase 7 stress round). The Grading
  Board for coaches and staff loads in one query instead of one per student:
  a coach with 769 students went from 7.4 s to 0.1 s, and a coach at a
  3,000-student School without branches from 30 s to 0.2 s; the owner's
  board is also faster (0.76 s to 0.52 s). Bulk promote checks the caller and
  loads the ladder once per batch: 200 students in 5.9 s (owner) and 7.7 s
  (coach), from 13.3 s and 20.1 s. Same students, same rules: **api:**
  `grading_board_rows()` returns, for the calling staff member only, the
  students they may see (their branches' students, or every enrolled student
  at a School without branches; Decisions 168, 169, 177), approved by the
  product owner (migration `20261027000000`).
- **Grading hardening, security** (Phase 7 security review). A coach invite
  is checked again when accepted: it no longer works once the person who sent
  it may no longer invite there (their "Can invite coaches" turned off or
  their Branch Staff role removed — those also cancel their open invites) or
  once the School is closed; the link page then shows it as cancelled.
  Cancelling an invite while it's being accepted is a clean 409, not a 500.
  Sending invites is limited to 20 an hour per account. Database rules
  narrowed: a student can read but no longer change their own home branch
  (the owner assigns it, Decision 148); a sent invite's email, branch and
  token can't be changed, only its outcome; coaches at a School without
  branches see current students only (migration `20261026000000`).
- **Grading hardening, correctness** (Phase 7; Decision 185). From the
  hardening round: a promote or downgrade with no target now moves one rung
  (was a whole belt); a downgrade no longer notifies the student; grading
  requests can carry the rung the grader saw and are refused (409) if the
  student moved since, which the portal always sends and bulk promote uses,
  so two coaches can't award the same stripe twice and a batch can't undo a
  downgrade made meanwhile; only the School's own students can be graded
  (404 otherwise); rank history is newest first by grading date; the board's
  "N inactive hidden" ignores the search; belt reorders and edits at the same
  time no longer deadlock (409 instead of 500 if they clash); bad ids and
  starting classes over 10,000 are a 400. `packages/api-client` regenerated.
- **Coach dashboard on the web portal** (Decision 184). A coach who signs in
  lands on **Coach dashboard**: the styles they grade in, with how many
  students are ready to grade or getting there; their weekly classes and
  upcoming classes; their latest notifications; and, if they also train
  there, their own ranks and progress. Their menu is Dashboard, Grading
  Board and Notifications, and the header shows "Coach". The **Grading
  Board** and **student panel** now work for coaches: only the styles they
  grade in, and only the actions their grading permission allows. After
  accepting an invite, **Go to your coach dashboard** takes them there.
  **api:** `GET /schools/{id}/grading-permissions/me`. `packages/api-client`
  regenerated. The mobile app's coach screens follow separately.
- **Coach invites** (Decision 183). On the Staff page, **Invite a coach**
  emails one person a link to coach at the School (choosing the branch when it
  has branches). The link works once, for 7 days, and can be cancelled; the
  page lists each invite as Waiting, Accepted, Cancelled or Expired. Opening
  the link asks the person to log in, or create their account, with the
  invited email, then **Accept invite** makes them a coach; a student keeps
  their student account. **Who can invite coaches**: the owner ticks which
  Branch Staff may also invite, for their own branches (coaches can't, per
  Spec 55 §8.2). Email only for now. **api:** `CoachInvite` and
  `StaffPermission` (migration `20261025000000`, with RLS: the owner, staff
  with the permission for their branches, and the link holder for its own
  invite; only the token's SHA-256 is stored);
  `POST/GET /schools/{id}/coach-invites`, `POST /coach-invites/{id}/cancel`,
  `GET /coach-invite-links/{token}` (no sign-in needed),
  `POST /coach-invite-links/{token}/accept`,
  `GET /schools/{id}/staff-permissions`,
  `PUT /schools/{id}/staff-permissions/{userId}`. New setting
  `PORTAL_BASE_URL` for the link. `packages/api-client` regenerated.
- **Style templates and Duplicate** (Decisions 131, 182). On the Disciplines
  page, **Start from template** creates a style from one of the three IBJJF
  ladders (White Stripes, 90 rungs; White & Red Stripes, 139; Yellow Stripes,
  175) with the prototype's numbers and class types, ready to edit.
  **Duplicate** copies a style's belts, rungs and their rules, skills, class
  types, "skills required" switch and board %, as "… (Copy)"; no students,
  ranks or coach permissions. Owner only. **api:** `GET /style-templates`,
  `POST /schools/{id}/disciplines/from-template`,
  `POST /disciplines/{id}/duplicate`. `packages/api-client` regenerated.
- **Branch Staff use the coach screens** (Decision 186). Branch Staff land on
  the coach dashboard and use the Grading Board and student panel for the
  styles the owner lets them grade; with "Can invite coaches" they also get
  **Invite coaches**, for their own branches only. **api:**
  `GET /schools/{id}/staff-permissions/me`. `packages/api-client`
  regenerated.
- **Grading Board columns per style** (Decisions 75, 136, 181). Each style
  keeps its own split, 33% / 66% by default. On the Grading Board, **Change %**
  sets "Getting There" and "Ready to Grade" (whole %, 1–99, Getting There
  below Ready to Grade), and each column shows its range. The board, a
  student's readiness and moving a student to a column all use the style's
  own %. **api:** `Discipline.boardGettingThere` / `boardReadyToGrade`
  (migration `20261024000000`, with a database check) and
  `PUT /disciplines/{id}/board-thresholds`, for the owner or a coach with
  "Change board %" for the style. `packages/api-client` regenerated.
- **Grading permissions: seven toggles per coach per style** (Decision 181).
  New **Grading Permissions** page in the School Portal: for each Instructor
  and Branch Staff member, the styles they may grade in and, per style,
  Promote, Move down, Sign off skills, Adjust progress, Verify ranks, Void
  history and Change board %. **api:** `GradingPermission` gains the seven
  toggles (all on by default; migration `20261023000000`); every grading
  action now checks its own toggle and says which one is missing;
  `PUT /schools/{id}/grading-permissions/{userId}` takes `styles` with toggles
  (the older `disciplineIds` still works, all toggles on); the list includes
  the school's staff. "Ready to grade" goes to coaches who may promote.
  `packages/api-client` regenerated.
- **school-portal — ladder editor** (roadmap Phase 4, item 1; Decisions 127,
  128, 149, 152, 165, 173, 180). A style's Ranks table is replaced by a
  **Ladder**: belts in order with their rungs and requirements, reordered with
  ↑/↓ and saved after a confirmation that names the students affected. The
  new belt editor sets the rank name and colours (base, two-tone, tag) and,
  per rung: its name, its stripes (mixed colours allowed), "time in rank only"
  with the years, or classes and minimum days to be promoted into it, which
  class types count (any ticked type, or a number for each), the weekly cap,
  required skills and which class types it unlocks for booking. Rungs reorder
  within their belt and keep their students; a rung someone holds can't be
  removed. The prototype's labels are kept. **ui:** a dialog taller than the
  screen now scrolls instead of cutting off its bottom (and its Save button).
- **api — ladder reordering and safe rung edits** (Decisions 152, 180).
  `PATCH /ranks/{id}` accepts each rung's `id` in `stripeTiers`, so stripes can
  be reordered within their belt and keep their students. A rung that students
  hold can no longer be removed (409, naming the students); before, removing
  one left them with no rung. New `PUT /styles/{id}/ranks/order` reorders a
  style's belts, and `GET /styles/{id}/rung-holders` (owner only) lists who
  holds each rung, for the editor's confirmations. `packages/api-client`
  regenerated.
- **school-portal — Grading Board** (roadmap Phase 4, item 3; Decisions 128,
  130, 136, 152, 176). New **Grading Board** page: pick a style and see every
  student with a next rank in three columns (Just Starting / Getting There /
  Ready to Grade, at 33% / 66%), with their belt, progress and flags (skills
  not signed off, days short, inactive, not verified). Search; "currently
  attending only" with the number hidden. Move a student to another column
  by dragging the card or with its Move button, after a confirmation (it
  rewrites their progress and is recorded). Tick students (or a whole
  column) and **Promote selected**: set the calling order by dragging or
  with Up/Down, one date and one note; the API checks the batch first and
  the window shows "Needs a look" students with the reason, promoted only
  with one acknowledgement tick, and skips those who can't be promoted;
  afterwards a **printable report** lists the promotions in calling order.
  Students blocked by the style's "skills required" switch can't be ticked.
  The student panel gains **Log a class (+1)** and the per-style "Grading
  Board" attending switch (follow membership, or Active/Inactive by hand).
- **school-portal — student grading panel** (roadmap Phase 4, item 2;
  Decision 179). Open a student from the Students list to see, for each
  style: their rank (with a belt picture) and since when, whether it's
  self-declared; progress toward the next rank (classes, per class type where
  the rank counts each type, time at the rank, skills); the skills for the
  next rank with Not started → Learning → Signed off and linked lessons; and
  the rank history with notes, reasons and voided entries on request.
  Actions: Grade (any higher rank, a back-dated date, starting classes, the
  skills acknowledgement or block; the next stripe is recorded as a stripe
  award), Give first rank, Move down (with a reason), Correct date, Verify a
  self-declared rank (or correct it), and Void a history entry. English only
  for now. First browser tests for the portal (Playwright, `npm run e2e` in
  `apps/school-portal`), run in Chromium at desktop and tablet widths and
  keyboard-only. API docs: the rank-history `cursor` and `limit` are marked
  optional; `packages/api-client` regenerated.
- **api — "ready to grade" notification** (Decisions 145, 178). The School
  owner and the coaches with grading permission for the style who cover the
  student's branch are told, in-app and by email, when a student meets
  everything for their next rung (classes, minimum days, required skills).
  Checked right after grading actions and check-ins, and in a daily sweep; sent
  once per rank (`StudentRank.readyNotifiedAt`, cleared on every rank change).
  **"You've been promoted" now goes to a minor's guardians** instead of the
  minor's own profile, which has no login. Security: the background-job role
  can now read grading data and guardian links (read-only; its only write is
  `readyNotifiedAt`), in `20261022000000_grading_ready_notification`.
- **api — grading Phase 3c: bulk promote** (Decision 130).
  `POST /schools/{id}/grading/bulk-promote` moves up to 200 students one rung
  each on one date, with an optional note. `dryRun` returns three lists for the
  confirm window: ready; "Needs a look" (skills not signed off, or minimum
  days not yet served, with the reason); and can't be promoted (no next rank,
  blocked by the style's "skills required" switch, or not the coach's
  student). Flagged students go ahead only when acknowledged with one tick
  (`acknowledgedStudentIds`); the acknowledgement is recorded on each history
  entry (BULK_PROMOTION / BULK_STRIPE_AWARD). One date must suit every
  student. Each student is promoted in their own transaction and notified.
  Rate-limited to 30 requests a minute. `packages/api-client` regenerated.
- **api — database connections closed on shutdown.** The five Prisma
  services now disconnect when the app shuts down (`onModuleDestroy`), so a
  restarted process or a test run that starts the app many times no longer
  leaves connection pools open. The full e2e run had reached Postgres's
  100-connection limit; it now peaks at about 27.
- **api — grading Phase 3b: Grading Board** (Decisions 128, 136, 152, 168,
  174, 176, 177). `GET /schools/{id}/grading-board?disciplineId=` lists every
  student with a next rank in a style, highest progress first, with readiness,
  board column, "currently attending" (active membership, or the manual
  per-style switch) and whether grading is blocked by missing skills; search
  and active-only filters. The owner sees every student; coaches see their
  branch's students (the whole School when it has no branches). New writes,
  each needing grading permission: `board-move` (drag: rewrites the class
  count — per type on "each type" rungs — or the rank date on a time-only
  rung, recorded on the history), `log-class` (a class type from the next
  rank's, always counted, recorded) and `board-active` (the Active switch).
  Two narrow read-only database rules let coaches see which students are
  theirs (Decision 177). `packages/api-client` regenerated.
- **api + school-portal — grading Phase 3a: grade actions** (Decisions 127,
  128, 174). Promote can target any higher rung (skipped rungs recorded:
  "Skipped N ranks in between"); downgrade any lower rung (with a reason, dated
  today); promote and stripe award take a back-dated `effectiveDate` (local
  day, not in the future or before the current rank date) and starting classes
  — one number, or `startingClassesByType` when the new next rung counts each
  type. The skills check uses the engine's requirement for the next rung, and
  a new per-style switch (`skillsRequiredToGrade`, in the portal's style form)
  blocks grading until they are signed off instead of allowing it with an
  acknowledgement; downgrades no longer need skills. Skill sign-off is limited
  to the next rung's skills. Fixed: dates typed by a coach (edit rank date,
  back-dated grade) are stored as the start of that day in the student's time
  zone, so they no longer read back a day early west of UTC.
  `packages/api-client` regenerated.
- **api + school-portal — grading Phase 2c (part 2): who may book is set per
  rung** (Decision 173). Each rung gets an "Unlocks booking" list of class
  types, open to that rung and every rung above; types no rung lists are open
  to everyone. The booking and waitlist-claim rank gate now checks each style
  on the class by its class type (replacing the activities ↔ style-name
  bridge); staff override is unchanged. Existing rungs start with nothing
  unlocked, so every class is open until the owner sets some. The portal's
  rung editor has the new field. `packages/api-client` regenerated.
- **api — grading engine, Phase 2c (part 1): readiness from the engine**
  (Decisions 127, 136, 149, 171, 172). `GET /students/{id}/eligibility` now
  returns, for each style, the student's readiness for their next rung:
  classes counted and required (per type for "each type required"), days in
  rank and required, required/optional/missing skills, eligible, progress %
  and the Grading Board column (33% / 66% defaults). Days are counted in the
  student's local time (home branch, else school, else UTC). The rank fields
  it already returned are unchanged. `packages/api-client` regenerated.
- **api — grading engine, Phase 2b: attendance counted through the engine**
  (Decisions 140, 149, 170, 171, 172). A check-in now counts once toward each
  style the class lists, with that style's class type, and only when the type
  is ticked on the student's next rung (nothing ticked: every class). The
  rung's weekly cap applies on Monday–Sunday weeks in the class's local time
  (branch, else school, else UTC); a time-only rung counts no classes.
  `StudentRank` gains a per-type tally (`classesAttendedByType`, for "each
  type required") and `countingSince` (the moment of the last rank change;
  classes before it belong to the previous rung). Replaces Decision 90's
  activities ↔ style-name bridge for attendance; a class with no styles counts
  toward nothing. Existing rows are backfilled from their last grade.
  `packages/api-client` regenerated.
- **api + school-portal — School time zone** (Decisions 76, 172): a School
  has its own optional time zone, set like a Branch's in the create-school form
  and school settings. Classes generated from the timetable use the Branch's
  time zone, else the School's, else UTC (previously always UTC for a
  School-wide slot). `packages/api-client` regenerated.
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
