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

- **Billing stress-test fixes** (`docs/handover/BILLING-STRESS-TEST.md`) —
  confirming cash payments no longer fails with "busy" when several are
  confirmed at once (5,917 of 6,071 failed in the test); a card payment that
  fails once and then succeeds now gives the membership instead of staying
  Failed with the money taken; and Stripe's payment notices are no longer
  rate-limited, so card purchases settle at once in a busy hour instead of
  waiting on Stripe's retries.

- **Classes: second batch of fixes** (Decision 345, needs a migration) — a
  one-off class now needs its own ticket unless "Included in membership" is
  ticked (existing one-off classes were ticked so nothing changes for them;
  Timetable classes are always included and lose the switch); moving a booked
  class to a new time tells booked and waiting students and can't move it into
  the past; a booked class can't move to another branch; a class that has
  already ended can't be created.
- **Memberships fixes from the 26 Oct review (Decision 334)** — a Student
  whose Weekly Pass or Trial has run out can buy again (it used to be refused
  as if the old one were still live); a live Trial no longer blocks buying a
  Weekly Pass or Subscription; changing a plan's type clears the fields the new
  type doesn't use, and is locked while the plan has active members; a Trial
  lasts 1-30 days, with at most 30 trial days per Student per School in 12
  months; a Class Pack needs its class count and a Weekly Pass its expiry;
  prices and cancellation charges are typed in pounds and pence (12.50), not
  pence; every plan is listed (not just the first 20); Branch Staff see who
  manages plans instead of a blank page; a purchase is charged in the plan's
  currency or the School's default, never US dollars by default; plans that
  require a waiver, hidden plans, closed Schools, classes that have already
  taken place, staff who aren't Students, and removed Students are all refused
  at purchase; a second cash order for the same plan returns the first; the
  Active members count leaves out removed Students. **Needs a database
  migration.**
- **Notifications fixes from the 26 Oct review (Decision 333)** — the page
  has **Load more**, so notifications past the newest 20 can be seen; the bell's
  red dot follows the real Unread count (all pages, snoozed left out), as does
  the coach dashboard's unread count; Snooze is greyed out on read
  notifications; the broadcast "One class" picker lists upcoming classes
  soonest first with their date, time and branch; push no longer waits on
  email, and with no email service set up a notification is delivered in-app
  without three failed retries; the waiver request names the School
  ("Gracie Barra has invited you to sign the waiver …"); Class moved, Class
  cancelled, Promotion to decide and Promotion fee are translated; broadcasts
  refuse an archived branch or class and a blank title or message; a snooze
  is capped at 7 days; a bad page link is a 400, not a server error. A
  child's notifications now also reach their linked parents ("For Mia: …");
  when sending to one class, the Owner ticks who gets it (booked, waitlist,
  cancelled; booked by default); and the payment-restricted alert names the
  student.
- **Curriculum: fourteen bug fixes** (Decision 324) — editing a lesson can now
  clear its description, duration and instructor; archived lessons are hidden
  from students everywhere (direct links, favourites, playlists, skill lists);
  Upload video is greyed out with a plain reason while video isn't set up, and
  a stuck upload turns "Video failed" so it can be tried again ("Upload
  again"); blank lesson titles, comments and playlist names are refused; a
  playlist no longer breaks when the student has left one of its Schools;
  adding a lesson to a playlist twice no longer errors; a closed School takes
  no new comments; duration is capped at 24 hours; the grading page's lesson
  links skip archived lessons; a skill from an archived style can be unticked;
  and the delete warning says what students lose.

- **Curriculum: the owner's answers** (Decision 326) — coaches and Branch
  Staff now have the Curriculum page, read-only (lessons, categories and
  comments), and only the School owner can add, edit, reorder or upload; the
  owner can delete a category, its lessons moving to "No category"; duration
  is typed in minutes and seconds and listed as e.g. 4:30; each lesson has a
  Comments (n) button opening its students' comments, which only the owner
  (or the comment's author) can remove. **Needs a database migration.**

- **Timetable fixes from the 26 Oct review (Decision 332)** — archived slots,
  closed Schools and archived Branches no longer get classes back overnight;
  a new or unarchived slot is bookable straight away; raising a slot's capacity
  offers the seats to the waitlist; a capacity cut asks to confirm and leaves
  fuller classes their size; changing waiver, membership or cut-off rules asks
  whether booked classes take them too; break times are checked and can be
  cleared; Archive asks first; every slot shows (not just the first 20); a
  cancelled or finished class says so in the booking dialog; cancellation
  notices show local time; waitlisted students hear when a class moves.

- **Classes review fixes, first batch** (Decision 335; no database change):
  - The Classes list opens on **Upcoming** (soonest first), with **Past** and
    **All**; Timetable-made Classes carry a "Timetable" tag; a School with
    styles filters by a style dropdown.
  - The Class page and **roll call show every booked student** (not the first
    20); the roll call lists who still needs checking in first, by name.
  - **Coaches and Branch Staff** get a read-only Classes page, and the coach
    dashboard's "Coming up" shows their next Classes with Roll call and Show QR.
  - The Class form uses the **Branch's time zone** (else the School's), takes
    the cancellation charge as a normal amount ("7.50", not cents), refuses a
    blank title, and lets cut-off dates be cleared.
  - Archiving asks first; an archived Class can't be edited until unarchived.
  - The API refuses a QR window that closes before the start and cut-offs
    after the end; making a full Class unlimited offers seats to its waitlist;
    a guest needs a Friend Pass (one per guest); a closed School takes no new
    bookings or waitlist entries.

- **Forms brought in line with the shared address, currency and translation
  work** — My profile now uses the same country-first address fields as every
  other form (and no longer wipes a structured address on save); the address
  fields themselves, and their country list, are now translated in all 15
  languages; Register and Student update pick Language and Currency from the
  real lists (USD, GBP, EUR and BRL first) instead of free text; and the
  Notifications page's Delete and Clear all read text is translated.
- **Student Ranks tab: breakdown, hours and the promotion fee** (DESIGN.md →
  "Hours trained: logged, not graded" and "Promotion fee"):
  - **Breakdown** under "Toward {rank}": classes, days at this rank and skills
    signed off, each with ✓ or ○, "x of y", its own % and bar, and whether it
    counts toward the % (classes; days on a time-only rank) or is "Needed too,
    not in the %".
  - **Hours trained:** hours at this rank and in all, "A record only. Grading
    doesn't use hours."
  - **Log a class** (no longer "+1"): pick a class of this style from the last
    7 days, whose length is logged, or "No class (enter the time)", 60 minutes
    by default. The API's class list gains optional `disciplineId`,
    `startsFrom` and `startsTo` filters for it.
  - **Promotion fee box**, as on the board: "Waiting for fee" / "Fee declined" /
    "Promotion to decide" first among the tags; the owner waives or cancels; a
    coach promotes or doesn't. A student waiting for a fee has no Grade button
    and no "Ready" tag.
- **Instructors search box is labelled "Search instructors"** — it was
  just "Search", the same name as the header search, so screen readers
  announced two identical boxes on the page. It now matches "Search classes"
  and "Search students", in all 15 languages.
- **Belt editor redesign** (DESIGN.md → "Belt editor: one grade at a time"):
  - **One grade at a time:** a row of grade pills (plain belt, 1 stripe…)
    with the students on each, a live preview of the picked grade, and
    "+ Add stripe grade", which copies the previous grade's numbers.
  - **Chapters:** 01 Belt and stripes (rank name, colours, this grade's name,
    stripe colour groups with one Remove), 02 What it takes, and 03 Promotion
    fee, a price per grade, shown only to the owner while the fee is on.
  - **"Ready to save"** lists what's missing; a grade that says nothing is a
    warning, not a block.
  - **Ladder:** Duplicate a rank, and choose where a new rank goes. Dragging
    to reorder now works with a finger too.
- **Grading tabs complete** (DESIGN.md → "Grading screens"): Board · Styles &
  Belts · Skills · Permissions · Settings.
  - **Settings:** every style's Grading Board columns, the promotion fee and
    "Allow grading before the fee is paid" (owner only), and "Open mat counts
    toward hours", with an "About this setting" panel and one Discard / Save
    changes bar.
  - **Skills:** pick a style, then its skills with how many grades require
    each and how many lessons teach it; add, edit, reorder and delete (owner).
  - The Disciplines pages carry the tabs as Styles & Belts.
- **Grading Board redesign** (DESIGN.md → "Grading screens"):
  - **Grading** is one menu item with tabs: Board · Styles & Belts ·
    Permissions (Permissions moved to `/grading/permissions`; the old address
    still works).
  - **Grid or Rows**, with Ready to Grade on top in Rows, and **Sort: Belt ·
    Name** with a direction inside each stage.
  - **Student panel:** click a card to see Toward {next rank} with its ticks,
    the skills for the next rank, the last 4 history entries, Promote and the
    student page. **Selection panel** for ticked students, which shrinks to a
    pill.
  - **Click any progress bar to promote** that student, with our own
    "Promote to" drop-down showing belt pictures (also in Move down and
    Verify).
  - **Promotion fee on the board:** "Waiting for fee", "Fee declined" and
    "Promotion to decide" tags; the owner waives or cancels a fee, and a coach
    then promotes or doesn't.
  - Progress bars take their level's colour; a two-tone belt has its second
    colour as a band through the middle.
- **Booking and schedule rules on screen** (Decision 322):
  - **School page:** "Check-in opens (minutes before class)" and "Cancelling
    after a class starts" (no refund once started — the default — refund
    until the class ends, or always refund).
  - **Timetable slot edits:** when a change moves classes that already have
    bookings, switches the slot off, or cuts the capacity below the seats taken,
    the owner chooses to move, cancel or keep those classes. Only the changed
    fields are saved, so a change made to one class on its own survives.
  - **Booking a full class:** the booking dialog offers "Add to waitlist".
  - **Clearer messages** for a full class, a waitlist queue, booking closed,
    check-in not open yet (with the opening time) and a very busy class, in
    every language. The API now marks these errors with their own codes.
- **Booking and schedule rules from the stress test** (Decision 322):
  - **Booking:** a class that has ended or is archived can't be booked, and a
    membership past its expiry date no longer pays for a class.
  - **Booking cut-off:** it now stops students; staff can still book a walk-in
    until the class ends.
  - **Check-in:** it opens a set time before the class starts (30 minutes by
    default, set per School).
  - **Waitlist:** seats freed in a full class go to the waitlist first, and
    raising its capacity offers the new seats to the waitlist.
  - **Late cancellation:** each School chooses what a cancellation after the
    start gives back (default: no refund).
  - **Timetable edits:** editing or switching off a slot now updates its
    upcoming classes. Classes that already have bookings are moved, cancelled
    with credit back, or kept, as the owner chooses, and booked students are
    told.
  - **Capacity:** it can't be cut below the bookings already made.
  - **Busy times:** when many students book the same class at once, every
    seat now fills and nobody sees an error page.
  - **Rate limits:** they count per user, and per real client address behind
    the load balancer.
