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
| Members → Check-in, Attendance, Rosters, Documents, Content, Growth, Settings tabs | ❌ not yet | — |
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

## 7. Code checks

All ❓ items from the first pass were checked against `schema.prisma` on 19 Oct 2026
and resolved above. Field-level only: a 🟡 may still need its service/endpoint checked
before building.
