---
name: ultm8-payments
description: Payments/billing mechanics for ULTM8 — Stripe Connect custody model, payment scope (Stripe cards + manual Cash/Bank Transfer only), the Transaction/Invoice status enum vs Membership.status, refund/credit policies, and currency handling. Load before implementing, reviewing, or writing tests for PaymentsModule, checkout, refunds, subscriptions, or franchise-fee billing.
---

# ULTM8 Payments

**Derived from:** `deep-review/ULTM8-Dev-Handover-v55/ULTM8_Technical_Specification_55.docx` Sections 4.5, 10, 11.2, and 11.5, cross-checked against `skills/ultm8-domain-rules/SKILL.md` §6, §7, §8.
**Maintained by:** the Architect agent only, per the same convention as `ultm8-domain-rules`. If this skill and Spec 55 ever disagree, the spec wins — flag the mismatch rather than trusting whichever one you read first.
**Status:** living reference. Re-verify against the spec every time it's updated; do not assume this file is current.

> **Golden rule:** every rule below is tagged `[CONFIRMED]`, `[OBSERVED IN DESIGNS]`, `[UI BEHAVIOUR]`, or `[UNRESOLVED]`, exactly as in `ultm8-domain-rules`. Only `[CONFIRMED]` items may be treated as settled. If a task requires something tagged `[UNRESOLVED]`, stop and escalate — do not fill the gap with a plausible guess.

**Scope note:** this skill covers payment *mechanics* — custody, gateway scope, status enums, refund/credit plumbing, currency. Which membership types exist and how they behave belongs to `ultm8-domain-rules` §6/§7 — don't duplicate that here, and don't look here for it. Tenant isolation of `PaymentAccount` access belongs to `ultm8-tenant-isolation`.

---

## 1. Payment-credential custody

- **[CONFIRMED]** ULTM8 moves toward Stripe Connect (Express or Standard) so tenant secret keys are never held by the platform at all — ULTM8 stores only a Connected Account id per `PaymentAccount`. This removes an entire class of risk rather than mitigating it with encryption: a database compromise can no longer expose live payment credentials for every tenant. (§4.5, §10.4)
- **[CONFIRMED]** Where Connect isn't viable for a specific flow, the fallback is a dedicated secrets manager — AWS Secrets Manager specifically — rather than an application-level encrypted database column. (§4.5, §10.4, §11.6)
- **[CONFIRMED]** Because credentials are Connect account ids or secrets-manager references rather than plaintext-recoverable keys, **no Platform Admin role — including Full Admin — has a code path that returns a decrypted tenant secret key.** (§4.5, §10.4)
- **[CONFIRMED]** ULTM8's payment UI uses Stripe-hosted fields/redirect only, for both Connect onboarding and checkout — no raw card, bank, or account-verification data ever touches ULTM8's own frontend or backend, targeting PCI SAQ-A. (§11.5, resolved Pass 7)
- **[UNRESOLVED]** Whether a tenant onboards through Stripe Connect Express or Standard is still open, and it now also determines who controls that tenant's recurring-payment retry/dunning schedule (Express: ULTM8 configures it programmatically; Standard: the account holder's own Stripe Dashboard settings apply). (§10.2, §10.4, §12.2)

## 2. Payment scope

- **[CONFIRMED]** Stripe (cards) is the only live payment gateway built. Cash and Bank Transfer are supported as manually-recorded, non-gateway payment methods — staff mark them Pending/Successful by hand. (§1.2, §10.1)
- **[CONFIRMED]** GoCardless and PayPal, both present in the original Figma payment-method screens, are explicitly **out of scope** for this build. (§1.2, §10.3)
- **[CONFIRMED]** Any Subscription-type `MembershipPlan` requires Stripe as the payment method — auto-recurring billing has no Cash/Bank Transfer equivalent. Only Class Pack, Weekly Pass, Friend Pass, and Trial Membership (all one-time purchases) remain Cash/Bank Transfer-eligible. (§6.1, §10.2)
- **[CONFIRMED]** Every Stripe-charged purchase in this platform (Membership billing, Franchise fees, the white-label add-on) is for a real-world service, not a digital good consumed inside the app — the category Apple's/Google's in-app-purchase policies actually target. Still worth confirming against each store's current guidelines before launch rather than assumed. (§10.3)

## 3. Status enums — do not conflate

- **[CONFIRMED]** `Transaction`/`Invoice.status` has its own enum — **Successful / Pending / Failed / Refunded / Disputed** — which must not be confused with `Membership.status`. A `Transaction` can sit Pending (e.g. an unconfirmed Cash/Bank Transfer) while no `Membership` row exists yet at all. (§6.1, §10.2; `ultm8-domain-rules` §8)
- **[CONFIRMED]** `Membership.status` has exactly two values — Active and Expired. A third "Pending" value was removed (Decision 6) after it produced a real bug (a £0 Friend Pass, with no Transaction ever created, would have been stuck Pending forever). Do not model a Pending Membership state. (§6.1, §9, §10.2; `ultm8-domain-rules` §8)
- **[CONFIRMED]** A `Membership` row is *created*, not status-flipped, at the exact moment its payment settles: a Stripe charge succeeding creates it Active immediately via `stripe-webhook-processing`; a Cash/Bank Transfer purchase creates only a Pending `Transaction` first, and School Owner/Manager staff confirm it via `PATCH /transactions/{id}/confirm`, which atomically flips the Transaction to Successful and creates the Membership Active in the same step. A Cash/Bank-eligible plan priced at £0 skips the wait entirely. (§6.1, §9, §10.2)

## 4. Cancellation / refund / credit mechanics

