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

- **Legal go-live: "I agree" step, 18+ sign-up and the Children notice version**
  (Track A and Track B; Decision 444). **Needs a database migration**
  (`20270324000001_legal_acceptance`).
  - Creating an account (portal and app) needs a tick to agree to the Terms of
    Service and the Privacy Policy; creating a School or a Franchise needs a
    tick to accept the School and Franchise Agreement. The version accepted
    and when are saved.
  - Nobody under 18 can create their own account; the message tells them to
    ask a parent or guardian.
  - Guardian consent is saved with the Children notice version the server
    publishes, and the app links to the notice.
  - Each legal page has its own address (`/legal/<page>` in the portal, a
    screen in the app) and says it is being prepared until its text is loaded.

- **Stress test round 5 fixes** (Track A and Track B; Decisions 430–434;
  `docs/handover/STRESS-TEST-ROUND5.md`). **Needs database migrations**
  (`20270220000000` to `20270224000000`, nine in all).
  - *Families (430):* a parent who also trains or coaches at the School books,
    wait-lists, cancels and uses Kid Mode for their child as the parent. A
    child needs a parent's consent before booking or check-in; parents give it
    when adding the child or in the app, and see each other's status. At 18 a
    child signs for themselves; the parent keeps read and payment access for
    30 days. Parents can remove themselves and owners can remove a parent,
    never the last one. "Add another Guardian" on a child's page; adding the
    same child twice is refused. Under-18s can't be Guardians or buy plans for
    themselves. Ages are counted on the School's own date. Another School's
    export leaves out parents' emails it never had. A clearer message when an
    email is already in use. Staff can no longer change a shared member's
    name, date of birth or gender.
  - *Money (431):* money is rounded, shown and typed in each currency's own
    unit and decimals (yen, won and krónur have none; dinars have three).
    Late-cancel and no-show fees use the plan's or School's currency, never US
    dollars by default. Up to two named tax lines with registration numbers
    (School, with a Branch override) on invoices and receipts. Owners can
    record a refund given by hand for a desk sale; a taken payment can no
    longer be cancelled. The Transactions filter uses the School's own days,
    and the CSV adds a School-time column. Members and their Guardians are told
    when a price increase reaches them. Up to 5 Friend Passes at once. Pix only
    for Schools in Brazil or pricing in reais. A desk sale sends "Payment
    confirmed". Two price changes at once no longer overwrite each other.
  - *Time (432):* weekly classes can run past midnight (up to 12 hours,
    "ends next day"). Portal class times show on the class's own clock.
    "Who can book" limits a class or slot to women, men or an age range.
    Closures' dates can be changed and cancelled classes recreated; a one-off
    class on a closed day asks to confirm. Changing a time zone re-times
    upcoming classes and tells booked students. The Dashboard week starts on
    the School's chosen day; day passes end on School calendar days. A bad
    time-zone name no longer stops other Schools' classes being made.
  - *Privacy and staff (433):* 90 days after a School closes, members'
    non-financial data is deleted and all roles end (the Close School card
    says to export Transactions first). Branch Staff need "Bookings and
    check-in" to see roll call and waitlist. Coaches get a clear refusal
    message. Booking and cancelling the same class at once no longer errors.
    The front-desk tablet locks after 20 wrong codes in 30 minutes.
    Co-owners, coaches and Branch Staff can give up their own role; ULTM8
    support can pause a coach or Branch Staff member. Owners can download one
    member's data (logged). The "Active and former" export leaves former
    members' phone and date of birth blank.
  - *Names and text (434):* name search ignores accents, capitals, Arabic
    spelling variants and full-width characters, and finds Japanese names
    family name first. Initials show the whole first letter in every script.
    Notice dates show in the reader's language. New "English (US)" setting.
    Hidden NUL characters are refused with a clear message. Right-to-left PDFs
    and printouts lay out correctly. A "Has only one name" tick replaces "." as
    a surname. Two sign-ups at once no longer duplicate. Approving a walk-in
    keeps the phone and emergency contact they gave at the desk.

- **Stress test round 6: timing fixes** (Track A; Decision 446 items 5–8,
  findings T-1 to T-4). **Needs database migrations** (`20270332000001`,
  `20270332000002`).
  - *A card payment Stripe took is never lost (T-2):* automatic payment of
    charges tags Stripe's payment with the payment attempt (written Pending
    before Stripe is called), so Stripe's success notice finds it even if the
    worker stopped before saving the answer. Each daily run first asks Stripe
    about attempts still Pending after an hour and settles them (paid, or
    failed with the usual notice). While an automatic payment is Pending its
    charge gets no overdue notice or late fee. A late-cancellation fee is
    recorded the same way.
  - *Member limits hold under load (T-3):* Cash, bank transfer and Pix orders
    (and free plans) for a plan with a member limit are placed one at a time,
    so orders arriving together can't all pass the limit.
  - *Stripe readiness can't go back in time (T-4):* an older "account updated"
    message finishing after a newer one no longer overwrites it; each saved
    answer keeps when it was asked of Stripe.
  - *18th birthdays (T-1):* someone who signed up themselves is 18 at every
    School from the moment sign-up counts it (the earliest time zone), so they
    can sign waivers and buy at once, and "sign again at 18" doesn't ask them
    again. A parent can't add as a child someone old enough to sign up. People
    the School created keep the School's own date.

- **Stress test round 6: regression fixes** (Track A; Decision 447 items 1–3,
  findings R-1 to R-3). No migration.
  - *Booking is back to round 5's speed (R-2):* the waiver, child-consent and
    "Delete my account" checks added since round 5 read what they need in one
    go before the booking's locked step, instead of one by one inside it on a
    second database connection. A booking makes 29 database statements again
    (38 before) and a 10-School booking race is back to round 5's times; in a
    race with a smaller connection pool, far fewer "server busy" answers and
    every class filled exactly. Desk sales check the member in one read
    instead of reading the School's whole student list, and share one step
    for their checks. Booking and sale rules are unchanged.
  - *Check-in rules save after a School passes 500 students (R-1):* the page
    shows 6-digit codes as soon as the School is past 500 (the School is
    moved to 6 digits when the page is read), and saving what the page shows
    is never refused. Choosing 4 at a School already on 6 is still refused.
  - *Student export (R-3):* someone with no role at the School, or a School
    that doesn't exist, now gets "School not found" like every other page.
    Staff without the owner's switch still get "The School owner hasn't let
    you export the student list."
- **Stress test round 6: access and privacy answers** (Track A; Decision 448
  items 6, 7, 9, 11 and 17). No migration. New endpoint
  `GET /schools/{schoolId}/card-payments`.
  - *Only the main owner sets staff access (item 6):* the Access window,
    grading permissions, "Can manage disciplines", "Can create / cancel
    charges" and "Can start open mat sessions" are changed by the School's
    main owner only, as adding and removing people already was. A co-owner is
    told "Only the School's main owner can change what staff are allowed to
    do." The portal shows co-owners these switches locked, with a note, and
    no "Access" action on the Staff page.
  - *No charges for a member being deleted (item 7):* creating a charge,
    setting up a recurring charge or restarting a stopped one for a member
    whose deletion is pending is refused, as a desk sale is.
  - *The payment account is for the payments area (item 9):* the School's
    payment account record (with its Stripe account id) is read only by owners
    and Branch Staff with a payments permission (Record a payment, Can create
    charges, Can cancel charges or Can connect Stripe). Other staff, coaches
    and members get "not found". Whether the School takes cards is read by
    everyone at the School from the new endpoint, which the plan form and the
    student's Memberships card now use.
  - *Editing a student is for those granted it (item 11):* a student's
    profile is edited by owners and Branch Staff with "Manage students".
    Coaches can still open the student, their profile and the rest of their
    page, but not edit the profile; the portal hides "Edit profile" for them.
  - *"Not found" for outsiders (item 17):* every endpoint refused by one of
    the owner's switches answers "School not found" to someone with no role at
    that School, or for a School that doesn't exist, as the student export
    does. The School's own members still get the switch's message.
- **Stress test round 6: the timing fixes' follow-ups** (Track A; Decision 447
  items 4–6). **Needs a database migration** (`20270336000001`).
  - *No card payment is lost in a crash on the remaining paths:* no-show fees,
    freeze fees, plan switches and buying with the saved card are now recorded
    before the card is charged and tagged on Stripe's payment, as automatic
    payments and late-cancellation fees already were. If the server stops
    after Stripe took the money, Stripe's success notice or the daily check of
    attempts still open after an hour settles it. A plan switch or saved-card
    purchase paid this way starts its membership exactly once, whichever gets
    there first; one refused meanwhile (the member holds a pass already, the
    next plan filled up, or the School closed) is refunded once. A no-show fee
    still has no row on the Transactions page; its booking records it (until
    Decision 448, below).
  - *Member limits hold for the waiting list and plan switches too:* a place
    held for someone on a plan's waiting list, and the plan a switch starts,
    are given one at a time per plan with the limit counted again, as orders
    are.
  - *Cancelling just after a freeze is approved:* a card member who cancels
    after a freeze is approved but before Stripe has applied it keeps the
    right end date: when the freeze reaches Stripe, the cancel date moves with
    it (and back again if the freeze ends early), in the app and on Stripe.
- **Stress test round 6: the owner's money answers** (Track A, and Track B's
  payment history; Decision 448 items 1, 3, 5, 18 and 19). **Needs two
  database migrations** (`20270401000001`, `20270401000002`).
  - *Card surcharge as its own line:* the billing overview has a Card
    surcharges figure and column (part of Total revenue), and the Transactions
    page a Card surcharges tile. The Memberships figure and the Transactions
    page's Total revenue are now the price of what was sold only. Both pages
    count the surcharge the same way; a refund comes off the price first.
  - *A plan switch never costs more than its notice said:* the 7-day notice's
    amount is kept, and on switch day the card is charged that amount or the
    price then, whichever is lower.
  - *Pix only in Brazil:* Pix is offered, and named in hints, only for a
    School whose address is in Brazil (pricing in reais no longer counts), and
    the API refuses a Pix desk sale or desk payment anywhere else, with a
    message in every language.
  - *No-show fees on the Transactions page:* a no-show fee charged to the card
    (or tried and declined) is a "No-show fee: class" row, counted in revenue
    with the other fees, and shown in the member's payment history; fees
    charged before are added by the migration.
  - *"Payment confirmed" for a saved-card purchase that went through later*
    (settled by Stripe's notice or the hourly check), sent once.

- **Launch rehearsal 1** — a UK School (cards through Stripe Connect, against
  a pretend Stripe) and a Brazilian School (Pix or cash, confirmed by the
  School) taken through every main journey end to end: setup, staff and
  payroll, buying, parents and children, classes and check-in, refunds,
  freezes, plan switches, "Delete my account", Portuguese, and cross-tenant
  checks, through the API and in a browser. 238 checks passed and none failed;
  six questions for the product owner. Report in
  `docs/handover/LAUNCH-REHEARSAL-1.md`, scripts in
  `apps/api/scripts/rehearsal/`. No product change.
- **Launch rehearsal 1: four small fixes** (Track A and Track B, Decision 441
  items 7–10). An address shows its country in the reader's language
  ("…, Brasil" in Portuguese); the stored text is unchanged. A style made
  from an IBJJF template names its belts and stripes in the School's
  language ("Faixa Branca · 1 Grau"); styles made before keep their names.
  The "Delete my account" notice gives the date and time in the member's own
  time zone instead of UTC. Adding a coach profile for someone who never had
  the Instructor role now says to give them the role first (error code
  `NOT_AN_INSTRUCTOR`), in all 15 languages.
- **Translation review: 12 languages** (School Portal, member app and server
  text; `docs/translations/REVIEW-other-languages.md`). Covers Arabic, German,
  French, Italian, Japanese, Korean, Dutch, Polish, Russian, Thai, Turkish and
  Chinese. 867 strings corrected:
  - one form of address per language: German "du", French "vous", Turkish
    "siz", Korean 합니다 statements;
  - one word per term: German "Graduierung" for grading (not "Beförderung"),
    Italian "striscia" for a stripe (it was "grado", the same word as rank),
    Korean 도장/수련생 for School/Student;
  - Arabic "back" arrows now point the right way in right-to-left text;
  - clearer early-exit fee wording in ar, ru, tr and zh-CN.

  The review lists the terms each language uses, and the legal and payment
  strings a native speaker should check before each market launches. Only
  text values changed; no keys or placeholders. No migration.
- **Student portal: parents and passcodes** (Track B, `apps/student`;
  Decision 428) — a parent signs their child's waivers and buys their child a
  plan from "My children". Change passcode is on Home (other devices are
  signed out). A one-off class that needs its own ticket now shows that
  ticket to buy. New API reads: `GET /guardians/me/minors/:studentId/waivers`
  and `GET /classes/:id/ticket-plans`. No database change.
- **Student portal fixes** (Track B, `apps/student`; Student portal review
  SP1–SP13, Decision 427) — the School picked on first launch no longer forces
  the Join screen (Home shows a "Join this School?" card instead). The parent
  menu shows for anyone with a child linked. My bookings shows class names,
  times, the School, and the person's waitlist places with "Claim spot" and
  Leave (new `GET /waitlist/me`). My memberships shows plan and School names.
  Kid Mode needs the parent's PIN to exit. Waivers can be read in full, and
  the signing form has Cancel. Already-booked classes show as booked, plans
  say "Join this School to buy" to non-members, status words read as words,
  the sign-in screen shows the picked School, and removing a card asks first.
- **Delete my account** (Track B, `apps/student`, and `apps/api`; Decision
  427 item 5, required by Apple; Decision 436 items 1–6)
  — My profile → "Delete my account" says what happens, names the children
  deleted too, and asks for the passcode again. The account is locked at once
  (signed out everywhere; no booking, check-in or purchase, by anyone), its
  recurring payments stop, and signing in again within 30 days cancels it.
  After 30 days a daily job anonymises it as "Erased User": login, name,
  contact details, date of birth, photo, passcode and medical notes go, and so
  do staff notes, files the School uploaded, custom fields, tags, import rows
  and invites; their name in older staff activity lines and staff notices
  becomes "Erased User". Their upcoming bookings and waitlist places are given
  up as when a School removes a member (no fee). Payments, signed waivers,
  contracts, belt and attendance history stay with the School, unnamed. A child goes too only when this was their only parent and they have
  no login of their own. The main owner of an open School or Franchise must
  hand it over or close it first. The member is emailed; each School's owners
  get a "A member left" notice. New `GET`/`POST /users/me/deletion`; sign-in
  answers `deletionCancelled`. **Needs a database migration**
  (`20270227100012_account_deletion`): four `User` columns, a write-only
  `AccountErasureLog`, and one narrow `erase_due_account` function (the jobs
  role may only call it, and it refuses accounts that aren't due).
- **Stress test round 6: access and privacy fixes P-1 to P-5** (Track A,
  `apps/api` and `apps/school-portal`; Decision 445). **Needs a database
  migration** (`20270335000001_erasure_clears_coach_and_staff_details`: the
  same `erase_due_account` function with a longer body, and column grants to
  its owner only).
  - When a person is finally erased, their coach profile at each School loses
    its phone, bio and photo (the photo file is deleted too) and is archived,
    so members no longer see it. The School's display name and work phone for
    them as staff are cleared, and the work phone leaves older staff activity
    lines.
  - A waiting Pix, cash or bank-transfer order of a member whose deletion is
    pending can't be confirmed (`ACCOUNT_CLOSING`, as a desk sale). It can
    still be cancelled, and confirmed again if they sign back in.
  - Only an owner creates the School's payment account (Stripe or cash/bank
    transfer). Staff with "Can connect Stripe" start or continue Stripe's
    onboarding once an owner has chosen Stripe; until then their Stripe card
    says an owner must choose how the School is paid.
  - Branch Staff who confirm an order get back only its id, status, amount and
    the membership it started.
- **Student app: class times on the School's clock** (Track B, `apps/student`;
  Decision 427 SP6) — class times in the app (a School's classes, Kid Mode,
  My bookings, My waitlist, a child's bookings) now show on the class's own
  clock (its branch's time zone, else the School's), not the phone's, so a
  member travelling or in another zone sees the times the School advertises.
  **Needs a database migration** (`20270214000001_discovery_class_timezone`):
  three column-level read grants to the discovery role (School and Branch
  time zone, and which Branch a class is at), nothing else.
- **Coaches portal answers** (Decision 425) — Branch Staff see their
  branch's classes this week on their dashboard, with roll call and QR links
  when they handle bookings. Coaches get a read-only Students page with the
  Attendance tab. Uploading a certification needs the consent tick. "Coming
  up" shows each class's start time and branch. "Complete your profile" is
  now "My coach profile".
- **Coach dashboard in the app: class time and branch** (Track B,
  `apps/student`; Decision 425 Q4) — "Coming up" on the app's coach
  dashboard shows each class's start date and time on the class's own clock
  (its branch's time zone, else the School's) and the branch name ("Whole
  School" when it has none), as the web dashboard does. No API or database
  change.
- **Web coach dashboard: no "Whole School" for a branch it can't show** —
  the portal's coach dashboard labelled a class "Whole School" whenever it
  couldn't find the class's branch (for example while the branch list was
  still loading). It now shows no branch name then, as the app does. "Whole
  School" is only for a class with no branch.
- **Coaches portal fixes** (Coaches portal review CP2–CP6, Decision 424) —
  the coach dashboard no longer lists archived weekly slots, and marks a
  cancelled class "Cancelled" with no roll call or QR link. An owner who also
  coaches at another School picks it in the header's School switcher (marked
  "Coach") and gets that School's coach screens; picking an owned School goes
  back. Owner-only pages typed in by a coach send them to their dashboard
  instead of a blank page, and the header shows the role held at the School
  being viewed. (Track B: the app's coach dashboard now finds the coach's own
  classes in any size of School.)
- **Popups keep what you typed** — clicking outside a popup (Add branch, and
  every other form popup), or pressing Escape, used to close it and throw away
  what had been typed. It now does that only while nothing has been typed or
  changed. After that, only the popup's own Cancel or Save closes it. Pressing
  inside (selecting text, say) and letting go outside no longer closes it
  either.
- **School footer links: errors under the field** — on the School page's
  Footer card, a social link that isn't a web address ("my school page") is
  now pointed out under that link, and nothing is saved until it's fixed.
  Links typed without https:// still get it added. The same goes for the
  contact email.
- **School ad tracking IDs** (Decision 318 item 10) — a new **Ad tracking**
  card on the School page, for the owner, takes the School's Meta Pixel ID
  and/or Google Analytics (GA4) measurement ID: ready-made connections only,
  no custom code. Only the exact formats can be saved (10–20 digits; "G-"
  and 4–16 capital letters or digits), checked in the portal, the API and the
  database (CHECK constraints), so no script or markup can be stored. Where
  they load, and the visitor's cookie consent: see the next entry. Migration `20270215000002_school_ad_tracking`; School
  gains `metaPixelId` and `googleAnalyticsId`. 15 languages.
- **Ad tracking on the schedule embed, behind cookie consent** (Decision 318
  item 10; Decision 435 items 24–27) — when a School has saved a Meta Pixel or
  Google Analytics ID, its public schedule embed now shows a cookie-consent
  banner first, in the page's language (15 languages), naming the services.
  Nothing from Meta or Google loads until the visitor clicks **Accept**: the
  page's security policy names no Meta/Google host before then, so the
  browser itself blocks them. After Accept the page reloads with only the
  exact hosts those IDs need allowed, and records a page view; Decline hides
  the banner. The choice is kept for that visit only (the browser tab), so
  the banner asks again on the next visit; no cookie of ULTM8's own. No
  personal data is sent; Google signals, ad personalisation and Meta's
  automatic events are off. The one "sign-up" event is ready for the website
  sign-up form's thank-you page once it exists (never fired by the embed).
  Google Ads (AW-) and Tag Manager IDs are still not offered. Never on the
  portal, sign-in, waivers, payments or the member app. The School page's Ad
  tracking card now says where the IDs are used (15 languages). **Needs a
  database migration** (`20270220130001_schedule_embed_ad_tracking`: one
  read-only function for the embed link).
- **Uploads before file storage is set up** — choosing a logo, banner or other
  file while Cloudflare R2 isn't configured now says "File storage isn't set up
  yet. Try again later." (translated) instead of "Internal server error". The
  API answers 503 instead of 500.
- **Check-in rules: overdue payments and belt progress** (backlog 3.5) — two
  more rules on Check-in → Check-in rules, for every way in (app, coach's
  scan, front desk, tablet):
  - **Block check-in for overdue payments**: No (the default, as before),
    after 7 days or after 14 days. A member who still owes on an invoice that
    long after its due date is refused with "This School doesn't check members
    in while a payment is overdue", shown to staff and to the member. Paid
    and cancelled invoices never count.
  - **Show belt progress on the check-in screen**: on by default, as before.
    When off, the welcome card on the front desk and the tablet no longer
    shows the classes toward the next belt.

  The owner, and Branch Staff with "Change check-in rules", change them.
  Needs migration `20270123000000_check_in_rules_rest`.
- **Check-in rules: check in without a booking** (Decision 422 item 2) — a
  new switch on Check-in → Check-in rules, **off by default**, so a booking is
  still needed, as before. When the owner switches it on, a member can check
  in to a class they haven't booked, with the app QR, the app code or the
  coach's scan. The check-in books a place first, by the booking's own rules:
  a full class is refused with the same message as booking it, and the
  member's membership pays for it, a Class Pack credit used as a booking uses
  one. Every check-in rule still applies (the check-in window, waivers, home
  branch, frozen memberships, overdue payments), and a refused check-in books
  nothing. The front desk already booked a place when it checked someone in
  and still does; a locked tablet still needs the app QR or a code to book.
  Open mats are unchanged. The owner, and Branch Staff with "Change check-in
  rules", change it. Needs migration
  `20270207120000_check_in_require_booking`.
- **Waiver must be signed before booking or check-in** (Decision 441 item 5;
  launch rehearsal D5) — the "Need a signed waiver to check in" switch on
  Check-in → Check-in rules becomes **"Waiver must be signed before booking
  or check-in"**, now **on by default**, and every existing School is
  switched on too. While it's on, a member, or a child through their parent,
  who hasn't signed the School's waiver can't book a class, join its waiting
  list, claim an offered place or check in, whoever books for them (the
  member, a parent, staff, or a check-in that books a place first). A School
  with no waiver in use (none, or only archived ones) stops nobody. Buying a
  plan isn't blocked. When off, a class marked as needing a waiver still asks
  for one at booking, as before. The refusal has its own message in the
  portal and the member app, in every language. Needs migration
  `20270303000001_waiver_before_booking`.
- **Waiver before booking: past attendance and a "Sign the waiver" button**
  (Decision 442 item 1) — importing past attendance is no longer refused by
  "Waiver must be signed before booking or check-in": those visits already
  happened. The School's other check-in rules (home Branch only, overdue
  payment) still apply to imported visits. In the member app, the waiver
  refusal (booking a class, joining or claiming a waiting-list place, checking
  in by scan or code) now has a **"Sign the waiver"** button that opens the
  School's waivers to sign, or, for a parent booking for a child, the child's
  waivers at that School. In every language.
