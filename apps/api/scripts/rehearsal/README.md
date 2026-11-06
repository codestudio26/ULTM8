# Launch rehearsal

The real journeys, end to end, for a UK School (cards through Stripe Connect) and a Brazilian School (no card payments: Pix as a bank transfer or cash, confirmed by the School). The report is `docs/handover/LAUNCH-REHEARSAL-1.md`. Like `../stress/`, this is not part of CI: it needs a disposable database, Redis, the built API and a few minutes.

Everything a person does goes through the real HTTP API as that person, after a real sign-in (register, SMS code, sign in). The shortcuts are only for what a laptop can't do, and each is named in the script that takes it:

- **Outside services are faked** (`use-fakes.cjs`, preloaded into the API): Stripe (`../stress/billing/fake-stripe.mjs`), Twilio Verify (the code `123456` is approved, no SMS is sent) and R2 file storage (kept in memory). No live key is used anywhere.
- **Stripe's webhooks** are signed with `STRIPE_WEBHOOK_SECRET`, exactly as Stripe signs them. Paying on the hosted Checkout page is the fake's `POST /__checkout/:id/pay`; a refund made in the Stripe Dashboard is `POST /__charges/:id/refund`.
- **Background jobs** are started by adding them to their queue, as the scheduler does.
- **"30 days later"** (the erasure job) and **"when the plan ends"** (the plan-switch job) are reached by moving the due date or the expiry date back in the database.
- **Platform Admin** signs in through Cognito, so adding the UK to the card-surcharge country list is written directly.

## What's here

- `use-fakes.cjs`: the fakes above.
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
  7. Cross-tenant spot checks both ways, as owner, Branch Staff, member and parent.
- `portal.mjs`: the School Portal in Chromium: School B's owner signs in through the login page and reads 14 pages in pt-BR; Branch Staff open the payroll report; School A's owner sees the Connect Stripe step.
- `member.mjs`: the member app (`apps/student`, exported for the web) in Chromium, in pt-BR, as School B's adult member.
- `ts-resolve.mjs`: lets Node read the apps' TypeScript message files.

## Run

1. A fresh database with every migration, Redis to itself, and the built API (`npm run build` in `apps/api`), with the CI env block from `.github/workflows/ci.yml` pointed at them. Then, from `apps/api`:

   ```sh
   FAKE_STRIPE_PORT=12517 node scripts/stress/billing/fake-stripe.mjs &
   FAKE_STRIPE_PORT=12517 TWILIO_ACCOUNT_SID=ACfake TWILIO_AUTH_TOKEN=fake TWILIO_VERIFY_SERVICE_SID=VAfake \
   STRIPE_CONNECT_RETURN_URL=http://localhost:5317/r STRIPE_CONNECT_REFRESH_URL=http://localhost:5317/r \
   CORS_ALLOWED_ORIGINS=http://localhost:5317,http://localhost:5318 PORT=3317 THROTTLE_IP_LIMIT_PER_MINUTE=10000000 \
   node --require ./scripts/rehearsal/use-fakes.cjs dist/main.js
   ```

   Unset `HTTPS_PROXY` for the API if your machine has one: the API sends its Stripe calls through it otherwise, and the fake is on localhost.

2. The API journeys, from this folder (same env, plus `API=http://localhost:3317/v1`):

   ```sh
   node --import ./ts-resolve.mjs rehearsal.mjs        # ONLY=1,3 runs some journeys (setup always runs)
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
