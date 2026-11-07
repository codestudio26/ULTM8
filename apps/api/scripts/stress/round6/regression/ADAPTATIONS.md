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
