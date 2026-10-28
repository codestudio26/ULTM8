# Stress test round 3: features added since round 2

The scripts behind `docs/handover/STRESS-TEST-ROUND3.md`. Like `../booking-schedule/` and `../billing/`, they are not part of CI: they need a disposable database, a running API and a few minutes.

## What's here

- `common.mjs`: the shared setup. It reuses `../booking-schedule/lib.mjs` (`call`, `pool`, `db`, `token`, `report`) and its cast. `pick()` chooses which cast schools a script may change, and `checks()` records PASS/FAIL and writes `<name>-result.json`.
- `staff-students.mjs`: Staff list, Remove from School, "Give role", instant access changes, Instructors (resend passcode, private details, revoke while teaching), Students (Add manually, revoke ending bookings, waitlist places and Subscriptions, leaving summary, re-enrol, roster, Branch Staff scope). Default schools 14–17.
- `waivers-classes.mjs`: mass signing, new terms while students sign, double-click signing, "Remind everyone", guests and Friend Passes, guest signing links, the class page's Add student and Cancel booking, whole-class cancels and the "to resolve" list. Default schools 18–21.
- `money-tenancy.mjs`: Record a payment, the Branch Staff switch, Mark as paid and Cancel, the transactions ledger, filters and CSV, Friend Passes, Subscription cancel, Franchise join requests, removing a School, closing a School or a Franchise. Default schools 22–25.
- `timetable-frontdesk.mjs`: the front-desk check-in flow (search, membership status, book on behalf, check in, QR), Branch Staff walk-ins, the calendar, closing a Branch, Mark all read, broadcasts, archived styles. Default schools 26–29.

## Run

1. Seed with `../booking-schedule/seed.mjs`, as in that folder's README (a fresh database), and run `load.mjs`.
2. Start the fake Stripe and the built API as in `../billing/README.md`. Give each API process its own Redis server: the job queue ignores the database number in `REDIS_URL`, so two APIs on one Redis take each other's jobs.
3. From this folder, with the same environment (`DATABASE_URL` as the superuser, `JWT_ACCESS_SECRET`, `STRIPE_WEBHOOK_SECRET`):

   ```sh
   node staff-students.mjs
   node waivers-classes.mjs
   node money-tenancy.mjs
   node timetable-frontdesk.mjs
   ```

Run them before `../billing/billing.mjs`: billing makes every student buy a pack, which changes the membership kinds these scripts pick students by. `SCHOOLS=0` (or `0-3`, `1,2`) and `CAST=path/to/cast.json` point a script at other schools or another cast.

Re-running on a cast that billing has already run on works: the checks read a student's live memberships and total pack credits from the database rather than trusting the seed's kind. Each `staff-students.mjs` run uses up some students in its schools (it revokes them), so point a repeat run at other schools, for example `SCHOOLS=10-13`.
