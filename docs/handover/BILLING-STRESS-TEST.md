# Stress test round 2: everything so far, plus billing — report and backend handover

**Run:** 26 Oct 2026, against `master` at `2da77cb`. **Fixes:** branch `test/stress-round2-billing` (this PR). **Scripts:** `apps/api/scripts/stress/booking-schedule/` (round 1, rerun) and the new `apps/api/scripts/stress/billing/` (see each README to rerun). **Round 1:** `BOOKING-SCHEDULE-STRESS-TEST.md`.

## Summary

The same cast as round 1 went through the real API: 30 Schools and 12,213 students. It covered belt declarations, bookings, check-ins, promotions, the 25 round-1 attacks and the booking bursts. Then every student bought a 10-class pack (half by card, half in cash) and 27 billing checks tried to break purchases, confirmations, Stripe webhooks, promotion fees and the transactions list.

- **Round 1 still holds.** The load, the bursts and 22 of 24 attacks give the same results as on 26 Oct. The two failures are round 1's known open items (H2 extreme burst, H4 promote without its guard).
- **Billing broke badly under load, now fixed in this PR:**
  - **Confirmations failed.** 5,917 of 6,071 cash confirmations failed with "busy" (503).
  - **Card payments were left waiting.** 5,142 of 6,142 Stripe notices were refused (429), so those payments stayed Pending.
  - **Settled payments in this run:** only 1,154 of 12,213 purchases became memberships. After the fixes, all 12,213 did.
- **Three bugs fixed here** (F1–F3 below), each pinned by a test that fails without the fix.
- **Six billing failures are already fixed by open PR #318** (Memberships review, Decision 334). They are listed so nobody fixes them twice.
- **Handed to the backend team:** 2 new items (B1, B2), plus round 1's open items.

## Environment

Same as round 1: Postgres 16 with RLS, Redis, and the built API on one 4-CPU sandbox, driven over HTTP, 64 requests in flight. The Prisma pool was 9 connections, and the per-IP limit was raised for the load.

**Stripe:** a small local stand-in for the Stripe API (`scripts/stress/billing/fake-stripe.mjs`), wired in with `node --require use-fake-stripe.cjs`. No API code changes to use it.

- **Webhooks** are signed with the API's own `STRIPE_WEBHOOK_SECRET`, so they pass the real signature check.
- **Card purchases** use hosted Checkout, then a signed `payment_intent.succeeded`.

**Seed:** round 1's seed, then through the API:

- a payment account per School: even Schools Stripe Connect, odd Schools cash;
- three kinds of plan: a 10-class pack, a week pass, and a monthly subscription at card Schools.

## Load results (final run, fixes in)

| Step | Requests | Median | p95 | Result |
|---|---|---|---|---|
| Buy a pack, card (hosted Checkout) | 6,142 | 495 ms | 612 ms | all 201 |
| Buy a pack, cash | 6,071 | 374 ms | 456 ms | all 201 |
| Owner confirms cash | 6,071 | 246 ms | 308 ms | all 200, **23.9 s** for all |
| Stripe `payment_intent.succeeded` | 6,142 | — | — | all 200, all settled in **79 s** |
| Transactions list, every page, 30 Schools | 135 | 70 ms | 112 ms | every payment listed once |

**Result:** 12,213 purchases, 12,213 successful payments, 12,213 packs, each with 10 credits and a 90-day expiry.

| | Before the fixes | After |
|---|---|---|
| Cash confirmations | 154 OK, **5,917 × 503**, 211 s | 6,071 OK, 24 s |
| Card webhooks | 1,000 OK, **5,142 × 429**, 5,142 payments left Pending | 6,142 OK, all settled in 79 s |
| Memberships created | 1,154 of 12,213 | 12,213 of 12,213 |

**Round 1 rerun** (same numbers as on 26 Oct, within noise):

| Step | Requests | Median | p95 | Result |
|---|---|---|---|---|
| Book (3 per student) | 36,639 | 632 ms | 789 ms | the same 18,667 booked, the same refusals |
| Instructor check-in | 6,929 | 809 ms | 997 ms | all 201 |
| Promote one rung | 12,213 | 914 ms | 1,064 ms | 10,975 promoted; 1,238 refused for no live membership |
| Bursts 40/100/200/400 people | — | — | — | every class filled exactly, no errors |

## Findings fixed in this PR

