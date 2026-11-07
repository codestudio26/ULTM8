# Round 6 tester R (regression): resume notes

Stack: PG data /var/tmp/round6-R/pg (port 55511), Redis 56511, API 3311, fake Stripe 12111; env in /var/tmp/round6-R/env.sh.
Start: see ../round6/regression/ADAPTATIONS.md and the billing README (API with `--require ./scripts/rehearsal/use-fakes.cjs`, no proxy env).

Order: booking-schedule seed → load → round3 x4 → attack → burst → billing → round4 (scaled world) → round5 repro scripts.

## Done
- seed (30 Schools, 12,213 students)
## Next
- load (running)
