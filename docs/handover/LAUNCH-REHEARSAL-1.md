# Launch rehearsal 1: a UK School and a Brazilian School, end to end

**Run:** 6 Nov 2026, against `master` at `efc0212` (after #497, #500). The language checks were run again after merging `8737a25` (#503, the 6 Nov translation follow-ups) and still pass. **Scripts:** `apps/api/scripts/rehearsal/` (see its README to run it again). **Results:** `results-mw58gp4v.json`, `portal-results-mw58gp4v.json` and `member-results-mw58gp4v.json` in that folder. Earlier rounds: `STRESS-TEST-ROUND3.md`, `-ROUND4.md`, `-ROUND5.md`.

## In plain words

We set up two pretend Schools on a laptop and walked every main journey through the real app, the way real people would:

- **School A** in London (pounds, UK time, English). It takes cards through Stripe. We used a pretend Stripe, so no real money moved.
- **School B** in São Paulo (reais, Brazil time, Brazilian Portuguese). It takes no cards (Decisions 437 and 439). Members pay by Pix as a bank transfer, or in cash, and the School confirms the payment.

Each School had an owner, a member of staff, an adult member, a parent with a child, and a few more members. They signed up with a real text-message code step (a pretend SMS service), set the School up, bought plans, booked and checked in, were promoted, froze and refunded, deleted their accounts, and tried to look at the other School's data. Then we opened the School Portal and the member app in a real browser, in Portuguese, as the Brazilian School's people.

**The result: every journey works.** 238 checks passed and none failed. 11 notes need a look. Nothing broke badly enough to fix in this PR, so this PR has no product changes: only the rehearsal scripts, two additions to the pretend Stripe, and this report.

**What worked well**
- Signing up, setting up a School, staff, payroll, plans, waivers, buying, booking, waiting lists, check-in, promotions, freezes, refunds and "Delete my account" all behaved as the decisions say, in both countries.
- Card payments in the UK charged exactly the plan, the joining fee and the 2% card fee. A Stripe refund left the non-refundable joining fee alone, ended the plan, and held the freed place for 24 hours for the first person waiting.
- In Brazil the "Connect Stripe" step is gone, the API refuses Stripe with a Portuguese reason, and Pix and cash orders work from purchase to confirmation, cancellation and refund.
- Deleting an account locks it at once, and signing back in cancels the deletion. After 30 days, the parent and their only child became "Erased User". Their bookings were cancelled, notes and files were removed, payments and the signed waiver were kept without names, and the owner got a notice that doesn't name them.
- The Brazilian School's portal (14 pages) and member app (13 screens) showed no English and no raw message keys. Every new string since the start of the week has a Portuguese text.
- Neither School's owner, staff, member or parent could read or change anything of the other School's data: 352 attempts, all refused.

**Questions for you (nothing is built for these; details below)**
1. **Monthly plans in Brazil (High).** A Brazilian School can create a monthly Subscription, and members see it with a "Comprar" button. But buying it fails with a technical message, and the desk can't sell it either, because Subscriptions only work by card. How should Brazilian Schools charge monthly fees?
2. **Who confirms a Pix payment (Medium).** Today only owners can confirm a member's Pix or cash order. A Branch Staff member gets "not found". Yet the portal and the app both say "staff confirm it". Should the existing "Branch Staff can record payments" switch also let them confirm?
3. **Plan switching where there are no cards (Medium).** In Brazil the owner can still set "switch to another plan when it ends", and members can still agree to it. But the switch needs a saved card, so it always just ends the plan. Should we hide it where cards aren't taken?
4. **The parent's consent text (High, legal).** Every parent consent is recorded against policy version "1.0-placeholder". A real privacy policy version is needed before launch.
5. **Waivers by default (Medium).** A member can buy a plan without signing the waiver. Booking only checks the waiver on classes marked "waiver required". Is that what you want, or should every School require a signed waiver before the first class?
6. **Connecting Stripe in the UK (Medium).** The portal has no screen for a School to connect Stripe ("ULTM8 support connects it"). Also, the Dashboard ticks "Connect Stripe" as soon as onboarding starts, not when it finishes. Is the support process ready for launch?

## Summary per journey

Pass means every check in that journey passed. A note doesn't fail a journey: it is something to decide or follow up (listed below).

| # | Journey | School A (UK, cards) | School B (Brazil, Pix/cash) |
|---|---|---|---|
| 1 | Owner sign-up and School setup | **Pass** (26 checks, 3 in the browser; 1 note: no Connect screen in the portal, D6) | **Pass** (18 checks, 1 note: a Subscription can be created, D1) |
| 2 | Staff, Payroll switch, rates hidden or shown | **Pass** (15; 1 note: Branch Staff don't see Transactions, as built) | **Pass** (21, 3 in the browser; same note) |
| 3 | Member and parent: waiver, buying, child, consent | **Pass** (21, notes D4, D5) | **Pass** (24, notes D1, D2, D4, D5) |
| 4 | Booking, waitlist, member limit, check-in, attendance, grading, freeze, refund/cancel, plan switch | **Pass** (30) | **Pass** (29) |
| 5 | Delete my account (adult cancels; parent and only child erased) | **Pass** (22) | **Pass** (22) |
| 6 | Language: pt-BR portal, member app and API messages | — | **Pass** (17 + 4 in the portal + 4 in the member app; 1 note: "Rash guard" kept in English) |
| 7 | Cross-tenant spot checks (A→B and B→A) | **Pass** (5) | **Pass** (5) |

Totals: **238 pass, 0 fail, 0 blocked, 11 notes** (`results-mw58gp4v.json` 235 = 224 pass and 11 notes; portal 10; member app 4).

## Needs decision

| # | Severity | What we saw | Evidence | Suggestion |
|---|---|---|---|---|
| D1 | High (Brazil) | A School without card payments can create a monthly Subscription. The member app lists it with "Comprar" and the Pix note. Buying gives "Planos SUBSCRIPTION exigem que a escola tenha uma PaymentAccount STRIPE — esta escola aceita apenas dinheiro/transferência bancária." The desk refuses too: "A Subscription is paid by card in the app, so it can't be sold at the desk." So a Brazilian School has no way to sell a monthly plan. | B·J1 "a monthly Subscription at a School without card payments" (201); B·J3 "can't be sold" (400 / 400); `member-results` schoolPlans screen | Now: hide Subscription in the plan form at a no-card School and hide existing ones from members, with plain wording. Then decide how Brazil bills monthly: recurring charges (Decision 412) paid by Pix, a 30-day pass sold each month, or a cash Subscription that staff confirm each month. **Decided and built (Decision 441 item 1, branch `feature/no-card-monthly-plans`):** the first month is a Pix/cash order (or a desk sale), then each month is a charge on the member's balance from a recurring charge tied to the membership. |
| D2 | Medium (Brazil) | Only owners can confirm a member's Pix or cash order (`PATCH /transactions/:id/confirm`). Branch Staff get 404 "Transaction not found". The portal's Dashboard note and the member app both say "a equipe confirma". | B·J3 "Branch Staff confirm the Pix/cash order" | Let the existing "Branch Staff can record payments" switch (Decision 348) cover confirming too. Otherwise, change the wording to "the School confirms". |
| D3 | Medium (Brazil) | "Switch to another plan when it ends" is offered on the plan form and as an opt-in in the member app at a School without cards. The switch needs a saved card, so it always ends with `NO_CARD`. | B·J4 "with no saved card the membership simply ends" (outcome NO_CARD); `MembershipPlanRow.tsx` shows the opt-in whenever the plan has a next plan | Hide the option and the opt-in where the School takes no cards. |
| D4 | High (legal) | The member app records every parent's consent with policy version `1.0-placeholder` (`apps/student/src/guardians/ConsentTierRow.tsx` `CURRENT_POLICY_VERSION`). | A·J3 and B·J3 consent checks | Set the real policy version (and text) before launch. This sits with whoever owns the GDPR/LGPD programme (Decision 423). |
| D5 | Medium | A member bought a plan before signing the waiver (201). Booking checks the waiver only on classes marked "waiver required" (`bookings.service.ts`; the spec's own rule, SKILL.md §13). A new School has none marked. | A·J3 and B·J3 "buying before signing the waiver" | Decide whether a School-wide "signed waiver before the first class" default is wanted, or whether owners are told to tick it per class. |
| D6 | Medium (UK) | There's no portal screen for a School to connect Stripe. The checklist says "ULTM8 support connects it", so the rehearsal used the API as the owner. The Dashboard ticks "Connect Stripe" as soon as a connected account exists, which happens when onboarding starts, before it is finished. | A·J1 notes; `dashboard.service.ts` (`stripeConnectedAccountId: { not: null }`) | Confirm support's process for launch. Later, tick the step only when Stripe says onboarding is complete (needs a live Stripe check). |

## Follow-ups (not blocking, no decision needed unless you want one)

- **F1. Addresses in English.** The member app in pt-BR shows "Rua Augusta, 1500, São Paulo-SP, 01304-001, Brazil". The address line is built once when it is saved, with the country name in English.
- **F2. Belt names in English.** The IBJJF template gives a Brazilian School "White Belt" and "1 Stripe", so a member reads "Você foi promovido a White Belt." The owner can rename belts. Translated templates would help.
- **F3. Deletion notice in UTC.** "Sua conta ULTM8 será excluída em dom., 6 de dez. de 2026, 17:14 UTC." The member's own time zone would be clearer.
- **F4. Technical words in a translated message.** The pt-BR text for D1's error keeps "SUBSCRIPTION" and "PaymentAccount STRIPE". It goes away with D1's first step. **Built with D1 (Decision 441 item 1):** the message is gone, with its 15 translations.
- **F5. A new School's cancellations are manual.** The default policy is MANUAL. A member who cancels a class a day ahead gets their class back only when the owner resolves it in Cancellations, which the rehearsal did. This is as designed. It's worth a line in the setup checklist or the owner's guide.
- **F6. Wording when adding a coach profile.** Adding a coach profile for someone who never had the Instructor role says "This person is no longer an instructor at this School." The portal gives the role first, so owners normally won't see it.
- **F7. Check in Stripe's own sandbox.** The pretend Stripe can't show what happens when a member pays at a School whose Stripe onboarding started but isn't finished. Card purchases are allowed as soon as a connected account exists. This needs a sandbox run (`npm run test:stripe-sandbox` has the setup).
- **F8. A plan's waiting list after erasure.** An erased person's place on a plan's waiting list is closed at the next 15-minute run of the plan waiting-list job, not at once. This is the same as when a School removes a member, and the job hands the place on in that same run.

## Bugs fixed in this PR

None in the product. Nothing the rehearsal found was a small, clear bug with a settled rule behind it: each item above needs a decision or is as designed. Two gaps in the test tools were fixed:

- The pretend Stripe returned a Subscription's first invoice in Stripe's older shape, so a card Subscription got a 500 against it. It now also returns the current shape (`payments`, `confirmation_secret`) that `stripe-first-invoice.ts` reads.
- The pretend Stripe gained two hooks: paying a hosted Checkout as the member would (`POST /__checkout/:id/pay`, which makes the PaymentIntent and Charge for the sum of the lines), and a refund made in the Stripe Dashboard (`POST /__charges/:id/refund`).

## Journey details

### 1. Owner sign-up and School setup

Both owners registered, entered the SMS code and signed in. Each created their School with its country, currency, time zone and language. They added a Branch, the BJJ style from the IBJJF template (20 belts), themselves as coach, a Tuesday 18:30 timetable slot (the class job made its classes), a 1-place class for tomorrow and a class on now. They also added:

- a 10-class pack with a joining fee (25.00) and a member limit of 2;
- a week pass that switches to a 5-class pack;
- a kids' pack;
- a waiver.

- **UK:** a 2% card surcharge, a Stripe payment account (`connectAvailable: true`) and the onboarding link from the pretend Stripe (`https://connect.stripe.test/…`). The Dashboard lists "Connect Stripe" (API and browser).
- **Brazil:** the Dashboard has no Stripe step (`stripeConnectAvailable: false`), and the browser shows "Pagamentos com cartão no app ainda não estão disponíveis no seu país… (Pix no Brasil)…". A bank-transfer (Pix) payment account was added. On a second Brazilian School, starting Stripe onboarding was refused with 400. The reason has its pt-BR text ("Pagamentos com cartão pelo Stripe ainda não estão disponíveis neste país…"), and Stripe was never asked to create an account (0 calls before and after).
- Both checklists ticked Branch, Style, Class, Plan, Waiver and, after journey 2, Staff.

### 2. Staff and payroll

The staff member signed up. The owner found them by email and gave them Branch Staff at the Branch. Then:

- Without the Payroll switch, they got 403 "The School owner hasn't let you see payroll."
- With the switch on, they could open the report, and the rates were hidden (`ratesShown: false`, rates null). The owner still saw them.
- Staff couldn't open the rates page, change their own rate or the owner's, or turn "Show pay rates in the report" on (all 403).
- Once the owner turned it on, staff saw 30.00/h and 15.00/class read only. They still couldn't change them.

The browser showed the same: no rates on the page, then the rates with no input boxes.

### 3. Members and parents

- **Adult:** signed up and joined the School. The waiver showed as waiting, and they signed it. "First plan here" showed the 25.00 joining fee.
  - **UK:** the hosted Checkout had three lines (plan 80.00, joining fee 25.00, card fee 2.10), charged 107.10. Stripe's signed webhook settled it: the order was Successful and the pack had 10 classes.
  - **Brazil:** a Pix order of 105.00 (no card fee) waited for confirmation. Branch Staff couldn't confirm it (D2). The owner confirmed it, and the pack had 10 classes.
  - A second plan showed no joining fee.
- **Parent and child:** the parent added the child with consent ticked. The consent was recorded (D4 for its version), and camera consent was added. The parent added the child to the School and signed the child's waiver, then bought the kids' pack: by card in the UK, by a confirmed Pix order in Brazil.
- **Plan switch:** buying the week pass with "agree to switch" recorded the next plan on the order.

### 4. Classes, money and the plan switch

- **Waitlist:** the adult booked the 1-place class, and the child's booking was refused as full ("join the waitlist"). The parent put the child on the waitlist. When the adult cancelled, the place went to the child at once (NOTIFIED, 60 minutes to claim), and the parent claimed it.
- **Cancellation:** the policy is manual, so the cancel waited for the owner (F5). The owner gave the class back, and the pack was back at 10.
- **Member limit:** a second member bought the 2-place pack, and a third was refused: 409 "This plan is full. Join its waiting list…". They joined its waiting list, the parent put the child on it too, and the owner saw both. The owner could still sell the pack at the desk over the limit.
- **Check-in:** the adult booked the class on now and checked in by scanning its QR code. Branch Staff checked the child in at the desk. Each has one attended booking, and the pack went from 10 to 9.
- **Grading:** the owner promoted the adult (to White Belt; the first belt).
- **Freeze:** a class pack can't be frozen (`FREEZE_CLASS_PACK`, Decision 404). A week pass sold at the desk was frozen for 7 days, and its end date moved by 7 days.
- **Refunds and cancels:**
  - **UK:** a refund made in Stripe's Dashboard (the plan and its card fee, 81.60) reached the app by webhook. The order was Refunded with the joining fee kept, and the plan ended. The plan waiting-list job then held the place for the first person waiting for 24 hours.
  - **Brazil:** an unpaid Pix order was cancelled by the owner, with a reason. A confirmed Pix order couldn't be refunded for 105.00 (`REFUND_MORE_THAN_LEFT`: the joining fee isn't refundable) but could for 80.00, ending the plan.
  - **Both:** a desk sale was refunded by hand and the plan ended.
- **Plan switch:** a member bought the week pass agreeing to switch. With 3 days left, the job sent "Your plan is about to change". After the end, with no saved card (a hosted-Checkout buyer in the UK, any member in Brazil), the switch didn't happen: outcome `NO_CARD`, nothing charged, and the member was told.
- **UK only:** the parent started a monthly Subscription by card (`requires_payment`).

### 5. Delete my account

- **Adult:** the preview showed 30 days and no children. Asking without re-entering the passcode was refused (403). With it, the deletion was due in 30 days. The old session and the refresh token were refused at once (401 `ACCOUNT_LOCKED`), and staff couldn't book for them (403 "This account is being deleted…"). Signing in again cancelled the deletion (`deletionCancelled: true`), and the app worked as before.
- **Parent who is a child's only parent:** they added a child with no login, who joined, had a signed waiver, a kids' pack, a booking next week, two staff notes and an uploaded file. The confirmation named the child. After asking, both were marked. Then "31 days later" the daily erasure job ran:
  - both are "Erased User" with no email, phone or birth date;
  - the child's booking was cancelled;
  - their roles ended, and the plan waiting-list place closed at the next run (F8);
  - notes 0, files 0, and the stored copy was deleted;
  - payments were kept, and the waiver's signer is "Erased User";
  - signing in is refused;
  - the owner's notice "A member left" doesn't name them;
  - the erasure log has REQUESTED and ERASED;
  - the Students list no longer shows them.

### 6. Language (pt-BR)

- **Messages:**
  - Portal: 4,633 keys, all with a pt-BR text. The 67 added or changed since `08bdcddf` are translated. One text is kept as English on purpose: the placeholder "Rash guard".
  - Member app: 1,325 keys, all translated, including the 59 new ones.
  - API messages: 652, all translated, including the 24 new ones.
  - Every API error School B's people actually got in the run (15) shows in Portuguese or carries a code the apps word themselves.
- **Portal in a browser:** the owner signed in through the login page. On 14 pages (Dashboard, Students, Staff, Plans, New plan, Transactions, Payroll, Waivers, Timetable, Cancellations, Notifications, School, Check-in, Front desk) there were no raw keys, no English text that has a translation, and no server errors. The owner's 10 notices showed in Portuguese.
- **Member app in a browser:** it was exported for the web and used at phone width. The member found the School by join code and signed in. 13 screens were checked: Home, My memberships, My bookings, Waivers, Notifications, My grading, Payment history, Children, Charges, the School's plans, Profile and "Delete my account". None showed raw keys or untranslated English, and there were no console errors. The Pix note shows under each paid plan. Seen there: F1, F2, F3.
- **UK owner, en-GB:** 10 pages with no raw keys. Dashboard, Payroll and Plans don't scroll sideways at phone width.

### 7. Cross-tenant

Each School's owner, Branch Staff, member and parent tried 30 reads and 14 writes on the other School. The reads were the School, Dashboard, Students and export, Staff, transactions and summary, payroll report and rates, waiver signatures, a member's profile, notes, files, memberships and parents, freezes, cancellations, payment account, surcharge, a class's bookings, QR code and waitlist, a plan's waiting list and members, a member's bookings and status, an invoice, and a child's consent and waivers. The writes were edit School, add a note, sell a plan, promote, set a pay rate, add a waiver or plan, book, desk check-in, confirm, cancel or refund a payment, archive a plan, and change staff access. **All 352 were refused**, with no data in any response and no server errors. Nothing of the other School changed.

## How to reproduce

Everything is in `apps/api/scripts/rehearsal/README.md`. In short:

1. On a fresh database, start Redis, the pretend Stripe and the built API with `--require ./scripts/rehearsal/use-fakes.cjs`.
2. Run `node --import ./ts-resolve.mjs rehearsal.mjs`.
3. Build and serve the portal, then run `portal.mjs`.
4. Export the member app for the web, then run `member.mjs`.

To see each "Needs decision" item yourself:

- **D1:** as a Brazilian School's owner, create a SUBSCRIPTION plan. As a member, `POST /membership-plans/:id/purchase` gives 400. As the owner, `POST /schools/:id/students/:studentId/memberships/sell` with `paymentMethod: CASH` gives 400. In the member app, the plan shows "Comprar".
- **D2:** a member places a Pix order. As Branch Staff, `PATCH /transactions/:id/confirm` gives 404.
- **D3:** at a Brazilian School, buy a plan that has "switch to" with `agreeToPlanSwitch: true`. Run the `plan-switch` job after its end: `switchOutcome` is `NO_CARD`.
- **D4:** `GET /guardians/me/minors/:id/consent` shows `policyVersion: "1.0-placeholder"`.
- **D5:** a member who hasn't signed the waiver can `POST /membership-plans/:id/purchase` (201).
- **D6:** `POST /payment-accounts/:id/connect/onboard` is enough for the Dashboard to tick "Connect Stripe".

## What the rehearsal did not cover

Real Stripe, Twilio, email and push (all pretend or not set up); native phone features (the camera QR scan, Kid Mode on a device); Platform Admin; a Stripe Subscription's renewals; grading beyond one promotion; load. The earlier stress rounds cover load and isolation at scale.
