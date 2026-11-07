# Round 6 money tester (M) — resume notes

Stack (all mine): PG `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/round6-M/pg -o '-p 55512 -k /var/tmp/round6-M' -l /var/tmp/round6-M/pg.log start"`,
Redis `redis-server --port 56512 --save '' --appendonly no --daemonize yes`, env `/var/tmp/round6-M/env.sh` (the CI env block with my ports),
fake Stripe `node scripts/stress/billing/fake-stripe.mjs`, API `node --require ./scripts/rehearsal/use-fakes.cjs dist/main.js` (from apps/api, env sourced, no HTTPS_PROXY).
If the fake Stripe restarted, its accounts are gone: run setup.mjs again (new cast.json).

Order: setup.mjs → monthly.mjs, freeze.mjs, ready.mjs, switch-fees.mjs, contract-delete.mjs → totals.mjs → confirm.mjs, confirm2.mjs (each finding on a brand-new School).
Each writes `<name>-out.json` (PASS/FAIL/NOTE rows).

Status (7 Nov 2026): all done. Findings M-1..M-5 in the round 6 scratchpad `M-findings.md`; the confirm scripts reproduce all five.
