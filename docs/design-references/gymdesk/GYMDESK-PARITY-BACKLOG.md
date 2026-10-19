# Gymdesk parity — feature comparison and backend backlog

**Status:** living document, started 19 Oct 2026, on the redesign branch only.
**Companion to:** `DESIGN-BRIEF.md` (layout and visual decisions) in this folder.

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
| Gym → Schedule | ✅ recording (empty week view only) | §5 |
| Settings → Billing settings, Payment processor | ✅ recording | §6 |
| Members → Check-in, Attendance, Rosters | ✅ 10–12 | §7 |
| Members → Documents, Content, Growth, member list | ✅ chat-only screenshots (not saved: images arrived inline, and the list shows a real member's phone/DOB) | §7 |
| Member profile page (all tabs) | ✅ recordings 20.08, 20.10 | §8 |
| Members → Settings tab; Attendance sub-tabs (Check-ins, Promotions, Members, Sessions, Multiple Check-in, Settings) | ❌ not yet | — |
| Gym → Bookings, Managers & Staff, Payroll, Programs | ❌ not yet | — |
| Billing, Marketing, Website, Sales, Competitions, Front Desk | ❌ not yet | — |
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
| S3 | Schedule settings | ❓ | Need screenshots |

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

Not saved as images: every frame shows a real person's address, phone and date of birth.

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
| PR4 | Quick action: Send Access (re-send invite) | 🟡 | Invite flow exists; resend to verify |
| PR5 | Quick action: Card (store a payment card) | 🟡 | Saved cards exist via hosted Checkout (Decisions 238/243). Staff adding a card on a member's behalf ❌ |
| PR6 | **Tags** | ❌ | |
| PR7 | Balance | ❌ | No per-member ledger/balance |
| PR8 | **Family account** management | 🟡 | Guardian↔minor links exist; Gymdesk-style family grouping and billing ❌ (ties to P2/P12) |
| PR9 | Profile tab: attendance chart | ❌ | Ties to A3 |
| PR10 | **Notes** (staff notes about a member) | ❌ | No general member-notes entity (promotion-event notes only) |
| PR11 | Recurring payments list + **create recurring payment** for a member | 🟡 | Memberships are bought via Checkout. Staff-created ad-hoc recurring charge ❌ |
| PR12 | Payments list + **create a one-off charge** | 🟡 | Transactions exist. Staff-initiated ad-hoc charge ❌ |
| PR13 | **Messaging** tab: email + SMS thread with the member (SMS needs a texting number) | ❌ | Notifications/Broadcast exist, but not a per-member conversation |
| PR14 | Attendance tab: totals + **Log Attendance** modal (date, choose session, add note, Single/Bulk) | 🟡 | Roll-call check-in exists. Back-dated manual attendance with a note ❌ |
| PR15 | Documents tab: add document / use template / **upload file** | 🟡 | Waiver signatures ✅; arbitrary file upload per member ❌ |
| PR16 | Ranks tab: add rank (belt dropdown with stripes), date, time, "add promotion fee" | ✅/🟡 | Grading/promotion ✅ (`StudentGradingPage`). **Promotion fee** ❌ |
| PR17 | Competitions tab (third-party: Smoothcomp integration) | ❌ | |
| PR18 | Photo crop: zoom, rotate, reposition | 🟡 | Upload exists; crop UI is frontend-only |

**Questions:**
- **PR6:** Tags: free text or a per-School list? Visible to the member?
- **PR7/PR11/PR12:** May staff create ad-hoc charges and recurring payments outside a Membership Plan? This is a big payments-model change (Spec 55 payments flow), so it needs its own decision.
- **PR10:** Who sees notes (all staff, or Owner only)? Is the member ever shown them? Retention (GDPR)?
- **PR13:** Email only, or SMS too (vendor + cost)? For minors, does messaging go to the Guardian?
- **PR14:** May staff back-date attendance? How far? Does it consume Class Pack credits?
- **PR15:** File types and size limits, and who can see uploaded files.
- **PR16:** Promotion fee: charged automatically on promotion? Grading rules follow Gus's prototype (Decision 124+), so check the grading log first.
- **PR17:** Smoothcomp is the competition platform Gymdesk integrates with. Integrate with it too, or build our own? Note the open Chrome tab "Smoothcomp + Gymdesk" in the recordings.

## 9. Code checks

All ❓ items from the first pass were checked against `schema.prisma` on 19 Oct 2026
and resolved above. Field-level only: a 🟡 may still need its service/endpoint checked
before building.
