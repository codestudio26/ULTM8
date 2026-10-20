# ULTM8 - V1.3 Devs

**Backend to-do list for Version 1.3: the new look of ULTM8.**
Prepared 20 Oct 2026 for the backend development team, from the product owner's decisions. Branch: `claude/relaxed-bohr-j3ilir`.

---

## 1. What Version 1.3 is

Version 1.3 is the **new look of the ULTM8 site**, plus the features it needs.

- **Frontend (already designed, being built):**
  - a new side menu
  - a white page with a details panel on the right of every page
  - one form style used on every form across the site (form pattern "F")
- **Backend (this document):** the new screens show a number of features that ULTM8's backend doesn't support yet. Each one appears on screen as a grey **"Soon"** tag or a disabled control, never with made-up data. This document lists every one of them, so you know what to build and why.

ULTM8's main competitor is Gymdesk. The product owner's direction is that **ULTM8 should match as many of Gymdesk's functions as possible**. Most items below come from a screen-by-screen comparison with Gymdesk.

### Where the details live

| What | File |
|---|---|
| The new look: layout, colours, menu, inspector | `docs/design-references/gymdesk/DESIGN-BRIEF.md` |
| Feature-by-feature comparison with Gymdesk (IDs such as M6, PR7 below) | `docs/design-references/gymdesk/GYMDESK-PARITY-BACKLOG.md` |
| The product owner's answers, word for word, with dates | `docs/design-references/gymdesk/QUESTIONS-BY-SECTION.md` |
| Form pattern F and the 44 forms it applies to | `DESIGN.md` → Patterns, and `docs/design-references/gymdesk/FORMS-F-ROLLOUT.md` |
| Clickable design ("New Portal"), sample data only | https://claude.ai/artifact/C5ztydgzpyzjD8bTfwEP4N |

---

## 2. Ground rules (please read before building anything)

1. **Spec 55 and the project rules still apply.** The source-of-truth order in `CLAUDE.md` stands:
   - Spec 55 comes first, then `skills/ultm8-domain-rules/SKILL.md`, then the decision log.
   - Grading follows Gus's prototype rules (Decision 124 onward).
   - Tenancy and Row-Level Security (Franchise → School → Branch) must hold for every new table, endpoint and job.
2. **Each item has one of these tags:**
   - `[CONFIRMED]`: the product owner has decided the business rules. Ready to design and build.
   - `[UNRESOLVED]`: a question is still open. **Do not build until it is answered.** Ask the product owner; don't fill the gap with a guess.
   - `[DEFERRED]`: the product owner has parked it on purpose.
3. **Some items change a rule that Spec 55 or an earlier decision fixed.** These are marked ⚠️ **NEEDS A DECISION ENTRY**. Before building, the decision must be written into `docs/decisions/POST-SPEC-55-DECISION-LOG.md` under the next free number. The product owner's answer is recorded here, but it isn't in the log yet, because the redesign branch can't take numbers without colliding with `master`.
4. **Children (minors) and Guardians:** every item touching a minor follows the existing Guardian consent model (SKILL.md §14, Decision 236). When in doubt, the Guardian acts for the child.
5. **Defaults must not change anything.** Where an item adds a School setting, its default reproduces exactly what ULTM8 does today. A School that never touches the setting sees no change.
6. **The live app must not change** until the product owner switches the new look on.
   - Backend work can merge to `master` normally, as long as it is additive.
   - The new screens only call it once they go live.
7. **"Where it shows"** below refers to the design. Each grey "Soon" tag is a promise that the matching endpoint will exist. When an item ships, tell the frontend team, and the "Soon" control is switched on.
8. Statements about existing code were checked against `apps/api/prisma/schema.prisma` on 19–20 Oct 2026. Re-check before relying on them.

---

## 3. Ready to build: rules decided `[CONFIRMED]`

