# Gymdesk parity — feature comparison and backend backlog

**Status:** living document, started 19 Oct 2026, on the redesign branch only.
**Companion to:** `DESIGN-BRIEF.md` (layout and visual decisions) and `QUESTIONS-BY-SECTION.md` (the product owner's answer sheet + capture checklist) in this folder.

## Product-owner direction (19 Oct 2026)

Recorded here rather than in `docs/decisions/POST-SPEC-55-DECISION-LOG.md` for now.
The redesign lives on a long-running branch, and taking a decision number there would
collide with numbers `master` assigns meanwhile. **When this branch merges, move these
into the decision log under the next free numbers.**

1. **Gymdesk is the main competitor. ULTM8 should match as many of its functions as possible.**
2. **The redesign is built on its own branch**, kept in sync with `master`, and merged only
   when the product owner says so. `master` and the current app stay as they are
   while backend work continues there. This is a deliberate exception to CLAUDE.md's
   "short-lived branch per page" convention.
3. **Screens include Gymdesk's elements even where ULTM8 has no backend for them yet.**
   This follows the `docs/v1.2-backend-backlog.md` convention: an element without a backend
   is shown **disabled / "coming soon"**, never with made-up values. Each one gets an entry
   below for the backend team.
4. **Copy the look and behaviour, not the brand.** No Gymdesk logo, icons, illustrations,
   wording or colour scheme.

## How to use this list

- **Status key:** ✅ ULTM8 has it · 🟡 partial / different shape · ❌ missing.
- Every ❌/🟡 item lists **business-rule questions**. Per CLAUDE.md, the backend team
  must not build an item until the product owner has answered its questions. They are
  `[UNRESOLVED]` until then. Record the answers here with a date, then in the decision log.
- When an item ships on `master`, mark it ✅ with the date/PR. On the redesign branch, the
  matching "coming soon" control is switched to work for real.
- Verified against code on 19 Oct 2026 (`apps/api/prisma/schema.prisma`, `skills/ultm8-domain-rules/SKILL.md`).
  Re-verify before relying on a status. Code moves faster than this file.

---

## 1. Coverage so far

| Gymdesk area | Seen | Compared |
|---|---|---|
| Dashboard | ✅ screenshots 01–05 | §2 |
| Left nav | ✅ 04 | `DESIGN-BRIEF.md` |
| Members → Members, Add Member | ✅ 06–09, recording | §3 |
| Members → Memberships, Add Membership Option | ✅ 06, recording | §4 |
| Gym → Schedule | ✅ recording, plus screenshots 25 Oct 2026 (schedules, roster assign, settings, grid) | §5 |
| Settings → Billing settings, Payment processor | ✅ recording | §6 |
| Members → Check-in, Attendance, Rosters | ✅ 10–12 | §7 |
| Members → Documents, Content, Growth, member list | ✅ chat-only screenshots (not saved: images arrived inline, and the list shows a real member's phone/DOB) | §7 |
| Member profile page (all tabs) | ✅ recordings 20.08, 20.10 | §8 |
| Settings → Members (all rows + sign-up form builder) | ✅ chat screenshots | §9 |
| Members → Attendance sub-tabs (Check-ins, Promotions, Members, Sessions, Multiple Check-in, Settings) | ❌ not yet | — |
| Gym → Bookings, Managers & Staff, Payroll, Programs | ❌ not yet | — |
| Billing, Marketing, Website, Sales, Front Desk | ❌ not yet | — |
| Competitions | ⏸ deferred (product owner, 20 Oct 2026) | — |
| Settings → Gym, Bookings, Members, Attendance, Schedule, Marketing, Sales, Email, Integrations | ❌ not yet | — |

**Needed from the product owner:** screenshots or short recordings of every ❌ row above,
including a filled-in example where possible. Empty screens hide most fields.

---

## 2. Dashboard

| # | Gymdesk element | ULTM8 | Notes |
|---|---|---|---|
| D1 | Schedule Today widget | 🟡 | Timetable data exists; the dashboard doesn't show it yet. **Frontend-only**, no backlog item |
| D2 | Notifications widget | 🟡 | Notifications exist; frontend-only |
| D3 | Upcoming Birthdays widget | ❌ | `dateOfBirth` exists on the profile |
| D4 | Setup / onboarding checklist (progress + task tiles + "Next setup step" toast) | ❌ | |
| D5 | "What's new?" product-updates feed | ❌ | |
| D6 | Trial "days left" + Upgrade banner | 🟡 | Platform subscription exists (`SubscriptionPlan`); trial countdown display not confirmed |
| D7 | In-app chat/support bubble | ❌ | Would need a third-party vendor |

**Questions:**
- **D3:** May Staff see members' birthdays, including **minors'**, on the dashboard? Which roles? Show the age ("Turns 32")?
- **D4:** Which steps make up ULTM8's checklist? Is it per School or per Branch? Can it be dismissed ("Skip setup")?
- **D5:** Who writes the updates (Platform Admin?), and per language?
- **D6:** Is a School on a platform free trial at all? Spec 55's platform-billing terms decide this, so check before building.
- **D7:** Which vendor, if any? Data-protection implications for minors.

## 3. Members — Add Member form

| # | Gymdesk element | ULTM8 | Notes |
|---|---|---|---|
| M1 | First/last name, phone, email, date of birth | ✅ | |
| M2 | Gender | ✅ | `gender` free text |
| M3 | Interface language | ✅ | `User.language` + `GET /settings/languages`. The app has no translation runtime yet; that is a separate effort |
| M4 | Photo: upload | ✅ | Profile photo upload exists |
| M5 | Photo: **capture from camera** | 🟡 | Browser camera capture is frontend-only, but **camera consent rules for minors** (Decision 107) must be checked first |
| M6 | **Visitor vs Member** toggle | ❌ | No visitor/lead/prospect entity |
| M7 | **Personal 4-digit check-in code** | 🟡 | ULTM8 has a 6-digit *per-class* code (Decision 235) and QR. Gymdesk's is a *per-member* PIN |
| M8 | Secondary phone / secondary email | ❌ | |
| M9 | Join date (back-dateable) | ❌ | Only the system `createdAt` exists; no editable join date |
| M10 | Address block (street, city, ZIP, state, country) | 🟡 | `User.address` is one free-text field, not structured. Google Places is decided (Decision 212) but deferred to v1.3 (Decision 267) |
| M11 | Emergency/other contacts with relation (Parent…) | 🟡 | Guardian relationship exists for minors; a general "contacts" list does not |
| M12 | **"How did you hear about us?"** | ❌ | |
| M13 | Set account password on behalf of member | ❌ (deliberately?) | ULTM8 uses invites. Check auth rules before building. Staff setting a member's password is a security question |
| M14 | "Send account access" checkbox | 🟡 | Invite flow exists |
| M15 | Empty-state "How To Add Members" (manual / front-desk self-fill / spreadsheet import / email invite) | 🟡 | Manual + invite exist; **spreadsheet import** and **front-desk self-fill kiosk** ❌ |

**Questions:**
- **M6:** What is a Visitor in ULTM8? A lead with no login and no membership? Can a Visitor book a Trial only (Gymdesk: "Visitors can only pick trial memberships")? How does a Visitor convert to a Student? Note SKILL.md §6's Trial caps (30 days, rolling 12 months).
- **M7:** Is a personal PIN acceptable alongside QR? Can it be chosen, or is it generated? Unique per School or per Branch? Can a Guardian check a minor in with it?
- **M8/M11:** How many secondary contacts? Do emergency contacts differ from Guardians?
- **M12:** What are the source options: a fixed list, or per-School configurable? Is it reported anywhere?
- **M13:** Allowed or not? (Recommendation: keep invite-only, since it fits the existing auth model.)
- **M15:** Import format (CSV columns), duplicate handling, and minors (who consents?).

## 4. Memberships — Add Membership Option

| # | Gymdesk element | ULTM8 | Notes |
|---|---|---|---|
| P1 | Title | ✅ | |
| P2 | Single Member vs **Family Shared** type | ❌ | |
| P3 | Linked documents (agreements) | 🟡 | `MembershipPlan.termsWaiverRequired` is a yes/no flag; it can't pick *which* documents |
| P4 | Available on sign-up form / member portal / members can book | 🟡 | One `visible` flag only, not three separate channels |
| P5 | Pricing type: Recurring / One-time | ✅ | `MembershipFrequency` RECURRING/ONE_TIME |
| P6 | Pricing type: **Per-session** | 🟡 | Class Pack covers prepaid credits; pay-per-session is different |
| P7 | Pricing type: Trial | ✅ | `TRIAL_MEMBERSHIP` (30-day caps) |
| P8 | Frequency "every N weeks/months" + **max number of payments** | 🟡 | `billingCycleAnchorDay` exists; no custom interval and no payment-count cap |
| P9 | Start membership on first check-in | ❌ | |
| P10 | **Sign-up fee** | ❌ | |
| P11 | **Late fee + grace days** ("when 5 days overdue") | ❌ | |
| P12 | **Family discounts** (2nd / 3rd / 4th+ member, % or fixed) | ❌ | |
| P13 | Duration: Ongoing / Limited (N months) / Specific dates (enrolment periods) | 🟡 | `expiryDurationDays` covers "limited"; fixed-date enrolment periods ❌ |
| P14 | End-of-term action: cancel / convert to another plan | ❌ | |
| P15 | **Cancellation fee** | ✅ | `MembershipPlan.cancellationCharge` (+ `refundFeeDate`) |
| P16 | Show only to visitors / exclude from trial reporting | ❌ | Depends on M6 |
| P17 | **Income categories** (GL code, department code, income category) | ❌ | |
| P18 | Access to training: attendance limit, membership capacity, which programmes | 🟡 | `disciplineIds`, `scopedClassId`, `classesIncluded` exist; per-plan member capacity ❌ |
| P19 | Membership templates on the empty state (3x Week, Unlimited, Training Camp, 10-Class Punch Card) | 🟡 | Frontend-only once the plan types exist |

**Questions:**
- **P2/P12:** Is a family the Guardian plus their minors only, or any adults? Who pays? Are discounts per School? Do they stack with anything?
- **P10/P11:** Fixed amount or %? Are late fees charged automatically via Stripe or recorded manually? Do they apply to Cash/Bank Transfer? Are refunds affected? Are there consumer-law limits per country?
- **P9/P13/P14:** How do these interact with Decision 259's billing-cycle strategy and the price-change flow?
- **P17:** Which accounting export is the target (Xero, QuickBooks, CSV)? Without one, the codes have nowhere to go.
- **P18:** Is capacity per plan or per class? What happens when it's full: a waitlist (ULTM8 has class waitlists)?

## 5. Gym → Schedule

| # | Gymdesk element | ULTM8 | Notes |
|---|---|---|---|
| S1 | Week view with date-range picker, List/Grid toggle | ✅ | Timetable Daily/Weekly/Monthly |
| S2 | Programme filter | 🟡 | Filters exist; naming differs (Discipline) |
| S3 | Schedule settings: **week start** day (Sunday/Monday) | ❌ | Wanted (Decision 319) |
| S4 | Schedule settings: **time zone** | ✅ | Branch, then School, time zone (Decision 172) |
| S5 | Schedule settings: **default layout** (list or grid) | ❌ | Wanted (Decision 319) |
| S6 | **Google Calendar** connect | ❌ | Wanted: staff see their classes in Google Calendar (Decision 319) |
| S7 | **Schedule embed** for the School's own website | ❌ | Wanted (Decision 319) |
| S8 | **Close gym**: hide the schedule for a period, optionally freeze every membership | ❌ | Wanted as closure dates (Decision 319) |
| S9 | **Several named schedules** ("Create Schedule": title, visibility *Visible to all* or narrower, *Receive booking notifications*); "All Schedules" filter | ❌ | Not wanted: one timetable per Branch, filtered by style and class type (Decision 319) |
| S10 | **Assign → Assign Roster**: "Use rosters to assign members to a group of sessions on the schedule"; roster list with "+ Create new roster" | ❌ | Not wanted: rosters stay lists only (Decisions 317, 319) |
| S11 | **Grid view**: hourly grid, 12:00am onward, one column per day (like Google Calendar) | 🟡 | Timetable has Daily/Weekly/Monthly; an hourly grid to check against the design |
| S12 | **Assign** menu (adding a class, a roster, …) | ❓ | Need the ASSIGN menu opened and the add-class form (screenshots of 25 Oct 2026 show it closed) |

### Gym → Bookings (screenshots 25 Oct 2026)

| # | Gymdesk element | ULTM8 | Notes |
|---|---|---|---|
| BK1 | **Session Bookings** page: tabs **Upcoming**, **Previous**, **Book Session**, **Settings**; search by first or last name; **Filter** | 🟡 | ULTM8 has each class's bookings, each student's bookings, staff booking from the Timetable and the Dashboard "Bookings this week" drill-down, but **no single School-wide bookings list** with upcoming/previous, name search and filters |
| BK2 | **Book Session** (staff book a member into a session) | ✅/🟡 | Timetable click-to-book exists; compare with Gymdesk's form once captured |
| BK3 | Settings → Bookings → **Booking Settings** ("control booking access and general settings") | ❓ | Need the page opened |
| BK4 | Settings → Bookings → **Booking Notifications** ("booking related email and text notifications") | ❓ | Need the page opened. Text (SMS) is later (Decision 318) |
| BK5 | Settings → Bookings → **Booking Widget** ("in the member portal and for external websites") | ❓ | Need the page opened. Website embed is wanted (Decision 319) |
| BK6 | Settings → Bookings → **Booking Forms** ("manage and customise booking forms") | ❓ | Need the page opened |

## 6. Settings → Billing

| # | Gymdesk element | ULTM8 | Notes |
|---|---|---|---|
| B1 | Enable payment processing toggle, currency | 🟡 | Currency ✅; no School-level on/off toggle field |
| B2 | Retry failed payments after N days | ❌ | No School-configurable retry setting (Stripe's own defaults only) |
| B3 | Late-fee grace period (days) | ❌ | See P11 |
| B4 | Show invoice number | ❌ | |
| B5 | Processing fee passed to member (%) | ❌ | |
| B6 | Payment notifications, payment schedule, tax settings, invoice/receipt customisation, import payment data | ❓ | Need screenshots of each |
| B7 | Connect Stripe account | ✅ | Stripe Connect exists |

**Questions:**
- **B5:** Surcharging card fees is restricted in some countries (e.g. UK, EU). Is it allowed at all?
- **B6 tax:** Is VAT/sales tax handled by ULTM8 or by Stripe Tax?

---

## 7. Members section: other tabs (screenshots 10–12 + chat, 19 Oct 2026)

Layout note: Check-in, Attendance and Growth use a **dark-blue full-width band** behind
the content (same family as the Dashboard hero). Attendance adds a **second tab row**
inside the band.

### Check-in (front-desk kiosk), `10`
| # | Gymdesk element | ULTM8 | Notes |
|---|---|---|---|
| K1 | Three-column layout: Today's Sessions · check-in pad · Recent Check-ins | 🟡 | Data exists (timetable, check-ins); no combined front-desk screen. Mostly frontend |
| K2 | Keypad check-in by **personal code** | ❌ | Depends on M7 (personal PIN) |
| K3 | **Name search** check-in | ✅ | `INSTRUCTOR_MANUAL` check-in (staff confirms by name) |
| K4 | **Add unscheduled session** (check people in to a session that isn't on the timetable) | ❌ | Check-ins are tied to Bookings/Classes today |
| K5 | "All check-ins" history list | 🟡 | Per-class roll call exists (`RollCallPage`); School-wide history list ❌ |

**Questions:** K4: what's an unscheduled session: an open mat or private lesson? Does it count against Class Pack credits? Who may create one? K1: a dedicated kiosk mode where a tablet is locked to check-in only, needing its own login/role?

### Attendance overview, `11`
| # | Gymdesk element | ULTM8 | Notes |
|---|---|---|---|
| A1 | Last-30-days KPIs: members/session, sessions/member, active members | ❌ | No attendance analytics endpoint. Dashboard has weekly booking counts only |
| A2 | Demographics panel (filterable) | ❌ | Needs D3-style privacy answer (age/gender of minors) |
| A3 | Attendance chart: check-ins by day/week/month, date range | ❌ | |
| A4 | Sub-tab: Promotions | 🟡 | Grading/promotion events exist (Grading Board). Linking them to attendance (e.g. "classes since last promotion") to verify |
| A5 | Sub-tab: Multiple Check-in (bulk) | ✅ | Roll call checks a whole class in |
| A6 | Sub-tab **Check-ins** (`16`): School-wide check-in history with search, filter, **Print**, **Export** | ❌ | Per-class roll call only (K5). Export ties to Q26 |
| A7 | Sub-tab **Promotions** (`15`): promotion history list + **Promote** button; empty state points to "Manage programs" (promotion settings live per programme) | ✅/🟡 | ULTM8 grading is richer (Grading Board, ladders, skills; Gus's rules). A School-wide promotion *history list* with print/export to verify |
| A8 | Sub-tab **Members** (`14`): per member **sessions**, **hours**, last-7-days sparkline, **Check-ins** button, **+** to log attendance | ❌ | Attendance counts feed grading progress; **hours trained** ❌ (ULTM8 counts classes, not hours) |
| A9 | **Log Attendance** modal (`13`): tabs **Session / Bulk**, date picker, choose a session on that date, **+ Add note**, "Log attendance" | 🟡 | Same as PR14 (back-dated attendance). Bulk = several members at once |
| A10 | Sub-tab **Sessions**: list of held sessions with filter, print, export | 🟡 | Classes exist; a past-sessions report with export ❌ |
| A11 | Sub-tab **Multiple Check-in**: left dark panel with date, **select session**, filters (**programme and rank**, *has active membership*, *bookings only*, *include staff*); right panel "Select members to check in", counter "N members selected", **Check-in members** | ✅/🟡 | Roll call does this per class. Rank / active-membership / include-staff filters ❌ |
| A12 | Member profile → Attendance tab: **Sessions / Hours / Time** totals, **current rank card** (programme, belt graphic, date), **+ Attendance** | 🟡 | Ties to PR14, Q51 |

### Attendance settings (chat screenshots, 20 Oct 2026)
Rows: **Attendance Tracking · Check-in control · Check-in Waiver · Membership Cards · Import Attendance** (button).
ULTM8 check-in behaviour is fixed in code today, so each toggle would be a new School setting. "Verify" = check
the current check-in rules in code before deciding.

| # | Gymdesk setting | ULTM8 |
|---|---|---|
| AT1 | Enable attendance tracking; show recent check-ins; allow check-in by **name search** | ✅ always on (QR + staff manual) |
| AT2 | **Check-out** for exact visit-duration tracking | ❌ (ties to Q51 hours) |
| AT3 | Allow logging out of **front-desk mode** | ❌ (no kiosk mode, K1) |
| AT4 | Managers can add **unscheduled sessions** | ❌ (K4) |
| AT5 | Members can **edit their own check-in code**; **code digit count** (4) | ❌ (M7) |
| AT6 | Check-in notification sound | ❌ small, frontend |
| AT7 | Attendance tracking **with no schedule/classes** (open gym) | ❌ ULTM8 check-in is always tied to a Class |
| AT8 | Show **promotion progress on the check-in screen** | 🟡 Grading progress exists (Grading Board); not shown at check-in |
| CC1 | **Require active membership** (and for roster-only members) | ❓ verify |
| CC2 | Members check in **through their online account** (self check-in) | ✅ self-service QR / 6-digit code (Decision 235) |
| CC3 | **Require card on file** | ❌ |
| CC4 | **Require document signature**; **Check-in Waiver** page = single toggle *show check-in waiver* (read and agree before checking in) | ❓ verify whether check-in is blocked without a signed waiver |
| CC5 | **Disable check-in for overdue payments** (No / after N days…) | ❓ `paymentRestrictedAt` exists on User; verify what it blocks |
| CC6 | **Require booking** for bookable sessions | ❓ verify (ULTM8 check-in is booking-based) |
| CC7 | Check in at **other locations** of the same account | 🟡 Branches exist; cross-Branch check-in rule ❓ |
| CC8 | Email staff on **failed check-ins** | ❌ |
| CC9 | Show **leads** in check-in name search | ❌ (no leads, M6) |
| CC10 | Allow **frozen** members to check in | ❌ (no freeze, Q25) |
| CC11 | Check in **only before session starts**; **time window before class**; **allow check-in after class started** (Always / N min) | ❓ verify ULTM8's QR token window |
| CC12 | **First membership payment required** to check in | ❓ (Membership is created only when payment settles, Decision 6, so likely ✅ by design) |
| CC13 | Check in to **multiple sessions at once**; **auto check-in to first available session** | ❌ |
| CC14 | Allow **unconfirmed website sign-ups** to check in | ❌ (SF4) |
| MC1 | **Membership cards** settings: code type **Barcode or QR code**; *show current membership on card* | ❌ (PR5, Q50). If built, use **QR** so it matches ULTM8's existing QR check-in |
| IA1 | **Import attendance** (CSV) | ❌ (migration from another system) |

**Questions:** A1/A3: who sees analytics (Owner only, or Branch Staff for their Branch)? Do counts include Trial/Friend Pass students?

### Rosters, `12`
| # | Gymdesk element | ULTM8 | Notes |
|---|---|---|---|
| R1 | Roster = named group of members, tied to a programme, max capacity, assigned to a schedule | ❌ | No group entity. Classes + bookings + waitlist cover per-class capacity only |

**Questions:** R1: how does a roster differ from a Class (e.g. a "Kids Competition Team")? Does roster membership grant booking access or restrict it? Is it per Branch?

### Documents (chat screenshot)
| # | Gymdesk element | ULTM8 | Notes |
|---|---|---|---|
| DOC1 | Document templates list: name, members, signatures, last updated, edit/delete | ✅ | Waivers + Signatures panel |
| DOC2 | General **contracts** beyond liability waivers | 🟡 | Waiver entity only. Decision 253: waivers are never deleted, so Gymdesk's **delete** icon must be **archive** in ULTM8 |

**Questions:** DOC2: are contracts a Waiver type or a separate entity? Retention period is still an open legal item (CLAUDE.md "Current phase").

### Content (chat screenshot)
| # | Gymdesk element | ULTM8 | Notes |
|---|---|---|---|
| C1 | Member-portal posts (training materials, videos), with Posts / Add New Post / Settings | ✅ | Curriculum + Lessons, video via Cloudflare Stream (Decision 227/254; live account unverified, v1.3) |
| C2 | Free-form announcement-style **posts** (not tied to a lesson) | 🟡 | Notifications Broadcast covers announcements; a post feed ❌ |

### Growth (chat screenshot)
| # | Gymdesk element | ULTM8 | Notes |
|---|---|---|---|
| G1 | Active members count | 🟡 | Derivable from active Memberships; no endpoint |
| G2 | New members per month chart (12 months) | ❌ | Needs an editable join date (M9) to be accurate |
| G3 | Visitors / **Frozen** / Canceled counts | ❌ | Visitors depend on M6. **Membership freeze doesn't exist** (`MembershipStatus` is Active/Expired only). Canceled vs expired isn't distinguished |
| G4 | Filter by **acquisition source** | ❌ | Depends on M12 ("how did you hear") |
| G5 | Member growth by programme | ❌ | |

**Questions:** G3: should Memberships be freezable (pause billing + access)? For how long, is there a fee, and who can request it (Guardian for a minor)? That would change `MembershipStatus`, which Decision 6 fixed at Active/Expired, so it needs its own decision.

### Member list (chat screenshot)
| # | Gymdesk element | ULTM8 | Notes |
|---|---|---|---|
| L1 | Columns: member (photo + status badge), contact, age + DOB, rank/level (belt graphic + programme), joined, last visit, billing status | 🟡 | Students list exists; rank ✅ (grading), joined ❌ (M9), last visit and billing status to verify |
| L2 | Search + filter, Add Member, Invite | ✅ | |
| L3 | **Print** and **Export** | ❌ | No CSV/export anywhere in the codebase |
| L4 | Bulk **Select** | ❌ | |
| L5 | Per-row quick actions (edit, check in) | 🟡 | |
| L6 | "Continue setup: Set up billing" banner | ❌ | Ties to D4 checklist |

**Questions:** L3: who may export member data (data-protection: minors' details)? Which columns?

## 8. Member profile page (recordings 20.08 + 20.10, 19 Oct 2026)

Keyframes in `recordings-keyframes/` (`add-member-photo-editor`, `member-profile-*`). The member shown is dummy data the product owner created.

**Layout.** A **dark left panel (about 330px)** holds: "‹ Back to members list", round photo,
name, "Member since", Edit pill, **check-in code in large type**, four round quick-action
buttons (Send Access, Call, Message, Card), Tags, Personal Details (birthday + age,
gender, phone, email, address), current rank with belt graphic, balance, and a "Manage
family account" button. **The right side** has text tabs (Profile · Messaging · Attendance ·
Documents · Ranks · Competitions). Each tab's content sits in cards with a **dark-blue title
bar plus an action pill on the right** ("ADD NOTE", "CREATE RECURRING PAYMENT", "CREATE A CHARGE",
"ADD RANK"). The Edit pill reopens the Add Member section-card form with "Save changes".
After creating a member, a green "Member added successfully!" banner shows on the profile.

**Add Member flow extras:** an **Edit Photo** modal with drag-to-reposition, Zoom and
Rotate sliders, "Delete photo" and "Apply". The browser autofills address and password.

ULTM8 today: `/students/:id` is `StudentGradingPage` (grading-focused: ranks, skills for
next rank, history), plus `/students/:id/edit` (`StudentUpdatePage`).

| # | Gymdesk element | ULTM8 | Notes |
|---|---|---|---|
| PR1 | Left profile panel + tabbed right side | 🟡 | Frontend layout. Data mostly exists |
| PR2 | Check-in code shown on profile | ❌ | Depends on M7 |
| PR3 | Quick actions: Call, Message (email) | 🟡 | Frontend `tel:`/`mailto:` links are trivial. **In-app messaging** ❌ |
| PR4 | Quick action: **Send Access** → "Resend Member Account Access": **resets** the member's access and emails new access details (Continue / Go back) | 🟡 | Invite flow exists. Reset-and-resend ties to Q11 temporary passcode |
| PR5 | Quick action: **Card** → **printable membership card** (School name, photo, name, barcode, "since" date; print and download-image buttons). *Corrected 20 Oct 2026: earlier read as "store a payment card".* | ❌ No printable card. ULTM8 check-in uses QR in the app; a card would need a barcode/QR the scanner accepts (ties to M7) |
| PR6 | **Tags** | ❌ | |
| PR7 | Balance | ❌ | No per-member ledger/balance |
| PR8 | **Family account** management | 🟡 | Guardian↔minor links exist; Gymdesk-style family grouping and billing ❌ (ties to P2/P12) |
| PR9 | Profile tab: attendance chart | ❌ | Ties to A3 |
| PR10 | **Notes**: Add Note modal with text, **"Display during check-in and in the member portal"**, and **"Add task"** (turns the note into a task with **due date + time**). Saved notes show author + timestamp, edit/delete | ❌ | No general member-notes entity (promotion-event notes only). Tasks ❌ |
| PR11 | **Create Recurring Payment** modal: amount, **+discount (% or fixed)**, **+add sales tax**, every N month(s), scheduled day (e.g. 1st), description (shown on invoices), first payment **now or a date**, payment method (**Manual payment** or **Payment card**). List row: "Every 1 month R$310.50 – Payment card, 10% discount", start date, next payment, **Modify** | 🟡 | Staff-created recurring charges approved in principle (Q28) |
| PR12 | **Create Charge** modal: amount, description, +discount, +add sales tax, charge date **now or later**, **"Send email invoice"**, payment method. Payments list: description, method + amount, scheduled date, edit/delete | 🟡 | Approved in principle (Q28). Invoices by email ❌ |
| PR13 | **Messaging** tab: "Add" menu (Email…), "Add a message / note"; email + SMS thread (SMS "requires texting number setup") | ❌ | Notifications/Broadcast exist, but not a per-member conversation |
| PR14 | Attendance tab: totals + **Log Attendance** modal (date, choose session, add note, Single/Bulk) | 🟡 | Roll-call check-in exists. Back-dated manual attendance with a note ❌ |
| PR15 | Documents tab: add document / use template / **upload file** | 🟡 | Waiver signatures ✅; arbitrary file upload per member ❌ |
| PR16 | Ranks tab: add rank (belt dropdown with stripes), date, time, "add promotion fee" | ✅/🟡 | Grading/promotion ✅ (`StudentGradingPage`). **Promotion fee** ❌ |
| PR17 | Competitions tab (third-party: Smoothcomp integration) | ⏸ deferred | Product owner, 20 Oct 2026 |
| PR18 | Photo crop: zoom, rotate, reposition | 🟡 | Upload exists; crop UI is frontend-only |

**Answers (product owner, 20 Oct 2026):**
- **PR13 messaging and minors: messages to a minor go to the Guardian.** Direct messages to the
  minor are allowed **only if the Guardian has authorised it** on a **message-settings page**,
  and the Guardian is **always copied**. To-do: new item **PR13a**, a Guardian message-settings
  page (per-child "allow direct messages" toggle) plus always-CC delivery. Builds on the
  Guardian consent model (SKILL.md §14, Decision 236). Note SKILL.md confirms there is
  "no person-to-person messaging yet" (Decision 184).
- **PR17 Competitions: not now.** Deferred; competitions get their own look later. No
  Smoothcomp integration.
- **PR7/PR11/PR12 staff-created charges: agreed they need their own decision** before
  building. Still open; see `QUESTIONS-BY-SECTION.md`.

**Questions:**
- **PR6:** Tags: free text or a per-School list? Visible to the member?
- **PR7/PR11/PR12:** May staff create ad-hoc charges and recurring payments outside a Membership Plan? This is a big payments-model change (Spec 55 payments flow), so it needs its own decision.
- **PR10:** Who sees notes (all staff, or Owner only)? Is the member ever shown them? Retention (GDPR)?
- **PR13:** Email only, or SMS too (vendor + cost)? *(Minors: answered above.)*
- **PR14:** May staff back-date attendance? How far? Does it consume Class Pack credits?
- **PR15:** File types and size limits, and who can see uploaded files.
- **PR16:** Promotion fee: charged automatically on promotion? Grading rules follow Gus's prototype (Decision 124+), so check the grading log first.
- **PR17:** *Answered: deferred, 20 Oct 2026.*

## 9. Settings → Members (14 screenshots, chat only, 19 Oct 2026)

Pattern: the Settings layout from the design brief (second dark panel + rows with ›).
Detail pages are **toggle lists** (label left, YES/NO pill right) with one full-width
"Save changes" button.

**Members Settings rows:** Member Portal · Member Notifications · Member list settings ·
Membership settings · Document Settings · Sign-up Forms · Custom Member Fields · Custom
Member Statuses · Manage Tags · Import / Export / Merge.

ULTM8 today has **no per-School settings for any of these**. Student-app behaviour is fixed
in code. Every toggle below would be a new School-level setting (one settings entity, many fields).

### Member Portal toggles
| # | Gymdesk setting | ULTM8 behaviour today |
|---|---|---|
| MS1 | Enable member portal | Always on (`apps/student`) |
| MS2 | Members/visitors can edit their profile | 🟡 Fixed: students edit their own profile |
| MS3 | Visitors can access the portal | ❌ No visitors (Q6) |
| MS4 | Show payments / membership cards in member accounts | 🟡 Fixed |
| MS5 | Members can remove their payment method | ❓ |
| MS6 | **Members can update their own rank** | **Decided 20 Oct 2026: no, coaches only.** New: students can *request a belt correction* for a coach to approve (MS6a) |
| MS7 | Show promotion criteria to members | 🟡 Guardians can see progress/skills (Decision 132) |
| MS8 | Members can renew / add memberships / **request cancellation / cancel** | 🟡 Purchase ✅ (Checkout); self-cancel ❓ |
| MS9 | Members/visitors can use **manual payments** (cash/bank) | 🟡 Cash/Bank Transfer transactions exist (staff-recorded) |
| MS10 | Assign new payment method to overdue/scheduled payments; pay before due date | ❌ |
| MS11 | Customise name on invoices | ❌ |
| MS12 | **Members can sign up family members through their account** | 🟡 Guardian adds minors ✅. Adults adding other adults ❌ (Q13) |
| MS13 | Show "Book a Class" quick action | ✅ Booking exists |
| MS14 | Hide "Other" gender option | ❌ (gender is free text) |
| MS15 | Manage member-portal messaging · Dashboard quick actions · Member content settings | ❌ (sub-pages not captured) |

### Member Notifications
| # | Gymdesk setting | ULTM8 |
|---|---|---|
| MN1 | Welcome email to new sign-ups (editable text) | ❓ Invite emails exist; welcome email to verify |
| MN2 | Happy-birthday notices | ❌ (Q1 birthdays) |
| MN3 | Remind of membership expiry 1 week before | ❌ `membership-expiry-sweep` expires Memberships but sends no reminder |
| MN4 | Membership expired notification | ❓ |
| MN5 | Show upcoming birthdays on dashboard (toggle) | ❌ This answers D3's "who decides": **the School switches it on** |
| MN6 | Email staff when a member/lead sends a message | ❌ (ties to PR13 messaging) |
| MN7 | **Absence alert**: dashboard notice when a member hasn't checked in for N weeks | ❌ |

### Member list settings
| MLS1 | Members per page, default sort (e.g. Join Date) | ❌ Small; frontend + one setting |

### Membership settings
| # | Gymdesk setting | ULTM8 |
|---|---|---|
| MB1 | **Auto-adjust family pricing** when family members are added, removed, frozen or reactivated | ❌ (Q13 family, Q25 freeze) |
| MB2 | Weekly **expiring-memberships report** to staff | ❌ |
| MB3 | Staff notifications for new / frozen / cancelled memberships | ❓ |
| MB4 | **Bookings deduct remaining sessions** | ✅ Class Pack credits are spent by bookings |
| MB5 | **Recharge membership at check-in** when sessions run out | ❌ |

### Document Settings
| # | Gymdesk setting | ULTM8 |
|---|---|---|
| DS1 | Require Guardian signature for minors | ✅ Built in (Guardian consent model, SKILL.md §14), not optional |
| DS2 | **Minor age** configurable per School (default 18) | ⚠️ ULTM8 decides adult vs minor from DOB (Decision 67). Whether the age threshold is fixed or per country/School: to verify |
| DS3 | Require both minor and Guardian signatures | ❌ |
| DS4 | Email signed copy: no / to manager / to manager and member / to member | ❓ |
| DS5 | Email membership contracts for signature | 🟡 Waiver signature requests exist (`waiver-signature-requests` job) |

### Sign-up Forms (form builder)
List: forms with tags for where each is the default (**Manager form · Front-desk · Website ·
Email invite**), with edit, delete and a **QR code** to open the form on a phone. Settings:
**manually confirm website sign-ups**; notify staff on new sign-up.

Edit form = the Add Member section-card layout, plus **per-section SHOW/HIDE switches**
(top-right of each card), **"Require …" checkboxes** per section (address, contact info,
photo, document signature, source), and **per-field eye icons** to hide single fields.
Settings: contact type (Visitor/Member) + default type + "allow type selection".
Sections: Form details · Member details · Address · Contacts · Photo · **Documents** (pick
which to sign) · **Medical Conditions** · How did you hear · Interface language · Account
password · **Selected membership + credit card payment** · Additional forms / post sign-up.

| # | Element | ULTM8 |
|---|---|---|
| SF1 | Multiple configurable sign-up forms per School | ❌ One fixed self-registration flow |
| SF2 | Per-section show/hide/require, per-field hide | ❌ |
| SF3 | QR code / shareable link to a form | 🟡 QR is used for check-in; sign-up link QR ❌ |
| SF4 | Staff approval of website sign-ups | ❌ |
| SF5 | Pick documents to sign during sign-up | 🟡 Waiver signing exists; per-form choice ❌ |
| SF6 | **Medical conditions** | ❌ Health data is special-category personal data (GDPR Art. 9 / LGPD). Needs a decision |
| SF7 | Pay for a membership inside the form | 🟡 ULTM8 pays via **Stripe hosted Checkout** (Decisions 238/243). Copy the layout, but keep card entry on Stripe's hosted page, not in our own form fields |
| SF8 | Post sign-up: **redirect link**, rich-text **thank-you message** | ❌ Small |
| SF9 | **JavaScript conversion snippet** run on the thank-you page | ⚠️ Running School-supplied JavaScript on ULTM8's own pages is a **security risk** (script injection that could reach other users' sessions). Recommend: don't copy. Offer named tracking integrations (e.g. Meta Pixel / Google Analytics IDs) instead |

### Custom fields, statuses, tags
| # | Gymdesk setting | ULTM8 |
|---|---|---|
| CF1 | **Custom member fields**: title, field type (text input, …), "use for" (Members, …), per-field settings | ❌ |
| CF2 | **Custom member statuses** (max 50 characters) | ❌ ULTM8 statuses are fixed |
| CF3 | **Manage tags** for members and leads | ❌ (PR6) |

### Import / Export / Merge
| # | Gymdesk tool | ULTM8 |
|---|---|---|
| IE1 | Import member data (CSV) | ❌ (M15) |
| IE2 | Import membership data (CSV: plan structure + who holds what) | ❌ |
| IE3 | **Export member data (CSV)**, with a filter: *active and archived* / *active only* / *members only* / *visitors only* | ❌ (Q26: export covers all members) |
| IE4 | **Merge duplicates** (member/lead entries into one profile) | ❌ |
| IE5 | **Export all members' documents and uploaded files** | ❌ Waiver signatures exist; bulk export ❌ |

## 10. Code checks

All ❓ items from the first pass were checked against `schema.prisma` on 19 Oct 2026
and resolved above. Field-level only: a 🟡 may still need its service/endpoint checked
before building.
