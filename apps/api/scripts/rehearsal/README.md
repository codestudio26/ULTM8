# Launch rehearsal

The real journeys, end to end, for a UK School (cards through Stripe Connect) and a Brazilian School (no card payments: Pix as a bank transfer or cash, confirmed by the School). The reports are `docs/handover/LAUNCH-REHEARSAL-1.md` and `docs/handover/LAUNCH-REHEARSAL-2.md` (rehearsal 2 added journey 8 and the checks for Decisions 441–448 to the others). Like `../stress/`, this is not part of CI: it needs a disposable database, Redis, the built API and a few minutes.

Everything a person does goes through the real HTTP API as that person, after a real sign-in (register, SMS code, sign in). The shortcuts are only for what a laptop can't do, and each is named in the script that takes it:

- **Outside services are faked** (`use-fakes.cjs`, preloaded into the API): Stripe (`../stress/billing/fake-stripe.mjs`), Twilio Verify (the code `123456` is approved, no SMS is sent) and R2 file storage (kept in memory). No live key is used anywhere.
- **Stripe's webhooks** are signed with `STRIPE_WEBHOOK_SECRET`, exactly as Stripe signs them. Paying on the hosted Checkout page is the fake's `POST /__checkout/:id/pay`; a refund made in the Stripe Dashboard is `POST /__charges/:id/refund`; finishing Stripe's onboarding is `POST /__accounts/:id/complete` (a new connected account starts not ready, as at Stripe), followed by Stripe's `account.updated`.
- **A file a browser uploads straight to storage** (a coach's certification, through a presigned URL) is `PUT /<bucket>/<key>` on the fake R2.
- **Background jobs** are started by adding them to their queue, as the scheduler does.
- **"30 days later"** (the erasure job), **"when the plan ends"** (the plan-switch job) and **"a month later"** (a monthly plan's balance charge) are reached by moving the due date, the expiry date or the start and billing dates back in the database.
- **An account from before the "I agree" tick** is made by removing a new account's acceptance rows.
- **Platform Admin** signs in through Cognito, so adding the UK to the card-surcharge country list is written directly.

## What's here

- `use-fakes.cjs`: the fakes above.
- `fake-r2-port.cjs`: where the fake R2 storage's port for this run is written and read.
- `lib.mjs`: `call` (waits and retries on a 429 from the sign-in limits), `signUp`, `signIn`, `stepUp`, `runJob`, `stripeWebhook`, PASS/FAIL/NOTE bookkeeping.
- `schools.mjs`: the two Schools and their people.
- `rehearsal.mjs`: runs journeys 1–7 below, then writes `results-<run>.json` and `cast-<run>.json` (ids and sign-ins for the browser checks).
- `j1-setup.mjs` … `j7-tenancy.mjs`: one file per journey.
  1. Owner sign-up and School setup, the Connect Stripe step (UK) or its refusal (Brazil), the Dashboard checklist.
  2. Branch Staff, the Payroll switch, pay rates hidden or shown.
  3. Adult member and parent: waiver, buying (card or Pix/cash), a child, consent, the child's waiver and plan.
  4. Booking, the class waitlist, the plan's member limit and waiting list, QR and desk check-in, attendance, a promotion, a freeze, refunds and a cancelled order, the plan switch.
  5. Delete my account: cancelled by signing in again; a parent and their only child erased by the daily job.
  6. Language: every new string in pt-BR (portal, member app, API messages), and every API error School B's people got.
  7. Cross-tenant spot checks both ways, as owner, Branch Staff, member and parent; outsiders get 404 from pages an owner's switch guards.
  8. (Rehearsal 2) Legal: the sign-up and Agreement ticks, the legal pages, the first-sign-in "I agree" (added manually, tablet sign-ups, older accounts); imported attendance and the waiver rule; profile edits, the payment account, symbol-only search, the tablet's 18th-birthday rule, Pix only in Brazil, and a UK School whose Stripe isn't ready. Then a coach deletes their account.
- `portal.mjs`: the School Portal in Chromium: School B's owner signs in through the login page and reads 14 pages in pt-BR; Branch Staff open the payroll report; School A's owner sees the Connect Stripe step. Rehearsal 2 adds the legal pages, the first-sign-in "I agree" page, the plan form without "switch to", the symbol-only search hint, Pix where it applies, the Connect Stripe card and the surcharge tile.
- `member.mjs`: the member app (`apps/student`, exported for the web) in Chromium, in pt-BR, as School B's adult member; rehearsal 2 adds the monthly plan and the first-sign-in "I agree" screen.
- `ts-resolve.mjs`: lets Node read the apps' TypeScript message files.

## Run

1. A fresh database with every migration, Redis to itself (started with `--dir` set to its own new, empty folder, never the repo: Redis loads any `dump.rdb` in its folder, old jobs included; see `../stress/booking-schedule/README.md`), and the built API (`npm run build` in `apps/api`), with the CI env block from `.github/workflows/ci.yml` pointed at them. Then, from `apps/api`:

   ```sh
   FAKE_STRIPE_PORT=12517 node scripts/stress/billing/fake-stripe.mjs &
   FAKE_STRIPE_PORT=12517 TWILIO_ACCOUNT_SID=ACfake TWILIO_AUTH_TOKEN=fake TWILIO_VERIFY_SERVICE_SID=VAfake \
   STRIPE_CONNECT_RETURN_URL=http://localhost:5317/r STRIPE_CONNECT_REFRESH_URL=http://localhost:5317/r \
   CORS_ALLOWED_ORIGINS=http://localhost:5317,http://localhost:5318 PORT=3317 THROTTLE_IP_LIMIT_PER_MINUTE=10000000 \
   node --require ./scripts/rehearsal/use-fakes.cjs dist/main.js
   ```

   The fake R2 file storage takes a free port of its own for each run (set `REHEARSAL_R2_PORT` to choose one); `use-fakes.cjs` prints it and writes it where `j5-delete.mjs` finds it (`fake-r2-port.cjs`, keyed by the API's `PORT`).

   Unset `HTTPS_PROXY` for the API if your machine has one: the API sends its Stripe calls through it otherwise, and the fake is on localhost.

2. The API journeys, from this folder (same env, plus `API=http://localhost:3317/v1`):

   ```sh
   node --import ./ts-resolve.mjs rehearsal.mjs        # ONLY=1,3 runs some journeys (setup always runs); 8 needs 2–4
   ```

3. The browsers (wait a minute after step 2: sign-in allows 5 tries a minute per email):

   ```sh
   (cd ../../../school-portal && VITE_API_BASE_URL=http://localhost:3317 npx vite build && npx vite preview --port 5317) &
   CHROMIUM=/path/to/chrome node --import ./ts-resolve.mjs portal.mjs
   # member app: set app.json extra.apiBaseUrl to http://localhost:3317 for the export only, then put it back
   (cd ../../../student && npx expo export -p web --output-dir /tmp/student-web) && (cd /tmp/student-web && python3 -m http.server 5318) &
   CHROMIUM=/path/to/chrome node --import ./ts-resolve.mjs member.mjs
   ```

Run it on a fresh database: the Schools have fixed names, and the member app finds School B by name on its School page.