### 3.1 Visitor status (Gymdesk M6) ⚠️ NEEDS A DECISION ENTRY
- **Where it shows:**
  - Add student: **Student / Visitor** switch at the top of the form.
  - Students list: **Visitors** filter chip and a **Visitor** badge.
  - Student panel: "Visitor pass · ends 27 Oct".
  - Settings → Check-in rules: "Allow visitors to check in during their visitor period".
- **What it must do:**
  - A Visitor is **not a member of the School but may use the facilities**.
  - A Visitor has **their own status, separate from Trial Membership**. Trial Membership keeps its existing 30-day caps (Decisions 54/64); the Visitor status has **no platform limit**.
  - The **visitor period is set per Visitor** by the account owner, or by staff with permission. It can be **any length** (for example 1 day or 1 week), and it **expires** at its end.
  - A Visitor follows **the same process as members**: signs the waiver, books classes, checks in.
  - A Visitor **can buy a membership**, which turns them into a member.
- **Still to decide** `[UNRESOLVED]`:
  - A child Visitor presumably needs a Guardian, as for any minor. Confirm.
  - Which staff permission sets the visitor period?
- **Touches:** a new person status (a Student today is either a member or not); the Students list filters; check-in rules (§3.5).

### 3.2 Personal check-in code (M7)
- **Where it shows:**
  - Add student: "Personal check-in code".
  - The student panel and profile: a dashed "ticket" with the code and a QR icon.
  - The front-desk check-in screen: the **Enter code** keypad.
  - Settings → Check-in rules: "Personal check-in code length".
- **What it must do:** each student gets a **personal check-in code as a backup to the QR code**, for when the QR doesn't work or the student has no phone. Typing it on the front-desk keypad checks them in.
- **How it differs from today:** this is **not** the existing 6-digit *per-class* code (Decision 235). That one changes per class; this one belongs to the person.
- **Still to decide** `[UNRESOLVED]`:
  - Generated by the system, or chosen by the student?
  - 4 or 6 digits? (The design shows a School setting.)
  - Unique per School, or per Branch?
  - May a Guardian check a child in with the child's code?
  - May students change their own code (Gymdesk AT5)?

### 3.3 Temporary passcode for students (M13)
- **Where it shows:** Add student, chapter "App access": **"Create a temporary passcode now"**.
- **What it must do:**
  - **ULTM8 generates** a temporary passcode.
  - The student **must change it at first login**.
- **Existing mechanism:** this already exists for Instructor "Add Manually":
  - login is a 6-digit passcode (Decision 72)
  - `User.mustChangePasscode` forces the change
  - the server already generates temporary passcodes

  Extending it to students should be small.
- **Still to decide** `[UNRESOLVED]`: for a child, is the temporary passcode set on the **Guardian's** account instead?

### 3.4 Freezing a membership (G3) ⚠️ NEEDS A DECISION ENTRY
- **Where it shows:**
  - Students list: **Frozen** filter chip and badge.
  - Student panel: "Monthly Unlimited · frozen".
  - Profile → Memberships: **Freeze** button (Soon).
  - Settings → Check-in rules: "Allow frozen members to check in".
- **What it must do:**
  - Memberships **can be frozen**.
  - **Each School sets the maximum freeze length.**
  - The School **may charge a freeze fee**.
  - **Billing stops** while frozen.
  - **For a child, the Guardian requests** the freeze.