- **Instructors: search, hand over classes, give the role back** (Decision
  312) — the roster has a search and Branch, Style and Status filters, and
  shows who hasn't signed in yet; "Invite existing user" goes straight on to
  "Add instructor" with them picked; the detail page shows their branch,
  activities, address, certification (with a download link for the owner)
  and weekly timetable, can hand all their upcoming classes and weekly slots
  to another instructor in one step, and can give a revoked instructor their
  role back; "Complete your profile" starts from what the instructor already
  saved.
- **Instructors page fixes** (Decision 311) — every instructor is listed,
  A to Z, with an Active or Revoked status; archived and revoked instructors
  can't be given new classes, timetable slots or lessons, and the pickers
  leave them out; the "Instructors' belts" box no longer breaks after someone
  is revoked; no instructor joins an archived branch; a profile's branch must
  match the branch their role is for; Archive asks first; Revoke warns about
  upcoming classes, which stay editable afterwards; the detail page lists
  every class, upcoming and past; "Add instructor" only offers people with
  no profile yet; coaches who open the page go to their own start page.
- **Promotion fee: who sees what** (Decision 314) — prices on the ladder,
  and the amounts in the School's list of fee requests, are now shown only to
  the owner and to people with grading permission for that style. Anyone with
  grading permission for the style can now decide not to promote a student
  whose promotion is "to decide".
