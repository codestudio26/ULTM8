# Billing stress test

The scripts behind `docs/handover/BILLING-STRESS-TEST.md`. Like `../booking-schedule/`, they are not part of CI: they need a disposable database, a running API and a few minutes.

## What's here

- `fake-stripe.mjs`: a small in-memory stand-in for the Stripe API, covering the calls ULTM8 makes (payment intents, Checkout sessions, customers, subscriptions, refunds, Connect accounts, prices, products, retrieving disputes). An off-session charge for an amount ending in 13 is declined. `GET /__calls` counts the calls; `POST /__disputes` makes a dispute, as Stripe would after a chargeback.
- `use-fake-stripe.cjs`: preloaded into the API (`node --require`), it points every `new Stripe(...)` at the fake.
- `billing.mjs`: the run. It reuses the cast from `../booking-schedule/seed.mjs` (30 Schools, about 12,000 students).

## Run

1. Seed with `../booking-schedule/seed.mjs`, as in that folder's README (a fresh database).
2. Start the fake, then the built API against it. The Connect URLs only need to be set:

   ```sh
   node scripts/stress/billing/fake-stripe.mjs &
   STRIPE_SECRET_KEY=sk_test_fake STRIPE_WEBHOOK_SECRET=whsec_test \
   STRIPE_CONNECT_RETURN_URL=https://portal.example.test/r STRIPE_CONNECT_REFRESH_URL=https://portal.example.test/r \
   PORT=3200 THROTTLE_IP_LIMIT_PER_MINUTE=10000000 \
   node --require ./scripts/stress/billing/use-fake-stripe.cjs dist/main.js
   ```

3. From this folder, with the same environment (`DATABASE_URL` as the superuser, `JWT_ACCESS_SECRET`, `STRIPE_WEBHOOK_SECRET`):

   ```sh
   node billing.mjs   # PASS/FAIL per check, a latency table, and billing-results.json
   ```

## What it does

- **Setup, through the API:** a payment account per School (even Schools Stripe Connect against the fake, odd Schools cash) and plans: a 10-class pack, a week pass, and a monthly subscription at card Schools.
- **Load:** every student buys a pack. Cash orders are confirmed by the owner. Card orders go through hosted Checkout, then a signed `payment_intent.succeeded` webhook. It then checks one Membership per successful payment, the pack's credits and expiry, and that the transactions list pages through every payment once.
- **Attacks:**
  - double clicks;
  - parallel confirmations;
  - replayed, repeated, forged and stale webhooks;
  - a second general-access pass paid by card (it is refunded);
  - a failed-then-succeeded card payment;
  - cross-tenant and wrong-role access;
  - plan edge cases;
  - a double-clicked subscription;
  - promotion-fee races (accept, waive and cancel);
  - removed students, archived plans and failed orders;
  - a lost chargeback;
  - Guardians;
  - a School whose ULTM8 subscription lapsed, and a closed School.

The webhooks are signed with `STRIPE_WEBHOOK_SECRET`, exactly as Stripe signs them, so they go through the real signature check.
