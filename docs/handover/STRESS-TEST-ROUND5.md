# Stress test round 5: 10 testers from 10 countries

**Run:** 4 Nov 2026, on a throwaway local stack (never the live site), against `master` at `3df7696`. **Fixes:** Decisions 430–434, built in one PR. **Scripts:** `apps/api/scripts/stress/round5/` (one folder per tester or review panel). **Earlier rounds:** `STRESS-TEST-ROUND4.md` and the rounds it lists. Grading was out of scope.

## In plain words

Ten tester agents each ran a School in their own country, the way a real School there works: the UK, Germany, Brazil, the UAE, Australia, Nigeria, India, Japan, the US and Canada. Their Schools had members of every age, family shape, script and payment habit the tester could think of: twins, step-parents, a 10-year-old signing up alone, a member turning 18 mid-month, mononyms, Arabic, Hindi, Tamil, Japanese and Thai names, yen and dinars, Pix, tax-inclusive prices, Ramadan night classes, classes past midnight and clock changes.

Each tester wrote up what broke. Then five review panels of five testers each argued every finding out, re-ran it on a clean School, threw out what the test harness caused, and agreed one fix per finding. The panels were families, money, time, privacy and staff, and names and text.

**Result:** 35 confirmed bugs (10 High, 10 Medium, 15 Low) and 25 questions for the product owner. On 5 Nov 2026 the product owner approved every fix and every recommendation ("all recommended and fix all the bugs with best solutions"). Items the panels marked for later or for legal advice went to the v1.3 backlog instead.

## What was found and where it is fixed

| Panel | Findings | Decision | v1.3 backlog |
|---|---|---|---|
| Families: parents, children, consent, 18th birthdays | FAM-1 to FAM-12, PRIV-2 | 430 | §3.27 |
| Money: currencies, tax, refunds, price changes | MON-1 to MON-16, TXT-6 | 431 | §3.28 |
| Time: zones, midnight, clock changes, closures | TIME-1 to TIME-13 | 432 | §3.25 |
| Privacy and staff: closed Schools, access, races | PRIV-1, PRIV-4 to PRIV-11 | 433 | §3.26 |
| Names and text: search, scripts, dates, sign-ups | TXT-1 to TXT-10 | 434 | §3.24 |

**The High bugs, in short:**
- A parent who also trained at the School couldn't book for their child (403); a Guardian grant alone did the same (FAM-1).
- A 10-year-old could add themselves as a Guardian of another child (FAM-2), and could buy a plan for themselves (FAM-5).
- A second parent made a duplicate child that couldn't be merged (FAM-6). After the child turned 18, the parent still signed waivers as the "child" (FAM-7).
- Yen amounts were kept in fractions: a ¥1,000 pack refunded ¥999 in three parts, and a ¥666.70 discounted charge stayed part-paid and drew a late fee (MON-1, MON-2). Ten quick partial refunds of the same charge refunded the whole payment (MON-4). Late-cancel fees fell back to US dollars at a Canadian School (MON-5).
- A School time zone typed as a Windows name ("Mountain Standard Time") was accepted, and then made the class generator fail for the Schools after it (TIME-1).
- A closed School's owner still read members' email, phone and date of birth after the 90-day purge (PRIV-1).

## What the harness got wrong (keep in mind next round)

- The round 4 seeds give parents a GUARDIAN role grant and give students a Branch on their STUDENT grant. The product never makes either. Results about "a student can't see the other Branch" from those seeds are not real (DE-4 was refuted for this reason).
- One tester's private API shared Redis with the others and ran the purge jobs mid-run. Give each private API its own Redis.
- Any API process for these scripts must run without `HTTPS_PROXY`, or calls to the local fake Stripe go through the sandbox proxy and fail.

## Needs action on deploy

Nine migrations, in order:

```
cd apps/api
npx prisma migrate deploy
npx prisma generate
# then restart the API
```

- `20270220000000_guardian_links_consent_and_removal` (430)
- `20270221000000_tax_lines`, `20270221000001_desk_sale_refunds` (431)
- `20270222000000_class_who_can_book`, `20270222000001_closure_change_dates` (432)
- `20270223000000_tenant_bootstrap_window`, `20270223000100_closed_school_member_data_purge`, `20270223000200_member_data_export` (433)
- `20270224000000_sign_up_one_waiting_per_email` (434). It removes duplicate waiting sign-ups (same email, same School), keeping the invited one, else the oldest.

All nine were applied on an empty database and on the populated round 5 test database without errors. No new environment variable.

**One-off checks the product owner may want after deploy** (read-only):
- `apps/api/scripts/audit/wrong-currency-fees.sql`: past late-cancel fees charged in the wrong currency.
- `apps/api/scripts/report-placeholder-surnames.ts`: members whose surname was typed as ".", "-" or "_".
