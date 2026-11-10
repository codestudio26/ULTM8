# Launch rehearsal 2: the same two Schools, after Decisions 441–448

**Run:** 10 Nov 2026, against `master` at `ab872d8` (after #524, #525 and #526, Decision 448). **Scripts:** `apps/api/scripts/rehearsal/` (see its README to run it again). **Results:** `results-mwarjzi8.json`, `portal-results-mwarjzi8.json` and `member-results-mwarjzi8.json` in that folder. Rehearsal 1: `LAUNCH-REHEARSAL-1.md`. Earlier rounds: `STRESS-TEST-ROUND3.md` to `-ROUND5.md`.

## In plain words

We set the same two pretend Schools up again on a laptop and walked every journey of rehearsal 1 through the real app, plus everything built since:

- **School A** in London (pounds, UK time, English). It takes cards through Stripe (a pretend Stripe, so no real money moved).
- **School B** in São Paulo (reais, Brazil time, Brazilian Portuguese). It takes no cards. Members pay by Pix or cash and the School confirms it.

This time each School also had a co-owner and a coach. On top of rehearsal 1's journeys we tried: monthly plans in Brazil, Branch Staff confirming Pix and cash orders, the waiver rule, connecting Stripe and who may do it, the "I agree" steps and the legal pages, "Delete my account" for a coach, and the round 6 fixes of Decision 448 (the surcharge line, the plan-switch price cap, Pix only in Brazil, no-show fees on Transactions, the late "Payment confirmed", charges refused while a deletion is pending, who sees the payment account, who edits a profile, "not found" for outsiders, symbol-only search and the tablet's age rule).

**The result: everything that was built works as the decisions say.** 369 checks passed, none failed, none were blocked. 5 notes need a look. The rehearsal found one small bug (an untranslated error message), fixed in this PR with a test.

**What worked well**
- **Brazil's monthly plan** now sells: the first month as a Pix or cash order (or a desk sale), then a charge on the member's balance each month. A 30-day freeze moved the next charge 30 days later, and a desk refund that ended the plan stopped the monthly charge.
- **Branch Staff confirm Pix and cash orders** once the owner turns on "Let Branch Staff record payments", get the "Cash payment waiting" notice, and get back only the order's id, status, amount and membership.
- **Stripe readiness:** a UK School can't take a card payment until Stripe says its account is ready (`CARD_PAYMENTS_NOT_READY`). Meanwhile members order and pay at the desk, never as Pix. The setup checklist ticks "Connect Stripe" only once Stripe says the account is ready.
- **Who may connect Stripe:** owners and co-owners. Branch Staff only with the owner's "Connect Stripe" switch, and even then they can't choose how the School is paid. Coaches never. Only the main owner sets staff switches; a co-owner is refused.
- **Legal:** sign-up and creating a School need their ticks. People the School creates (added by hand, tablet sign-ups, imports) and older accounts tick "I agree" at their first sign-in, in the portal and the app, in Portuguese. Until they do, nothing else works. After "Delete my account", the "I agree" records are kept for the "Erased User".
- **The waiver rule:** booking or a desk check-in is refused until the waiver is signed. Buying a plan isn't, and imported past attendance isn't.
- **Money (Decision 448):** the card surcharge is its own revenue line and the totals add up. A plan switch charged exactly what its 7-day notice said, after the owner raised the surcharge from 2% to 3%. A no-show fee from the saved card shows on Transactions. When Stripe charged a card but its answer was lost, the payment waited and was settled by Stripe's notice later, with one "Payment confirmed". Pix is refused for a UK School and works in Brazil.
- **Privacy:** charges, desk sales and confirming a waiting order are refused while a member's deletion is pending, and work again once they sign back in. A coach's phone, bio, postal address and certification file are gone after their erasure. A coach, a member and Branch Staff without a payments permission can't read the payment account. A coach can't edit a member's profile, and nor can Branch Staff without "Manage students". Searching for `%` or `_` finds nobody, and the portal explains why.
- **Portuguese:** the portal (14 pages plus the new ones) and the member app (13 screens plus the new ones) showed no English and no raw keys. Every string added since rehearsal 1 has a Portuguese text.
- **Cross-tenant:** the owner, co-owner, Branch Staff, coach, member and parent of each School tried 38 reads and 23 writes on the other School: **732 attempts, all refused**, with no data and no server errors. The pages an owner's switch guards answered "not found" to every outsider (108 checks).

