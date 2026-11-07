-- Decision 447 item 4 (#518's follow-up): a membership bought with the saved
-- card off-session (a saved-card purchase, or a plan switch) is written
-- Pending before Stripe is called and tagged on the PaymentIntent, as
-- automatic charge payments and late-cancellation fees already are
-- (Decision 446 item 5). "offSessionAttempt" tells these rows apart from an
-- Elements or hosted Checkout payment that is Pending while the member pays,
-- which the stale-attempt sweep must never settle. "planSwitchFromMembershipId"
-- is the membership whose agreed switch a plan-switch payment is for, so the
-- webhook or the sweep can record the switch's outcome on it.
--
-- Additive only. Existing grants on "Transaction" (table-level) already cover
-- both columns for ultm8_app and ultm8_jobs; no new grant, no policy change.
ALTER TABLE "Transaction" ADD COLUMN "offSessionAttempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Transaction" ADD COLUMN "planSwitchFromMembershipId" TEXT;
