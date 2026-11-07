# Stress test round 6: time, scale and races (tester T)

Round 6 (7 Nov 2026). Attacks on timing and concurrency for what merged since round 5 (Decisions 435–444). A local stack only: own Postgres, Redis, API and the fake Stripe. Never a live site or real Stripe.

## Files

- `lib.mjs`: helpers on top of `../../../rehearsal/lib.mjs` (sign-up with the Decision 444 "I agree" tick, results appended to `out/results.jsonl` as they happen).
- `fake-stripe-t.mjs`: `../../billing/fake-stripe.mjs` plus two test hooks: `POST /__accounts/:id` (set a connected account's fields, e.g. `details_submitted`) and `POST /__delay` (make reads of one path slow, returning what Stripe said when asked).
- `seed.mjs`: 20 Schools in the UK, Germany, Brazil, Japan, the US (New York, Los Angeles) and Australia (Sydney, Perth), through the API: owner, School, Branch, payment account (3 Stripe, 17 cash or bank transfer), a monthly plan, a pack and a week pass, a waiver, 60 members by a MEMBERS import, and a desk sale to each (the monthly plan at Schools without cards, so it is billed to the balance: Decision 441 item 1).
- `setup-days.mjs`: moves each balance-billed member's sale date to a chosen day (26th to 31st, 1st, 5th, 7th; at 00:20, 12:00 or 23:40 in the School's zone) and lets the charge-recurring job's own safety net make the monthly series again; adds seven freezes per School at the edges of Decision 443 item 1; switches late fees on at every other School.
- `clock.cjs`: a second API instance (from `dist/`) with `Date` faked, which calls each daily job's processor at a chosen moment. `plan.mjs` writes the scheduler's own UTC times for a range of days (plus extra charge-recurring runs every 3 hours on month ends and clock-change days). `--serve` runs it as a plain second worker.
- `check-days.mjs`: the oracle. Works out every member's billing days independently (month ends, February, freezes moved and ended early) and checks the charges: none missing, none extra, no duplicates, made on their own day in the School's zone, in the right School, for the right amount; late fees once per charge and the same delay in every zone.
- `killer.mjs`: runs a clock plan and kills it (SIGKILL, only its own child) at random moments, restarting from the step that was cut.
- `autopay-setup.mjs`: saved cards with "Pay charges automatically" at the card Schools and a monthly charge, for the auto-pay restart test.
- `races.mjs`: R1–R9, each on a clean School (see the header).
- `birthday.mjs`: 18th birthdays at sign-up and at the School's first actions.

## Run

```sh
source env.sh   # the CI env block with this tester's ports, no HTTPS_PROXY
node fake-stripe-t.mjs & node --require ../../../rehearsal/use-fakes.cjs ../../../../dist/main.js &
node seed.mjs && node setup-days.mjs
node plan.mjs 2026-11-08 2027-02-27 out/plan-a.json
node --require ../../../rehearsal/use-fakes.cjs clock.cjs out/plan-a.json
node check-days.mjs 2027-02-27T23:59:00Z
```

Shortcuts, each named in its script: `platformSubscriptionStatus = ACTIVE` on the seeded Schools (Platform Admin billing); Stripe onboarding finished on the fake; the sale date moved back in the database; saved cards written directly; "30 days later" for the erasure job. The faked clock is only in the clock process: Postgres' own `now()` stays real, so the account-erasure job (which checks the due date in SQL) is tested with the due date moved back instead.
