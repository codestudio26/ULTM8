# Stress test round 5 scripts

Round 5 (4 Nov 2026): ten tester agents, one folder per country (`au`, `br`, `ca`, `de`, `gb`, `in`, `jp`, `ng`, `us`, `ae`). There is also one folder per review panel that re-ran findings on a clean School (`mon`, `priv`, `review-fam`). Report: `docs/handover/STRESS-TEST-ROUND5.md`. Fixes: Decisions 430–434.

The scripts build on the round 4 harness (`../round4/`). Run them against a local stack only, never the live site. Start the API without `HTTPS_PROXY`, so card calls reach the local fake Stripe (`../billing/fake-stripe.mjs`).

The large generated cast files (over 200 KB) are not committed. Each tester's script makes its own cast again when run.

The round 4 seeds give parents a GUARDIAN role grant and students a Branch on their STUDENT grant, which the product never does. Don't trust a "can't see the other Branch" result from them.