- **Promotion fee, API** (Decisions 287, 297, 300, 307, 313) — the School
  owner can turn on a promotion fee and "Allow grading before the fee is
  paid" (both off by default) and price any belt or stripe; with the fee off,
  no prices are shown or accepted. Grading to a priced rank sends the student
  (or a child's Guardian) a fee request to accept or decline; by default the
  promotion waits ("Waiting for fee") until the fee is paid, keeping the
  coach's grading date. Bulk promote makes one request per student. The owner
  can waive or cancel a fee at any time: waiving a waiting promotion applies
  it; cancelling it, or waiving a declined fee, leaves it "to decide" for a
  coach, with one reminder after 3 days when the student is fully ready. The
  Grading Board shows each card's fee state. Paying a fee waits for
  staff-created charges (Decision 303); the portal and app screens come next.
- **Hours trained** (Decisions 301, 306; API only so far) — each check-in
  now records the class's scheduled length (a 90-minute class is 1.5 hours)
  for each style on the class, and "Log a class" records the picked class's
  length or the minutes the coach enters (60 by default). A student's grading
  data now returns their hours trained per style (in total and since their
  current rank) and a progress breakdown: classes, days at the rank and
  skills, each on its own. Hours are a record only: grading progress,
  "Ready to Grade" and the Grading Board are unchanged. New School setting
  **"Open mat counts toward hours"**, off by default, changed by the owner or
  a coach with "Change board %": while off, open mat classes don't add to
  hours. Hours start from this release; earlier check-ins are not counted.
- **One email, one account** (Decision 295) — emails are no longer
  case-sensitive. Signing in, "Find" on the Staff page and Add Manually all
  ignore capitals and stray spaces, so an owner can no longer create a second
  account for someone already registered with different capitals. Existing
  emails are lower-cased, and the database refuses case-only duplicates.
- **Staff page fixes** (Decision 296) — no new staff, coaches or coach
  invites at an archived branch (and an invite to a branch archived later
  stops working); no role grants at a closed School; "Who can invite coaches"
  updates without a reload; Revoke asks "Are you sure?" first; the look-up
  table shows branch names instead of ids; Branch Staff who open the Staff
  page go to their own dashboard instead of a blank page.
- **Disciplines fixes and new tools** (Decisions 308, 309) — archived belts
  no longer appear in grading; renaming a style or a class type now updates
  the classes, timetable, instructors and rungs that use it, and a class type
  still in use can't be removed. Names can't be blank or repeated, and copies
  get a free name. New: archive and unarchive a style the School no longer
  teaches (students keep their rank and history), a Students count and list
  per style, skills showing which rungs need them and how many lessons teach
  them, skills you can put in order, class types edited as a list, and a
  read-only Disciplines page for coaches and Branch Staff.
- **Safari test fixes and belt wording** — the first nightly Firefox/Safari
  run (Decision 302) passed in Firefox; two Safari failures were test-only
  (a race on the belt-delete error, and a never-loading test photo). The
  "can't delete a belt" message now reads "1 student holds" / "2 students
  hold" instead of "1 student(s) hold".
- **Branch archive fixes** (Decision 293) — archiving a Branch now asks
  first and, if something still belongs to it, says what inside the dialog.
  Weekly timetable slots now block archiving (before, sessions kept being
  created for the archived Branch). Archived Branches no longer appear in
  Branch pickers across the portal, except on a record that already uses
  one. The 90-day purge now rechecks before deleting, so students, staff or
  classes added to an archived Branch are never silently removed with it.
- **Branches list: better filters, every Branch shown** (Decision 294) — the
  City filter is now a dropdown of your own cities with counts, and matches the
  city only (it no longer finds "London Road" in Manchester), ignoring case and
  accents. A new search box finds a Branch by name, city or postcode, and a
  Country filter appears when a School has Branches in more than one country.
  Every Branch now shows, sorted A to Z, on the Branches page and in every
  Branch picker (before, only the first 20 did). Each Branch shows its number
  of Students and upcoming classes.
- **Bulk promote can finish after a failure** (Decision 284) — if a large
  batch stops part-way, the group that failed is sent again once by itself,
  then the window offers "Try the remaining N again" or "Stop here and see the
  report". Each student carries the rank the check found them on, so nobody is
  ever promoted twice. Removing a student from the batch no longer re-checks
  the whole batch.
- **Grading Board: no bulk promote limit** (Decision 282) — a coach can
  promote any number of ticked students at once. The portal sends them 200 at a
  time, as Spec 55 always intended; before, more than 200 failed outright.
- **Only active students are graded up** (Decision 283) — promote and stripe
  award (single and bulk) now need the student to be active: their board Active
  switch, or a live membership. Inactive students can't be ticked on the board,
  and bulk promote lists them as "can't be promoted". Moving down still works.
- **Grading Board at scale** — 25 cards per column with "Show all N", a
  "N of them hidden by your search" note (with "Show them") when ticked students
  are filtered out, and a count of students already on the top rank.
- **Shorter default waitlist claim window** (Decision 279) — new Schools now
  give a waitlisted student 60 minutes (was 120) to claim a freed seat, so
  more people on the list get a chance before class. Existing Schools keep
  their current setting, which owners can still change on the School page.
- **Global Search in the School Portal header** (Decision 278) — the header's
  search box, until now disabled ("coming soon"), finds Students,
  Instructors, Classes, Branches and Franchises by name (any part of a first
  name, surname or full name; a class's title), grouped by type, and opens
  the one you pick. It works from the keyboard (arrows, Enter, Escape) and
  closes on a click outside, and screen readers hear the number of results.
  Everyone sees it except a coach or Branch Staff member who doesn't own a
  School, matching the sidebar; results are limited to what each list
  already shows them, and archived records are left out. The Students,
  Instructors, Branches and Franchises list endpoints gained an optional
  `search` param for it, like Classes' (`%` and `_` now match literally);
  `GET /franchises` also gained an optional `excludeArchived` param.
  Translated into all 15 languages.
- **School Portal translation, 15 languages** (Decision 273) — the header's
  language picker now actually switches the portal's text instead of only
  saving a preference. Languages: English (UK), Portuguese (BR), Spanish,
  Arabic, French, German, Italian, Dutch, Polish, Russian, Turkish, Japanese,
  Korean, Chinese (Simplified) and Thai, each listed in its own script.
  Arabic switches the layout to right-to-left. Text ships built in, and a
  Platform Admin Translation row for the same screen and key replaces it.
  Every School Portal page is translated, including sign-in, the footer and
  the shared form controls (phone field country names, photo upload,
  Rows/Grid toggle); dates, money, language names and time zones follow the
  picked language. The API's error messages and the notifications its
  background jobs write (waitlist spot, ready to grade, promotions, waivers,
  payment disputes) are translated too; an error message with no translation
  shows a translated general message for its kind of failure, never the
  English. Status, role and payment-method labels (e.g. "BANK_TRANSFER")
  now show as words in every language, English included. Not translated:
  data people enter (including a School's broadcasts), names the server
  stores in English (style template belt names, generated stripe names),
  Platform Admin and the student app. Non-English text is a first draft
  awaiting native-speaker review.
- **Account menu and My profile page** (School Portal) — the header's avatar,
  name and role are now a menu button: it shows your name, email and role,
  then My profile, School settings (only for those who see School in the
  sidebar) and Log out (the same sign-out as the sidebar button). It works
  from the keyboard and closes on Escape or a click outside. The new My
  profile page (`/profile`, open to every portal user) edits your own photo,
  first name, surname, username, date of birth, language, currency and
  address through the existing `PATCH /users/me`; email and phone are shown
  read-only, since they're how you sign in. Saving a new language switches
  the portal's text, as the header picker does. Translated into all 15
  languages, and a new check fails if any language is missing a key.
- **Saving after 15 minutes on a page works again** — when the access token
  had expired, the session refreshed correctly but the save itself was never
  re-sent (the retry called the browser's fetch the wrong way), so e.g. saving
  the School profile showed "Something went wrong". Lists recovered on their
  own; saves did not. Fixed in `@ultm8/api-client`, so the student app gets it too.
- **Common currencies first** — every currency picker now lists USD, GBP,
  EUR and BRL first, then the rest alphabetically.
- **"Send a message to students"** — the Notifications page's "Broadcast to
  Students" button and form are renamed in plain words ("Send message",
  "Message sent").
- **Clearer errors** — error and success banners now scroll into view when
  they appear, and a request that gets no answer at all says "Could not reach
  the server" instead of "Something went wrong". The Curriculum list's Instructor column
  shows the coach's name instead of an id.
- **Country-first addresses** (Decision 276) — every address form in the
  School Portal (School profile and creation, Branch add and settings,
  Franchise, Instructor profile, Student profile, registration) now starts with
  a Country picker and then shows that country's own fields: e.g. ZIP code and
  a State list for the US, Postcode for the UK, Emirate and no postcode for the
  UAE, CEP for Brazil. Required fields and postal-code formats are checked per
  country, in the form and again by the API. Addresses are stored as separate
  fields; the one-line address shown elsewhere is built from them. Existing
  one-line addresses are kept and can be converted the next time they're
  edited. Google Places suggestions can be plugged in once an API key exists.
- **Delete notifications** (Decision 277) — each notification's ⋮ menu on
  the Notifications page now has **Delete**, and the page header has
  **Clear all read**, which removes every notification you have already
  read (unread ones stay). Both ask for confirmation. Removed notifications
  are hidden, not erased, so payment and waiver alerts stay on record.
- **School Portal refresh-token logic** (Decision 262) — a session no longer
  silently dies 15 minutes after login with no recovery. School Portal now
  stores and uses the refresh token `POST /auth/login` already handed it,
  transparently refreshing an expired access token the moment any request
  401s (no visible interruption, no forced re-login) — the same fix
  `apps/student` already shipped for the identical gap, mirrored here.
  Logging out now also revokes the refresh token server-side, not just
  clearing it locally.
- **MembershipPlan new-member billing strategy** (Decision 259) — a School
  Owner can now set, per SUBSCRIPTION plan, how a brand-new Student's first
  charge and renewal date are anchored: **Fresh cycle** (default, unchanged —
  full price charged immediately, renews monthly from the signup date) or
  **Prorate to a shared renewal day** (every new Student is prorated from
  signup through a fixed day-of-month 1-28, then renews on that same day
  every month after, using Stripe's own `billing_cycle_anchor_config` to do
  the proration math rather than computing it by hand). New
  `MembershipPlan.newMemberBillingStrategy`/`billingCycleAnchorDay` fields,
  a new "New member billing" control in `MembershipPlanFormPage`'s Pricing &
  Access step (SUBSCRIPTION only). Only affects new signups going forward —
  no migration path for already-active subscribers. The Franchise fee-rate
  change migration this same decision's conversation also approved is
  tracked separately (Decision 99's own follow-up, not yet built).
- **Franchise fee-rate migration** (Decision 260, Decision 99's own follow-up) —
  a Franchise Owner can now actually change `flatFeeAmount`/`perHeadcountRate`
  once franchise-fee billing has started for a member School, instead of
  being blocked outright. Two strategies, the Owner's choice:
  **MIGRATE_NEXT_CYCLE** (the new rate starts at each School's own next
  billing period — no immediate charge or credit) or **MIGRATE_IMMEDIATE**
  (takes effect right away — a real prorated charge for FLAT, or, for
  PER_HEADCOUNT, a disclosed re-rate of the Franchise's ENTIRE current
  billing period, a genuine Stripe metered-billing constraint, not a choice).
  New background job (`franchise-fee-rate-migration`), a new
  `GET /franchises/{id}/billing-status` endpoint, and a `FranchiseFormModal`
  prompt mirroring Membership Plans' own price-change prompt.
- **Push notification SEND built** (Decision 223/264) — `PushNotificationService`
  (`apps/api`, Firebase Admin SDK, FCM for both platforms per Decision 250)
  wired into the existing `notification-fanout` pipeline as a second,
  best-effort channel alongside email; a token FCM reports unregistered is
  deleted automatically. Plus the Track B client half (`apps/student`,
  `docs/TRACK-B-ROADMAP.md`) `NotificationsScreen.tsx` had flagged as
  deliberately not built (Decision 95): `pushRegistration.ts` requests OS
  permission and registers a real device token via the already-existing
  `POST /notifications/device-tokens`. Still genuinely non-functional without
  a real Firebase project's credentials — same standing gap as every other
  not-yet-provisioned vendor here (R2, Cloudflare Stream, Cognito) — the real
  code is in place and tested, inert until the vendor account exists.
- **School Owner multi-School switcher** (Decision 258, closing Decision 255's
  own named follow-up) — a School Owner holding `SCHOOL_OWNER_MANAGER` at more
  than one School (nothing in the schema prevented it) can now pick which one
  they're acting as, same mechanism and the same `SchoolSwitcher` component the
  coach switcher below already added, kept as independent state since the same
  person could own one School and coach at a different one. No backend change.
- **Shared marketing footer** (Decision 256) — a standard B2B SaaS footer
  (copyright + Terms of Service / Privacy Policy / Support) now renders once
  at the bottom of every page, as a full-width band below the entire shell
  (sidebar included, not confined to the main content column), on all three
  apps (`apps/school-portal`, `apps/platform-admin` via `packages/ui`'s new
  `AppShell` `legalFooter` prop; `apps/student`, Track B, via its own
  equivalent `LegalFooter` component). The three links ship visible but
  disabled ("(coming soon)") — no real Terms/Privacy/Support pages exist
  yet, same convention as the existing disabled Global Search input.
- **School Portal's footer upgraded to a richer, per-School shape** (Decision
  257, same day) — Programs (this School's own Disciplines), Company
  (Instructors/Locations links + a new "About us" field), Support (this
  School's own Contact email/phone, Terms/Privacy still platform-wide), a
  decorative "find a school" search and "Get the app" QR placeholders, and up
  to five social links (Facebook/Instagram/TikTok/YouTube/X) — all new,
  independently-optional `School` fields, editable on a new Footer settings
  card on the School page. Every unset field hides its own line/icon
  entirely, never a placeholder. `apps/platform-admin`/`apps/student` keep
  Decision 256's simpler shape unchanged — neither has a single "current
  School" context the way School Portal does.
- **Multi-School coach/Branch Staff switcher** (Decision 184 item 4's own
  named follow-up, resolved) — a coach or Branch Staff member holding an
  active grant at more than one School can now pick which one they're
  acting as, on both the School Portal (`TopBar`) and `apps/student`'s Coach
  dashboard (Track B), instead of always landing on whichever School
  happened to sort first. No backend change — every coach/grading endpoint
  was already School-scoped; this closes a client-side "which School" gap
  only. `useOwnedSchoolId`'s identical gap (a School Owner holding
  `SCHOOL_OWNER_MANAGER` at more than one School) was found while building
  this and deliberately left for its own decision, not folded in here
  (Decision 255).
- **`GET /transactions/{id}/invoice` — PDF/receipt downloads for payment
  history** (`apps/api`, plus Track B's `apps/student` and
  `apps/school-portal`, `docs/TRACK-B-ROADMAP.md`'s "Student-scoped
  transaction history" section). Closes Spec 55 §7's own confirmed
  `GET /transactions/{id}/invoice (download)` shape, deferred out of
  Phase 9's original scope — with **zero new PDF-rendering infra**: Stripe
  already hosts a receipt page per Charge (`Charge.receipt_url`, verified
  directly against the installed `stripe` SDK's own types), so this surfaces
  that rather than generating a document. New
  `StripeClientService.getReceiptUrl(connectedAccountId, paymentIntentId)`;
  new `TransactionsService.getReceiptUrl`, authorized the same way the
  existing bulk ledger read is (self, or that School's Owner/Manager);
  `receiptUrl` is `null` — a real, normal state, not an error — for a
  CASH/BANK_TRANSFER Transaction. `apps/student`'s `TransactionHistoryScreen.tsx`
  gets a "View receipt" row action, handed off to the device browser via
  `expo-web-browser` (the same pattern `PaymentMethodsScreen.tsx` already
  established for Stripe Checkout); `apps/school-portal`'s
  `TransactionsPage.tsx` gets a "Receipt" table column (Decision 202's own
  rejected-mockup "Download invoice" idea, now actually built). New e2e
  coverage (`transactions.e2e-spec.ts`, 5 new tests) and extended
  `apps/student/src/transactions/transactionHistory.test.tsx` (2 new tests).
  The live Stripe-API round-trip itself is unverified against a real account
  (same posture every other real-vendor-dependent flow in this codebase
  takes); `apps/school-portal`'s own addition has no Playwright coverage —
  disclosed, not silently skipped, since no prior test file existed for that
  page to extend and the backend path it calls is already fully e2e-proven.
  `packages/api-client` regenerated.
- **Track B: profile photo self-upload** (`apps/student`, `docs/TRACK-B-ROADMAP.md`
  "My Profile" section) — closes the "Profile photo" gap that section's own "Not
  yet" list had named: `UpdateUserDto.profilePhotoUrl` took a plain pasted URL,
  with no upload flow behind it. No backend change needed — the shared
  `POST /uploads/public-photo-url` endpoint (built for Instructor/Branch/
  Franchise/Class photos, see the "Real photo uploads" entry below) already had
  a `USER`, self-service branch requiring no `entityId`/`schoolId` at all. New
  `useUploadMyProfilePhoto` (`profileQueries.ts`) composes that presign call + a
  direct PUT of the picked image + `PATCH /users/me` with the resulting public
  URL — the same 3-step shape `useSignWaiver`'s own drawn-signature upload
  already established for this app. New `expo-image-picker` dependency drives
  "Take Photo"/"Choose Photo" on `ProfileScreen.tsx`, both normalized through
  one size/type check (same 5MB / PNG+JPEG+WebP limits `PhotoUploadField`, the
  web equivalent, already set). New `src/components/Avatar.tsx` — this app's
  first avatar component, mirroring `apps/school-portal`'s own (real photo, or
  an initials monogram). New `src/profile/profilePhoto.test.tsx` (6 tests).
- **Fixed the undefined-vs-null `PATCH /users/me` contract gap** (`apps/api`,
  plus Track B's `apps/student`, `docs/TRACK-B-ROADMAP.md` "My Profile"
  section). `UpdateUserDto`'s username/gender/nationality/language/currency/
  address/weightCategory/kimonoSize/beltSize were typed `string | undefined`
  only — each is nullable on `User` and `UsersService.updateProfileFor` already
  cleared it correctly on an explicit `null` (confirmed for weightCategory/
  kimonoSize/beltSize by a pre-existing `users.e2e-spec.ts` round-trip test),
  but the DTO's own type never admitted `null`, so no generated client could
  construct a type-safe call to actually send one. Now typed `string | null`
  for all nine fields (no backend logic change — `@IsOptional()` already skips
  validation for both `null` and `undefined`, verified directly against the
  installed `class-validator`'s own source). `apps/student`'s `ProfileScreen.tsx`
  now sends `null`, not `undefined`, for its plain-text fields when cleared —
  safe there because every field is always pre-filled from the real current
  profile, so blank unambiguously means "clear it." `apps/school-portal`'s
  `StudentUpdatePage.tsx` deliberately left untouched: its fields start blank
  by design (no single-Student full-profile read endpoint exists yet), so
  blank there still has to mean "leave alone," not "clear" — adopting this
  fix there would risk a Staff member accidentally wiping a field they never
  touched. `language`/`currency` on `ProfileScreen` also left out of the
  UI-level fix (though not the type fix) — neither picker offers a "none"
  selection, so there's nothing to send `null` for yet. New e2e coverage
  (`users.e2e-spec.ts`) and a new `apps/student/src/profile/profileEdit.test.tsx`
  (4 tests). `packages/api-client` regenerated.

- **Entity-level tenant offboarding for 7 entities with no delete/archive
  mechanism before now** (Decision 226) — Branch, Class, TimetableSlot,
  Instructor, Rank, Waiver, Lesson each get a real "Delete" action, usable
  while the School stays open (not Decision 110's separate, already-shipped
  whole-tenant close-account flow): soft-archive with the same full
  `archivedAt`/`purgeAt`/`purgedAt` trio and 90-day retention window
  School/Franchise use (Decision 110) — a disclosed judgment call over the
  simpler bare-`archivedAt` shape `MembershipPlan` uses, since this project
  now has two different existing archive shapes and the product owner's
  answer didn't specify which. School-Owner-gated (same gate as each
  entity's own create/update), idempotent, blocked with a 409 by active
  dependents (verified per entity against the real schema — see each
  service's own `archive()` header comment for the exact rule: a Class with
  an upcoming Booking, a Rank someone holds or an instructor has declared,
  a Waiver with any signature row, an Instructor assigned to an upcoming
  Class/slot, a Branch with a Class/Instructor/Student/active role grant
  on it, a TimetableSlot with an upcoming Booking against a generated
  Class; Lesson has no real dependents to check today). **Rank and Lesson
  already had an unconditional/conditional hard-`DELETE` from Decision
  198** — this build adds the reversible archive/unarchive pair alongside
  it, not in place of it. **Waiver is never hard-purged**, at any purgeAt,
  mirroring Decision 110's own School-level legal-record exception — the
  purge sweep finds and logs those rows but leaves them archived forever.
  **api:** migration `20261112000001_entity_offboarding_7_entities` (renumbered
  from its original `...000000` to avoid a timestamp collision with Student
  Measurements' own migration, which claimed that timestamp first in
  `master`);
  `BranchesService`/`ClassesService`/`TimetableService`/
  `InstructorsService`/`RanksService`/`WaiversService`/`CurriculumService`
  each gain `archive()`/`unarchive()` (TOCTOU-safe conditional update, same
  pattern `TenantLifecycleService` already established) plus an
  `includeArchived` list filter (excluded by default); new shared
  `entity-offboarding-purge.processor.ts`/`Scheduler` (daily sweep,
  `entity-offboarding-purge` queue) — Rank's own sweep re-derives the
  holders/history/declared safety check rather than trusting the archive-
  time state 90 days later. `packages/api-client` regenerated.
  **school-portal:** Branches/Classes/Timetable/Instructors/Waivers pages
  gain a "Show archived" toggle (archived rows excluded by default) and an
  Archive/Unarchive row action; the Disciplines ladder editor and
  Curriculum's lesson tables show archived rows inline instead (badged,
  not hidden) — hiding them would have broken their own existing reorder
  endpoints' "send every item of this set exactly once" validation, a
  disclosed deviation from the hide-by-default convention used elsewhere.
- **Student Measurements — Weight Category, Kimono Size, Belt Size — built as
  real fields** (Decision 220/246): Student Detail's Measurements fields,
  previously flagged Fully Proposed in `docs/v1.2-backend-backlog.md` (no
  such field existed anywhere on `User` or `StudentRank`), approved by the
  product owner for build, overriding the Developer recommendation to drop
  them for lack of grounding. **api:** three new nullable `String?` columns
  on `User` — `weightCategory`, `kimonoSize`, `beltSize` — placed on `User`
  (person-level, not per-Discipline, so not `StudentRank`); free text, no
  enum/unit/canonical code list confirmed anywhere, same convention as this
  model's existing `gender`/`nationality`/`language`/`currency` columns
  (a developer-level presentation choice, not an invented business rule —
  same category as Decision 222's Snooze shape). `UpdateUserDto`/
  `UserResponseDto` gain all three (`@IsOptional() @IsString()
  @MaxLength(50)`); since `UpdateStudentProfileDto` already `extends
  UpdateUserDto` and both `PATCH /users/me` (self-service) and `PATCH
  /schools/:id/students/:studentId/profile` (Staff-on-behalf-of) already
  share `UsersService.updateProfileFor`, this wires BOTH edit surfaces at
  once — no separate DTO/service path needed. **school-portal:**
  `StudentUpdatePage.tsx` gains the three fields. **student:**
  `ProfileScreen.tsx` (the Student's own self-service profile editor) gains
  the three fields too, since a Student editing their own kimono/belt size
  on their own profile is the natural home for it. `packages/api-client`
  regenerated. New e2e coverage in `users.e2e-spec.ts` and
  `student-profile-update.e2e-spec.ts`: set -> read back -> cleared with an
  explicit `null`, plus a cross-tenant-isolation check (plain `User`
  columns, no new cross-tenant surface).
- **Staff "Add Manually"** (Decision 251) — closes the exact gap Decision
  237's own "What this does NOT resolve" section flagged for Staff's
  identical from-zero-invite problem: the Staff page's "Invite staff"
  find-by-email/phone step used to just say "No ULTM8 account found," full
  stop, with no fallback. Mirrors Decision 237's Instructor "Add Manually"
  exactly — a real `User` + `RoleGrant` (role: `BRANCH_STAFF`) created
  immediately from just a name, email, and Branch, no invite/acceptance
  step; a server-generated temp passcode emailed; forced passcode change on
  first login (reuses the existing `mustChangePasscode`/
  `POST /auth/passcode-change/first-login` infrastructure Decision 237
  already built — untouched here). Since "Staff" is `BRANCH_STAFF` in the
  `Role` enum, not a separate profile table the way `Instructor` is its own
  table, this creates only `User` + `RoleGrant` — no third profile row.
  **api:** new `RoleGrantsService.createStaffManually()` (added to
  `RoleGrantsService`, which already owns all Staff CRUD, rather than a new
  module) behind `POST /schools/:schoolId/role-grants/add-manually`,
  School-Owner-gated, same 20/hour throttle tier as
  `InstructorsController`'s own add-manually route. New
  `CreateStaffManuallyDto` — `branchId` is **required outright** here, not
  conditional on whether the School has branches the way Instructor's own
  flow is (Branch Staff always needs a Branch). New
  `CreateStaffManuallyResponseDto` (extends `RoleGrantResponseDto` — the
  RoleGrant row this creates IS the Staff record — plus `email`/
  `emailSent`). **school-portal:** new
  `apps/school-portal/src/roleGrants/AddStaffManuallyModal.tsx`, a second
  "Add staff manually" entry point on `StaffPage.tsx` beside the existing
  invite-by-email/phone form, with the same non-blocking `emailSent` banner
  pattern `InstructorsPage.tsx` already uses. `packages/api-client`
  regenerated.
- **Membership Plans — two stale-comment fixes, no behavior change** (Decisions
  241/249). `CreateMembershipPlanDto`/`UpdateMembershipPlanDto`'s `currency`
  field still described "one of the 6 supported currencies," missed by the
  currency-expansion PR (Decision 241) since it only touched
  School/Franchise/User DTOs — corrected to point at the real
  `GET /settings/currencies` list. `CreateMembershipPlanDto.expiryDurationDays`'s
  "Not used by WEEKLY_PASS" description was simply wrong (Decision 249,
  verified directly against `MembershipsService.createMembershipAndReturn()`,
  which already applies it uniformly across every plan type) — corrected to
  match; `MembershipPlanFormPage.tsx`'s own code comment updated to match,
  the field was already shown for WEEKLY_PASS as the safe default.
- **Membership purchase with a fresh card, via hosted Stripe Checkout**
  (Decision 243, Track B Slice 4b) — `apps/student`'s "Purchase" button on a
  Stripe-backed membership plan now completes end-to-end instead of showing
  "online payment isn't available in the app yet": it opens a hosted Stripe
  Checkout page in the device's own browser, the same `mode: 'setup'` pattern
  Decision 238 (saved payment methods) already built for saving a card,
  extended to `mode: 'payment'` for an actual one-time charge — no native
  Stripe SDK, no custom dev client. **api:** `PaymentsService.
  createPurchaseCheckoutSession()`; `PurchaseMembershipDto` gains
  `useHostedCheckout` (scoped like `payWithSavedCard` — CLASS_PACK/
  WEEKLY_PASS/TRIAL_MEMBERSHIP, a Stripe-configured School — but not blocked
  for a Guardian-driven purchase); `PurchaseMembershipResponseDto` gains the
  `requires_checkout` outcome (`checkoutUrl`). Settlement reuses the existing
  `payment_intent.succeeded` webhook handler verbatim — no change to
  `stripe-webhook-processing.processor.ts`. `packages/api-client`
  regenerated. The app's screen (`MembershipPlanRow.tsx`) is Track B
  (`docs/TRACK-B-ROADMAP.md`).
- **Membership Plans — Archive lifecycle state, and a Subscription
  price-change migrate-vs-grandfather prompt** (`docs/v1.2-backend-backlog.md`):
  two previously-flagged backlog items, both approved by the product owner
  and built together.
  - **Archive.** `MembershipPlan.archivedAt` (nullable timestamp — same
    lifecycle-flag shape `Franchise`/`School` already established for their
    own `archivedAt`) is a real, permanent-retirement state distinct from
    `visible` (temporarily unlisted, reversible with no special gate).
    `POST /membership-plans/:id/archive` and `.../unarchive`
    (`MembershipsService.archivePlan`/`unarchivePlan`), School-Owner-gated,
    same convention as every other MembershipPlan mutation. An archived plan
    never appears in the Student-facing purchase list
    (`AcademiesService.findOne`'s own `where` clause, and the
    `membership_plan_discovery_read` RLS policy, both updated) but existing
    `Membership` rows that reference it keep working unchanged — no
    cascade-delete, no FK change. `MembershipsService.purchase()` also
    rejects a direct purchase-by-id against an archived plan (a disclosed
    judgment call — archiving is reasoned as stronger than `visible=false`,
    which does not block a direct purchase today).
    `MembershipPlansPage.tsx`'s Total/Visible/Hidden stats ribbon gains a 4th
    **Archived** tile (Visible/Hidden now scope to non-archived plans only,
    so an archived-but-visible-flagged plan isn't double-counted); the row's
    own action menu (`RowActionsMenu`, same component `ClassesPage.tsx`
    already uses) gains Archive/Unarchive alongside Duplicate.
  - **Price-change migrate-vs-grandfather prompt.** Editing a live
    SUBSCRIPTION plan's price now requires an explicit choice whenever that
    plan already has at least one active, Stripe-backed subscriber:
    **Migrate** (every existing subscriber's Stripe Subscription moves to the
    new Stripe Price, `proration_behavior: 'none'` — no immediate charge/
    credit, the new price applies starting their next billing cycle — a
    disclosed, reasonable implementation choice among Stripe's own documented
    options, not a re-litigation of the migrate/grandfather product
    decision) or **Grandfather** (existing subscribers keep billing at their
    original price indefinitely; a new persisted Stripe Price is created and
    referenced by `MembershipPlan.stripePriceId`/`stripeProductId` for new
    signups only). `UpdateMembershipPlanDto.priceChangeStrategy`
    (`MIGRATE`/`GRANDFATHER`) is required (400 if missing) exactly when a
    SUBSCRIPTION plan's price is actually changing and it has active
    subscribers; rejected if sent when not applicable. Migrate runs as a new
    background job (`membership-plan-price-migration.processor.ts`,
    event-triggered, same shape as `chargeback-pattern-restriction`) rather
    than blocking the edit's own HTTP request, matching
    `franchise-fee-usage-reporting.processor.ts`'s own established per-row
    bulk-Stripe-operation pattern. Every decision is recorded, auditable, in
    a new `MembershipPlanPriceChange` table
    (`GET /membership-plans/:id/price-changes`, School-Owner-gated).
    `PaymentsService.subscribe()`'s pre-existing throwaway-Product/inline-
    `price_data` purchase flow (Phase 9) is untouched for any plan that never
    reaches a price-change decision — only a plan that has gained a
    persisted `stripePriceId` reuses it for new purchases.
    `MembershipPlanFormPage.tsx`'s Pricing & Access step shows the required
    Migrate/Grandfather choice inline (fetched proactively via
    `GET /membership-plans/:id/active-count`, not only surfaced after a 400)
    and blocks Save until one is picked.
- **Notifications page — Broadcast/compose, Snooze, and the Read-within-24h
  metric** (`docs/v1.2-backend-backlog.md`, three product-owner-approved
  features): the real API surface here was previously the narrowest of any
  page redesigned this session (`GET /notifications/me`, `PATCH
  /notifications/:id/read`, `GET /notifications/me/counts` — see the backlog
  doc's own "Notifications page" section, now marked DONE for all three).
  - **Broadcast/compose** — the single biggest gap the backlog entry flagged:
    there was no endpoint for a School Owner/Staff member to author and send a
    Notification; every real row was written only by the internal
    `notification-fanout` job, itself only triggered by three system events.
    New `POST /schools/:schoolId/notifications/broadcast`
    (`NotificationBroadcastController`/`NotificationBroadcastService`, its own
    module to avoid a circular import with `NotificationsModule` ↔
    `TenantsModule`), School-Owner-gated the same way Waiver/MembershipPlan
    CRUD already are. Three audience scopes: **All Students** (every active
    `STUDENT` RoleGrant at the School — the same query
    `SchoolsService.findAllStudentsForSchool`'s ACTIVE branch already uses),
    **one Branch** (via the real `StudentHomeBranch` model, Decisions 139/148,
    intersected with an active enrollment), and **one Class's real roster**
    (the exact `where: { classId }` shape `BookingsService.findAllForClass`
    already uses — every Booking status, not re-derived). Enqueues through the
    existing `notification-fanout` queue, reusing
    `WaiverSignatureRequestsProcessor`'s own per-recipient job-dedup pattern —
    no second delivery path. `NotificationsPage.tsx` gets a School-Owner-only
    "Broadcast to Students" header action opening a new
    `BroadcastNotificationModal.tsx` (title/body + the three audience
    options), matching this app's established form-modal house style.
  - **Snooze** — previously shown disabled-styled in the backlog's referenced
    concept mockup, with no `snoozedUntil`-shaped column anywhere in the
    schema. New `Notification.snoozedUntil DateTime?` column; new `PATCH
    /notifications/:id/snooze` (an explicit `until` timestamp or a `minutes`
    duration from now — a Developer-level presentation choice per the
    kickoff brief, not a business rule); a new scheduled
    `notification-unsnooze-sweep` job (same registration/retry shape as
    `booking-no-show-processing`) clears an elapsed `snoozedUntil`, returning
    the Notification to the unread list. `GET /notifications/me/counts`'s
    `unread` total now live-excludes a currently-snoozed Notification (the
    same "don't wait on a sweep job for correctness" convention
    `Membership.status`'s own live-computed expiry already established).
    `NotificationsPage.tsx`'s row action menu (now a real `RowActionsMenu`,
    replacing the old plain "Mark read" `Button`) gets a working "Snooze"
    item opening `SnoozeNotificationModal.tsx` (preset durations), plus a new
    "Snoozed" status badge.
  - **Read within 24h** — `Notification.read` was a live boolean with no
    timestamped read event. New `Notification.readAt DateTime?` column, set
    the first time `PATCH /notifications/:id/read` fires and never
    overwritten after (`NotificationsService.markRead`). `GET
    /notifications/me/counts` gains `readWithin24hPercent` (null until the
    caller has read at least one Notification — an unread Notification is
    excluded from both the numerator and denominator, not counted as a
    miss), `readWithin24hCount`, and `readTotalCount`. `NotificationsPage.tsx`
    wires `readWithin24hPercent` into a third `StatTile` alongside the
    existing Total/Unread tiles.
  - One migration for both new columns (`snoozedUntil`, `readAt`). New e2e
    coverage: `notification-broadcast.e2e-spec.ts` (audience-targeting
    correctness for all three scopes, the School-Owner-only gate, and
    cross-School isolation on both the School path param and a
    Branch/Class id from a different School) and extended
    `notifications.e2e-spec.ts` (Snooze hides from the unread count and the
    scheduled sweep un-snoozes correctly via direct processor invocation;
    `readAt` set once and never overwritten; the Read-within-24h percentage
    computed correctly). New Playwright coverage on
    `notifications.spec.ts` for the Broadcast modal, Snooze action, and the
    new stat tile. `packages/api-client` regenerated.
- **Currency support expanded from the old hardcoded 6 to every currency
  Stripe supports** (Decision 241) — the canonical `CURRENCIES` list
  (`apps/api/src/settings/constants/currencies.ts`, served by
  `GET /settings/currencies`) grew from 6 entries (GBP, EUR, USD, BRL, AED,
  MYR) to 139 fiat ISO 4217 codes, since every payment in this product
  already routes through Stripe anyway and the product owner approved
  building to that ceiling instead of the old sample-6. No DTO/backend
  validation change was needed — re-verified that no `currency`/
  `defaultCurrency`/`currencyOverride` field anywhere had `@IsIn`/enum
  validation to begin with; only Swagger description text changed on
  `CreateSchoolDto`/`UpdateSchoolDto`/`CreateFranchiseDto`/
  `UpdateFranchiseDto`/`UpdateUserDto`. New `CurrencyField` searchable
  combobox (`packages/ui`, same ARIA-1.2 pattern as `TimezoneField` below,
  but list-via-prop since the list comes from the API, not a runtime
  `Intl` call) replaces the plain `<select>` on `CreateSchoolPage`/
  `SchoolPage`/`FranchiseFormModal`/`BranchFormModal`/
  `BranchSettingsPage`/`MembershipPlanFormPage` — the last of which had its
  own independent, hardcoded 6-entry currency array that never actually
  called `GET /settings/currencies`, a real pre-existing staleness bug
  fixed here. `apps/student`'s `ProfileScreen` Currency field moved from a
  chip-row picker to a new `SearchablePickerField` (Modal + search +
  FlatList, same pattern `PhoneField`'s own country picker uses); Language
  stays chips (still only 4 entries). `apps/api/test/settings.e2e-spec.ts`'s
  currency-list assertion updated to check shape/presence rather than an
  exact 6-code match. `skills/ultm8-domain-rules/SKILL.md` §1 and
  `docs/v1.2-backend-backlog.md`'s Default Currency bullet both corrected
  with dated notes — see Decision 241
  (`docs/decisions/POST-SPEC-55-DECISION-LOG.md`) for the full change,
  including how the 139-entry list was sourced (Stripe's own docs were
  unreachable from this session's network; retrieved via a public
  open-source mirror that cites them as its source, disclosed in that
  decision and in `currencies.ts`'s own header comment).
- **Waivers page — explicit Unsigned `WaiverSignature` row at assignment time**
  (`docs/v1.2-backend-backlog.md` → "Waivers page" gap 2, approved by the
  product owner). Previously `WaiversService.sign()` was the ONLY code path
  that ever created a `WaiverSignature` row, and `schema.prisma` declared
  `status WaiverSignatureStatus @default(SIGNED)` — a row's mere existence
  meant "signed," so "who hasn't signed yet" was impossible to answer. Now a
  real Unsigned row is written at the two real, already-wired moments this
  codebase has for "assignment": a NEW Waiver meeting every Student already
  active at the School (`WaiversService.createWaiver()` — the exact
  population `WaiverSignatureRequestsProcessor` already notifies), and an
  EXISTING Waiver meeting a newly-joined Student (`SchoolsService.join()`,
  Decision 96 — the one real, production-reachable path that creates a
  `STUDENT` RoleGrant through the actual API). Both are handled by a new,
  dependency-free `WaiverAssignmentService`/`WaiverAssignmentModule`, kept
  separate from `WaiversService` itself specifically to avoid a circular
  module dependency between `WaiversModule` and `TenantsModule` (see that
  service's own header comment) — the same "duplicate a stateless
  registration rather than add a cross-module dependency edge" convention
  `TenantsModule` already used for `StripeClientService`/`R2ClientService`.
  - **Schema:** `WaiverSignature.signerFullName`/`signatureText`/`signedById`/
    `signedDate` are now nullable (migration
    `20261111000002_waiver_signature_unsigned_assignment`) — an Unsigned row
    has no signer, typed name/signature, or real signed date yet. The
    pre-existing partial unique index
    (`WaiverSignature_one_non_expired_per_student_per_waiver`) needed no
    change — it already covered Unsigned/Pending rows exactly like Signed
    ones.
  - **`WaiversService.sign()`** now UPDATES an existing Unsigned/Pending row
    to Signed in place when one exists for that Student+Waiver, rather than
    creating a second row (which the partial unique index would otherwise
    reject as a duplicate, wrongly reporting "already signed"). A genuine
    double-sign attempt (an already-Signed row) is still a clean 409, same
    as before.
  - **`GET /schools/{schoolId}/waivers/{id}/signatures`** (`WaiversService.
    findSignaturesForWaiver`) now returns real Unsigned rows alongside Signed
    ones, plus a new `summary` rollup (`{ total, signed, unsigned, expired,
    pending }`) and a `studentName` fallback label (the enrolled Student's
    own name) for rows with no `signerFullName` yet.
  - **`WaiversPage.tsx`'s `SignaturesPanel`** now shows the rollup count the
    backlog's own "Recommended display shape" named ("12 of 40 signed") and
    renders Unsigned entries distinctly (their own badge color, falling back
    to `studentName` for the signer label) in the same per-Student roster.
  - **`skills/ultm8-domain-rules/SKILL.md` §13** reconciliation: also marks
    the separate "any signed Waiver at the School vs. one canonical Waiver"
    question the backlog doc raised as resolved by the product owner ("any
    waiver at the School," matching current `BookingsService` code exactly)
    — no code change for that half, since the code was already correct.
  - `packages/api-client` regenerated. New/extended e2e coverage in
    `apps/api/test/waivers.e2e-spec.ts` (assignment at both trigger points,
    update-in-place, the partial unique index, cross-School isolation) and
    `apps/school-portal/e2e/waivers.spec.ts` (the panel's new display).
- **Waiver drawn-signature capture test coverage** (Track B, `apps/student`,
  `docs/TRACK-B-ROADMAP.md` Phase 4/Slice 6b). The capture UI itself already
  shipped on `master` (commit `318d491`, 11 Oct 2026): `WaiverRow.tsx` offers
  an OPTIONAL `react-native-signature-canvas` pad alongside the required typed
  full-name/typed-signature-text fields (the confirmed baseline, Decision
  74/78) — "Clear signature" to redo, "Submit signature" to save — wired to
  the real backend contract Phase 34/37 already shipped: a presigned-upload-URL
  dance against R2 (`POST /waivers/{id}/signature-upload-url`, a direct PUT
  of the PNG, no bytes through `apps/api`), then `signatureImageKey` on the
  existing `sign()` call. That prior commit shipped without a `WaiverRow.test.tsx`;
  this change adds one (8 cases: unsigned state, signed state, opening the
  form, the submit-disabled gate, typed-only submit, draw-then-submit,
  clear-signature, and the sign-error banner), matching this app's house
  style of mocking every query module and native dependency entirely. **Doc
  correction:** `docs/TRACK-B-ROADMAP.md`'s Phase 4 summary table still read
  "6b still blocked — needs a design pass + schema change" even though the
  backend (`signatureImageKey` on `WaiverSignature`, the DTOs, and the
  signature-upload-url endpoint) was already real and the capture UI itself
  had already shipped and been marked DONE further down the same doc — the
  table row was simply never updated alongside that. Corrected here.
- **Real photo uploads for every photo/logo/banner field app-wide**
  (`docs/v1.2-backend-backlog.md` — "Photo upload" bullets logged separately
  for Instructors/Branches/Franchises/Classes): every one of
  `Instructor.photoUrl`, `User.profilePhotoUrl`, `Branch.logoUrl`/`bannerUrl`,
  `Franchise.logoUrl`/`bannerUrl`, and `Class.bannerUrl` was a plain pasted-URL
  text field, with no real upload pipeline anywhere in this app. Product-owner-
  approved as a deliberately simpler alternative to the already-decided
  Cloudflare Images companion (Spec 55 §11.3) — resizing/thumbnailing stays
  explicitly out of scope for this change, left for Cloudflare Images if ever
  revisited.
  - **New backend: a second, PUBLIC-access R2 path, alongside the existing
    PRIVATE one** (`R2ClientService.getPublicPhotoUploadUrl`/
    `getPublicPhotoUrl`, new `R2_PUBLIC_BUCKET_NAME`/`R2_PUBLIC_BASE_URL` env
    vars) — a SEPARATE bucket from the existing private waiver-signature/
    certification bucket (`R2_BUCKET_NAME`), which this never weakens or
    touches. **Implementation judgment call, disclosed:** R2's own public-
    access mechanism is either its r2.dev subdomain or a custom domain mapped
    to the bucket via Cloudflare's CDN — this build is agnostic to which one
    ops actually configures; `R2_PUBLIC_BASE_URL` is just that bucket's
    resulting base URL, appended to an object key with no signing needed for
    reads (unlike the private path's short-lived presigned GETs, a public
    bucket's own GET needs no signature at all — only the upload-side PUT
    still does).
  - **New endpoint: `POST /uploads/public-photo-url`** (new `UploadsModule`) —
    ONE shared presign endpoint across all 5 entity types (an `entityType`
    enum), rather than 5 near-identical per-entity ones, since authorization
    for each is already a one-line delegation to the existing
    `TenantAuthorizationService` (School Owner for Instructor/Branch/Class,
    Franchise Owner for Franchise — mirroring each entity's own existing
    update-endpoint gate exactly) or to the exact same Staff-on-behalf-of-a-
    Student check `SchoolsService.updateStudentProfile` already makes (for
    User). Returns a presigned PUT URL plus the resulting permanent public
    URL — no separate "confirm the upload happened" step the way the private
    signature/certification flows have (`objectExists()`): this is public,
    non-legal-record data, so a never-uploaded URL simply 404s when viewed,
    no worse than the plain-pasted-URL status quo it replaces. A Franchise's
    own photo, requested before the Franchise exists, needs no gate at all —
    mirrors `POST /franchises` itself, which is genuinely self-service with no
    prior RoleGrant check.
  - **New shared component: `PhotoUploadField`** (`packages/ui`) — file
    picker, live preview (the current value, or a local blob preview of the
    just-picked file before upload completes), upload-in-progress state, and
    on success sets the form's URL field to the new public URL. Built once,
    reused across all 6 call sites — same "build the shared component once"
    discipline `PhoneField`/`TimezoneField` already established. **Max file
    size: 5MB, image/png + image/jpeg + image/webp only** — an explicit
    judgment call, disclosed: no existing size-limit convention anywhere else
    in this codebase to inherit from (checked first); 5MB was chosen as
    reasonable for a profile/logo/banner photo given no client-side
    resizing/compression is attempted.
  - **Wired into all 6 call sites:** `InstructorFormModal.tsx`
    (`Instructor.photoUrl`), `StudentUpdatePage.tsx`
    (`User.profilePhotoUrl`, Staff-on-behalf-of a Student), `BranchFormModal.tsx`
    (create) + `BranchSettingsPage.tsx` (edit) (`Branch.logoUrl`/`bannerUrl`),
    `FranchiseFormModal.tsx` (`Franchise.logoUrl`/`bannerUrl`), and
    `ClassFormModal.tsx` (`Class.bannerUrl`) — each replacing a plain
    `TextField` labeled "Photo URL"/"Logo URL"/"Banner URL" with the new
    `PhotoUploadField`. `packages/api-client` regenerated.
  - New e2e coverage (`apps/api/test/uploads.e2e-spec.ts`) over real Postgres:
    presign-URL issuance per entity type, each entity's own authorization gate
    (School Owner, Franchise Owner, Staff-on-behalf-of-a-Student), and the
    "can't request a key under a different School/Franchise's own namespace"
    cross-tenant check — same discipline the existing certification/signature
    upload tests already established. New Playwright coverage
    (`apps/school-portal/e2e/branch-photo-upload.spec.ts`) drives the
    `BranchFormModal` photo picker end-to-end via `page.setInputFiles()`,
    against a lightweight local stub standing in for the R2 PUT (no real R2
    credentials are configured in this environment at all — see that spec's
    own header comment for how it mirrors this repo's existing external-
    service-stubbing convention).

- **Timetable page redesign — Daily/Weekly/Monthly views + real click-to-book**
  (`docs/v1.2-backend-backlog.md`): `TimetablePage.tsx` was a plain weekday-
  grouped CRUD grid (Add/Edit a slot only, no booking) — this redesign builds
  the mockup's three described capabilities for real. **Correction to the
  backlog doc's own entry:** its "Blocking architectural gap" note describing
  the `TimetableSlot`↔`Class` relationship as `[UNRESOLVED]` was stale —
  `skills/ultm8-domain-rules/SKILL.md` §9 has stated this `[CONFIRMED]` since
  24 Aug 2026 (a bookable `Class` is either materialized ahead of time from an
  active, recurring `TimetableSlot` via the real, running
  `class-occurrence-generation` job — 4 weeks ahead, daily cron — or created
  as an independent one-off; `Class`'s own
  `@@unique([timetableSlotId, occurrenceDate])` guarantees at most one
  materialized row per slot+date). There was no remaining architecture
  question to resolve.
  - **New backend endpoint:** `GET timetable/:id/occurrence?date=YYYY-MM-DD`
    (`TimetableController.findOccurrence`/`TimetableService.findOccurrence`),
    Staff-only (`assertStaffAtSchool`, same gate `BookingsService` already
    uses), resolving a slot + calendar date to its materialized `Class` via
    the unique-constraint lookup. A date with nothing materialized yet (beyond
    the 4-week horizon, or the job hasn't run) is a clean, disclosed 404 —
    never created on demand (that would re-open the already-resolved
    "materialize ahead of time vs. on-demand" question) and never an
    unhandled 500. `packages/api-client` regenerated.
  - **Frontend:** a new Day/Week/Month range control (independent of the
    established `ViewToggle` Rows/Grid layout toggle also added here — Rows is
    the day-grouped agenda list, Grid is a day-columns look with left-border-
    colored cards) and a "Book" action on every rendered occurrence across all
    three range modes (agenda cards on Day/Week, dots on Month). The
    confirmation dialog (`TimetableBookingDialog.tsx`) is wired to the real
    `GET /schools/:id/students` roster and the real `POST /classes/:id/book`
    (`BookingsService.bookClass`'s existing Staff-on-behalf-of path, unchanged)
    — Confirm stays disabled until a Student is selected. A date beyond the
    generation horizon shows a plain "Not bookable yet" state instead of
    hiding the Book action or erroring — a disclosed limitation of the 4-week
    window, not a bug. No mockup was reachable this session (same situation
    `DashboardPage.tsx` was in) — the three views and the dialog were designed
    fresh against the backlog doc's own description of what was settled on.
    Payment is deliberately not collected inline (no other Staff-on-behalf-of
    booking entry point in this app does either); see the PR description for
    the disclosed layout judgment calls. New e2e coverage: an apps/api e2e
    spec for the occurrence endpoint (found/404/cross-School/non-Staff cases)
    and a Playwright spec for the page (view switching, booking flow, Student
    gating, the "not bookable yet" state).
- **Classes page — banner thumbnail and membership-inclusion badge**
  (`docs/v1.2-backend-backlog.md`): `Class.bannerUrl` and
  `Class.membershipInclusion` were already real, confirmed fields
  (`ClassResponseDto`/`CreateClassDto`/`UpdateClassDto`) and already
  editable via `ClassFormModal.tsx`, but neither was ever rendered on
  `ClassesPage.tsx`. Both views now show a small `bannerUrl` thumbnail (a
  plain placeholder square with the Class title's first letter when
  unset — same URL-only convention as `Branch.logoUrl`/`bannerUrl` and
  `Instructor.photoUrl`, no real upload pipeline exists app-wide) and a
  `Badge` ("Included in membership") when `membershipInclusion` is true.
  `termsWaiverRequired` is deliberately left unrendered — per
  `skills/ultm8-domain-rules/SKILL.md` §9/§13 as cross-referenced in the
  backlog doc, its enforcement scope needs an Architect re-check before a
  badge implying it's enforced is added.
- **Correction to the entry above — `termsWaiverRequired` badge, DONE.**
  The "needs an Architect re-check" caveat was itself stale:
  `skills/ultm8-domain-rules/SKILL.md` §9/§13/§18 all independently and
  consistently state enforcement is already resolved ("closed by logic
  review 25 Aug 2026"), not an open question. Per `CLAUDE.md`'s own
  source-of-truth hierarchy, the domain-rules skill outranks this backlog
  doc's note — this is a documentation sync, not a new product decision.
  `ClassesPage.tsx` now renders a plain `Badge` ("Waiver required")
  alongside `membershipInclusion`'s own badge, in both Grid and Rows.
- **`StudentUpdate.dc.html` — a Staff member can now edit a Student's profile
  on their behalf** (`docs/v1.2-backend-backlog.md`): previously a proposed
  new capability, not a build-out of anything already wired — the only
  profile-edit endpoint anywhere was the self-service-only `PATCH /users/me`.
  New `PATCH /schools/:schoolId/students/:studentId/profile` (Staff-only —
  School Owner/Manager, Branch Staff, or Instructor at that School;
  `TenantAuthorizationService.assertStaffAtSchool`, the same gate
  `BookingsService.findAllForStudent`/`getWeeklySummary` already use for a
  Staff member acting on a specific Student), with a new, additive RLS
  policy on `User` authorizing the write (the pre-existing self-only policy
  never covered a caller writing a different User's row). New
  `UpdateStudentProfileDto` reuses `UpdateUserDto` outright — same field set,
  same exclusion of `email`/`phone` (unique login/OTP identifiers Staff must
  not be able to redirect on a Student's behalf). New dedicated
  `StudentUpdatePage.tsx` (`/students/:id/edit`, not a Modal — mirrors
  Decision 231's Branch-settings-page precedent, since this is its own named
  screen in the design canvas, not a plain confirmation dialog), reached via
  a new "Edit profile" action on the real Student Detail screen
  (`StudentGradingPage.tsx`). Known limitation, disclosed rather than
  hidden: there is still no single-Student detail read endpoint, so only
  `firstName`/`surname` (known from the roster) are pre-filled — every other
  field starts blank and is sent only if typed, so this form can set a value
  but can't yet clear one it has no way to see. `packages/api-client`
  regenerated.
- **Students roster now shows each Student's photo** (plumbing gap: `User.
  profilePhotoUrl` already existed, resolved/editable via `GET`/`PATCH
  /users/me`, apps/student's `ProfileScreen.tsx`, but `StudentSummaryResponseDto`
  never resolved or exposed it, so the roster had no photo column at all).
  `SchoolsService.findAllStudentsForSchool` now resolves `profilePhotoUrl`
  from the same underlying `User` row other fields already come from — no new
  query, for either the ACTIVE path's direct select or the INACTIVE/ALL
  path's `resolveUserNames` (now carrying `profilePhotoUrl` for every one of
  its other call sites too, all unaffected since they don't read it).
  `StudentsPage.tsx` adds a small circular avatar column, reusing the existing
  `Avatar` component (`apps/school-portal/src/lib/Avatar.tsx`, already used by
  Instructors) — a real photo when set, an initials monogram fallback
  otherwise. `packages/api-client` regenerated.
- **Instructors — "Invite to Instructor Role" (existing-user invite, distinct
  from "Add manually")** (`docs/v1.2-backend-backlog.md`): a School Owner/
  Manager can now grant the Instructor role to a User who already has a ULTM8
  account (e.g. as a Student or Guardian), found by exact email/phone match —
  no new User created, unlike "Add manually". New
  `apps/school-portal/src/instructors/InviteToInstructorRoleModal.tsx`, a
  third entry point on `InstructorsPage.tsx` beside "Add manually"/"Add
  instructor", reusing the existing candidate-lookup endpoint and
  `POST /users/{userId}/role-grants` (both already real; no new backend
  endpoint needed — `INSTRUCTOR` was already a grantable role there).
  `RoleGrantsService.create()` now also sends a "you've been granted this
  role" notification email on every grant it creates (Instructor or Branch
  Staff alike) — previously missing entirely. Non-blocking: a delivery
  failure never undoes the grant (`emailSent: false` in the response, the
  same pattern `AddInstructorManuallyModal`/`CoachInvitePage` already use);
  `StaffPage.tsx`'s own pre-existing invite form now surfaces this flag too.
  New `CreatedRoleGrantResponseDto`. `packages/api-client` regenerated.
- **Classes page — row actions collapsed into a "⋮" kebab menu**: the 4
  always-visible per-row buttons ("View bookings", "Show QR", "Roll call",
  "Edit") were visually noisy at this row density; they're unchanged in
  behavior and visibility logic, just revealed on click now. New shared
  `RowActionsMenu` (`packages/ui`) — a small popover menu (outside-click/
  `Escape` dismissal, same ingredients as `TimezoneField`'s/`PhoneField`'s
  existing popovers; no dedicated `Menu`/`Dropdown` component existed yet),
  added to `packages/ui` rather than kept page-local since dense list-page
  tables with several per-row actions recur across this app (Branches,
  Disciplines, Curriculum, …). Pure presentation change, no backend/DTO
  change.
- **Notifications — a true, caller-wide Total/Unread stats ribbon**
  (`docs/v1.2-backend-backlog.md`, closing the "True total/unread counts" gap
  from Decision 204's Concept 5 finding): new `GET /notifications/me/counts`
  (self-scoped, same convention as `GET /notifications/me`), returning
  `{ total, unread }` computed server-side over the caller's full set of
  `Notification` rows rather than whatever page of the list endpoint happens
  to be loaded. `NotificationsPage.tsx` now shows a real two-tile stats
  ribbon (Total/Unread) backed by this endpoint, same `StatTile` pattern
  Transactions/Membership Plans already established. `packages/api-client`
  regenerated.
- **Dashboard — real "Bookings This Week" / "Upcoming" figures, plus a
  day-by-day, per-activity drill-down** (`docs/v1.2-backend-backlog.md`): the
  Dashboard page itself is new — no real implementation existed anywhere in
  this app before this (only a mockup, `Dashboard.dc.html`, in an external
  design-canvas tool outside this repo checkout; built fresh with the product
  owner's go-ahead rather than waiting on it). New `GET
  /schools/:schoolId/bookings/summary` (Staff-only), date-range filterable
  (defaults to the current Mon–Sun week), returning real `totalBookings`/
  `upcomingBookings` counts and a day-by-day breakdown grouped by the Class's
  raw `activities` string tags (not yet the canonical Discipline/styles FK —
  Decision 90's bridge, unchanged here). `apps/school-portal/src/dashboard/
  DashboardPage.tsx` (two KPI cards) links to a new
  `BookingsDrilldownPage.tsx` (the day-by-day/per-activity view, with its own
  editable date range) — a new "Dashboard" nav item routes to both.
  `packages/api-client` regenerated.
- **Every Timezone field is now a searchable combobox with live UTC offsets**
  (product-approved), replacing the plain free-text "IANA name" `TextField` on
  Branch create/edit (`BranchFormModal`, `BranchSettingsPage`) and School
  create/edit (`CreateSchoolPage`, `SchoolPage`). New shared
  `TimezoneField` (`packages/ui`): type-to-filter over the full IANA tz
  database (`Intl.supportedValuesOf('timeZone')`, ~418 zones on this runtime —
  not a hand-maintained list), each option showing its current, DST-aware
  UTC offset computed live via `Intl.DateTimeFormat`. Follows the ARIA 1.2
  editable-combobox pattern (`role="combobox"`/`aria-expanded`/
  `aria-activedescendant`, full keyboard support). The committed value stays
  a plain IANA string, same shape the free-text field carried — no
  DTO/backend change. First test infra added to `packages/ui` (Vitest +
  Testing Library + jsdom), this package having shipped with none; no other
  web app here unit-tests components either, only `apps/school-portal`'s
  Playwright e2e, which `branch-settings.spec.ts` now also covers for this
  field's actual combobox interaction (not `.selectOption()`).
- **Every mobile-number field now has a real country-code picker, worldwide**
  (Decision 240) — a new `PhoneField` (`packages/ui`, consumed by
  `apps/school-portal`; a parallel `apps/student` implementation, same
  `libphonenumber-js` logic) replaces plain free text on every phone/mobile
  field in both apps: Register/Forgot-Passcode/Reset-Passcode/Verify-OTP in
  both apps, School/Franchise `mobileNumber`, Branch `contactPhone` (both
  `BranchFormModal` and `BranchSettingsPage`), Instructor `phone`, and the
  Staff invite-candidate phone lookup. Always composes to a plain E.164
  string — no DTO or backend change. The app's `PhoneField` is Track B
  (`docs/TRACK-B-ROADMAP.md`).
- **Real server-side filters and pagination for the Branches, Franchises,
  Classes, and Students portal pages** (`docs/v1.2-backend-backlog.md`) —
  four pages whose list/filter controls previously only worked against an
  already-fully-fetched list client-side, or not at all:
  - **Branches** — the City filter now sends `GET
    /schools/:schoolId/branches?city=`, a case-insensitive substring match
    against `Branch.address` (Branch has no dedicated city column).
  - **Franchises** — Fee model and Activity filters now send `GET
    /franchises?feeModel=&activity=`. The Rows table's Name/logo cell is now
    itself a link to the Franchise detail page, not only the row's "View
    details" action.
  - **Classes** — the Discipline filter and "Search classes" box now send
    `GET /schools/:schoolId/classes?activities=&search=`; a Prev/Next pager
    is wired to the already-real `ClassListResponseDto.nextCursor`.
  - **Students** — a new Active/Inactive/All filter (`GET
    /schools/:id/students?status=`), defaulting to Active (the exact
    pre-existing behavior). `findAllStudentsForSchool` previously hard-coded
    `revokedAt: null`, so a revoked enrollment had no way to ever be seen;
    `StudentSummaryResponseDto` now carries a real `status`.
  All four are additive — a caller that sends none of the new query params
  sees unchanged behavior. `packages/api-client` regenerated.
- **"Invite a Student"** (`docs/v1.2-backend-backlog.md`) — a Staff member can
  now enroll an existing, already-registered-but-unenrolled person as a
  Student at their own School, from a new `/students/invite` page (linked
  from `StudentsPage.tsx`'s new "Invite a Student" button). Find-then-confirm,
  reusing the same exact-email/phone-match `GET
  .../role-grants/invite-candidate` lookup StaffPage's Instructor/Branch Staff
  invite flow already uses. No new endpoint: `SchoolsService.join()` (`POST
  /schools/:id/join`) gained a second on-behalf-of branch alongside its
  existing Guardian one, gated the same way as the Instructor/Branch Staff
  invite flow (School Owner/Manager only) — see this feature's own PR
  description for why this, not a `RoleGrantsService.create()`/
  `GrantableRoleDto` change, was the right-shaped fix, and for the explicit
  product question it leaves open (no "add a brand-new person" path exists
  here, unlike Instructors' own "Add manually"). `packages/api-client`
  regenerated.
- **Create/Update Membership Plan is now a dedicated page, built as a
  multi-step wizard** (Decision 228) — the first entity in the app to move
  off the List + Modal pattern, given how large this form is (12 fields,
  several type-driven rules). Its 5 field groups (Basics / Pricing & Access
  / Policies / Disciplines & Lessons / Visibility) show one at a time, with
  a clickable step row that jumps straight to any step. The fields a
  selected Plan Type doesn't use (e.g. "Classes included" for a
  Subscription) hide automatically, and picking a "Scoped to Class" now
  locks Classes included to 1 immediately instead of only catching the
  conflict on Save. Currency is now a dropdown of the platform's 6
  supported currencies instead of free text. A new **Duplicate** action on
  the Membership Plans list pre-fills the Add page from an existing plan.
  **api:** fixed a bug where clearing a plan's refund/credit cutoff date on
  Edit silently did nothing; `UpdateMembershipPlanDto.refundFeeDate` is now
  nullable. `packages/api-client` regenerated.
- **Belts and stripes can be reordered by dragging** (Decision 152.2). Each
  belt in the ladder, and each stripe line in the belt editor, has a drag
  handle; dropping it on another row moves it there. The ↑/↓ buttons stay for
  the keyboard, and saving asks for the same confirmation naming the students
  affected.
- **"No branch" group on the Grading Board** (Decision 148.2). The owner
  now sees students who have no home branch yet in their own group above the
  columns (no branch coach sees them) and gives each one a branch there. Board
  items carry `noHomeBranch` (owner only).
- **Instructor roster/detail now show a real email and Active/Revoked
  status, and the invite-candidate lookup now returns a real email**
  (v1.2 backend backlog). `GET /instructors` and `GET /instructors/:id`
  resolve `email` alongside `firstName`/`surname`, plus a `status` derived
  from whether the linked User still holds a non-revoked INSTRUCTOR
  RoleGrant at this School; `GET .../role-grants/invite-candidate` now also
  returns `email` (`null` when no match). **api:** `InstructorResponseDto`
  gains `email`/`status`; `InviteCandidateResponseDto` gains `email`.
  `packages/api-client` regenerated.
- **Joining a School from the app, with a home branch and a current belt**
  (Decisions 137, 147, 209). A School's public page now lists its branch
  names, name only, so a student can choose a home branch before joining.
  New `GET /students/{id}/ranks/declare-options` lists the styles a student
  can still declare a belt in, with their belts, for the student or their
  guardian. The app's join screen is Track B (`docs/TRACK-B-ROADMAP.md`).
- **Lesson access is also checked by the database** (Decision 208). A
  lesson's description, video and captions now live in their own table,
  which the database only lets staff, everyone at the School for a free
  lesson, and students whose live membership covers the lesson's style read
  (a guardian through their child). The lesson's title and category stay
  visible to everyone at the School, as before; nothing changes on screen.
  **api:** `LessonContent` (migration `20261104000000`, with RLS:
  `can_view_lesson_content`, `is_lesson_staff`); existing content copied.
- **Belt-level "years in rank" flag removed** (Decision 207). Each stripe
  has its own "time in rank only" switch, which grading uses; nothing changes
  for students. **api:** `Rank.yearsInRankFlag` dropped (migration
  `20261103000000`); a belt no longer takes or returns it.
  `packages/api-client` regenerated.
- **Belt-level weekly cap and required skills removed** (Decision 199). They
  live on each stripe, the plain belt's own (e.g. "Brown Belt", no stripes)
  included, and grading reads only those, so no student's requirements
  change. **api:** `Rank.weeklyClassCountCap` and `RankRequiredSkill`
  dropped (migration `20261102000000`); a belt no longer takes or returns
  `weeklyClassCountCap` / `requiredSkillIds` (sending them is a 400).
  `packages/api-client` regenerated.

- **Deleting** (Decision 198). The owner can delete a lesson, and a skill,
  belt or style that has never been used: **Delete** on the Curriculum,
  Disciplines and style pages, with a confirmation. Anything a student's
  record uses is kept and the window says why (someone holds the belt, it's
  in grading history, students were marked on the skill, a class or lesson
  uses the style). A deleted belt's stripes go with it and the belts after it
  move up; a deleted style takes its belts, skills and coach permissions and
  comes off membership plans and instructors. **api:** `DELETE
  /disciplines/{id}`, `/ranks/{id}`, `/skills/{id}`, `/lessons/{id}` (owner
  only; 204, or 409 with the reason). `packages/api-client` regenerated.

- **Grading for the student app** (Decisions 132, 142, 155, 161). **api:**
  `GET /students/{id}/grading` gives the student, or a guardian of theirs,
  every style they hold a rank in at every School they're a student at,
  with the School and style names, the ladder (stripe names and belt
  colours), progress toward the next grade (always shown, "Ready to grade"
  included) and the skills for it, by name. It reads under the student's own
  context, because a guardian holds no role at the School; nobody else may
  read it, and a School the student has left isn't shown.
  `packages/api-client` regenerated. The app's screens are on Track B
  (`docs/TRACK-B-ROADMAP.md`).
- **Grading hardening reports** (Phase 7). The acceptance pass, the grading
  stress test and the decision conformance review are in
  `docs/grading-integration/hardening/`, with a page saying where each
  finding went. Gus's prototype scenarios now run in CI against the real API
  (`apps/api/test/grading-acceptance.e2e-spec.ts`: the three IBJJF templates,
  eligibility on a sample of their stripes, grade and downgrade rules, a
  600-student board with bulk promote, hostile text, random actions;
  `ACCEPTANCE_FULL=1` runs the full size). The domain rules file no longer
  says the grading rules are mostly unbuilt, and marks where Decisions 93,
  136 and 173 replaced older lines.
- **Who can watch lessons** (Decisions 154, 190, 195). Each membership plan
  now ticks the styles it covers and has **Includes lessons** (on by default
  for plans with a price, off for free ones; the owner can change it). A
  student, or their guardian, can watch a lesson when a live membership of
  theirs is on a plan that includes lessons and covers one of the lesson's
  styles (its skills' styles); the owner can make any lesson **Free for
  everyone at the School**; staff see every lesson. Other lessons show as
  locked: title and category, no description or video. Existing plans cover
  every style their School has and include lessons when priced, so today's
  members keep what they see now. **api:** `MembershipPlan.disciplineIds` /
  `includesLessons` and `Lesson.free` (migration `20261101000000`); lesson
  responses add `free` and `locked`; new `GET /students/{id}/lessons` for the
  student or their guardian; only the owner sets `free`.
- **The typed "Belt / ranking" on an instructor is gone** (Decision 196).
  Instructors choose their own belt per style on "My belts" (Decision 188), so
  the owner's free-text field on the Instructor form is removed, with its
  stored values. The lesson form's instructor list now shows names. **api:**
  `beltRanking` removed from the instructor create/update/response shapes
  (migration `20261031000000` drops the column).
- **History notes can be edited and hidden; every change is kept** (Decision
  192). On a student's grading page, the owner and anyone who may grade that
  student in that style ("Promote" or "Move down") can edit a history entry's
  note, or add one, and hide it from the student and guardian, or show it
  again. Staff see "Edited" and "Hidden from the student"; the owner can open
  every change (who, when, old and new text). Students and guardians get no
  hidden note, nor a sign one was hidden. System notes, downgrade reasons and
  voided entries are not changed. **api:** `PATCH
  /students/{id}/rank-history/{eventId}/note` and the owner-only `GET
  …/note-log`; `PromotionEvent.noteEditedAt/noteEditedById/noteHiddenAt` and
  `PromotionEventNoteLog` (migration `20261030000000`), whose RLS lets the
  owner read it and never the student.
- **Lesson categories, in order** (Decisions 128.15, 191). Lessons are now
  grouped into the School's own list of categories, in the order shown to
  students, and ordered within each. The Curriculum page adds, renames and
  reorders categories, moves lessons up and down within a category, and the
  lesson form picks a category from the list (a new one puts the lesson at
  its end). Existing free-text categories became real ones (names differing
  only by spaces merged; blank ones became "No category"). **api:**
  `LessonCategory` with RLS (anyone at the School reads; its staff write) and
  `Lesson.categoryId`/`order` replace `Lesson.category` (migration
  `20261029000000`); lessons are listed in category order. Lesson responses
  keep `category` (now the category's name) and add `categoryId` and `order`;
  create/update take `categoryId` instead of free text. New: `GET|POST
  /schools/{id}/curriculum/categories`, `PATCH /curriculum/categories/{id}`,
  `PUT /schools/{id}/curriculum/categories/order` and
  `PUT /curriculum/categories/{id}/lessons/order`.
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
- **Belts waiting to be verified: a notice at login** (Decisions 137, 189).
  When the owner, or a coach or Branch Staff member who may verify belts, logs
  in to the School Portal, a notice lists the students whose self-declared belt
  is waiting to be verified, each linking to the student's grading page; it
  shows once per login and not at all when nothing is waiting. **api:**
  `GET /schools/{id}/rank-verifications` is no longer owner-only: coaches get
  the styles where they have "Verify ranks", for the students of their own
  branches (the Grading Board's read path); other staff get an empty list.
  Each item now carries the student's name and the style's name.
- **Belts and stripes, not "rungs"** (Decision 187). Screens and messages now
  say belt and stripe: the belt editor lists a belt's **Stripes** ("Stripe name",
  "Add stripe", "Reorder stripes?"), the ladder shows each belt's number of
  stripes, the style templates count "grades (each belt and each stripe)", and
  the API's grading and ladder error messages use the same words.
- **Staff given a role again start fresh** (Decision 193). Removing someone's
  last Instructor or Branch Staff role at a School now clears their grading
  permissions there, and removing their Branch Staff role clears "Can invite
  coaches", so if they're added again later the owner grants what applies now.
  Losing one branch while they still coach at another keeps their grading
  permissions. The board's "inactive hidden" count already includes students on
  the top stripe (Decision 194); a test now pins it.
- **Fix: a replayed sign-in token always signs out every session.** When the
  same refresh token was used twice at the same moment, the sweep that signs
  out every session could run before the winning request had saved its new
  token, leaving that one valid (about 1 run in 12 of the test). **api:** the
  rotation and the new token are now written in one transaction, so the sweep
  always sees it.
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
    (`GET /schools/{id}/rank-verifications`). Coaches and Branch Staff who
    may verify a style get their own branches' list from the same endpoint
    (added with the login notice, Decision 189).
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