- **Why it needs a decision entry:** today a Membership can only be Active or Expired (Decision 6). A Frozen state changes that rule.
- **Still to decide** `[UNRESOLVED]`:
  - Does access (booking and check-in) stop too? The check-in setting suggests each School chooses.
  - Who approves a freeze request?
  - What happens to the billing cycle anchor when the freeze ends? (See Decision 259's billing-cycle strategy.)

### 3.5 Check-in rules, chosen by each School (Gymdesk CC1–CC13, AT1–AT8)
- **Where it shows:** Settings → **Check-in rules**. The vision has switches and drop-downs, plus a live preview of what the student sees at check-in.
- **What it must do:** each School chooses its own check-in rules. **The defaults must match exactly what ULTM8 does today.** The settings shown are:
  - Require an active membership
  - Require a signed waiver (for a child, the Guardian signs)
  - Require a booking for bookable classes
  - Allow check-in at other Branches of the same School
  - Allow frozen members to check in (depends on §3.4)
  - Allow visitors to check in during their visitor period (depends on §3.1)
  - Allow check-in to several classes at once
  - Show belt progress on the check-in screen (for example "12 of 40 classes to Blue"); progress comes from the grading engine
  - Block check-in for overdue payments: *No* / *after 7 days* / *after 14 days*. `User.paymentRestrictedAt` exists; check what it blocks today.
  - Earliest check-in before class: *any time* / *30 min* / *15 min*
  - Latest check-in after class starts: *always* / *15 min* / *not after start*
  - Personal check-in code length (depends on §3.2)
- **First step:** list ULTM8's current check-in behaviour for each rule above, to set the defaults. Several are marked "verify" in the parity list.
- **Touches:** the QR token window, Booking, the waiver check, and Branch scoping. All of it must stay inside the School's tenant.

### 3.6 Staff-created charges and member balance (PR7, PR11, PR12) ⚠️ NEEDS A DECISION ENTRY
- **Where it shows:**
  - Student profile → **Payments**: "+ Create charge" (Soon).
  - The student panel and profile: **Balance** (Soon). The sample shows "R$ 310,50 overdue" in red.
- **What it must do:**
  - Staff **may create one-off charges** and **recurring payments outside a Membership Plan**.
  - **Members have a balance.**
  - **Tax is fixed per country**, not typed per charge.
  - **Discounts** can be a **% or a fixed amount**.
  - The **invoice or receipt appears in the member's account** in the app. No email is required.
- **Why it needs a decision entry:** this changes Spec 55's payments model, in which money only moves through Membership Plans.
- **Still to decide** `[UNRESOLVED]`:
  - Can a balance be in credit (prepaid)?
  - Which roles may create charges (Owner only, or Branch Staff too)?
  - Can a member pay their balance in the app (through Stripe hosted Checkout, as for memberships, Decisions 238/243)?

### 3.7 Late fees (P11, B3)
- **What it must do:**
  - A late fee is a **fixed amount or a %**.
  - It **applies to every payment method**.
  - For cash or bank-transfer payers it **goes onto the member balance** (§3.6) and is paid at the desk.
- **Still to decide** `[UNRESOLVED]`: is the late fee **charged automatically** to cards? That isn't decided. Do not build automatic charging yet. The default grace period is also open.

### 3.8 Card-fee surcharge (B5)
- **What it must do:**
  - A School setting adds the card-processing fee on top of the member's payment.
  - It is **only available to Schools in countries where this is legal**. It is illegal for consumer card payments in the UK and EU.
  - The backend needs a **country allow-list**.
- ⚠️ **Legal review before launch.**

### 3.9 Export the student list (L3, IE3)
- **Where it shows:** Students list: **Export CSV** and **Print** buttons (Soon).
- **What it must do:**
  - Export **all members**. Children are **not** excluded.
  - Offer Gymdesk's filter: *active and archived* / *active only* / *members only* / *visitors only*.
- **Still to decide** `[UNRESOLVED]`: **which staff roles may export.** This is a data-protection question, because the export contains children's details. There is no CSV/export anywhere in the codebase today.

### 3.10 Staff notes, with "show to member" (PR10)
- **Where it shows:** Student profile → **Notes**. Each note has an author and time, and a label, either "Shown to student" or "Staff only".
- **What it must do:**
  - Staff add notes to a student.
  - Each note has a **"Show to member" tick box**. When ticked, the member sees the note in the app (and at check-in).
  - **No tasks or reminders** for now.
- **Still to decide** `[UNRESOLVED]`:
  - Which staff see staff-only notes?
  - How long are notes kept (GDPR/LGPD retention)?
- There is no general notes entity today; only promotion events have notes.

### 3.11 Membership card: digital and printable (PR5, MC1)
- **Where it shows:**
  - Student panel: **QR** quick action.
  - Profile: **QR card**.
  - Add student: the **live preview card**, which is what the card looks like.
- **What it must do:** **both** a **digital card in the app** and a **printable card**, each with:
  - the School name
  - the student's photo and name
  - their **QR code** (QR only, no barcode option)
  - their personal check-in code (§3.2)
  - their current membership

  The QR must be one the existing check-in scanner accepts.

### 3.12 Messages to children go through the Guardian (PR13, PR13a)
- **Where it shows:** Student profile → **Messages** (Soon).
- **What it must do:**
  - Messages to a child go **to the Guardian**.
  - Direct messages to the child are allowed **only if the Guardian has switched it on** in a new **Guardian message-settings page**, with an "allow direct messages" toggle per child.
  - The Guardian is **always copied**.
  - This builds on the Guardian consent model (Decision 236). Note that there is no person-to-person messaging in ULTM8 yet (Decision 184).
- **Still to decide** `[UNRESOLVED]`: email only, or SMS too? SMS needs a vendor and costs money per message.

### 3.13 Students can request a belt correction (MS6a)
- **Where it shows:** Student profile → Ranks: "Only coaches change belts. Students can request a correction from the app" (Soon).
- **What it must do:**
  - Only coaches promote students; students **cannot** change their own rank.
  - A student **can request a correction** if their recorded belt is wrong, and a coach approves or rejects it.
- ⚠️ Check against the grading decisions first (Gus's rules, Decision 124 onward).

### 3.14 Free trial of ULTM8 for Schools (D6)
- **What it must do:**
  - A **Platform Admin switch** gives a School a free trial of ULTM8 itself.
  - The **trial length is configurable**.
  - It's managed **only by ULTM8 HQ (Platform Admin)**, never by School owners.
  - **No card up front.**
- **Still to decide** `[UNRESOLVED]`: what happens when the trial ends? Does the School drop into the existing "degraded portal" state until it subscribes?

### 3.15 Gender: Female and Male only
- **Where it shows:** Add student and every student form: **Female** / **Male** pills.
- **Product owner direction (20 Oct 2026):** gender options are **Female and Male only**. No other options are ever offered.
- **Today:** `gender` is free text.
- **Still to decide** `[UNRESOLVED]`:
  - Should the API restrict the field to these two values?
  - What happens to existing free-text values?
  - Note that three existing tests use "non-binary" as sample data: `apps/api/test/users.e2e-spec.ts`, `apps/school-portal/e2e/student-grading.spec.ts` and `apps/student/src/profile/profileEdit.test.tsx`.

### 3.16 Structured address with street lookup (M10)
- **Where it shows:** Add student, chapter "Address":
  - street, city, postcode and country fields
  - "Street lookup by Google Places" (Soon)
- **What it must do:**
  - Store the address as **separate fields** (street, city, postcode, country). Today `User.address` is one free-text field.
  - Provide street lookup through **Google Places**. That provider is already decided (Decision 212), and its provisioning and integration were deferred to v1.3 (Decision 267), which is this version.

---

## 4. Needs the product owner's answers first `[UNRESOLVED]`

These show on the new screens as "Soon", but their rules aren't decided. **Do not build until they are answered.** The question numbers refer to `QUESTIONS-BY-SECTION.md`.

| # | Feature | Where it shows | Open question |
|---|---|---|---|
| 4.1 | **Join date** that staff can set (M9) | Add student "Join date"; Students list "Joined" column | May staff back-date it? (Q9). Only the system `createdAt` exists today |
| 4.2 | **Secondary phone / email** (M8) | Add student: "+ Secondary phone", "+ Secondary email" | How many? Are emergency contacts separate from Guardians? (Q8) |
| 4.3 | **"How did you hear about us?"** (M12) | Add student, chapter 05 (pills) | A fixed list, or one each School manages? Is it reported? (Q10). The design shows pills for up to 5 options and switches to a drop-down if the list is longer or Schools can add their own |
| 4.4 | **Tags** on students (PR6) | Student panel and profile: tags plus "+ tag" | Free text or a per-School list? Can members see their own tags? (Q27) |
| 4.5 | **Attendance hours** (A8) | Students → Attendance "Hours" column; profile "Hours" | Track hours as well as classes? Gus's grading rules decide whether it matters (Q51). Today ULTM8 counts classes, not hours |
| 4.6 | **Attendance statistics** (A1, A3) | Students → Attendance: check-ins, students per class and classes per student over the last 30 days | Who sees them (Owner, or Branch Staff for their Branch)? Do Trial/Friend Pass students count? (Q21). No attendance-statistics endpoint exists |
| 4.7 | **Log past attendance** (PR14, A9) | "+ Log attendance" (Students → Attendance, profile) | May staff back-date? How far? Does it use Class Pack credits? (Q31) |
| 4.8 | **Growth tab** (G1–G5) | Students → **Growth** tab (Soon) | Depends on 4.1, 4.3, §3.1 and §3.4. Needs active / new per month / visitors / frozen / cancelled counts |
| 4.9 | **Unscheduled session / open mat** (K4, AT7) | Front-desk check-in: "+ Open mat session" | What is it? Does it use Class Pack credits? Who can create one? (Q20, Q53) |
| 4.10 | **Active students count** on the Dashboard (G1) | Dashboard "Active students" card (Soon) | Definition of "active" (an active Membership? includes Visitors?). Derivable today, but there's no endpoint |
| 4.11 | **Upload files to a student** (PR15) | Profile → Documents | File types, size limits, who can see them (Q32) |
| 4.12 | **Promotion fee** (PR16) | Profile → Ranks | Charge a fee on promotion? Automatically? Check with Gus (Q33) |
| 4.13 | **Spreadsheet import of students** (M15, IE1) | (not on screen yet) | Columns, duplicates, consent for children (Q12) |
| 4.14 | **Global search** in the menu | The side menu's "Search ⌘K" box | Already listed in `docs/v1.2-backend-backlog.md` (no search endpoint exists). Carried into v1.3 because the new menu shows it on every page |

---

## 5. Deferred on purpose `[DEFERRED]`

| Feature | Where it shows | Status |
|---|---|---|
| **Family accounts and family discounts** (P2, P12, PR8) | Student panel "Family · Manage"; profile "Manage family account" | Partly answered: a family is **anyone the School owner chooses**, not only a Guardian and children. **The product owner will decide the details later**, after reviewing Gymdesk's "Manage family account" screen. Guardian↔child links already exist |
| **Competitions** (PR17) | not shown | Deferred. No Smoothcomp integration |

---

## 6. What the frontend already handles (no backend work)

For context only:
- **Visual changes need no backend work:**
  - the new side menu: white in light mode, Pine in dark mode, with Slate 500 kept on file as an alternative
  - the right-side details panel on every page
  - form pattern F
  - the Slate 500 check-in screen
  - the colour fixes
- **Visual changes stay behind a switch:**
  - they're in the shared styles (`packages/ui`)
  - they only apply when the new look is switched on (`data-look="redesign"`), so the live app is unchanged
- **Interface-only items use data that already exists:**
  - the Students list's click-to-view panel
  - Call/Message links (`tel:` / `mailto:`)
  - photo crop and rotate
  - pills versus drop-downs
  - the "Ready to save" checklist
- **Taking a photo with the camera** is frontend-only. ⚠️ The camera-consent rules for minors (Decision 107) must be checked first.

---

## 7. Keeping this file up to date

- **Adding items:** as more pages are redesigned (Gym, Billing, Marketing, Front Desk, Settings), each new "Soon" item is added here in the same format.
- **When an item ships on `master`:** mark it **DONE** with the date and PR link, so the frontend team can switch its "Soon" control on.
- **When an `[UNRESOLVED]` question is answered:** copy the answer here, with the date, and move the item to §3.