- **[CONFIRMED]** Each School sets a `class-cancellation-policy`: **Manual** (default — leaves affected credit-records for staff to resolve case-by-case), **Auto-Refund** (money back), or **Auto-Credit** (spent credit restored, no money moves — mutually exclusive with Auto-Refund, since that would double-compensate). A Friend Pass entry is always forced to Auto-Credit regardless of School policy, since it was gifted at £0. (§6.1, §10.2; `ultm8-domain-rules` §7)
- **[CONFIRMED]** Auto-Refund gives the money back — the Stripe Refund API for anything card-paid, a manual Cash/Bank Transfer ledger reversal (same staff-driven pattern as the Cash/Bank confirm-to-Successful transition) for anything that never touched Stripe. (§10.2)
- **[CONFIRMED]** Multi-class Class Pack refunds are computed **per-credit**: an unscoped multi-class pack that only had one credit spent on the cancelled Class refunds `price ÷ classesIncluded`, not the full amount — the customer keeps remaining credits. `Transaction.refundedAmount` accumulates across multiple partial refunds against the same purchase and is validated against the original amount before each new refund. (§10.2)
- **[CONFIRMED]** Since a single Booking can carry several independent credit-records (the Student's own plus one per guest), the Stripe Refund API call's idempotency key is derived from **(Booking id, membershipId)**, not the Booking id alone. Both `POST /payments/refund` and `POST /bookings/{id}/credit-restore` only ever act on a credit-record the `class-cancellation-processing` job has already flagged pending (`refundResolution` still null); a repeat call finds the record already resolved and no-ops instead of double-processing it. (§10.2)
- **[CONFIRMED]** Who can authorize which path: **Auto-Credit** is a narrow, no-money action, so it's Branch-Staff-accessible, same shape as their existing membership-status-check endpoint. **Auto-Refund** moves real money out, so it stays School Owner/Manager-only — the same separation-of-duties boundary most POS systems draw between taking a sale and authorizing a refund. A `FranchiseFeeCharge` refund follows the same money-only-with-authority principle, but the authorizing party is the Franchise Owner, since the Franchise's own `PaymentAccount` holds the money. (§8.2, §10.2)
- **[CONFIRMED]** If a Stripe Refund API call itself errors (declined, a stale charge, insufficient Connected Account balance), the affected credit-record falls back into the existing Manual bucket with an explicit failed-attempt flag/reason recorded, plus a staff notification — never silently stalling indistinguishable from a credit-record nobody has attempted yet. (§10.2, resolved Pass 4)
- **[CONFIRMED]** If the synchronous PaymentIntent-creation call to Stripe itself errors (network, Stripe-side degradation) rather than the charge being declined, the Student sees a plain retryable error at checkout — no charge is queued or assumed, and no Transaction row is created until Stripe actually responds. (§10.2, Decision 29)
- **[UNRESOLVED]** The late-cancellation-*fee* charge mechanism is distinct from the refund/credit mechanism above and remains open: `Class` and `MembershipPlan` both carry a cancellation-charge field alongside a refund-fee-date cutoff, implying a Student who cancels after that cutoff may owe a fee — but whether and how that fee is actually *collected* (charged to a saved card, or simply forfeited value with no new charge) is not answered. (§12.2; `ultm8-domain-rules` §7/§18)

## 5. Webhooks and recurring billing

- **[CONFIRMED]** `POST /payments/webhooks/stripe` verifies signatures and pushes events onto the `stripe-webhook-processing` BullMQ queue for idempotent, asynchronous handling: `payment_intent.succeeded/failed`, `invoice.paid`, `invoice.payment_failed` (fired on each Stripe Smart Retry attempt), `customer.subscription.updated/deleted`, `charge.dispute.created/updated/closed`. Idempotency is enforced by deduping on Stripe's event id before processing, since Stripe may redeliver the same webhook more than once. (§9, §10.2)
- **[CONFIRMED]** Every recurring charge on the platform (Membership Subscription renewals, Franchise-fee Flat/Per-Headcount billing, platform/white-label `SubscriptionPlan`) already runs on a Stripe Subscription object, so retries lean on Stripe's own configurable Smart Retry schedule rather than a custom BullMQ retry scheduler. (§10.2)
- **[CONFIRMED]** Franchise-fee collection is Stripe-automated, not manually invoiced: a Flat fee is a standing Stripe Subscription against the School's saved payment method; a Per-Headcount fee uses Stripe metered/usage-based billing, fed by the `franchise-fee-usage-reporting` job reporting each School's active-student-count monthly. Either way, the charge settles directly into the Franchise's own connected `PaymentAccount`, not the platform's balance. ULTM8 takes no cut. (§10.2)
- **[UNRESOLVED]** The white-label add-on's exact metered rate — referenced only as a $0.99–$1.99/active-student/month range — has not been set. (§5.3, §10.2, §12.2)

## 6. Currency handling

- **[CONFIRMED]** Student-facing `MembershipPlan` pricing is independent per-currency and School-set — a School prices in its own local currency and that is what a Student pays, with no automatic conversion. (§11.2; `ultm8-domain-rules` §7)
- **[CONFIRMED]** ULTM8's own revenue — the platform `SubscriptionPlan`, the white-label add-on, and Franchise-fee — is quoted and billed in a single anchor currency (USD), with the card network's own FX handling conversion at charge time. `Transaction`/`Invoice` carries a `currency` field recording which currency each charge actually settled in. (§10.2, §11.2)

## 7. Rules for AI agents using this skill

Follow `ultm8-domain-rules` §20 in full — the tagging discipline, escalation rule, and citation requirement all apply here identically. In short: only `[CONFIRMED]` authorizes building against a rule; an `[UNRESOLVED]` item is a stop-and-escalate, never a guess; cite the `(§...)` reference in code comments/PRs so a reviewer can trace it back in one step; only the Architect agent edits this file directly.