- **Fixed: class times in British Columbia from 1 Nov 2026** — British Columbia
  stays on UTC-7 from 1 Nov 2026. The API ran on Node 20, whose time-zone data
  doesn't know this, so Vancouver classes would have come out an hour off. The
  API (Render, the Docker image) and CI now run Node 22.23.4 (time-zone data
  2026e), and a test fails on any Node whose data is too old.

- **New: member details — join date and other contacts** (Decision 315
  items 4 and 5; v1.3 backlog 5.1 and 5.2):
  - **Join date.** Each student has a join date at each School they belong
    to. It is the day they are added, unless staff set an earlier day (never a
    future one). Add student has a "Join date" field (today by default), the
    Students list's "Enrolled" column is now "Joined", and the student's page
    shows it in a new "Member details" card. Staff change it on Edit profile.
    Existing students got the day they first joined that School. The student
    list export uses it too.
  - **Contacts.** A secondary phone, a secondary email and an emergency
    contact (name, phone, relationship; not a Guardian, no account). Staff add
    them on Add student ("+ Secondary phone", "+ Secondary email",
    "+ Emergency contact", for adults) and on Edit profile, and see them in
    "Member details". Members edit their own on My Profile in the student
    app; a child's are kept by the School (a child has no login). They are
    contact details only, never used to sign in, and are erased with the
    account.
  - Migration `20270123000000_member_details`.

- **Fixed: card payments against Stripe's current API** — found on the first
  run against a real Stripe test account. Several calls were written for an
  older Stripe API and failed on the version the app now uses:
  - buying a Subscription plan (and a School or Franchise subscribing to a
    platform plan) always failed with a server error; the first payment is now
    read from where Stripe now puts it;
  - buying a pack or pass with Stripe's hosted page, and paying charges there,
    always failed: Stripe now makes the payment only when the member pays, so
    ULTM8 links the payment to its order by the order's own number instead. An
    abandoned hosted payment is still marked Failed when Stripe expires it
    (this needs the `checkout.session.expired` event switched on for the
    webhook in Stripe);
  - saving a card could not start; it now asks for a card in the School's
    currency;
  - when a membership card payment goes back to the card in full (a refused
    purchase ULTM8 refunds, or a whole payment refunded in Stripe), the
    Refunded amount is now what Stripe refunded, card surcharge included (it
    used to leave the surcharge out). Refunds of charges are unchanged.
- **Fixed: a School or Franchise connected to Stripe could not take card
  payments** — found in the same Stripe test-mode run. Connecting to Stripe
  created the Stripe account without asking for card payments, so Stripe
  enabled only transfers, and after onboarding every payment on it (hosted
  Checkout, saved-card charges, Subscriptions) was refused. New accounts now
  ask Stripe for card payments (and transfers) when they are created, and
  continuing the Stripe setup (**Continue Stripe setup**) on an account created
  before this fix, which has no card payments, asks for them too (an account
  that already has them is left as it is), so Stripe's onboarding then collects
  whatever card payments still need. Until that is done the account shows
  Action needed, as before.
- **Connect Stripe only where Stripe can onboard the School** (Decision 437)
  — ULTM8's Stripe platform is a UK account, which can onboard Schools and
  Franchises in the United Kingdom, the 27 EU countries, Norway, Switzerland,
  Liechtenstein and Gibraltar only. Elsewhere (Brazil, for one) the
  Franchise page's Stripe card has no **Connect Stripe** button and explains
  that card payments in the app aren't available in that country yet, so
  payments are by cash or bank transfer (Pix in Brazil) and staff confirm
  them; a School's setup checklist leaves out the Connect Stripe step and says
  the same. The country picker offers only those 32 countries. The API refuses
  to start Stripe onboarding for any other country (or a country that isn't a
  two-letter ISO code), with the reason in all 15 languages; an account
  already connected keeps working wherever it is. The payment-account,
  Franchise connect-status and Dashboard answers now say whether Connect is
  available. The list is set in code, and the optional
  `STRIPE_CONNECT_COUNTRIES` setting replaces it (comma-separated ISO codes).
  In the member app, a School without card payments shows a short note under
  each plan: card payments aren't available there yet, so pay by bank
  transfer or cash at the School (by Pix too, for a School in Brazil) and
  staff confirm it. **Purchase** there records a cash/bank-transfer payment
  waiting for staff (it no longer tries Stripe's card page), and **Pay with
  saved card** isn't offered. The School's public profile says whether it
  takes card payments and whether it is in Brazil. **Needs migration
  `20270228100001_school_card_payments`.**
- **Monthly plans at a School without card payments** (Decision 441 item 1;
  launch rehearsal D1 and F4) — a School that takes no cards (Brazil, for now)
  can now sell its monthly plans. The member buys one in the app like any plan
  there: a Pix/bank-transfer or cash order that staff confirm. Staff can also
  sell it at the desk (the student's Memberships card, and Record a payment).
  That first payment is the first month; after it, each month is added to the
  member's balance as a normal charge (a monthly recurring charge tied to the
  membership, from the same day of the month), with its own invoice and the
  "New invoice" notice, paid by Pix or cash and recorded by staff, and
  overdue and late fees as for any charge. The month costs the plan's price,
  as a card renewal would: tax is never added on top. Cancelling (the member,
  a parent, or the owner; or removing the student, or asking to delete the account) ends the membership at its
  next billing day, so the month already charged runs out and no further
  month is charged; the recurring charge then shows as ended. The member app
  says, under such a plan, that later months go on the balance (all 15
  languages). The old refusal with technical words ("SUBSCRIPTION",
  "PaymentAccount STRIPE") is gone. A School that takes cards is unchanged:
  its monthly plans are card Subscriptions bought in the app, and still can't
  be sold at the desk. **Needs migration
  `20270301000001_no_card_monthly_plans`.**
- **Pix and cash orders at a School without cards: staff confirm them, and no
  plan switch** (Decision 441 items 2 and 3) — Branch Staff whose School lets
  them record payments (Decision 347) can now also mark a member's Pix, cash or
  bank-transfer order as paid, for students of their own branches only (the
  same students they can record a payment for). They do it from the student's
  Payments card, which now lists the student's waiting orders for them with
  **Mark as paid** (owners see it there too). Before, only owners could, and
  Branch Staff got "Transaction not found". Cancelling an order still needs
  "Can cancel charges", as before. At a School that takes no cards, "When it
  ends, switch to" is no longer on the plan form and the member app no longer
  offers the switch when buying: the switch charges a saved card, so there it
  could only end with no card. The API refuses a new next plan there and
  ignores the member's agreement when buying; a next plan a plan already had
  is kept, unused, and works again if the School later takes cards. No
  migration.
- **Staff hear about Pix and cash orders; freezing pauses a monthly plan
  billed to the balance** (Decision 442 items 4 and 5) — the "Cash payment
  waiting" notice for a member's Pix, cash or bank-transfer order now also
  goes to the Branch Staff who may mark it as paid (the School's "Let Branch
  Staff record payments" switch is on and the student's home branch is one of
  theirs), not only to the owners. Their copy says to mark it paid on the
  student's Payments card and opens the student's page (all 15 languages).
  Freezing a monthly plan billed to the member's balance (a School without
  cards) now pauses its monthly charge, as freezing a card Subscription does:
  the next month is moved later by the freeze's length and the months after
  it follow from the new day, so nothing is charged while frozen and the
  member never pays for frozen days. A month due before the freeze starts is
  charged first, then the next one moves. Ending a freeze early moves the
  month back by the days not frozen. Cancelling during a freeze ends the plan
  on the moved billing day. The student's Memberships card shows "Billing
  paused" for these plans too. No migration.
