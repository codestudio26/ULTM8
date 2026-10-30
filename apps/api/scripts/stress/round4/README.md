# Stress test round 4: 500 Schools in 40 countries

Builds a world of 500 Schools (40 countries, 32 currencies, 60 time zones, about 126,000 students), runs a busy day through the real API, then attacks money, Staff, the front desk, members' features and tenant isolation, opens the School Portal in a browser, and finds how far one API process goes. The report is `docs/handover/STRESS-TEST-ROUND4.md`. Grading is out of scope.

## What's here

- `countries.mjs`: the 40 countries: currency, language, time zones, local names, phone and address forms.
- `common.mjs`: the shared setup. It reuses round 1's `lib.mjs` (`db`, `pool`, `grant`), adds `call` (records time and bytes), `checks()` (PASS/FAIL and `<name>-result.json`), `report()`, and `tokenRca()` for tokens carrying the roles-changed stamp a real sign-in gives (`rca`, in ms).
- `world.mjs` (phase 1): seeds the 500 Schools, writes `cast.json` (ids and tokens, about 70 MB) and `world-result.json`.
- `life.mjs` (phase 2): a busy day, `SAMPLE` (default 0.2) of members acting. Booking peak, class rush with check-in, cancellations, desk sales, waivers, broadcasts, every background job timed, owner pages, and checks L1–L9.
- `tz-check.sql`: every generated class's local time against its slot, per time zone.
- `money.mjs`: M1 Stripe amounts per currency, M2 desk sale ×10, M3 charges/payments/refunds double clicks and cross-School, M4 2,000 charges and the reports, M5 a desk sale for every member without a pack. `ONLY=M1,M3` runs some sections.
- `staff-frontdesk.mjs`: Pause, access switches, activity log, must-accept-first and the main owner, Staff details, the Staff list at 4,000 students, personal codes at a very large Branch, Find me. `OFFSET=5` uses other Schools on a rerun.
- `members.mjs`: export, notes, Add child, freezes, membership cards, roster and search at 4,000 students.
- `tenancy.mjs`: 200 random School pairs × owner, staff and student × reads and writes, plus RLS checked directly with the app role.
- `notice-delay.mjs`: times a waitlist seat offer sent while the notice queue is full.
- `browser.mjs` (phase 4): the built portal in Chromium, four people, 26 pages, desktop and phone width; `browser-result.json` and `shots/`.
- `pages.mjs`, `ramp.mjs` (phase 5): owner pages by School size, and rising load until p95 passes 3 s.

## Run

1. A fresh database with every migration, Redis to itself, the fake Stripe and the built API, as in `../billing/README.md`. Give the API more heap for the 500-School world, and lift the per-IP limit the scripts would hit:

   ```sh
   THROTTLE_IP_LIMIT_PER_MINUTE=10000000 PORT=3200 \
     node --max-old-space-size=4096 --require ./scripts/stress/billing/use-fake-stripe.cjs dist/main.js
   ```

2. From this folder, with `DATABASE_URL` (superuser), `DATABASE_URL_APP`, `JWT_ACCESS_SECRET`, `STRIPE_WEBHOOK_SECRET` and `API=http://localhost:3200/v1`:

   ```sh
   node world.mjs              # about 5 minutes
   node life.mjs               # about 30 minutes at SAMPLE=0.2
   node money.mjs
   node staff-frontdesk.mjs
   node members.mjs
   node tenancy.mjs
   node notice-delay.mjs       # while a notice backlog is draining
   node pages.mjs
   node ramp.mjs               # LEVELS=16,32,64 STEP_S=20 to change the steps
   ```

3. For the browser: build the portal against the API and serve it, then run `browser.mjs`. If the repo's Playwright has no browser downloaded, point `CHROMIUM` at one.

   ```sh
   (cd ../../../../school-portal && VITE_API_BASE_URL=http://localhost:3200 npm run build && npx vite preview --port 4173)
   CHROMIUM=/path/to/chrome node browser.mjs
   ```

The scripts change data, so re-run them on a fresh world, or use `ONLY` / `OFFSET` as above. `life.mjs` hits the notice queue with 500 broadcasts and 500 waiver requests: the queue takes about 40 minutes to drain, and end-to-end tests that wait for notices are slow while it does.
