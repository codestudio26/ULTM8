# Round 6 money tester (M) — resume notes

Stack (all mine): PG `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/round6-M/pg -o '-p 55512 -k /var/tmp/round6-M' -l /var/tmp/round6-M/pg.log start"`,
Redis `redis-server --port 56512 --save '' --appendonly no --daemonize yes`, env `/var/tmp/round6-M/env.sh`,
fake Stripe `node scripts/stress/billing/fake-stripe.mjs`, API `node --require ./scripts/rehearsal/use-fakes.cjs dist/main.js` (from apps/api, env sourced).
If the fake Stripe restarted, its accounts are gone: run setup.mjs again (new cast.json).

Done: setup.mjs, monthly.mjs.
Next: freeze.mjs, ready.mjs (Stripe readiness flips), switch-fees.mjs (plan switch, joining fee, surcharge, refunds, BRL rounding), deletion/contract, totals.mjs.