- **Stress test round 6: money fixes** (Decision 446 items 1–4, findings
  M-1 to M-5) — a freeze inside a contract's minimum term no longer adds a
  month: the end of the term moves along the billing schedule with the
  freeze, so a 3-month term is still 3 monthly payments (cards and plans
  billed to the balance). Ending a freeze early now also moves back the end
  date of a monthly plan cancelled during the freeze (and of a card
  Subscription cancelled during it), so the Memberships card shows one, right
  end date; a cancel date before the freeze is left alone. A monthly plan
  billed to the balance now shows its monthly charges as ended however the
  plan ends: a desk refund that ends it, Delete my account, the end of the
  minimum term, and (the nightly charge job's catch-all) any other way. A
  payment refunded in part, including one where the non-refundable joining
  fee was kept, counts in revenue at its amount less what was refunded, the
  same on the billing overview and on the Transactions page's "Total
  revenue". Whether revenue includes the card surcharge is unchanged. No
  migration.
- **School owners connect Stripe themselves** (Decision 441 item 6) — the
  School page has a **Stripe account** card with **Connect Stripe**, which
  starts Stripe's own onboarding (the first time, the owner picks the country
  of the business's bank account), instead of ULTM8 support doing it. The card
  shows Connected, Action needed (with **Continue Stripe setup**) or Not
  connected, and Stripe's return and refresh links come back to it. Where
  Stripe can't onboard the School (Decision 437) it explains that members pay
  by cash or bank transfer instead, and a School whose payment account is for
  cash or bank transfer has no button. The setup checklist's **Connect
  Stripe** step links to the card and is ticked only once Stripe confirms the
  account is ready (onboarding finished and it can take card payments), not
  as soon as onboarding starts; it is kept up to date by Stripe's
  `account.updated` event and when the owner comes back from Stripe. The
  checklist no longer says ULTM8 support connects it. New
  `GET /schools/{id}/payment-account/connect-status` (School owners only) and
  `stripeAccountReady` on the payment account. All 15 languages. **Needs
  migration `20270304000001_payment_account_stripe_ready`**, and
  `account.updated` switched on for the Stripe Connect webhook endpoint.
- **Card payments wait for a ready Stripe account; staff can be let connect
  Stripe** (Track A and Track B; Decision 442 items 2 and 3). A School takes
  card payments only once Stripe says its account is ready (the same test as
  the checklist). Until then, or while Stripe asks for more details, it works
  as a School without cards: the member app shows the cash or bank-transfer
  (Pix) note, a purchase is an order staff confirm, monthly plans are billed
  to the member's balance and sold at the desk, the card surcharge isn't
  added, "When it ends, switch to" isn't offered, and paying by card, saving
  a card, automatic payment and off-session fees take nothing. A card payment
  asked for anyway gets a clear message in all 15 languages. Existing card
  Subscriptions are left as they are. The payment account gains
  `cardPayments`. Owners (co-owners included) can give a Branch Staff member
  the new **Connect Stripe** access switch (off by default, in no preset):
  they then get **Stripe account** in their menu, with the School's Stripe
  card, and may create the Stripe account, start or continue Stripe's
  onboarding and read its status; setting up cash or bank transfer stays the
  owners'. All 15 languages. **Needs migration
  `20270312000001_card_payments_need_ready_stripe`.**
- **Card surcharge on Subscriptions** (backlog 3.8; Decision 406) — where a
  School's card surcharge applies, a monthly Subscription now carries it too:
  members see it on the plan before subscribing, and it is added to the first
  payment and every renewal as its own line (its own item on the Stripe
  Subscription, so Stripe's invoices and receipts show it). The Transactions
  page, its CSV and the member's payment history show it apart from the plan's
  price for the first payment and each renewal, Successful or Failed. A
  renewal refunded in full in Stripe counts the surcharge as refunded. A
  running Subscription keeps the % it started with: turning the surcharge off,
  changing the %, or Platform Admin removing the country applies when the
  member next subscribes. A Migrate price change keeps the surcharge at the
  Subscription's own %. The School page's Card surcharge text says so (15
  languages). No migration.
- **Card surcharge: removing a country stops it on running Subscriptions**
  (Decision 419 item 3) — when Platform Admin takes a country off the card
  surcharge list, every running Subscription at a School in that country stops
  charging the surcharge from its next renewal (this replaces "Platform Admin
  removing the country applies when the member next subscribes" in the entry
  above). A background job removes the surcharge item from each Stripe
  Subscription with no proration (the month already paid is left as it is),
  so the next renewal charges, records and shows no surcharge; one
  Subscription Stripe refuses doesn't hold up the rest, and the job retries.
  Adding the country back doesn't put the surcharge back on running
  Subscriptions; only new ones get it. An owner turning the surcharge off or
  changing the % still applies only when the member next subscribes. The
  Platform Admin "Remove country" dialog says so. No migration, no API change.
- **Waivers: faster Signatures panel for big Schools** (Decision 418; stress
  test round 4, Q2) — the panel shows the first 100 people with a "Load more"
  button instead of loading everyone first (it took 22 s at a School with
  3,700 students; now about a quarter of a second for the first 100 on the
  same test data). New search box finds someone by name, capitals and accents
  ignored; it and the All / Signed / Not signed tabs search the whole list, not
  just what's shown. The "12 of 40 signed" totals are counted once. 15
  languages. No migration.
- **Stress test round 4** — 500 Schools in 40 countries (32 currencies, 60
  time zones, 126,428 students): a busy day, money, Staff, the front desk,
  members' features, tenant isolation, the portal in a browser and how far one
  server goes; report in `docs/handover/STRESS-TEST-ROUND4.md`, scripts in
  `apps/api/scripts/stress/round4/`. Fixes below.
- **Round-4 stress-test fixes** — card prices in yen, won, Chilean pesos and
  other currencies without decimals were sent to Stripe 100 times too high,
  and Kuwaiti and Bahraini dinars (three decimals) at a tenth; every amount to
  and from Stripe is now converted for its currency (payments, Subscriptions,
  checkout, refunds, renewals, disputes). A waitlist seat offer, a cancelled
  class or a payment notice no longer waits behind thousands of broadcast and
  waiver notices (one seat offer arrived 40 minutes late): bulk notices now
  go last. The portal header wraps on a phone instead of making every page
  scroll sideways. Booking no longer loads the whole belt ladder when no belt
  locks the class (about a third faster). Unpause clicked several times at
  once is recorded once.
- **Check-in codes at large Schools** (Decision 417, stress test round 4 Q1)
  — a School with more than 500 members moves to 6-digit check-in codes on
  its own, and its shorter member and staff codes are replaced with new
  6-digit ones (shown on each member's Student page and on the staff's own
  code screen). It then can't choose 4 digits again. A front-desk tablet
  locks after 10 wrong member codes in a row; a staff member's own code lets
  it carry on.
- **Grading: pick each student's rank in bulk promote, including the Adult
  program** (backlog 3.20; Decisions 281 item 2, 397) — each student in the
  "Promote these students" window has a **Promote to** picker. It starts on
  their next rank and lists every higher rank, so a student can skip ranks
  ("Skips N ranks in between. This is recorded on the history."; the report
  says "(skipped N)"). On a Kids style, a student who has reached "Ready for
  Adult from age" also gets the **Adult program** group (the Adult ranks above
  its first belt); picking one moves them to the Adult style as the Grade
  window already does: history and notes kept, matching skill sign-offs carried
  over, the class count restarting, "Moved to Adult program." on the history,
  and "(Adult program)" in the report. The next rank's checks still apply to a
  skip and to a move into Adult. Changing a pick re-checks only that student.
  The API takes the picks as `targets` on `POST …/grading/bulk-promote`, and
  each answer row says `toAdult`. No promotion fee is asked for on a move into
  Adult: Decision 397 leaves that open. 15 languages.
- **Grading: the move from Kids to Adult is charged like any promotion**
  (backlog 3.20; Decision 419 item 2, Decision 420 item 3) — moving a student
  into the Adult program, from the Grade window or in bulk promote, can now be
  charged as a promotion to the Adult rank they are given. Grading → Settings
  has a new owner-only switch under the promotion fee, **"Charge a fee when
  moving a student from Kids to Adult"**, shown while the promotion fee is on
  and off by default: off, the move is always free, whatever the Adult rank's
  price. On, that Adult rank's own price is asked for (no price means free);
  with "Allow grading
  before the fee is paid" off the move waits ("Waiting for fee") and happens
  once the fee is paid or the owner (or staff with "Can cancel charges",
  Decision 420 item 2) waives it, with the coach's grading date;
  declined shows "Fee declined"; a waived decline or a cancelled fee leaves it
  "to decide", and moving the student then is fee-free; coaches get the same
  one "Promotion to decide" reminder after 3 days as for any promotion
  (Decision 421 item 6; the "fully ready" check is skipped, since a kid on the
  top Kids rank has no next Kids rank). The student, or a
  child's Guardian (Decision 421 item 7: the Guardian sees a waiting move on
  Home and in My grading for the child), accepts or declines it in the app, where the card says
  "graded into the Adult program" and names the Adult style; an accepted fee
  is a charge like any other. The fee tags and the Waive / Cancel buttons name
  the rank "Blue Belt (Adult program)"; the Ranks tab shows a move's fee on the
  Kids style until it applies, then on the Adult style. A single move is now
  refused while a Kids promotion is waiting for its fee, as bulk promote
  already did (Decision 314 item 3). Bulk promote's done window now also lists
  the students waiting for their fee (any priced grade, not only a move into
  Adult). The API keeps the Kids style as a request's `disciplineId` and adds
  `toDisciplineId` (the Adult style) to fee requests, `toAdult` to the board's
  fee request, `toDisciplineName` to the student's list, and
  `kidsToAdultFeeEnabled` to the promotion fee settings (migration
  `20270206000000_kids_adult_promotion_fee`, which also adds
  `School.promotionFeeKidsToAdult`). Decision 420 answers this build's two open
  points: who may waive (built separately) and "a price of 0" (a rank with no
  price is free). 15 languages.
- **Refund notice** (backlog 3.6; Decision 414 item 4, Decision 415 item 4)
  — every refund sends the member a "Refund" notice with the amount and where
  it went: refunded to the card, given back, or added to the balance as credit
  (a Guardian gets the usual copy). That covers refunds of payments toward
  charges, a Class Pack's share when a booking is cancelled (to the card, or
  cash marked paid out), a payment refunded in the Stripe dashboard, and a
  membership purchase that couldn't go through and was refunded ("… was
  refunded to your card: {plan} couldn't be bought."). A lost card dispute
  sends none (the dispute notice already says the money goes back). The
  owner's notes are never included. New switch "A refund of a payment" among
  the payment notifications on the School page, on by default. 15 languages.
- **Students → Growth** (backlog 5.8, Gymdesk G1–G5) — a new Growth tab next
  to Attendance. Tiles for **Active students** (the Dashboard's own count,
  Decision 317 item 5 / 374, from the same code so the two always agree),
  **Visitors** (Decision 391), **Frozen** (a membership frozen today, Decision
  404), **New this month** (by join date, Decision 315 item 4) and **Cancelled
  this month** (Subscriptions ended by cancellation); a bar chart of new and
  cancelled students for each of the last 12 months; and a **By style** table
  (students holding a rank in each style now, and how many started it). Months
  are calendar months in the School's time zone. The owner sees the whole
  School with a Branch filter (by home Branch); Branch Staff with "See
  attendance statistics" see their own Branches' students. New endpoint
  `GET /schools/{id}/growth`. 15 languages.
- **Frozen members are no longer counted as Active** (Decision 422 item 5) —
  on Students → Growth and on the Dashboard, a member whose membership is
  frozen today is left out of **Active students** and counted only under
  **Frozen**. It uses the same frozen test as booking and check-in (Decision
  404). A member who also holds another membership in effect that isn't
  frozen still counts as Active. Once a freeze ends, the member counts as
  Active again from the day they are back. Other "active" counts (membership
  plan member counts, the per-headcount franchise fee, the Students list and
  export) are unchanged.
- **Billing reports: total revenue, charges and memberships** (Decision 414
  item 3) — the Overview now shows revenue in two parts and their total, for
  the period and for each month: **Charges** (payments toward charges less
  money given back, as before) and **Memberships** (plans bought in the app or
  sold at the desk, Subscription renewals, and late-cancellation and freeze
  fees (Decision 415 item 2): Successful payments by billing date, less what
  was refunded on them), then **Total revenue**. Payments toward charges are
  counted once, in Charges. Same people and scope as before (the owner the
  whole School; Branch Staff, when the School lets them take payments, their
  own branches' students), one figure per currency. `ChargeOverviewCurrencyDto`
  gains `memberships` and `total`, and each month `memberships` and `total`.
  15 languages.
- **Payroll report** (Decision 320 item 4) — a new **Payroll** page for the
  School's owners. On its Rates tab the owner gives each member of staff an
  hourly rate and/or a per-class rate in the School's currency (needs the
  currency set first); both blank leaves the person out. The Report tab adds
  up, per person, hours × the hourly rate plus classes taught × the per-class
  rate over the last 14 or 30 days, this or last month, the last 12 months or
  custom dates (up to 366 days), with a total line and a CSV download. Hours
  are the classes taught only, start to end; cancelled classes and classes
  still to come don't count; the coach on each single class is the one paid,
  so changing one class's coach pays the substitute. Rates are kept when
  someone leaves, so the classes they taught still add up. ULTM8 pays nobody.
  New `StaffPayRate` table (migration `20270215000001_staff_pay_rates`,
  owner-only RLS); `GET /schools/:id/payroll/rates`, `PUT …/rates/:userId`,
  `GET …/payroll/report`. 15 languages.
- **"Payroll" access switch for Branch Staff** (Decision 435 item 22) — the
  owner can now let a Branch Staff member see the Payroll page: a new
  **Payroll** switch in their Access window (Staff group), off by default and
  in neither preset. With it they see the payroll report for the whole
  School, every Branch and every staff member, and Payroll appears in their
  menu. It is the report only: the Rates tab, and setting anyone's rate
  (their own and the owners' included), stays with the School's owners, as
  before. Whether they see the pay rates in the report is the owner's choice:
  a new **Show pay rates in the report** setting on the Payroll page's Rates
  tab, off by default. Off, they see the classes, hours and pay only (the
  rate columns are left out of the page and the CSV, and the API leaves the
  rates out); on, they see the rates read only. Owners always see them. Their
  page subtitle now says "at the rates the School's owners set". Coaches
  never have it; a paused role loses it. Enforced by the API and by the
  database (`StaffPayRate` RLS now also lets `is_payroll_staff` read the
  rates, never write them). **Needs database migrations**
  (`20270219000002_payroll_access_switch`,
  `20270226106000_payroll_staff_see_rates`).
- **Data tools: merge duplicate members, export all signed documents**
  (Decision 315 item 13; imports are a separate change). **Merge a duplicate**
  on a student's page: the owner picks the other record of the same person at
  the School; a preview lists what moves (memberships, payments and charges,
  bookings and waitlists, belts and grading history, waiver signatures, notes,
  tags, files and the rest) or why the two can't be merged yet (different
  Guardians, both on an unlimited membership, the duplicate on a card
  Subscription, a card payment in progress, a belt in the same style, the same
  class booked, an open sign-up or invite, and so on). Merging moves the
  duplicate's records **at this School only** to the kept student, keeps the
  earlier join date, and ends the duplicate's enrolment there, in one
  transaction, with a line in the Staff page's activity log. The duplicate's
  account and login, and anything they have at other Schools, never change.
  Waiver signatures are legal records: none is deleted or rewritten; where
  both signed the same waiver, the duplicate's signature stays on the
  duplicate's record. **Export signed documents** on the Waivers page: a ZIP
  of every signed waiver at the School (members' and guests', expired ones
  included), one HTML document per signature with the drawn signature or paper
  photo inside it (opens in a browser, prints to PDF), and `index.csv`
  (member, document, version, signed at, signed by, with the Guardian or
  paper marked), in the owner's language. Made by a background job into the
  private bucket, downloaded through a 5-minute link, deleted after 24 hours.
  Both are School-owner only. New endpoints `GET/POST
  /schools/{schoolId}/students/{studentId}/merge[/preview]` and
  `/schools/{schoolId}/signed-documents/exports` (`POST`, `GET latest`,
  `GET {id}`, `GET {id}/download`). 15 languages. **Needs a database
  migration** (`20270204000000_data_tools_merge_export`).
- **Merging duplicates keeps the higher belt** (Decision 422 item 8) — a belt
  in the same style on both records no longer stops a merge. The higher
  current belt is kept, by the ladder's own order (belt, then stripe or level
  step); on the same belt and stripe, the kept member's, with both records'
  classes toward the next grade added up and the further sign-off kept for
  each skill. The other belt's promotions stay in the history, moved onto the
  kept belt and marked as coming from the merged record (new
  `mergedFromUserId` on history entries); its sign-off log moves too, and
  only its belt row itself is removed. A promotion fee still unanswered for
  the belt that isn't kept, or a second one waiting in the same style, is
  cancelled; one already accepted stops the merge until the owner cancels it
  (new reason `SAME_STYLE_FEE_ACCEPTED`). A belt correction request about the
  belt that isn't kept, or a second one pending in the same style, is
  rejected. Kids and Adult programs are separate styles, so both belts are
  kept. The merge preview lists which belt is kept in each style. The rank
  date correction checks only the kept belt's own history. Preview and result
  gain `beltsKept`, `promotionFeesCancelled` and `beltCorrectionsClosed`; the
  reasons `SAME_STYLE_RANK` and `SAME_STYLE_CORRECTION` are gone. 15
  languages. The belt writes run through one narrow database function
  (`merge_student_ranks`) that the background-job role may only call; that
  role gets no new table rights. **Needs a database migration**
  (`20270212000000_merge_keeps_higher_belt`).
