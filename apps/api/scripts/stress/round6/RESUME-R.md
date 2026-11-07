# Round 6 tester R (regression): resume notes

Done (7 Nov 2026): every part below ran; findings in scratchpad round6/R-findings.md.
- booking-schedule seed/load/attack/burst, billing (fresh DB), round3 ×4, round4 at 100 Schools (world, life, money, staff-frontdesk, members, tenancy, notice-delay, pages, ramp), round5 seeds + mon/priv/review-fam + jp money, us time, de closure, gb tests, ng race; A/B vs 3df7696 for R-2.
Not run: round4/browser.mjs (no Chromium); round5 country scripts other than those listed (they re-test the same fixes or need their old casts).

To rebuild the stack: see ADAPTATIONS.md and billing/README.md. Env must also have DATABASE_URL_AUTH, PORTAL_BASE_URL and CORS_ALLOWED_ORIGINS; Postgres data outside /tmp/claude-0 (root-only). For round4 money and round5 money/card scripts, start the API with STRIPE_CONNECT_COUNTRIES widened. For round5: run each folder's seed, then `node fix-seed.mjs`, then `node waiver-rule-off.mjs <cast>` where a script books.