**Questions for you (details below)**
1. **The legal texts (High, legal).** All five legal pages are still "unpublished". So every tick in this run, and every parent's consent, was recorded against the version "unpublished". The reviewed texts need loading before launch, and someone needs to decide how people who ticked "unpublished" are asked again.
2. **"Switch to" before Stripe is ready (Medium, UK).** A UK School can't set "When it ends, switch to" on a plan until Stripe says its account is ready. Until then it counts as a School without cards. Is that what you want, or should the owner be told to finish Stripe first?
3. **The portal's language before sign-in (Low).** A first visit to the portal (the sign-in page, or a legal page) is in English. A Brazilian sees Portuguese only after choosing it, or once signed in. Should the portal use the browser's language when nothing has been chosen?
4. **The card surcharge on fees (Low, UK).** A no-show fee taken from a saved card was charged without the card surcharge. A plan switch's charge includes it. Decision 406 says "card payments only" but doesn't say whether fees count. Is that right?

## Summary per journey

Pass means every check in that journey passed. A note doesn't fail a journey: it is something to decide or follow up (listed below). Counts include the browser checks.

| # | Journey | School A (UK, cards) | School B (Brazil, Pix/cash) |
|---|---|---|---|
| 1 | Owner sign-up and School setup, Agreement tick, Stripe readiness | **Pass** (24) | **Pass** (19) |
| 2 | Staff, payroll, coach and co-owner, payment account, Connect Stripe, main-owner-only switches | **Pass** (24; 1 note: Branch Staff don't see Transactions, as built) | **Pass** (23; same note) |
| 3 | Members and parents: waiver rule, buying, Branch Staff confirming, consent | **Pass** (23) | **Pass** (28) |
| 4 | Booking, waitlist, member limit, check-in, grading, freeze, refunds, plan switch, surcharge revenue line; Brazil's monthly plan | **Pass** (32) | **Pass** (33) |
| 5 | Delete my account (adult, parent and child, a coach); charges refused while pending | **Pass** (27) | **Pass** (29) |
| 6 | Language: pt-BR portal, member app and API messages | — | **Pass** (16; 1 note: "Rash guard" kept in English) |
| 7 | Cross-tenant, six roles each way; "not found" for outsiders | **Pass** (13, A→B) | **Pass** (13, B→A) |
| 8 | Legal and access: ticks, legal pages, first-sign-in "I agree", imports and the waiver, profile edits, search, tablet age rule, Pix only in Brazil, Stripe not ready | **Pass** (28; 1 note, question 2) | **Pass** (31; 1 note, question 3) |
| 9 | A saved card: a lost Stripe answer settled later, the plan-switch cap, a no-show fee | **Pass** (6) | — (no cards) |

Totals: **369 pass, 0 fail, 0 blocked, 5 notes** (`results-mwarjzi8.json` 344 = 340 pass and 4 notes; portal 23 = 22 pass and 1 note; member app 7).

## Needs decision

| # | Severity | What we saw | Evidence | Suggestion |
|---|---|---|---|---|
| N1 | High (legal) | The five legal pages (Terms, Privacy, School and Franchise Agreement, Children notice, Cookie notice) are all at version `unpublished` and say "This page is being prepared". Every tick in this run was recorded against `unpublished`: the owners' sign-up, the School's Agreement, the first-sign-in ticks and every parent's consent. | A·J8 "the five legal pages are open…", "the owner's sign-up and the School's Agreement are recorded…"; A·J3 and B·J3 "the consent is saved with the server's Children notice version" (`unpublished`) | This is the launch task of Decisions 441 item 4 and 444 item 4: load the reviewed texts on the server. Please also decide what Decision 444 item 8 left open: whether people who ticked `unpublished` are asked to tick again when the real text goes live. |
| N2 | Medium (UK) | A UK School whose Stripe onboarding isn't finished can't set "When it ends, switch to" on a plan (`SWITCH_NEEDS_CARDS`, "This School doesn't take card payments…"). Until Stripe says the account is ready, the School counts as one without cards (Decision 442 item 2), and the switch is hidden there (Decision 441 item 3). An owner who builds their plans before finishing Stripe has to come back and add the switch later. | A·J8 "'switch to another plan' before Stripe is ready" | Keep the rule, and tell the owner why: "Finish Connect Stripe to offer plan switches", on the plan form and in the setup checklist. Or allow the switch to be set while Stripe is pending, and only used once it is ready. |
| N3 | Low | Before signing in, the portal uses the language last chosen in that browser, and English when none was chosen. The browser's own language isn't used. A Brazilian's first visit to the sign-in page or a legal page is in English. With Portuguese chosen, all five legal pages show in Portuguese. | B·J8 portal note "a first visit to a legal page, browser in Portuguese" (`lang en-GB`) | Use the browser's language when nothing has been chosen yet (`I18nProvider`, `readStoredLocale`). |
| N4 | Low (UK) | A no-show fee taken from the saved card was 5.00 with no card surcharge (the School's surcharge was 2%). The plan switch's card charge included the surcharge (Decision 448 item 3). Decision 406 item 3 says the surcharge is for card payments only, but no decision says whether fees taken from a saved card (no-show, late cancellation, freeze) carry it. | A·J9 "the no-show fee is charged to the saved card…" (`NO_SHOW_FEE 500+0`) | Confirm that fees carry no surcharge (as built), or decide that they do. |

## Follow-ups (not blocking, no decision needed unless you want one)

- **F1. The pretend Stripe makes assumptions to check in Stripe's sandbox.** These are: a card-saving Checkout without a Customer makes one; `account.updated` with `details_submitted` and `charges_enabled` makes a School ready; a payment Stripe took whose answer was lost is settled by `payment_intent.succeeded`. The app's code says the card-saving Checkout was checked in the sandbox on 30 Oct. A sandbox run (`npm run test:stripe-sandbox`) before launch would confirm the rest. This replaces rehearsal 1's F7: card payments now wait for readiness.
- **F2. The translation check misses some messages.** `server-messages-translated.spec.ts` reads only messages written as `new …Exception('…')`. A message from the API's own error classes, re-sent as an exception, isn't checked. One had gone stale (fixed below). The old key "…— your saved card was charged and has now been refunded." is no longer sent by the code. Widening the check to those error classes would catch the next one.
- **F3. The UK card surcharge here is only for testing.** As in rehearsal 1, the rehearsal adds GB to Platform Admin's surcharge country list so the surcharge can be tested. Decision 406 item 1 says the list starts empty, and that surcharges on consumer cards are illegal in the UK and the EU.
- **F4. Branch Staff and Transactions (as in rehearsal 1).** Branch Staff still get 403 on the Transactions list. Since Decision 441 item 2 they confirm orders from the student's Payments card, and the "Cash payment waiting" notice opens that page, so nothing is blocked.
- **F5. A member in the portal.** A member the School added who signs in to the School Portal ticks "I agree", then sees "Create your school". This is how the portal already treats someone with no staff role. It is not new, but members the School creates may now land there.
- **F6. "Rash guard"** is still kept in English on purpose as a placeholder (as in rehearsal 1).

## Bugs fixed in this PR

- **A Brazilian desk sale refused for "already has a plan" showed a generic message (Decisions 273 and 323: every API message is translated).** The refusal "This Student already holds an active Subscription or Weekly Pass at this School." (409) was missing from the translation tables. The tables still had its older wording ("…an active general-access Membership…"), which the code no longer sends. So Brazilian staff saw only the generic Portuguese text for a 409, not the reason. The rehearsal hit it when selling the monthly plan to a member who held a Weekly Pass. The key is renamed in `packages/i18n/src/server/*.ts` (English and the 14 other languages), and their existing translations are kept. A regression test in `apps/api/src/translations/server-messages-translated.spec.ts` checks this message in every language, since the test's own scan can't see it (F2).

The test tools gained:

- **Pretend Stripe** (`scripts/stress/billing/fake-stripe.mjs`):
  - a new connected account starts not ready, and `POST /__accounts/:id/complete` finishes onboarding;
  - `POST /__checkout/:id/save-card` saves a card on a setup-mode Checkout, making the Customer when none was given;
  - `POST /__payment_intents/lose-next-answer` makes the next card charge go through while Stripe's answer is lost;
  - `GET /__payment_intents` lists the PaymentIntents;
  - a retrieve now honours `expand[]`.
- **Pretend file storage** (`use-fakes.cjs`): `PUT /<bucket>/<key>` stands in for a browser's upload to a presigned URL.

## Journey details

### 1. Owner sign-up and School setup

- Creating a School without the School and Franchise Agreement tick is refused (`AGREEMENT_NOT_ACCEPTED`); with it, both Schools were made as in rehearsal 1.
- **UK:** after "Connect Stripe" starts, the account is not ready: the checklist doesn't tick "Connect Stripe" and `cardPayments` is false. The owner finishes onboarding, and Stripe's signed `account.updated` arrives. Then the account is ready, `cardPayments` is true and the checklist ticks the step. In the browser, the School page's Stripe card says "Connected".
- **Brazil:** "When it ends, switch to" is refused (`SWITCH_NEEDS_CARDS`), so the week pass has no switch. The monthly plan is created (no longer a note). Connect Stripe is still refused with a Portuguese reason, and Stripe is never asked to make an account.

### 2. Staff, coach and co-owner

- Payroll worked as in rehearsal 1 (the switch, rates hidden, then shown read-only).
- **Payment account:** each School added a coach and a co-owner. The owner and Branch Staff (who have "Can create charges" by default) read the payment account. A coach gets 404. So do Branch Staff once the owner turns their charge permissions off.
- **Staff switches:** a co-owner can't change staff access or charge permissions (`STAFF_SWITCHES_MAIN_OWNER_ONLY`).
- **Connect Stripe (UK):**
  - Branch Staff without the "Connect Stripe" switch are refused (`STAFF_ACCESS_OFF`).
  - With it, they can continue Stripe onboarding, but creating the payment account stays the owners' (403).
  - A co-owner may connect Stripe; a coach may not (`NOT_FOR_COACHES`).

### 3. Members and parents

- **The waiver rule:** a new School has "Waiver must be signed before booking or check-in" on. Booking before signing is refused (`WAIVER_REQUIRED`). Buying a plan before signing is allowed (201).
- **UK:** buying by card worked as in rehearsal 1. The Checkout had the plan, the joining fee and the 2% surcharge: 107.10.
- **Brazil: confirming a Pix order.**
  - With the "record payments" switch off, Branch Staff can't confirm the Pix order (404) and get no notice.
  - Once the owner turns the switch on, they confirm it. The answer holds only the order's id, status, amount and membership.
  - For the next order (the child's plan), Branch Staff got "Cash payment waiting… on their Payments card", which opens the student.
- **Consent:** each parent's consent is saved with the server's Children notice version (`unpublished`), not the app's `1.0-placeholder` (Decision 444 item 7).
- **Plan switch, Brazil:** "agree to switch" has nothing to agree to: no plan there has a switch (`PLAN_HAS_NO_SWITCH`).

### 4. Classes, money, and Brazil's monthly plan

- Waitlist, member limit, QR and desk check-in, grading, freezes and refunds all behaved as in rehearsal 1.
- **UK plan switch:** with no saved card, it ended with `NO_CARD`.
- **UK revenue:** Transactions shows revenue 235.00 and card surcharges 3.90. Together they are what the ledger kept (238.90). The billing overview shows the same surcharge figure.
- **Brazil, the monthly plan "Mensal ilimitado" (180,00):**
  - A member orders it: a Pix/cash order of 180,00 waits for confirmation.
  - Branch Staff confirm it. The membership is billed to the balance, with a monthly charge from the same day next month.
  - A freeze from 12 Nov to 12 Dec moved the next charge from 10 Dec to 9 Jan (30 days).
  - A desk sale of the plan, paid by Pix, also set up the monthly charge.
  - "A month later", the daily job made the next month a charge on the balance, and the member got the "New invoice" notice. Branch Staff recorded its Pix payment, and the charge was paid.
  - A desk refund that ended the plan stopped the monthly charge.

### 5. Delete my account

- **The adult, while the deletion is pending:**
  - the School can't add a charge for them, sell them a plan at the desk, or confirm the Pix order they placed just before asking (`ACCOUNT_CLOSING`);
  - once they sign back in, that order can be confirmed.
- **The parent and their only child** were erased as in rehearsal 1. Their "I agree" records are kept against the "Erased User".
- **A coach** added a postal address and a certification file (uploaded straight to storage), then deleted their account. After the erasure job, their coach profile had no phone, bio, address or certification, the file was gone from storage, and the profile was archived.

### 6. Language (pt-BR)

- **Messages:**
  - Portal: 4,691 keys, all with a Portuguese text; the 69 added or changed since rehearsal 1 are translated.
  - Member app: 1,349 keys, including 24 new ones.
  - API messages: 656, including 6 new ones, one of them the fix above.
  - Every API error School B's people got in this run (25) shows in Portuguese or carries its own code.
- **Portal in the browser:** the 14 pages of rehearsal 1 are clean. New screens checked in Portuguese:
  - the five legal pages;
  - the first-sign-in "I agree" page ("Antes de continuar", with links to both pages);
  - the plan form without "switch to";
  - the `%` search hint;
  - Pix in the payment methods;
  - the monthly member's page;
  - Branch Staff's notices;
  - the surcharge tile ("Taxas de cartão"), read by the UK co-owner with Portuguese chosen.
- **Member app in the browser:** the 13 screens of rehearsal 1 are clean, with no console errors. Also checked:
  - the School's plans list "Mensal ilimitado" with the Pix/cash note and no switch opt-in;
  - a member the School added gets the "Antes de continuar" screen first, with links to the Terms and the Privacy Policy. Ticking it records the acceptance and opens Home.

### 7. Cross-tenant

Each School's owner, co-owner, Branch Staff, coach, member and parent tried the other School: rehearsal 1's 30 reads and 14 writes, plus 8 reads and 9 writes added in this rehearsal.

- **New reads:** connect status, a member's charges and recurring charges, the billing overview, charge permissions, tablet sign-ups, import limits, front-desk sessions.
- **New writes:** edit a profile, add a charge, record a payment, create a payment account, start Stripe onboarding, set charge permissions, start a front-desk session, start an import, turn on "record payments".
- **All 732 attempts were refused**, with no data and no server errors, and nothing of the other School changed. The 9 pages an owner's switch guards answered 404 to all 12 outsiders (Decision 448 item 17): payroll report, staff list, student export, payment account, member files, imports, freezes, sign-ups and Stripe onboarding.

### 8. Legal and access

- **Sign-up and age:** sign-up without the tick is refused (`TERMS_NOT_ACCEPTED`), and so is someone who turns 18 tomorrow in the earliest time zone (`REGISTER_UNDER_18`). No account is made.
- **The legal pages** open without signing in.
- **First-sign-in "I agree":** three kinds of account got a token marked "I agree pending":
  - a member added by hand (after changing the temporary passcode);
  - an approved tablet sign-up;
  - an account whose acceptance rows were removed, standing in for one made before the tick.

  For each, every call but their own profile answered `LEGAL_ACCEPTANCE_REQUIRED`. Sending no tick was refused. Ticking recorded the Terms and Privacy as "at first sign-in", and the app carried on.
- **The tablet's age rule:** 18 today in the earliest time zone is accepted; 18 tomorrow is refused (`SIGN_UP_UNDER_18`).
- **Imports and the waiver:** an imported member's past attendance was logged although they never signed the waiver. A desk check-in to today's class was refused for the waiver.
- **Profile edits:** the owner and Branch Staff with "Manage students" can edit a member's profile. Branch Staff without it get `STAFF_ACCESS_OFF`, and a coach gets `NOT_FOR_COACHES`. A member can't read the payment account.
- **Search:** `%` and `_` find nobody; a first name still does.
- **Pix:** a UK desk sale or desk payment by Pix is refused ("Pix can only be used by a School in Brazil…"); a Brazilian desk sale by Pix works.
- **A second UK School (Leeds), Stripe started but not finished:**
  - a card purchase is refused (`CARD_PAYMENTS_NOT_READY`);
  - an order waits for the desk, with no surcharge and not as Pix;
  - "switch to" is refused (N2).

### 9. A saved card (UK)

- **Saving a card:** a member saved a card on Stripe's page. Stripe's `checkout.session.completed` arrived, and the app showed "visa …4242". Paying with it asks for the passcode again.
- **A lost answer:**
  - "Stripe" charged 51.00 but its answer was lost. The member got 503, and the order stayed Pending.
  - Stripe's `payment_intent.succeeded` then settled it: the plan started, and "Payment confirmed" was sent once.
  - The same notice again changed nothing.
- **The plan-switch cap:**
  - The 7-day notice quoted 45.90 (45.00 plus 2%).
  - The owner then raised the surcharge to 3%.
  - On switch day the card was charged 45.90, not 46.35.
- **A no-show fee:** with a 5.00 no-show fee, the member booked and didn't come. The no-show job charged the saved card, and Transactions lists it as a no-show fee.

## How to reproduce

Everything is in `apps/api/scripts/rehearsal/README.md`. In short:

1. On a fresh database, start Redis, the pretend Stripe and the built API with `--require ./scripts/rehearsal/use-fakes.cjs`.
2. Run `node --import ./ts-resolve.mjs rehearsal.mjs`.
3. Build and serve the portal, then run `portal.mjs`.
4. Export the member app for the web, then run `member.mjs`.

To see each question yourself:

- **N1:** `GET /v1/legal/terms-and-conditions` gives `version: "unpublished"`. A new account's `LegalAcceptance` rows carry it.
- **N2:** at a UK School whose Stripe onboarding isn't finished, create a Weekly Pass with `switchToPlanId`: 400 `SWITCH_NEEDS_CARDS`.
- **N3:** open `/legal/terms-and-conditions` in a new browser set to Portuguese: it is in English until Portuguese is chosen.
- **N4:** set `noShowFee` on a UK School with a surcharge, and let a member with a saved card miss a class: the `NO_SHOW_FEE` row has `surchargeAmount` 0.

## What the rehearsal did not cover

Real Stripe, Twilio, email and push (all pretend or not set up); native phone features (the camera QR scan, Kid Mode on a device); Platform Admin; a Stripe card Subscription's renewals; the hourly sweep that settles a lost card answer when Stripe's notice never comes (the notice was sent here); grading beyond one promotion; load. The earlier stress rounds cover load and isolation at scale.
