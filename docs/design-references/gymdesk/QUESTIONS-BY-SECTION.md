# Gymdesk parity: questions for the product owner, by section

**Started 20 Oct 2026.** This is the answer sheet. Write the answer under each question (or reply
in chat and it gets copied in here with the date). Item IDs (D3, M6, …) point to the full
comparison in `GYMDESK-PARITY-BACKLOG.md`. Nothing marked ❌ there is built until its
questions here are answered.

**Priority:** 🔴 changes a rule Spec 55 or a decision already fixed, so it needs a new decision ·
🟠 blocks a backend item · 🟢 small, can default if you have no preference.

Part A covers sections already seen. Part B lists **what to capture for each section not yet seen**.

---

# Part A: questions on sections already seen

> **All Part A questions are answered (25 Oct 2026).** The answers are recorded in the decision log: **Decisions 315** (members), **316** (memberships and billing), **317** (check-in and attendance) and **318** (the School and the member app). Some were answered by earlier decisions: open mat (Q20, Q53) by 304; promotion fee (Q33) by 287, 300, 307 and 314; hours (Q51) by 306; staff charges and balances (Q28) by 303; belt corrections (Q38) by 286 and 299; minor age (Q39) is fixed at 18 by Decision 77. **Only Q13 (family accounts) stays deferred**, until Gymdesk's "Manage family account" screen has been reviewed. The inline answers below are kept as the history of each question.

## A1. Dashboard
1. 🟠 **D3 Birthdays:** may staff see members' birthdays on the dashboard, including **children's**? Which roles (Owner / Branch Staff / Coach)? Show the age?
   - Answer:
2. 🟠 **D4 Setup checklist:** which steps should ULTM8's checklist have? Per School or per Branch? Can it be skipped?
   - Answer:
3. 🟢 **D5 "What's new?":** who writes the product updates (Platform Admin)? In every language?
   - Answer:
4. 🔴 **D6 Trial banner:** do Schools get a free trial of ULTM8 itself? (Platform-billing rule.)
   - Answer: **Build the ability, use it only if needed** (20 Oct 2026). A Platform Admin switch to give a School a free trial of ULTM8.
     - Follow-ups: default trial length? Card required up front? At the end of the trial, does the School drop into the existing "degraded portal" state until it subscribes?
     - **Follow-up answered (20 Oct 2026):** trial length is **configurable**. It's managed **only by ULTM8 HQ (Platform Admin)**, never by School owners. **No card up front.**
5. 🟢 **D7 Chat bubble:** do we want in-app support chat? Any preferred vendor?
   - Answer:

## A2. Members: Add / Edit Member
6. 🔴 **M6 Visitors:** what is a Visitor in ULTM8, e.g. a lead with no login and no membership? Can a Visitor only take a Trial? How do they become a Student?
   - Answer: (20 Oct 2026) A Visitor is **not a member of the School but is allowed to use the facilities**. A Visitor **can buy a membership**, and their **visitor period expires**.
     - Follow-ups: how long is the visitor period, and does each School set it? Can a Visitor book classes and check in? Must they sign the waiver first (likely yes, for liability)? Child visitors need a Guardian? How is this different from ULTM8's existing **Trial Membership** (max 30 days, Decision 54/64)? Is a Visitor simply someone on a Trial, or a separate status?
     - **Follow-up answered (20 Oct 2026):** the **School sets the visitor period**. A Visitor **follows the same process as members** (waiver, booking, check-in). **A Visitor is essentially ULTM8's Trial Membership.**
     - ⚠️ Check: Trial Membership has a platform cap (max 30 days per trial, 30 days in any rolling 12 months; SKILL.md §6, Decisions 54/64). If "Visitor = Trial", a School's visitor period can't exceed 30 days. Confirm that's OK, or a Visitor needs its own status. *(Ask with the next Members batch.)*
     - **Decided (20 Oct 2026): Visitors get their OWN status, separate from Trial Membership, with no platform limit.** The visitor period is set by the **account owner and staff with permission**. (Trial Membership's 30-day caps stay as they are.)
     - Confirmed (20 Oct 2026): the visitor period can be **any length the School sets** (e.g. 1 day, 1 week).
7. 🟠 **M7 Personal check-in code:** a personal PIN as well as QR? Chosen by the member, or generated? 4 or 6 digits? Unique per School or per Branch? Can a Guardian use a child's code?
   - Answer:
     - **Answer (20 Oct 2026): YES**, a personal check-in code **as a fallback** when the QR doesn't work or the member has no phone.
8. 🟢 **M8/M11 Extra contacts:** how many secondary phones/emails? Are emergency contacts separate from Guardians?
   - Answer:
9. 🟢 **M9 Join date:** may staff set or back-date a member's join date?
   - Answer:
10. 🟠 **M12 "How did you hear about us":** a fixed list of options, or each School makes its own?
    - Answer:
11. 🔴 **M13 Staff setting a member's password:** allow it (as Gymdesk does), or keep invite-only? (Recommendation: invite-only.)
    - Answer: **Yes** (20 Oct 2026). The password is **temporary**, and the member must change it at first login.
     - Note: ULTM8 already has this mechanism. Login is a 6-digit passcode (Decision 72), and `User.mustChangePasscode` forces a change after someone else set it (used today by Instructor "Add Manually"). Extending it to Students is small.
     - Follow-ups: does staff type the temporary passcode, or does the system generate it? For children: is it set on the Guardian's account instead?
     - Follow-up (staff types vs system generates): reply was "yes", which doesn't pick one. *Re-ask with the next Members batch.*
     - **Decided (20 Oct 2026): ULTM8 generates the temporary passcode** (no extra cost; the server already generates temporary passcodes for Instructor "Add Manually").
12. 🟠 **M15 Import from spreadsheet:** which columns? What happens with duplicates? For children, who gives consent?
    - Answer:

## A3. Memberships: Add Membership Option
13. 🔴 **P2/P12 Family plans and discounts:** is a family the Guardian plus their children only, or any group of adults too? Who pays? Discount as % or fixed amount, set per School?
    - Answer: (20 Oct 2026) **Anyone the School owner chooses**, not only Guardian + children. **Look deeper at how Gymdesk does family accounts** before deciding the details.
     - Needed: screenshots of Gymdesk's **"Manage family account"** screen (member profile, left panel) and of a family membership being set up.
     - **Deferred (20 Oct 2026):** ask again later, together with Gymdesk's "Manage family account" screen.
14. 🟠 **P10 Sign-up fee:** fixed amount per plan? Refundable?
    - Answer:
15. 🔴 **P11 Late fees:** fixed or %? Charged automatically by card, or only recorded? Apply to cash/bank-transfer payers? Default grace period?
    - Answer: (20 Oct 2026) **Fixed amount or %.** **Applies to every payment method.** **Automatic charging: not decided yet**, needs looking into.
     - Note: a cash or bank-transfer payer can't be charged automatically, so their late fee would be added to their **member balance** (Q28) and paid at the desk.
     - Needed: screenshots of Gymdesk's late-fee settings and of an overdue member's billing.
     - **Agreed (20 Oct 2026):** cash/bank-transfer late fees go onto the member balance (Q28).
16. 🟠 **P9/P13/P14:** "start on first check-in", fixed-date terms (e.g. a 6-week camp), and "at end of term, switch to another plan": do you want all three?
    - Answer:
17. 🟢 **P17 Income categories / accounting codes:** which accounting software do Schools use (Xero, QuickBooks, none)?
    - Answer:
18. 🟠 **P18 Plan capacity:** a maximum number of members per plan? What happens when it's full?
    - Answer:

## A4. Members: Check-in, Attendance, Rosters
19. 🟠 **K1 Front-desk tablet:** a locked "kiosk mode" for check-in only, with its own login?
    - Answer:
20. 🟠 **K4 Unscheduled session:** what is it (open mat, private lesson)? Does it use Class Pack credits? Who can create one?
    - Answer:
21. 🟠 **A1/A3 Attendance stats:** who sees them (Owner only, or Branch Staff for their Branch)? Include Trial / Friend Pass students?
    - Answer:
22. 🟠 **R1 Rosters:** how is a roster different from a Class (e.g. "Kids Competition Team")? Does being on a roster give or limit booking access?
    - Answer:

## A5. Members: Documents, Content, Growth, Member list
23. 🟠 **DOC2 Contracts:** are contracts a kind of Waiver, or something separate? (Waivers are never deleted, Decision 253.)
    - Answer:
24. 🟢 **C2 Posts:** a members-only post feed, separate from Curriculum and Broadcast notifications?
    - Answer:
25. 🔴 **G3 Freeze memberships:** allow freezing (pause billing and access)? Maximum length? Fee? Who can request it (a Guardian for a child)? (Today a Membership can only be Active or Expired, Decision 6.)
    - Answer:
     - **Answer (20 Oct 2026): YES, freezing is allowed. The maximum freeze length is set by each School.** ⚠️ Changes Decision 6 (Membership is Active/Expired only), so it needs its own decision entry at merge. Still open: fee? who can request (Guardian for a child)? does billing pause?
     - **Freeze details (20 Oct 2026):** the School **may charge a freeze fee**; **billing stops** during the freeze; for a **child, the Guardian requests** it.
26. 🔴 **L3 Print / Export members:** who may export? Which columns? Should children's details be left out?
    - Answer: (20 Oct 2026) **Export covers all members** (children not excluded). Gymdesk's export (screenshot received): Settings → Members → Import/Export/Merge → **Export member data (CSV)**, filter *active and archived / active only / members only / visitors only*.
     - Follow-up: **which staff roles** may export (Owner only, or Branch Staff too)?

## A6. Member profile page
27. 🟢 **PR6 Tags:** free text, or a list each School manages? Can members see their own tags?
    - Answer:
28. 🔴 **PR7/PR11/PR12 Staff-created charges:** may staff create one-off charges and recurring payments outside a Membership Plan? A member balance? *(You agreed this needs its own decision; this is it.)*
    - Answer: **Yes to both** (20 Oct 2026): staff may create one-off charges and recurring payments outside a Membership Plan, and members have a balance.
     - This changes Spec 55's payments model, so it gets its own decision entry when the branch merges.
     - Follow-ups: can a balance go into credit (prepaid)? Who may create charges (Owner / Branch Staff)? Can a member pay their balance in the app?
29. 🟠 **PR10 Staff notes:** who sees them? Is the member ever shown them? How long are they kept?
    - Answer:
30. 🟠 **PR13 Messaging:** email only, or SMS too (needs a vendor, costs per message)?
    - Answer: *(Children: answered 20 Oct 2026. Messages go to the Guardian. Direct to the child only if the Guardian allows it on a message-settings page, and the Guardian is always copied.)*
31. 🟠 **PR14 Logging past attendance:** may staff back-date attendance? How far back? Does it use Class Pack credits?
    - Answer:
32. 🟢 **PR15 Uploading files to a member:** which file types and sizes? Who can see them?
    - Answer:
33. 🟠 **PR16 Promotion fee:** charge a fee when someone is promoted? Automatically? (Grading follows Gus's prototype rules, so check with Gus.)
    - Answer:

## A7. Settings: Billing
34. 🔴 **B5 Card-fee surcharge (reworded 20 Oct 2026).** When a member pays by card, Stripe charges the School a fee (roughly 1.5–3%). Gymdesk has a setting (**Billing Settings → Processing Fees**, seen in the recording) that **adds that fee on top of the member's payment**, so the member pays it instead of the School. **In the UK and the EU this is illegal for consumer card payments.** In other countries (e.g. the US, Brazil) it's generally allowed, with conditions. **Do you want this setting, switched on only for Schools in countries where it's legal?**
    - Answer:
     - **Answer (20 Oct 2026): YES**, the card-fee surcharge setting is available **only to Schools in countries where it's legal**. Backend needs a country allow-list (legal review before launch).
35. 🟠 **B6 Tax / VAT:** handled by ULTM8, by Stripe Tax, or out of scope?
    - Answer:
36. 🟢 **B2 Failed payments:** let each School choose how many days before retrying?
    - Answer:

## A8. Settings → Members (added 20 Oct 2026)
37. 🟠 **Member-portal switches:** should each School get switches like Gymdesk's (edit profile, cancel own membership, remove payment method, pay early…)? Or do we start with only the most important? Suggested first set: edit profile, self-cancel, family sign-up, show payments.
    - Answer:
38. 🔴 **MS6 Students updating their own rank:** Gymdesk lets a School allow it. In ULTM8 only coaches promote students (Gus's grading rules). Keep it that way?
    - Answer:
     - **Decided (20 Oct 2026): coaches only.** New item: **students can REQUEST a belt correction** if their recorded belt is wrong, and a coach approves or rejects it. Check against the grading decisions (Gus's rules, Decision 124+) before building.
39. 🔴 **DS2 Minor age:** Gymdesk lets each School set the age (default 18). Fixed at 18, set per country, or per School?
    - Answer:
40. 🟠 **DS3 Both signatures:** option to require the child's signature as well as the Guardian's?
    - Answer:
41. 🟠 **MN3/MN7/MB2 Reminders:** want expiry reminder (1 week before), absence alert (no check-in for N weeks), weekly expiring-memberships report for staff?
    - Answer:
42. 🟠 **MB5 Recharge at check-in:** when a Class Pack runs out, let the member buy another at check-in?
    - Answer:
43. 🟠 **SF1/SF2/SF4 Sign-up form builder:** several forms per School (front desk, website, invite), each section shown/hidden/required, and staff approval of website sign-ups. All of it?
    - Answer:
44. 🔴 **SF6 Medical conditions:** collect medical information at sign-up? It's health data (special category under GDPR/LGPD), so it needs explicit consent, tighter access (who can see it?) and a retention period.
    - Answer:

45. 🔴 **SF9 Custom JavaScript on the sign-up thank-you page:** Gymdesk lets a School paste code that runs on its pages (for ad tracking). On ULTM8 that would be a security hole. OK to offer only ready-made tracking connections (Meta Pixel, Google Analytics) instead?
    - Answer:
46. 🟠 **CF1/CF2 Custom fields and statuses:** let each School add its own member fields and statuses? Which field types (text, number, date, dropdown, yes/no)?
    - Answer:
47. 🟠 **IE2/IE4/IE5 Import memberships, merge duplicates, export all documents:** all three wanted?
    - Answer:

48. 🟠 **PR10 Note tasks:** Gymdesk can turn a note into a task with a due date. Want staff tasks? Who gets reminded? And may a note be **shown to the member** (portal/check-in)?
    - Answer: **(20 Oct 2026) No tasks for now.** Still open: may a note be shown to the member?
     - **Answer (20 Oct 2026): YES**, staff can mark a note to be shown to the member (in the app / at check-in). Tasks stay out for now.
     - Detail (20 Oct 2026): a **tick box** on the note, "show to member".
49. 🟠 **PR11/PR12 Sales tax and discounts on staff-created charges:** add tax per charge (VAT/sales tax)? Discount as % or fixed? Email an invoice?
    - Answer: **(20 Oct 2026) Tax is fixed per country**, not set per charge. **Discounts: % or fixed amount.** Still open: email an invoice?
     - Email-invoice part: reworded and re-asked 20 Oct 2026.
     - **Answer (20 Oct 2026): the invoice/receipt appears in the member's account** (in the app). No email required.
50. 🟢 **PR5 Printable membership card:** want printable cards (photo + barcode/QR) for check-in at the desk?
    - Answer: **(20 Oct 2026) QR code only** (no barcode option). Still open: a printable card carrying the QR, or just the QR in the app? *(Product owner note, 20 Oct 2026: in Gymdesk's settings the School chooses the card's code type: barcode or QR. Still to confirm: do we want printable cards in ULTM8, with the same barcode/QR choice?)*

     - **Decided (20 Oct 2026): no printable card. A DIGITAL membership card in the app** (photo, name, QR, personal check-in code, current membership), if a card is needed at all.
     - **Updated (20 Oct 2026): BOTH.** A digital card in the app *and* a printable card, each with the member's QR. Replaces the earlier "no printable card".
51. 🟢 **A8 Hours trained:** track hours as well as number of classes? (Some schools grade on mat hours.) Gus's grading rules decide whether it matters for promotion.
    - Answer:

52. 🟠 **Check-in rules as School settings:** Gymdesk lets each School choose (require active membership, require waiver, block overdue payers, require booking, time window before/after class start, check in at other branches). Should ULTM8 schools choose too, or keep one fixed rule for everyone? (I'll first check exactly what ULTM8 does today.)
    - Answer: **(20 Oct 2026) YES, each School chooses its own check-in rules** (Gymdesk-style switches: active membership, signed waiver, block overdue payers, booking required, time window before/after start, other branches, etc.). Defaults should match today's ULTM8 behaviour, so nothing changes for a School that never touches them.
53. 🟠 **AT7 Open gym:** check in without a scheduled class (open mat / free training)?
    - Answer:
54. 🟢 **IA1 Import attendance** from another system (CSV), for schools moving to ULTM8?
    - Answer:

### Already answered (summary)
- **Q4, Q6, Q11, Q13, Q15, Q26, Q28:** answered 20 Oct 2026, inline above, some with follow-ups.
- **Competitions (PR17):** deferred. No Smoothcomp integration for now. *20 Oct 2026*
- **Messaging children (PR13):** see Q30. *20 Oct 2026*

---

# Part B: what I need from you for each section not yet seen

**For every screen:** a screenshot of the empty page, **plus one with dummy data filled in**
(empty screens hide most fields). **Open every "Add / New" button and every dropdown or ⋯
menu.** A short recording is best for forms that change as you pick options. Dummy data is fine.

## B1. Members → Attendance inner tabs
- [x] Check-ins list, Promotions, Members, Log Attendance modal (received 20 Oct 2026)
- [ ] Check-ins: the **Filter** menu opened
- [x] Sessions, Multiple Check-in, member Attendance tab, Check-in Waiver, Membership Cards (received 20 Oct 2026)
- [x] Attendance → Settings (received 20 Oct 2026)

## B2. Members → Settings tab: mostly done (20 Oct 2026)
- [x] Rows, Member Portal, Notifications, Member list, Membership, Documents, Sign-up Forms
- [x] Custom Member Fields, Custom Member Statuses, Manage Tags, Import / Export / Merge, sign-up form bottom (received 20 Oct 2026)
- [ ] Optional: the **⚙ settings** on a custom field and the **field-type** dropdown opened
- [ ] Member Portal sub-pages: **Manage member portal messaging, Dashboard Quick Actions, Member Content Settings**

## B3. Gym
- [x] **Bookings:** the Session Bookings page and the Booking Settings menu (received 25 Oct 2026)
- [ ] **Bookings:** the **Filter** menu and **Book Session** form opened, and each Booking Settings page opened (Booking Settings, Booking Notifications, Booking Widget, Bookings Forms)
- [x] **Managers & Staff:** list, Add staff form, Account Access and owner profile received 25 Oct 2026 (Decision 320)
- [x] **Payroll:** report and rates received 25 Oct 2026 (Decision 320)
- [ ] **Programs:** list and the **Add program** form (compare with ULTM8 Disciplines)
- [x] **Schedule:** schedules, roster assign, settings and grid view (received 25 Oct 2026; Decision 319)
- [ ] **Schedule:** the **ASSIGN** menu opened and **adding a class**

## B4. Billing (left-nav item)
- [x] Every tab, and every Settings → Billing page (received 26 Oct 2026; compared in the parity backlog §6)
- [x] Payments list (Paid/Scheduled/Overdue), Edit Charge, Recurring list, create/edit recurring payment
- [x] Reports: Overview, Accounting, Growth, Income Categories
- [x] The **Filter** and **Export** menus opened (Payments, Accounting) (received 26 Oct 2026)
- [x] An **invoice opened**, Mark Paid and Cancel (recording 26 Oct 2026)
- [x] Bulk select and **Mass Payment Changes** (recording 26 Oct 2026)
- [x] "Overdue (**Why?**)": a tooltip, "No card assigned to payment" (26 Oct 2026)
- [x] **Creating a one-off charge** from the member profile, and cancelling it (recordings 26 Oct 2026)
- [x] A **refund** of a cash payment (recording 26 Oct 2026)
- [ ] Accounting → **Product Revenue** and **Member Balances** sub-tabs
- [ ] Optional: a discount and a payment form filled in, then saved

## B5. Marketing
- [ ] Every tab
- [ ] Lead capture forms: building one
- [ ] Email campaigns: creating one
- [ ] Automations / follow-ups: creating one
- [ ] Referral programme

## B6. Website
- [ ] The website builder or editor
- [ ] Embeddable widgets (schedule, sign-up form) and the settings to connect your own site

## B7. Sales
- [ ] Products / shop list and **Add product**
- [ ] Point of sale (selling at the desk), stock, discounts

## B8. Front Desk
- [ ] What it opens, and whether it's a separate locked mode
- [ ] Everything a front-desk person can do from it

## B9. Settings → remaining categories
- [ ] For each of **Gym, Bookings, Members, Attendance, Schedule, Marketing, Sales, Email, Integrations**: the list of rows, and at least the important ones opened
- [ ] **Integrations:** the full list of connected services

## B10. Account and Help (bottom of the nav)
- [ ] Account: plan / subscription page (Gymdesk's pricing to *their* customers)
- [ ] Help: what's offered (docs, chat, onboarding call)

## Skipped
- **Competitions:** deferred (20 Oct 2026). No need to capture.