- **The signed-documents export can include member files** (Decision 422 item
  9) — the export dialog on the Waivers page gains an **Include member files**
  tick box, off by default and shown only to the School's owner. Ticked, the
  ZIP also holds every file on the School's members' **Documents** (Profile),
  as `member-files/<member name>-<first 8 characters of their id>/<file
  name>`, each exactly as uploaded. File and folder names are made safe (no
  folders or `..` in a name, no characters Windows refuses, reserved Windows
  names renamed, two files of the same name kept apart as "name (2)"). Only
  this School's files, and only files still on a member (an erased account's
  files, waiting to be purged, are left out). The export stays owner-only:
  staff, with "Member files" or not, are refused (403). Files are streamed one
  at a time into a ZIP written to a temporary file and uploaded from there, so
  neither the files nor the ZIP are held in memory whole; the ZIP can be up to
  2 GB (a larger one fails, and the owner is told the export couldn't be
  made). The ZIP is still deleted after 24 hours. `POST
  /schools/{schoolId}/signed-documents/exports` takes `includeMemberFiles`;
  `SignedDocumentExportDto` gains `includeMemberFiles` and `memberFileCount`.
  15 languages. **Needs a database migration**
  (`20270208000000_export_member_files`).
- **Each signed document in the export is a real PDF** (Decision 422 item
  10) — the signed-documents ZIP now holds one PDF per signature in place of
  the printable web page (same folder and names, `.pdf` instead of `.html`;
  `index.csv` lists the PDFs). Each PDF shows what the page did: the School,
  the document's title (and "Expired"), the member (a guest marked), who
  signed (a Guardian signing for a child, or a paper signature, marked), the
  typed signature or who recorded the paper one, when it was signed (UTC),
  the version and SHA-256 of the wording, the drawn signature or paper photo,
  and the full wording signed, on as many A4 pages as it needs, numbered
  "1 / 3". The text is real, selectable and searchable text in embedded Noto
  fonts, in every one of the 15 languages: Arabic right to left and joined,
  with numbers and Latin words in it the right way round, and Japanese,
  Chinese, Korean and Thai broken into lines between words. An image that
  can't be read is reported as missing rather than failing the export. The
  Japanese/Chinese/Korean font file is checked against the upstream file's
  SHA-256 when it is first loaded; if it doesn't match it is not used, an
  error is logged, and an export that needs it fails (exports with no CJK
  text are unaffected) rather than writing documents with text missing. Made
  with pdfkit in the export job, one PDF at a time into the ZIP; the 2 GB
  limit and 24-hour deletion are unchanged. The export dialog's description
  now says "a PDF for each signature" (15 languages). No API or database
  change.
- **Tags on students** (backlog 5.4; Decision 315 item 7) — each School keeps
  its own list of tags, managed under **School settings → Student tags** (add,
  rename, delete; deleting a tag takes it off every student). A **Tags** card
  on the student's page shows the student's tags with **+ tag**: staff pick a
  tag from the list or type a new one, which joins the list. The Students list
  gains a **Tag** filter. Tags are staff-only: no member or Guardian screen or
  API reply ever shows them. Tagging is for the staff who can edit the
  student's details. A student's tags are erased with their account, like
  staff notes. **Needs a database migration** (`20270123000000_student_tags`).
- **A paid promotion fee whose promotion can no longer apply** (Decision 414
  item 1) — when a promotion fee is paid in full but the promotion that waited
  for it can't go through any more (the student's rank or the belt ladder
  changed after the grade), the School's owner is told once, in
  Notifications ("Promotion can't apply"), and the student's grading card and
  the Grading Board show **Paid — promotion can't apply**. The owner decides:
  **Cancel fee** (the invoice is cancelled and what was paid becomes credit)
  or grade the student again, which is no longer held up by the fee. Grading
  again cancels the old fee and its invoice the same way, so what was paid
  counts toward the new grade (Decision 415 item 1): it becomes credit, which
  pays the new grade's fee once accepted (only any difference is left to pay;
  anything over stays credit). Until the owner does one or the other nothing
  happens to the money, and the daily payments run doesn't retry it or tell
  the owner again.
  The fee can't be waived in this state. The member sees the fee as Paid.
  **Needs a database migration** (`20270120000000_promotion_fee_blocked`).
- **Automatic grading** (Decision 321; handover B12) — Grading → Settings has
  a new owner-only card per style, **"What counts toward the next rank"**:
  tick boxes for Classes, Days in rank, Skills (ticked by default, as before),
  Hours, Days attended and Minimum age (new, off by default); a **Promotion**
  choice of Manual (the default), Automatically award stripes, or
  Automatically award all ranks; and **"Auto-assign first belt"**. The belt
  editor shows only the ticked requirements, with new Hours required, Days
  attended and Minimum age fields. The progress % is now the **average** of
  the ticked requirements the next rank asks for, each capped at 100% (30/40
  classes, 90/180 days and 4/8 skills give 58%), and reads 100% only when all
  are met; the board columns and "Ready to grade" use it. Minimum age isn't in
  the %: a student who is otherwise ready shows **"Waiting for age N"** and
  can't be promoted, by hand or automatically, until then. In an automatic
  style a student who meets everything for the next step is promoted after a
  check-in or by the daily run, shown as **Automatic** in the history; the
  student (or Guardian) gets the usual notice and the style's coaches are told.
  A priced step waits for its fee (even with "Allow grading before the fee is
  paid" on) and goes through once it is paid or waived; a cancelled or
  declined fee never promotes. A coach who may promote can **Undo** an
  automatic promotion from the history, which moves the student back and is
  recorded; that step is then left to the coach. With "Auto-assign first
  belt" on, a student with no rank gets the style's first rank, verified, on
  their first check-in to a class of it. A Grading Board drag now moves the
  classes, and the days at the rank if needed, so the card lands in the column
  under the averaged %. The student app's My grading shows the same
  breakdown. Every new text is in all 15 languages.
  **Needs a database migration** (`20270211000001_automatic_grading`).
- **Staff with "Can cancel charges" can waive or cancel promotion fees**
  (Decision 420 item 2) — until now only the School owner could. Branch Staff
  and coaches the owner has given "Can cancel charges" (off by default; it
  already lets them waive late fees) now see **Waive fee** and **Cancel fee**
  on a promotion fee on the Grading Board panel and the student's grading card,
  for the students of their own branches. On the student's Payments card, an
  accepted promotion fee's invoice now has **Waive fee** and **Cancel fee** too,
  for the owner and those staff, instead of only "Waive or cancel it in
  grading". Waiving and cancelling work as before: a waiting promotion is
  applied by a waive and left for a coach to decide by a cancel, and the
  invoice is cancelled. Staff without the switch, staff at another branch and
  another School's staff are still refused. Turning the fee on or off, belt
  prices and the other Grading Settings stay the owner's. The "Charges: who
  can create and cancel" card on the Staff page says so, in every language.
  The **"Promotion can't apply"** notice for a paid fee whose promotion can no
  longer go through (Decision 414 item 1) now goes to those staff as well as
  the owner (Decision 421), once each, and never to staff of another branch
  or School. Both apply to a Kids → Adult move's fee too.
- **"No tax on this item (0% or exempt)" on charges** (backlog 3.6; Decision 414
  item 5) — staff creating a one-off charge or setting up a recurring charge
  can tick it (off by default) for an item tax doesn't apply to, such as
  children's clothing at 0% VAT in the UK. The charge then has no tax: the
  price ex. tax and inc. tax are both the price typed (after any discount),
  whether the School's prices include tax or have it added on top, and every
  charge of a recurring series set up with the tick has no tax. The form's live
  preview, the student's charges table and recurring list, and the invoice in
  the student app show "No tax". A tax rate is still never typed per charge.
  Late fees and promotion fees always take the School's tax settings.
  Migration `20270119000000_charges_no_tax`.
- **Students → Attendance: statistics and logging past attendance**
  (Decision 317 items 3 and 4; backlog 5.6, 5.7) — a new **Attendance** tab
  on the Students page:
  - **Statistics for the last 30 days** (days in the School's time zone):
    check-ins, students per class and classes per student. The owner sees the
    whole School, with a Branch filter; Branch Staff see their own Branches
    only when the owner turns on the new **"See attendance statistics"**
    switch on their Access page (off by default, in neither preset). Coaches
    don't see statistics. Trial, Visitor and Friend Pass check-ins count, with
    a tick box to leave them out.
  - **"+ Log attendance"**, on the tab and on a student's page: staff who can
    check people in log a class someone came to but wasn't checked in to, up
    to 30 days back. It counts exactly like a check-in: it books the class
    when needed, paid for like any staff booking (a Class Pack class is used
    when that's what pays), counts toward grading and hours trained, and
    follows the School's check-in rules about the person. It is recorded with
    its own check-in method (`STAFF_LOGGED`) and who logged it. A booking
    already marked No-Show is checked in without being paid for again, and a
    student already checked in to that class is refused.
  - Migration `20270123000000_attendance_stats_and_past`; new endpoints
    `GET /schools/{id}/attendance/stats`, `GET /schools/{id}/attendance/log-classes`
    and `POST /schools/{id}/attendance/logs`.
- **Address search with Google Places, switched off until the key is set**
  (Decision 212; deferred to v1.3 by Decision 267; backlog §3.16 and §4.3) —
  a **"Search address"** box on every address form in the School Portal (My
  profile, Update student, School, Branch, Branch settings, Franchise, Create
  School, Complete instructor profile) and on My Profile in the student app.
  Typing shows matching addresses in the chosen country; choosing one fills
  the separate address fields (street, city, region, postcode, country), which
  can still be edited. In the student app a chosen address that is complete
  and not edited afterwards is saved with its separate fields too.
  - **Off until the product owner provides a key.** Without
    `GOOGLE_PLACES_API_KEY` on the API server, the box is hidden and every
    form shows its plain fields exactly as before.
    **To do (product owner): provide a Google Cloud API key with Places API
    (New) enabled, restricted to the API server, then set
    `GOOGLE_PLACES_API_KEY` on the API server (Render env var).**
  - The API calls Google itself, so the key never reaches a browser or the
    app: new endpoints `GET /address-lookup/status`, `/address-lookup/autocomplete`
    and `/address-lookup/details` for signed-in users, rate-limited per user,
    with short timeouts. While switched off, `status` says `enabled: false`
    and the two lookups answer 503 `ADDRESS_LOOKUP_NOT_CONFIGURED`. Results
    come in the app's language. New text in all 15 languages.
  - Not yet tried against a real Google account.
- **Files on a member (Documents)** — backlog 5.11, Decision 315 item 9. A new
  Documents section on the student's page: upload a PDF, JPG or PNG (up to
  10 MB each), see the list (name, size, date, who uploaded), download and
  delete. The type is read from the file's content, not only its name, and the
  size is checked by the server. Files are kept in the private storage bucket
  and downloaded through a link that works for 5 minutes. Only the School's
  owners see them, and Branch Staff the owner switches on with the new
  "See and manage member files" access (off by default, in neither preset),
  for their own branches' students; the member and their Guardian never do.
  Files are erased with the member's account and when a closed School is
  purged (the stored file first, then its record; if storage can't be reached
  both stay and the next daily sweep tries again). Migration
  `20270125000000_member_files`.
- **Currency first** (backlog 3.6; Decision 414 item 6) — until the School has
  set its currency on the School page, no price can be saved: membership
  plans, belt prices for promotion fees, charges, recurring charges, credit,
  the late fee's fixed amount, the freeze fee, the no-show fee (School and
  Branch) and Class and timetable slot cancellation charges. Each of those
  forms shows "Set your School's currency first" with a link to the setting,
  and its price field is off. A price of 0 (free) is still allowed, and
  anything priced before keeps its price and can still be edited. The API
  refuses with `SCHOOL_CURRENCY_REQUIRED` (charges used `CHARGE_NO_CURRENCY`).
- **Cancelling a cash or bank-transfer membership payment works like
  cancelling a charge** (backlog 3.6; Decision 338 item 1, Decision 414 item 7)
  — a membership payment waiting at the desk is cancelled by the owner, and
  now also by staff the owner has given "Can cancel charges" (for the students
  of their own branches). A reason is always asked for, required unless the
  owner turned that off on the School page (the same setting as for charges),
  and is for staff only. The payment is still stored as Failed but reads
  **Cancelled** everywhere, with its date: the Transactions page (with who
  cancelled it and why, a new Cancelled tile, a Cancelled status filter, and
  three new CSV columns), and the student app's payment history (the date
  only). Failed counts and the Failed filter leave cancelled payments out.
  Staff who may cancel also see the student's waiting and cancelled
  membership payments on the student's Payments card, with a Cancel button.
  Migration `20270118000000_transaction_cancel_reason`.
- **Charges, step 4: refunds, credit, billing reports and payment notices**
  (backlog 3.6; Decision 303 item 3, Decision 338 items 3, 5, 6, 10, 11) — the
  owner refunds a payment toward charges from the student's Payments card,
  choosing each time: back to the card (through Stripe), given back in cash,
  Pix, bank transfer or on the terminal (records only), or onto the balance as
  credit. Part refunds are allowed, never more than was paid; a refund never
  re-opens a paid charge. Notes are staff-only and required unless the owner
  turns that off on the School page. The member sees "Refunded" or "Part
  refunded" in the app. A lost card dispute counts as a refund to the card, and
  a refund made in the Stripe dashboard goes on the balance too. The owner can
  also **add credit** with a note. New **Billing reports** page next to
  Transactions: an Overview (scheduled, overdue and paid, revenue by month) and
  Member balances (with CSV), for the owner and for Branch Staff the School lets
  take payments (their branches only). Staff who can create charges can
  **resend an invoice**. On the School page: the address and payment
  instructions shown on invoices in the app, and switches for the payment
  receipt, failed or overdue payment, and dispute notices (all on by default);
  a new daily "Payment overdue" notice goes once per charge the day after it is
  due, and "Payment due soon" goes once per charge 3 days before its due date
  (its own switch, on by default; none for a charge created less than 3 days
  before it is due). Late fees and automatic payment count what a charge owes
  after refunds. Migration `20270114000000_charges_refunds_reports`.
- **Fixed: "Give pass" and "Record sale" could stay greyed out** on a student's
  Memberships card when the window opened before the School's plans had loaded.
  The first plan is now picked as soon as the list arrives.
