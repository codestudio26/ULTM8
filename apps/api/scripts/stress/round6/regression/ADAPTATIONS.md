# Round 6 regression: what was changed in the old scripts, and why

Copies of `../../booking-schedule`, `../../billing`, `../../round3` and `../../round4`,
run against master `a3d21879` (7 Nov 2026). Only changes the API legitimately
needs since the scripts were written. Each is marked `Round 6 adaptation` in the code.

| # | File | Change | Why (Decision) |
|---|---|---|---|
| A0 | all `*.mjs` | `createRequire('../../../package.json')` → `'../../../../../package.json'` | the folder moved two levels down |
| A1 | `billing/fake-stripe.mjs` | a new connected account starts `charges_enabled:false, details_submitted:false`; new hook `POST /__accounts/:id/ready` finishes onboarding | 441 item 6 / 442 item 2: card payments wait until Stripe says the account is ready |
| A2 | `booking-schedule/lib.mjs` | `makeStripeAccountReady(acct)`: calls the hook, then sends a signed `account.updated` webhook (as Stripe would) and waits for the webhook job to set `PaymentAccount.stripeAccountReady` | same |
| A3 | `billing/billing.mjs`, `round3/money-tenancy.mjs` | call `makeStripeAccountReady` after Connect onboarding | same |
| A4 | `round3/money-tenancy.mjs` | `POST /franchises` sends `acceptAgreement: true` | 444 item 2 (`AGREEMENT_NOT_ACCEPTED`) |
| A5 | `round4/world.mjs` | parents get no GUARDIAN role grant (token with no grants); each Guardian link gets an ACTIVE BASELINE `ConsentRecord` | round 5 harness note (the product never makes a GUARDIAN grant); 430 item 9 refuses a child's booking without consent |

Kept on purpose: the round 1 / round 4 seeds still give students a Branch on
their STUDENT grant, so the load numbers ("at another branch") stay comparable
with rounds 1–4. Per the round 5 harness note, no "can't see / book the other
Branch" result from these seeds is reported as a finding.

## Added during the run

| # | File | Change | Why (Decision) |
|---|---|---|---|
| A6 | `round3/staff-students.mjs` | IN5's fresh owner is made main owner for the step (isMainOwner), then the cast owner again | 423 item 10: only the main owner adds/removes coaches |
| A7 | `round3/common.mjs`, `round3/waivers-classes.mjs` | `setRequireWaiver()` switches "Waiver must be signed before booking or check-in" off through PUT check-in-rules for the run, on again after (retries with codeDigits 6 at a School past 500 — finding R-1) | 441 item 5 (403 School rule vs the 400 per-class rule the script checks) |
| A8 | `round3/timetable-frontdesk.mjs` | D1 sets the School's currency first (with confirmCurrencyChange) | 414 item 6 (SCHOOL_CURRENCY_REQUIRED) |
| A9 | `billing/billing.mjs` | hosted Checkout paid on the fake (`payCheckout`), webhook carries the whole PaymentIntent; adults only buy; C16 uses real minors + BASELINE consent; C12 slice 140–146; C14b cancel sends a reason | current Stripe Checkout (no PI until paid); 430 item 5; 430 item 9; 338 item 1 (#409) |
| A10 | `round4/scale.mjs` + money/staff-frontdesk/members/notice-delay | School bands by index scaled from 500 to the world's size (`N(300)`) | the world was run at 100 Schools |
| A11 | `round4/money.mjs` | account made ready; Checkout paid to read the PaymentIntent; adult buyer; API run with STRIPE_CONNECT_COUNTRIES widened | 442 item 2; Stripe Checkout; 430 item 5; 437/439 item 1 |
| A12 | `round4/staff-frontdesk.mjs` | ST2a access body: today's switch set | switches changed (423 item 10, 436, 442 item 3 …) |
| A13 | `round4/members.mjs` | S = 4 non-small Schools outside the other bands | scaled world |
| A14 | `round4/notice-delay.mjs` | backlog = wait + prioritized; two members who signed the waiver | N1 fix (bulk = prioritized); 441 item 5 |
| A15 | `round5/*` | copies of mon, priv, review-fam, ca, jp, ng, us, de, gb, au; `package.json` path; `fix-seed.mjs` (GUARDIAN grants removed, BASELINE consent on links with none); `waiver-rule-off.mjs`; jp seed whole-yen fees; gb seed Ronan added at 17 then aged, 100-char surname; ca seed account ready; parent-trains-clean gives consent and cancels with `studentId`; ca1 sets a 24 h cut-off; gb/tests waiver rule off; coach-edit falls back to a grant + coach-edit-hb.mjs | round 5 harness note; 430; 431 (AMOUNT_NOT_WHOLE_UNIT); 441 item 5 |
| A16 | `booking-schedule/ab-race.mjs`, `ab-single.mjs` | new A/B helpers for R-2 | — |
| A17 | `repro/` | r1-code-digits, r3-search-wildcards, r4-export-refusal, time1-windows-zone, c14b, probe-plan, probe-life | finding repros and checks |
