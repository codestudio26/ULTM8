# Booking and schedule stress test

The scripts behind `docs/handover/BOOKING-SCHEDULE-STRESS-TEST.md`. They are not part of CI: they need a disposable database, a running API, and a few minutes.

## Run

1. A fresh Postgres 16 database with every migration applied (`npx prisma migrate deploy`), and Redis.
2. The built API on its own port. Raise the per-IP limit, because every request comes from one machine:

   ```sh
   cd apps/api && npm run build
   PORT=3200 THROTTLE_IP_LIMIT_PER_MINUTE=10000000 node dist/main.js
   ```

3. From this folder, with the same environment as the API (`DATABASE_URL` as the superuser, `JWT_ACCESS_SECRET`, `REDIS_URL`), and `API=http://localhost:3200/v1` if the port differs:

   ```sh
   node seed.mjs     # 30 Schools, 300–500 students each, ladders, timetable, classes, memberships
   node load.mjs     # every student declares a belt, books 3 classes, is checked in and promoted
   node attack.mjs   # races, cross-tenant attempts, waitlist, slot edits, grading (PASS/FAIL per check)
   node burst.mjs    # many students booking one popular Class at the same moment
   ```

`N_SCHOOLS=3 node seed.mjs` makes a smaller cast. `seed.mjs` writes `cast.json` (ids and tokens) for the other scripts. Re-seed into an empty database: the scripts do not clean up.

## What is seeded through the API, and what directly

- **Through the API:** styles from the IBJJF templates, timetable slots, one-off classes, belt declarations, bookings, check-ins, promotions, waitlist, slot edits, and the class generator (the real BullMQ job).
- **Directly in the database:** Schools, users, role grants, membership plans and memberships. Memberships are paid through Stripe, which a local run doesn't have.