| # | Finding | Before | Now |
|---|---|---|---|
| F1 | **Confirming cash payments starved the connection pool** | `PATCH /transactions/:id/confirm` opened a transaction and, inside it, checked the owner in a second transaction. Each request held one pooled connection while waiting for another. With 9 or more at once (the pool size), every one waited out Prisma's 2 s and failed with 503. Even 20 clicks on one payment all failed. | A `withTenantContext` call made inside another for the same user (and impersonation scope) reuses the open transaction (`prisma-app.service.ts`). The fix is in the shared helper, so it also covers the new Cancel endpoint in open PR #321, which has the same nesting. A scan of the API found no other nesting. |
| F2 | **Stripe webhooks were rate-limited** | The route had no `@SkipThrottle`. Anonymous requests fall back to the IP, and all of Stripe's deliveries come from a handful of Stripe IPs. In the run, 5,142 of 6,142 got 429 at the 1,000-a-minute limit. **The production default is 60 a minute per IP**, so a busy hour (renewals across many Schools) would be refused. Stripe retries later, so each payment is delayed by hours, not lost. | `@SkipThrottle({ default: true, identity: true })`. A bare `@SkipThrottle()` only skips the `default` throttler, not `identity`. Every request is still signature-checked. |
| F3 | **A card payment that failed once and then succeeded stayed Failed** | `payment_intent.payment_failed` fires for each failed attempt. The payer can try another card in Checkout and the same PaymentIntent then succeeds. The success handler only settled PENDING payments, so the money was taken and no membership was created. | `payment_intent.succeeded` settles PENDING or FAILED. The refund path for a second general-access pass also covers FAILED. |
| — | **Round 1's attack A9c depended on the time of day** | Run in the evening, moving a slot to 06:30 put today's booked class in the past. It was then cancelled by design (round 1, H8a), and the check failed. | The check books a class from tomorrow onward. Test change only. |

**Tests:**
- New `apps/api/test/billing-stress-fixes.e2e-spec.ts` (4 tests) pins F1–F3. All 4 fail with the fixes reverted.
- API unit: 521 pass.
- API e2e: the full suite passes (92 suites, 1,091 tests). The one local failure, the instructor certification link, needs the file-storage (R2) settings and passes with them.

**No database change. No API contract change.**

## Already fixed by open PRs (don't fix twice)

These failed on `master` and are fixed by **PR #318** (Memberships review, Decision 334). Rerun `billing.mjs` after it merges: C1, C10 and C18 should then pass.

| Check | What happens on `master` | Fixed by |
|---|---|---|
| C1 | 20 clicks on a cash purchase make 20 Pending orders | #318: a repeat cash order returns the one already waiting |
| C10 | A plan priced at 2³¹ is a 500 | #318 (M8): a 400 |
| C18 | A closed School still takes purchases and confirmations | #318 (M15/M16) |
| C3, C7 | A student with a subscription can order a week pass. Cash: the owner then can't confirm it. Card: Stripe charges and the payment is refunded. | #318 (M1): the same live check runs before any charge |

## Billing attack results (final run)

23 of 27 pass. The 4 that fail are C1, C10 and C18 (fixed by #318) and C11 (B2 below).

| Check | Result |
|---|---|
| Every purchase settles, one membership per payment; packs have their credits and expiry | pass |
| Transactions list pages through every payment once | pass |
| 20 confirmations of one payment at once | one membership |
| Two week passes for one student confirmed at once | one pass; the other order stays Pending |
| One Stripe event delivered 20 times; 10 different events for one payment | one membership |
| Forged, unsigned and hour-old webhooks | all refused (400) |
| A second week pass paid by card | one pass, the second payment refunded through Stripe |
| Payment fails, then succeeds | membership given (F3) |
| Cross-tenant and wrong role (10 attempts) | all refused, order untouched |
| Promotion fees: parallel accepts, accept vs cancel, parallel waives, waive vs cancel, other Schools, promote again while a fee waits | one wins each time; the waiting promotion applies once; no leaks |
| A removed student buying; a Guardian for their own child, another child, after unlinking | refused / allowed / refused / refused |
| A lost chargeback | payment Disputed with the amount; the membership expired |
| A School whose ULTM8 subscription lapsed | no new payments (403) |

## For the backend team

| # | Task | Notes |
|---|---|---|
| B1 | **Confirming a payment that isn't Pending returns 200** | Confirming a FAILED order (or one cancelled through #321's new Cancel) returns 200 and changes nothing, so the owner thinks it worked. An already-confirmed order returning 200 is fine (a double click). FAILED, REFUNDED or DISPUTED should be 409. Every place this check could go is also edited by #318 or #321. Do it after both merge, in `PaymentsService.confirmTransaction`. |
| B2 | **Double-clicking Subscribe opens one Stripe subscription per click** | 5 clicks made 5 incomplete Stripe subscriptions and 5 Pending orders (C11). The unpaid ones expire at Stripe after about a day; #321 then marks their orders Failed (`payment_intent.canceled`). If the member pays two (two tabs), the existing refund path refunds the second. The same applies to card packs (one Checkout session per click). Fix after #318 merges: reuse the open order for the same student and plan, as #318 does for cash, or pass Stripe an idempotency key per student and plan. |
| — | **Round 1 items still open** | H2 (the extreme burst: 1,200 people on one instance get 503 by design) and H4 (10 parallel promotes *without* `expectedCurrentRungId` promote twice; both apps always send it, so no user can trigger it; making it required changes the API) fail again as expected. H3, H5–H10 are unchanged. See `BOOKING-SCHEDULE-STRESS-TEST.md`. |

## Not covered by this round

These need more of Stripe than the stand-in has, or flows not built yet:

- **Saved-card purchases:** they need a step-up proof.
- **Franchise-fee billing:** `invoice.paid` and its refunds.
- **Platform subscription plans:** subscribe, renew.
- **Subscription renewals:** `invoice.paid` on a membership.
- **Staff charges and balances:** C1 (Decision 303) isn't built.

The payout side (money reaching the School's bank) is Stripe's and isn't tested here.
