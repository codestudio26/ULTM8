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

## A1. Dashboard
1. 🟠 **D3 Birthdays:** may staff see members' birthdays on the dashboard, including **children's**? Which roles (Owner / Branch Staff / Coach)? Show the age?
   - Answer:
2. 🟠 **D4 Setup checklist:** which steps should ULTM8's checklist have? Per School or per Branch? Can it be skipped?
   - Answer:
3. 🟢 **D5 "What's new?":** who writes the product updates (Platform Admin)? In every language?
   - Answer:
4. 🔴 **D6 Trial banner:** do Schools get a free trial of ULTM8 itself? (Platform-billing rule.)
   - Answer:
5. 🟢 **D7 Chat bubble:** do we want in-app support chat? Any preferred vendor?
   - Answer:

## A2. Members: Add / Edit Member
6. 🔴 **M6 Visitors:** what is a Visitor in ULTM8, e.g. a lead with no login and no membership? Can a Visitor only take a Trial? How do they become a Student?
   - Answer:
7. 🟠 **M7 Personal check-in code:** a personal PIN as well as QR? Chosen by the member, or generated? 4 or 6 digits? Unique per School or per Branch? Can a Guardian use a child's code?
   - Answer:
8. 🟢 **M8/M11 Extra contacts:** how many secondary phones/emails? Are emergency contacts separate from Guardians?
   - Answer:
9. 🟢 **M9 Join date:** may staff set or back-date a member's join date?
   - Answer:
10. 🟠 **M12 "How did you hear about us":** a fixed list of options, or each School makes its own?
    - Answer:
11. 🔴 **M13 Staff setting a member's password:** allow it (as Gymdesk does), or keep invite-only? (Recommendation: invite-only.)
    - Answer:
12. 🟠 **M15 Import from spreadsheet:** which columns? What happens with duplicates? For children, who gives consent?
    - Answer:

## A3. Memberships: Add Membership Option
13. 🔴 **P2/P12 Family plans and discounts:** is a family the Guardian plus their children only, or any group of adults too? Who pays? Discount as % or fixed amount, set per School?
    - Answer:
14. 🟠 **P10 Sign-up fee:** fixed amount per plan? Refundable?
    - Answer:
15. 🔴 **P11 Late fees:** fixed or %? Charged automatically by card, or only recorded? Apply to cash/bank-transfer payers? Default grace period?
    - Answer:
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
26. 🔴 **L3 Print / Export members:** who may export? Which columns? Should children's details be left out?
    - Answer:

## A6. Member profile page
27. 🟢 **PR6 Tags:** free text, or a list each School manages? Can members see their own tags?
    - Answer:
28. 🔴 **PR7/PR11/PR12 Staff-created charges:** may staff create one-off charges and recurring payments outside a Membership Plan? A member balance? *(You agreed this needs its own decision; this is it.)*
    - Answer:
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
34. 🔴 **B5 Passing card fees to members:** allowed? (Restricted in the UK/EU.)
    - Answer:
35. 🟠 **B6 Tax / VAT:** handled by ULTM8, by Stripe Tax, or out of scope?
    - Answer:
36. 🟢 **B2 Failed payments:** let each School choose how many days before retrying?
    - Answer:

### Already answered
- **Competitions (PR17):** deferred. No Smoothcomp integration for now. *20 Oct 2026*
- **Messaging children (PR13):** see Q30. *20 Oct 2026*

---

# Part B: what I need from you for each section not yet seen

**For every screen:** a screenshot of the empty page, **plus one with dummy data filled in**
(empty screens hide most fields). **Open every "Add / New" button and every dropdown or ⋯
menu.** A short recording is best for forms that change as you pick options. Dummy data is fine.

## B1. Members → Attendance inner tabs
- [ ] Check-ins: the full history list and its filters
- [ ] Promotions: how promotions show up here
- [ ] Members: attendance per member
- [ ] Sessions: list, and opening one session
- [ ] Multiple Check-in: checking several people in at once
- [ ] Attendance → Settings

## B2. Members → Settings tab
- [ ] Every settings row, and one opened

## B3. Gym
- [ ] **Bookings:** list, and creating a booking
- [ ] **Managers & Staff:** list, the **Add staff** form, and the **permissions** screen (important: compare with ULTM8's roles)
- [ ] **Payroll:** setting a coach's pay rate (per class / per hour), and a payroll report
- [ ] **Programs:** list and the **Add program** form (compare with ULTM8 Disciplines)
- [ ] **Schedule:** **adding a class** to the schedule (we only saw an empty week)

## B4. Billing (left-nav item)
- [ ] Every tab
- [ ] Transactions list, filters, and opening one transaction
- [ ] Creating an invoice / charge, refunds, failed payments
- [ ] Any reports

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