- **Charges and member balance, step 1** (backlog 3.6; Decisions 303, 338,
  411) — staff can charge a student for something outside a membership plan,
  such as a rash guard, from a new **Payments** card on the student's page:
  a price, an optional discount (% or fixed) and a due date. Tax is set by the
  School on the School page (**Charges and tax**: its country, which fills in
  ULTM8's standard rate, the rate itself, and whether prices include tax), and
  each charge keeps the tax it was created with, showing the price excluding
  tax, the tax and the price including tax. Charges get a running invoice
  number per School (#0000001). The desk records payments (cash, Pix, bank
  transfer or card terminal) against a charge or the balance; part payments
  leave the rest owed, and an overpayment becomes credit that pays the next
  charge. A charge is cancelled, never deleted, with a reason (required unless
  the owner turns that off); anything already paid becomes credit. The
  student's balance shows what they owe, their credit and what's overdue.
  Who: the owner; Branch Staff (on by default) and coaches (off) with "Can
  create charges", and anyone with "Can cancel charges" (off), set on the
  Staff page; desk payments follow the "Let Branch Staff record payments"
  switch. Desk payments appear on the Transactions page. In the student app,
  **Invoices** (and a child's, for a Guardian) lists each invoice and receipt,
  read-only; the member is notified of a new invoice, a receipt and a
  cancelled charge. **Needs a database migration**
  (`20270112000000_charges_and_balance`).
- **Import from a spreadsheet** (backlog 5.13; Decision 315 items 12 and 13) —
  a new **Students → Import** tab brings in members, memberships and past
  attendance from a CSV file, with a template to download for each. Every row
  is checked first in a preview that changes nothing (to import, skipped with
  the reason, or an error with the reason); then the file is imported in
  batches, and a batch sent again after a dropped connection imports nothing
  twice. At most 2,000 rows per file. **Members** are made as Add manually
  makes them: an account, a temporary passcode by email, the home branch,
  the join date,
  gender Female/Male/empty, and belts per style matched by name to the
  School's own styles and belts. A row whose email already has an account is
  skipped and listed. A child (under 18) is added with their Guardian's email:
  a new Guardian gets an account with a temporary passcode; one who already
  has an account gets an invite to accept in the app. **Memberships** are
  recorded against the School's plans by name, with their dates and no
  payment (a Subscription is card-only, so it isn't imported). **Past
  attendance** is logged as "Log attendance" logs it: up to 30 days back,
  counting like a check-in, never twice. The owner can import; Branch Staff
  need the new "Import data" switch and reach only their own branches' students
  (adding a child stays the owner's). Results can be downloaded as CSV. **Needs
  a database migration** (`20270202000000_data_imports`).
- **Import past attendance of any age** (Decision 422 item 6) — the 30-day
  limit on importing past attendance is gone: any past date from 1 Jan 1900
  is accepted; a future date or a date that doesn't exist is still refused.
  Imported visits count toward belt progress like any other check-in, by
  grading's own rules (the next belt's class types and its weekly cap), from
  the day the student's current belt was awarded (Decision 423): a visit on
  or after that day counts toward the next belt, an earlier one doesn't. The
  members import takes that date after each belt, e.g. "BJJ: Blue
  (2024-11-03)"; without one the belt is dated the day of the import. A past
  attendance file may now have up to 10,000 rows (members and memberships
  stay at 2,000), still sent 100 at a time. They never use a Class Pack or
  class credit and need no membership, because they were paid for elsewhere:
  before this change an import used a Class Pack credit when nothing else
  paid. A booking already made for the class is checked in, not paid for
  again. The import screen's text says so in every language. **Needs a
  database migration** (`20270207000000_imported_attendance`: a booking's
  paying membership may now be empty, for imported attendance only).
- **Freezing a membership: follow-ups** (backlog 3.4; Decision 409) —
  approving a freeze now cancels the member's bookings on the frozen days that
  the frozen membership paid for (no late fee; the place goes to the waitlist),
  with one notice listing them; ending early doesn't bring them back. A new
  **Freeze memberships** switch on a Branch Staff member's Access page (off by
  default) lets them freeze, approve, decline and end freezes for their own
  branches' students; the freeze settings stay the owner's. A card
  Subscription's next charge now moves as soon as the freeze is approved, or
  right after the renewal that falls before it, so a renewal on the first
  frozen day is no longer charged; £0 Stripe invoices are kept off the
  Transactions page. The Freezing memberships card notes that Stripe shows a
  frozen subscription as a trial. **Needs a database migration**
  (`20270111000000_freeze_follow_ups`).
- **Custom member fields and statuses** (Decision 315 item 14) — each School
  adds its own member fields (text, number, date, drop-down, yes/no) and its
  own member statuses (up to 50 characters) under **School settings → Member
  fields and statuses**: fields can be added, renamed, reordered and deleted
  (deleting one deletes every student's value; a drop-down's choices can be
  changed, and a student whose choice goes loses it), statuses added, renamed
  and deleted (deleting one clears it from every student). A **Member fields**
  card on the student's page sets the student's member status and values,
  each checked against its field's type. The Students list gains a **Member
  status** filter and column, and a **Member field** filter: pick a field,
  then a value (a drop-down's choice or yes/no; a number or date matches
  exactly; text matches when the value contains it). Staff-only, like tags: no member or Guardian
  screen or API reply shows them, and they are for the staff who can edit the
  student's details. Erased with the student's account and with the School.
  **Needs a database migration** (`20270131000000_custom_member_fields`).
- **Charges and member balance, step 2: paying in the app** (backlog 3.6;
  Decisions 303, 338, 406) — in the student app's **Invoices**, a member (or a
  Guardian, for a child) can **Pay balance** or **Pay** a single charge by card
  on Stripe's hosted Checkout page, for what is owed after credit; the
  School's card surcharge, where allowed, is shown first and charged as its
  own line. The payment counts only once Stripe confirms it, then pays the
  charge (or the oldest due first) and the receipt appears; an abandoned
  payment is marked Failed. A member with a saved card can turn on **Pay
  charges automatically with my saved card** (confirmed with their passcode):
  each charge is then charged once on its due date, and if the card is
  declined the member is told and pays it themselves. On the portal, the
  student's **Payments** card shows card payments as paid in the app or paid
  automatically, and Pending or Failed ones. **Needs a database migration**
  (`20270113000000_charges_pay_in_app`).
- **Late fees** (backlog 3.7; Decision 413) — a new **Late fees** card on the
  School page (owner only) lets a School add a late fee to overdue payments.
  It is **off by default**; switching it on needs the tick "I confirm late
  fees are legal where my School operates". The fee is a fixed amount or a %
  (up to 100%, two decimals), with a grace period of 3 days by default (0-30).
  Once a day, a charge still not fully paid after its due date plus the grace
  days, or a card membership renewal Stripe couldn't collect and still unpaid
  after the grace days, gets **one** late fee: never repeated, never on a late
  fee, and never for a payment that was already late before late fees were
  switched on. A % is of what is still owed. The fee goes on the member's
  balance as a charge, with the School's tax, to pay in the app or at the
  desk; it is never charged to a card automatically, even with automatic
  payment on. The member is notified. On the student's **Payments** card a
  late fee shows a **Late fee** badge and what it is for, and the owner and
  staff with "Can cancel charges" can **Waive** it; the student app labels it
  "Late fee" too. **Needs a database migration**
  (`20270116000000_late_fees`).
- **Income categories** (Decision 316 item 10; Gymdesk P17/BL18) — a new
  **Income categories** card on the School page (owner only) lets a School
  name its own categories (e.g. "Kids programme", "Merchandise"): add, rename,
  and delete one nothing uses (one in use can only be renamed). A membership
  plan (Policies step of the plan form), a staff-created charge and a
  recurring charge can each carry one; every charge a recurring charge makes
  carries its category. The student's **Payments** card shows a charge's
  category to staff, and the **Transactions** CSV export has a new last
  column, **Income category**: the category of the plan (a purchase or a
  renewal) or of the charge (a payment toward it), as it is now. Members never
  see categories. No accounting codes and no accounting integration. **Needs
  a database migration** (`20270212000001_income_categories`).
- **Joining fee on plans** (Decision 316 item 3, as answered by Decision 435
  items 1-6; Gymdesk P10) — a new **Joining fees** card on the School page
  (owner only, off by default) switches them on. A paid plan's Policies step
  has a **Joining fee** and whether it is refunded with the membership. The
  fee is added once, to a member's first-ever plan at the School (not a
  rejoin after a gap, not a renewal): to the card payment in the app (its own
  line on hosted Checkout and on a Subscription's first Stripe invoice), to
  the member's own Cash/Bank order, and to a sale at the desk. The plan's tax
  and the card surcharge apply to it too. The app shows "+ joining fee on your
  first plan"; the desk (**Sell a plan**, **Record a payment**) shows the fee
  and the total to collect for that member. A non-refundable fee is always
  left out of refunds (desk refunds, a Class Pack's refunded classes); a
  refundable one goes back with the payment. Switched off, the amounts stay on
  the plans but nothing is charged. **Needs a database migration**
  (`20270225100000_plan_joining_fee`).
- **Member limit and waiting list** (Decision 316 item 5, as answered by
  Decision 435 items 10-15; Gymdesk P18) — a plan's Pricing step has a
  **Member limit** (blank = none). Live and frozen members and Cash/Bank
  payments still waiting take a place, each person once. When a plan is full,
  members (or a parent for their child) can't buy it in the app and join its
  **waiting list** instead, seeing their place in line; owners and staff can
  still sell it at the desk. When a place frees up, the first person waiting is
  told and the place is held for them for 24 hours, then it passes to the next.
  Lowering the limit keeps current members and closes the plan to new buyers
  until there is room. The plan's Members page shows the places taken and the
  waiting list. **Needs a database migration**
  (`20270225100200_plan_member_limit`).
- **Contracts on plans** (Decision 316 item 6; Gymdesk DOC2) — a new
  **Contract** card on a plan's edit page (owner only) holds the School's own
  contract text and, for a Subscription, a **minimum term** (months) and an
  **early-exit fee**. In the ULTM8 app, buying a plan with a contract shows
  **Read and sign the contract** first: the member reads it in full and signs
  it like a waiver (full name, typed signature, optional drawn signature); a
  parent signs for their child, and someone under 18 can't sign for
  themselves. A copy of exactly what was signed is kept with its SHA-256
  fingerprint, so later edits never change it (each edit is a new version, and
  only new buyers sign it). Each signature buys once. Before cancelling, the
  app shows when the minimum term ends and the fee; if the member (or their
  parent) cancels and the membership ends before the signed term does, the
  signed fee goes on their balance as a charge with the School's tax, and they
  get the usual "New invoice" notice. A plan with a contract can't be sold at
  the desk. The owner sees a student's **Signed contracts** on their page,
  with the text signed. **Needs a database migration**
  (`20270217000001_plan_contracts`).
- **Plan start and end dates** (Decision 316 item 4, as answered by Decision
  435 items 7-9; Gymdesk P9/P13/P14) — on the plan form, a Class Pack, Weekly
  Pass or Trial can **start on the member's first check-in** (its days start
  with the first check-in it pays for; no end date until then), or run on
  **fixed dates** (a 6-week camp: a first and last day in place of the number
  of days; sold before it starts and after at full price, never after its
  last day; it pays for no class before its first day). A plan with an end
  can **switch to another plan when it ends** (a paid Class Pack, Weekly Pass
  or Trial without a contract): in the app the member (a parent for a child)
  agrees when buying; they're told up to 7 days before; at the end the next
  plan is charged to their saved card with the card surcharge and starts; with
  no saved card or a declined card it simply ends and nothing is owed. The
  Student's page and the app show a membership waiting for its first check-in
  and the plan it switches to. **Needs a database migration**
  (`20270225100100_plan_dates`).
- **A plan switch into a full plan ends instead** (Decision 316 items 4-5,
  owner's answer of 6 Nov 2026) — when a membership ends and the plan it
  switches to is full under its member limit, the switch doesn't happen: the
  membership simply ends, nothing is charged (the limit is checked before the
  card), and the member gets the usual "Membership ended" notice, as when the
  next plan can no longer be sold. A place held for the member on that plan's
  waiting list counts as room, so they still switch. The "Your plan is about
  to change" notice 7 days before (push, email and in-app) now says so too:
  "Without a saved card, or if {next plan} is full, it simply ends and nothing
  is charged." (all 15 languages). No migration.
- **The full-plan line in two more places, a waiver notice fix, and a
  translation pass on 6 Nov's new text** (Track A and Track B; Decisions 436
  item 8 and 438 item 2):
  - the member's agreement line when buying a plan that switches, and the
    owner's hint under "When it ends, switch to" on the plan form, now also say
    that if the next plan is full, it simply ends and nothing is charged (all
    15 languages);
  - waiver requests stored before the notice named the School read
    "{waiver} has invited you to sign the following waiver.", with the
    waiver's name where the sender belongs. They now read "You've been invited
    to sign the waiver "{waiver}"." in English and in every translation. New
    requests already name the School;
  - the text added by the payroll switch, the plan-switch notice, the Connect
    Stripe country gate and Delete my account was checked in all 14 other
    languages against the glossaries in `docs/translations/`: Turkish and
    French "siz"/"vous" where "sen"/"tu" had slipped in, the passcode and
    waiver words each app already uses, gender-neutral Polish, Korean
    particles and 원장, and Italian "titolare".

  Only text values changed; no keys or placeholders. No migration.
- **Contracts on plans: ending after the minimum term, freezes and the
  early-exit label** (Decision 435 items 16, 17, 19) — the Contract card has a
  new **End the Subscription after the minimum term** option: the member is
  told when signing, the app shows "Ends after its minimum term, on …", and ten
  days before that day the Subscription is set to stop on it instead of
  renewing (the usual 7-day reminder follows). A freeze now pushes the end of
  the minimum term back by the days frozen, for the early-exit fee and for the
  stop. A contract's early-exit fee shows as **Early-exit fee** on the
  student's invoices in the portal and in the app, like the late-fee badge.
  **Needs a database migration**
  (`20270219000001_contract_ends_after_minimum_term`).
- **Medical information at sign-up** (Decision 315 item 10; Gymdesk SF6) — a
  new **Medical information at sign-up** card on the School page (owner only)
  lets a School ask for medical information. It is **off by default**, so
  nothing changes until an owner turns it on. When on, the front-desk tablet's
  sign-up form and **joining a School in the ULTM8 app** show an optional
  "Medical information" box (up to 2,000 characters) and a consent tick box.
  It is kept **only with consent**: the person signing up consents for
  themselves, and for a child the **Guardian** consents when joining them in
  the app (a child can't give it, and staff enrolling someone can't give it
  for them); without the tick nothing is stored. Who consented and when are
  recorded. A tablet sign-up's medical information moves to the member when
  staff approve it (or when an existing account accepts the invite) and is
  never shown on the Sign-ups list. Only the **School's owners** and Branch
  Staff with the new **See medical information** access switch (off by
  default, for their own branches' students; coaches never) see it, on a new
  **Medical information** card on the student's page. The member never sees
  the text again, but **consent can be withdrawn** (Decision 419 item 1): on
  **My Profile** in the ULTM8 app (and, for a child, on the Guardian's screen
  for that child) a "Medical information: shared with {School}" line shows the
  date consent was given, with a **Withdraw consent** button and a
  confirmation. Withdrawing deletes that School's copy **at once** (and any
  medical information still waiting on a sign-up invite there); the
  student's card then says "No medical information." A child can't withdraw
  it, only their Guardian. It is also **deleted when the member leaves the
  School** (removed by the owner; a daily check catches any other way an
  enrolment ends), with the student's account (also when a Guardian
  withdraws a child's baseline consent) and with the School, including a
  closed School that is kept anonymised for its waivers. Merging duplicate
  members keeps the kept member's medical information, or brings the
  duplicate's with its consent when the kept member has none. **Needs a
  database migration** (`20270205000000_medical_info`).
- **Rosters and reminders** (Decision 317 items 6 and 7):
  - **Rosters**: named lists of students for staff. Students → "Manage
    rosters" creates, renames and deletes them and adds or removes students.
    The Students list has a Roster filter, and a class's Roll call can show
    one roster's booked students. Being on a roster doesn't change who can
    book, and students never see rosters. Staff see and change only the
    students of their own branches; Branch Staff need the Students switch to
    change rosters.
  - **Membership ending soon**: a daily reminder to the member 7 days before a
    membership ends (a child's Guardian gets it as "For {name}: …"), once per
    end date. Friend Passes and visit passes get none.
  - **Member absent**: a daily alert to the School's owners when a member
    hasn't checked in for the number of weeks set on the School page
    ("Absence alert (weeks)"; empty, the default, turns it off). Once per
    absence; a new check-in starts a new one.
  - **Memberships ending soon** (weekly report): on the first day of the
    School's week, the owners get one notice listing the memberships ending in
    the next 7 days (the same memberships as the reminder above). Nothing is
    sent when none are ending.
  - The "+ Log attendance" student picker can be narrowed to a roster.
  - Migration `20270126000000_rosters_and_reminders`.
- **Paying a promotion fee** (backlog 3.6 step 6; Decisions 300, 303) — when a
  student, or a Guardian for a child, accepts a promotion fee, it becomes an
  invoice on the student's balance: the rank it is for, the fee with the
  School's tax, due that day. It is paid like any charge: at the desk, in the
  app, or automatically with a saved card if the member turned that on; credit
  on the balance pays it straight away. Once it is fully paid the fee shows
  **Paid** and a promotion that was waiting for it goes through, with the
  coach's grading date. Waiving or cancelling the fee in grading cancels the
  invoice, and anything already paid becomes credit. On the student's
  **Payments** card the invoice shows a **Promotion fee** badge, the style and
  grade, and a link to grading; it can't be cancelled there (it is waived or
  cancelled from grading). Each style on the student's page lists its
  promotion fees and their invoices. In the student app the fee card shows
  any tax added on top before accepting, then the invoice and **Pay now**;
  Invoices labels it "Promotion fee". Late fees and payment notices apply to
  it as to any charge. Fees accepted before this change get their invoice
  from the next daily payments run. **Needs a database migration**
  (`20270117000000_promotion_fee_charges`).
- **Charges and member balance, step 3: recurring charges** (backlog 3.6;
  Decisions 303, 338, 412) — on a student's **Payments** card, staff who can
  create charges set up a **recurring charge**: description, price, discount,
  weekly, monthly or yearly, a first date, and optionally an end date or a
  number of payments. Each occurrence becomes a normal charge on its date, with
  its own invoice number and the School's tax that day, and is paid from
  credit or automatically like any charge (a daily job at 5:30am UTC, in the
  School's time zone, catching up missed days once each). The card lists the
  student's recurring charges with **Stop** (the same staff) and **Restart**
  (the owner, and Branch Staff when the School lets them take payments). A
  former student's recurring charge stops; a closed or degraded School makes
  none. The student app's **Invoices** shows the member's recurring charges,
  read-only, and the member is told when one is set up, stopped or restarted
  (15 languages). **Needs a database migration**
  (`20270115000000_charges_recurring`).
- **Schools set their own trial limits** (Decision 410) — a Trial plan can
  last any number of days the School chooses (at least 1), no longer 1-30, and
  a Student can have another trial straight after the first: the limit of 30
  trial days per Student per School in 12 months (from Decision 334) is gone.
  This applies to plan editing, app purchases, cash/bank confirmation, card
  payments and desk sales. Existing plans keep their length.
- **Staff activity log** (Decision 408) — a new "Activity" section on the
  Staff page lists every staff change (roles, Remove from School, Pause,
  access, display name and work phone, owners, invites, the "must accept
  first" setting and open mat permission), newest first, with who did it and
  when, and a filter by person. Owners and co-owners only; it starts from
  deploy day.
- **Only the main owner adds or removes people** (Decision 423 item 10) —
  at a School, only its main owner can now give or remove a co-owner, coach
  or Branch Staff role, add staff or instructors manually, send or cancel
  invites, pause, unpause, Remove from School, or move staff roles when
  closing a Branch. Co-owners, Branch Staff and coaches get a 403 from the API
  and, in the portal, a short note ("Only the account's main owner can add or
  remove people") in place of those controls, in every language. Co-owners
  keep everything else (Access, Edit details, the invite list read only).
  The Branch Staff switch "Invite coaches" is gone from the Access window,
  its presets and the API; the "Invite coaches" page for staff now shows the
  note. Open invites that co-owners or Branch Staff had sent are cancelled.
  Students and Guardians still join by themselves, and any owner can still
  end a student's enrolment. **Needs a database migration**
  (`20270213000000_main_owner_grants_roles`, drops
  `StaffPermission.canInviteCoaches`).
- **Freezing a membership** (backlog 3.4; Decision 404) — the owner can freeze
  a Subscription, Weekly Pass or Trial straight away with a **Freeze** button on
  the student's Memberships card, and approve or decline the freezes members
  (or a child's Guardian) ask for in the student app, there or in the new
  **Freeze requests** card on the Students page. A freeze is at least 7 days,
  starts today or later, and stays within the School's maximum in any 12
  months (default 90). While frozen, a card Subscription's next charge moves
  later by the freeze (nothing is charged, no frozen days paid for), a Weekly
  Pass or Trial's end date moves later, and the member can't book or check in
  unless the new check-in rule **Allow frozen members to check in** is on
  (off by default). Staff or the member can end a freeze early; billing
  restarts that day. The School page's **Freezing memberships** card sets the
  maximum and an optional freeze fee, charged once when a freeze is approved
  (on a saved card, else a pending cash charge for the desk; never refunded).
  The Students list shows a blue **Frozen** badge and a **Frozen only** filter.
  Class packs can't be frozen. **Needs a database migration**
  (`20270106000000_membership_freeze`).
- **Card surcharge** (backlog 3.8; Decision 406) — off everywhere by default.
  Platform Admin has a new **Card Surcharge** page listing the countries where
  a School may add a surcharge to members' card payments; the list starts
  empty and a country is added only after legal review (Billing & Payments
  Ops or Full Admins; every change is audit-logged). Where the School's
  country is listed, the owner turns it on in School settings with a % up to
  3% and must tick "I confirm surcharges are legal where my School operates".
  Members see it on the plan before paying, it is its own line on the hosted
  checkout, the Transactions page and the student app's payment history, and
  it is never added to cash, bank transfer or Subscription payments.
  Removing a country stops it at once (the School's % is kept). **Needs a
  database migration** (`20270105000000_card_surcharge`).
- **Franchise fee paid by card** (backlog 3.22; Decisions 352, 407) — the
  Franchise page has a **Connect Stripe** card showing Connected, Action needed
  or Not connected; it starts Stripe's own onboarding (the country of the
  business's bank account is asked the first time). On the School page's
  Franchise affiliation card the School Owner presses **Add card** to save a
  card on Stripe's secure page; it is kept for the School on the Franchise's
  Stripe account and becomes the default payment method of the School's
  franchise-fee subscription, existing or future, so the monthly fee is
  charged to it automatically. A failed charge is retried by Stripe, shows as
  Failed in the fee charges, and sends the School Owner a notice to update the
  card; nothing is locked. The School Owner sees the School's fee charges
  (period, amount, paid or failed) on the School page, and only the School's
  Owner/Manager can now read them. **Needs migration
  `20270104000000_franchise_fee_card`.**
- **"Step up" on a Levels style** (Decision 402) — on a style shown as Levels,
  moving up a step inside a level now says **Step up** instead of "Stripe
  awarded": the grade button ("Step up" instead of "Award stripe"), the
  student's history and the Grading Board panel ("Step up", "Step up (bulk)"),
  the coach and student screens in the student app, and the student's or
  Guardian's notification ("Step up!" instead of "New stripe!"). Moving to a
  new level still says "Promoted"; Belts styles are unchanged. In all 15
  languages.
- **Temporary passcode for a new student, and adding a child** (backlog 3.3;
  Decision 403) — Add manually now always shows the owner the temporary
  passcode once, and it stops working after 7 days unless used; while it's
  unused, the owner can make a new one from the student's page ("App access").
  A child can now be added too: a child has no login of their own, so the
  owner names their Guardian. A new Guardian gets an account with the
  temporary passcode and the child is enrolled at once; a Guardian who already
  has an account is asked in the app to accept ("Add {child} to {School}?"),
  and the owner sees these under "Waiting for a Guardian" on the Students page
  and can withdraw them. Only the School that made an account can replace its
  temporary passcode. **Needs a database migration**
  (`20270103000000_temporary_passcode`).
- **New staff must accept first** (Decision 396) — a new switch in the Staff
  page's "Give a role" card, off by default. When it's on, giving someone the
  Instructor or Branch Staff role emails them an invite link instead, and
  they get the role when they accept it (co-owners still get it at once).
  Coach invites can now also be Branch Staff invites, from the owner only.
  Needs migration `20270103000000_staff_must_accept`.
- **Ranks without a belt: Levels** (backlog 3.19; Decisions 290, 401) — a style
  can now show its ranks as **Levels (no belt)** instead of belts: each rank is
  a coloured badge with numbered steps (Beginner 1, 2, 3), each step with its
  own requirements. Set it in Add/Edit discipline or in Grading → Settings
  ("How ranks are shown"). The rank editor then has a badge colour and steps
  instead of belt colours and stripes, and the board, student pages and the
  student app draw the badge. Grading works exactly as for stripes. **Needs a
  database migration** (`20270102000000_rank_levels`).
- **Staff notes on a student** (backlog 3.10; Decisions 315, 400) — a
  **Notes** card on the student's page: any staff who can see the student add
  notes, staff-only or ticked **Show to member**; the author or an owner edits
  or deletes one. Shown notes appear in the student app (*Notes from your
  School*, and a child's for their Guardian), on the staff check-in card, and
  on the front-desk tablet after the member scans their QR or types their
  code. **Needs a database migration** (`20270101000000_student_notes`).
- **Export the student list** (backlog 3.9; Decisions 315, 399) — an **Export**
  button on the Students page downloads a CSV, or opens a page to print, of
  active students, active and former, members only or visitors only. Children
  are included, with their Guardian. Columns: name, contact, date of birth and
  age, status, joined, home branch, Visitor, current memberships, billing,
  belts, last visit. The owner can always export; Branch Staff can once the owner
  turns on the new "Export the student list" access switch. Every export is
  logged. **Needs a database migration** (`20261231000000_student_export`).
- **Fix: confirming many cash payments at once** — confirming or cancelling a
  cash or bank-transfer payment now waits up to 10 seconds for a free database
  connection, as booking does, instead of answering "The server is busy" after
  2 seconds when the desk settles a lot of payments together. No migration.
- **Membership card** (backlog 3.11; Decision 398) — "Print membership card"
  on the student's page opens a bank-card-sized card to print: the School,
  the student's photo and name, their check-in code and their current
  memberships. It has no QR code, because a printed one would never change. In
  the app, the same card sits under the live QR on "Show my code". No
  migration.
- **A parent sees their child's membership card** (Track B, `apps/student`;
  Decision 398) — each child in "My children" has "Membership card": the
  child's card at each of their Schools (photo, name, check-in code, current
  memberships), the same card the child sees. No QR on it. Uses the existing
  `GET /schools/{schoolId}/students/{studentId}/membership-card`. No database
  change.
- **Gender: Female or Male** (backlog 3.15; Decision 315 item 15) — gender is
  now a choice of Female, Male or not given, in the portal (Edit profile,
  register) and the student app (profile), and the API refuses anything else.
  **Needs a database migration** (`20261230000000_gender_female_male`). It turns
  "female"/"male" in any letter case into the new values and clears every other
  saved value, which was sample data.
- **Kids and Adult programs** (backlog 3.20; Decisions 281, 285, 397) — Edit
  discipline links a Kids style to its Adult style. From "Ready for Adult from
  age" (Grading → Settings, default 16) a Kids student shows "Ready for Adult
  program", and Grade lists the Adult ranks from the second Adult belt under an
  "Adult program" heading: the student moves to the Adult style, keeps their
  history and matching skill sign-offs, and starts the class count again. The
  Grading Board has a Kids · Adult switch. **Needs a database migration**
  (`20261229000000_kids_adult_programs`).
- **Sell a used-up pack at the desk** (Decision 395) — the "Pack used up"
  card on Check-in also has "Sell at the desk": choose how it was paid (cash,
  bank transfer, Pix or card terminal), record it, and the person is checked
  in. The owner, and Branch Staff allowed to record payments. No migration.
- **Check-in rules** (Decision 394) — Check-in → Check-in rules sets, for
  every way in (app, coach's scan, front desk, tablet), when check-in opens
  and closes, whether a signed waiver is needed, whether members may check
  in at other branches, whether visitors check in on a visit pass, and
  whether the desk checks in to several classes at once. Every default is
  how check-in worked before. The owner, and Branch Staff given the new
  "Change check-in rules" access switch. Needs migration
  `20261225000100_check_in_rules`.
- **Saved belt colours** (backlog 3.18) — every colour row in the belt editor
  (base, secondary, tag and stripe colours) now shows preset circles, the
  School's saved colours and a "+" that opens a colour wheel with Brightness
  and a colour code box. "Save colour" applies a colour and keeps it for every
  row and every style at the School; Edit replaces a saved colour, Delete
  removes it without changing belts that use it. The owner, or Branch Staff
  who manage disciplines, can change the list. **Needs a database migration**
  (`20261226000000_saved_belt_colours`).
- **Colour wheel: the white centre picks white in every browser** — clicking
  the centre of the belt editor's colour wheel could pick a faint tint (such
  as #FEFEFF) instead of white, because Firefox reports whole-pixel pointer
  positions and the click landed a fraction of a pixel off centre. Anywhere
  within one pixel of the centre is now white, and is drawn white.
- **Free trial of ULTM8 for Schools** (backlog 3.14; Decision 318 item 5) — a
  Full Platform Admin starts or extends a School's free trial in Platform Admin
  (Schools → look up), with no card. The owner sees how many days are left at
  the top of the portal. When it ends without a platform subscription, the
  School is read-only (no new classes, bookings or payments) until it
  subscribes; nothing is deleted. **Needs a database migration**
  (`20261228000000_platform_trial`).
- **Students can ask for a belt correction** (backlog 3.13; Decisions 286,
  299) — in the student app, a student whose recorded belt is wrong picks the
  belt they should have, anywhere on the style's ladder, and says why. The
  owner, or a coach with "Verify ranks" for that style and the student's
  branch, approves it on the student's page (the student moves, and the history
  shows the correction and who made it) or rejects it, with an optional note
  back. **Needs a database migration** (`20261227000000_rank_correction_requests`).
- **Sign-up on the front-desk tablet** (Decision 392) — people sign up on the
  tablet (adults; Visitor only when the School has set a visit pass length) and
  wait for staff. The owner, or Branch Staff with the Students switch, approves
  or rejects them under Students → Sign-ups. A new email gets an account and a
  temporary passcode; an email that already has an account gets an invite to
  accept in the student app. A rejected sign-up gets a polite email, can still
  be approved for 30 days, then is deleted. Each School edits its own "How did
  you hear about us?" list in School settings.
- **No more decision numbers in messages** (backlog 3.17) — error messages and
  grading history notes no longer end with internal references such as
  "(Decision 147)", in every language. Saved history notes are cleaned too.
  **Needs a database migration** (`20261225000000_clean_system_notes`).
- **Front desk: pack used up** (Decision 393) — when a Class Pack has no
  classes left at check-in, the desk (or the tablet, after a scan) offers the
  same pack. The member, or their Guardian, buys it on the student app's Home,
  and the check-in finishes on its own as soon as it's paid.
- **Front desk: start an open mat** (Decision 386) — "+ Open mat session"
  on the Check-in page makes a one-off open mat class today (style, start,
  length), and students who train that style at that branch are told in the
  app. The owner, and staff given "Can start open mat sessions" on the
  Staff page. Needs migration `20261221000000_open_mat_permission`.
- **"Open mat uses a class credit"** (Decision 304 item 3) — a new switch in
  Settings → Check-in rules, on by default (as today: an open mat takes a
  Class Pack or Friend Pass credit like any class). Off: booking an open mat
  still needs a membership or pass that covers it, but takes no credit, and
  cancelling it gives nothing back. A class counts as open mat when every
  style on it has the class type "Open mat". **Needs a database migration**
  (`20270214000002_open_mat_class_credit`).
- **Visitors and visit passes** (Decision 391) — each School sets how long a
  free visit pass lasts (School settings; no default). The owner, or Branch
  Staff with the Students switch, gives a pass from the student's page; while it
  lasts the Visitor books and checks in free, and a second pass starts when the
  first ends. Visitors carry a "Visitor" badge on the Students list. A
  membership makes them a member.
- **Staff page: Pause and Unpause** (Decision 390). An owner can pause a
  coach or a Branch Staff member. All their roles at the School stop straight
  away, even if they are signed in. Everything set for them is kept: access
  switches, grading permissions, display name, and the classes they teach.
  Unpause gives the same roles back, except at a branch that was closed in
  the meantime. Paused people stay on the Staff list with a "Paused" badge and
  have their own status filter. Owners can't be paused. Remove from School
  still works on someone who is paused.
- **Front desk: the locked tablet is harder to misuse** (Decision 388) — someone
  found by name on the tablet is checked in only to classes they've already
  booked; booking a place there needs the app QR or their own personal
  check-in code, so nobody can spend another member's credit by typing their
  name. Ten wrong staff codes end the tablet's session, and closing a Branch
  ends its tablet. The staff Check-in page is unchanged. **Needs a database
  migration** (`20261220000000_front_desk_wrong_codes`).
- **Front desk: Find me on the tablet** (Decision 385) — someone about to
  sign up types their full name and date of birth; the tablet says only
  whether they're already a member (both must match), and shows nothing
  stored about them.
- **Memberships: the plan's cancellation charge is now taken** (Decision 389,
  no migration) — when a student cancels a class too late and the class has no
  cancellation charge of its own, the charge set on their membership plan is
  taken from their saved card, the same way a class's charge already is. One
  fee per cancellation, never both.
- **Front desk: personal check-in codes** (Decision 384) — each student has
  a 4- or 6-digit code, shown on their page with "Give a new code". Typing it
  on the Check-in page's or the tablet's Code tab opens their welcome card,
  and the check-in shows as "Code". Needs migration
  `20261217000000_student_check_in_codes`.
- **Transactions: refunds made in Stripe show up** (Decision 382) — a card
  payment refunded in the Stripe dashboard now shows as Refunded on the
  Transactions page (or with the refunded amount, for a part refund), in the
  portal and the student app. A full refund also ends the membership it paid
  for (future bookings cancelled, Subscription stopped); a part refund keeps
  it. A refund that later fails turns the payment back to Successful. No
  database change. Needs the `charge.refunded` and
  `charge.refund.updated` events switched on for the Stripe webhook.
- **Front desk: a locked tablet, left with your own staff code** (Decision
  380) — starting front-desk mode signs you out of the device, so it holds no
  staff login; it shows only its Branch's classes and short names, and only
  check-in and sign-up work on it. Leaving takes a staff member's own code
  (shown on the start screen and the Check-in page, with "Get a new code").
  The Check-in page lists tablets in front-desk mode and can end one. New
  School setting: check-in code length (4 or 6 digits). Needs migration
  `20261216000000_front_desk_sessions`.
- **Disciplines: Branch Staff the owner allows can manage styles** (Decision
  383) — a new "Can manage disciplines" switch per Branch Staff member on the
  Staff page, off by default. With it on, they edit styles, belts and skills
  like the owner, with every safety check covering the whole School; grade
  prices and the students list stay the owner's. An archived style nobody
  uses shows "Delete permanently". Migration
  `20261217000000_staff_manage_disciplines`.
- **Translations review** — 83 newer API error messages (desk sales, cancelling
  a Subscription, promotion fees, timetable breaks and closures, waitlist, staff
  removal) are now translated into all 14 languages, so a non-English screen
  shows the real reason instead of the generic one. Eleven of them are reworded
  in English too, without field names or API paths ("Leave the number of
  classes empty" instead of "omit classesIncluded"). Mixed terms made consistent:
  Korean uses 수련생 for Student throughout, the Friend Pass has one name in
  Portuguese (BR), Spanish, French, Russian, Chinese and Arabic, Japanese and
  Russian name Activities one way, and Italian calls a Class "Corso" in
  Cancellations. The Arabic booked count on the Dashboard has all its plural
  forms. New tests fail CI when a screen text or an API error message is missing
  in any language, or a plural form is missing.
- **Translation review: Brazilian Portuguese and Spanish** — every pt-BR and
  es text in the portal, the student app and the server's messages checked
  against the English, with a glossary of martial-arts and billing terms
  (`docs/translations/REVIEW-pt-BR-es.md`). 288 Portuguese and 650 Spanish
  texts corrected. Portuguese now says "unidade" for a Branch, "código de
  acesso" for the passcode everywhere, and "plano" instead of "assinatura"
  where it could be read as a signature. Spanish now uses neutral Latin
  American words instead of Spain-only ones (agregar, ingresar, paquete de
  clases, lugar, vencido, monto, celular, tasa de impuesto), says "check-in"
  instead of "registro", and fixes "You're invited to coach" (it said "to
  train") and "Paid" in payment history. 460 legal, consent, privacy and
  money texts per language are listed for a paid native reviewer
  (`docs/translations/high-risk-pt-BR.csv`, `high-risk-es.csv`). Texts only;
  no key, placeholder or behaviour changed.
- **Front desk: one-step check-in** (Decision 378) — the welcome card's
  confirm now books, checks in and checks in the ticked guests in one go. If
  one class can't be done (full, not open yet, no membership…), nothing is
  checked in, and the card says which class and why.
- **Staging deploy readiness (Render + Supabase + Vercel):**
  - **api — the API refuses to start when misconfigured.** With
    `NODE_ENV=production` (every deployed environment), it won't start unless
    all of these hold:
    - Every scoped `DATABASE_URL_*` is set, is not the superuser, and doesn't
      use the dev password `changeme`. Before, an unset one silently fell back
      to the superuser and bypassed RLS.
    - `REDIS_URL`, `CORS_ALLOWED_ORIGINS` and `PORTAL_BASE_URL` are set.
    - The four signing secrets are each 32+ characters and all different.

    Missing vendor keys are only logged. Local dev and CI are unchanged.
  - **api — new `GET /v1/health`:** public and unthrottled. It reports the
    database (as `ultm8_app`) and Redis as ok/down, with a 503 if either is
    down.
  - **api — one shared Redis connection for all job queues.**
    - Every BullMQ Queue and Worker now shares one connection instead of
      opening its own. Only each Worker's blocking connection is separate.
    - Measured against Redis 7: one API process went from 52 connections
      to 18.
    - 52 was over the 50 a free Render Key Value allows. The staging API
      crashed with "Connection is closed" on every redeploy, while the old
      and new instances overlapped.
  - **api — dev seed scripts refuse non-local databases.** They create logins
    with passcode `123456`. To seed a throwaway staging database on purpose,
    set `ULTM8_ALLOW_DEV_SEED_HOST=<host>`. They always refuse under
    `NODE_ENV=production`.
  - **api — `scripts/rotate-role-passwords.js`** sets all six scoped role
    passwords from their connection strings. It runs on each Render build,
    after `prisma migrate deploy`.
  - **`render.yaml` rewritten for the current API:**
    - Adds migrations and role-password rotation to the build, the health
      check, and the two newer DB roles.
    - Adds the QR and refresh/step-up settings, `PORTAL_BASE_URL`, and every
      vendor key as `sync: false`.
    - Removes the dummy Stripe keys.
  - **school-portal, platform-admin: `vercel.json`** for monorepo builds, SPA
    routing and basic security headers.
  - **New guide `docs/deploy/STAGING-RUNBOOK.md`.**
  - **api — migration `20260904000000_fix_rolegrant_rls_recursion` now runs on
    Supabase.**
    - It restores the two GRANTs that had been fixed only on the old Track B
      staging branch: `GRANT ultm8_rls_helper TO CURRENT_USER` and
      `GRANT CREATE ON SCHEMA public TO ultm8_rls_helper`.
    - Without them, a fresh database whose deploy role isn't a true superuser
      (Supabase's `postgres`) stopped at "permission denied for schema public".
    - The file is now byte-identical to the version already applied on the
      live staging database. On CI's superuser both GRANTs change nothing.

- **Parents can bring guests on their child's booking** (Decision 379) — new
  API for the Student app's parent booking screen: a parent sees their child's
  Schools, Friend Passes and upcoming bookings, books with guests on the
  child's Friend Passes, and gets each guest's waiver link. Kid Mode bookings
  can't add guests. No migration.
- **Guests are checked in one by one at the desk** (Decision 377) — the
  welcome card lists each guest under the member's class with their waiver
  status; staff tick the guests who came, and each guest's check-in is
  recorded. Needs migration `20261215000000_guest_check_in`.
- **Staff page: access switches** (Decision 387) — an owner chooses what each
  Branch Staff member may do ("Access" in the person's menu): manage classes
  and the timetable, bookings and check-in, students, cancelling classes with
  credit, seeing the staff list, and inviting coaches, with "Front desk" and
  "Branch manager" presets. Defaults keep what Branch Staff could already do.
  Branch Staff's menus, Classes, Timetable, Students and a read-only Staff list
  follow their switches. The "What Branch Staff can do" card moves into
  Access too, including "Manage disciplines" (Decision 383), which no preset
  ticks. Instructors and owners are unchanged. Needs the migration
  `20261219000000_staff_access`.
- **Staff page: display name and work phone** (Decision 381) — an owner can
  set the name and work phone the School uses for a staff member ("Edit
  details" in the person's menu). The Staff list shows them first, with the
  person's own account name and phone underneath, and search finds the
  display name too. The person's own account (real name, login email,
  personal phone) never changes. Needs the migration
  `20261216000000_staff_details`.
- **Staff page: main owner and co-owners** (Decision 370) — every School has
  one main owner; other owners are co-owners. "Give role" can now make someone
  a co-owner. Any owner can remove a co-owner, but nobody in the School can
  remove the main owner. The main owner can make a co-owner the main owner
  after re-entering their passcode, and stays on as a co-owner. ULTM8 support
  sees a School's owners on the Platform Admin School page and (Full Admin
  only) can move the main owner role, optionally removing the former main
  owner; both are audit-logged. Existing Schools: the earliest owner becomes
  the main owner. Needs the migration `20261213000100_school_main_owner`.
- **School settings review** (Decision 368) — the School page shows the
  School's join code (copy, make a new one), a logo upload and colour for the
  student app, and asks before a currency change moves membership plans to a
  new currency. "Ask to join" a Franchise shows its name first. Fixed: an
  Owner with two Schools could save one School's cancellation and footer
  settings onto the other; saving one card wiped another's typing; the
  no-show fee was typed in cents; a closed School's forms still showed;
  footer links without https:// opened broken pages; endless spinners on a
  load error or for non-owners; plain messages for blank names, waitlist
  window and footer fields; the School reply no longer carries Stripe ids.
  School details is split into three groups. No migration.
- **Signed-in users are no longer limited per internet address** (Decision
  376). Everyone at a School on the same WiFi shares one address, which was
  limited to 60 requests a minute; a busy front desk could hit it. Signed-in
  users now have only their own per-user limits; requests from people who
  aren't signed in keep the per-address limit.
- **Change passcode, unfinished sign-ups, 18+ to create a School**
  (Decision 375) — My profile can change the passcode (current one, then the
  new one twice), which signs out every other device; a sign-up whose phone
  was never verified can be replaced by a new sign-up after 30 minutes;
  creating a School needs the person to be 18 or over.
- **Sign-in and accounts fixes** (Decision 373) — sign-up and Forgot passcode
  no longer half-save an account or fail with a server error when text
  messages aren't set up; a first sign-in with a temporary passcode stays
  signed in past 15 minutes; logging in clears the previous person's data;
  Create your School has Log out; an unverified phone gets a plain message and
  a Verify link; sign-up refuses blank names and impossible birth dates;
  usernames ignore capitals; My profile can remove its photo; a Franchise
  owner without a School lands on Franchises.
- **Dashboard: Active students, birthdays and a setup checklist** (Decision 374)
  — an Active students card (students with a membership in effect); this
  week's birthdays, children included, with no ages, on the Dashboard and the
  coach dashboard; and a setup checklist for new Schools (Branch, style and
  belts, class, plan, waiver, Stripe, staff) that ticks itself and can be
  hidden. **Needs a database migration.**
- **"What's new"** (Decision 318 item 3) — news about ULTM8 written by ULTM8
  HQ on a new "What's new" page in Platform Admin (Full Admins write, edit and
  delete; every change is audit-logged), with an optional translation for each
  School Portal language. School owners and staff open it from a "What's new"
  button in the portal header and read the posts newest first, in their
  language, or in English when a post has no translation. The same posts for
  every School; students never see them. All 15 languages. **Needs a database
  migration** (`20270216000001_whats_new_feed`).

- **Check-in and front desk review fixes** (Decision 377) — a checked-in
  student keeps their seat, so a full class can't be booked past its limit; the
  welcome card no longer books a class whose check-in hasn't opened ("Check-in
  opens at …"); a scanned app QR is checked once and stays good for 5 minutes;
  the card shows which waivers are still to sign; Whole School classes show at
  every Branch; a School with no Branches can start front-desk mode; the page
  moves to the new day at midnight; a QR of someone who isn't a student here is
  refused instead of opening a blank card; places left count guests; the card
  waits for bookings before ticking; closed Branches are hidden; name search
  says when there are more matches. New text in all 15 languages.
- **Stress test round 3** — the same 30 Schools and 12,213 students as rounds 1
  and 2, plus four new scripts for everything added since; report in
  `docs/handover/STRESS-TEST-ROUND3.md`, scripts in
  `apps/api/scripts/stress/round3/`. Fixes below.
- **Remove from School works for a coach who still teaches** (product owner,
  28 Oct 2026) — the dialog shows how many upcoming classes and weekly slots
  they teach and asks what happens to them: give them to another coach, no
  coach for now, or cancel the classes (students told, credit per the
  School's cancellation settings; their weekly slots stay with no coach).
  The coach loses access at once either way.
- **API stress-test fixes: duplicate roles, passcode hashing, Add manually**
  (stress test round 3) — a double click on "Give role" (or two coach invites
  accepted at once) no longer gives someone the same role twice, so revoking
  it really ends the access; the database now allows one live grant per
  person, role and scope, and existing duplicates are revoked (the oldest is
  kept). Passcode hashing and checking no longer slow down every other
  request during a burst of logins or Add manually (native `bcrypt`, same
  hashes). A student "Add manually" that fails part-way no longer leaves an
  account behind, so the owner can just try again. Needs the migration
  `20261212000100_role_grant_one_live_per_scope`.
- **Round-3 stress-test fixes (races)** — a booking made while the School
  cancels the class is now either cancelled with the rest or refused ("This
  class has been cancelled by the school"); it used to stay booked on the
  cancelled class (also when a timetable slot is switched off with its booked
  classes cancelled). A class cancel that stopped half way (the server busy) is
  finished by cancelling again, instead of answering "already cancelled".
  Closing a Branch while people book its classes no longer fails with a server
  error on both sides, and those bookings move with their class. A style can
  no longer be archived while a class using it is being saved. Booking and
  checking in the same student from two desks at once no longer fails with a
  server error; the second booking gets the usual "already has a booking".
  A desk sale, a cash payment marked as paid, a booking or a waitlist place
  sent while the owner closes the School is now refused ("This School has been
  closed"); one of them could still be saved just after the close.
- **Round-3 stress-test fixes (billing and waivers)** — a payment that
  arrives after its School closed no longer starts a Subscription: it is
  refunded and the Stripe subscription cancelled, and closing a School also
  cancels Subscriptions still waiting for their first payment. Cancelling a
  Subscription several times at once calls Stripe once. A signature can no
  longer land on waiver terms the owner has just replaced, a double-clicked
  signature is saved once, and "Remind everyone" pressed several times at
  once reminds each student once.
- **Booking and desk rules (product owner, 28 Oct 2026)** — a student checked
  in to a class can't be booked into it again ("This student has already
  attended this class"); a cancelled booking still can. The same desk sale or
  Friend Pass for the same student within a minute is refused ("This was just
  recorded. Check before adding another."). A Friend Pass only covers a guest,
  never its holder's own seat. Staff booking for students can now book 200 a
  minute (students' own limit stays 20).
- **Dashboard review fixes** (Decision 367) — "Bookings this week" leaves
  cancelled bookings out and shows them as their own number; a new Attendance
  card shows this week's present and absent; a Branch filter for Schools with
  several Branches. The Bookings page groups by Style, lists each day's
  classes (time, booked / seats, link to the class), names each day correctly
  in the Americas, limits a range to 92 days with a clear message, counts
  each class on its Branch's local day, and keeps the dates in the address.
- **Instructors: resend passcode, self-edit, safer revoke, private details**
  (Decision 331) — the owner can send a new temporary passcode to an
  instructor who hasn't signed in yet; instructors can change their own
  photo, bio and the phone number the School sees on Complete your profile;
  an Instructor role can't be revoked while they still teach upcoming classes
  or weekly slots (the page offers "Hand over classes" instead); and an
  instructor's address and certification are shown only to the School owner
  and to the instructor, not to colleagues.
- **Staff page: staff list, Remove from School, "Give role", instant access
  changes (Decisions 360, 361)** — the Staff page now lists everyone with an
  owner, coach or Branch Staff role, filterable by role, branch, name and
  status (removed staff are hidden until "Removed" is picked), replacing the
  look-up by User ID. "Remove from School" ends all of someone's coach and
  staff roles at once and keeps their student account. "Send invite" is now
  "Give role", since it works straight away. A removed or changed role now
  applies on the person's next click, even if they are signed in, instead of
  up to 15 minutes later. Names made only of spaces are refused on Add staff
  manually. Needs the migration `20261211000000_user_roles_changed_at`.
- **Waivers: guests sign by a shared link** (Decision 366) — members can
  bring guests on a booking with their Friend Passes in the app, and each
  guest gets a link to sign the School's waivers on a web page, without an
  account (a parent or guardian signs for a guest under 18). The class page
  shows which guests haven't signed, with the link to copy, and the Waivers
  page lists guest signatures with the wording each one signed.
- **Close branch** (Decision 330) replaces Archive on the Branches page. Only
  what is still in use stops a Branch closing (upcoming classes, weekly slots,
  Instructor profiles, home-branch Students, staff and coach roles); past
  classes no longer do. The window asks where each group goes (another Branch,
  or the whole School where that makes sense), moves it all and closes the
  Branch in one step, and cancels open coach invites there. Nobody is charged
  or emailed. A closed Branch with history is kept for good; an empty one is
  removed after 90 days. "Reopen", "Closed" and "Show closed" replace the
  archive words, in all 15 languages. **Needs a database migration.**
- **Waivers: settings and follow-ups** (Decision 354) — a new Waivers →
  Settings page lets each School choose whether archived waivers' signatures
  still count, whether members sign again after a set number of months,
  whether a child signs again at 18, whether staff can record a paper
  signature (with a photo), whether new members are told which waivers to
  sign, and whether to remind members until they sign; each setting says
  what most schools choose. A waiver can now always be archived. Changing
  the wording of a signed waiver asks whether it's a small fix or new terms
  everyone signs again. Each waiver has a "Remind everyone who hasn't signed"
  button. A waiver signed by a parent is kept while the student is enrolled.
- **How long signed waivers are kept** (Decision 423 item 8, rules in
  Decision 426) — a signed waiver is kept while the person is a member of that
  School and for 7 years after they leave; for a child, until they turn 25 if
  that is later (this was 24); then the daily purge deletes it. Someone who
  was never a member counts from the day they signed; a School closing counts
  as every member leaving that day; a signature left on a merged duplicate is
  kept while the kept record is a member; an unsigned entry goes when the
  person leaves. Guests: 7 years after the class, and not before 25 for a
  child. One platform-wide rule that a School cannot shorten, shown on the
  Waiver settings page and in the archive dialog. A waiver a parent signed for
  a child with no date of birth on file is kept, and marked "Needs date of
  birth" in the Signatures list. Each deletion is recorded in a permanent log
  with no personal data. Once a closed School's last signature is gone, its
  waivers and then the School are deleted. The database now refuses to delete
  a member account or waiver that still has a signature. All 15 languages.
  Not legal advice: a privacy lawyer is to confirm it per country. **Needs a
  database migration** (`20270214000000_waiver_signature_retention`).
- **Children sign their own waivers from an age the School sets** (Decision
  318 item 8) — a new Waivers → Settings switch, off by default (a parent or
  guardian signs). When on, a child from that age (1 to 17) signs their own
  waivers: with their own login, or in their parent's app, where "Who is
  signing?" lets the parent hand the phone over. A parent can still sign for
  the child as before. The child is recorded as the signer, with the parent's
  account kept beside it, and the Signatures list says "signed by the child,
  in their parent's app". All 15 languages. **Needs a database migration**
  (`20270213000001_waiver_child_signs`).
- **Children's waivers and photos: follow-ups** (Decision 435 items 28, 30,
  32) — the Students list now shows a child's photo only when a parent has
  given camera consent, the same rule as the Grading Board and the front-desk
  tablet. When a child signs a waiver themselves (with their own login, or in
  a parent's app), each of their parents gets a "Waiver signed by your child"
  notice in the app (and by push and email where those are set up). In the
  "Export all signed documents" ZIP, a waiver the child signed in their
  parent's app is marked "Signed by the child in their parent's app" in the
  index and on its PDF. All 15 languages. No database change.
- **Member app switches** (Decision 318 item 7) — a new "Member app" card on
  the School page. The owner turns on or off what members may do themselves
  in the ULTM8 app: edit their own profile (their language and currency stay
  theirs), cancel their own Subscription (or a parent their child's), add
  their children to the School, and see their payment history. All four are
  on by default, as before. The API refuses what a School turned off, not only
  the app. New: a **grading countdown** (off by default) shows the School's
  next grading day ("Grading in 23 days"), a date the owner sets on the same
  card, and each student's classes and days still needed for their next rank.
  All 15 languages. **Needs a database migration**
  (`20270216000000_member_app_switches`).
- **School Owners can close their own School** (Decision 364) — from the
  School page, after typing its name and their passcode: the same 90-day close
  a Platform Admin does. Closing a School, by anyone, now also ends every
  student's membership subscription and the School's ULTM8 subscription at the
  end of the paid period. Franchise join requests, answers, removals and a
  Franchise closing now send in-app notifications. No migration.
- **Joining a Franchise needs the Franchise Owner's approval** (Decision 352) —
  a School asks to join with the Franchise ID and can cancel the request; the
  Franchise page lists Schools asking to join, with Accept and Decline. The
  Franchise Owner can also remove a member School (same as the School leaving)
  and close their own Franchise after typing its name and their passcode.
  Needs migration `20261204000100_franchise_join_requests`.
- **Timetable settings and filters (Decision 353, Q8)** — the School page
  sets the Timetable's week start (Monday or Sunday) and whether it opens as
  Rows or Grid; the Timetable filters by branch, style and class type. Needs a
  database migration.
- **Classes in Google Calendar and a schedule for the School's website**
  (Decision 319 item 4; Gymdesk S6/S7) — a new **Calendar and website** card
  on the School page (owner only, both **off by default**). "Staff can add
  their classes to Google Calendar" gives each staff member (owner, Branch
  Staff, coach) a **private calendar link** on **My Profile** with the classes
  they teach at that School (30 days back to 6 months ahead; cancelled ones
  marked cancelled), which they add in Google Calendar under "From URL" (any
  calendar app works). No Google account is connected. A new link turns the
  old one off; the link stops working when they remove it, lose their staff
  role, or the School turns the setting off. "Show your schedule on your
  website" gives a snippet to paste into the School's own site: a page with
  the next four weeks of classes (class name, times, Branch, cancelled), in
  the portal's language, and the same as JSON. No coaches, members or
  bookings are shown. "New link" turns the old one off. **Needs a database
  migration** (`20270217000002_calendar_feeds_and_schedule_embed`).
- **Closures (Decision 353, Q8)** — the owner can close the School or one
  branch for some dates from the Timetable's Closures button; classes on those
  dates are cancelled under the normal cancellation rule and students are told,
  new classes skip them, and the calendar shows "Closed". Needs a database
  migration.
- **Branch Staff get their branch's timetable (Decision 353, Q4)** — a
  Timetable item in the Branch Staff menu opens the calendar read-only, with
  their branch's and School-wide classes, to book walk-ins; only the owner
  edits slots. Branch Staff and coaches at a School with branches now see
  their branch's students when booking (here and on the Class page's Add
  student), instead of an empty list. Needs a database migration.
- **Timetable shows the real classes (Decision 353)** — the calendar now shows
  each date's actual classes, one-offs included, with seats taken and the
  waitlist; cancelled and ended classes stay visible without Book, and dates
  past four weeks say "Opens for booking later". A slot's break is copied onto
  its classes and shown on the class page, the booking dialog and the student
  app's class card. Needs a database migration.

- **Check-in and front-desk mode (School Portal)** — a new **Check-in** page
  (a tab next to Students for owners, a menu item for coaches and Branch
  Staff) shows today's classes, checks a student in by scanning the QR in their
  app or by name, books the place first when they aren't booked, and lists
  recent check-ins. **Front-desk mode** turns a tablet or phone into a
  full-screen check-in desk for one branch, with short names ("Lucas M.").
  Not yet available, shown as "Soon" until the backend is built:
  - personal check-in codes;
  - locking the device and leaving it with a staff code;
  - signing up and "Find me" on the tablet;
  - waiver status on the welcome card;
  - starting an open mat.
  Until the device can be locked, front-desk mode runs in the staff member's
  own login and says so. Backend handover: `docs/handover/FRONT-DESK-BACKEND-HANDOVER.md`.

- **Disciplines follow-ups** (Decision 310) — a student's rank in an
  archived style now shows on their grading page, read-only, and in the
  student app as "No longer taught at this School". Classes, timetable slots,
  plans and instructors that already use an archived style can still be
  edited, but it can't be picked for anything new (the API refuses it too).
  Student counts per style leave out students who have left. The ladder
  editor no longer fails once a ranked student leaves the School; they show
  as "Former student". The last 17 untranslated Disciplines messages are
  translated.
- **Notifications: sent-message history (Decision 363)** — under their own
  notifications, a School Owner now sees **Messages sent to students**: every
  message the School has sent, newest first, with when and by whom, the title
  and message, who it went to (all students, a Branch, or a class and which
  groups on its list) and how many students it reached. A class still on the
  schedule links to its page. Needs a database migration
  (`20261204000000_notification_broadcast_history`). Messages sent before it
  aren't listed.
- **Notifications: Mark all read, click to open, School label (Decision 355)**
  — a **Mark all read** button marks every unread notification read, on every
  page; clicking a notification opens what it is about (its class, the
  waivers, payments, cancellations to resolve, or grading) and marks it read,
  in the portal and the student app; and each notification shows the School it
  came from. Needs a database migration
  (`20261202000000_notification_school_and_target`). Notifications sent before
  it have no label and open nothing.
- **Waivers: review fixes** (Decision 340) — the Signatures panel no longer
  breaks after a student leaves (their signature shows under "Former
  students"); each signature keeps a copy of the exact text signed, viewable
  by opening it, and signing an out-of-date version asks the student to read
  it again; blank waivers and blank signatures are refused; archived waivers
  are no longer assigned or signable, and Archive asks first; every waiver and signature loads, with
  All / Signed / Not signed tabs sorted A to Z; clearer signing errors;
  waitlists need a signed waiver when the class does; "include archived =
  false" now works on Waivers, Classes, Timetable, Branches and Instructors;
  drawn signature images are deleted with their signature. Needs migration
  `20261130000000_waiver_signed_copy`.
- **Add student and Cancel booking on a class's page** (Decision 349) — staff
  can book a student into a class from the class itself (paid from the
  student's own membership; offered the waitlist when the class is full), and
  cancel one student's booking, with the school's cancellation settings
  deciding what goes back.
- **A member School can show its Franchise's name and logo (Decision 350)** —
  only when both the Franchise Owner (a new switch on the Franchise form) and the
  School Owner (a new switch on the School page) turn it on. It shows as "Part of
  {Franchise}" in the School Portal footer. Both start off, and the School's
  switch resets when it joins or leaves a Franchise. Needs a migration.
- **Franchises fixes from the 26 Oct review (Decision 337)** — fees are typed
  in US dollars (not cents) and a Franchise needs a fee for its fee model; the
  fee model is locked while Schools are being billed; the "Schools already
  billing" check now works for real Schools, so the rate-change prompt shows;
  closed Franchises and Schools are labelled and a closed Franchise can't be
  joined or edited; the detail page shows the Franchise ID with a Copy button
  and says why billing can't start yet; Leave Franchise asks first and bills the
  month the School leaves in; closing a School or Franchise stops its fee
  billing; the member list no longer sends join codes or Stripe ids; the
  Activity filter ignores capitals; several franchise-fee billing timing fixes.
  Needs a database migration on deploy.
- **Memberships: sell at the desk, Friend Pass, cancel a subscription, member
  list (Decision 348)** — on a Student's page the owner now sees their
  memberships, can record a plan sold at the desk (cash, bank transfer, Pix or card
  terminal), give
  a Friend Pass, and cancel a Subscription; each plan's menu has a Members list
  showing who is on it with their dates. A cancelled Subscription runs to the
  end of the paid month. Needs the migration `20261201000000_membership_cancel_at_period_end`.
- **Billing stress-test fixes** (`docs/handover/BILLING-STRESS-TEST.md`) —
  confirming cash payments no longer fails with "busy" when several are
  confirmed at once (5,917 of 6,071 failed in the test); a card payment that
  fails once and then succeeds now gives the membership instead of staying
  Failed with the money taken; and Stripe's payment notices are no longer
  rate-limited, so card purchases settle at once in a busy hour instead of
  waiting on Stripe's retries.
- **Billing stress-test follow-ups (B1, B2)** — marking a cash payment as paid
  after it was cancelled or failed now says it can't be done (it used to
  answer "OK" and change nothing); and clicking Subscribe or Buy several times
  in a row now makes one card order and one Stripe subscription or Checkout
  page, not one per click (Stripe idempotency keys per student and plan).

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
- **Branch Staff can record desk payments when the owner allows it
  (Decision 347)** — a new School setting, off by default, lets Branch Staff
  record payments taken at the desk for their own branch's students. They
  still can't see the Transactions list. **Needs a database migration.**

- **Transactions: renewals, late-cancel fees, filters, CSV export and Record a
  payment (Decision 346)** — each Subscription renewal and each late-cancellation
  fee now shows as its own row, in the portal and in the student app; the page
  can be filtered by status, method, type, plan and dates, and the tiles follow
  the filters; Export CSV downloads every filtered row; the School owner can
  record a payment taken at the desk (cash, bank transfer, Pix or card
  terminal), which starts the membership at once. **Needs a database migration** (adds the new columns and
  writes rows for late-cancel fees already charged).
- **Class cancellations, chosen by each academy** (Decision 291) — the
  School page's cancellation policy (Manual / Auto-refund / Auto-credit) now
  actually applies, in its own "Class cancellations" section with new
  settings: whether it applies only before a class's cutoff or any time, a
  default cutoff for classes without one, whether the late fee is charged, an
  optional no-show fee, and what students get when the school cancels a whole
  class. New **Cancel class** button on a class's page (with a reason sent to
  students), and a new **Cancellations** page where staff resolve cancelled
  bookings and mark cash refunds paid. Card refunds go through Stripe. A Friend
  Pass always gets its credit back, and only an Owner or Manager can send money
  back.
- **Cancellation settings per branch** (Decision 292) — on a branch's
  settings page, the owner can keep "Same as the school" (the default) or give
  that branch its own cancellation settings. Existing schools keep giving the
  class credit back, as before, and the dashboard and School page ask the
  owner to choose a policy until they save one.

- **Transactions fixes from the 26 Oct review (Decision 339)** — the page now
  shows every payment newest first with Prev/Next, and its tiles count the
  whole ledger; revenue no longer splits "GBP" and "gbp"; Pending cash and
  bank transfer payments get Mark as paid and Cancel buttons; owners are told
  when a student picks cash, and students or their guardians when it is
  confirmed or cancelled; choosing cash twice no longer makes two rows;
  payments can't be confirmed for a student who left or at a closed School;
  abandoned card checkouts turn Failed; Receipt shows on card payments only;
  Branch Staff and coaches see a message instead of a blank page. **Needs a
  database migration** (fixes stored currency codes).

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
- **Students section fixes** (Decision 341):
  - **Branch Staff and coaches see their own branch's students** on the
    Students list and can open and edit them; before, the list was empty and
    editing failed for anyone tied to a branch.
  - **A revoked student can be enrolled again**, and their old branch can be
    archived. Revoking now clears their home branch.
  - **Enrolling is refused at a closed School**, and an archived branch can't
    be picked as a home branch. Staff who aren't the owner are told "Only the
    School owner can enrol students."
  - **Edit profile opens with the student's saved details**, emptying a field
    clears it, and Language and Currency are lists. A date of birth in the
    future, over 120 years ago or that doesn't exist (30 February) is
    refused, as is a name made of spaces. Only the owner can change a birth
    date that turns a child into an adult or the reverse (Decision 342).
  - **Children enrolled by a Guardian show "Managed by a Guardian"** instead
    of an internal placeholder email.
  - **A former student's page shows their name and "Inactive"**, with no
    grading buttons.
  - **Revoking a student now cancels their upcoming bookings and removes
    their waitlist places** (Decision 343), so the seats go to someone else.
    Class credits come back under the usual cancellation rules, with no
    late-cancellation fee. The Revoke dialog first lists what they still
    have: bookings, waitlist places and memberships. Memberships aren't
    refunded. A Subscription stops renewing and ends when the period already
    paid for runs out; if Stripe can't be reached, nothing is revoked and the
    owner is asked to try again.
  - **"Upcoming Booking" shows the real next class**, however many bookings
    the student has.
  - **Coaches opening /students or /students/invite** go to their home screen
    instead of a blank page.
  - **Add manually** (Decision 371): the owner can add an adult (18 or over)
    who has no ULTM8 account yet. They're emailed a temporary passcode and
    choose their own the first time they sign in to the app. If the email
    can't be sent, the owner is shown the passcode once to hand over.
  - **The Students list has a search box, a Branch column and filter, and
    pages of 25.**
  - **Re-enrol**: a former student's page has a Re-enrol button for the owner.
  - **A child's page names their Guardians.**
  - **"You've been added to [School]"**: a student added by Invite or
    Re-enrol gets an in-app notice (a child's Guardians get a copy). There is
    nothing to accept.
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
- **Student photos on the Grading Board** (grading handover B6): the cards,
  rows, student panel and selection panel show each student's profile photo,
  or their initials when there is none. The board sends a photo only when the
  person looking may already see it, and a child's only while a Guardian's
  camera consent is active, as on the front-desk tablet.
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
