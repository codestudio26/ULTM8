# Stress test round 4: 500 Schools in 40 countries

**Run:** 30 Oct 2026, against `master` at `3a5bf1e` (after #407). **Fixes:** this PR. **Scripts:** `apps/api/scripts/stress/round4/` (see its README). **Earlier rounds:** `BOOKING-SCHEDULE-STRESS-TEST.md`, `BILLING-STRESS-TEST.md`, `STRESS-TEST-ROUND3.md`. Grading was out of scope.

## In plain words

We built a pretend world of **500 Schools in 40 countries** (32 currencies, 60 time zones, 15 Franchises), with **126,428 students** and 3,326 parents. School sizes were mixed: 300 small, 140 medium, 50 large and 10 very large (3,000 to 4,000 students each). Then we ran a busy day through the real API: bookings, check-ins, desk sales, waivers, broadcasts and every background job. After that came the edge cases, the School Portal in a real browser, and a test of how far one server goes.

**What held up:**
- **Tenant isolation is solid.** 25,082 attempts by owners, staff and students to read or change another School's data were all refused. None leaked data, none caused a server error, and the database's own row security leaked nothing in 40 checks.
- **Double clicks are safe.** Pressing desk sale, charge, payment, refund, Pause, Freeze, Add note or Add child 5 or 10 times at once never made duplicates (one exception below, now fixed). 10,150 desk sales gave exactly 10,150 packs.
- **Capacity and credits stayed exact.** No class was overbooked, no pack went below zero, and no student was booked or checked in twice.
- **Background jobs are fast at 500 Schools.** Making the next weeks' classes took 34 s, waiver renewal 4.5 s and the 90-day purge 12 s. The rest took under 0.1 s.
- **Owner pages are quick.** Every page loaded in under 1.3 s, even at the 3,700-student Schools with 16 owners at once.

**What broke, and is fixed in this PR:**
1. **Yen, won, peso and dinar card prices were wrong (High).** A 1,000-yen pack asked Stripe for 100,000 yen. Korean won and Chilean pesos had the same problem. Kuwaiti and Bahraini dinars were charged a tenth of the price. Dollars, reais, pounds and euros were right. Fixed: every amount sent to Stripe, or read back from it, is now converted for currencies with no decimals or with three.
2. **A waitlist seat offer arrived 40 minutes late (High).** All notices wait in one line, first come first served. After 500 broadcasts and 500 waiver requests, about 270,000 notices were queued. A seat offer (60 minutes to claim) took 40 min 22 s to arrive. Fixed: broadcasts and waiver requests now wait behind urgent notices, so a seat offer, a cancelled class or a payment notice goes out next.
3. **Every portal page scrolled sideways on a phone (Medium).** The header (search, bell, name, language) was wider than a phone screen. Fixed: it wraps onto a second line.
4. **Booking was slower than it needed to be (Medium).** Each booking loaded the style's whole belt ladder to check for a lock, even when nothing was locked. Fixed: it first asks whether anything is locked at all. Bookings are about a third faster (median 284 ms to 192 ms) and read 8 times fewer rows.
5. **Unpause, clicked 5 times at once, logged 5 times (Low).** Pause already guarded this. Fixed: the other clicks now get "This person is not paused" and log nothing.

**Questions for you (nothing is built for these):**
- **Q1. Front-desk codes at very large Schools.** One Branch of a very large School had 782 members holding 4-digit codes, which is 8% of all possible codes. In our test, 1 of 10 random guesses at the tablet opened a real member's card. The tablet allows 10 tries a minute, and wrong member codes never lock it. Only wrong staff codes do. **Recommended:** a School with more than 500 members switches to 6-digit codes on its own, and 10 wrong member codes in a row lock the tablet until a staff code is entered.
- **Q2. The Waivers page at very large Schools.** It takes 22 to 25 s to open there, because it loads every signature (about 40 pages of 100) before showing anything. **Recommended:** show the first 100 with "Load more" and a search box, and count the signed and unsigned totals once rather than on every page.
- **Q3. Hosting size.** The database was 343 MB right after the 500 Schools were created and 653 MB after one busy day. Notifications are the biggest table (177 MB). Supabase's free plan stops at 500 MB. **Recommended:** a paid database plan before real launch at this scale, and the notification auto-clean-up (already planned for v1.3) when email and push go live.
- **Q4. Vancouver's clocks (deploy step, needs checking).** British Columbia moves to permanent UTC-7 from 1 Nov 2026. Our Node 22.22 has time-zone data 2025b, which doesn't know this yet. After 1 Nov, 357 of 384 test classes in Vancouver came out an hour off, while the other 59 zones were all right. **Recommended:** before 1 Nov, check `node -p process.versions.tz` on Render. If it shows older than 2026e, move Render to a Node release with current zone data. The other option is pointing `ICU_TIMEZONE_FILES_DIR` at an updated `zoneinfo64.res`. I could not check which Node release ships 2026e from here, so this needs checking.

**Needs action on deploy:** none. There's no migration and no new environment variable.

## Environment

- **Database and queue:** Postgres 16 with RLS (`pg_stat_statements` on), and Redis, with every migration applied to an empty database.
- **API:** the built API (`node dist/main.js`, 4 GB heap) against the in-memory fake Stripe from round 2. Each run had its own Redis.
- **Machine:** one sandbox with 4 CPUs runs the scripts, the API, Postgres, Redis and the browser together. Absolute times are only a guide. A real server on its own machine will be faster, and Postgres on Supabase slower per query.

## The world (phase 1)

| | |
|---|---|
| Schools | 500: 300 small (40–150 students), 140 medium, 50 large, 10 very large (3,000–4,000) |
| Countries / currencies / time zones | 40 / 32 / 60 |
| Students / parents | 126,428 / 3,326 |
| Franchises | 15, one spanning Brazil, Portugal and the US |
| Weekly slots / classes made | 10,456 / 41,824, exactly the number expected |
| Seed time | 269 s |
| Database | 343 MB, about 2.6 MB per 1,000 students |

Names, addresses and phone numbers follow each country's own forms: Arabic, Japanese, Thai, Vietnamese and accented names, and names with apostrophes and hyphens.

## A busy day (phase 2)

A 20% sample of members acted at once (16 to 32 requests in flight):

| Step | Requests | Time | Result |
|---|---|---|---|
| Morning booking peak | 33,700 | 451 s (~75/s) | every class exact |
| Class rush: 10 students per class starting now, book and check in | 54,500 | 788 s | one attendance each |
| Waiver signing | 15,172 | ~110 s | each signed once |
| Broadcasts, one per School | 500 | 9 s | queued 270,632 notices (see N1) |
| Owner pages, 22 per School | 11,000 | 108 s | all 200 |
| Desk sales (phase 3, M5) | 10,154 | 400 s (25/s) | 4 answered "busy, try again" (503), none lost |

**Background jobs at 500 Schools** (one run each, timed from the queue):

| Job | Time |
|---|---|
| class-occurrence-generation | 34.3 s |
| entity-offboarding-purge | 12.2 s |
| waiver-renewal-sweep | 4.5 s |
| the other 10 (expiry, no-shows, waitlist, charges, late fees, purges) | under 0.1 s each |

**Checks:** L1 to L5 pass: no class over capacity, no pack below zero, no double booking and one attendance per student per class. Checks L6 to L9 (each signature recorded once, no broadcast failed, no 500 anywhere, every job finished) did not run, because the script stopped on a bug of its own. The world was reset for the round 1–3 rerun before they could be repeated. The same ground is covered elsewhere: waiver signing returned only 201s, broadcasts only 201s, every job above finished, and no script in phases 3 to 5 saw a 500.

## Edge cases (phase 3)

| Script | Checks | Notes |
|---|---|---|
| `money.mjs` | 8 of 8 after the fix | M1 failed for JPY, KRW, CLP, KWD and BHD before it. M2 to M5 (desk sale ×10, charge/pay/refund double clicks, wrong credits, cross-School, 2,000 charges with reports, 10,154 desk sales) all pass. |
| `staff-frontdesk.mjs` | 17 of 18 | Pause takes access away at once, even with a token that still claims the role. The owner rules, access switches, activity log and must-accept-first all hold. FD1c is Q1. |
| `members.mjs` | 20 of 20 | One reported failure was the script's own count: an extra student added during phase 2. The export of 3,700 students is 1.3 MB, and 10 at once are fine. Notes, Show to member, Add child, Freeze and membership cards are all right. Search with `%`, `_`, quotes, Arabic and Japanese never errors. |
| `tenancy.mjs` | 5 of 5 | 200 random School pairs × owner, staff and student × reads and writes (25,082 tries): 0 allowed, 0 leaks, 0 server errors. RLS: 0 of 40 pairs leaked. |

**M1 before and after** (the owner types 1,000; the portal stores 100,000 hundredths):

| Currency | Stripe should get | Before | After |
|---|---|---|---|
| JPY, KRW, CLP (no decimals) | 1,000 | 100,000 (100×) | 1,000 |
| KWD, BHD (3 decimals) | 1,000,000 | 100,000 (÷10) | 1,000,000 |
| USD, BRL, GBP | 100,000 | 100,000 | 100,000 |

The fix (`apps/api/src/payments/stripe-amount.ts`) covers everything that leaves for Stripe: card payments and their surcharge, Subscriptions, plan Prices, hosted checkout, off-session charges and refunds. It also covers everything that comes back: renewal invoices, dashboard refunds, lost disputes and the amounts shown in notices. Platform and franchise fees are always in US dollars (Decision 7), so they are unchanged.

## The portal in a browser (phase 4)

Chromium opened 26 menu pages as four people: the owner of the largest School (3,909 students), a small British School's owner, an Arabic School's owner reading in Arabic, and Branch Staff at the largest School. Each ran at desktop and phone width, 182 page loads in all.

- **Every phone page scrolled sideways**, for all three owners. The header was 568 px wide on a 390 px screen. Fixed, and re-checked: 390 px.
- **Waivers took 22 s (desktop) and 25 s (phone)** at the largest School, with 49 API calls. Each signature page costs 200–600 ms, mostly counting the totals and the row-security check on each row. See Q2.
- **Students and Timetable load the whole roster** (1.3 MB) at the largest School, in about 1 s. That's fine today, but it grows with every student. Paging on the server would be the next step if Schools get bigger.
- Branch Staff opening Billing reports or Check-in rules by direct link see "You don't have access", which is correct.
- No raw translation keys, no server errors, and Arabic pages run right-to-left.

## Slow spots and how far one server goes (phase 5)

**Owner pages by School size** (16 owners at once, 7,000 calls, all 200):

| Page | small p50 | very large p50 | very large p95 |
|---|---|---|---|
| Students | 244 ms | 798 ms | 890 ms (1.3 MB) |
| Export | 284 ms | 1,162 ms | 1,296 ms (1.4 MB) |
| Search "ma" | 207 ms | 590 ms | 784 ms |
| Calendar, one month | 162 ms | 372 ms | 1,042 ms |
| Plan members | 129 ms | 434 ms | 816 ms |
| Cancellations | 445 ms | 374 ms | 465 ms |
| Dashboard | 107 ms | 316 ms | 432 ms |
| Everything else | under 150 ms | under 300 ms | under 350 ms |

Cancellations takes about 450 ms even at a small School, which suggests it scans more than its own School. That's worth a look, but it isn't urgent.

**How far one API process goes.** The mix was 80% members' phones (my bookings, my memberships, my notices, the timetable) and 20% owners' pages:

| In flight | Requests/s | p50 | p95 | Failed |
|---|---|---|---|---|
| 32 | 230 | 124 ms | 248 ms | 0 |
| 64 | 298 | 177 ms | 357 ms | 0 |
| 128 | 287 | 373 ms | 785 ms | 0 |
| 256 | 249 | 830 ms | 1.9 s | 0 |
| 512 | 248 | 1.6 s | 3.3 s | 0 (an earlier run: 3% "busy") |

One process tops out at about **250–300 requests a second** on this shared 4-CPU machine. Above that, requests wait longer but still succeed. From 512 at once, some get "busy, try again" (503) when the database pool runs out.

**What a real launch at this size needs:**
- **API:** phase 2's morning peak (a fifth of all members booking within minutes) ran at about 75 requests a second, well inside one instance. Two instances behind Render's load balancer give headroom and survive a restart. They need one shared Redis, and the notice worker's speed (about 110 notices a second) is the real limit for broadcasts.
- **Database:** a paid Supabase plan (see Q3), with the pooler sized for 2 × the Prisma pool.
- **Redis:** Redis held about 490 MB while the notice backlog drained (queued and finished jobs together). A small Redis plan could run out during a broadcast storm, so size it for at least 1 GB.

**Booking fix measured** (A/B on the same API, 16 bookings in flight at a large School):

| | Bookings | Time | p50 | p90 | Rows read per booking |
|---|---|---|---|---|---|
| Before | 332 | 6.15 s | 284 ms | 388 ms | 182 |
| After | 400 | 5.22 s | 192 ms | 274 ms | 22 |

## Findings and fixes

| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| M1 | High | Zero- and three-decimal currencies sent to Stripe 100× or ÷10 | `stripe-amount.ts`, used on every Stripe amount in and out | `src/payments/stripe-amount.spec.ts`, `test/stress-round4-fixes.e2e-spec.ts`, `money.mjs` M1 |
| N1 | High | Urgent notices queued behind bulk ones (seat offer 40 min late) | Broadcasts and waiver requests queue with `BULK_NOTIFICATION_PRIORITY`. BullMQ always takes jobs without a priority first, and a parent's copy keeps the child's priority. | `test/stress-round4-fixes.e2e-spec.ts` (real BullMQ: a seat offer after 50 bulk notices goes first), `test/notification-broadcast.e2e-spec.ts` |
| UI1 | Medium | Every phone page scrolled sideways | The header wraps | Re-checked in the browser: 390 px |
| P1 | Medium | Every booking loaded the whole ladder | Ask whether any rung unlocks the class type first | `test/booking-unlocks.e2e-spec.ts` (all 10 pass: locked types still lock), A/B above |
| S1 | Low | Unpause ×5 at once logged 5 times | Only rows still paused change; the rest get 409 | `staff-frontdesk.mjs` ST1e, `test/staff-pause.e2e-spec.ts` |
| FD1 | Question | 4-digit codes guessable at very large Schools | Q1 | |
| W1 | Question | Waivers page 22 s at 3,700 students | Q2 | |
| DB1 | Question | Database over the free plan after one busy day | Q3 | |
| TZ1 | Deploy check | Vancouver an hour off from 1 Nov 2026 (old Node zone data) | Q4 | `tz-check.sql` |

Refunds now take the currency from the payment ULTM8 recorded. An older payment recorded without one asks Stripe.

## Tests after the fixes

- `npx eslint src test --max-warnings 0`: clean.
- API unit tests: 26 suites, 625 tests pass.
- API end-to-end suites touching the changes (staff pause and activity, notifications, broadcasts, waivers, guest waivers, payments, Stripe webhooks, dashboard refunds, card surcharge, charges refunds and reports, desk sales, class cancellation refunds, booking unlocks, and the new round 4 suite) all pass. `charges-refunds-reports` once failed a notice-timing test while the stress API was draining 100,000 notices on the same Redis. It passed on each of 3 reruns once the queue was empty.
- School Portal: typecheck clean, 18 tests pass.
- Rounds 1–3 re-run on a fresh database with every fix built in: see the next section.

## Rounds 1–3 re-run

The round 1, 2 and 3 scripts ran on a fresh database (30 Schools) with every fix above built in:

- **Round 1 attacks:** 22 of 24 pass. The two that fail are the same known open items as in round 3. H2 (A1) is the extreme burst of 1,200 people at 30 classes of 10, which gets "busy, try again" by design. H4 (A10b) is a promote sent without `expectedCurrentRungId`, which the apps always send. A10b is grading, which is outside this round.
- **Bursts:** 40, 100, 200 and 400 people booking at once filled every class exactly, with no errors.
- **Round 2 billing:** 29 of 29 pass.
- **Round 3:** staff and students 30/30, waivers and classes 34/34, money and tenancy 37/37, timetable and front desk 33/33.
